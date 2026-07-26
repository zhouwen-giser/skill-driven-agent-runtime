import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
} from './common.js';
import { CognitiveDomainError } from './errors.js';
import { createKnowledgeDelta, type KnowledgeDelta } from './knowledge-delta.js';

export type ExperienceReflectionStatus = 'completed' | 'no_op' | 'failed';
export type ReflectionImpactDisposition = 'helpful' | 'harmful' | 'neutral';

export interface ExperienceReflectionGroup {
  readonly tenantId?: string;
  readonly goalPatternFingerprint: string;
  readonly taskTypeCandidateId?: string;
  readonly capabilityFingerprint: string;
  readonly timeWindow: string;
}

export interface ExperienceReflectionImpact {
  readonly impactId: string;
  readonly disposition: ReflectionImpactDisposition;
  readonly observationId: string;
  readonly statementId: string;
  readonly sourceEpisodeIds: readonly string[];
  readonly sourceRefIds: readonly string[];
  readonly outcomeRefs: readonly string[];
  readonly summary: string;
}

export interface ExperienceReflection {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly reflectionId: string;
  readonly seedObservationId: string;
  readonly observationIds: readonly string[];
  readonly revision: number;
  readonly status: ExperienceReflectionStatus;
  readonly group: ExperienceReflectionGroup;
  readonly impacts: readonly ExperienceReflectionImpact[];
  readonly deltas: readonly KnowledgeDelta[];
  readonly modelInvocationRefs: readonly string[];
  readonly reflectionHash: string;
  readonly createdAt: string;
}

export function createExperienceReflection(input: ExperienceReflection): ExperienceReflection {
  assertIdentifier(input.reflectionId, 'reflectionId');
  assertIdentifier(input.seedObservationId, 'seedObservationId');
  assertPositiveVersion(input.revision, 'revision');
  assertTimestamp(input.createdAt, 'createdAt');
  assertSha256(input.reflectionHash, 'reflectionHash');
  if (!['completed', 'no_op', 'failed'].includes(input.status))
    invalid('Invalid Reflection status.');
  if (input.observationIds.length === 0 || input.observationIds.length > 100) {
    invalid('Reflection Observation batch must contain one to 100 items.');
  }
  for (const observationId of input.observationIds)
    assertIdentifier(observationId, 'observationId');
  if (!input.observationIds.includes(input.seedObservationId)) {
    invalid('Reflection batch must include the seed Observation.');
  }
  const group = createGroup(input.group);
  const impacts = input.impacts.map(createImpact);
  const deltas = input.deltas.map(createKnowledgeDelta);
  if (deltas.some((delta) => delta.reflectionId !== input.reflectionId)) {
    invalid('Reflection and Delta identities do not match.');
  }
  if (input.status === 'completed' && deltas.every((delta) => delta.operation === 'NO_CHANGE')) {
    invalid('Completed Reflection requires a knowledge-changing or lineage suggestion Delta.');
  }
  if (input.status === 'no_op' && deltas.some((delta) => delta.operation !== 'NO_CHANGE')) {
    invalid('No-op Reflection cannot contain a knowledge-changing Delta.');
  }
  for (const invocationId of input.modelInvocationRefs)
    assertIdentifier(invocationId, 'modelInvocationRef');
  return Object.freeze({
    ...input,
    observationIds: unique(input.observationIds),
    group,
    impacts: Object.freeze(impacts),
    deltas: Object.freeze(deltas),
    modelInvocationRefs: unique(input.modelInvocationRefs),
  });
}

function createGroup(input: ExperienceReflectionGroup): ExperienceReflectionGroup {
  assertSha256(input.goalPatternFingerprint, 'goalPatternFingerprint');
  assertSha256(input.capabilityFingerprint, 'capabilityFingerprint');
  if (!/^\d{4}-\d{2}-\d{2}\/P7D$/u.test(input.timeWindow)) {
    invalid('Reflection time window must be a seven-day UTC bucket.');
  }
  if (input.tenantId !== undefined) assertIdentifier(input.tenantId, 'tenantId');
  if (input.taskTypeCandidateId !== undefined)
    assertIdentifier(input.taskTypeCandidateId, 'taskTypeCandidateId');
  return Object.freeze({ ...input });
}

function createImpact(input: ExperienceReflectionImpact): ExperienceReflectionImpact {
  assertIdentifier(input.impactId, 'impactId');
  assertIdentifier(input.observationId, 'observationId');
  assertIdentifier(input.statementId, 'statementId');
  if (!['helpful', 'harmful', 'neutral'].includes(input.disposition)) {
    invalid('Invalid Reflection impact disposition.');
  }
  if (input.sourceEpisodeIds.length === 0 || input.sourceRefIds.length === 0) {
    invalid('Reflection impact requires Episode and source lineage.');
  }
  for (const value of [...input.sourceEpisodeIds, ...input.sourceRefIds, ...input.outcomeRefs]) {
    assertIdentifier(value, 'impactRef');
  }
  const summary = input.summary.trim();
  if (summary.length === 0 || summary.length > 4096)
    invalid('Reflection impact summary is invalid.');
  return Object.freeze({
    ...input,
    sourceEpisodeIds: unique(input.sourceEpisodeIds),
    sourceRefIds: unique(input.sourceRefIds),
    outcomeRefs: unique(input.outcomeRefs),
    summary,
  });
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function invalid(message: string): never {
  throw new CognitiveDomainError('EXPERIENCE_REFLECTION_INVALID', message);
}
