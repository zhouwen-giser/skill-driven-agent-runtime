import type { SkillExecutionMode, SkillContextSource } from './skill-usage.js';
import type {
  TaskAvailabilityArguments,
  TaskAvailabilityPossibleEffect,
  TaskAvailabilityRiskLevel,
  TaskAvailableWindow,
  TaskReservationMode,
} from './mcp-task-availability.js';

export type SkillApplicabilityStatus = 'satisfied' | 'partial' | 'unsatisfied' | 'unknown';
export type SkillContextObservationStatus = 'available' | 'absent' | 'unknown';
export type SkillContextResolutionStatus =
  'satisfied' | 'input_required' | 'unsatisfied' | 'unknown';
export type SkillTaskReadinessDisposition = 'ready' | 'restricted' | 'unavailable' | 'unknown';
export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SkillHumanConfirmationState = 'not_requested' | 'pending' | 'confirmed' | 'declined';

export interface SkillContextObservation {
  readonly requirementId: string;
  readonly source: SkillContextSource;
  readonly status: SkillContextObservationStatus;
  /** Reference to bounded evidence; the resolver never invents or copies an authoritative value. */
  readonly evidenceRef?: string;
}

export interface SkillContextRequirementResolution {
  readonly requirementId: string;
  readonly required: boolean;
  readonly status: SkillContextResolutionStatus;
  readonly source?: SkillContextSource;
  readonly evidenceRef?: string;
  readonly attemptedSources: readonly SkillContextSource[];
}

export interface SkillContextResolutionSummary {
  readonly requirements: readonly SkillContextRequirementResolution[];
  readonly satisfied: number;
  readonly total: number;
  readonly complete: boolean;
  readonly inputRequiredIds: readonly string[];
  readonly unsatisfiedIds: readonly string[];
  readonly unknownIds: readonly string[];
}

export interface SkillTaskBindingReadiness {
  readonly bindingId: string;
  readonly taskType: string;
  readonly disposition: SkillTaskReadinessDisposition;
  readonly confirmationRequired: boolean;
  readonly reasonCodes: readonly string[];
  readonly selectedProviderId?: string;
  readonly selectedOperationName?: string;
  readonly selectedProtocolMode?: 'frozen_v1';
  readonly candidates?: readonly SkillTaskProviderCandidateReadiness[];
}

export interface SkillTaskProviderCandidateReadiness {
  readonly providerId: string;
  readonly operationName: string;
  readonly protocolMode: 'frozen_v1';
  readonly attributes: readonly string[];
  readonly disposition: SkillTaskReadinessDisposition;
  readonly riskLevel: TaskAvailabilityRiskLevel;
  readonly validUntil?: string;
  readonly earliestStartTime?: string;
  readonly nextAvailableWindows: readonly TaskAvailableWindow[];
  readonly reservationMode: TaskReservationMode;
  readonly reservationRef?: string;
  readonly possibleEffects: readonly TaskAvailabilityPossibleEffect[];
  readonly selected: boolean;
  readonly reasonCodes: readonly string[];
}

export interface SkillTaskReadinessSummary {
  readonly overall: SkillTaskReadinessDisposition;
  readonly bindings: readonly SkillTaskBindingReadiness[];
}

export interface SkillApplicabilityAssessment {
  readonly skillId: string;
  readonly skillVersion: number;
  readonly status: SkillApplicabilityStatus;
  readonly reasonCodes: readonly string[];
  readonly context: SkillContextResolutionSummary;
  readonly readiness: SkillTaskReadinessSummary;
}

export interface SkillModeSystemPolicy {
  readonly allowedModes: readonly SkillExecutionMode[];
  readonly preferredMode?: SkillExecutionMode;
  readonly requireProcedureForHighRisk: boolean;
  readonly allowGuidanceWithIncompleteContext: boolean;
}

export interface SkillUsageSelectionContext {
  readonly observations: readonly SkillContextObservation[];
  readonly risk: SkillRiskLevel;
  readonly humanConfirmation: SkillHumanConfirmationState;
  readonly systemPolicy: SkillModeSystemPolicy;
  /** Exact frozen Skill input used only for the Provider's read-only planning availability check. */
  readonly taskAvailabilityArguments?: TaskAvailabilityArguments;
}

export type SkillModeDecision =
  | Readonly<{
      decision: 'selected';
      mode: SkillExecutionMode;
      confirmationRequired: boolean;
      confirmationSatisfied: boolean;
      reasonCodes: readonly string[];
    }>
  | Readonly<{
      decision: 'blocked';
      reasonCodes: readonly string[];
    }>;

export interface SkillUsageCandidateSnapshot {
  readonly skillId: string;
  readonly skillVersion: number;
  readonly applicability: SkillApplicabilityAssessment;
  readonly modeDecision: SkillModeDecision;
}
