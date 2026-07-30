import { describe, expect, it, vi } from 'vitest';

import {
  FastGatewayService,
  type ArtifactRetrievalResult,
  type GatewayDecisionPersistence,
  type GatewayDriftSignalPort,
  type GatewayPrecheckResult,
  type GatewayRuleOutcome,
  type GatewayTemplateOutcome,
} from '../src/index.js';
import {
  type ArtifactIndexEntry,
  type GatewayDecisionRecord,
  type GatewayFeedbackEnvelope,
  type RuntimeExecutionDecision,
  type RuntimeRequestContext,
} from '../../domain/src/index.js';

const HASH = `sha256:${'a'.repeat(64)}`;

describe('P10 FastGatewayService', () => {
  it('preserves the cognitive path when the feature is disabled', async () => {
    const harness = createHarness({ precheck: { featureEnabled: false } });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('cognitive_runtime');
    expect(result.record.fallbackRef).toBe('fallback:request-1');
    expect(harness.calls.retrieval).toBe(0);
    expect(harness.calls.fallback).toBe(1);
  });

  it('terminates authorization denial without retrieval or fallback', async () => {
    const harness = createHarness({ precheck: { authorized: false } });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('denied');
    expect(result.decision.reasonCodes).toContain('GATEWAY_TENANT_DENIED');
    expect(harness.calls.retrieval).toBe(0);
    expect(harness.calls.fallback).toBe(0);
  });

  it('enforces Auth then Tenant then Authorization before policy state', async () => {
    const unauthenticated = createHarness({ precheck: { authenticated: false } });
    await unauthenticated.service.evaluateDetailed(context());
    expect(unauthenticated.calls.precheck).toEqual(['authentication']);

    const crossTenant = createHarness({ precheck: { tenantAuthorized: false } });
    await crossTenant.service.evaluateDetailed(context());
    expect(crossTenant.calls.precheck).toEqual(['authentication', 'tenant']);

    const unauthorized = createHarness({ precheck: { authorized: false } });
    await unauthorized.service.evaluateDetailed(context());
    expect(unauthorized.calls.precheck).toEqual(['authentication', 'tenant', 'authorization']);
  });

  it('routes policy confirmation to formal interaction rather than fallback', async () => {
    const harness = createHarness({
      precheck: { policyDecision: 'require_confirmation' },
    });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('human_input');
    expect(result.decision.requiredConfirmations).toContain('GATEWAY_POLICY_CONFIRM');
    expect(harness.calls.fallback).toBe(0);
  });

  it('returns P07 no-match to the existing cognitive fallback', async () => {
    const harness = createHarness({ retrieval: noMatch() });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('cognitive_runtime');
    expect(result.record.reasonCodes).toContain('GATEWAY_ARTIFACT_NO_MATCH');
    expect(harness.calls.rule).toBe(0);
    expect(harness.calls.template).toBe(0);
  });

  it('delegates a plan template to P08 and preserves formal refs', async () => {
    const harness = createHarness({
      retrieval: selected('plan_template', 'template_adapt'),
      template: {
        disposition: 'formal_handoff',
        resultRef: 'instantiation-1',
        formalHandoffRef: 'handoff-1',
        formalGoalRef: 'goal-1',
        formalPlanRef: 'plan-1',
      },
    });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('template_adapt');
    expect(result.record.formalHandoffRef).toBe('handoff-1');
    expect(result.formalGoalRef).toBe('goal-1');
    expect(result.formalPlanRef).toBe('plan-1');
    expect(harness.calls.template).toBe(1);
    expect(harness.calls.rule).toBe(0);
  });

  it('preserves P08 confirmation as interaction required', async () => {
    const harness = createHarness({
      retrieval: selected('plan_template', 'template_adapt'),
      template: {
        disposition: 'requires_confirmation',
        resultRef: 'instantiation-1',
        formalHandoffRef: 'handoff-1',
        interactionRef: 'planning-session-1',
      },
    });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('human_input');
    expect(result.formalInteractionRef).toBe('planning-session-1');
    expect(harness.calls.fallback).toBe(0);
  });

  it('terminates a P09 deny and never hides it behind fallback', async () => {
    const harness = createHarness({
      retrieval: selected('decision_rule', 'compiled_fast'),
      rule: { disposition: 'deny', resultRef: 'rule-result-1' },
    });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.decision.path).toBe('denied');
    expect(result.record.reasonCodes).toContain('GATEWAY_RULE_DENY');
    expect(harness.calls.fallback).toBe(0);
  });

  it('reserves fallback time and aborts an over-budget adapter', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({
        retrievalOperation: async (execution) =>
          new Promise<ArtifactRetrievalResult>((resolve) => {
            execution.signal.addEventListener('abort', () => {
              resolve(noMatch());
            });
          }),
        options: {
          fallbackReserveMs: 10,
          stageTimeoutMs: { retrieval: 20, rule: 20, template: 20 },
        },
      });
      const pending = harness.service.evaluateDetailed(context());
      await vi.advanceTimersByTimeAsync(21);
      const result = await pending;
      expect(result.decision.path).toBe('cognitive_runtime');
      expect(result.record.reasonCodes).toContain('GATEWAY_STAGE_TIMEOUT');
      expect(harness.calls.fallback).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invoke an adapter for an already cancelled request', async () => {
    const harness = createHarness({ cancelled: true });
    const result = await harness.service.evaluateDetailed(context());
    expect(result.record.reasonCodes).toContain('GATEWAY_CANCELLED');
    expect(harness.calls.retrieval).toBe(0);
  });

  it('bounds Cognitive Fallback by the absolute deadline and discards its late start', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness({
        retrieval: noMatch(),
        fallbackOperation: () =>
          new Promise<Readonly<{ fallbackRef: string }>>(() => {
            // Deliberately never settles; the Gateway deadline must win.
          }),
      });
      const pending = harness.service.evaluateDetailed({
        ...context(),
        deadlineAt: '2026-07-30T00:00:00.020Z',
      });
      await vi.advanceTimersByTimeAsync(21);
      const result = await pending;
      expect(result.decision.path).toBe('cognitive_runtime');
      expect(result.record.reasonCodes).toContain('GATEWAY_DEADLINE_EXHAUSTED');
      expect(result.record.stageResults.at(-1)).toMatchObject({
        stage: 'fallback',
        status: 'timed_out',
      });
      expect(result.record.fallbackRef).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the exact durable decision for an idempotent retry', async () => {
    const harness = createHarness({ retrieval: noMatch() });
    const first = await harness.service.evaluateDetailed(context());
    const second = await harness.service.evaluateDetailed(context());
    expect(second).toEqual(first);
    expect(harness.calls.retrieval).toBe(1);
  });

  it('coalesces concurrent identical requests before P07 is invoked', async () => {
    let release: ((value: ArtifactRetrievalResult) => void) | undefined;
    const harness = createHarness({
      retrievalOperation: () =>
        new Promise<ArtifactRetrievalResult>((resolve) => {
          release = resolve;
        }),
    });
    const first = harness.service.evaluateDetailed(context());
    const second = harness.service.evaluateDetailed(context());
    await vi.waitFor(() => {
      expect(harness.calls.retrieval).toBe(1);
    });
    release?.(noMatch());
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ decision: expect.objectContaining({ path: 'cognitive_runtime' }) }),
      expect.objectContaining({ decision: expect.objectContaining({ path: 'cognitive_runtime' }) }),
    ]);
    expect(harness.persistence.entries.size).toBe(1);
  });

  it('opens a tenant-and-adapter circuit after bounded failures', async () => {
    const harness = createHarness({
      retrievalOperation: () => Promise.reject(new Error('retrieval unavailable')),
      options: {
        circuitFailureThreshold: 2,
        circuitWindowMs: 1_000,
        circuitOpenMs: 1_000,
      },
    });
    await harness.service.evaluateDetailed(context());
    await harness.service.evaluateDetailed({
      ...context(),
      requestId: 'request-2',
      taskId: 'task-2',
      idempotencyKey: 'idem-2',
    });
    const third = await harness.service.evaluateDetailed({
      ...context(),
      requestId: 'request-3',
      taskId: 'task-3',
      idempotencyKey: 'idem-3',
    });
    expect(third.record.reasonCodes).toContain('GATEWAY_CIRCUIT_OPEN');
    expect(harness.calls.retrieval).toBe(2);
  });

  it('runs authority prechecks before global load shedding and never falls back after deny', async () => {
    let release: ((value: ArtifactRetrievalResult) => void) | undefined;
    const harness = createHarness({
      precheckFor: (request) =>
        request.requestId === 'denied-request' ? { authorized: false } : {},
      retrievalOperation: () =>
        new Promise<ArtifactRetrievalResult>((resolve) => {
          release = resolve;
        }),
      options: { maxInFlight: 1 },
    });
    const occupied = harness.service.evaluateDetailed(context());
    await vi.waitFor(() => {
      expect(harness.calls.retrieval).toBe(1);
    });
    const denied = await harness.service.evaluateDetailed({
      ...context(),
      requestId: 'denied-request',
      taskId: 'denied-task',
      idempotencyKey: 'denied-idempotency',
    });
    expect(denied.decision.path).toBe('denied');
    expect(denied.record.reasonCodes).toContain('GATEWAY_TENANT_DENIED');
    expect(harness.calls.fallback).toBe(0);
    release?.(noMatch());
    await occupied;
  });

  it('isolates an overloaded retrieval adapter and preserves cognitive fallback capacity', async () => {
    let release: ((value: ArtifactRetrievalResult) => void) | undefined;
    const harness = createHarness({
      retrievalOperation: () =>
        new Promise<ArtifactRetrievalResult>((resolve) => {
          release ??= resolve;
        }),
      options: { maxInFlight: 2, adapterConcurrency: 1, fallbackConcurrency: 1 },
    });
    const occupied = harness.service.evaluateDetailed(context());
    await vi.waitFor(() => {
      expect(harness.calls.retrieval).toBe(1);
    });
    const shed = await harness.service.evaluateDetailed({
      ...context(),
      requestId: 'shed-request',
      taskId: 'shed-task',
      idempotencyKey: 'shed-idempotency',
    });
    expect(shed.decision.path).toBe('cognitive_runtime');
    expect(shed.record.reasonCodes).toContain('GATEWAY_LOAD_SHED');
    expect(harness.calls.retrieval).toBe(1);
    expect(harness.calls.fallback).toBe(1);
    release?.(noMatch());
    await occupied;
  });

  it('rejects reuse of an idempotency key with different request facts', async () => {
    const harness = createHarness({ retrieval: noMatch() });
    await harness.service.evaluateDetailed(context());
    await expect(
      harness.service.evaluateDetailed({
        ...context(),
        normalizedText: 'different request',
      }),
    ).rejects.toMatchObject({
      code: 'GATEWAY_IDEMPOTENCY_CONFLICT',
    });
  });

  it('emits P06 drift signals without mutating an Artifact', async () => {
    const harness = createHarness({ retrieval: noMatch() });
    const evaluated = await harness.service.evaluateDetailed(context());
    await harness.service.recordFeedback({
      feedbackId: 'gateway-feedback-1',
      requestId: 'request-1',
      gatewayDecisionRef: evaluated.record.gatewayDecisionId,
      selectedArtifactRefs: [],
      feedbackType: 'drift',
      payload: { severity: 'critical', observationRef: 'observation-1' },
      sourceRefs: ['formal-outcome:outcome-1'],
    });
    expect(harness.drift).toEqual([
      expect.objectContaining({ severity: 'critical', sourceRefs: ['formal-outcome:outcome-1'] }),
    ]);
    expect(harness.persistence.feedback).toHaveLength(1);
  });

  it('uses a caller-stable feedback ID for exact retry', async () => {
    const harness = createHarness({ retrieval: noMatch() });
    const evaluated = await harness.service.evaluateDetailed(context());
    const input = {
      feedbackId: 'stable-feedback-1',
      requestId: 'request-1',
      gatewayDecisionRef: evaluated.record.gatewayDecisionId,
      selectedArtifactRefs: [],
      feedbackType: 'performance' as const,
      payload: { latencyMs: 5 },
      sourceRefs: ['gateway-decision:1'],
    };
    await harness.service.recordFeedback(input);
    await harness.service.recordFeedback(input);
    expect(harness.persistence.feedback).toHaveLength(1);
    expect(harness.persistence.feedback[0]?.feedbackId).toBe('stable-feedback-1');
  });

  it('keeps deterministic no-match Gateway p95 below the reviewed local budget', async () => {
    const harness = createHarness({ retrieval: noMatch() });
    const samples: number[] = [];
    for (let index = 0; index < 250; index += 1) {
      const startedAt = performance.now();
      await harness.service.evaluateDetailed({
        ...context(),
        requestId: `performance-request-${String(index)}`,
        taskId: `performance-task-${String(index)}`,
        idempotencyKey: `performance-idempotency-${String(index)}`,
      });
      samples.push(performance.now() - startedAt);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY;
    const maximum = sorted.at(-1) ?? Number.POSITIVE_INFINITY;
    process.stdout.write(
      `${JSON.stringify({
        event: 'p10.fast_gateway.no_match_performance',
        samples: samples.length,
        p95Ms: Number(p95.toFixed(3)),
        maximumMs: Number(maximum.toFixed(3)),
        budgetMs: 25,
      })}\n`,
    );
    expect(p95).toBeLessThan(25);
  });

  it('reports bounded Gateway latency at 1, 10, 100 and 1000 concurrent requests', async () => {
    const results: {
      concurrency: number;
      p50Ms: number;
      p95Ms: number;
      p99Ms: number;
      elapsedMs: number;
      errorRate: number;
    }[] = [];
    for (const concurrency of [1, 10, 100, 1000]) {
      const harness = createHarness({
        retrieval: noMatch(),
        options: {
          maxInFlight: 2048,
          adapterConcurrency: 2048,
          fallbackConcurrency: 2048,
        },
      });
      const batchStartedAt = performance.now();
      const settled = await Promise.all(
        Array.from({ length: concurrency }, async (_, index) => {
          const startedAt = performance.now();
          const result = await harness.service.evaluateDetailed({
            ...context(),
            requestId: `concurrency-${String(concurrency)}-request-${String(index)}`,
            taskId: `concurrency-${String(concurrency)}-task-${String(index)}`,
            idempotencyKey: `concurrency-${String(concurrency)}-idempotency-${String(index)}`,
          });
          return {
            latencyMs: performance.now() - startedAt,
            succeeded: result.decision.path === 'cognitive_runtime',
          };
        }),
      );
      const latencies = settled.map((item) => item.latencyMs).sort((left, right) => left - right);
      const percentile = (value: number) =>
        latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * value))] ??
        Number.POSITIVE_INFINITY;
      results.push({
        concurrency,
        p50Ms: Number(percentile(0.5).toFixed(3)),
        p95Ms: Number(percentile(0.95).toFixed(3)),
        p99Ms: Number(percentile(0.99).toFixed(3)),
        elapsedMs: Number((performance.now() - batchStartedAt).toFixed(3)),
        errorRate: settled.filter((item) => !item.succeeded).length / Math.max(1, settled.length),
      });
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'p10.fast_gateway.concurrency_performance', results })}\n`,
    );
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ concurrency: 1, errorRate: 0 }),
        expect.objectContaining({ concurrency: 10, errorRate: 0 }),
        expect.objectContaining({ concurrency: 100, errorRate: 0 }),
        expect.objectContaining({ concurrency: 1000, errorRate: 0 }),
      ]),
    );
    expect(results.at(-1)?.p99Ms).toBeLessThan(750);
  });
});

function context(): RuntimeRequestContext {
  return {
    requestId: 'request-1',
    taskId: 'task-1',
    contextId: 'context-1',
    rawText: 'inspect device status',
    normalizedText: 'inspect device status',
    actor: {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      authenticationRef: 'auth:1',
      authorizationRefs: ['authorization:read'],
    },
    extractedFeatures: { domain: 'device', taskTypeIds: ['inspect_status'] },
    worldStateRef: 'world:1',
    capabilitySummaryRef: 'capability:1',
    policySnapshotRef: 'policy:1',
    deadlineAt: '2099-07-30T00:01:00.000Z',
    cancellationRef: 'cancel:1',
    idempotencyKey: 'idem-1',
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}

function noMatch(): ArtifactRetrievalResult {
  return Object.freeze({
    index: Object.freeze([]),
    matches: Object.freeze([]),
    decision: decision('cognitive_runtime'),
  });
}

function selected(
  artifactType: ArtifactIndexEntry['artifactType'],
  path: RuntimeExecutionDecision['path'],
): ArtifactRetrievalResult {
  const artifactRef = 'artifact-1:1';
  const index: ArtifactIndexEntry = {
    artifactRef,
    artifactKey: 'artifact-key-1',
    artifactVersion: 1,
    artifactType,
    tenantId: 'tenant-1',
    domain: 'device',
    taskTypeIds: Object.freeze(['inspect_status']),
    riskLevel: 'low',
    status: 'active',
    exactPatterns: Object.freeze(['inspect device status']),
    structuredHints: Object.freeze([]),
    activePointerVersion: 1,
    contentHash: HASH,
  };
  return Object.freeze({
    index: Object.freeze([index]),
    matches: Object.freeze([]),
    decision: decision(path, artifactRef),
  });
}

function decision(
  path: RuntimeExecutionDecision['path'],
  selectedArtifactRef?: string,
): RuntimeExecutionDecision {
  return Object.freeze({
    decisionId: 'runtime-decision-1',
    requestId: 'request-1',
    path,
    ...(selectedArtifactRef === undefined ? {} : { selectedArtifactRef }),
    parameterBindings: Object.freeze({}),
    missingParameters: Object.freeze([]),
    requiredConfirmations: Object.freeze([]),
    reasonCodes: Object.freeze([]),
    matcherSnapshotHash: HASH,
    policySnapshotHash: HASH,
    createdAt: '2026-07-30T00:00:00.000Z',
  });
}

function createHarness(
  input: Readonly<{
    precheck?: Partial<GatewayPrecheckResult>;
    precheckFor?: (context: RuntimeRequestContext) => Partial<GatewayPrecheckResult>;
    retrieval?: ArtifactRetrievalResult;
    retrievalOperation?: Parameters<
      ConstructorParameters<typeof FastGatewayService>[0]['retrieval']['retrieve']
    >[1] extends never
      ? never
      : (
          execution: Parameters<
            ConstructorParameters<typeof FastGatewayService>[0]['retrieval']['retrieve']
          >[1],
        ) => Promise<ArtifactRetrievalResult>;
    rule?: GatewayRuleOutcome;
    template?: GatewayTemplateOutcome;
    fallbackOperation?: (
      execution: Parameters<
        ConstructorParameters<typeof FastGatewayService>[0]['fallback']['start']
      >[3],
    ) => Promise<Readonly<{ fallbackRef: string }>>;
    cancelled?: boolean;
    options?: ConstructorParameters<typeof FastGatewayService>[0]['options'];
  }> = {},
) {
  const calls = {
    retrieval: 0,
    rule: 0,
    template: 0,
    fallback: 0,
    precheck: [] as string[],
  };
  const persistence = new MemoryGatewayPersistence();
  let decisionCounter = 0;
  const drift: Parameters<GatewayDriftSignalPort['signal']>[0][] = [];
  const defaults: GatewayPrecheckResult = {
    authenticated: true,
    tenantAuthorized: true,
    authorized: true,
    featureEnabled: true,
    killSwitchActive: false,
    policyDecision: 'allow',
    runtimeSnapshotHash: HASH,
  };
  const service = new FastGatewayService({
    precheck: {
      authenticate: (context) => {
        calls.precheck.push('authentication');
        const configured = { ...defaults, ...input.precheck, ...input.precheckFor?.(context) };
        return Promise.resolve(configured.authenticated);
      },
      authorizeTenant: (context) => {
        calls.precheck.push('tenant');
        const configured = { ...defaults, ...input.precheck, ...input.precheckFor?.(context) };
        return Promise.resolve(configured.tenantAuthorized);
      },
      authorizeRequest: (context) => {
        calls.precheck.push('authorization');
        const configured = { ...defaults, ...input.precheck, ...input.precheckFor?.(context) };
        return Promise.resolve(configured.authorized);
      },
      readRuntimeState: (context) => {
        calls.precheck.push('runtime_state');
        const configured = { ...defaults, ...input.precheck, ...input.precheckFor?.(context) };
        return Promise.resolve({
          featureEnabled: configured.featureEnabled,
          killSwitchActive: configured.killSwitchActive,
          policyDecision: configured.policyDecision,
          runtimeSnapshotHash: configured.runtimeSnapshotHash,
        });
      },
    },
    retrieval: {
      async retrieve(_context, execution) {
        calls.retrieval += 1;
        return input.retrievalOperation?.(execution) ?? input.retrieval ?? noMatch();
      },
    },
    rule: {
      evaluate() {
        calls.rule += 1;
        return Promise.resolve(input.rule ?? { disposition: 'advice', resultRef: 'rule-result-1' });
      },
    },
    template: {
      instantiate() {
        calls.template += 1;
        return Promise.resolve(
          input.template ?? { disposition: 'fallback', resultRef: 'template-result-1' },
        );
      },
    },
    fallback: {
      start(request, _reasonCodes, _remainingMs, execution) {
        calls.fallback += 1;
        return (
          input.fallbackOperation?.(execution) ??
          Promise.resolve({ fallbackRef: `fallback:${request.requestId}` })
        );
      },
    },
    cancellation: {
      isCancelled: () => Promise.resolve(input.cancelled ?? false),
    },
    persistence,
    drift: {
      signal(value) {
        drift.push(value);
        return Promise.resolve();
      },
    },
    artifactFeedback: {
      record: () => Promise.resolve(),
    },
    clock: {
      now: () => '2026-07-30T00:00:00.000Z',
      nowMs: () => Date.parse('2026-07-30T00:00:00.000Z'),
    },
    ids: {
      nextGatewayDecisionId: () => `gateway-decision-${String(++decisionCounter)}`,
    },
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  return { service, calls, persistence, drift };
}

class MemoryGatewayPersistence implements GatewayDecisionPersistence {
  readonly entries = new Map<
    string,
    {
      requestHash: string;
      decision: RuntimeExecutionDecision;
      record: GatewayDecisionRecord;
    }
  >();
  readonly feedback: GatewayFeedbackEnvelope[] = [];

  findByIdempotencyKey(idempotencyKey: string) {
    return Promise.resolve(this.entries.get(idempotencyKey));
  }

  save(input: Parameters<GatewayDecisionPersistence['save']>[0]): Promise<void> {
    const existing = this.entries.get(input.idempotencyKey);
    if (existing !== undefined && existing.requestHash !== input.requestHash) {
      throw new Error('GATEWAY_IDEMPOTENCY_CONFLICT');
    }
    this.entries.set(input.idempotencyKey, {
      requestHash: input.requestHash,
      decision: input.decision,
      record: input.record,
    });
    return Promise.resolve();
  }

  appendFeedback(input: GatewayFeedbackEnvelope): Promise<void> {
    if (this.feedback.some((item) => item.feedbackId === input.feedbackId)) {
      return Promise.resolve();
    }
    this.feedback.push(input);
    return Promise.resolve();
  }
}
