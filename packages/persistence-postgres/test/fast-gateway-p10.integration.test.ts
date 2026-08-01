import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { P02GatewayArtifactFeedbackAdapter } from '../../application/src/index.js';
import {
  createGatewayDecisionRecord,
  hashGatewayDecision,
  hashRuntimeRequestContext,
  type RuntimeExecutionDecision,
  type RuntimeRequestContext,
  type ArtifactLineage,
  type ArtifactRuntimeBinding,
  type CompiledArtifact,
} from '../../domain/src/index.js';
import {
  PostgresArtifactRepository,
  PostgresFastGatewayRepository,
  PostgresRuleUsageRepository,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
let artifactFixture: Readonly<{
  artifacts: readonly CompiledArtifact[];
  lineage: ArtifactLineage;
  runtimeBinding: ArtifactRuntimeBinding;
}>;

beforeAll(async () => {
  artifactFixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as typeof artifactFixture;
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE fast_gateway_feedback,fast_gateway_decision,fast_gateway_request,
       artifact_feedback,artifact_execution,compiled_artifact,artifact_lineage,
       cognitive_runtime_outbox CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P10 PostgreSQL Gateway evidence authority', () => {
  it('persists one idempotent route and transactional Outbox event', async () => {
    const repository = new PostgresFastGatewayRepository(pool);
    const input = persistenceInput();
    await repository.save(input);
    await repository.save(input);

    await expect(repository.findByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      requestHash: input.requestHash,
      decision: { path: 'cognitive_runtime' },
      record: { gatewayDecisionId: 'gateway-decision-1' },
    });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM fast_gateway_request) AS requests,
           (SELECT count(*)::integer FROM fast_gateway_decision) AS decisions,
           (SELECT count(*)::integer FROM cognitive_runtime_outbox
              WHERE event_id='gateway-route-gateway-decision-1') AS outbox`,
      ),
    ).resolves.toMatchObject({
      rows: [{ requests: 1, decisions: 1, outbox: 1 }],
    });
  });

  it('rejects idempotency-key drift', async () => {
    const repository = new PostgresFastGatewayRepository(pool);
    const input = persistenceInput();
    await repository.save(input);
    await expect(
      repository.save({
        ...input,
        requestHash: `sha256:${'f'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({
      code: 'GATEWAY_IDEMPOTENCY_CONFLICT',
    });
  });

  it('records exact feedback once and emits an outcome-safe Outbox projection', async () => {
    const repository = new PostgresFastGatewayRepository(pool);
    const input = persistenceInput();
    await repository.save(input);
    const feedback = {
      feedbackId: 'gateway-feedback-1',
      requestId: input.context.requestId,
      gatewayDecisionRef: input.record.gatewayDecisionId,
      selectedArtifactRefs: [],
      formalOutcomeRef: 'formal-outcome-1',
      feedbackType: 'outcome' as const,
      payload: { status: 'succeeded', latencyMs: 42 },
      sourceRefs: ['artifact_execution:execution-1'],
      createdAt: '2026-07-30T00:00:01.000Z',
    };
    await repository.appendFeedback(feedback);
    await repository.appendFeedback(feedback);

    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM fast_gateway_feedback) AS feedback,
           (SELECT count(*)::integer FROM cognitive_runtime_outbox
             WHERE event_id='gateway-feedback-gateway-feedback-1') AS outbox,
           (SELECT feedback_envelope->>'formalOutcomeRef'
             FROM fast_gateway_feedback WHERE feedback_id='gateway-feedback-1') AS outcome_ref`,
      ),
    ).resolves.toMatchObject({
      rows: [{ feedback: 1, outbox: 1, outcome_ref: 'formal-outcome-1' }],
    });

    await expect(
      repository.appendFeedback({
        ...feedback,
        payload: { status: 'failed' },
      }),
    ).rejects.toMatchObject({
      code: 'GATEWAY_FEEDBACK_IDEMPOTENCY_CONFLICT',
    });
  });

  it('links a selected Artifact outcome through P02 execution/feedback authority', async () => {
    const artifact = artifactFixture.artifacts.find(
      (candidate) => candidate.artifactType === 'decision_rule',
    );
    if (artifact === undefined) throw new Error('Decision Rule fixture missing.');
    const candidate: CompiledArtifact = { ...artifact, status: 'candidate' };
    await new PostgresArtifactRepository(pool).saveCandidate({
      artifact: candidate,
      lineage: {
        ...structuredClone(artifactFixture.lineage),
        lineageId: candidate.lineageRef,
        artifactId: candidate.artifactId,
        artifactVersion: candidate.version,
        validationRunRefs: [],
      },
      runtimeBinding: {
        ...structuredClone(artifactFixture.runtimeBinding),
        artifactId: candidate.artifactId,
        artifactVersion: candidate.version,
      },
    });
    const usage = new PostgresRuleUsageRepository(pool);
    await usage.startOrLoad({
      artifactExecutionId: 'execution-p10-1',
      artifactId: candidate.artifactId,
      version: candidate.version,
      taskId: 'task-1',
      mode: 'gateway_selected_artifact',
      decisionSnapshot: { gatewayDecisionRef: 'gateway-decision-1' },
      startedAt: '2026-07-30T00:00:00.000Z',
    });
    await new P02GatewayArtifactFeedbackAdapter(usage).record({
      feedbackId: 'feedback-p10-p02-1',
      requestId: 'request-1',
      gatewayDecisionRef: 'gateway-decision-1',
      selectedArtifactRefs: [`${candidate.artifactId}:${String(candidate.version)}`],
      formalOutcomeRef: 'outcome-1',
      feedbackType: 'outcome',
      payload: { status: 'succeeded' },
      sourceRefs: ['artifact_execution:execution-p10-1'],
      createdAt: '2026-07-30T00:00:01.000Z',
    });

    await expect(
      pool.query(
        `SELECT feedback_type,outcome_ref
         FROM artifact_feedback
         WHERE feedback_id='p10-artifact-feedback:feedback-p10-p02-1'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ feedback_type: 'gateway_outcome', outcome_ref: 'outcome-1' }],
    });
    await expect(
      pool.query(
        `SELECT count(*)::integer AS count
         FROM cognitive_runtime_outbox
         WHERE aggregate_type='artifact_feedback'
           AND aggregate_id='p10-artifact-feedback:feedback-p10-p02-1'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it('deletes only the requested actor scope and cascades Gateway child evidence', async () => {
    const repository = new PostgresFastGatewayRepository(pool);
    const first = persistenceInput();
    await repository.save(first);
    const secondContext: RuntimeRequestContext = {
      ...first.context,
      requestId: 'request-2',
      taskId: 'task-2',
      idempotencyKey: 'idempotency-2',
      actor: { ...first.context.actor, actorId: 'actor-2' },
    };
    const second = persistenceInputFor(secondContext, 'gateway-decision-2', 'runtime-decision-2');
    await repository.save(second);
    await repository.appendFeedback({
      feedbackId: 'delete-feedback-1',
      requestId: first.context.requestId,
      gatewayDecisionRef: first.record.gatewayDecisionId,
      selectedArtifactRefs: [],
      feedbackType: 'performance',
      payload: { latencyMs: 1 },
      sourceRefs: ['gateway-decision:1'],
      createdAt: '2026-07-30T00:00:01.000Z',
    });
    await repository.appendFeedback({
      feedbackId: 'delete-feedback-2',
      requestId: second.context.requestId,
      gatewayDecisionRef: second.record.gatewayDecisionId,
      selectedArtifactRefs: [],
      feedbackType: 'performance',
      payload: { latencyMs: 2 },
      sourceRefs: ['gateway-decision:2'],
      createdAt: '2026-07-30T00:00:02.000Z',
    });
    await expect(repository.deleteActorScope('actor-1')).resolves.toBe(1);
    await expect(
      pool.query(
        `SELECT request_context#>>'{actor,actorId}' AS actor_id
         FROM fast_gateway_request ORDER BY request_id`,
      ),
    ).resolves.toMatchObject({ rows: [{ actor_id: 'actor-2' }] });
    await expect(
      pool.query(`SELECT count(*)::integer AS count FROM fast_gateway_decision`),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    await expect(
      pool.query(
        `SELECT aggregate_id FROM cognitive_runtime_outbox
         WHERE aggregate_type='fast_gateway_decision'
         ORDER BY aggregate_id`,
      ),
    ).resolves.toMatchObject({ rows: [{ aggregate_id: 'gateway-decision-2' }] });
    await expect(
      pool.query(
        `SELECT aggregate_id FROM cognitive_runtime_outbox
         WHERE aggregate_type='fast_gateway_feedback'
         ORDER BY aggregate_id`,
      ),
    ).resolves.toMatchObject({ rows: [{ aggregate_id: 'delete-feedback-2' }] });
  });
});

function persistenceInput() {
  const context: RuntimeRequestContext = {
    requestId: 'request-1',
    taskId: 'task-1',
    contextId: 'context-1',
    rawText: 'inspect status',
    normalizedText: 'inspect status',
    actor: {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      authenticationRef: 'auth:1',
      authorizationRefs: ['authorization:read'],
    },
    extractedFeatures: { domain: 'device' },
    worldStateRef: 'world:1',
    capabilitySummaryRef: 'capability:1',
    policySnapshotRef: 'policy:1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    cancellationRef: 'cancel:1',
    idempotencyKey: 'idempotency-1',
    createdAt: '2026-07-30T00:00:00.000Z',
  };
  return persistenceInputFor(context, 'gateway-decision-1', 'runtime-decision-1');
}

function persistenceInputFor(
  context: RuntimeRequestContext,
  gatewayDecisionId: string,
  runtimeDecisionId: string,
) {
  const decision: RuntimeExecutionDecision = {
    decisionId: runtimeDecisionId,
    requestId: context.requestId,
    path: 'cognitive_runtime',
    parameterBindings: {},
    missingParameters: [],
    requiredConfirmations: [],
    reasonCodes: ['GATEWAY_ARTIFACT_NO_MATCH'],
    matcherSnapshotHash: `sha256:${'a'.repeat(64)}`,
    policySnapshotHash: `sha256:${'b'.repeat(64)}`,
    createdAt: context.createdAt,
  };
  const unsigned = {
    requestId: context.requestId,
    runtimeDecisionRef: decision.decisionId,
    stageResults: [
      {
        stage: 'precheck' as const,
        status: 'succeeded' as const,
        reasonCodes: ['GATEWAY_AUTHENTICATED' as const],
        startedAt: context.createdAt,
        completedAt: context.createdAt,
      },
      {
        stage: 'fallback' as const,
        status: 'succeeded' as const,
        reasonCodes: ['GATEWAY_COGNITIVE_FALLBACK' as const],
        startedAt: context.createdAt,
        completedAt: context.createdAt,
      },
    ],
    fallbackRef: 'fallback-1',
    reasonCodes: ['GATEWAY_ARTIFACT_NO_MATCH' as const, 'GATEWAY_COGNITIVE_FALLBACK' as const],
    runtimeSnapshotHash: `sha256:${'c'.repeat(64)}`,
  };
  const record = createGatewayDecisionRecord({
    gatewayDecisionId,
    ...unsigned,
    decisionHash: hashGatewayDecision(unsigned),
    createdAt: context.createdAt,
  });
  return {
    idempotencyKey: context.idempotencyKey,
    requestHash: hashRuntimeRequestContext(context),
    context,
    decision,
    record,
  };
}
