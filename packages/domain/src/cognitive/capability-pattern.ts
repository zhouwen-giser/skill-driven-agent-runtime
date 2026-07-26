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
import type { KnowledgeStatus } from './knowledge.js';

export type CapabilityExperienceLevel = 'declared' | 'observed' | 'validated';

export interface CapabilityPatternSignals {
  readonly skillOutcomes: readonly string[];
  readonly attempts: readonly string[];
  readonly evidence: readonly string[];
  readonly artifacts: readonly string[];
  readonly corrections: readonly string[];
  readonly recoveries: readonly string[];
  readonly eventImpacts: readonly string[];
  readonly applicableConditions: readonly string[];
  readonly effects: readonly string[];
  readonly prerequisites: readonly string[];
  readonly dependencies: readonly string[];
  readonly failures: readonly string[];
  readonly limitations: readonly string[];
}

export interface CapabilityPatternInductionExample {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly episodeId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly capabilityId: string;
  readonly evidenceLevel: Exclude<CapabilityExperienceLevel, 'declared'>;
  readonly signals: CapabilityPatternSignals;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly createdAt: string;
}

export interface CapabilityPatternEvidenceSnapshot {
  readonly level: CapabilityExperienceLevel;
  readonly summary: string;
  readonly sourceRefIds: readonly string[];
  readonly episodeId?: string;
  readonly exactSkillVersionRef?: string;
}

export interface CapabilitySkillVersionMapping {
  readonly exactSkillVersionRef: string;
  readonly mappingBasis: 'declared_capability';
  readonly requiresCurrentReadiness: true;
  readonly compatibilityStatus: 'requires_current_check';
}

export interface CapabilityPatternDefinitionSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly patternId: string;
  readonly revision: number;
  readonly version: number;
  readonly status: KnowledgeStatus;
  readonly fingerprint: string;
  readonly catalogHash: string;
  readonly policyVersion: string;
  readonly capabilityId: string;
  readonly title: string;
  readonly summary: string;
  readonly applicableConditions: readonly string[];
  readonly effects: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly artifacts: readonly string[];
  readonly prerequisites: readonly string[];
  readonly dependencies: readonly string[];
  readonly failures: readonly string[];
  readonly limitations: readonly string[];
  readonly evidenceByLevel: Readonly<
    Record<CapabilityExperienceLevel, readonly CapabilityPatternEvidenceSnapshot[]>
  >;
  readonly exactSkillVersionMappings: readonly CapabilitySkillVersionMapping[];
  readonly requiresCurrentReadiness: true;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly modelInvocationId: string;
  readonly createdAt: string;
}

export interface CapabilitySkillAuthoringProposal {
  readonly proposalId: string;
  readonly status: 'proposed';
  readonly reviewMode: 'manual';
  readonly publishAllowed: false;
  readonly capabilityId: string;
  readonly title: string;
  readonly summary: string;
}

export interface CapabilityGapCandidateSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly gapId: string;
  readonly status: 'candidate';
  readonly fingerprint: string;
  readonly patternId: string;
  readonly patternRevision: number;
  readonly capabilityId: string;
  readonly catalogHash: string;
  readonly exactSkillVersionRefs: readonly [];
  readonly executable: false;
  readonly authoringProposal: CapabilitySkillAuthoringProposal;
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly createdAt: string;
}

export function createCapabilityPatternInductionExample(
  input: CapabilityPatternInductionExample,
): CapabilityPatternInductionExample {
  assertIdentifier(input.episodeId, 'episodeId');
  assertIdentifier(input.goalId, 'goalId');
  assertPositiveVersion(input.goalVersion, 'goalVersion');
  assertIdentifier(input.capabilityId, 'capabilityId');
  assertTimestamp(input.createdAt, 'createdAt');
  if (!['observed', 'validated'].includes(input.evidenceLevel)) {
    invalid('Capability induction evidence must be observed or validated.');
  }
  if (input.sourceRefs.length === 0) {
    invalid('Capability induction requires authoritative Episode source references.');
  }
  return Object.freeze({
    ...input,
    signals: freezeSignals(input.signals),
    sourceRefs: Object.freeze(input.sourceRefs.map(createCognitiveSourceRef)),
  });
}

export function createCapabilityPatternDefinitionSnapshot(
  input: CapabilityPatternDefinitionSnapshot,
): CapabilityPatternDefinitionSnapshot {
  assertIdentifier(input.patternId, 'patternId');
  assertIdentifier(input.capabilityId, 'capabilityId');
  assertIdentifier(input.policyVersion, 'policyVersion');
  assertIdentifier(input.modelInvocationId, 'modelInvocationId');
  assertPositiveVersion(input.revision, 'revision');
  assertPositiveVersion(input.version, 'version');
  assertSha256(input.fingerprint, 'fingerprint');
  assertSha256(input.catalogHash, 'catalogHash');
  assertTimestamp(input.createdAt, 'createdAt');
  if (!['candidate', 'validating', 'active', 'deprecated', 'rejected'].includes(input.status)) {
    invalid('Capability Pattern status is invalid.');
  }
  const sourceRefs = Object.freeze(input.sourceRefs.map(createCognitiveSourceRef));
  if (sourceRefs.length === 0) invalid('Capability Patterns require source lineage.');
  const exactSkillVersionMappings = input.exactSkillVersionMappings.map((mapping) => {
    assertExactSkillVersionRef(mapping.exactSkillVersionRef);
    return Object.freeze({ ...mapping });
  });
  if (
    new Set(exactSkillVersionMappings.map((mapping) => mapping.exactSkillVersionRef)).size !==
    exactSkillVersionMappings.length
  ) {
    invalid('Capability mapping contains duplicate exact Skill versions.');
  }
  return Object.freeze({
    ...input,
    title: text(input.title, 'title'),
    summary: text(input.summary, 'summary'),
    applicableConditions: strings(input.applicableConditions, 'applicableConditions', false),
    effects: strings(input.effects, 'effects', false),
    evidenceRequirements: strings(input.evidenceRequirements, 'evidenceRequirements', false),
    artifacts: strings(input.artifacts, 'artifacts', false),
    prerequisites: strings(input.prerequisites, 'prerequisites'),
    dependencies: strings(input.dependencies, 'dependencies'),
    failures: strings(input.failures, 'failures'),
    limitations: strings(input.limitations, 'limitations'),
    evidenceByLevel: Object.freeze({
      declared: Object.freeze(input.evidenceByLevel.declared.map(createEvidence)),
      observed: Object.freeze(input.evidenceByLevel.observed.map(createEvidence)),
      validated: Object.freeze(input.evidenceByLevel.validated.map(createEvidence)),
    }),
    exactSkillVersionMappings: Object.freeze(exactSkillVersionMappings),
    sourceRefs,
  });
}

export function createCapabilityGapCandidateSnapshot(
  input: CapabilityGapCandidateSnapshot,
): CapabilityGapCandidateSnapshot {
  assertIdentifier(input.gapId, 'gapId');
  assertIdentifier(input.patternId, 'patternId');
  assertIdentifier(input.capabilityId, 'capabilityId');
  assertIdentifier(input.authoringProposal.proposalId, 'proposalId');
  assertPositiveVersion(input.patternRevision, 'patternRevision');
  assertSha256(input.fingerprint, 'fingerprint');
  assertSha256(input.catalogHash, 'catalogHash');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.authoringProposal.capabilityId !== input.capabilityId) {
    invalid('Capability Gap Candidates must remain non-executable and manual-only.');
  }
  const sourceRefs = Object.freeze(input.sourceRefs.map(createCognitiveSourceRef));
  if (sourceRefs.length === 0) invalid('Capability Gap Candidates require source lineage.');
  const exactSkillVersionRefs: readonly [] = Object.freeze([]);
  return Object.freeze({
    ...input,
    exactSkillVersionRefs,
    authoringProposal: Object.freeze({
      ...input.authoringProposal,
      title: text(input.authoringProposal.title, 'proposal.title'),
      summary: text(input.authoringProposal.summary, 'proposal.summary'),
    }),
    sourceRefs,
  });
}

function freezeSignals(input: CapabilityPatternSignals): CapabilityPatternSignals {
  return Object.freeze({
    skillOutcomes: strings(input.skillOutcomes, 'skillOutcomes', false),
    attempts: strings(input.attempts, 'attempts', false),
    evidence: strings(input.evidence, 'evidence', false),
    artifacts: strings(input.artifacts, 'artifacts', false),
    corrections: strings(input.corrections, 'corrections'),
    recoveries: strings(input.recoveries, 'recoveries'),
    eventImpacts: strings(input.eventImpacts, 'eventImpacts'),
    applicableConditions: strings(input.applicableConditions, 'applicableConditions', false),
    effects: strings(input.effects, 'effects', false),
    prerequisites: strings(input.prerequisites, 'prerequisites'),
    dependencies: strings(input.dependencies, 'dependencies'),
    failures: strings(input.failures, 'failures'),
    limitations: strings(input.limitations, 'limitations'),
  });
}

function createEvidence(
  input: CapabilityPatternEvidenceSnapshot,
): CapabilityPatternEvidenceSnapshot {
  if (!['declared', 'observed', 'validated'].includes(input.level)) {
    invalid('Capability evidence level is invalid.');
  }
  if (input.episodeId !== undefined) assertIdentifier(input.episodeId, 'evidence.episodeId');
  if (input.exactSkillVersionRef !== undefined) {
    assertExactSkillVersionRef(input.exactSkillVersionRef);
  }
  if (
    (input.level === 'declared') !== (input.exactSkillVersionRef !== undefined) ||
    (input.level === 'declared') === (input.episodeId !== undefined)
  ) {
    invalid('Capability evidence authority does not match its level.');
  }
  return Object.freeze({
    ...input,
    summary: text(input.summary, 'evidence.summary'),
    sourceRefIds: strings(input.sourceRefIds, 'evidence.sourceRefIds', false),
  });
}

function strings(input: readonly string[], field: string, allowEmpty = true): readonly string[] {
  if ((!allowEmpty && input.length === 0) || input.length > 64) {
    invalid(`${field} is invalid.`);
  }
  const values = freezeStrings(input, field);
  if (new Set(values).size !== values.length) invalid(`${field} contains duplicates.`);
  return values;
}

function text(input: string, field: string): string {
  const [value] = freezeStrings([input], field);
  if (value === undefined) invalid(`${field} is invalid.`);
  return value;
}

function assertExactSkillVersionRef(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}:[1-9][0-9]*$/u.test(value)) {
    invalid('Exact Skill Version reference is invalid.');
  }
}

function invalid(message: string): never {
  throw new CognitiveDomainError('CAPABILITY_PATTERN_INVALID', message);
}
