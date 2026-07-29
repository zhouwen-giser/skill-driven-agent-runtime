import { describe, expect, it } from 'vitest';

import {
  FAST_GATEWAY_CONTRACT_VERSION,
  FAST_GATEWAY_SCHEMA_HASHES,
  GATEWAY_REASON_CODES,
  FastGatewayDomainError,
  createGatewayDecisionRecord,
  createGatewayFeedbackEnvelope,
  createRuntimeRequestContext,
  hashGatewayDecision,
  hashRuntimeRequestContext,
  type GatewayDecisionRecord,
  type RuntimeRequestContext,
} from '../src/index.js';

const HASH = `sha256:${'a'.repeat(64)}`;

describe('P10 Fast Gateway Domain', () => {
  it('publishes the exact frozen V1.1 schema hashes', () => {
    expect(FAST_GATEWAY_CONTRACT_VERSION).toBe('1.1');
    expect(FAST_GATEWAY_SCHEMA_HASHES).toEqual({
      RuntimeRequestContext: '6ada60cdd637cd3a2467347c8ef858ce2932c5e56d891c7aaaf1dfaabc41595e',
      FastGateway: 'be8f17ffcf597a021a8758844521cf4ba43dd1537e0d74dc7be2116c91cc16fe',
      GatewayDecisionRecord: '1beecf8ae5527d5b8db7bcf89c36b4e73d35e083d6818f9ad18874f13e31d3ab',
      GatewayFeedbackEnvelope: '22faac79bc9ea9d8bcac5bc42e626bba79b5ed04579e371ba5dfadbc611aaf6b',
    });
  });

  it('freezes trusted request facts and produces a stable request hash', () => {
    const input = context();
    const first = createRuntimeRequestContext(input);
    const second = createRuntimeRequestContext(input);
    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.actor)).toBe(true);
    expect(Object.isFrozen(first.extractedFeatures)).toBe(true);
    expect(hashRuntimeRequestContext(first)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hashRuntimeRequestContext(first)).toBe(hashRuntimeRequestContext(second));
  });

  it('rejects a non-positive absolute deadline', () => {
    expect(() =>
      createRuntimeRequestContext({
        ...context(),
        deadlineAt: '2026-07-30T00:00:00.000Z',
      }),
    ).toThrow(FastGatewayDomainError);
  });

  it('rejects non-canonical timestamps', () => {
    expect(() =>
      createRuntimeRequestContext({
        ...context(),
        deadlineAt: '2026-07-30T00:01:00Z',
      }),
    ).toThrow(/canonical ISO/u);
  });

  it('bounds nested extracted features', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index < 10; index += 1) nested = { nested };
    expect(() =>
      createRuntimeRequestContext({
        ...context(),
        extractedFeatures: nested as RuntimeRequestContext['extractedFeatures'],
      }),
    ).toThrow(/max depth/u);
  });

  it('creates a canonical decision record and verifies its hash', () => {
    const unsigned = {
      requestId: 'request-1',
      runtimeDecisionRef: 'runtime-decision-1',
      stageResults: [
        {
          stage: 'precheck' as const,
          status: 'succeeded' as const,
          reasonCodes: ['GATEWAY_AUTHENTICATED' as const],
          startedAt: '2026-07-30T00:00:00.000Z',
          completedAt: '2026-07-30T00:00:00.001Z',
        },
      ],
      reasonCodes: ['GATEWAY_AUTHENTICATED' as const],
      runtimeSnapshotHash: HASH,
    };
    const record = createGatewayDecisionRecord({
      gatewayDecisionId: 'gateway-decision-1',
      ...unsigned,
      decisionHash: hashGatewayDecision(unsigned),
      createdAt: '2026-07-30T00:00:00.002Z',
    });
    expect(record.decisionHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(record.stageResults)).toBe(true);
  });

  it('rejects a forged decision hash', () => {
    expect(() =>
      createGatewayDecisionRecord({
        ...record(),
        decisionHash: HASH,
      }),
    ).toThrow(/decisionHash/u);
  });

  it('freezes bounded feedback without copying formal Outcome authority', () => {
    const feedback = createGatewayFeedbackEnvelope({
      feedbackId: 'feedback-1',
      requestId: 'request-1',
      gatewayDecisionRef: 'gateway-decision-1',
      selectedArtifactRefs: ['artifact-1:1'],
      formalGoalRef: 'goal-1',
      formalPlanRef: 'plan-1',
      formalOutcomeRef: 'outcome-1',
      feedbackType: 'outcome',
      payload: { status: 'succeeded', score: 0.9 },
      sourceRefs: ['artifact_execution:execution-1'],
      createdAt: '2026-07-30T00:02:00.000Z',
    });
    expect(feedback.formalOutcomeRef).toBe('outcome-1');
    expect(feedback.payload).toEqual({ status: 'succeeded', score: 0.9 });
    expect(Object.isFrozen(feedback.payload)).toBe(true);
  });

  it('contains only stable public reason codes', () => {
    expect(new Set(GATEWAY_REASON_CODES).size).toBe(GATEWAY_REASON_CODES.length);
    expect(GATEWAY_REASON_CODES).toContain('GATEWAY_DENIED');
    expect(GATEWAY_REASON_CODES).toContain('GATEWAY_DISCARDED_LATE');
    expect(GATEWAY_REASON_CODES).not.toContain('chain_of_thought');
  });
});

function context(): RuntimeRequestContext {
  return {
    requestId: 'request-1',
    taskId: 'task-1',
    contextId: 'context-1',
    rawText: '  inspect device status  ',
    normalizedText: 'inspect device status',
    actor: {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      authenticationRef: 'auth:request-1',
      authorizationRefs: ['authorization:device-read'],
    },
    extractedFeatures: { domain: 'device', taskTypeIds: ['inspect_status'] },
    worldStateRef: 'world-state:1',
    capabilitySummaryRef: 'capability-summary:1',
    policySnapshotRef: 'policy-snapshot:1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    cancellationRef: 'cancellation:request-1',
    idempotencyKey: 'idempotency-1',
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}

function record(): GatewayDecisionRecord {
  const unsigned = {
    requestId: 'request-1',
    runtimeDecisionRef: 'runtime-decision-1',
    stageResults: [
      {
        stage: 'precheck' as const,
        status: 'succeeded' as const,
        reasonCodes: ['GATEWAY_AUTHENTICATED' as const],
      },
    ],
    reasonCodes: ['GATEWAY_AUTHENTICATED' as const],
    runtimeSnapshotHash: HASH,
  };
  return {
    gatewayDecisionId: 'gateway-decision-1',
    ...unsigned,
    decisionHash: hashGatewayDecision(unsigned),
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}
