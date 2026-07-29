import { describe, expect, it, vi } from 'vitest';

import {
  P07GatewayRetrievalAdapter,
  P02GatewayArtifactFeedbackAdapter,
  P08GatewayTemplateAdapter,
  P09GatewayRuleAdapter,
  type ArtifactRetrievalResult,
  type GatewayStageExecution,
  type RuleDecisionOutcome,
  type TemplateRuntimeOutcome,
} from '../src/index.js';
import type { RuleDecisionRequest, TemplateRuntimeRequest } from '../src/index.js';
import type { RuntimeRequestContext } from '../../domain/src/index.js';

describe('P10 concrete P07/P09/P08 adapters', () => {
  it('delegates retrieval to P07 without recomputing its result', async () => {
    const expected = noMatch();
    const retrieve = vi.fn(() => Promise.resolve(expected));
    const adapter = new P07GatewayRetrievalAdapter(
      { retrieve },
      { create: () => Promise.resolve({ requestId: 'p07-request' } as never) },
    );
    await expect(adapter.retrieve(context(), execution())).resolves.toBe(expected);
    expect(retrieve).toHaveBeenCalledOnce();
  });

  it('maps P09 plan-patch formal handoff without creating a plan itself', async () => {
    let observed: RuleDecisionRequest | undefined;
    const evaluateDecisionRules = vi.fn((request: RuleDecisionRequest) => {
      observed = request;
      return Promise.resolve({
        evaluations: [],
        resolution: {},
        decision: {
          decisionId: 'rule-decision-1',
          disposition: 'plan_patch_candidate',
        },
        formalHandoff: {
          handoffId: 'handoff-1',
          disposition: 'confirmed_and_committed',
          formalPlanRef: 'plan-1',
          formalPlanningSessionRef: 'planning-session-1',
        },
      } as unknown as RuleDecisionOutcome);
    });
    const adapter = new P09GatewayRuleAdapter(
      { evaluateDecisionRules },
      {
        create: () =>
          Promise.resolve({
            contexts: [],
            taskId: 'task-1',
            idempotencyKey: 'idem-1',
          } as RuleDecisionRequest),
      },
    );
    await expect(adapter.evaluate(context(), noMatch(), execution())).resolves.toEqual({
      disposition: 'plan_patch_candidate',
      resultRef: 'rule-decision-1',
      formalHandoffRef: 'handoff-1',
      formalPlanRef: 'plan-1',
      interactionRef: 'planning-session-1',
    });
    expect(observed?.commitGuard).toBeDefined();
  });

  it('maps P08 confirmation to the existing formal interaction', async () => {
    let observed: TemplateRuntimeRequest | undefined;
    const instantiate = vi.fn((request: TemplateRuntimeRequest) => {
      observed = request;
      return Promise.resolve({
        result: {
          instantiationId: 'instantiation-1',
          disposition: 'requires_confirmation',
        },
        formalHandoff: {
          handoffId: 'handoff-1',
          disposition: 'requires_confirmation',
          formalPlanningSessionRef: 'planning-session-1',
        },
      } as unknown as TemplateRuntimeOutcome);
    });
    const adapter = new P08GatewayTemplateAdapter(
      { instantiate },
      {
        create: () => Promise.resolve({} as TemplateRuntimeRequest),
      },
    );
    await expect(adapter.instantiate(context(), noMatch(), execution())).resolves.toEqual({
      disposition: 'requires_confirmation',
      resultRef: 'instantiation-1',
      formalHandoffRef: 'handoff-1',
      interactionRef: 'planning-session-1',
    });
    expect(observed?.commitGuard).toBeDefined();
  });

  it('does not invoke P07/P09/P08 after the deadline/cancellation guard closes', async () => {
    const retrieve = vi.fn();
    const adapter = new P07GatewayRetrievalAdapter(
      { retrieve },
      { create: () => Promise.resolve({} as never) },
    );
    await expect(adapter.retrieve(context(), execution(false))).rejects.toThrow(
      'P07_GATEWAY_STAGE_EXPIRED',
    );
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('projects selected-Artifact outcomes to P02 feedback authority', async () => {
    const observed: unknown[] = [];
    const adapter = new P02GatewayArtifactFeedbackAdapter({
      appendFeedbackOnce(input) {
        observed.push(input);
        return Promise.resolve();
      },
    });
    await adapter.record({
      feedbackId: 'feedback-1',
      requestId: 'request-1',
      gatewayDecisionRef: 'gateway-decision-1',
      selectedArtifactRefs: ['artifact-1:1'],
      formalOutcomeRef: 'outcome-1',
      feedbackType: 'outcome',
      payload: { status: 'succeeded' },
      sourceRefs: ['artifact_execution:execution-1'],
      createdAt: '2026-07-30T00:00:00.000Z',
    });
    expect(observed).toEqual([
      expect.objectContaining({
        artifactExecutionId: 'execution-1',
        artifactId: 'artifact-1',
        outcomeRef: 'outcome-1',
      }),
    ]);
  });
});

function execution(mayCommit = true): GatewayStageExecution {
  return {
    signal: new AbortController().signal,
    deadlineAt: '2099-07-30T00:01:00.000Z',
    budgetMs: 500,
    mayCommitFormalAuthority: () => mayCommit,
  };
}

function context(): RuntimeRequestContext {
  return {
    requestId: 'request-1',
    taskId: 'task-1',
    contextId: 'context-1',
    rawText: 'inspect status',
    normalizedText: 'inspect status',
    actor: {
      actorId: 'actor-1',
      tenantId: 'tenant-1',
      authenticationRef: 'auth:1',
      authorizationRefs: [],
    },
    extractedFeatures: {},
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
  return {
    index: [],
    matches: [],
    decision: {
      decisionId: 'p07-decision-1',
      requestId: 'request-1',
      path: 'cognitive_runtime',
      parameterBindings: {},
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: [],
      matcherSnapshotHash: `sha256:${'a'.repeat(64)}`,
      policySnapshotHash: `sha256:${'b'.repeat(64)}`,
      createdAt: '2026-07-30T00:00:00.000Z',
    },
  };
}
