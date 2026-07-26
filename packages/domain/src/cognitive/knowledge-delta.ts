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
import type { KnowledgeCandidateSnapshot, KnowledgeKind } from './knowledge.js';

export const KNOWLEDGE_DELTA_OPERATIONS = Object.freeze([
  'CREATE_REVISION',
  'SUGGEST_MERGE',
  'SUGGEST_SUPERSEDE',
  'ADD_EVIDENCE',
  'ADD_CONTRADICTION',
  'NO_CHANGE',
] as const);

export type KnowledgeDeltaOperation = (typeof KNOWLEDGE_DELTA_OPERATIONS)[number];
export type KnowledgeEvidencePolarity = 'support' | 'contradiction';

export interface KnowledgeCandidateIdentity {
  readonly jobToBeDone: string;
  readonly objectiveTerms: readonly string[];
  readonly criterionTerms: readonly string[];
  readonly artifactTerms: readonly string[];
  readonly capabilityTerms: readonly string[];
  readonly tags: readonly string[];
  readonly deliverable: string;
  readonly instanceTerms?: readonly string[];
  readonly recentIntentBoundary?: string;
}

export interface KnowledgeEvidence {
  readonly evidenceId: string;
  readonly polarity: KnowledgeEvidencePolarity;
  readonly observationId: string;
  readonly statementIds: readonly string[];
  readonly sourceEpisodeIds: readonly string[];
  readonly sourceRefIds: readonly string[];
  readonly sourceRefs?: readonly CognitiveSourceRef[];
  readonly outcomeRefs: readonly string[];
  readonly summary: string;
  readonly createdAt: string;
}

export interface KnowledgeCandidateDraft {
  readonly knowledgeKind: KnowledgeKind;
  readonly title: string;
  readonly summary: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly identity: KnowledgeCandidateIdentity;
  readonly supportEvidence: readonly KnowledgeEvidence[];
  readonly contradictionEvidence: readonly KnowledgeEvidence[];
  readonly tenantId?: string;
  readonly userId?: string;
}

export interface KnowledgeDelta {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly deltaId: string;
  readonly reflectionId: string;
  readonly operation: KnowledgeDeltaOperation;
  readonly knowledgeKind: KnowledgeKind;
  readonly fingerprint: string;
  readonly identity: KnowledgeCandidateIdentity;
  readonly targetKnowledgeId?: string;
  readonly targetRevision?: number;
  readonly relatedKnowledgeIds: readonly string[];
  readonly candidate?: KnowledgeCandidateSnapshot;
  readonly supportEvidence: readonly KnowledgeEvidence[];
  readonly contradictionEvidence: readonly KnowledgeEvidence[];
  readonly confidence: number;
  readonly reason: string;
  readonly modelInvocationId?: string;
  readonly createdAt: string;
}

export function createKnowledgeCandidateIdentity(
  input: KnowledgeCandidateIdentity,
): KnowledgeCandidateIdentity {
  const jobToBeDone = text(input.jobToBeDone, 'jobToBeDone');
  const deliverable = text(input.deliverable, 'deliverable');
  const recentIntentBoundary =
    input.recentIntentBoundary === undefined
      ? undefined
      : text(input.recentIntentBoundary, 'recentIntentBoundary');
  return Object.freeze({
    jobToBeDone,
    objectiveTerms: terms(input.objectiveTerms, 'objectiveTerms'),
    criterionTerms: terms(input.criterionTerms, 'criterionTerms'),
    artifactTerms: terms(input.artifactTerms, 'artifactTerms'),
    capabilityTerms: terms(input.capabilityTerms, 'capabilityTerms'),
    tags: terms(input.tags, 'tags'),
    deliverable,
    ...(input.instanceTerms === undefined
      ? {}
      : { instanceTerms: terms(input.instanceTerms, 'instanceTerms') }),
    ...(recentIntentBoundary === undefined ? {} : { recentIntentBoundary }),
  });
}

export function createKnowledgeEvidence(input: KnowledgeEvidence): KnowledgeEvidence {
  assertIdentifier(input.evidenceId, 'evidenceId');
  assertIdentifier(input.observationId, 'observationId');
  assertTimestamp(input.createdAt, 'createdAt');
  if (!['support', 'contradiction'].includes(input.polarity)) invalid('Invalid evidence polarity.');
  if (input.statementIds.length === 0 || input.sourceEpisodeIds.length === 0) {
    invalid('Knowledge evidence requires statement and Episode lineage.');
  }
  for (const value of [
    ...input.statementIds,
    ...input.sourceEpisodeIds,
    ...input.sourceRefIds,
    ...input.outcomeRefs,
  ]) {
    assertIdentifier(value, 'evidenceRef');
  }
  return Object.freeze({
    ...input,
    statementIds: unique(input.statementIds),
    sourceEpisodeIds: unique(input.sourceEpisodeIds),
    sourceRefIds: unique(input.sourceRefIds),
    ...(input.sourceRefs === undefined
      ? {}
      : { sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)) }),
    outcomeRefs: unique(input.outcomeRefs),
    summary: text(input.summary, 'evidenceSummary'),
  });
}

export function createKnowledgeDelta(input: KnowledgeDelta): KnowledgeDelta {
  assertIdentifier(input.deltaId, 'deltaId');
  assertIdentifier(input.reflectionId, 'reflectionId');
  assertSha256(input.fingerprint, 'fingerprint');
  assertTimestamp(input.createdAt, 'createdAt');
  if (!KNOWLEDGE_DELTA_OPERATIONS.includes(input.operation)) invalid('Unknown Delta operation.');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    invalid('Delta confidence must be between zero and one.');
  }
  if (input.targetKnowledgeId !== undefined)
    assertIdentifier(input.targetKnowledgeId, 'targetKnowledgeId');
  if (input.targetRevision !== undefined)
    assertPositiveVersion(input.targetRevision, 'targetRevision');
  if ((input.targetKnowledgeId === undefined) !== (input.targetRevision === undefined)) {
    invalid('Target knowledge id and revision must be supplied together.');
  }
  for (const value of input.relatedKnowledgeIds) assertIdentifier(value, 'relatedKnowledgeId');
  const supportEvidence = input.supportEvidence.map(createKnowledgeEvidence);
  const contradictionEvidence = input.contradictionEvidence.map(createKnowledgeEvidence);
  if (supportEvidence.some((item) => item.polarity !== 'support')) {
    invalid('Support evidence contains a contradiction polarity.');
  }
  if (contradictionEvidence.some((item) => item.polarity !== 'contradiction')) {
    invalid('Contradiction evidence contains a support polarity.');
  }
  if (input.operation !== 'NO_CHANGE' && input.candidate?.status === 'active') {
    invalid('Curator Delta cannot create active knowledge.');
  }
  if (input.operation === 'NO_CHANGE' && input.candidate !== undefined) {
    invalid('NO_CHANGE cannot carry a candidate mutation.');
  }
  if (input.modelInvocationId !== undefined)
    assertIdentifier(input.modelInvocationId, 'modelInvocationId');
  return Object.freeze({
    ...input,
    identity: createKnowledgeCandidateIdentity(input.identity),
    relatedKnowledgeIds: unique(input.relatedKnowledgeIds),
    supportEvidence: Object.freeze(supportEvidence),
    contradictionEvidence: Object.freeze(contradictionEvidence),
    reason: text(input.reason, 'reason'),
    ...(input.candidate === undefined ? {} : { candidate: Object.freeze({ ...input.candidate }) }),
  });
}

function terms(values: readonly string[], field: string): readonly string[] {
  return freezeStrings(
    values.map((value) => value.toLowerCase()),
    field,
  );
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function text(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4096) invalid(`${field} is invalid.`);
  return trimmed;
}

function invalid(message: string): never {
  throw new CognitiveDomainError('KNOWLEDGE_DELTA_INVALID', message);
}
