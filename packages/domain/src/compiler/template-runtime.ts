import type {
  ConditionExpression,
  JsonValue,
  RecoveryBranchTemplate,
  SkillGoalDependencyTemplate,
  SkillGoalNodeTemplate,
} from './contracts.js';

/**
 * Frozen P08 data contracts.  They deliberately describe a materialized
 * candidate only: formal UserGoalPlan authority stays with the existing
 * planning/confirmation runtime.
 */
export const TEMPLATE_RUNTIME_CONTRACT_VERSION = '1.1' as const;

export const TEMPLATE_RUNTIME_SCHEMA_HASHES = Object.freeze({
  TemplateInstantiationInput: 'b1305ecee05292e77d0694bed39b1ea1bcaf5679c26a17bf21360fe523c1fb7a',
  GoalContextSnapshot: '8b7c4d0307be2e7786ddcd4187eff7f428f89788564415196c8d9d98a60a809d',
  UserGoalPlanCandidate: '0703bdf935e746d6e3ec5b27a72d334baa39d50e8daa4ca144ef67a41f00d396',
  TemplateInstantiationResult: '4d10a971c8fb2d79355f6364de04d45fea36143d0ebcd0a9b9faca785264de96',
  FormalPlanHandoffResult: '7cd74f217530c34f78a6d5793f2e190675dee96e6e9cb3dd39cf69dec05fe883',
  TemplateRuntime: 'fe1a817f0a5633b648d018742e0fcb2278e0ef887d9a9adf1922d55a755e553a',
  FormalPlanHandoffPort: '84f9be4c6bcd7ed775c1f56779f671709efe541edc498b6bb71047a1e55d9336',
} as const);

export interface TemplateInstantiationInput {
  readonly requestRef: string;
  readonly goalContractRef: string;
  readonly goalVersion: number;
  readonly artifactRef: string;
  readonly artifactVersion: number;
  readonly artifactHash: string;
  readonly activePointerVersion: number;
  readonly applicabilityRef: string;
  readonly parameterBindingRef: string;
  readonly dependencyValidationRef: string;
  readonly capabilityReadinessRef: string;
  readonly policyDecisionRef: string;
  readonly matcherSnapshotHash: string;
  readonly policySnapshotHash: string;
  readonly idempotencyKey: string;
  readonly deadlineAt?: string;
  readonly cancellationRef?: string;
}

export interface GoalContextSnapshot {
  readonly goalContractRef: string;
  readonly goalVersion: number;
  readonly objective: string;
  readonly requiredCriterionRefs: readonly string[];
  readonly optionalCriterionRefs: readonly string[];
  readonly evidenceRequirementRefs: readonly string[];
  readonly artifactRequirementRefs: readonly string[];
  readonly targetScope: JsonValue;
  readonly constraints: readonly JsonValue[];
  readonly authorizationRefs: readonly string[];
  readonly riskLevel: string;
  readonly contentHash: string;
}

export interface MaterializedSkillGoalNode {
  readonly nodeKey: string;
  readonly nodeType: SkillGoalNodeTemplate['nodeType'];
  readonly objective: string;
  readonly requiredCapabilities: readonly string[];
  readonly requiredEffectRefs: readonly string[];
  readonly coveredCriterionRefs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly artifactRequirements: readonly string[];
  readonly input: JsonValue;
  readonly assumptionsAllowed: readonly string[];
  readonly constraints: readonly string[];
}

export interface MaterializedDependency {
  readonly dependencyKey: string;
  readonly predecessorNodeKey: string;
  readonly successorNodeKey: string;
  readonly predicate: SkillGoalDependencyTemplate['predicate'];
  readonly condition?: ConditionExpression;
}

export interface MaterializedCompletionContract {
  readonly title: string;
  readonly description: string;
  readonly requiredCriterionRefs: readonly string[];
  readonly evidenceRequirementRefs: readonly string[];
  readonly artifactRequirementRefs: readonly string[];
}

export interface MaterializedRecoveryBranch {
  readonly trigger: ConditionExpression;
  readonly requiredCapabilities: readonly string[];
  readonly planPatch: JsonValue;
  readonly maximumApplications: number;
  readonly sideEffectReplayPolicy: RecoveryBranchTemplate['sideEffectReplayPolicy'];
}

export interface UserGoalPlanCandidate {
  readonly candidateId: string;
  readonly goalContractRef: string;
  readonly goalVersion: number;
  readonly sourceArtifactRef: string;
  readonly sourceArtifactVersion: number;
  readonly sourceArtifactHash: string;
  readonly parameterBindings: Readonly<Record<string, JsonValue>>;
  readonly skillGoalGraph: Readonly<{
    readonly nodes: readonly MaterializedSkillGoalNode[];
    readonly dependencies: readonly MaterializedDependency[];
    readonly parallelGroups: Readonly<Record<string, readonly string[]>>;
  }>;
  readonly completionContract: MaterializedCompletionContract;
  readonly recoveryBranches: readonly MaterializedRecoveryBranch[];
  readonly criterionCoverage: Readonly<{
    readonly requiredCriterionRefs: readonly string[];
    readonly coveredCriterionRefs: readonly string[];
    readonly missingCriterionRefs: readonly string[];
  }>;
  readonly adaptationRefs: readonly string[];
  readonly runtimeSnapshotHash: string;
  readonly contentHash: string;
}

/** Earlier package prose called this shape MaterializedPlanCandidate. */
export type MaterializedPlanCandidate = UserGoalPlanCandidate;

export type TemplateInstantiationDisposition =
  | 'ready_for_validation'
  | 'requires_confirmation'
  | 'fallback'
  | 'deny'
  | 'discarded_stale'
  | 'failed';

export interface TemplateInstantiationResult {
  readonly instantiationId: string;
  readonly requestRef: string;
  readonly artifactRef: string;
  readonly disposition: TemplateInstantiationDisposition;
  readonly planCandidateRef?: string;
  readonly missingParameters: readonly string[];
  readonly requiredConfirmations: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly createdAt: string;
}

export type FormalPlanHandoffDisposition =
  | 'submitted_to_planning_session'
  | 'confirmed_and_committed'
  | 'requires_confirmation'
  | 'rejected_by_validator'
  | 'discarded_stale'
  | 'fallback'
  | 'failed';

export interface FormalPlanHandoffResult {
  readonly handoffId: string;
  readonly planCandidateRef: string;
  readonly disposition: FormalPlanHandoffDisposition;
  readonly formalPlanningSessionRef?: string;
  readonly formalPlanRef?: string;
  readonly formalPlanVersion?: number;
  readonly validationRef?: string;
  readonly goalLockRef?: string;
  readonly reasonCodes: readonly string[];
  readonly completedAt: string;
}

export interface TemplateRuntime {
  instantiate(input: TemplateInstantiationInput): Promise<UserGoalPlanCandidate>;
}

export interface FormalPlanHandoffPort {
  submit(candidate: UserGoalPlanCandidate): Promise<FormalPlanHandoffResult>;
}
