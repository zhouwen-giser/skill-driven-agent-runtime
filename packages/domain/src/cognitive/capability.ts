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

export interface RuntimeCapabilitySummaryItem {
  readonly capabilityId: string;
  readonly title: string;
  readonly effects: readonly string[];
  readonly evidence: readonly string[];
  readonly artifacts: readonly string[];
  readonly contexts: readonly string[];
  readonly modes: readonly string[];
  readonly taskTypes: readonly string[];
  readonly composition: readonly string[];
  readonly limitations: readonly string[];
  readonly exactSkillVersionRefs: readonly string[];
}

export interface RuntimeCapabilitySummarySnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly summaryId: string;
  readonly revision: number;
  readonly catalogHash: string;
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
    const title = item.title.trim();
    if (title.length === 0 || title.length > 512) {
      throw new CognitiveDomainError('CAPABILITY_SUMMARY_INVALID', 'Capability title is invalid.');
    }
    return Object.freeze({
      ...item,
      title,
      effects: freezeStrings(item.effects, 'effects'),
      evidence: freezeStrings(item.evidence, 'evidence'),
      artifacts: freezeStrings(item.artifacts, 'artifacts'),
      contexts: freezeStrings(item.contexts, 'contexts'),
      modes: freezeStrings(item.modes, 'modes'),
      taskTypes: freezeStrings(item.taskTypes, 'taskTypes'),
      composition: freezeStrings(item.composition, 'composition'),
      limitations: Object.freeze(item.limitations.map((value) => value.trim()).filter(Boolean)),
      exactSkillVersionRefs: freezeStrings(item.exactSkillVersionRefs, 'exactSkillVersionRefs'),
    });
  });
  return Object.freeze({
    ...input,
    items: Object.freeze(items),
    sourceRefs: Object.freeze([...input.sourceRefs]),
  });
}
