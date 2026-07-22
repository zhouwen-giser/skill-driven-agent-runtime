import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  createCognitiveSourceRef,
  freezeStrings,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type MissingDimensionKind =
  | 'target'
  | 'scope'
  | 'time_range'
  | 'priority'
  | 'criteria'
  | 'artifact'
  | 'evidence'
  | 'side_effect_authorization'
  | 'risk_tolerance'
  | 'degradation_policy'
  | 'uncovered_case_policy'
  | 'human_confirmation_policy';
export type MissingDimensionSeverity = 'blocking' | 'conditional' | 'non_blocking';
export type TaskUnderstandingDisposition =
  'clarification_required' | 'confirmation_required' | 'contract_candidate' | 'rejected';

export interface MissingDimension {
  readonly dimensionId: string;
  readonly kind: MissingDimensionKind;
  readonly severity: MissingDimensionSeverity;
  readonly question: string;
  readonly answered: boolean;
  readonly authorizationSensitive: boolean;
}

export interface TaskDimensionValue {
  readonly kind: MissingDimensionKind;
  readonly value: string;
  readonly source:
    | 'user_request'
    | 'conversation_context'
    | 'world_state'
    | 'task_type'
    | 'low_risk_preference'
    | 'model_candidate';
}

export interface TaskTypeCandidate {
  readonly taskTypeId: string;
  readonly version: number;
  readonly confidence: number;
  readonly rationale: string;
}

export interface CapabilityRequirement {
  readonly capabilityId: string;
  readonly description: string;
  readonly required: boolean;
  readonly available: boolean;
}

export interface PlanningAssumption {
  readonly assumptionId: string;
  readonly statement: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly dimensionKind?: MissingDimensionKind;
}

export interface GenericTaskUnderstandingRevision {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly understandingId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly originalRequest: string;
  readonly objective: string;
  readonly taskTypeCandidates: readonly TaskTypeCandidate[];
  readonly capabilityRequirements: readonly CapabilityRequirement[];
  readonly knownConstraints: readonly string[];
  readonly knownDimensions: readonly TaskDimensionValue[];
  readonly assumptions: readonly PlanningAssumption[];
  readonly missingDimensions: readonly MissingDimension[];
  readonly confidence: number;
  readonly disposition: TaskUnderstandingDisposition;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly modelInvocationId: string;
  readonly policyVersion: string;
  readonly stateHash: string;
  readonly createdAt: string;
}

export function createGenericTaskUnderstandingRevision(
  input: GenericTaskUnderstandingRevision,
): GenericTaskUnderstandingRevision {
  assertIdentifier(input.understandingId, 'understandingId');
  assertIdentifier(input.taskId, 'taskId');
  assertPositiveVersion(input.revision, 'revision');
  assertIdentifier(input.modelInvocationId, 'modelInvocationId');
  assertIdentifier(input.policyVersion, 'policyVersion');
  assertSha256(input.stateHash, 'stateHash');
  assertTimestamp(input.createdAt, 'createdAt');
  const originalRequest = boundedText(input.originalRequest, 64_000, 'original request');
  const objective = boundedText(input.objective, 8192, 'objective');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    invalid('Confidence is invalid.');
  }
  const taskTypeIds = new Set<string>();
  const taskTypeCandidates = input.taskTypeCandidates.map((candidate) => {
    assertIdentifier(candidate.taskTypeId, 'taskTypeId');
    assertPositiveVersion(candidate.version, 'taskTypeVersion');
    if (taskTypeIds.has(candidate.taskTypeId)) invalid('Task Type candidates must be unique.');
    if (
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    )
      invalid('Task Type candidate confidence is invalid.');
    taskTypeIds.add(candidate.taskTypeId);
    return Object.freeze({
      ...candidate,
      rationale: boundedText(candidate.rationale, 2048, 'Task Type rationale'),
    });
  });
  const capabilityIds = new Set<string>();
  const capabilityRequirements = input.capabilityRequirements.map((requirement) => {
    assertIdentifier(requirement.capabilityId, 'capabilityId');
    if (capabilityIds.has(requirement.capabilityId))
      invalid('Capability requirements must be unique.');
    capabilityIds.add(requirement.capabilityId);
    return Object.freeze({
      ...requirement,
      description: boundedText(requirement.description, 2048, 'capability requirement'),
    });
  });
  const knownDimensions = input.knownDimensions.map((dimension) =>
    Object.freeze({
      ...dimension,
      value: boundedText(dimension.value, 4096, 'known dimension value'),
    }),
  );
  assertUniqueDimensionKinds(knownDimensions.map((dimension) => dimension.kind));
  const dimensionIds = new Set<string>();
  const missingDimensions = input.missingDimensions.map((dimension) => {
    assertIdentifier(dimension.dimensionId, 'dimensionId');
    if (dimensionIds.has(dimension.dimensionId))
      invalid('Missing dimension identifiers must be unique.');
    dimensionIds.add(dimension.dimensionId);
    return Object.freeze({
      ...dimension,
      question: boundedText(dimension.question, 2048, 'question'),
    });
  });
  assertUniqueDimensionKinds(missingDimensions.map((dimension) => dimension.kind));
  const knownKinds = new Set(knownDimensions.map((dimension) => dimension.kind));
  if (missingDimensions.some((dimension) => knownKinds.has(dimension.kind))) {
    invalid('A dimension cannot be both known and missing.');
  }
  const assumptionIds = new Set<string>();
  const assumptions = input.assumptions.map((assumption) => {
    assertIdentifier(assumption.assumptionId, 'assumptionId');
    if (assumptionIds.has(assumption.assumptionId))
      invalid('Assumption identifiers must be unique.');
    assumptionIds.add(assumption.assumptionId);
    return Object.freeze({
      ...assumption,
      statement: boundedText(assumption.statement, 2048, 'assumption'),
    });
  });
  if (
    assumptions.some(
      (assumption) =>
        assumption.dimensionKind === 'side_effect_authorization' ||
        assumption.dimensionKind === 'human_confirmation_policy',
    )
  ) {
    invalid('Safety authorization dimensions cannot be filled by assumptions.');
  }
  return Object.freeze({
    ...input,
    originalRequest,
    objective,
    taskTypeCandidates: Object.freeze(taskTypeCandidates),
    capabilityRequirements: Object.freeze(capabilityRequirements),
    knownConstraints: freezeStrings(input.knownConstraints, 'knownConstraints'),
    knownDimensions: Object.freeze(knownDimensions),
    assumptions: Object.freeze(assumptions),
    missingDimensions: Object.freeze(missingDimensions),
    sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)),
  });
}

function assertUniqueDimensionKinds(values: readonly MissingDimensionKind[]): void {
  if (new Set(values).size !== values.length) invalid('Dimension kinds must be unique.');
}

function boundedText(value: string, maximum: number, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) invalid(`${field} is invalid.`);
  return normalized;
}

function invalid(message: string): never {
  throw new CognitiveDomainError('TASK_UNDERSTANDING_INVALID', message);
}
