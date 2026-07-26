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
import type { MissingDimensionKind } from './task-understanding.js';
import type { KnowledgeStatus } from './knowledge.js';

export type TaskTypeInductionMode = 'offline_batch' | 'online_candidate';
export type TaskTypeDefinitionOrigin = 'fixture' | 'induced';

export interface TaskTypeFingerprintDimensions {
  readonly semanticObjective: readonly string[];
  readonly criteria: readonly string[];
  readonly artifacts: readonly string[];
  readonly capabilities: readonly string[];
  readonly dagShape: readonly string[];
  readonly corrections: readonly string[];
  readonly outcome: readonly string[];
}

export interface TaskTypeInductionExample {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly episodeId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly dimensions: TaskTypeFingerprintDimensions;
  readonly constraints: readonly string[];
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly createdAt: string;
}

export interface TaskTypeExemplar {
  readonly episodeId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly summary: string;
}

export interface TaskTypeRecognition {
  readonly hints: readonly string[];
  readonly positiveExamples: readonly string[];
  readonly negativeExamples: readonly string[];
}

export interface TaskTypeDefinitionSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly taskTypeId: string;
  readonly revision: number;
  readonly status: KnowledgeStatus;
  readonly origin: TaskTypeDefinitionOrigin;
  readonly inductionMode: TaskTypeInductionMode;
  readonly fingerprint: string;
  readonly title: string;
  readonly summary: string;
  readonly recognition: TaskTypeRecognition;
  readonly requiredDimensions: readonly MissingDimensionKind[];
  readonly optionalDimensions: readonly MissingDimensionKind[];
  readonly criteriaTemplate: readonly string[];
  readonly capabilityRequirements: readonly string[];
  readonly goalPattern: string;
  readonly dependencyPattern: readonly string[];
  readonly incompatibleConstraints: readonly string[];
  readonly exemplars: readonly TaskTypeExemplar[];
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly modelInvocationId?: string;
  readonly createdAt: string;
}

export function createTaskTypeInductionExample(
  input: TaskTypeInductionExample,
): TaskTypeInductionExample {
  assertIdentifier(input.episodeId, 'episodeId');
  assertIdentifier(input.goalId, 'goalId');
  assertPositiveVersion(input.goalVersion, 'goalVersion');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.sourceRefs.length === 0) {
    throw new CognitiveDomainError(
      'TASK_TYPE_INVALID',
      'Task Type induction requires authoritative Episode source references.',
    );
  }
  return Object.freeze({
    ...input,
    dimensions: freezeDimensions(input.dimensions),
    constraints: uniqueStrings(input.constraints, 'constraints', 32, true),
    sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)),
  });
}

export function createTaskTypeDefinitionSnapshot(
  input: TaskTypeDefinitionSnapshot,
): TaskTypeDefinitionSnapshot {
  assertIdentifier(input.taskTypeId, 'taskTypeId');
  assertPositiveVersion(input.revision, 'revision');
  assertSha256(input.fingerprint, 'fingerprint');
  assertTimestamp(input.createdAt, 'createdAt');
  if (!['candidate', 'validating', 'active', 'deprecated', 'rejected'].includes(input.status)) {
    throw new CognitiveDomainError('TASK_TYPE_INVALID', 'Task Type status is invalid.');
  }
  if (!['fixture', 'induced'].includes(input.origin)) {
    throw new CognitiveDomainError('TASK_TYPE_INVALID', 'Task Type origin is invalid.');
  }
  if (!['offline_batch', 'online_candidate'].includes(input.inductionMode)) {
    throw new CognitiveDomainError('TASK_TYPE_INVALID', 'Task Type induction mode is invalid.');
  }
  if (input.origin === 'induced' && input.modelInvocationId === undefined) {
    throw new CognitiveDomainError(
      'TASK_TYPE_INVALID',
      'An induced Task Type requires audited model invocation lineage.',
    );
  }
  if (input.modelInvocationId !== undefined) {
    assertIdentifier(input.modelInvocationId, 'modelInvocationId');
  }
  if (input.exemplars.length < 1 || input.exemplars.length > 3) {
    throw new CognitiveDomainError(
      'TASK_TYPE_INVALID',
      'A Task Type Candidate requires between one and three exemplars.',
    );
  }
  const requiredDimensions = uniqueDimensions(input.requiredDimensions, 'requiredDimensions');
  const optionalDimensions = uniqueDimensions(input.optionalDimensions, 'optionalDimensions');
  if (optionalDimensions.some((dimension) => requiredDimensions.includes(dimension))) {
    throw new CognitiveDomainError(
      'TASK_TYPE_INVALID',
      'Required and optional Task Type dimensions must be disjoint.',
    );
  }
  const sourceRefs = Object.freeze(input.sourceRefs.map(createCognitiveSourceRef));
  if (input.origin === 'induced' && sourceRefs.length === 0) {
    throw new CognitiveDomainError(
      'TASK_TYPE_INVALID',
      'An induced Task Type requires persisted source lineage.',
    );
  }
  return Object.freeze({
    ...input,
    title: singleText(input.title, 'title'),
    summary: singleText(input.summary, 'summary'),
    recognition: Object.freeze({
      hints: uniqueStrings(input.recognition.hints, 'recognition.hints', 32),
      positiveExamples: uniqueStrings(
        input.recognition.positiveExamples,
        'recognition.positiveExamples',
        16,
      ),
      negativeExamples: uniqueStrings(
        input.recognition.negativeExamples,
        'recognition.negativeExamples',
        16,
      ),
    }),
    requiredDimensions,
    optionalDimensions,
    criteriaTemplate: uniqueStrings(input.criteriaTemplate, 'criteriaTemplate', 32),
    capabilityRequirements: uniqueStrings(
      input.capabilityRequirements,
      'capabilityRequirements',
      32,
    ),
    goalPattern: singleText(input.goalPattern, 'goalPattern'),
    dependencyPattern: uniqueStrings(input.dependencyPattern, 'dependencyPattern', 64),
    incompatibleConstraints: uniqueStrings(
      input.incompatibleConstraints,
      'incompatibleConstraints',
      32,
      true,
    ),
    exemplars: Object.freeze(input.exemplars.map(createExemplar)),
    sourceRefs,
  });
}

function freezeDimensions(input: TaskTypeFingerprintDimensions): TaskTypeFingerprintDimensions {
  return Object.freeze({
    semanticObjective: uniqueStrings(input.semanticObjective, 'semanticObjective', 64),
    criteria: uniqueStrings(input.criteria, 'criteria', 64),
    artifacts: uniqueStrings(input.artifacts, 'artifacts', 32),
    capabilities: uniqueStrings(input.capabilities, 'capabilities', 32),
    dagShape: uniqueStrings(input.dagShape, 'dagShape', 64),
    corrections: uniqueStrings(input.corrections, 'corrections', 64, true),
    outcome: uniqueStrings(input.outcome, 'outcome', 32),
  });
}

function createExemplar(input: TaskTypeExemplar): TaskTypeExemplar {
  assertIdentifier(input.episodeId, 'exemplar.episodeId');
  assertIdentifier(input.goalId, 'exemplar.goalId');
  assertPositiveVersion(input.goalVersion, 'exemplar.goalVersion');
  return Object.freeze({ ...input, summary: singleText(input.summary, 'exemplar.summary') });
}

function uniqueDimensions(
  input: readonly MissingDimensionKind[],
  field: string,
): readonly MissingDimensionKind[] {
  const unique = [...new Set(input)];
  if (unique.length !== input.length || unique.length > 16) {
    throw new CognitiveDomainError('TASK_TYPE_INVALID', `${field} is invalid.`);
  }
  return Object.freeze(unique);
}

function uniqueStrings(
  input: readonly string[],
  field: string,
  limit: number,
  allowEmpty = false,
): readonly string[] {
  if ((!allowEmpty && input.length === 0) || input.length > limit) {
    throw new CognitiveDomainError('TASK_TYPE_INVALID', `${field} is invalid.`);
  }
  const values = freezeStrings(input, field);
  const unique = [...new Set(values)];
  if (unique.length !== values.length) {
    throw new CognitiveDomainError('TASK_TYPE_INVALID', `${field} contains duplicates.`);
  }
  return Object.freeze(unique);
}

function singleText(value: string, field: string): string {
  const [result] = freezeStrings([value], field);
  if (result === undefined)
    throw new CognitiveDomainError('TASK_TYPE_INVALID', `${field} is invalid.`);
  return result;
}
