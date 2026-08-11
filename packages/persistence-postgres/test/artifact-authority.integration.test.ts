import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations, startServerRuntime } from '../../../apps/server/src/runtime.js';
import {
  ArtifactOutboxConsumer,
  ArtifactRegistryProjectionEventHandler,
  ArtifactRegistryService,
  CognitiveManagementActionGate,
  ConfiguredOperatorIdentityPort,
  DefaultArtifactGovernanceService,
  InMemoryArtifactActiveIndexProjection,
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
    await expect(
      pool.query(
        `UPDATE artifact_lineage
         SET source_episode_refs='["drift"]'::jsonb,created_at=created_at+interval '1 second'
         WHERE artifact_id=$1`,
        [candidate.artifact.artifactId],
      ),
    ).rejects.toBeDefined();
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
    const rolledBackAudit = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM cognitive_management_action
        WHERE operation='artifact_activate' AND idempotency_key=$1`,
      [commandBase(candidate.artifact).idempotencyKey],
    );
    expect(rolledBackAudit.rows).toEqual([{ count: 0 }]);

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
    const evidence = await pool.query<{
      operation: string;
      status: string;
      result: unknown;
      error_code: string | null;
      lease_owner: string | null;
      lease_expires_at: Date | null;
      lease_attempt: number;
      lease_token: string | null;
      execution_phase: string;
      provider_dispatch_id: string | null;
      provider_dispatch_hash: string | null;
    }>(
      `SELECT operation,status,result,error_code,lease_owner,lease_expires_at,lease_attempt,
              lease_token,execution_phase,provider_dispatch_id,provider_dispatch_hash
         FROM cognitive_management_action
       WHERE operation='artifact_activate'`,
    );
    expect(evidence.rows).toEqual([
      {
        operation: 'artifact_activate',
        status: 'completed',
        result: {
          artifactId: candidate.artifact.artifactId,
          artifactVersion: candidate.artifact.version,
          artifactKey: candidate.artifact.artifactKey,
          status: 'active',
        },
        error_code: null,
        lease_owner: null,
        lease_expires_at: null,
        lease_attempt: 0,
        lease_token: null,
        execution_phase: 'terminal',
        provider_dispatch_id: null,
        provider_dispatch_hash: null,
      },
    ]);
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

  it('invalidates cached versions across validation and rejected approval lifecycle events', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const validation = new PostgresArtifactValidationRepository(pool);
    const governance = governanceService(repository);
    const registry = new ArtifactRegistryService({
      repository,
      projection: new InMemoryArtifactActiveIndexProjection(),
    });
    const consumer = new ArtifactOutboxConsumer({
      consumerName: 'artifact-version-cache-regression',
      repository: new PostgresArtifactOutboxConsumerRepository(pool),
      handler: new ArtifactRegistryProjectionEventHandler(registry),
      clock: { now: () => '2026-07-26T00:10:00.000Z' },
    });
    const candidate = candidatePersistence();
    await repository.saveCandidate(candidate);
    await expect(registry.getVersion(candidate.artifact)).resolves.toMatchObject({
      status: 'candidate',
    });

    await governance.requestValidation({
      ...commandBase(candidate.artifact),
      validationRunId: 'validation.cache.lifecycle',
      validationType: 'static',
      datasetRef: 'dataset.cache.lifecycle',
    });
    await expect(consumer.consume()).resolves.toBe(1);
    await expect(registry.getVersion(candidate.artifact)).resolves.toMatchObject({
      status: 'validating',
    });

    await validation.appendResult({
      validationRunId: 'validation.cache.lifecycle',
      status: 'passed',
      result: 'cache lifecycle passed',
      metrics: {},
      counterexampleRefs: [],
      completedAt: '2026-07-26T00:11:00.000Z',
    });
    await expect(consumer.consume()).resolves.toBe(1);
    await expect(registry.getVersion(candidate.artifact)).resolves.toMatchObject({
      status: 'awaiting_approval',
      validationSummaryRef: 'validation.cache.lifecycle',
    });
    const summary = await validation.findPromotionSummary(candidate.artifact);
    if (summary === undefined) throw new Error('Expected cache validation summary.');
    await governance.recordApproval({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'approval-cache-lifecycle-rejected',
      approvalId: 'approval.cache.lifecycle.rejected',
      decision: 'rejected',
      validationSummaryHash: hashValidationSummary(summary),
    });
    await expect(consumer.consume()).resolves.toBe(1);
    await expect(registry.getVersion(candidate.artifact)).resolves.toMatchObject({
      status: 'rejected',
    });
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
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => event.eventType === 'artifact.approval_recorded')).toBe(true);
    expect(events.some((event) => event.eventType === 'artifact.execution_started')).toBe(false);
    expect(events.some((event) => event.eventType === 'artifact.feedback_recorded')).toBe(false);
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
    const sharedPublication = await pool.query<{ published_at: Date | null }>(
      `SELECT published_at FROM cognitive_runtime_outbox
       WHERE event_type='artifact.approval_recorded'
       ORDER BY occurred_at LIMIT 1`,
    );
    expect(sharedPublication.rows[0]?.published_at).toBeNull();
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

  it('rebuilds the real startup projection without claiming shared Outbox publication', async () => {
    const repository = new PostgresArtifactRepository(pool);
    const validation = new PostgresArtifactValidationRepository(pool);
    const governance = governanceService(repository);
    const candidate = candidatePersistence();
    await repository.saveCandidate(candidate);
    const validationSummaryHash = await validateAndApprove(
      governance,
      validation,
      candidate.artifact,
      'startup-projection',
    );
    await governance.activate({
      ...commandBase(candidate.artifact),
      idempotencyKey: 'activate-startup-projection',
      artifactKey: candidate.artifact.artifactKey,
      expectedLockVersion: 0,
      validationSummaryHash,
    });
    await pool.query(
      `INSERT INTO cognitive_runtime_outbox(
         event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         correlation,payload,occurred_at,published_at)
       VALUES(
         'artifact-startup-unhandled-execution','artifact.execution_started',
         'artifact_execution','execution.startup',1,'{}'::jsonb,
         '{"artifactId":"artifact.intent.inspect.1"}'::jsonb,
         '2026-07-26T00:08:00.000Z',NULL
       )`,
    );

    const runtime = await (async () => {
      const previousRegistry = process.env['SDAR_V13_REGISTRY_ENABLED'];
      process.env['SDAR_V13_REGISTRY_ENABLED'] = 'true';
      try {
        return await startServerRuntime({
          postgresUrl: connectionString,
          redis: {
            host: '127.0.0.1',
            port: Number(process.env['SDAR_REDIS_PORT'] ?? '56379'),
          },
          masterKeyBase64: randomBytes(32).toString('base64'),
          queueName: `artifact-startup-${randomUUID()}`,
          applyMigrations: false,
          a2aPort: 0,
          managementPort: 0,
        });
      } finally {
        if (previousRegistry === undefined) {
          Reflect.deleteProperty(process.env, 'SDAR_V13_REGISTRY_ENABLED');
        } else {
          process.env['SDAR_V13_REGISTRY_ENABLED'] = previousRegistry;
        }
      }
    })();
    try {
      await expect(runtime.artifactRegistry?.queryActiveIndex({})).resolves.toEqual([
        expect.objectContaining({
          artifactId: candidate.artifact.artifactId,
          pointerLockVersion: 1,
        }),
      ]);
      const publication = await pool.query<{ published: number; unpublished: number }>(
        `SELECT
           count(*) FILTER (WHERE published_at IS NOT NULL)::integer AS published,
           count(*) FILTER (WHERE published_at IS NULL)::integer AS unpublished
         FROM cognitive_runtime_outbox
         WHERE event_type LIKE 'artifact.%'
            OR event_type LIKE 'compiler.artifact_%'`,
      );
      expect(publication.rows).toEqual([
        expect.objectContaining({ published: 0, unpublished: expect.any(Number) }),
      ]);
      expect(publication.rows[0]?.unpublished).toBeGreaterThan(0);
    } finally {
      await runtime.close();
    }
  }, 30_000);

  it('serializes relevant Outbox allocation through commit before advancing a cursor', async () => {
    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    let firstOpen = false;
    let secondOpen = false;
    try {
      await firstClient.query('BEGIN');
      firstOpen = true;
      await secondClient.query('BEGIN');
      secondOpen = true;
      const firstPid = await firstClient.query<{ pid: number }>(
        `SELECT pg_backend_pid()::integer AS pid`,
      );
      const secondPid = await secondClient.query<{ pid: number }>(
        `SELECT pg_backend_pid()::integer AS pid`,
      );
      const firstInsert = await firstClient.query<{ outbox_sequence: string }>(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES(
           'artifact-commit-order-first','artifact.deprecated','compiled_artifact',
           'artifact-commit-order-first',1,'{}'::jsonb,'{}'::jsonb,
           '2026-07-26T00:20:00.000Z',NULL
         )
         RETURNING outbox_sequence::text AS outbox_sequence`,
      );
      const secondInsertPromise = secondClient.query<{ outbox_sequence: string }>(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES(
           'artifact-commit-order-second','artifact.deprecated','compiled_artifact',
           'artifact-commit-order-second',1,'{}'::jsonb,'{}'::jsonb,
           '2000-01-01T00:00:00.000Z',NULL
         )
         RETURNING outbox_sequence::text AS outbox_sequence`,
      );
      const firstBackendPid = firstPid.rows[0]?.pid;
      const secondBackendPid = secondPid.rows[0]?.pid;
      if (firstBackendPid === undefined || secondBackendPid === undefined) {
        throw new Error('Expected PostgreSQL backend identifiers.');
      }
      await expect(waitUntilBlockedBy(secondBackendPid, firstBackendPid)).resolves.toBeUndefined();

      await firstClient.query('COMMIT');
      firstOpen = false;
      const secondInsert = await secondInsertPromise;
      await secondClient.query('COMMIT');
      secondOpen = false;

      expect(Number(secondInsert.rows[0]?.outbox_sequence)).toBe(
        Number(firstInsert.rows[0]?.outbox_sequence) + 1,
      );
      const consumer = new PostgresArtifactOutboxConsumerRepository(pool);
      const events = await consumer.readAfter(undefined, 10);
      expect(events.map((event) => event.eventId)).toEqual([
        'artifact-commit-order-first',
        'artifact-commit-order-second',
      ]);
      const first = events[0];
      if (first === undefined) throw new Error('Expected first commit-ordered event.');
      await consumer.advanceCursor(
        'p02-commit-order-evidence',
        0,
        first.eventId,
        '2026-07-26T00:21:00.000Z',
      );
      await expect(consumer.readAfter(first.eventId, 10)).resolves.toEqual([
        expect.objectContaining({ eventId: 'artifact-commit-order-second' }),
      ]);
    } finally {
      if (firstOpen) await firstClient.query('ROLLBACK');
      if (secondOpen) await secondClient.query('ROLLBACK');
      firstClient.release();
      secondClient.release();
    }
  });
});

async function waitUntilBlockedBy(blockedPid: number, blockerPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ blocked: boolean }>(
      `SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked`,
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error('Expected relevant Outbox insert to wait for the commit-order lock.');
}

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
