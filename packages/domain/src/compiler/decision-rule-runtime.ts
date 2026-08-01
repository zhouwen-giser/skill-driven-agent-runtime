import { hashCanonical as hashArtifactCanonical } from './artifact-shadow-governance.js';
import type {
  CompiledArtifact,
  ConditionExpression,
  DecisionRuleArtifactDefinition,
  JsonObject,
  JsonValue,
} from './contracts.js';

export const DECISION_RULE_RUNTIME_CONTRACT_VERSION = '1.1' as const;

export const DECISION_RULE_RUNTIME_SCHEMA_HASHES = Object.freeze({
  RuleDecisionContext: '151c3f7fafb1c7a8d3d6361feabdf924c5e96b8988ebfff887c8660b7efee77e',
  RuleConditionResult: '627bf8a47de6632abcfa0fe5abd5f197d1c37826636bf878f2b22da454442d82',
  RuleDecisionResult: '44c06ea58232e4713b695dc3d7082cd189a5e7b00fe94374c76c0af09e7a4f47',
  RuleConflictResolution: '03f47932366feffc992f3ffc991a51db71a71db5ea6eb3aeb79de9a13b223358',
  RulePlanPatchCandidate: 'a406785ef94494b4aabaead4556d0652e8929f3c5b8d44923cb45e49d74d3163',
  RuleRuntime: '77b30dc4384fbf082345b90280d01f15609b5aa1a166ab827825d5dee14efaca',
} as const);

export const RULE_RUNTIME_LIMITS = Object.freeze({
  maxDepth: 8,
  maxConditions: 128,
  maxStringLength: 1024,
  maxCollectionLength: 256,
  maxSafePatternLength: 128,
  maxPatchOperations: 16,
});

export const RULE_OPERAND_SOURCES = Object.freeze([
  'request',
  'confirmed_goal',
  'current_plan',
  'trusted_world_state',
  'business_event',
  'parameter_binding',
  'capability_status',
  'skill_availability',
  'provider_readiness',
  'policy_result',
  'authorization_claim',
  'time_bucket',
  'environment_class',
  'device_class',
] as const);

export const RULE_OPERATORS = Object.freeze([
  'eq',
  'neq',
  'in',
  'not_in',
  'exists',
  'not_exists',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'starts_with',
  'matches_safe_pattern',
  'within_range',
  'intersects',
  'is_ready',
  'is_authorized',
  'changed_since',
] as const);

export const RULE_ACTIONS = Object.freeze([
  'advise',
  'require_confirmation',
  'deny',
  'fallback',
  'suggest_parameter',
  'propose_plan_patch',
  'no_match',
] as const);

export type RuleTruthValue = 'true' | 'false' | 'unknown';
export type RuleOperandSource = (typeof RULE_OPERAND_SOURCES)[number];
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];
export type RuleConditionKind = 'required' | 'forbidden' | 'confirmation' | 'advisory';
export type RuleUnknownPolicy = 'no_match' | 'fallback' | 'require_confirmation';

export interface RuleDecisionContext {
  readonly requestRef: string;
  readonly goalContractRef?: string;
  readonly goalVersion?: number;
  readonly planRef?: string;
  readonly planVersion?: number;
  readonly artifactRef: string;
  readonly artifactVersion: number;
  readonly artifactHash: string;
  readonly activePointerVersion: number;
  readonly tenantId: string;
  readonly authorizationRefs: readonly string[];
  readonly requestSnapshotRef: string;
  readonly worldStateSnapshotRef?: string;
  readonly businessEventRefs: readonly string[];
  readonly parameterBindingRef: string;
  readonly capabilityReadinessRef: string;
  readonly policyDecisionRef: string;
  readonly dependencyValidationRef: string;
  readonly runtimeSnapshotHash: string;
}

export interface RuleConditionResult {
  readonly conditionId: string;
  readonly result: RuleTruthValue;
  readonly operandRefs: readonly string[];
  readonly observedValues: readonly unknown[];
  readonly operator: string;
  readonly reasonCodes: readonly string[];
}

export interface RuleDecisionResult {
  readonly evaluationId: string;
  readonly ruleRef: string;
  readonly ruleHash: string;
  readonly matched: boolean;
  readonly unknown: boolean;
  readonly conditionResults: readonly RuleConditionResult[];
  readonly proposedAction: RuleAction;
  readonly actionPayload?: JsonValue;
  readonly evaluatorVersion: string;
  readonly runtimeSnapshotHash: string;
  readonly resultHash: string;
  readonly createdAt: string;
}

/** The package prose used RuleEvaluationResult before the registry froze the canonical name. */
export type RuleEvaluationResult = RuleDecisionResult;

export interface RuleConflictResolution {
  readonly resolutionId: string;
  readonly evaluationRefs: readonly string[];
  readonly selectedRuleRefs: readonly string[];
  readonly suppressedRuleRefs: readonly string[];
  readonly disposition:
    | 'single_rule'
    | 'combined_compatible'
    | 'deny_overrides'
    | 'confirmation_overrides'
    | 'ambiguous_fallback'
    | 'no_match';
  readonly policySeverity: string;
  readonly specificityOrder: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly resolverVersion: string;
  readonly resultHash: string;
}

export type RulePlanPatchOperation =
  | Readonly<{
      readonly operation: 'add_constraint';
      readonly targetSkillGoalId: string;
      readonly value: string;
    }>
  | Readonly<{
      readonly operation: 'require_confirmation';
      readonly value: string;
    }>;

export interface RulePlanPatchCandidate {
  readonly patchCandidateId: string;
  readonly goalContractRef: string;
  readonly goalVersion: number;
  readonly planRef?: string;
  readonly planVersion?: number;
  readonly sourceRuleRefs: readonly string[];
  readonly patchOperations: readonly RulePlanPatchOperation[];
  readonly affectedCriterionRefs: readonly string[];
  readonly requiredConfirmations: readonly string[];
  readonly bounded: true;
  readonly contentHash: string;
}

export interface RuleRuntime {
  evaluate(input: RuleDecisionContext): Promise<RuleDecisionResult>;
}

export interface RuleAtomicCondition {
  readonly type: 'condition';
  readonly conditionId: string;
  readonly operandRef: string;
  readonly source: RuleOperandSource;
  readonly operator: RuleOperator;
  readonly expected?: JsonValue;
}

export type RuleExpression =
  | RuleAtomicCondition
  | Readonly<{
      readonly type: 'all' | 'any';
      readonly children: readonly RuleExpression[];
    }>
  | Readonly<{
      readonly type: 'not';
      readonly child: RuleExpression;
    }>;

export interface RuleRuntimeDsl {
  readonly version: '1.1';
  readonly required: readonly RuleExpression[];
  readonly forbidden: readonly RuleExpression[];
  readonly confirmation: readonly RuleExpression[];
  readonly advisory: readonly RuleExpression[];
  readonly unknownPolicy: RuleUnknownPolicy;
  readonly action: Readonly<{
    readonly type: Exclude<RuleAction, 'no_match'>;
    readonly payload?: JsonValue;
  }>;
}

export interface RuleOperandObservation {
  readonly operandRef: string;
  readonly source: RuleOperandSource;
  readonly value?: JsonValue;
  readonly trusted: boolean;
  readonly stale: boolean;
  readonly tenantId?: string;
  readonly observedAt?: string;
}

export interface RuleEvaluationInput {
  readonly context: RuleDecisionContext;
  readonly artifact: CompiledArtifact;
  readonly dsl: RuleRuntimeDsl;
  readonly operands: readonly RuleOperandObservation[];
  readonly evaluatorVersion: string;
  readonly createdAt: string;
}

export interface RuleConflictCandidate {
  readonly evaluation: RuleDecisionResult;
  readonly priority: number;
  readonly specificity: number;
  readonly artifactVersion: number;
  readonly conflictGroup?: string;
}

export const RULE_OPERATOR_CATALOG = Object.freeze(
  RULE_OPERATORS.map((operator) =>
    Object.freeze({
      operator,
      version: '1.1',
      nullPolicy:
        operator === 'exists' || operator === 'not_exists' ? 'null_is_present' : 'null_is_unknown',
      unknownPolicy: 'propagate',
      casePolicy: operator === 'matches_safe_pattern' ? 'literal_case_sensitive' : 'exact',
      localePolicy: 'none',
      bounds:
        operator === 'matches_safe_pattern'
          ? Object.freeze({ maxPatternLength: RULE_RUNTIME_LIMITS.maxSafePatternLength })
          : Object.freeze({ maxCollectionLength: RULE_RUNTIME_LIMITS.maxCollectionLength }),
    }),
  ),
);

export class DecisionRuleRuntimeError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, string>>;

  constructor(code: string, message: string, details: Readonly<Record<string, string>> = {}) {
    super(message);
    this.name = 'DecisionRuleRuntimeError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function parseRuleRuntimeDsl(artifact: CompiledArtifact): RuleRuntimeDsl {
  if (artifact.artifactType !== 'decision_rule' || !isDecisionRuleDefinition(artifact.definition)) {
    invalid('RULE_DEFINITION_INVALID', 'Artifact is not a decision_rule definition.');
  }
  const definition = artifact.definition;
  const raw = definition.decision.parameters['runtimeDsl'];
  const dsl =
    raw === undefined
      ? legacyDsl(artifact, definition)
      : parseExplicitDsl(raw, definition.decision.parameters);
  assertDslBounds(dsl);
  return deepFreeze(dsl);
}

export function evaluateDecisionRule(input: RuleEvaluationInput): RuleDecisionResult {
  assertContext(input.context);
  assertOperands(input.operands, input.context);
  if (input.artifact.artifactType !== 'decision_rule') {
    invalid('RULE_DEFINITION_INVALID', 'Only decision_rule Artifacts can be evaluated.');
  }
  if (
    input.artifact.version !== input.context.artifactVersion ||
    input.artifact.contentHash !== input.context.artifactHash
  ) {
    invalid('RULE_STALE', 'Rule version or hash does not match the immutable context.');
  }
  const observations = new Map(
    input.operands.map((operand) => [operand.operandRef, deepFreeze({ ...operand })]),
  );
  const evaluated = [
    ...evaluateGroup('forbidden', input.dsl.forbidden, observations, input.context),
    ...evaluateGroup('required', input.dsl.required, observations, input.context),
    ...evaluateGroup('confirmation', input.dsl.confirmation, observations, input.context),
    ...evaluateGroup('advisory', input.dsl.advisory, observations, input.context),
  ];
  const forbidden = evaluated.filter((item) => item.kind === 'forbidden');
  const required = evaluated.filter((item) => item.kind === 'required');
  const confirmation = evaluated.filter((item) => item.kind === 'confirmation');
  const forbiddenTrue = forbidden.some((item) => item.truth === 'true');
  const forbiddenUnknown = forbidden.some((item) => item.truth === 'unknown');
  const requiredFalse = required.some((item) => item.truth === 'false');
  const requiredUnknown = required.some((item) => item.truth === 'unknown');
  const confirmationRequired = confirmation.some(
    (item) => item.truth === 'true' || item.truth === 'unknown',
  );
  const unknown =
    forbiddenUnknown || requiredUnknown || evaluated.some((item) => item.truth === 'unknown');

  let matched = !requiredFalse && !requiredUnknown && !forbiddenTrue && !forbiddenUnknown;
  let proposedAction: RuleAction = matched ? input.dsl.action.type : 'no_match';
  let actionPayload = matched ? input.dsl.action.payload : undefined;
  if (forbiddenTrue) {
    matched = true;
    proposedAction = 'deny';
    actionPayload = undefined;
  } else if (forbiddenUnknown) {
    matched = false;
    proposedAction = 'require_confirmation';
    actionPayload = undefined;
  } else if (requiredUnknown) {
    matched = false;
    proposedAction = input.dsl.unknownPolicy;
    actionPayload = undefined;
  } else if (confirmationRequired && matched && proposedAction !== 'deny') {
    proposedAction = 'require_confirmation';
    actionPayload = undefined;
  }

  const conditionResults = Object.freeze(evaluated.map((item) => item.result));
  const stable = {
    ruleRef: input.context.artifactRef,
    ruleHash: input.context.artifactHash,
    matched,
    unknown,
    conditionResults,
    proposedAction,
    ...(actionPayload === undefined ? {} : { actionPayload }),
    evaluatorVersion: input.evaluatorVersion,
    runtimeSnapshotHash: input.context.runtimeSnapshotHash,
  };
  const resultHash = hashCanonical(stable);
  return deepFreeze({
    evaluationId: `p09-evaluation-${shortHash(
      `${input.context.artifactRef}:${input.context.artifactHash}:${input.context.runtimeSnapshotHash}:${input.evaluatorVersion}`,
    )}`,
    ...stable,
    resultHash,
    createdAt: input.createdAt,
  });
}

export function resolveRuleConflicts(
  candidates: readonly RuleConflictCandidate[],
  input: Readonly<{
    readonly policyDecision: 'allow' | 'deny' | 'require_confirmation';
    readonly resolverVersion: string;
  }>,
): RuleConflictResolution {
  const matched = candidates.filter(
    (candidate) =>
      candidate.evaluation.matched && candidate.evaluation.proposedAction !== 'no_match',
  );
  const ordered = [...matched].sort(compareConflictCandidate);
  const specificityOrder = Object.freeze(ordered.map((candidate) => candidate.evaluation.ruleRef));
  let selected: RuleConflictCandidate[] = [];
  let disposition: RuleConflictResolution['disposition'] = 'no_match';
  let reasonCodes: string[] = [];

  if (input.policyDecision === 'deny') {
    selected = ordered.slice(0, 1);
    disposition = 'deny_overrides';
    reasonCodes = ['RULE_POLICY_DENY', 'RULE_CONFLICT_DENY_OVERRIDES'];
  } else {
    const deny = ordered.filter((candidate) => candidate.evaluation.proposedAction === 'deny');
    const confirmation = ordered.filter(
      (candidate) => candidate.evaluation.proposedAction === 'require_confirmation',
    );
    if (deny.length > 0) {
      selected = deny.slice(0, 1);
      disposition = 'deny_overrides';
      reasonCodes = ['RULE_CONFLICT_DENY_OVERRIDES'];
    } else if (input.policyDecision === 'require_confirmation' || confirmation.length > 0) {
      selected = confirmation.slice(0, 1);
      if (selected.length === 0) selected = ordered.slice(0, 1);
      disposition = 'confirmation_overrides';
      reasonCodes = ['RULE_CONFLICT_CONFIRMATION_OVERRIDES'];
    } else if (ordered.length === 1) {
      selected = ordered;
      disposition = 'single_rule';
      reasonCodes = ['RULE_CONFLICT_MORE_SPECIFIC'];
    } else if (ordered.length > 1 && canCombine(ordered)) {
      selected = ordered;
      disposition = 'combined_compatible';
      reasonCodes = ['RULE_CONFLICT_COMPATIBLE_COMBINATION'];
    } else if (ordered.length > 1 && isAmbiguousConflict(ordered[0], ordered[1])) {
      selected = [];
      disposition = 'ambiguous_fallback';
      reasonCodes = ['RULE_CONFLICT_AMBIGUOUS'];
    } else if (ordered.length > 0) {
      selected = ordered.slice(0, 1);
      disposition = 'single_rule';
      reasonCodes =
        ordered[0]?.specificity !== ordered[1]?.specificity
          ? ['RULE_CONFLICT_MORE_SPECIFIC']
          : ['RULE_CONFLICT_PRIORITY'];
    }
  }

  const selectedRefs = Object.freeze(
    selected.map((candidate) => candidate.evaluation.ruleRef).sort(),
  );
  const suppressedRefs = Object.freeze(
    ordered
      .map((candidate) => candidate.evaluation.ruleRef)
      .filter((ruleRef) => !selectedRefs.includes(ruleRef))
      .sort(),
  );
  const stable = {
    evaluationRefs: Object.freeze(
      candidates.map((candidate) => candidate.evaluation.evaluationId).sort(),
    ),
    selectedRuleRefs: selectedRefs,
    suppressedRuleRefs: suppressedRefs,
    disposition,
    policySeverity: input.policyDecision,
    specificityOrder,
    reasonCodes: Object.freeze(reasonCodes.sort()),
    resolverVersion: input.resolverVersion,
  };
  const resultHash = hashCanonical(stable);
  return deepFreeze({
    resolutionId: `p09-resolution-${shortHash(resultHash)}`,
    ...stable,
    resultHash,
  });
}

export function createRulePlanPatchCandidate(
  input: Readonly<{
    readonly goalContractRef: string;
    readonly goalVersion: number;
    readonly planRef?: string;
    readonly planVersion?: number;
    readonly sourceRuleRefs: readonly string[];
    readonly patchOperations: readonly RulePlanPatchOperation[];
    readonly affectedCriterionRefs: readonly string[];
    readonly requiredConfirmations: readonly string[];
  }>,
): RulePlanPatchCandidate {
  assertIdentifier(input.goalContractRef, 'goalContractRef');
  assertPositiveVersion(input.goalVersion, 'goalVersion');
  if (input.planRef !== undefined) assertIdentifier(input.planRef, 'planRef');
  if (input.planVersion !== undefined) assertPositiveVersion(input.planVersion, 'planVersion');
  if (input.patchOperations.length === 0) {
    invalid('RULE_PLAN_PATCH_EMPTY', 'Plan patch must contain at least one operation.');
  }
  if (input.patchOperations.length > RULE_RUNTIME_LIMITS.maxPatchOperations) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', 'Plan patch operation bound exceeded.');
  }
  for (const operation of input.patchOperations) {
    if (operation.operation === 'add_constraint') {
      assertIdentifier(operation.targetSkillGoalId, 'targetSkillGoalId');
      assertBoundedString(operation.value, 'constraint');
      if (!/^(rule|policy|safety|confirmation):/u.test(operation.value)) {
        invalid(
          'RULE_PLAN_PATCH_SCOPE_EXPANSION',
          'A Rule constraint must be an explicitly conservative guard.',
        );
      }
    } else {
      assertBoundedString(operation.value, 'confirmation');
    }
  }
  const stable = {
    goalContractRef: input.goalContractRef,
    goalVersion: input.goalVersion,
    ...(input.planRef === undefined ? {} : { planRef: input.planRef }),
    ...(input.planVersion === undefined ? {} : { planVersion: input.planVersion }),
    sourceRuleRefs: Object.freeze(uniqueIdentifiers(input.sourceRuleRefs, 'sourceRuleRefs')),
    patchOperations: Object.freeze(input.patchOperations.map((operation) => deepFreeze(operation))),
    affectedCriterionRefs: Object.freeze(
      uniqueIdentifiers(input.affectedCriterionRefs, 'affectedCriterionRefs'),
    ),
    requiredConfirmations: Object.freeze(
      uniqueIdentifiers(input.requiredConfirmations, 'requiredConfirmations'),
    ),
    bounded: true as const,
  };
  const contentHash = hashCanonical(stable);
  return deepFreeze({
    patchCandidateId: `p09-patch-${shortHash(contentHash)}`,
    ...stable,
    contentHash,
  });
}

export function planPatchCandidateFromAction(
  actionPayload: JsonValue | undefined,
  input: Readonly<{
    readonly goalContractRef: string;
    readonly goalVersion: number;
    readonly planRef?: string;
    readonly planVersion?: number;
    readonly sourceRuleRefs: readonly string[];
  }>,
): RulePlanPatchCandidate {
  if (!isRecord(actionPayload)) {
    invalid('RULE_PLAN_PATCH_INVALID', 'Plan patch payload must be an object.');
  }
  const rawOperations = actionPayload['planPatchOperations'];
  if (!isJsonArray(rawOperations)) {
    invalid('RULE_PLAN_PATCH_INVALID', 'planPatchOperations must be an array.');
  }
  const patchOperations = rawOperations.map(parsePatchOperation);
  return createRulePlanPatchCandidate({
    ...input,
    patchOperations,
    affectedCriterionRefs: stringArray(actionPayload['affectedCriterionRefs']),
    requiredConfirmations: stringArray(actionPayload['requiredConfirmations']),
  });
}

export interface RulePatchablePlan {
  readonly planId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly revision: number;
  readonly contentHash: string;
  readonly skillGoals: readonly Readonly<{
    readonly skillGoalId: string;
    readonly constraints: readonly string[];
  }>[];
}

export function applyConservativeRulePlanPatch<TPlan extends RulePatchablePlan>(
  plan: TPlan,
  candidate: RulePlanPatchCandidate,
  createdAt: string,
): TPlan {
  if (
    plan.goalId !== candidate.goalContractRef ||
    plan.goalVersion !== candidate.goalVersion ||
    (candidate.planRef !== undefined && candidate.planRef !== plan.planId) ||
    (candidate.planVersion !== undefined && candidate.planVersion !== plan.revision)
  ) {
    invalid('RULE_PLAN_PATCH_STALE', 'Plan patch target does not match the current formal plan.');
  }
  if (plan.revision >= 4) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', 'Formal plan revision bound exceeded.');
  }
  const constraints = new Map<string, string[]>();
  for (const operation of candidate.patchOperations) {
    if (operation.operation !== 'add_constraint') continue;
    const goal = plan.skillGoals.find((item) => item.skillGoalId === operation.targetSkillGoalId);
    if (goal === undefined) {
      invalid('RULE_PLAN_PATCH_TARGET_MISSING', 'Patch target Skill Goal does not exist.');
    }
    const values = constraints.get(goal.skillGoalId) ?? [];
    values.push(operation.value);
    constraints.set(goal.skillGoalId, values);
  }
  const withoutHash = {
    ...plan,
    planId: `p09-plan-${shortHash(`${plan.planId}:${candidate.contentHash}`)}`,
    revision: plan.revision + 1,
    revisionKind: 'user_revision' as const,
    sourcePlanId: plan.planId,
    status: 'validated' as const,
    skillGoals: plan.skillGoals.map((goal) => ({
      ...goal,
      constraints: Object.freeze(
        unique([...goal.constraints, ...(constraints.get(goal.skillGoalId) ?? [])]),
      ),
    })),
    createdAt,
  };
  const next = {
    ...withoutHash,
    contentHash: hashCanonical({ ...withoutHash, contentHash: undefined }),
  };
  return deepFreeze(next);
}

export function ruleSpecificity(artifact: CompiledArtifact, dsl: RuleRuntimeDsl): number {
  return (
    (artifact.scope.tenantId === undefined ? 0 : 32) +
    (artifact.scope.domain.trim() === '' ? 0 : 16) +
    Math.min(8, artifact.scope.taskTypeIds.length) * 4 +
    Math.min(
      32,
      countConditions([...dsl.required, ...dsl.forbidden, ...dsl.confirmation, ...dsl.advisory]),
    )
  );
}

export function hashRuleRuntimeValue(value: unknown): string {
  return hashCanonical(value);
}

interface EvaluatedGroupItem {
  readonly kind: RuleConditionKind;
  readonly truth: RuleTruthValue;
  readonly result: RuleConditionResult;
}

function evaluateGroup(
  kind: RuleConditionKind,
  expressions: readonly RuleExpression[],
  observations: ReadonlyMap<string, RuleOperandObservation>,
  context: RuleDecisionContext,
): readonly EvaluatedGroupItem[] {
  return expressions.map((expression, index) => {
    const evaluation = evaluateExpression(expression, observations, context, 1);
    return {
      kind,
      truth: evaluation.truth,
      result: deepFreeze({
        conditionId:
          expression.type === 'condition'
            ? expression.conditionId
            : `${kind}:group:${String(index)}`,
        result: evaluation.truth,
        operandRefs: Object.freeze(unique(evaluation.operandRefs)),
        observedValues: Object.freeze(evaluation.observedValues),
        operator: expression.type,
        reasonCodes: Object.freeze(
          unique([
            ...evaluation.reasonCodes.filter(
              (code) =>
                !['RULE_REQUIRED_TRUE', 'RULE_REQUIRED_FALSE', 'RULE_REQUIRED_UNKNOWN'].includes(
                  code,
                ),
            ),
            conditionReasonCode(kind, evaluation.truth),
          ]),
        ),
      }),
    };
  });
}

interface ExpressionEvaluation {
  readonly truth: RuleTruthValue;
  readonly operandRefs: readonly string[];
  readonly observedValues: readonly unknown[];
  readonly reasonCodes: readonly string[];
}

function evaluateExpression(
  expression: RuleExpression,
  observations: ReadonlyMap<string, RuleOperandObservation>,
  context: RuleDecisionContext,
  depth: number,
): ExpressionEvaluation {
  if (depth > RULE_RUNTIME_LIMITS.maxDepth) {
    return unknownExpression([], [], ['RULE_EVALUATION_BOUND_EXCEEDED']);
  }
  if (expression.type === 'condition') {
    const observation = observations.get(expression.operandRef);
    if (observation === undefined) {
      if (expression.operator === 'exists' || expression.operator === 'not_exists') {
        return {
          truth: expression.operator === 'exists' ? 'false' : 'true',
          operandRefs: [expression.operandRef],
          observedValues: [null],
          reasonCodes: [
            expression.operator === 'exists' ? 'RULE_REQUIRED_FALSE' : 'RULE_REQUIRED_TRUE',
          ],
        };
      }
      return unknownExpression([expression.operandRef], [null], ['RULE_REQUIRED_UNKNOWN']);
    }
    if (
      observation.source !== expression.source ||
      !observation.trusted ||
      observation.stale ||
      (observation.tenantId !== undefined && observation.tenantId !== context.tenantId)
    ) {
      return unknownExpression(
        [expression.operandRef],
        [observation.value ?? null],
        ['RULE_REQUIRED_UNKNOWN'],
      );
    }
    const truth = evaluateOperator(expression, observation);
    return {
      truth,
      operandRefs: [expression.operandRef],
      observedValues: [observation.value ?? null],
      reasonCodes:
        truth === 'unknown'
          ? ['RULE_OPERATOR_TYPE_MISMATCH']
          : [truth === 'true' ? 'RULE_REQUIRED_TRUE' : 'RULE_REQUIRED_FALSE'],
    };
  }
  if (expression.type === 'not') {
    const child = evaluateExpression(expression.child, observations, context, depth + 1);
    return {
      ...child,
      truth: child.truth === 'true' ? 'false' : child.truth === 'false' ? 'true' : 'unknown',
    };
  }
  const children = expression.children.map((child) =>
    evaluateExpression(child, observations, context, depth + 1),
  );
  const truths = children.map((child) => child.truth);
  const truth =
    expression.type === 'all'
      ? truths.includes('false')
        ? 'false'
        : truths.includes('unknown')
          ? 'unknown'
          : 'true'
      : truths.includes('true')
        ? 'true'
        : truths.includes('unknown')
          ? 'unknown'
          : 'false';
  return {
    truth,
    operandRefs: children.flatMap((child) => child.operandRefs),
    observedValues: children.flatMap((child) => child.observedValues),
    reasonCodes: children.flatMap((child) => child.reasonCodes),
  };
}

function evaluateOperator(
  condition: RuleAtomicCondition,
  observation: RuleOperandObservation,
): RuleTruthValue {
  const actual = observation.value;
  if (condition.operator === 'exists') return actual === undefined ? 'false' : 'true';
  if (condition.operator === 'not_exists') return actual === undefined ? 'true' : 'false';
  if (actual === undefined || actual === null) return 'unknown';
  const expected = condition.expected;
  switch (condition.operator) {
    case 'eq':
      return expected === undefined ? 'unknown' : truth(canonical(actual) === canonical(expected));
    case 'neq':
      return expected === undefined ? 'unknown' : truth(canonical(actual) !== canonical(expected));
    case 'in':
    case 'not_in': {
      if (!isJsonArray(expected)) return 'unknown';
      const included = expected.some((item) => canonical(item) === canonical(actual));
      return truth(condition.operator === 'in' ? included : !included);
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof expected !== 'number') return 'unknown';
      if (condition.operator === 'gt') return truth(actual > expected);
      if (condition.operator === 'gte') return truth(actual >= expected);
      if (condition.operator === 'lt') return truth(actual < expected);
      return truth(actual <= expected);
    }
    case 'contains': {
      if (typeof actual === 'string' && typeof expected === 'string') {
        return truth(actual.includes(expected));
      }
      if (isJsonArray(actual) && expected !== undefined) {
        return truth(actual.some((item) => canonical(item) === canonical(expected)));
      }
      return 'unknown';
    }
    case 'starts_with':
      return typeof actual === 'string' && typeof expected === 'string'
        ? truth(actual.startsWith(expected))
        : 'unknown';
    case 'matches_safe_pattern':
      return typeof actual === 'string' && typeof expected === 'string'
        ? truth(safePatternMatches(actual, expected))
        : 'unknown';
    case 'within_range':
      return typeof actual === 'number' &&
        isJsonArray(expected) &&
        expected.length === 2 &&
        typeof expected[0] === 'number' &&
        typeof expected[1] === 'number'
        ? truth(actual >= expected[0] && actual <= expected[1])
        : 'unknown';
    case 'intersects':
      return isJsonArray(actual) && isJsonArray(expected)
        ? truth(
            actual.some((left) => expected.some((right) => canonical(left) === canonical(right))),
          )
        : 'unknown';
    case 'is_ready':
      return typeof actual === 'string' ? truth(actual === 'ready') : 'unknown';
    case 'is_authorized':
      if (typeof actual === 'boolean') return truth(actual);
      return isJsonArray(actual) && expected !== undefined
        ? truth(actual.some((item) => canonical(item) === canonical(expected)))
        : 'unknown';
    case 'changed_since':
      return typeof actual === 'string' &&
        typeof expected === 'string' &&
        Number.isFinite(Date.parse(actual)) &&
        Number.isFinite(Date.parse(expected))
        ? truth(Date.parse(actual) >= Date.parse(expected))
        : 'unknown';
    default:
      return 'unknown';
  }
}

function parseExplicitDsl(raw: JsonValue, parameters: JsonObject): RuleRuntimeDsl {
  if (!isRecord(raw) || raw['version'] !== '1.1') {
    invalid('RULE_DSL_INVALID', 'runtimeDsl must be a version 1.1 object.');
  }
  const unknownPolicy = raw['unknownPolicy'] ?? 'no_match';
  if (!isUnknownPolicy(unknownPolicy)) {
    invalid('RULE_DSL_INVALID', 'runtimeDsl unknown policy is invalid.');
  }
  const actionRaw = raw['action'];
  const fallbackAction = actionFromParameters(parameters);
  const action = actionRaw === undefined ? fallbackAction : parseRuntimeAction(actionRaw);
  return {
    version: '1.1',
    required: parseExpressionArray(raw['required'], 'required'),
    forbidden: parseExpressionArray(raw['forbidden'], 'forbidden'),
    confirmation: parseExpressionArray(raw['confirmation'], 'confirmation'),
    advisory: parseExpressionArray(raw['advisory'], 'advisory'),
    unknownPolicy,
    action,
  };
}

function parseRuntimeAction(raw: JsonValue): RuleRuntimeDsl['action'] {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') {
    invalid('RULE_DSL_INVALID', 'Rule action must be an object with a type.');
  }
  if (!RULE_ACTIONS.includes(raw['type'] as RuleAction) || raw['type'] === 'no_match') {
    invalid('RULE_DSL_INVALID', 'Rule action is forbidden or unsupported.');
  }
  const payload = raw['payload'];
  return {
    type: raw['type'] as Exclude<RuleAction, 'no_match'>,
    ...(payload === undefined ? {} : { payload }),
  };
}

function parseExpressionArray(
  raw: JsonValue | undefined,
  group: RuleConditionKind,
): readonly RuleExpression[] {
  if (raw === undefined) return Object.freeze([]);
  if (!isJsonArray(raw)) invalid('RULE_DSL_INVALID', `${group} conditions must be an array.`);
  return Object.freeze(
    raw.map((item, index) => parseExpression(item, `${group}:${String(index)}`)),
  );
}

function parseExpression(raw: JsonValue, path: string): RuleExpression {
  if (!isRecord(raw) || typeof raw['type'] !== 'string') {
    invalid('RULE_DSL_INVALID', `Rule expression ${path} must be an object.`);
  }
  if (raw['type'] === 'all' || raw['type'] === 'any') {
    const children = raw['children'];
    if (!isJsonArray(children) || children.length === 0) {
      invalid('RULE_DSL_INVALID', `Logical expression ${path} requires children.`);
    }
    return {
      type: raw['type'],
      children: Object.freeze(
        children.map((child, index) => parseExpression(child, `${path}:${String(index)}`)),
      ),
    };
  }
  if (raw['type'] === 'not') {
    const child = raw['child'];
    if (child === undefined) invalid('RULE_DSL_INVALID', `Not expression ${path} requires child.`);
    return { type: 'not', child: parseExpression(child, `${path}:not`) };
  }
  if (raw['type'] !== 'condition') {
    invalid('RULE_DSL_INVALID', `Expression ${path} has an unsupported type.`);
  }
  const conditionId = raw['conditionId'];
  const operandRef = raw['operandRef'];
  const source = raw['source'];
  const operator = raw['operator'];
  if (
    typeof conditionId !== 'string' ||
    typeof operandRef !== 'string' ||
    typeof source !== 'string' ||
    typeof operator !== 'string' ||
    !RULE_OPERAND_SOURCES.includes(source as RuleOperandSource) ||
    !RULE_OPERATORS.includes(operator as RuleOperator)
  ) {
    invalid('RULE_DSL_INVALID', `Condition ${path} has invalid typed fields.`);
  }
  assertIdentifier(conditionId, 'conditionId');
  assertOperandRef(operandRef);
  const expected = raw['expected'];
  if (
    operator === 'matches_safe_pattern' &&
    (typeof expected !== 'string' || !isSafePattern(expected))
  ) {
    invalid('RULE_DSL_INVALID', 'Safe pattern is invalid or exceeds its bound.');
  }
  return {
    type: 'condition',
    conditionId,
    operandRef,
    source: source as RuleOperandSource,
    operator: operator as RuleOperator,
    ...(expected === undefined ? {} : { expected }),
  };
}

function legacyDsl(
  artifact: CompiledArtifact,
  definition: DecisionRuleArtifactDefinition,
): RuleRuntimeDsl {
  const required = artifact.applicability.requiredConditions.map((condition, index) =>
    legacyExpression(condition, `applicability-required-${String(index)}`),
  );
  const forbidden = artifact.applicability.forbiddenConditions.map((condition, index) =>
    legacyExpression(condition, `applicability-forbidden-${String(index)}`),
  );
  const advisory = artifact.applicability.optionalConditions.map((condition, index) =>
    legacyExpression(condition, `applicability-advisory-${String(index)}`),
  );
  const primary = legacyExpression(definition.condition, 'decision-condition');
  const confirmation =
    definition.category === 'confirmation' ||
    definition.decision.decisionType === 'require_confirmation'
      ? [primary]
      : [];
  if (confirmation.length === 0) required.push(primary);
  return {
    version: '1.1',
    required: Object.freeze(required),
    forbidden: Object.freeze(forbidden),
    confirmation: Object.freeze(confirmation),
    advisory: Object.freeze(advisory),
    unknownPolicy: definition.category === 'confirmation' ? 'require_confirmation' : 'no_match',
    action: actionFromDefinition(definition),
  };
}

function legacyExpression(expression: ConditionExpression, id: string): RuleExpression {
  if (expression.type === 'all' || expression.type === 'any') {
    return {
      type: expression.type,
      children: Object.freeze(
        expression.children.map((child, index) =>
          legacyExpression(child, `${id}-${String(index)}`),
        ),
      ),
    };
  }
  if (expression.type === 'not') {
    return { type: 'not', child: legacyExpression(expression.child, `${id}-not`) };
  }
  const atomic = expression as Extract<ConditionExpression, { readonly type: 'atomic' }>;
  return {
    type: 'condition',
    conditionId: id,
    operandRef: atomic.field,
    source: sourceForLegacyField(atomic.field),
    operator: atomic.operator,
    ...(atomic.value === undefined ? {} : { expected: atomic.value }),
  };
}

function actionFromDefinition(
  definition: DecisionRuleArtifactDefinition,
): RuleRuntimeDsl['action'] {
  const explicit = actionFromParameters(definition.decision.parameters);
  if (definition.decision.parameters['action'] !== undefined) return explicit;
  if (definition.decision.decisionType === 'require_confirmation') {
    return { type: 'require_confirmation', payload: definition.decision.parameters };
  }
  if (definition.decision.decisionType === 'degrade') {
    return { type: 'fallback', payload: definition.decision.parameters };
  }
  if (
    (definition.decision.decisionType === 'select_template' ||
      definition.decision.decisionType === 'select_recovery') &&
    isJsonArray(definition.decision.parameters['planPatchOperations'])
  ) {
    return { type: 'propose_plan_patch', payload: definition.decision.parameters };
  }
  if (definition.decision.decisionType === 'select_recovery') {
    return { type: 'fallback', payload: definition.decision.parameters };
  }
  if (definition.decision.decisionType === 'set_risk') {
    const risk = definition.decision.parameters['risk'];
    if (risk === 'critical') return { type: 'deny', payload: definition.decision.parameters };
    if (risk === 'high') {
      return { type: 'require_confirmation', payload: definition.decision.parameters };
    }
  }
  return { type: 'advise', payload: definition.decision.parameters };
}

function actionFromParameters(parameters: JsonObject): RuleRuntimeDsl['action'] {
  const action = parameters['action'];
  if (typeof action !== 'string') return { type: 'advise', payload: parameters };
  if (!RULE_ACTIONS.includes(action as RuleAction) || action === 'no_match') {
    invalid('RULE_DSL_INVALID', 'Decision parameters request a forbidden action.');
  }
  return { type: action as Exclude<RuleAction, 'no_match'>, payload: parameters };
}

function sourceForLegacyField(field: string): RuleOperandSource {
  const prefix = field.split('.')[0]?.toLocaleLowerCase();
  switch (prefix) {
    case 'goal':
      return 'confirmed_goal';
    case 'plan':
      return 'current_plan';
    case 'world':
      return 'trusted_world_state';
    case 'event':
      return 'business_event';
    case 'parameter':
      return 'parameter_binding';
    case 'capability':
      return 'capability_status';
    case 'skill':
      return 'skill_availability';
    case 'provider':
      return 'provider_readiness';
    case 'policy':
      return 'policy_result';
    case 'authorization':
      return 'authorization_claim';
    case 'time':
      return 'time_bucket';
    case 'environment':
      return 'environment_class';
    case 'device':
      return 'device_class';
    default:
      return 'request';
  }
}

function assertDslBounds(dsl: RuleRuntimeDsl): void {
  const expressions = [...dsl.required, ...dsl.forbidden, ...dsl.confirmation, ...dsl.advisory];
  const conditions = countConditions(expressions);
  if (conditions > RULE_RUNTIME_LIMITS.maxConditions) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', 'Rule condition bound exceeded.');
  }
  for (const expression of expressions) assertExpressionBounds(expression, 1);
  assertRuleAction(dsl.action);
}

function assertExpressionBounds(expression: RuleExpression, depth: number): void {
  if (depth > RULE_RUNTIME_LIMITS.maxDepth) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', 'Rule expression depth exceeded.');
  }
  if (expression.type === 'condition') {
    if (expression.expected !== undefined) {
      assertJsonBounds(expression.expected, 1, 'Rule expected operand');
    }
    return;
  }
  if (expression.type === 'not') {
    assertExpressionBounds(expression.child, depth + 1);
    return;
  }
  if (
    expression.children.length === 0 ||
    expression.children.length > RULE_RUNTIME_LIMITS.maxCollectionLength
  ) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', 'Logical child bound exceeded.');
  }
  expression.children.forEach((child) => {
    assertExpressionBounds(child, depth + 1);
  });
}

function countConditions(expressions: readonly RuleExpression[]): number {
  return expressions.reduce((total, expression) => {
    if (expression.type === 'condition') return total + 1;
    if (expression.type === 'not') return total + countConditions([expression.child]);
    return total + countConditions(expression.children);
  }, 0);
}

function compareConflictCandidate(
  left: RuleConflictCandidate,
  right: RuleConflictCandidate,
): number {
  const severity =
    actionSeverity(right.evaluation.proposedAction) -
    actionSeverity(left.evaluation.proposedAction);
  if (severity !== 0) return severity;
  if (right.specificity !== left.specificity) return right.specificity - left.specificity;
  if (right.priority !== left.priority) return right.priority - left.priority;
  if (right.artifactVersion !== left.artifactVersion) {
    return right.artifactVersion - left.artifactVersion;
  }
  return left.evaluation.ruleRef.localeCompare(right.evaluation.ruleRef);
}

function actionSeverity(action: RuleAction): number {
  if (action === 'deny') return 6;
  if (action === 'require_confirmation') return 5;
  if (action === 'fallback') return 4;
  if (action === 'propose_plan_patch') return 3;
  if (action === 'suggest_parameter') return 2;
  if (action === 'advise') return 1;
  return 0;
}

function canCombine(candidates: readonly RuleConflictCandidate[]): boolean {
  const first = candidates[0];
  if (
    first === undefined ||
    candidates.some(
      (candidate) =>
        candidate.evaluation.proposedAction !== first.evaluation.proposedAction ||
        candidate.specificity !== first.specificity,
    )
  ) {
    return false;
  }
  if (
    candidates.some(
      (candidate) =>
        candidate.evaluation.proposedAction === 'deny' ||
        candidate.evaluation.proposedAction === 'require_confirmation' ||
        candidate.evaluation.proposedAction === 'fallback',
    )
  ) {
    return false;
  }
  const groups = candidates
    .map((candidate) => candidate.conflictGroup)
    .filter((group): group is string => group !== undefined);
  if (new Set(groups).size !== groups.length) return false;
  const parameterNames = new Set<string>();
  const patchTargets = new Set<string>();
  for (const candidate of candidates) {
    const payload = candidate.evaluation.actionPayload;
    if (candidate.evaluation.proposedAction === 'suggest_parameter') {
      if (!isRecord(payload) || typeof payload['parameterName'] !== 'string') return false;
      if (parameterNames.has(payload['parameterName'])) return false;
      parameterNames.add(payload['parameterName']);
    }
    if (candidate.evaluation.proposedAction === 'propose_plan_patch') {
      if (!isRecord(payload) || !isJsonArray(payload['patchOperations'])) return false;
      for (const raw of payload['patchOperations']) {
        if (!isRecord(raw) || typeof raw['operation'] !== 'string') return false;
        const target =
          raw['operation'] === 'add_constraint' && typeof raw['targetSkillGoalId'] === 'string'
            ? `constraint:${raw['targetSkillGoalId']}`
            : raw['operation'] === 'require_confirmation' && typeof raw['value'] === 'string'
              ? `confirmation:${raw['value']}`
              : undefined;
        if (target === undefined || patchTargets.has(target)) return false;
        patchTargets.add(target);
      }
    }
  }
  return true;
}

function conditionReasonCode(kind: RuleConditionKind, truth: RuleTruthValue): string {
  if (kind === 'forbidden') {
    return truth === 'true'
      ? 'RULE_FORBIDDEN_TRUE'
      : truth === 'false'
        ? 'RULE_FORBIDDEN_FALSE'
        : 'RULE_REQUIRED_UNKNOWN';
  }
  if (kind === 'confirmation') {
    return truth === 'true'
      ? 'RULE_CONFIRMATION_TRUE'
      : truth === 'unknown'
        ? 'RULE_CONFIRMATION_UNKNOWN'
        : 'RULE_REQUIRED_FALSE';
  }
  if (kind === 'advisory') {
    return truth === 'true'
      ? 'RULE_ADVISORY_TRUE'
      : truth === 'unknown'
        ? 'RULE_REQUIRED_UNKNOWN'
        : 'RULE_REQUIRED_FALSE';
  }
  return truth === 'true'
    ? 'RULE_REQUIRED_TRUE'
    : truth === 'false'
      ? 'RULE_REQUIRED_FALSE'
      : 'RULE_REQUIRED_UNKNOWN';
}

function isAmbiguousConflict(
  first: RuleConflictCandidate | undefined,
  second: RuleConflictCandidate | undefined,
): boolean {
  if (first === undefined || second === undefined) return false;
  return (
    first.specificity === second.specificity &&
    first.priority === second.priority &&
    first.artifactVersion === second.artifactVersion &&
    (first.evaluation.proposedAction !== second.evaluation.proposedAction ||
      !canCombine([first, second]))
  );
}

function parsePatchOperation(raw: JsonValue): RulePlanPatchOperation {
  if (!isRecord(raw) || typeof raw['operation'] !== 'string') {
    invalid('RULE_PLAN_PATCH_INVALID', 'Patch operation must be an object.');
  }
  if (raw['operation'] === 'add_constraint') {
    if (typeof raw['targetSkillGoalId'] !== 'string' || typeof raw['value'] !== 'string') {
      invalid('RULE_PLAN_PATCH_INVALID', 'Constraint patch fields are invalid.');
    }
    return {
      operation: 'add_constraint',
      targetSkillGoalId: raw['targetSkillGoalId'],
      value: raw['value'],
    };
  }
  if (raw['operation'] === 'require_confirmation') {
    if (typeof raw['value'] !== 'string') {
      invalid('RULE_PLAN_PATCH_INVALID', 'Confirmation patch value is invalid.');
    }
    return { operation: 'require_confirmation', value: raw['value'] };
  }
  invalid(
    'RULE_PLAN_PATCH_SCOPE_EXPANSION',
    'Rule patch operation would change Goal, criterion, scope, authority or a human gate.',
  );
}

function assertContext(context: RuleDecisionContext): void {
  for (const [value, field] of [
    [context.requestRef, 'requestRef'],
    [context.artifactRef, 'artifactRef'],
    [context.tenantId, 'tenantId'],
    [context.requestSnapshotRef, 'requestSnapshotRef'],
    [context.parameterBindingRef, 'parameterBindingRef'],
    [context.capabilityReadinessRef, 'capabilityReadinessRef'],
    [context.policyDecisionRef, 'policyDecisionRef'],
    [context.dependencyValidationRef, 'dependencyValidationRef'],
  ] as const) {
    assertIdentifier(value, field);
  }
  assertPositiveVersion(context.artifactVersion, 'artifactVersion');
  assertPositiveVersion(context.activePointerVersion, 'activePointerVersion', true);
  assertSha256(context.artifactHash, 'artifactHash');
  assertSha256(context.runtimeSnapshotHash, 'runtimeSnapshotHash');
  if (context.goalVersion !== undefined) assertPositiveVersion(context.goalVersion, 'goalVersion');
  if (context.planVersion !== undefined) assertPositiveVersion(context.planVersion, 'planVersion');
  uniqueIdentifiers(context.authorizationRefs, 'authorizationRefs');
  uniqueIdentifiers(context.businessEventRefs, 'businessEventRefs');
}

function assertOperands(
  operands: readonly RuleOperandObservation[],
  context: RuleDecisionContext,
): void {
  if (operands.length > RULE_RUNTIME_LIMITS.maxCollectionLength) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', 'Rule operand collection bound exceeded.');
  }
  const refs = new Set<string>();
  for (const operand of operands) {
    assertOperandRef(operand.operandRef);
    if (refs.has(operand.operandRef)) {
      invalid('RULE_DSL_INVALID', 'Rule operand references must be unique.');
    }
    refs.add(operand.operandRef);
    if (!RULE_OPERAND_SOURCES.includes(operand.source)) {
      invalid('RULE_DSL_INVALID', 'Rule operand source is not allowed.');
    }
    if (operand.tenantId !== undefined && operand.tenantId !== context.tenantId) {
      invalid('RULE_TENANT_MISMATCH', 'Rule operand crossed the tenant boundary.');
    }
    if (operand.value !== undefined) {
      assertJsonBounds(operand.value, 1, 'Rule operand');
    }
  }
}

function assertRuleAction(action: RuleRuntimeDsl['action']): void {
  if (action.payload !== undefined) {
    assertJsonBounds(action.payload, 1, 'Rule action payload');
  }
  if (action.type === 'suggest_parameter') {
    const payload = action.payload;
    if (
      !isRecord(payload) ||
      typeof payload['parameterName'] !== 'string' ||
      payload['riskLevel'] !== 'low' ||
      payload['requiresConfirmation'] !== true ||
      /(authorization|tenant|scope|policy|capability|skill|provider|goal|criterion|effect)/iu.test(
        payload['parameterName'],
      )
    ) {
      invalid(
        'RULE_PARAMETER_SUGGESTION_UNSAFE',
        'Parameter suggestions must be low-risk, confirmation-bound, and non-authoritative.',
      );
    }
  }
  if (action.type === 'propose_plan_patch') {
    const payload = action.payload;
    if (
      !isRecord(payload) ||
      !isJsonArray(payload['planPatchOperations']) ||
      !isJsonArray(payload['requiredConfirmations']) ||
      payload['requiredConfirmations'].length === 0
    ) {
      invalid(
        'RULE_PLAN_PATCH_INVALID',
        'Plan patches require bounded operations and an explicit confirmation gate.',
      );
    }
    payload['planPatchOperations'].forEach(parsePatchOperation);
    stringArray(payload['requiredConfirmations']);
    stringArray(payload['affectedCriterionRefs']);
  }
}

function assertJsonBounds(value: JsonValue, depth: number, field: string): void {
  if (depth > RULE_RUNTIME_LIMITS.maxDepth) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', `${field} depth bound exceeded.`);
  }
  if (typeof value === 'string') {
    assertBoundedString(value, field);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      invalid('RULE_DSL_INVALID', `${field} contains a non-finite number.`);
    }
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (isJsonArray(value)) {
    if (value.length > RULE_RUNTIME_LIMITS.maxCollectionLength) {
      invalid('RULE_EVALUATION_BOUND_EXCEEDED', `${field} collection bound exceeded.`);
    }
    value.forEach((item) => {
      assertJsonBounds(item, depth + 1, field);
    });
    return;
  }
  const entries = Object.entries(value);
  if (entries.length > RULE_RUNTIME_LIMITS.maxCollectionLength) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', `${field} object bound exceeded.`);
  }
  for (const [key, item] of entries) {
    assertBoundedString(key, `${field} key`);
    assertJsonBounds(item, depth + 1, field);
  }
}

function assertOperandRef(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,255}$/u.test(value)) {
    invalid('RULE_DSL_INVALID', 'Operand reference is invalid.');
  }
}

function assertIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value)) {
    invalid('RULE_DSL_INVALID', `${field} is invalid.`);
  }
}

function assertPositiveVersion(value: number, field: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    invalid('RULE_DSL_INVALID', `${field} must be a bounded version.`);
  }
}

function assertSha256(value: string, field: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    invalid('RULE_DSL_INVALID', `${field} must be a canonical SHA-256 value.`);
  }
}

function assertBoundedString(value: string, field: string): void {
  if (value.trim() === '' || value.length > RULE_RUNTIME_LIMITS.maxStringLength) {
    invalid('RULE_EVALUATION_BOUND_EXCEEDED', `${field} string bound exceeded.`);
  }
}

function uniqueIdentifiers(values: readonly string[], field: string): readonly string[] {
  values.forEach((value) => {
    assertIdentifier(value, field);
  });
  return unique(values);
}

function stringArray(value: JsonValue | undefined): readonly string[] {
  if (value === undefined) return [];
  if (!isJsonArray(value) || value.some((item) => typeof item !== 'string')) {
    invalid('RULE_PLAN_PATCH_INVALID', 'Expected a string array.');
  }
  return value as readonly string[];
}

function isSafePattern(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= RULE_RUNTIME_LIMITS.maxSafePatternLength &&
    /^[\p{L}\p{N}\p{Zs}._:/?*+-]+$/u.test(value) &&
    !/\*{2,}|\?{3,}/u.test(value)
  );
}

function safePatternMatches(actual: string, pattern: string): boolean {
  if (!isSafePattern(pattern)) return false;
  const escaped = pattern.replace(/[\\^$.[\]{}()|+]/gu, '\\$&');
  const source = escaped.replace(/\*/gu, '.*').replace(/\?/gu, '.');
  return new RegExp(`^${source}$`, 'u').test(actual);
}

function unknownExpression(
  operandRefs: readonly string[],
  observedValues: readonly unknown[],
  reasonCodes: readonly string[],
): ExpressionEvaluation {
  return { truth: 'unknown', operandRefs, observedValues, reasonCodes };
}

function truth(value: boolean): RuleTruthValue {
  return value ? 'true' : 'false';
}

function isUnknownPolicy(value: JsonValue): value is RuleUnknownPolicy {
  return value === 'no_match' || value === 'fallback' || value === 'require_confirmation';
}

function isDecisionRuleDefinition(
  value: CompiledArtifact['definition'],
): value is DecisionRuleArtifactDefinition {
  return 'condition' in value && 'decision' in value && 'conflictPolicy' in value;
}

function isRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function canonical(value: JsonValue): string {
  return canonicalJson(value);
}

function hashCanonical(value: unknown): string {
  return hashArtifactCanonical(value);
}

function shortHash(value: string): string {
  return hashArtifactCanonical(value).slice('sha256:'.length, 'sha256:'.length + 24);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Readonly<Record<string, unknown>>)) {
    deepFreeze(child);
  }
  return value;
}

function invalid(code: string, message: string): never {
  throw new DecisionRuleRuntimeError(code, message);
}
