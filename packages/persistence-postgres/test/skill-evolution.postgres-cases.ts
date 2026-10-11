import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { verifiedEvolutionFixture } from '../../../apps/server/test/verified-skill-evolution-fixture.js';
import {
  evolutionAuthorityFixture,
  timestamp,
} from '../../application/test/skill-evolution-fixture.js';
import { canonicalHash } from '../../application/src/mcp-task-readiness.js';
import { createSkillVersion, type McpTool } from '../../domain/src/index.js';
import { Aes256GcmSecretCipher } from '../../crypto-adapter/src/index.js';
import {
  PostgresMcpRegistryRepository,
  PostgresSkillRepository,
  PostgresTemporarySkillRepository,
} from '../src/repositories.js';

/** Synthetic recording corpus, real candidate LangGraph executions and real PostgreSQL commits. */
export async function verifySkillEvolutionCommitCases(pool: Pool) {
  const skills = new PostgresSkillRepository(pool);
  const temporary = new PostgresTemporarySkillRepository(pool);
  const registry = new PostgresMcpRegistryRepository(pool);
  const outcomes: string[] = [];
  async function setup(newSkill = false, commitPool = pool) {
    const identity = randomUUID();
    const original = evolutionAuthorityFixture().base;
    const skillId = `evolution-${identity}`;
    assert.ok(original.outcomeSpecification);
    const base = createSkillVersion({
      ...original,
      skillId,
      outcomeSpecification: {
        ...original.outcomeSpecification,
        skillId,
        specificationHash: `sha256:${canonicalHash({ ...original.outcomeSpecification, skillId })}`,
      },
    });
    const semantics = {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'allowed',
      source: 'mcp_declared',
    } as const;
    const tool: McpTool = {
      serverId: 'local-recording',
      toolName: 'read',
      inputSchema: base.inputSchema,
      outputSchema: base.outputSchema,
      discoveredAt: timestamp,
      declaredExecutionSemantics: semantics,
      executionSemantics: semantics,
      taskExecutionProfile: {
        profileVersion: '1.0',
        taskBehavior: 'synchronous_only',
        availability: 'not_supported',
        supportsScheduling: false,
        supportsMaxElapsed: false,
        supportsObservations: false,
        supportsInputRequired: false,
        idempotency: 'client_request_key',
      },
    };
    await registry.saveServerAndReplaceTools(
      {
        server: {
          serverId: tool.serverId,
          name: 'Owned offline fixture',
          endpoint: 'http://127.0.0.1:1/unreachable',
          transport: 'streamable_http',
          status: 'enabled',
          toolRevision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        encryptedCredential: new Aes256GcmSecretCipher(randomBytes(32).toString('base64')).encrypt(
          {},
        ),
      },
      [tool],
    );
    if (!newSkill) await skills.saveVersionAndSetCurrent(base, timestamp);
    const actualServer = (await registry.findServer(tool.serverId))?.server;
    const actualTool = (await registry.listTools(tool.serverId))[0];
    if (actualServer === undefined || actualTool === undefined)
      throw new Error('Fixture authority absent');
    const fixture = verifiedEvolutionFixture({
      base: newSkill ? base : ((await skills.findCurrentVersion(base.skillId)) ?? base),
      server: actualServer,
      tool: actualTool,
      newSkill,
      candidateReader: () => temporary.findFormalizationCandidateById(fixture.initial.candidateId),
      commit: {
        commit: new PostgresSkillRepository(commitPool).commitEvolutionValidation.bind(
          new PostgresSkillRepository(commitPool),
        ),
      },
    });
    await temporary.saveFormalizationCandidate(fixture.initial);
    return { ...fixture, base };
  }
  async function counts(skillId: string) {
    return (
      await pool.query<{ versions: string; outcomes: string; events: string }>(
        `SELECT (SELECT count(*) FROM skill_version WHERE skill_id=$1)::text versions,
       (SELECT count(*) FROM skill_outcome_specification WHERE skill_id=$1)::text outcomes,
       (SELECT count(*) FROM cognitive_runtime_outbox WHERE aggregate_id=$1)::text events`,
        [skillId],
      )
    ).rows;
  }
  for (const newSkill of [false, true]) {
    const fixture = await setup(newSkill);
    const published = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
    assert.equal(published.status, 'published', JSON.stringify(published.validationReport?.cases));
    const expectedVersion = newSkill ? 1 : 2;
    assert.equal((await skills.findCurrentVersion(fixture.base.skillId))?.version, expectedVersion);
    assert.deepEqual(
      await temporary.findFormalizationCandidateById(fixture.initial.candidateId),
      published,
    );
    const before = await counts(fixture.base.skillId);
    const request = fixture.commits[0];
    assert.ok(request);
    const retries = await Promise.all([
      skills.commitEvolutionValidation(request),
      skills.commitEvolutionValidation(request),
    ]);
    assert.deepEqual(retries, [published, published]);
    assert.deepEqual(await counts(fixture.base.skillId), before);
    await temporary.saveFormalizationCandidate(fixture.initial);
    assert.deepEqual(
      await temporary.findFormalizationCandidateById(fixture.initial.candidateId),
      published,
    );
    await assert.rejects(
      skills.commitEvolutionValidation({
        ...request,
        candidate: {
          ...published,
          proposedSkill: { ...fixture.proposed, workflowGuidance: 'stale rewrite' },
        },
      }),
      { code: 'SKILL_EVOLUTION_PUBLICATION_CONFLICT' },
    );
    outcomes.push(newSkill ? 'new_skill_idempotence' : 'new_version_idempotence');
  }
  const corrected = await setup();
  corrected.setWrongResult(true);
  const failed = await corrected.service.evaluateAndPublish(corrected.initial.candidateId);
  assert.equal(failed.status, 'validation_failed');
  assert.equal((await skills.findCurrentVersion(corrected.base.skillId))?.version, 1);
  assert.ok(failed.proposedSkill);
  corrected.setWrongResult(false);
  const result = await corrected.service.correctAndRevalidate(failed.candidateId, {
    actor: 'fixture',
    summary: 'Repair output guidance',
    proposedSkill: { ...failed.proposedSkill, workflowGuidance: 'Correct full result' },
  });
  assert.equal(result.candidate.status, 'published');
  assert.deepEqual(await temporary.listCorrectionExperiences(failed.candidateId), [
    result.correction,
  ]);
  outcomes.push('failed_then_atomic_correction');

  let inject = true;
  let failureSql = 'UPDATE skill_formalization_candidate SET';
  const failurePool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query(sql: string, values?: unknown[]) {
          if (inject && sql.startsWith(failureSql)) {
            inject = false;
            await client.query('SELECT 1/0');
          }
          return client.query(sql, values);
        },
        release: () => {
          client.release();
        },
      };
    },
  } as unknown as Pool;
  const rollback = await setup(false, failurePool);
  const before = await counts(rollback.base.skillId);
  await assert.rejects(rollback.service.evaluateAndPublish(rollback.initial.candidateId), {
    code: '22012',
  });
  assert.equal(inject, false);
  assert.deepEqual(await counts(rollback.base.skillId), before);
  assert.equal((await skills.findCurrentVersion(rollback.base.skillId))?.version, 1);
  assert.deepEqual(
    await temporary.findFormalizationCandidateById(rollback.initial.candidateId),
    rollback.initial,
  );
  const retry = rollback.commits[0];
  assert.ok(retry);
  assert.equal((await skills.commitEvolutionValidation(retry)).status, 'published');
  outcomes.push('transaction_rollback_and_retry');

  const correctionRollback = await setup(false, failurePool);
  correctionRollback.setWrongResult(true);
  const failedCorrectionSource = await correctionRollback.service.evaluateAndPublish(
    correctionRollback.initial.candidateId,
  );
  assert.ok(failedCorrectionSource.proposedSkill);
  const correctionCounts = await counts(correctionRollback.base.skillId);
  correctionRollback.setWrongResult(false);
  inject = true;
  failureSql = 'INSERT INTO skill_evolution_correction_experience';
  await assert.rejects(
    correctionRollback.service.correctAndRevalidate(failedCorrectionSource.candidateId, {
      actor: 'fixture',
      summary: 'Atomic correction rollback',
      proposedSkill: {
        ...failedCorrectionSource.proposedSkill,
        workflowGuidance: 'Corrected but transactional',
      },
    }),
    { code: '22012' },
  );
  assert.equal(inject, false);
  assert.deepEqual(await counts(correctionRollback.base.skillId), correctionCounts);
  assert.deepEqual(
    await temporary.findFormalizationCandidateById(failedCorrectionSource.candidateId),
    failedCorrectionSource,
  );
  assert.deepEqual(
    await temporary.listCorrectionExperiences(failedCorrectionSource.candidateId),
    [],
  );
  const correctionRetry = correctionRollback.commits[1];
  assert.ok(correctionRetry?.correction);
  await skills.commitEvolutionValidation(correctionRetry);
  assert.deepEqual(await temporary.listCorrectionExperiences(failedCorrectionSource.candidateId), [
    correctionRetry.correction,
  ]);
  outcomes.push('correction_transaction_rollback_and_retry');

  for (const drift of ['candidate', 'base', 'tool', 'receipt'] as const) {
    const fixture = await setup();
    // Retain a fully validated receipt without publishing; the next transaction changes its authority.
    fixture.setWrongResult(true);
    const invalid = await fixture.service.evaluateAndPublish(fixture.initial.candidateId);
    fixture.setWrongResult(false);
    assert.ok(invalid.proposedSkill);
    let staged: Parameters<typeof skills.commitEvolutionValidation>[0] | undefined;
    const intercept = {
      connect() {
        return Promise.reject(new Error('STAGED_WITHOUT_COMMIT'));
      },
    } as unknown as Pool;
    // Validate through the same service while intercepting only its final writer.
    const snapshot = await registry.findServer('local-recording');
    const tool = (await registry.listTools('local-recording'))[0];
    assert.ok(snapshot && tool);
    const validation = verifiedEvolutionFixture({
      base: fixture.base,
      server: snapshot.server,
      tool,
      candidate: invalid,
      candidateReader: () => Promise.resolve(invalid),
      commit: {
        commit: (request) => {
          staged = request;
          return new PostgresSkillRepository(intercept).commitEvolutionValidation(request);
        },
      },
    });
    await assert.rejects(
      validation.service.evaluateAndPublish(invalid.candidateId),
      /STAGED_WITHOUT_COMMIT/u,
    );
    assert.ok(staged);
    assert.equal(staged.candidate.status, 'published');
    if (drift === 'candidate')
      await pool.query(
        'UPDATE skill_formalization_candidate SET successful_experience_count=successful_experience_count+1 WHERE candidate_id=$1',
        [invalid.candidateId],
      );
    if (drift === 'base')
      await pool.query(
        "UPDATE skill_version SET status='disabled' WHERE skill_id=$1 AND version=1",
        [fixture.base.skillId],
      );
    if (drift === 'tool')
      await pool.query("UPDATE mcp_server SET status='disabled' WHERE server_id='local-recording'");
    if (drift === 'receipt') {
      assert.ok(staged.candidate.validationReport);
      staged = {
        ...staged,
        candidate: {
          ...staged.candidate,
          validationReport: {
            ...staged.candidate.validationReport,
            cases: staged.candidate.validationReport.cases.filter(
              (item) => item.kind !== 'boundary',
            ),
          },
        },
      };
    }
    await assert.rejects(skills.commitEvolutionValidation(staged), {
      code:
        drift === 'candidate'
          ? 'SKILL_EVOLUTION_CANDIDATE_STALE'
          : drift === 'base'
            ? 'SKILL_EVOLUTION_BASE_OR_DEPENDENCY_STALE'
            : drift === 'tool'
              ? 'SKILL_EVOLUTION_TOOL_AUTHORITY_STALE'
              : 'SKILL_EVOLUTION_VALIDATION_RECEIPT_INVALID',
    });
    assert.equal((await skills.listVersions(fixture.base.skillId)).length, 1);
    assert.notEqual(
      canonicalHash(await temporary.findFormalizationCandidateById(invalid.candidateId)),
      canonicalHash(staged.candidate),
    );
    outcomes.push(`${drift}_cas`);
  }
  return outcomes;
}
