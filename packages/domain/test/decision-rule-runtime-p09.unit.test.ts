import { describe, expect, it } from 'vitest';

import {
  DECISION_RULE_RUNTIME_SCHEMA_HASHES,
  RULE_OPERATOR_CATALOG,
  RULE_OPERATORS,
  applyConservativeRulePlanPatch,
  createRulePlanPatchCandidate,
  evaluateDecisionRule,
  hashRuleRuntimeValue,
  parseRuleRuntimeDsl,
  planPatchCandidateFromAction,
  resolveRuleConflicts,
  ruleSpecificity,
  type CompiledArtifact,
  type RuleDecisionContext,
  type RuleDecisionResult,
  type RuleOperandObservation,
  type RuleOperator,
  type RuleRuntimeDsl,
  type UserGoalPlan,
} from '../src/index.js';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

function context(overrides: Partial<RuleDecisionContext> = {}): RuleDecisionContext {
  return {
    requestRef: 'request:p09',
    goalContractRef: 'goal:p09',
    goalVersion: 1,
    planRef: 'plan:p09',
    planVersion: 1,
    artifactRef: 'artifact.rule.p09:1',
    artifactVersion: 1,
    artifactHash: HASH_A,
    activePointerVersion: 4,
    tenantId: 'tenant:p09',
    authorizationRefs: ['authorization:p09'],
    requestSnapshotRef: 'request-snapshot:p09',
    worldStateSnapshotRef: 'world:p09',
    businessEventRefs: ['event:p09'],
    parameterBindingRef: 'binding:p09',
    capabilityReadinessRef: 'readiness:p09',
    policyDecisionRef: 'policy:p09',
    dependencyValidationRef: 'dependency:p09',
    runtimeSnapshotHash: HASH_B,
    ...overrides,
  };
}

function artifact(
  runtimeDsl?: Readonly<Record<string, unknown>>,
  overrides: Partial<CompiledArtifact> = {},
): CompiledArtifact {
  return {
    artifactId: 'artifact.rule.p09',
    artifactKey: 'rule.p09',
    version: 1,
    artifactType: 'decision_rule',
    name: 'P09 deterministic rule',
    description: 'Evaluates a bounded runtime condition.',
    scope: { tenantId: 'tenant:p09', domain: 'operations', taskTypeIds: ['inspect'] },
    definition: {
      category: 'confirmation',
      condition: {
        type: 'atomic',
        field: 'request.risk',
        operator: 'eq',
        value: 'high',
      },
      decision: {
        decisionType: 'require_confirmation',
        parameters:
          runtimeDsl === undefined ? { reason: 'risk' } : { runtimeDsl: runtimeDsl as never },
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
    createdAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function dsl(
  operator: RuleOperator = 'eq',
  expected: unknown = 'high',
  action: RuleRuntimeDsl['action'] = { type: 'advise', payload: { message: 'guarded' } },
): RuleRuntimeDsl {
  return {
    version: '1.1',
    required: [
      {
        type: 'condition',
        conditionId: `condition.${operator}`,
        operandRef: 'request.risk',
        source: 'request',
        operator,
        ...(expected === undefined ? {} : { expected: expected as never }),
      },
    ],
    forbidden: [],
    confirmation: [],
    advisory: [],
    unknownPolicy: 'no_match',
    action,
  };
}

function observation(
  value: unknown,
  overrides: Partial<RuleOperandObservation> = {},
): RuleOperandObservation {
  return {
    operandRef: 'request.risk',
    source: 'request',
    value: value as never,
    trusted: true,
    stale: false,
    tenantId: 'tenant:p09',
    ...overrides,
  };
}

function evaluate(
  runtimeDsl: RuleRuntimeDsl,
  operands: readonly RuleOperandObservation[] = [observation('high')],
): RuleDecisionResult {
  return evaluateDecisionRule({
    context: context(),
    artifact: artifact(),
    dsl: runtimeDsl,
    operands,
    evaluatorVersion: 'p09-evaluator.1',
    createdAt: '2026-07-30T00:00:00.000Z',
  });
}

describe('P09 frozen contracts and DSL', () => {
  it('publishes every frozen schema hash and the complete typed operator catalog', () => {
    expect(Object.keys(DECISION_RULE_RUNTIME_SCHEMA_HASHES)).toEqual([
      'RuleDecisionContext',
      'RuleConditionResult',
      'RuleDecisionResult',
      'RuleConflictResolution',
      'RulePlanPatchCandidate',
      'RuleRuntime',
    ]);
    expect(RULE_OPERATOR_CATALOG.map((item) => item.operator)).toEqual(RULE_OPERATORS);
    expect(RULE_OPERATOR_CATALOG).toHaveLength(18);
  });

  it('parses an explicit strict runtimeDsl without changing the P01 Rule contract', () => {
    const parsed = parseRuleRuntimeDsl(
      artifact({
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
        action: { type: 'deny', payload: { reason: 'risk' } },
      }),
    );
    expect(parsed.required).toHaveLength(1);
    expect(parsed.action.type).toBe('deny');
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('maps the legacy P01 condition to a conservative confirmation rule', () => {
    const parsed = parseRuleRuntimeDsl(artifact());
    expect(parsed.confirmation).toHaveLength(1);
    expect(parsed.action.type).toBe('require_confirmation');
    expect(parsed.unknownPolicy).toBe('require_confirmation');
  });

  it('rejects dynamic/unsupported actions and unsafe patterns before evaluation', () => {
    expect(() =>
      parseRuleRuntimeDsl(
        artifact({
          version: '1.1',
          required: [],
          forbidden: [],
          confirmation: [],
          advisory: [],
          unknownPolicy: 'no_match',
          action: { type: 'execute_skill' },
        }),
      ),
    ).toThrow('forbidden or unsupported');
    expect(() =>
      parseRuleRuntimeDsl(
        artifact({
          version: '1.1',
          required: [
            {
              type: 'condition',
              conditionId: 'unsafe.pattern',
              operandRef: 'request.risk',
              source: 'request',
              operator: 'matches_safe_pattern',
              expected: '(a+)+$',
            },
          ],
          forbidden: [],
          confirmation: [],
          advisory: [],
          unknownPolicy: 'no_match',
          action: { type: 'advise' },
        }),
      ),
    ).toThrow('Safe pattern');
  });

  it('rejects unbounded payloads and authoritative parameter suggestions', () => {
    expect(() =>
      parseRuleRuntimeDsl(
        artifact({
          ...dsl(),
          action: {
            type: 'advise',
            payload: { message: 'x'.repeat(1_025) },
          },
        }),
      ),
    ).toThrow('string bound exceeded');
    expect(() =>
      parseRuleRuntimeDsl(
        artifact({
          ...dsl(),
          action: {
            type: 'suggest_parameter',
            payload: {
              parameterName: 'authorizationRef',
              value: 'forged',
              riskLevel: 'low',
              requiresConfirmation: true,
            },
          },
        }),
      ),
    ).toThrow('low-risk, confirmation-bound');
  });

  it('accepts only low-risk non-authoritative parameter suggestions', () => {
    const parsed = parseRuleRuntimeDsl(
      artifact({
        ...dsl(),
        action: {
          type: 'suggest_parameter',
          payload: {
            parameterName: 'temperature',
            value: 21,
            riskLevel: 'low',
            requiresConfirmation: true,
          },
        },
      }),
    );
    expect(parsed.action.type).toBe('suggest_parameter');
  });
});

describe('P09 deterministic evaluation', () => {
  it('returns the same result hash for the same Rule/runtime/evaluator input', () => {
    const first = evaluate(dsl());
    const second = evaluate(dsl());
    expect(first.matched).toBe(true);
    expect(first.proposedAction).toBe('advise');
    expect(first.resultHash).toBe(second.resultHash);
    expect(first.evaluationId).toBe(second.evaluationId);
  });

  it('rejects duplicate and oversized runtime observations before evaluation', () => {
    expect(() => evaluate(dsl(), [observation('high'), observation('high')])).toThrow(
      'must be unique',
    );
    expect(() => evaluate(dsl(), [observation('x'.repeat(1_025))])).toThrow(
      'string bound exceeded',
    );
  });

  it('never promotes missing, untrusted, stale or spoofed-source operands to true', () => {
    for (const operands of [
      [],
      [observation('high', { trusted: false })],
      [observation('high', { stale: true })],
      [observation('high', { source: 'authorization_claim' })],
    ]) {
      const result = evaluate(dsl(), operands);
      expect(result.matched).toBe(false);
      expect(result.unknown).toBe(true);
      expect(result.proposedAction).toBe('no_match');
    }
    expect(() => evaluate(dsl(), [observation('high', { tenantId: 'tenant:other' })])).toThrow(
      'tenant boundary',
    );
  });

  it('hard-denies a true forbidden condition and requires confirmation for forbidden unknown', () => {
    const runtimeDsl: RuleRuntimeDsl = {
      ...dsl(),
      required: [],
      forbidden: dsl().required,
    };
    const denied = evaluate(runtimeDsl);
    expect(denied.matched).toBe(true);
    expect(denied.proposedAction).toBe('deny');

    const unknown = evaluate(runtimeDsl, []);
    expect(unknown.matched).toBe(false);
    expect(unknown.proposedAction).toBe('require_confirmation');
  });

  it.each([
    ['eq', 'high', 'high', true],
    ['neq', 'low', 'high', true],
    ['in', ['high', 'critical'], 'high', true],
    ['not_in', ['low'], 'high', true],
    ['exists', undefined, null, true],
    ['not_exists', undefined, undefined, true],
    ['gt', 2, 3, true],
    ['gte', 3, 3, true],
    ['lt', 4, 3, true],
    ['lte', 3, 3, true],
    ['contains', 'igh', 'high', true],
    ['starts_with', 'hi', 'high', true],
    ['matches_safe_pattern', 'h*', 'high', true],
    ['within_range', [1, 5], 3, true],
    ['intersects', ['b', 'c'], ['a', 'b'], true],
    ['is_ready', undefined, 'ready', true],
    ['is_authorized', 'claim:write', ['claim:read', 'claim:write'], true],
    ['changed_since', '2026-07-29T00:00:00.000Z', '2026-07-30T00:00:00.000Z', true],
  ] as const)(
    'evaluates %s with defined null/unknown/type semantics',
    (operator, expected, actual, matches) => {
      const result = evaluate(dsl(operator, expected), [
        ...(operator === 'not_exists'
          ? []
          : [observation(actual, operator === 'exists' ? { value: null } : {})]),
      ]);
      expect(result.matched).toBe(matches);
    },
  );
});

describe('P09 conflict resolution', () => {
  const candidate = (
    action: RuleDecisionResult['proposedAction'],
    ruleRef: string,
    priority = 10,
    specificity = 10,
  ) => ({
    evaluation: {
      ...evaluate(dsl()),
      evaluationId: `evaluation:${ruleRef}`,
      ruleRef,
      proposedAction: action,
      resultHash: hashRuleRuntimeValue({ ruleRef, action }),
    },
    priority,
    specificity,
    artifactVersion: 1,
    conflictGroup: ruleRef,
  });

  it('orders policy, deny and confirmation above advice/ranking', () => {
    const denied = resolveRuleConflicts(
      [candidate('advise', 'rule:advice', 999, 999), candidate('deny', 'rule:deny')],
      { policyDecision: 'allow', resolverVersion: 'resolver.1' },
    );
    expect(denied.disposition).toBe('deny_overrides');
    expect(denied.selectedRuleRefs).toEqual(['rule:deny']);

    const confirmed = resolveRuleConflicts(
      [
        candidate('advise', 'rule:advice', 999, 999),
        candidate('require_confirmation', 'rule:confirm'),
      ],
      { policyDecision: 'allow', resolverVersion: 'resolver.1' },
    );
    expect(confirmed.disposition).toBe('confirmation_overrides');

    const policyDenied = resolveRuleConflicts([candidate('advise', 'rule:advice')], {
      policyDecision: 'deny',
      resolverVersion: 'resolver.1',
    });
    expect(policyDenied.disposition).toBe('deny_overrides');
    expect(policyDenied.reasonCodes).toContain('RULE_POLICY_DENY');
  });

  it('uses specificity/priority deterministically and falls back on a true ambiguity', () => {
    const specific = resolveRuleConflicts(
      [candidate('advise', 'rule:generic', 100, 2), candidate('advise', 'rule:specific', 1, 10)],
      { policyDecision: 'allow', resolverVersion: 'resolver.1' },
    );
    expect(specific.selectedRuleRefs).toEqual(['rule:specific']);

    const ambiguous = resolveRuleConflicts(
      [candidate('advise', 'rule:a'), candidate('fallback', 'rule:b')],
      { policyDecision: 'allow', resolverVersion: 'resolver.1' },
    );
    expect(ambiguous.disposition).toBe('ambiguous_fallback');
    expect(ambiguous.selectedRuleRefs).toEqual([]);
  });

  it('combines only compatible non-authoritative advice', () => {
    const combined = resolveRuleConflicts(
      [candidate('advise', 'rule:a'), candidate('advise', 'rule:b')],
      { policyDecision: 'allow', resolverVersion: 'resolver.1' },
    );
    expect(combined.disposition).toBe('combined_compatible');
    expect(combined.selectedRuleRefs).toEqual(['rule:a', 'rule:b']);
  });

  it('does not combine plan patches that target the same formal plan node', () => {
    const patch = (ruleRef: string) => {
      const base = candidate('propose_plan_patch', ruleRef);
      return {
        ...base,
        evaluation: {
          ...base.evaluation,
          actionPayload: {
            patchOperations: [
              {
                operation: 'add_constraint',
                targetSkillGoalId: 'skill-goal:p09',
                value: `constraint:${ruleRef}`,
              },
            ],
          },
        },
      };
    };
    const resolution = resolveRuleConflicts([patch('rule:a'), patch('rule:b')], {
      policyDecision: 'allow',
      resolverVersion: 'resolver.1',
    });
    expect(resolution.disposition).toBe('ambiguous_fallback');
    expect(resolution.selectedRuleRefs).toEqual([]);
  });

  it('resolves a 1k bounded advice set deterministically within the local performance budget', () => {
    const candidates = Array.from({ length: 1_000 }, (_, index) =>
      candidate('advise', `rule:${String(index).padStart(4, '0')}`, index % 10, index % 5),
    );
    const startedAt = performance.now();
    const first = resolveRuleConflicts(candidates, {
      policyDecision: 'allow',
      resolverVersion: 'resolver.1',
    });
    const elapsedMs = performance.now() - startedAt;
    const second = resolveRuleConflicts([...candidates].reverse(), {
      policyDecision: 'allow',
      resolverVersion: 'resolver.1',
    });
    expect(second.resultHash).toBe(first.resultHash);
    expect(first.selectedRuleRefs).toEqual(['rule:0009']);
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

describe('P09 bounded plan patch', () => {
  const plan: UserGoalPlan = {
    schemaVersion: '1.0',
    planId: 'plan:p09',
    goalId: 'goal:p09',
    goalVersion: 1,
    revision: 1,
    revisionKind: 'initial',
    status: 'validated',
    contractHash: HASH_A,
    contentHash: HASH_B,
    skillGoals: [
      {
        skillGoalId: 'skill-goal:p09',
        requiredResult: 'Inspect the governed resource.',
        capabilityNeeds: ['capability:inspect'],
        coveredCriterionIds: ['criterion:p09'],
        requiredEffectRefs: ['effect:observed'],
        evidenceRequirements: ['evidence:p09'],
        artifactRequirements: ['artifact:p09'],
        assumptions: [],
        constraints: ['existing:constraint'],
        status: 'pending',
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: ['replay:p09'],
    createdAt: '2026-07-30T00:00:00.000Z',
  };

  it('adds only an explicitly conservative constraint and preserves formal authority fields', () => {
    const patch = createRulePlanPatchCandidate({
      goalContractRef: 'goal:p09',
      goalVersion: 1,
      planRef: 'plan:p09',
      planVersion: 1,
      sourceRuleRefs: ['rule:p09'],
      patchOperations: [
        {
          operation: 'add_constraint',
          targetSkillGoalId: 'skill-goal:p09',
          value: 'safety:require-current-readiness',
        },
        { operation: 'require_confirmation', value: 'confirmation:operator' },
      ],
      affectedCriterionRefs: ['criterion:p09'],
      requiredConfirmations: ['confirmation:operator'],
    });
    const revised = applyConservativeRulePlanPatch(plan, patch, '2026-07-30T00:00:01.000Z');
    expect(revised.revision).toBe(2);
    expect(revised.sourcePlanId).toBe(plan.planId);
    expect(revised.skillGoals[0]).toMatchObject({
      requiredResult: plan.skillGoals[0]?.requiredResult,
      capabilityNeeds: plan.skillGoals[0]?.capabilityNeeds,
      coveredCriterionIds: plan.skillGoals[0]?.coveredCriterionIds,
      requiredEffectRefs: plan.skillGoals[0]?.requiredEffectRefs,
    });
    expect(revised.skillGoals[0]?.constraints).toContain('safety:require-current-readiness');
    expect(revised.forbiddenReplayFingerprints).toEqual(plan.forbiddenReplayFingerprints);
  });

  it.each([
    'replace_goal',
    'replace_criterion',
    'expand_scope',
    'add_side_effect',
    'delete_human_gate',
    'grant_authorization',
  ])('rejects forbidden %s operations from Rule payload data', (operation) => {
    expect(() =>
      planPatchCandidateFromAction(
        {
          planPatchOperations: [{ operation, value: 'unsafe' }],
          affectedCriterionRefs: [],
          requiredConfirmations: [],
        },
        {
          goalContractRef: 'goal:p09',
          goalVersion: 1,
          planRef: 'plan:p09',
          planVersion: 1,
          sourceRuleRefs: ['rule:p09'],
        },
      ),
    ).toThrow('Goal, criterion, scope, authority or a human gate');
  });

  it('computes explainable specificity from tenant/domain/task/conditions', () => {
    expect(ruleSpecificity(artifact(), dsl())).toBeGreaterThan(40);
  });
});
