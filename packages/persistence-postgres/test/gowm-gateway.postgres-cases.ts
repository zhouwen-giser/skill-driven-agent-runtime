import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  createGatewayDecisionRecord,
  hashGatewayDecision,
  hashRuntimeRequestContext,
  type RuntimeExecutionDecision,
  type RuntimeRequestContext,
} from '../../domain/src/index.js';
import { PostgresFastGatewayRepository } from '../src/index.js';

export async function verifyGowmGatewayCases(
  pool: Pool,
  scope: DeviceWorkScope,
  run: string,
): Promise<string[]> {
  const at = new Date().toISOString();
  const prefix = randomUUID();
  const a = scope.allowedDeviceIds[0];
  assert.ok(a);
  const all = new PostgresFastGatewayRepository(pool, scope);
  const onlyA = new PostgresFastGatewayRepository(pool, { ...scope, allowedDeviceIds: [a] });
  const inputs = [0, 1].map((index) => {
    const id = `${prefix}-${String(index)}`;
    const context: RuntimeRequestContext = {
      requestId: id,
      taskId: `${run}-task-${String(index)}`,
      contextId: `${run}-context`,
      rawText: 'read status',
      normalizedText: 'read status',
      actor: {
        actorId: prefix,
        tenantId: prefix,
        authenticationRef: 'fixture',
        authorizationRefs: ['read'],
      },
      extractedFeatures: { domain: 'device' },
      worldStateRef: 'fixture',
      capabilitySummaryRef: 'fixture',
      policySnapshotRef: 'fixture',
      deadlineAt: new Date(Date.parse(at) + 60000).toISOString(),
      cancellationRef: id,
      idempotencyKey: id,
      createdAt: at,
    };
    return persistenceInputFor(context, `${id}-decision`, `${id}-runtime`);
  });
  for (const input of inputs) {
    await all.save(input);
    await all.save(input);
  }
  const [first, second] = inputs;
  assert.ok(first && second);
  const rows = await pool.query<{ device_id: string }>(
    'SELECT device_id FROM fast_gateway_request WHERE request_id=ANY($1::text[]) ORDER BY task_id',
    [inputs.map((input) => input.context.requestId)],
  );
  assert.deepEqual(
    rows.rows.map((row) => row.device_id),
    scope.allowedDeviceIds,
  );
  assert.ok(await onlyA.findByTaskId(first.context.taskId));
  assert.equal(await onlyA.findByTaskId(second.context.taskId), undefined);
  assert.equal(await onlyA.findByIdempotencyKey(second.idempotencyKey), undefined);
  await assert.rejects(onlyA.save(second), { code: 'GATEWAY_TASK_DEVICE_SCOPE_DENIED' });
  await assert.rejects(
    all.save({ ...first, context: { ...first.context, contextId: 'wrong-context' } }),
    { code: 'GATEWAY_TASK_DEVICE_SCOPE_DENIED' },
  );
  const feedback = {
    feedbackId: `${prefix}-feedback`,
    requestId: first.context.requestId,
    gatewayDecisionRef: first.record.gatewayDecisionId,
    selectedArtifactRefs: [],
    feedbackType: 'performance' as const,
    payload: { latencyMs: 1 },
    sourceRefs: [],
    createdAt: at,
  };
  await onlyA.appendFeedback(feedback);
  await onlyA.appendFeedback(feedback);
  await assert.rejects(
    onlyA.appendFeedback({
      ...feedback,
      feedbackId: `${prefix}-foreign`,
      requestId: second.context.requestId,
      gatewayDecisionRef: second.record.gatewayDecisionId,
    }),
    { code: 'GATEWAY_TASK_DEVICE_SCOPE_DENIED' },
  );
  await assert.rejects(
    all.appendFeedback({
      ...feedback,
      feedbackId: `${prefix}-cross-request`,
      gatewayDecisionRef: second.record.gatewayDecisionId,
    }),
    { code: 'GATEWAY_TASK_DEVICE_SCOPE_DENIED' },
  );
  assert.equal(await onlyA.deleteActorScope(prefix), 1);
  assert.equal(await all.findByIdempotencyKey(first.idempotencyKey), undefined);
  assert.ok(await all.findByIdempotencyKey(second.idempotencyKey));
  assert.equal(await onlyA.deleteActorScope(prefix), 0);
  assert.equal(
    (
      await pool.query('SELECT 1 FROM agent_task WHERE task_id=ANY($1::text[])', [
        inputs.map((input) => input.context.taskId),
      ])
    ).rowCount,
    2,
  );
  return [
    'Gateway native device attribution, scoped reads/idempotency, context rejection and explicit actor deletion preserve the other device and both Tasks',
  ];
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
