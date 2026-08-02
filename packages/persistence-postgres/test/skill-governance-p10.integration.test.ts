import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { createSkillVersion } from '../../domain/src/index.js';
import {
  PostgresSkillExactVersionGovernanceRepository,
  PostgresSkillRepository,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 3 });
let skillId: string;

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  skillId = `skill.p10.governance.${randomUUID()}`;
  await new PostgresSkillRepository(pool).saveVersionAndSetCurrent(skillVersion(), timestamp);
});

afterAll(async () => {
  await pool.end();
});

describe('P10 exact Skill version governance authority', () => {
  it('publishes with CAS, replays idempotently, and preserves the exact version target', async () => {
    const repository = new PostgresSkillExactVersionGovernanceRepository(pool);
    const command = mutation('publish', 0, 'publish-key-p10');

    const published = await repository.transition(command);
    const replay = await repository.transition(command);

    expect(published).toMatchObject({
      status: 'published',
      governanceRevision: 1,
      replayed: false,
      skill: { skillId, version: 1, status: 'enabled' },
    });
    expect(replay).toMatchObject({
      status: 'published',
      governanceRevision: 1,
      replayed: true,
    });
    await expect(
      repository.transition({ ...mutation('suspend', 0, 'suspend-key-p10') }),
    ).rejects.toMatchObject({ code: 'SKILL_GOVERNANCE_REVISION_CONFLICT', status: 412 });

    const suspended = await repository.transition(mutation('suspend', 1, 'suspend-key-p10'));
    expect(suspended).toMatchObject({
      status: 'suspended',
      governanceRevision: 2,
      skill: { skillId, version: 1, status: 'disabled' },
    });
    const counts = await pool.query<{
      governance: number;
      commands: number;
      immutable_status: string;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM runtime_skill_version_governance WHERE skill_id=$1) AS governance,
         (SELECT count(*)::integer FROM runtime_skill_governance_command WHERE skill_id=$1) AS commands,
         (SELECT status FROM skill_version WHERE skill_id=$1 AND version=1) AS immutable_status`,
      [skillId],
    );
    expect(counts.rows).toEqual([{ governance: 1, commands: 2, immutable_status: 'draft' }]);
  });

  it('rejects idempotency drift before changing authoritative Skill state', async () => {
    const repository = new PostgresSkillExactVersionGovernanceRepository(pool);
    const command = mutation('publish', 0, 'drift-key-p10');
    await repository.transition(command);

    await expect(
      repository.transition({
        ...command,
        reason: 'Different reason.',
        requestHash: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'SKILL_GOVERNANCE_IDEMPOTENCY_CONFLICT', status: 409 });
    await expect(new PostgresSkillRepository(pool).findVersion(skillId, 1)).resolves.toMatchObject({
      status: 'enabled',
    });
  });

  it('replays Skill imports durably and reconciles a committed import after response loss', async () => {
    const repository = new PostgresSkillExactVersionGovernanceRepository(pool);
    const skills = new PostgresSkillRepository(pool);
    const importedSkillId = `skill.p10.import.${randomUUID()}`;
    const input = importMutation(importedSkillId, 'import-key-p10');
    let importCalls = 0;
    const importValidatedPackage = async () => {
      importCalls += 1;
      const version = importedSkillVersion(importedSkillId);
      await skills.saveVersionAndSetCurrent(version, timestamp, packageAudit(input));
      return version;
    };

    const imported = await repository.importPackage(input, importValidatedPackage);
    const replay = await repository.importPackage(input, importValidatedPackage);
    expect(imported).toMatchObject({ replayed: false, skill: { skillId: importedSkillId } });
    expect(replay).toMatchObject({ replayed: true, skill: { skillId: importedSkillId } });
    expect(importCalls).toBe(1);
    await expect(
      repository.importPackage({ ...input, requestHash: 'f'.repeat(64) }, importValidatedPackage),
    ).rejects.toMatchObject({ code: 'SKILL_IMPORT_IDEMPOTENCY_CONFLICT', status: 409 });

    const reconciledSkillId = `skill.p10.reconcile.${randomUUID()}`;
    const reconciledInput = importMutation(reconciledSkillId, 'reconcile-key-p10');
    const committed = importedSkillVersion(reconciledSkillId);
    await skills.saveVersionAndSetCurrent(committed, timestamp, packageAudit(reconciledInput));
    let forbiddenRetryCalls = 0;
    const reconciled = await repository.importPackage(reconciledInput, () => {
      forbiddenRetryCalls += 1;
      return Promise.resolve(committed);
    });
    expect(reconciled).toMatchObject({ replayed: true, skill: { skillId: reconciledSkillId } });
    expect(forbiddenRetryCalls).toBe(0);
    const commands = await pool.query<{ status: string; count: number }>(
      `SELECT status,count(*)::integer AS count
         FROM runtime_skill_import_command
        WHERE skill_id IN ($1,$2)
        GROUP BY status`,
      [importedSkillId, reconciledSkillId],
    );
    expect(commands.rows).toEqual([{ status: 'succeeded', count: 2 }]);
  });
});

const timestamp = '2026-08-02T00:00:00.000Z';

function mutation(
  operation: 'publish' | 'suspend' | 'deprecate',
  expectedRevision: number,
  idempotencyKey: string,
) {
  const request = { operation, skillId, version: 1, expectedRevision, reason: 'P10 governance.' };
  return Object.freeze({
    ...request,
    idempotencyKeyHash: createHash('sha256').update(`${idempotencyKey}:${skillId}`).digest('hex'),
    requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    actorId: 'node-control:p10',
    occurredAt: timestamp,
  });
}

function skillVersion() {
  return importedSkillVersion(skillId);
}

function importedSkillVersion(candidateSkillId: string) {
  return createSkillVersion({
    skillId: candidateSkillId,
    version: 1,
    name: 'P10 Governed Skill',
    summary: 'Governed exact version.',
    description: 'Exercises Runtime Skill governance CAS semantics.',
    capabilities: ['governance'],
    workflowGuidance: 'Execute only after publication.',
    outputInstruction: 'Return governed status.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'draft',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: timestamp,
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId: candidateSkillId,
      skillVersion: 1,
      specificationHash: `sha256:${createHash('sha256').update(candidateSkillId).digest('hex')}`,
      effects: ['effect.governed'],
      evidence: ['evidence.governed'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: {},
    },
  });
}

function importMutation(candidateSkillId: string, idempotencyKey: string) {
  const request = { packageRoot: `/packages/${candidateSkillId}`, reason: 'Import P10 package.' };
  return Object.freeze({
    packageRoot: request.packageRoot,
    packageChecksum: createHash('sha256').update(candidateSkillId).digest('hex'),
    fileChecksums: Object.freeze({
      'SKILL.md': createHash('sha256').update(`skill:${candidateSkillId}`).digest('hex'),
    }),
    skillId: candidateSkillId,
    version: 1,
    idempotencyKeyHash: createHash('sha256')
      .update(`${idempotencyKey}:${candidateSkillId}`)
      .digest('hex'),
    requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    actorId: 'node-control:p10',
    reason: request.reason,
    occurredAt: timestamp,
  });
}

function packageAudit(input: ReturnType<typeof importMutation>) {
  return Object.freeze({
    skillId: input.skillId,
    skillVersion: input.version,
    packageChecksum: input.packageChecksum,
    packageRoot: input.packageRoot,
    fileChecksums: input.fileChecksums,
    validatedAt: timestamp,
    importedAt: timestamp,
  });
}
