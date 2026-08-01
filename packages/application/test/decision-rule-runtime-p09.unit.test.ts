import { describe, expect, it } from 'vitest';

import {
  createUserGoalCompletionContract,
  createUserGoalPlan,
  type CompiledArtifact,
  type FormalPlanHandoffResult,
  type JsonValue,
  type RuleDecisionContext,
  type RuleOperandObservation,
} from '../../domain/src/index.js';
import {
  DecisionRuleRuntimeService,
  hashRuleRuntimeState,
  type ArtifactExecutionCompletion,
  type ArtifactExecutionRecord,
  type ArtifactExecutionStart,
  type ArtifactFeedbackInput,
  type RuleAuthorizationDecision,
  type RulePolicyAuthorityDecision,
  type RuleRuntimeCurrentState,
  type RuleRuntimeApplicationError,
  type RuleUsageRepository,
} from '../src/index.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const NOW = '2026-07-30T00:00:00.000Z';

describe('P09 DecisionRuleRuntimeService', () => {
  it('evaluates an active Rule, persists P02 usage, and returns stable advice', async () => {
    const state = currentState();
    const usage = new UsageRecorder();
    const service = runtime(() => state, usage);
    const input = context(state);

    const first = await service.evaluateDecisionRules({
      contexts: [input],
      taskId: 'task:p09',
      idempotencyKey: 'idempotency:p09',
    });
    const second = await service.evaluateDecisionRules({
      contexts: [input],
      taskId: 'task:p09',
      idempotencyKey: 'idempotency:p09',
    });

    expect(first.decision).toMatchObject({
      requestRef: 'request:p09',
      disposition: 'advice',
      policyDecisionRef: 'policy:p09',
      authorizationCheckRef: 'authorization-check:p09',
    });
    expect(second.decision.decisionId).toBe(first.decision.decisionId);
    expect(first.evaluations[0]?.resultHash).toBe(second.evaluations[0]?.resultHash);
    expect(usage.executions).toHaveLength(1);
    expect(usage.feedback.map((item) => item.feedbackType)).toContain('rule_runtime_event');
  });

  it('lets policy denial override Rule advice', async () => {
    const state = currentState();
    const outcome = await runtime(
      () => state,
      new UsageRecorder(),
      policy('deny'),
    ).evaluateDecisionRules({
      contexts: [context(state)],
      taskId: 'task:p09',
      idempotencyKey: 'policy-deny',
    });

    expect(outcome.decision.disposition).toBe('deny');
    expect(outcome.evaluations[0]).toMatchObject({ proposedAction: 'deny' });
  });

  it('hard-blocks missing authorization and ignores caller actor claims', async () => {
    const state = currentState();
    const service = runtime(
      () => state,
      new UsageRecorder(),
      policy('allow'),
      authorization(false, false),
    );

    const outcome = await service.evaluateDecisionRules({
      contexts: [context(state)],
      taskId: 'task:spoofed-actor-has-no-authority',
      idempotencyKey: 'authorization-missing',
    });

    expect(outcome.decision.disposition).toBe('deny');
    expect(outcome.evaluations[0]?.proposedAction).toBe('deny');
  });

  it('discards an evaluation when the authoritative state changes at recheck', async () => {
    const first = currentState();
    const changed = currentState({ readinessHash: HASH_B });
    let reads = 0;
    const outcome = await runtime(
      () => (reads++ === 0 ? first : changed),
      new UsageRecorder(),
    ).evaluateDecisionRules({
      contexts: [context(first)],
      taskId: 'task:p09',
      idempotencyKey: 'stale-at-recheck',
    });

    expect(outcome.decision.disposition).toBe('discarded_stale');
    expect(outcome.evaluations[0]).toMatchObject({
      proposedAction: 'fallback',
      unknown: true,
    });
  });

  it('fails closed when authorization evidence is empty', async () => {
    const state = currentState({ authorizationRefs: [] });
    const service = runtime(
      () => state,
      new UsageRecorder(),
      policy('allow'),
      authorization(true, false, []),
    );

    await expect(service.evaluate(context(state))).rejects.toMatchObject({
      code: 'RULE_AUTHORIZATION_STALE',
    } satisfies Partial<RuleRuntimeApplicationError>);
  });

  it.each([
    {
      name: 'non-active Rule',
      mutate: (state: RuleRuntimeCurrentState) => ({
        ...state,
        artifact: { ...state.artifact, status: 'deprecated' as const },
      }),
      code: 'RULE_NON_ACTIVE',
    },
    {
      name: 'cross-tenant Rule',
      mutate: (state: RuleRuntimeCurrentState) => ({
        ...state,
        tenantId: 'tenant:other',
      }),
      code: 'RULE_TENANT_MISMATCH',
    },
    {
      name: 'forged artifact hash',
      mutate: (state: RuleRuntimeCurrentState) => ({
        ...state,
        artifact: { ...state.artifact, contentHash: HASH_B },
      }),
      code: 'RULE_STALE',
    },
  ])('rejects $name before evaluation', async ({ mutate, code }) => {
    const authoritative = mutate(currentState());
    const forgedContext = context(currentState());
    await expect(
      runtime(() => authoritative, new UsageRecorder()).evaluate(forgedContext),
    ).rejects.toMatchObject({ code });
  });

  it('links formal Outcome by reference and sends drift only to P06 revalidation', async () => {
    const state = currentState();
    const usage = new UsageRecorder();
    const signals: string[] = [];
    const service = runtime(() => state, usage, policy('allow'), authorization(), signals);
    await service.evaluateDecisionRules({
      contexts: [context(state)],
      taskId: 'task:p09',
      idempotencyKey: 'drift-source',
    });
    const executionId = usage.executions[0]?.artifactExecutionId;
    if (executionId === undefined) throw new Error('execution missing');

    await service.linkFormalOutcome({
      executionId,
      artifactId: state.artifact.artifactId,
      outcomeRef: 'outcome:p09',
      decisionRef: 'decision:p09',
    });
    await service.recordDrift({
      executionId,
      artifact: state.artifact,
      artifactRef: context(state).artifactRef,
      kind: 'unsafe_allow',
      sourceRefs: ['outcome:p09'],
    });

    expect(usage.feedback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ feedbackType: 'rule_outcome_link' }),
        expect.objectContaining({ feedbackType: 'rule_drift' }),
      ]),
    );
    expect(signals).toHaveLength(1);
  });

  it('submits only a bounded conservative patch through existing validation and planning authority', async () => {
    const state = patchState();
    const usage = new UsageRecorder();
    const handoffs: string[] = [];
    const service = new DecisionRuleRuntimeService({
      states: { read: () => Promise.resolve(state) },
      policy: { decide: () => Promise.resolve(policy('allow')) },
      authorization: { check: () => Promise.resolve(authorization()) },
      usage,
      validator: {
        validate: (_contract, plan) => ({
          valid:
            plan.skillGoals[0]?.constraints.includes('safety:require-current-readiness') === true,
          errorCodes: [],
        }),
      },
      planning: {
        submit: (input) => {
          handoffs.push(input.patchCandidate.patchCandidateId);
          return Promise.resolve({
            handoffId: 'handoff:p09',
            planCandidateRef: input.patchCandidate.patchCandidateId,
            disposition: 'requires_confirmation',
            formalPlanningSessionRef: 'planning-session:p09',
            validationRef: 'validation:p09',
            reasonCodes: ['RULE_FORMAL_HANDOFF_SUBMITTED'],
            completedAt: NOW,
          } satisfies FormalPlanHandoffResult);
        },
      },
      revalidation: { signal: () => Promise.resolve() },
      clock: { now: () => NOW },
    });

    const outcome = await service.evaluateDecisionRules({
      contexts: [context(state)],
      taskId: 'task:p09',
      idempotencyKey: 'patch:p09',
      formalHandoff: {
        taskId: 'task:p09',
        userId: 'user:p09',
        goalSessionId: 'goal-session:p09',
        confirmedContractCandidateId: 'confirmed-contract:p09',
        sourceRefs: [],
      },
    });

    expect(outcome.decision.disposition).toBe('plan_patch_candidate');
    expect(outcome.planPatchCandidate).toMatchObject({
      bounded: true,
      goalContractRef: 'goal:p09',
      requiredConfirmations: ['confirmation:operator'],
    });
    expect(handoffs).toEqual([outcome.planPatchCandidate?.patchCandidateId]);
    expect(outcome.formalHandoff?.disposition).toBe('requires_confirmation');
  });

  it('coalesces concurrent duplicate evaluations through the usage idempotency key', async () => {
    const state = currentState();
    const usage = new UsageRecorder();
    const service = runtime(() => state, usage);
    await Promise.all(
      Array.from({ length: 32 }, () =>
        service.evaluateDecisionRules({
          contexts: [context(state)],
          taskId: 'task:p09',
          idempotencyKey: 'concurrent:p09',
        }),
      ),
    );
    expect(usage.executions).toHaveLength(1);
    expect(usage.feedback).toHaveLength(1);
  });
});

function runtime(
  read: () => RuleRuntimeCurrentState,
  usage: UsageRecorder,
  policyAuthority = policy('allow'),
  authorizationAuthority = authorization(),
  signals: string[] = [],
): DecisionRuleRuntimeService {
  return new DecisionRuleRuntimeService({
    states: { read: () => Promise.resolve(read()) },
    policy: { decide: () => Promise.resolve(policyAuthority) },
    authorization: { check: () => Promise.resolve(authorizationAuthority) },
    usage,
    validator: { validate: () => ({ valid: true, errorCodes: [] }) },
    planning: {
      submit: () => Promise.reject(new Error('planning is not expected in this test')),
    },
    revalidation: {
      signal: (input) => {
        signals.push(input.triggerId);
        return Promise.resolve();
      },
    },
    clock: { now: () => NOW },
  });
}

function policy(decision: RulePolicyAuthorityDecision['decision']): RulePolicyAuthorityDecision {
  return {
    decision,
    decisionRef: 'policy:p09',
    snapshotHash: HASH_A,
    reasonCodes: [
      decision === 'deny'
        ? 'RULE_POLICY_DENY'
        : decision === 'require_confirmation'
          ? 'RULE_POLICY_CONFIRM'
          : 'RULE_POLICY_ALLOW',
    ],
  };
}

function authorization(
  authorized = true,
  stale = false,
  authorizationRefs: readonly string[] = ['authorization:p09'],
): RuleAuthorizationDecision {
  return {
    authorized,
    stale,
    checkRef: 'authorization-check:p09',
    authorizationRefs,
    tenantId: 'tenant:p09',
    reasonCodes: [authorized ? 'RULE_AUTHORIZED' : 'RULE_AUTHORIZATION_MISSING'],
  };
}

function currentState(overrides: Partial<RuleRuntimeCurrentState> = {}): RuleRuntimeCurrentState {
  return {
    artifact: artifact(),
    activePointerVersion: 3,
    tenantId: 'tenant:p09',
    goalContractRef: 'goal:p09',
    goalVersion: 1,
    goalHash: HASH_A,
    planRef: 'plan:p09',
    planVersion: 1,
    planHash: HASH_A,
    requestSnapshotRef: 'request-snapshot:p09',
    worldStateSnapshotRef: 'world:p09',
    businessEventRefs: ['event:p09'],
    parameterBindingRef: 'binding:p09',
    capabilityReadinessRef: 'readiness:p09',
    policyDecisionRef: 'policy:p09',
    dependencyValidationRef: 'dependency:p09',
    authorizationRefs: ['authorization:p09'],
    capabilityCatalogHash: HASH_A,
    policySnapshotHash: HASH_A,
    readinessHash: HASH_A,
    killSwitchActive: false,
    operands: [observation()],
    ...overrides,
  };
}

function patchState(): RuleRuntimeCurrentState {
  const goal = {
    goalId: 'goal:p09',
    contextId: 'context:p09',
    version: 1,
    title: 'Inspect governed resource',
    description: 'Inspect it without changing it.',
    constraints: ['read only'],
    successCriteria: ['Evidence is recorded.'],
    status: 'active' as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const contract = createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId: goal.goalId,
    goalVersion: goal.version,
    title: goal.title,
    description: goal.description,
    constraints: goal.constraints,
    criteria: [
      {
        criterionId: 'criterion:p09',
        description: 'Evidence is recorded.',
        required: true,
        expectedEffectRefs: ['effect:observed'],
        evidenceRequirements: ['evidence:p09'],
        artifactRequirements: [],
      },
    ],
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  });
  const plan = createUserGoalPlan({
    schemaVersion: '1.0',
    planId: 'plan:p09',
    goalId: goal.goalId,
    goalVersion: goal.version,
    revision: 1,
    revisionKind: 'initial',
    status: 'validated',
    contractHash: HASH_A,
    contentHash: HASH_B,
    skillGoals: [
      {
        skillGoalId: 'skill-goal:p09',
        requiredResult: 'Inspect the resource.',
        capabilityNeeds: ['capability:inspect'],
        coveredCriterionIds: ['criterion:p09'],
        requiredEffectRefs: ['effect:observed'],
        evidenceRequirements: ['evidence:p09'],
        artifactRequirements: [],
        assumptions: [],
        constraints: ['read only'],
        status: 'pending',
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: NOW,
  });
  return currentState({
    artifact: artifact({
      type: 'propose_plan_patch',
      payload: {
        planPatchOperations: [
          {
            operation: 'add_constraint',
            targetSkillGoalId: 'skill-goal:p09',
            value: 'safety:require-current-readiness',
          },
          { operation: 'require_confirmation', value: 'confirmation:operator' },
        ],
        affectedCriterionRefs: ['criterion:p09'],
        requiredConfirmations: ['confirmation:operator'],
      },
    }),
    formalPlanning: { goal, contract, plan },
  });
}

function context(state: RuleRuntimeCurrentState): RuleDecisionContext {
  return {
    requestRef: 'request:p09',
    ...(state.goalContractRef === undefined ? {} : { goalContractRef: state.goalContractRef }),
    ...(state.goalVersion === undefined ? {} : { goalVersion: state.goalVersion }),
    ...(state.planRef === undefined ? {} : { planRef: state.planRef }),
    ...(state.planVersion === undefined ? {} : { planVersion: state.planVersion }),
    artifactRef: `${state.artifact.artifactId}:${String(state.artifact.version)}`,
    artifactVersion: state.artifact.version,
    artifactHash: state.artifact.contentHash,
    activePointerVersion: state.activePointerVersion,
    tenantId: state.tenantId,
    authorizationRefs: state.authorizationRefs,
    requestSnapshotRef: state.requestSnapshotRef,
    ...(state.worldStateSnapshotRef === undefined
      ? {}
      : { worldStateSnapshotRef: state.worldStateSnapshotRef }),
    businessEventRefs: state.businessEventRefs,
    parameterBindingRef: state.parameterBindingRef,
    capabilityReadinessRef: state.capabilityReadinessRef,
    policyDecisionRef: state.policyDecisionRef,
    dependencyValidationRef: state.dependencyValidationRef,
    runtimeSnapshotHash: hashRuleRuntimeState(state),
  };
}

function artifact(
  action: Readonly<{ type: string; payload?: JsonValue }> = {
    type: 'advise',
    payload: { message: 'guarded' },
  },
): CompiledArtifact {
  return {
    artifactId: 'artifact.rule.p09',
    artifactKey: 'rule.p09',
    version: 1,
    artifactType: 'decision_rule',
    name: 'P09 deterministic rule',
    description: 'Produces bounded advice.',
    scope: { tenantId: 'tenant:p09', domain: 'operations', taskTypeIds: ['inspect'] },
    definition: {
      category: 'routing',
      condition: {
        type: 'atomic',
        field: 'request.risk',
        operator: 'eq',
        value: 'high',
      },
      decision: {
        decisionType: 'select_template',
        parameters: {
          runtimeDsl: {
            version: '1.1',
            required: [
              {
                type: 'condition',
                conditionId: 'required.risk',
                operandRef: 'request.risk',
                source: 'request',
                operator: 'eq',
                expected: 'high',
              },
            ],
            forbidden: [],
            confirmation: [],
            advisory: [],
            unknownPolicy: 'no_match',
            action,
          },
        },
        explanationCode: 'rule.p09',
      },
      priority: 100,
      conflictGroup: 'risk',
      conflictPolicy: 'deny_overrides',
    },
    applicability: {
      requiredConditions: [],
      optionalConditions: [],
      forbiddenConditions: [],
      requiredParameters: [],
      allowedEnvironmentClasses: [],
      excludedEnvironmentClasses: [],
      minimumIntentScore: 0,
      minimumConditionScore: 0,
      maximumUncertainty: 1,
      outOfDistributionPolicy: 'require_confirmation',
    },
    requiredCapabilities: [],
    requiredPolicies: [],
    dependencySnapshot: {
      capabilityCatalogHash: HASH_A,
      policyVersionRefs: [],
      taskTypeVersionRefs: [],
      schemaVersionRefs: ['rule-runtime@1.1'],
      requiredSkillVersionRefs: [],
      compilerVersion: 'compiler.p09',
    },
    riskLevel: 'medium',
    status: 'active',
    lineageRef: 'lineage:p09',
    validationSummaryRef: 'validation:p09',
    contentHash: HASH_A,
    createdAt: NOW,
  };
}

function observation(): RuleOperandObservation {
  return {
    operandRef: 'request.risk',
    source: 'request',
    value: 'high',
    trusted: true,
    stale: false,
    tenantId: 'tenant:p09',
  };
}

class UsageRecorder implements RuleUsageRepository {
  readonly executions: ArtifactExecutionRecord[] = [];
  readonly feedback: ArtifactFeedbackInput[] = [];

  startOrLoad(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord> {
    const existing = this.executions.find(
      (item) => item.artifactExecutionId === input.artifactExecutionId,
    );
    if (existing !== undefined) return Promise.resolve(existing);
    const created = { ...input, status: 'started' as const };
    this.executions.push(created);
    return Promise.resolve(created);
  }

  completeOnce(input: ArtifactExecutionCompletion): Promise<void> {
    const index = this.executions.findIndex(
      (item) => item.artifactExecutionId === input.artifactExecutionId,
    );
    const existing = this.executions[index];
    if (existing?.status === 'started') {
      this.executions[index] = { ...existing, ...input };
    }
    return Promise.resolve();
  }

  appendFeedbackOnce(input: ArtifactFeedbackInput): Promise<void> {
    if (!this.feedback.some((item) => item.feedbackId === input.feedbackId)) {
      this.feedback.push(input);
    }
    return Promise.resolve();
  }
}
