import type {
  SkillContextResolutionSummary,
  SkillModeDecision,
  SkillTaskReadinessSummary,
} from './skill-applicability.js';
import type {
  SkillExactVersionReference,
  SkillUsageCompositionPlan,
} from './skill-usage-composition.js';
import type {
  SkillEvidenceRequirement,
  SkillExecutionMode,
  SkillFailurePolicy,
  SkillValueMapping,
} from './skill-usage.js';
import type { ToolReference } from './skill.js';
import { DomainError } from './errors.js';
import { snapshotSkillUsageCompositionPlan } from './skill-usage-composition.js';

export interface SkillUsageTaskOperationPolicy {
  readonly bindingId: string;
  readonly taskType: string;
  readonly providerId: string;
  readonly operationName: string;
  readonly protocolMode: 'frozen_v1';
}

export interface SkillUsageChildPlanPolicy {
  readonly edgeId: string;
  readonly child: SkillExactVersionReference;
  readonly failurePolicy: SkillFailurePolicy;
  readonly inputMappings: readonly SkillValueMapping[];
  readonly outputMappings: readonly SkillValueMapping[];
}

/** Exact-version deterministic authority supplied to planning and post-plan compliance. */
export interface SkillUsagePlanPolicy {
  readonly skill: SkillExactVersionReference;
  readonly mode: SkillExecutionMode;
  readonly modeDecision: Extract<SkillModeDecision, { decision: 'selected' }>;
  readonly constraints: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly adaptiveInstructions: readonly string[];
  readonly requiredConfirmations: readonly string[];
  readonly requiredContextIds: readonly string[];
  readonly allowedTools: readonly ToolReference[];
  readonly taskOperations: readonly SkillUsageTaskOperationPolicy[];
  readonly childPolicies: readonly SkillUsageChildPlanPolicy[];
  readonly evidenceRequirements: readonly SkillEvidenceRequirement[];
  readonly rejectSuccessWithoutRequiredEvidence: boolean;
  readonly composition: SkillUsageCompositionPlan;
  readonly context: SkillContextResolutionSummary;
  readonly readiness: SkillTaskReadinessSummary;
}

export interface SkillUsagePlanComplianceError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface SkillUsagePlanComplianceResult {
  readonly compliant: boolean;
  readonly errors: readonly SkillUsagePlanComplianceError[];
}

export function snapshotSkillUsagePlanPolicy(policy: SkillUsagePlanPolicy): SkillUsagePlanPolicy {
  const snapshot = snapshotJson(policy) as SkillUsagePlanPolicy;
  const composition = snapshotSkillUsageCompositionPlan(snapshot.composition);
  const taskKeys = snapshot.taskOperations.map(
    (item) => `${item.bindingId}:${item.providerId}/${item.operationName}`,
  );
  const childKeys = snapshot.childPolicies.map((item) => item.edgeId);
  const evidenceKeys = snapshot.evidenceRequirements.map((item) => item.requirementId);
  if (
    snapshot.skill.skillId.trim() === '' ||
    !Number.isSafeInteger(snapshot.skill.skillVersion) ||
    snapshot.skill.skillVersion < 1 ||
    snapshot.modeDecision.mode !== snapshot.mode ||
    composition.root.skillId !== snapshot.skill.skillId ||
    composition.root.skillVersion !== snapshot.skill.skillVersion ||
    new Set(taskKeys).size !== taskKeys.length ||
    new Set(childKeys).size !== childKeys.length ||
    new Set(evidenceKeys).size !== evidenceKeys.length ||
    snapshot.taskOperations.some(
      (item) =>
        item.bindingId.trim() === '' ||
        item.taskType.trim() === '' ||
        item.providerId.trim() === '' ||
        item.operationName.trim() === '',
    ) ||
    snapshot.childPolicies.some((item) =>
      composition.edges.every(
        (edge) =>
          edge.edgeId !== item.edgeId ||
          edge.child.skillId !== item.child.skillId ||
          edge.child.skillVersion !== item.child.skillVersion ||
          edge.failurePolicy !== item.failurePolicy,
      ),
    ) ||
    snapshot.context.total !== snapshot.context.requirements.length ||
    snapshot.context.satisfied > snapshot.context.total ||
    snapshot.readiness.bindings.some((binding) =>
      snapshot.taskOperations.every((item) => item.bindingId !== binding.bindingId),
    ) ||
    snapshot.taskOperations.some((item) =>
      snapshot.readiness.bindings.every(
        (binding) =>
          binding.bindingId !== item.bindingId ||
          binding.selectedProviderId !== item.providerId ||
          binding.selectedOperationName !== item.operationName ||
          (binding.disposition !== 'ready' && binding.disposition !== 'restricted'),
      ),
    )
  )
    throw new DomainError(
      'SKILL_USAGE_PLAN_POLICY_INVALID',
      'Skill Usage plan policy contradicts its exact-version composition or readiness authority.',
    );
  return Object.freeze({ ...snapshot, composition });
}

function snapshotJson(value: unknown, active = new WeakSet(), depth = 0): unknown {
  if (depth > 48)
    throw new DomainError(
      'SKILL_USAGE_PLAN_POLICY_INVALID',
      'Skill Usage plan policy exceeds its JSON depth boundary.',
    );
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  if (typeof value !== 'object' || active.has(value))
    throw new DomainError(
      'SKILL_USAGE_PLAN_POLICY_INVALID',
      'Skill Usage plan policy must contain finite acyclic JSON data.',
    );
  active.add(value);
  try {
    if (Array.isArray(value))
      return Object.freeze(value.map((item) => snapshotJson(item, active, depth + 1)));
    if (
      Reflect.getPrototypeOf(value) !== Object.prototype &&
      Reflect.getPrototypeOf(value) !== null
    )
      throw new DomainError(
        'SKILL_USAGE_PLAN_POLICY_INVALID',
        'Skill Usage plan policy must contain plain JSON objects.',
      );
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, snapshotJson(item, active, depth + 1)]),
      ),
    );
  } finally {
    active.delete(value);
  }
}
