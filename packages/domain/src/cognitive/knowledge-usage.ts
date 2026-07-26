import {
  assertIdentifier,
  assertPositiveVersion,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveInjectionMode,
  type CognitiveScope,
} from './common.js';
import { CognitiveDomainError } from './errors.js';
import type { KnowledgeKind } from './knowledge.js';

export interface KnowledgeUsageScope {
  readonly taskId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

export interface ActiveKnowledgeDefinition {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly kind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly revision: number;
  readonly version: number;
  readonly status: 'active';
  readonly scope: CognitiveScope;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly title: string;
  readonly summary: string;
  readonly definition: Readonly<Record<string, unknown>>;
  readonly authoritativeRef: string;
  readonly exactSkillVersionRefs: readonly string[];
  readonly catalogHash?: string;
  readonly promotionPolicyVersion: string;
  readonly createdAt: string;
}

export interface KnowledgeIndexEntry {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly kind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly revision: number;
  readonly authoritativeRef: string;
  readonly title: string;
  readonly summary: string;
  readonly risk: 'low' | 'medium' | 'high';
}

export type KnowledgeRelationType =
  'requires' | 'contradicts' | 'supersedes' | 'supported_by' | 'related';

export interface KnowledgeRelation {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly relationId: string;
  readonly sourceKind: KnowledgeKind;
  readonly sourceKnowledgeId: string;
  readonly sourceRevision: number;
  readonly targetKind: KnowledgeKind;
  readonly targetKnowledgeId: string;
  readonly targetRevision: number;
  readonly relationType: KnowledgeRelationType;
  readonly evidenceRefs: readonly string[];
  readonly createdAt: string;
}

export interface ExactSkillKnowledgeDetail {
  readonly skillId: string;
  readonly version: number;
  readonly name: string;
  readonly summary: string;
  readonly status: 'enabled';
  readonly declaration: Readonly<Record<string, unknown>>;
}

export interface PlanningKnowledgeBundle {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly queryFingerprint: string;
  readonly index: readonly KnowledgeIndexEntry[];
  readonly definitions: readonly ActiveKnowledgeDefinition[];
  readonly exactSkills: readonly ExactSkillKnowledgeDetail[];
  readonly conflicts: readonly KnowledgeRelation[];
  readonly disclosureOrder: readonly string[];
  readonly characterCount: number;
  readonly truncated: boolean;
  readonly elapsedMs: number;
}

export interface ExperienceUsageRecord {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly usageId: string;
  readonly planningSessionId: string;
  readonly planCandidateId: string;
  readonly knowledgeKind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly knowledgeRevision: number;
  readonly authoritativeRef: string;
  readonly queryFingerprint: string;
  readonly retrievalRank: number;
  readonly injectionMode: CognitiveInjectionMode;
  readonly affectedSkillGoalIds: readonly string[];
  readonly influence: Readonly<Record<string, unknown>>;
  readonly userAction?: 'accepted' | 'rejected' | 'patched' | 'canceled';
  readonly validatorResult?: Readonly<Record<string, unknown>>;
  readonly finalOutcomeRef?: string;
  readonly createdAt: string;
}

export function createActiveKnowledgeDefinition(
  input: ActiveKnowledgeDefinition,
): ActiveKnowledgeDefinition {
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertPositiveVersion(input.revision, 'knowledgeRevision');
  assertPositiveVersion(input.version, 'knowledgeVersion');
  assertIdentifier(input.promotionPolicyVersion, 'promotionPolicyVersion');
  assertTimestamp(input.createdAt, 'createdAt');
  if (
    input.authoritativeRef !== `${input.kind}:${input.knowledgeId}:${String(input.revision)}` ||
    input.title.trim().length === 0 ||
    input.summary.trim().length === 0
  ) {
    invalid('Active Knowledge definition or authoritative reference is invalid.');
  }
  if (input.scope === 'user' && input.userId === undefined) invalid('User scope requires userId.');
  if (input.scope === 'tenant' && input.tenantId === undefined)
    invalid('Tenant scope requires tenantId.');
  if (
    input.kind === 'capability_pattern' &&
    (input.catalogHash === undefined || input.exactSkillVersionRefs.length === 0)
  ) {
    invalid('Capability Pattern retrieval requires catalog and exact Skill Version references.');
  }
  return Object.freeze({
    ...input,
    title: input.title.trim(),
    summary: input.summary.trim(),
    definition: Object.freeze({ ...input.definition }),
    exactSkillVersionRefs: identifiers(input.exactSkillVersionRefs, 'exactSkillVersionRef'),
  });
}

export function createKnowledgeRelation(input: KnowledgeRelation): KnowledgeRelation {
  assertIdentifier(input.relationId, 'relationId');
  assertIdentifier(input.sourceKnowledgeId, 'sourceKnowledgeId');
  assertIdentifier(input.targetKnowledgeId, 'targetKnowledgeId');
  assertPositiveVersion(input.sourceRevision, 'sourceRevision');
  assertPositiveVersion(input.targetRevision, 'targetRevision');
  assertTimestamp(input.createdAt, 'createdAt');
  if (
    !['requires', 'contradicts', 'supersedes', 'supported_by', 'related'].includes(
      input.relationType,
    ) ||
    (input.sourceKind === input.targetKind &&
      input.sourceKnowledgeId === input.targetKnowledgeId &&
      input.sourceRevision === input.targetRevision)
  ) {
    invalid('Knowledge relation type or endpoints are invalid.');
  }
  return Object.freeze({
    ...input,
    evidenceRefs: identifiers(input.evidenceRefs, 'relationEvidenceRef'),
  });
}

export function createKnowledgeIndexEntry(input: KnowledgeIndexEntry): KnowledgeIndexEntry {
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertPositiveVersion(input.revision, 'knowledgeRevision');
  if (
    input.authoritativeRef !== `${input.kind}:${input.knowledgeId}:${String(input.revision)}` ||
    input.title.trim().length === 0 ||
    input.summary.trim().length === 0
  ) {
    invalid('Knowledge index entry or authoritative reference is invalid.');
  }
  return Object.freeze({
    ...input,
    title: input.title.trim(),
    summary: input.summary.trim(),
  });
}

export function createExactSkillKnowledgeDetail(
  input: ExactSkillKnowledgeDetail,
): ExactSkillKnowledgeDetail {
  assertIdentifier(input.skillId, 'skillId');
  assertPositiveVersion(input.version, 'skillVersion');
  if (input.name.trim().length === 0 || input.summary.trim().length === 0) {
    invalid('Exact Skill detail must refer to an enabled exact version.');
  }
  return Object.freeze({
    ...input,
    name: input.name.trim(),
    summary: input.summary.trim(),
    declaration: Object.freeze({ ...input.declaration }),
  });
}

export function createPlanningKnowledgeBundle(
  input: PlanningKnowledgeBundle,
): PlanningKnowledgeBundle {
  const index = Object.freeze(input.index.map(createKnowledgeIndexEntry));
  const definitions = Object.freeze(input.definitions.map(createActiveKnowledgeDefinition));
  const exactSkills = Object.freeze(input.exactSkills.map(createExactSkillKnowledgeDetail));
  const conflicts = Object.freeze(input.conflicts.map(createKnowledgeRelation));
  const actualCharacterCount = JSON.stringify({
    index,
    definitions,
    exactSkills,
    conflicts,
  }).length;
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.queryFingerprint)) {
    invalid('Query Fingerprint must be a SHA-256 reference.');
  }
  if (
    !Number.isSafeInteger(input.characterCount) ||
    input.characterCount < 0 ||
    !Number.isFinite(input.elapsedMs) ||
    input.elapsedMs < 0 ||
    input.characterCount > 20_000 ||
    input.characterCount !== actualCharacterCount
  ) {
    invalid('Planning Knowledge budget or elapsed time is invalid.');
  }
  return Object.freeze({
    ...input,
    index,
    definitions,
    exactSkills,
    conflicts,
    disclosureOrder: identifiers(input.disclosureOrder, 'disclosureRef', false),
  });
}

export function createExperienceUsageRecord(input: ExperienceUsageRecord): ExperienceUsageRecord {
  const validatorResult: unknown = input.validatorResult;
  assertIdentifier(input.usageId, 'usageId');
  assertIdentifier(input.planningSessionId, 'planningSessionId');
  assertIdentifier(input.planCandidateId, 'planCandidateId');
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertPositiveVersion(input.knowledgeRevision, 'knowledgeRevision');
  assertPositiveVersion(input.retrievalRank, 'retrievalRank');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.finalOutcomeRef !== undefined)
    assertIdentifier(input.finalOutcomeRef, 'finalOutcomeRef');
  if (
    input.authoritativeRef !==
      `${input.knowledgeKind}:${input.knowledgeId}:${String(input.knowledgeRevision)}` ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.queryFingerprint) ||
    (input.userAction !== undefined &&
      !['accepted', 'rejected', 'patched', 'canceled'].includes(input.userAction)) ||
    (validatorResult !== undefined &&
      (validatorResult === null ||
        typeof validatorResult !== 'object' ||
        Array.isArray(validatorResult)))
  ) {
    invalid('Experience usage authority, feedback or query fingerprint is invalid.');
  }
  return Object.freeze({
    ...input,
    affectedSkillGoalIds: identifiers(input.affectedSkillGoalIds, 'affectedSkillGoalId'),
    influence: Object.freeze({ ...input.influence }),
    ...(input.validatorResult === undefined
      ? {}
      : { validatorResult: Object.freeze({ ...input.validatorResult }) }),
  });
}

function identifiers(values: readonly string[], field: string, sort = true): readonly string[] {
  const unique = [...new Set(values)];
  for (const value of unique) assertIdentifier(value, field);
  if (sort) unique.sort();
  return Object.freeze(unique);
}

function invalid(message: string): never {
  throw new CognitiveDomainError('KNOWLEDGE_USAGE_INVALID', message);
}
