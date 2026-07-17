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

export interface SkillUsageTaskOperationPolicy {
  readonly bindingId: string;
  readonly taskType: string;
  readonly providerId: string;
  readonly operationName: string;
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
