import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  CognitiveManagementActionGate,
  ConfiguredOperatorIdentityPort,
  DefaultArtifactGovernanceService,
  hashValidationSummary,
} from '../../application/src/index.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../domain/src/index.js';
import {
  PostgresArtifactExecutionRepository,
  PostgresArtifactGovernanceStore,
  PostgresArtifactOutboxConsumerRepository,
  PostgresArtifactRepository,
  PostgresArtifactValidationRepository,
  PostgresCognitiveManagementActionRepository,
} from '../src/index.js';

interface ArtifactFixture {
  readonly artifacts: readonly CompiledArtifact[];
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding: ArtifactRuntimeBinding;
}

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 8 });
let fixture: ArtifactFixture;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as ArtifactFixture;
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE compiled_artifact,artifact_active_pointer,artifact_lineage,
       artifact_validation_run,artifact_approval,artifact_execution,artifact_feedback,
       artifact_match_log,experience_trace,pattern_candidate,cognitive_management_action,
       cognitive_runtime_outbox,cognitive_runtime_consumer_cursor CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P02 PostgreSQL Artifact authority', () => {
  it('round-trips the complete P01 contract and rejects immutable-version drift', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const candidate = candidatePersistence();

    await repository.saveCandidate(candidate);
    await repository.saveCandidate(candidate);
    await expect(
      repository.getDefinition({
        artifactId: candidate.artifact.artifactId,
        version: candidate.artifact.version,
      }),
    ).resolves.toEqual(candidate.artifact);
    const storedEnvelope = await pool.query<{ definition: { runtimeBinding?: unknown } }>(
      `SELECT definition FROM compiled_artifact WHERE artifact_id=$1`,
      [candidate.artifact.artifactId],
    );
    expect(storedEnvelope.rows[0]?.definition.runtimeBinding).toEqual(candidate.runtimeBinding);

    await expect(
      repository.saveCandidate({
        ...candidate,
        artifact: { ...candidate.artifact, description: 'immutable drift' },
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_VERSION_IMMUTABLE' });

    await expect(
      pool.query(
        `UPDATE compiled_artifact
         SET definition=jsonb_build_object('oversized',repeat('x',1048577))
         WHERE artifact_id=$1`,
        [candidate.artifact.artifactId],
      ),
    ).rejects.toBeDefined();
    let tooDeep: Readonly<Record<string, unknown>> = { leaf: true };
    for (let depth = 0; depth < 40; depth += 1) tooDeep = { nested: tooDeep };
    await expect(
      pool.query(`UPDATE compiled_artifact SET definition=$2::jsonb WHERE artifact_id=$1`, [
        candidate.artifact.artifactId,
        JSON.stringify(tooDeep),
      ]),
    ).rejects.toBeDefined();
    await pool.query(
      `UPDATE artifact_lineage SET source_episode_refs='["drift"]'::jsonb
       WHERE artifact_id=$1`,
      [candidate.artifact.artifactId],
    );
    await expect(
      repository.getDefinition({
        artifactId: candidate.artifact.artifactId,
        version: candidate.artifact.version,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_LINEAGE_PROJECTION_DRIFT' });
  });

  it('requires approval, serializes concurrent activation and records atomic audit/outbox', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const validation = new PostgresArtifactValidationRepository(pool);
    const governance = governanceService(repository);
    const candidate = candidatePersistence();
    await repository.saveCandidate(candidate);

    await governance.requestValidation({
      ...commandBase(candidate.artifact),
      validationRunId: 'validation.intent.inspect.1',
      validationType: 'replay',
      datasetRef: 'dataset.intent.inspect.1',
    });
    await validation.appendResult({
      validationRunId: 'validation.intent.inspect.1',
      status: 'passed',
      result: 'promotion evidence passed',
      metrics: { precision: 1, recall: 1 },
      counterexampleRefs: [],
      completedAt: '2026-07-26T00:02:00.000Z',
    });
    const summary = await validation.findPromotionSummary({
      artifactId: candidate.artifact.artifactId,
      version: candidate.artifact.version,
    });
    if (summary === undefined) throw new Error('Expected validation summary.');
    const validationSummaryHash = hashValidationSummary(summary);

    await expect(
      governance.activate({
        ...commandBase(candidate.artifact),
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 0,
        validationSummaryHash,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_APPROVAL_REQUIRED' });

    await governance.recordApproval({
      ...commandBase(candidate.artifact),
      approvalId: 'approval.intent.inspect.1',
      decision: 'approved',
      validationSummaryHash,
    });

    const attempts = await Promise.allSettled([
      governance.activate({
        ...commandBase(candidate.artifact),
        idempotencyKey: 'activate-intent-a',
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 0,
        validationSummaryHash,
      }),
      governance.activate({
        ...commandBase(candidate.artifact),
        idempotencyKey: 'activate-intent-b',
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 0,
        validationSummaryHash,
      }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);

    await expect(repository.findActiveIndex({ domain: 'operations' })).resolves.toEqual([
      expect.objectContaining({
        artifactId: candidate.artifact.artifactId,
        artifactVersion: candidate.artifact.version,
        pointerLockVersion: 1,
      }),
    ]);
    const evidence = await pool.query<{ operation: string; status: string }>(
      `SELECT operation,status FROM cognitive_management_action
       WHERE operation='artifact_activate'`,
    );
    expect(evidence.rows).toEqual([{ operation: 'artifact_activate', status: 'completed' }]);
    const outbox = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM cognitive_runtime_outbox ORDER BY event_type`,
    );
    expect(outbox.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        'artifact.activated',
        'artifact.approval_recorded',
        'artifact.promotion_ready',
        'artifact.validation_completed',
        'artifact.validation_started',
        'compiler.artifact_candidate_created',
      ]),
    );
  });

  it('binds revalidation to fresh evidence and preserves monotonic CAS across kill switch', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const validation = new PostgresArtifactValidationRepository(pool);
    const governance = governanceService(repository);
    const candidate = candidatePersistence();
    await repository.saveCandidate(candidate);
    await governance.requestValidation({
      ...commandBase(candidate.artifact),
      validationRunId: 'validation.revalidation.initial',
      validationType: 'replay',
      datasetRef: 'dataset.revalidation.initial',
    });
    await expect(
      governance.requestValidation({
        ...commandBase(candidate.artifact),
        validationRunId: 'validation.revalidation.different-payload',
        validationType: 'simulation',
        datasetRef: 'dataset.revalidation.different',
      }),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_IDEMPOTENCY_CONFLICT' });
    await validation.appendResult({
      validationRunId: 'validation.revalidation.initial',
      status: 'passed',
      result: 'initial evidence',
      metrics: { precision: 0.9 },
      counterexampleRefs: [],
      completedAt: '2026-07-26T00:02:00.000Z',
    });
    const initialSummary = await validation.findPromotionSummary(candidate.artifact);
    if (initialSummary === undefined) throw new Error('Expected initial validation summary.');
    const initialHash = hashValidationSummary(initialSummary);
    await governance.recordApproval({
      ...commandBase(candidate.artifact),
      approvalId: 'approval.revalidation.initial',
      decision: 'approved',
      validationSummaryHash: initialHash,
    });
    await governance.activate({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'activate-revalidation-initial',
      artifactKey: candidate.artifact.artifactKey,
      expectedLockVersion: 0,
      validationSummaryHash: initialHash,
    });

    await governance.requestRevalidation({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'request-revalidation-second',
      validationRunId: 'validation.revalidation.second',
      validationType: 'revalidation',
      datasetRef: 'dataset.revalidation.second',
    });
    await expect(
      governance.activate({
        ...commandBase(candidate.artifact),
        idempotencyKey: 'activate-revalidation-pending',
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 1,
        validationSummaryHash: initialHash,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_STATE_INVALID' });
    await validation.appendResult({
      validationRunId: 'validation.revalidation.second',
      status: 'passed',
      result: 'fresh evidence',
      metrics: { precision: 0.95 },
      counterexampleRefs: [],
      completedAt: '2026-07-26T00:04:00.000Z',
    });
    const freshSummary = await validation.findPromotionSummary(candidate.artifact);
    if (freshSummary === undefined) throw new Error('Expected fresh validation summary.');
    const freshHash = hashValidationSummary(freshSummary);
    await expect(
      governance.activate({
        ...commandBase(candidate.artifact),
        idempotencyKey: 'activate-revalidation-old-evidence',
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 1,
        validationSummaryHash: initialHash,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_VALIDATION_EVIDENCE_INVALID' });
    await expect(
      governance.activate({
        ...commandBase(candidate.artifact),
        idempotencyKey: 'activate-revalidation-unapproved',
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 1,
        validationSummaryHash: freshHash,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_APPROVAL_REQUIRED' });
    await governance.recordApproval({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'approve-revalidation-second',
      approvalId: 'approval.revalidation.second',
      decision: 'approved',
      validationSummaryHash: freshHash,
    });
    await governance.activate({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'activate-revalidation-second',
      artifactKey: candidate.artifact.artifactKey,
      expectedLockVersion: 1,
      validationSummaryHash: freshHash,
    });
    await governance.killSwitch({
      context: commandBase(candidate.artifact).context,
      scope: { artifactKey: candidate.artifact.artifactKey },
      expectedVersion: 2,
      idempotencyKey: 'kill-revalidation-artifact',
      reason: 'Exercise emergency deactivation.',
      occurredAt: '2026-07-26T00:06:00.000Z',
    });

    const next = nextVersion(candidate);
    await repository.saveCandidate(next);
    const nextHash = await validateAndApprove(governance, validation, next.artifact, 'post-kill');
    await expect(
      governance.activate({
        ...commandBase(next.artifact),
        idempotencyKey: 'activate-post-kill-stale-cas',
        artifactKey: next.artifact.artifactKey,
        expectedLockVersion: 0,
        validationSummaryHash: nextHash,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CAS_CONFLICT' });
    await governance.activate({
      ...commandBase(next.artifact),
      idempotencyKey: 'activate-post-kill-current-cas',
      artifactKey: next.artifact.artifactKey,
      expectedLockVersion: 3,
      validationSummaryHash: nextHash,
    });
    await expect(repository.findActiveIndex({})).resolves.toEqual([
      expect.objectContaining({
        artifactId: next.artifact.artifactId,
        pointerLockVersion: 4,
      }),
    ]);
  });

  it('binds trusted tenant identity even when request context omits tenant', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const candidate = tenantCandidate(candidatePersistence(), 'tenant-b');
    await repository.saveCandidate(candidate);
    const identity = new ConfiguredOperatorIdentityPort({
      environment: 'production',
      provider: {
        resolve: () =>
          Promise.resolve({
            operatorId: 'tenant-a-operator',
            tenantId: 'tenant-a',
            permissions: new Set(['artifact.validate']),
          }),
      },
    });
    const governance = new DefaultArtifactGovernanceService({
      identity,
      repository,
      store: new PostgresArtifactGovernanceStore(pool),
      audit: new CognitiveManagementActionGate({
        repository: new PostgresCognitiveManagementActionRepository(pool),
        clock: { now: () => '2026-07-26T00:01:00.000Z' },
      }),
    });

    await expect(
      governance.requestValidation({
        ...commandBase(candidate.artifact),
        context: {},
        validationRunId: 'validation.cross-tenant',
        validationType: 'static',
        datasetRef: 'dataset.cross-tenant',
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_TENANT_SCOPE_DENIED' });
  });

  it('stores bounded execution and feedback records and deprecates through CAS', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const validation = new PostgresArtifactValidationRepository(pool);
    const execution = new PostgresArtifactExecutionRepository(pool);
    const governance = governanceService(repository);
    const candidate = candidatePersistence();
    await repository.saveCandidate(candidate);
    await governance.requestValidation({
      ...commandBase(candidate.artifact),
      validationRunId: 'validation.intent.inspect.execution',
      validationType: 'static',
      datasetRef: 'dataset.intent.inspect.execution',
    });
    await validation.appendResult({
      validationRunId: 'validation.intent.inspect.execution',
      status: 'passed',
      result: 'passed',
      metrics: {},
      counterexampleRefs: [],
      completedAt: '2026-07-26T00:02:00.000Z',
    });
    const summary = await validation.findPromotionSummary({
      artifactId: candidate.artifact.artifactId,
      version: candidate.artifact.version,
    });
    if (summary === undefined) throw new Error('Expected validation summary.');
    const validationSummaryHash = hashValidationSummary(summary);
    await governance.recordApproval({
      ...commandBase(candidate.artifact),
      approvalId: 'approval.intent.inspect.execution',
      decision: 'approved',
      validationSummaryHash,
    });
    await governance.activate({
      ...commandBase(candidate.artifact),
      artifactKey: candidate.artifact.artifactKey,
      expectedLockVersion: 0,
      validationSummaryHash,
    });
    await governance.activate({
      ...commandBase(candidate.artifact),
      artifactKey: candidate.artifact.artifactKey,
      expectedLockVersion: 0,
      validationSummaryHash,
    });

    const next = nextVersion(candidate);
    await repository.saveCandidate(next);
    await governance.requestValidation({
      ...commandBase(next.artifact),
      validationRunId: 'validation.intent.inspect.execution.v2',
      validationType: 'static',
      datasetRef: 'dataset.intent.inspect.execution.v2',
    });
    await validation.appendResult({
      validationRunId: 'validation.intent.inspect.execution.v2',
      status: 'passed',
      result: 'passed v2',
      metrics: {},
      counterexampleRefs: [],
      completedAt: '2026-07-26T00:02:30.000Z',
    });
    const nextSummary = await validation.findPromotionSummary({
      artifactId: next.artifact.artifactId,
      version: next.artifact.version,
    });
    if (nextSummary === undefined) throw new Error('Expected v2 validation summary.');
    const nextSummaryHash = hashValidationSummary(nextSummary);
    await governance.recordApproval({
      ...commandBase(next.artifact),
      approvalId: 'approval.intent.inspect.execution.v2',
      decision: 'approved',
      validationSummaryHash: nextSummaryHash,
    });
    await governance.activate({
      ...commandBase(next.artifact),
      artifactKey: next.artifact.artifactKey,
      expectedLockVersion: 1,
      validationSummaryHash: nextSummaryHash,
    });
    await governance.rollback({
      ...commandBase(next.artifact),
      artifactKey: next.artifact.artifactKey,
      targetArtifactId: candidate.artifact.artifactId,
      targetVersion: candidate.artifact.version,
      expectedLockVersion: 2,
      validationSummaryHash,
    });
    await expect(repository.findActiveIndex({})).resolves.toEqual([
      expect.objectContaining({
        artifactId: candidate.artifact.artifactId,
        artifactVersion: 1,
        pointerLockVersion: 3,
      }),
    ]);

    await expect(
      execution.start({
        artifactExecutionId: 'artifact-execution-intent-1',
        artifactId: candidate.artifact.artifactId,
        version: candidate.artifact.version,
        taskId: 'task-artifact-1',
        mode: 'advisory',
        decisionSnapshot: { selected: true },
        startedAt: '2026-07-26T00:03:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'started' });
    await execution.complete({
      artifactExecutionId: 'artifact-execution-intent-1',
      status: 'completed',
      completedAt: '2026-07-26T00:04:00.000Z',
    });
    await execution.appendFeedback({
      feedbackId: 'artifact-feedback-intent-1',
      artifactExecutionId: 'artifact-execution-intent-1',
      artifactId: candidate.artifact.artifactId,
      feedbackType: 'operator',
      reasonCode: 'accepted',
      summary: 'Artifact route was accepted.',
      impact: { latencySavedMs: 20 },
      createdAt: '2026-07-26T00:05:00.000Z',
    });
    await execution.appendFeedback({
      feedbackId: 'artifact-feedback-intent-2',
      artifactExecutionId: 'artifact-execution-intent-1',
      artifactId: candidate.artifact.artifactId,
      feedbackType: 'outcome',
      reasonCode: 'confirmed',
      summary: 'A second feedback observation was retained.',
      impact: { qualityDelta: 0.1 },
      createdAt: '2026-07-26T00:05:30.000Z',
    });

    await expect(
      governance.deprecate({
        ...commandBase(candidate.artifact),
        expectedVersion: 999,
        idempotencyKey: 'deprecate-wrong-artifact-version',
        artifactKey: candidate.artifact.artifactKey,
        expectedLockVersion: 3,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_EXPECTED_VERSION_CONFLICT' });
    await governance.deprecate({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'deprecate-current-artifact-version',
      artifactKey: candidate.artifact.artifactKey,
      expectedLockVersion: 3,
    });
    await expect(repository.findActiveIndex({})).resolves.toEqual([]);
    const rows = await pool.query<{ status: string }>(
      `SELECT status FROM artifact_execution WHERE artifact_execution_id=$1`,
      ['artifact-execution-intent-1'],
    );
    expect(rows.rows).toEqual([{ status: 'completed' }]);
    const executionEvents = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM cognitive_runtime_outbox
       WHERE aggregate_type='artifact_execution' AND aggregate_id=$1
       ORDER BY aggregate_version`,
      ['artifact-execution-intent-1'],
    );
    expect(executionEvents.rows.map((row) => row.event_type)).toEqual([
      'artifact.execution_started',
      'artifact.execution_completed',
    ]);
    const feedbackEvents = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM cognitive_runtime_outbox
       WHERE aggregate_type='artifact_feedback'`,
    );
    expect(feedbackEvents.rows).toEqual([
      { event_type: 'artifact.feedback_recorded' },
      { event_type: 'artifact.feedback_recorded' },
    ]);
    const outboxConsumer = new PostgresArtifactOutboxConsumerRepository(pool);
    const events = await outboxConsumer.readAfter(undefined, 500);
    expect(events.length).toBeGreaterThanOrEqual(10);
    const first = events[0];
    if (first === undefined) throw new Error('Expected Artifact Outbox event.');
    await outboxConsumer.advanceCursor(
      'p02-artifact-evidence',
      0,
      first.eventId,
      '2026-07-26T00:06:00.000Z',
    );
    await expect(outboxConsumer.loadCursor('p02-artifact-evidence')).resolves.toEqual({
      lastEventId: first.eventId,
      version: 1,
    });
    expect(await outboxConsumer.readAfter(first.eventId, 500)).toHaveLength(events.length - 1);
    await pool.query(
      `INSERT INTO cognitive_runtime_outbox(
         event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         correlation,payload,occurred_at,published_at)
       VALUES(
         'artifact-late-event','artifact.deprecated','compiled_artifact',
         'artifact-late',1,'{}'::jsonb,'{}'::jsonb,'2000-01-01T00:00:00.000Z',NULL
       )`,
    );
    await expect(outboxConsumer.readAfter(first.eventId, 500)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventId: 'artifact-late-event' })]),
    );
  });
});

function candidatePersistence() {
  const artifact = structuredClone(fixture.artifacts[0]);
  if (artifact === undefined) throw new Error('Missing Artifact fixture.');
  const lineage: ArtifactLineage = {
    ...structuredClone(fixture.lineage),
    lineageId: artifact.lineageRef,
    artifactId: artifact.artifactId,
    artifactVersion: artifact.version,
    validationRunRefs: [],
  };
  const runtimeBinding = {
    ...structuredClone(fixture.runtimeBinding),
    artifactId: artifact.artifactId,
    artifactVersion: artifact.version,
  };
  return { artifact, lineage, runtimeBinding };
}

function nextVersion(candidate: ReturnType<typeof candidatePersistence>) {
  const artifact: CompiledArtifact = {
    ...structuredClone(candidate.artifact),
    artifactId: 'artifact.intent.inspect.2',
    version: 2,
    lineageRef: 'lineage.intent.inspect.2',
    contentHash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    createdAt: '2026-07-26T00:02:15.000Z',
  };
  const lineage: ArtifactLineage = {
    ...structuredClone(candidate.lineage),
    lineageId: artifact.lineageRef,
    artifactId: artifact.artifactId,
    artifactVersion: artifact.version,
    supersedesArtifactRefs: [
      `${candidate.artifact.artifactId}@${String(candidate.artifact.version)}`,
    ],
  };
  const runtimeBinding: ArtifactRuntimeBinding = {
    ...structuredClone(candidate.runtimeBinding),
    bindingId: 'binding.intent.inspect.2',
    artifactId: artifact.artifactId,
    artifactVersion: artifact.version,
    compiledAt: artifact.createdAt,
  };
  return { artifact, lineage, runtimeBinding };
}

function tenantCandidate(
  candidate: ReturnType<typeof candidatePersistence>,
  tenantId: string,
): ReturnType<typeof candidatePersistence> {
  const artifact: CompiledArtifact = {
    ...structuredClone(candidate.artifact),
    artifactId: `artifact.tenant.${tenantId}.1`,
    artifactKey: `tenant.${tenantId}.inspect`,
    scope: { ...structuredClone(candidate.artifact.scope), tenantId },
    lineageRef: `lineage.tenant.${tenantId}.1`,
    contentHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  };
  return {
    artifact,
    lineage: {
      ...structuredClone(candidate.lineage),
      lineageId: artifact.lineageRef,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
    },
    runtimeBinding: {
      ...structuredClone(candidate.runtimeBinding),
      bindingId: `binding.tenant.${tenantId}.1`,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
    },
  };
}

async function validateAndApprove(
  governance: ReturnType<typeof governanceService>,
  validation: PostgresArtifactValidationRepository,
  artifact: CompiledArtifact,
  suffix: string,
): Promise<string> {
  await governance.requestValidation({
    ...commandBase(artifact),
    idempotencyKey: `validate-${suffix}`,
    validationRunId: `validation.${suffix}`,
    validationType: 'static',
    datasetRef: `dataset.${suffix}`,
  });
  await validation.appendResult({
    validationRunId: `validation.${suffix}`,
    status: 'passed',
    result: `passed ${suffix}`,
    metrics: {},
    counterexampleRefs: [],
    completedAt: '2026-07-26T00:07:00.000Z',
  });
  const summary = await validation.findPromotionSummary(artifact);
  if (summary === undefined) throw new Error(`Expected ${suffix} validation summary.`);
  const summaryHash = hashValidationSummary(summary);
  await governance.recordApproval({
    ...commandBase(artifact),
    idempotencyKey: `approve-${suffix}`,
    approvalId: `approval.${suffix}`,
    decision: 'approved',
    validationSummaryHash: summaryHash,
  });
  return summaryHash;
}

function governanceService(repository: PostgresArtifactRepository) {
  const auditRepository = new PostgresCognitiveManagementActionRepository(pool);
  return new DefaultArtifactGovernanceService({
    identity: new ConfiguredOperatorIdentityPort({ environment: 'test' }),
    repository,
    store: new PostgresArtifactGovernanceStore(pool),
    audit: new CognitiveManagementActionGate({
      repository: auditRepository,
      clock: { now: () => '2026-07-26T00:01:00.000Z' },
    }),
  });
}

function commandBase(artifact: CompiledArtifact) {
  return {
    artifactId: artifact.artifactId,
    version: artifact.version,
    context: {
      operatorId: 'operator-artifact-admin',
      permissions: [
        'artifact.validate',
        'artifact.approve',
        'artifact.activate',
        'artifact.revalidate',
        'artifact.deprecate',
        'artifact.rollback',
        'artifact.kill_switch',
      ] as const,
    },
    expectedVersion: artifact.version,
    idempotencyKey: `govern-${artifact.artifactId}`,
    reason: 'P02 integration evidence',
    occurredAt: '2026-07-26T00:01:00.000Z',
  };
}
