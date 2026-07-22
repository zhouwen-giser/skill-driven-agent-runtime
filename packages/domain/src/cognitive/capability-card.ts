import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  freezeStrings,
  type COGNITIVE_SCHEMA_VERSION,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type PublicCapabilityLimitationCode = 'confirmation_required' | 'not_composable';

export interface PublicCapabilityLimitation {
  readonly code: PublicCapabilityLimitationCode;
  readonly message: string;
}

export interface PublicCapabilityItem {
  readonly capabilityId: string;
  readonly domain: string;
  readonly title: string;
  readonly description: string;
  readonly effects: readonly string[];
  readonly evidence: readonly string[];
  readonly artifacts: readonly string[];
  readonly modes: readonly string[];
  readonly taskTypes: readonly string[];
  readonly limitations: readonly PublicCapabilityLimitation[];
}

export interface PublicCapabilityProfile {
  readonly profileVersion: '1.0';
  readonly catalogHash: string;
  readonly domains: readonly string[];
  readonly capabilities: readonly PublicCapabilityItem[];
  readonly limitations: readonly PublicCapabilityLimitation[];
  readonly generatedAt: string;
}

export interface PublicAgentSkillSnapshot {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly inputModes: readonly string[];
  readonly outputModes: readonly string[];
}

export type CapabilityCardStatus = 'candidate' | 'active' | 'superseded' | 'failed';
export type CapabilityCardGenerationMode =
  'deterministic' | 'model_narrative' | 'deterministic_fallback';

const CAPABILITY_CARD_STATUSES = new Set<CapabilityCardStatus>([
  'candidate',
  'active',
  'superseded',
  'failed',
]);
const CAPABILITY_CARD_GENERATION_MODES = new Set<CapabilityCardGenerationMode>([
  'deterministic',
  'model_narrative',
  'deterministic_fallback',
]);
const PUBLIC_LIMITATION_CODES = new Set<PublicCapabilityLimitationCode>([
  'confirmation_required',
  'not_composable',
]);

export interface PublicCapabilityCardSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly cardId: string;
  readonly revision: number;
  readonly summaryId: string;
  readonly catalogHash: string;
  readonly generationPolicyVersion: string;
  readonly profileVersion: '1.0';
  readonly status: CapabilityCardStatus;
  readonly agentName: string;
  readonly description: string;
  readonly profile: PublicCapabilityProfile;
  readonly publicSkills: readonly PublicAgentSkillSnapshot[];
  readonly sourceSkillRefs: readonly string[];
  readonly generationMode: CapabilityCardGenerationMode;
  readonly cardContentHash: string;
  readonly generatedAt: string;
}

export function createPublicCapabilityCardSnapshot(
  input: PublicCapabilityCardSnapshot,
): PublicCapabilityCardSnapshot {
  assertIdentifier(input.cardId, 'cardId');
  assertPositiveVersion(input.revision, 'revision');
  assertIdentifier(input.summaryId, 'summaryId');
  assertSha256(input.catalogHash, 'catalogHash');
  assertIdentifier(input.generationPolicyVersion, 'generationPolicyVersion');
  assertSha256(input.cardContentHash, 'cardContentHash');
  assertTimestamp(input.generatedAt, 'generatedAt');
  assertProfileVersion(input.profileVersion);
  assertProfileVersion(input.profile.profileVersion);
  assertCapabilityCardStatus(input.status);
  assertCapabilityCardGenerationMode(input.generationMode);
  if (
    input.profile.catalogHash !== input.catalogHash ||
    input.profile.generatedAt !== input.generatedAt
  ) {
    invalid('Public Capability Card profile binding is invalid.');
  }
  const agentName = boundedText(input.agentName, 256, 'agent name');
  const description = boundedText(input.description, 2048, 'description');
  const domains = freezeStrings(input.profile.domains, 'public domains');
  const capabilityIds = new Set<string>();
  const capabilities = input.profile.capabilities.map((item) => {
    assertIdentifier(item.capabilityId, 'capabilityId');
    assertIdentifier(item.domain, 'domain');
    if (capabilityIds.has(item.capabilityId))
      invalid('Public capability identifiers must be unique.');
    capabilityIds.add(item.capabilityId);
    return Object.freeze({
      ...item,
      title: boundedText(item.title, 512, 'capability title'),
      description: boundedText(item.description, 2048, 'capability description'),
      effects: freezeStrings(item.effects, 'public effects'),
      evidence: freezeStrings(item.evidence, 'public evidence'),
      artifacts: freezeStrings(item.artifacts, 'public artifacts'),
      modes: freezeStrings(item.modes, 'public modes'),
      taskTypes: freezeStrings(item.taskTypes, 'public task types'),
      limitations: freezeLimitations(item.limitations),
    });
  });
  const skillIds = new Set<string>();
  const publicSkills = input.publicSkills.map((skill) => {
    assertIdentifier(skill.id, 'publicSkillId');
    if (skillIds.has(skill.id)) invalid('Public Skill identifiers must be unique.');
    skillIds.add(skill.id);
    return Object.freeze({
      ...skill,
      name: boundedText(skill.name, 512, 'public Skill name'),
      description: boundedText(skill.description, 2048, 'public Skill description'),
      tags: freezeStrings(skill.tags, 'public Skill tags'),
      inputModes: freezeStrings(skill.inputModes, 'public Skill input modes'),
      outputModes: freezeStrings(skill.outputModes, 'public Skill output modes'),
    });
  });
  const sourceSkillRefs = freezeStrings(input.sourceSkillRefs, 'source Skill refs');
  if (
    sourceSkillRefs.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}:[1-9][0-9]*$/u.test(value))
  ) {
    invalid('Public Capability Card source Skill ref is invalid.');
  }
  return Object.freeze({
    ...input,
    agentName,
    description,
    profile: Object.freeze({
      ...input.profile,
      domains,
      capabilities: Object.freeze(capabilities),
      limitations: freezeLimitations(input.profile.limitations),
    }),
    publicSkills: Object.freeze(publicSkills),
    sourceSkillRefs,
  });
}

function freezeLimitations(
  values: readonly PublicCapabilityLimitation[],
): readonly PublicCapabilityLimitation[] {
  const codes = new Set<PublicCapabilityLimitationCode>();
  return Object.freeze(
    values.map((limitation) => {
      assertPublicLimitationCode(limitation.code);
      if (codes.has(limitation.code)) {
        invalid('Public Capability Card limitation codes must be unique.');
      }
      codes.add(limitation.code);
      return Object.freeze({
        code: limitation.code,
        message: boundedText(limitation.message, 1024, 'public limitation'),
      });
    }),
  );
}

function assertProfileVersion(value: unknown): asserts value is '1.0' {
  if (value !== '1.0') invalid('Public Capability Card profile version is invalid.');
}

function assertCapabilityCardStatus(value: unknown): asserts value is CapabilityCardStatus {
  if (typeof value !== 'string' || !CAPABILITY_CARD_STATUSES.has(value as CapabilityCardStatus)) {
    invalid('Public Capability Card status is invalid.');
  }
}

function assertCapabilityCardGenerationMode(
  value: unknown,
): asserts value is CapabilityCardGenerationMode {
  if (
    typeof value !== 'string' ||
    !CAPABILITY_CARD_GENERATION_MODES.has(value as CapabilityCardGenerationMode)
  ) {
    invalid('Public Capability Card generation mode is invalid.');
  }
}

function assertPublicLimitationCode(
  value: unknown,
): asserts value is PublicCapabilityLimitationCode {
  if (
    typeof value !== 'string' ||
    !PUBLIC_LIMITATION_CODES.has(value as PublicCapabilityLimitationCode)
  ) {
    invalid('Public Capability Card limitation code is invalid.');
  }
}

function boundedText(value: string, maximum: number, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    invalid(`Public Capability Card ${field} is invalid.`);
  }
  return normalized;
}

function invalid(message: string): never {
  throw new CognitiveDomainError('CAPABILITY_CARD_INVALID', message);
}
