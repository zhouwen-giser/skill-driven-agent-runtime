import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  freezeStrings,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type CapabilityEvidenceLevel = 'declared' | 'observed' | 'validated';
export type CapabilitySummaryStatus = 'building' | 'active' | 'superseded' | 'failed';
export type CapabilityLimitationReason =
  | 'missing_outcome_specification'
  | 'internal_only'
  | 'confirmation_required'
  | 'not_composable'
  | 'no_enabled_skill';

export interface CapabilityLimitation {
  readonly limitationId: string;
  readonly reasonCode: CapabilityLimitationReason;
  readonly detail: string;
}

export interface RuntimeCapabilitySummaryItem {
  readonly capabilityId: string;
  readonly domain: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly public: boolean;
  readonly effects: readonly string[];
  readonly evidence: readonly string[];
  readonly artifacts: readonly string[];
  readonly contexts: readonly string[];
  readonly modes: readonly string[];
  readonly taskTypes: readonly string[];
  readonly composition: readonly string[];
  readonly limitations: readonly CapabilityLimitation[];
  readonly exactSkillVersionRefs: readonly string[];
}

export interface RuntimeCapabilitySummarySnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly summaryId: string;
  readonly revision: number;
  readonly catalogHash: string;
  readonly generationPolicyVersion: string;
  readonly status: CapabilitySummaryStatus;
  readonly items: readonly RuntimeCapabilitySummaryItem[];
  readonly sourceRefs: readonly CognitiveSourceRef[];
  readonly builtAt: string;
}

export function createRuntimeCapabilitySummarySnapshot(
  input: RuntimeCapabilitySummarySnapshot,
): RuntimeCapabilitySummarySnapshot {
  assertIdentifier(input.summaryId, 'summaryId');
  assertPositiveVersion(input.revision, 'revision');
  assertSha256(input.catalogHash, 'catalogHash');
  assertIdentifier(input.generationPolicyVersion, 'generationPolicyVersion');
  assertTimestamp(input.builtAt, 'builtAt');
  const seen = new Set<string>();
  const items = input.items.map((item) => {
    assertIdentifier(item.capabilityId, 'capabilityId');
    if (seen.has(item.capabilityId)) {
      throw new CognitiveDomainError(
        'CAPABILITY_SUMMARY_INVALID',
        'Capability identifiers must be unique.',
      );
    }
    seen.add(item.capabilityId);
    assertIdentifier(item.domain, 'domain');
    const title = item.title.trim();
    if (title.length === 0 || title.length > 512) {
      throw new CognitiveDomainError('CAPABILITY_SUMMARY_INVALID', 'Capability title is invalid.');
    }
    const shortDescription = item.shortDescription.trim();
    if (shortDescription.length === 0 || shortDescription.length > 2048) {
      throw new CognitiveDomainError(
        'CAPABILITY_SUMMARY_INVALID',
        'Capability short description is invalid.',
      );
    }
    if (typeof item.public !== 'boolean') {
      throw new CognitiveDomainError(
        'CAPABILITY_SUMMARY_INVALID',
        'Capability public flag is invalid.',
      );
    }
    const limitationIds = new Set<string>();
    const limitations = item.limitations.map((limitation) => {
      assertIdentifier(limitation.limitationId, 'limitationId');
      if (limitationIds.has(limitation.limitationId)) {
        throw new CognitiveDomainError(
          'CAPABILITY_SUMMARY_INVALID',
          'Capability limitation identifiers must be unique.',
        );
      }
      limitationIds.add(limitation.limitationId);
      const detail = limitation.detail.trim();
      if (detail.length === 0 || detail.length > 4096) {
        throw new CognitiveDomainError(
          'CAPABILITY_SUMMARY_INVALID',
          'Capability limitation detail is invalid.',
        );
      }
      return Object.freeze({ ...limitation, detail });
    });
    return Object.freeze({
      ...item,
      title,
      shortDescription,
      effects: freezeStrings(item.effects, 'effects'),
      evidence: freezeStrings(item.evidence, 'evidence'),
      artifacts: freezeStrings(item.artifacts, 'artifacts'),
      contexts: freezeStrings(item.contexts, 'contexts'),
      modes: freezeStrings(item.modes, 'modes'),
      taskTypes: freezeStrings(item.taskTypes, 'taskTypes'),
      composition: freezeStrings(item.composition, 'composition'),
      limitations: Object.freeze(limitations),
      exactSkillVersionRefs: freezeStrings(item.exactSkillVersionRefs, 'exactSkillVersionRefs'),
    });
  });
  return Object.freeze({
    ...input,
    items: Object.freeze(items),
    sourceRefs: Object.freeze([...input.sourceRefs]),
  });
}

export interface CapabilityIndexEntry {
  readonly capabilityId: string;
  readonly domain: string;
  readonly shortDescription: string;
  readonly effectSummary: readonly string[];
  readonly evidenceSummary: readonly string[];
  readonly limitationSummary: readonly CapabilityLimitationReason[];
  readonly detailRef: string;
  readonly public: boolean;
}

export interface CapabilityIndexSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly summaryId: string;
  readonly catalogHash: string;
  readonly entries: readonly CapabilityIndexEntry[];
  readonly characterCount: number;
  readonly truncated: boolean;
}

export function createCapabilityIndexSnapshot(
  input: CapabilityIndexSnapshot,
): CapabilityIndexSnapshot {
  assertIdentifier(input.summaryId, 'summaryId');
  assertSha256(input.catalogHash, 'catalogHash');
  if (!Number.isSafeInteger(input.characterCount) || input.characterCount < 0) {
    throw new CognitiveDomainError(
      'CAPABILITY_INDEX_INVALID',
      'Capability index character count is invalid.',
    );
  }
  const ids = new Set<string>();
  const entries = input.entries.map((entry) => {
    assertIdentifier(entry.capabilityId, 'capabilityId');
    assertIdentifier(entry.domain, 'domain');
    if (ids.has(entry.capabilityId)) {
      throw new CognitiveDomainError(
        'CAPABILITY_INDEX_INVALID',
        'Capability index identifiers must be unique.',
      );
    }
    ids.add(entry.capabilityId);
    const shortDescription = entry.shortDescription.trim();
    if (shortDescription.length === 0 || shortDescription.length > 2048) {
      throw new CognitiveDomainError(
        'CAPABILITY_INDEX_INVALID',
        'Capability index description is invalid.',
      );
    }
    return Object.freeze({
      ...entry,
      shortDescription,
      effectSummary: freezeStrings(entry.effectSummary, 'effectSummary'),
      evidenceSummary: freezeStrings(entry.evidenceSummary, 'evidenceSummary'),
      limitationSummary: Object.freeze([...entry.limitationSummary]),
    });
  });
  return Object.freeze({ ...input, entries: Object.freeze(entries) });
}
