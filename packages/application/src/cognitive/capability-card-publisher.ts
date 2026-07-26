import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  COGNITIVE_SCHEMA_VERSION,
  createPublicCapabilityCardSnapshot,
  type PublicAgentSkillSnapshot,
  type PublicCapabilityCardSnapshot,
  type PublicCapabilityItem,
  type PublicCapabilityLimitation,
  type PublicCapabilityProfile,
  type RuntimeCapabilitySummarySnapshot,
  type SkillVersion,
} from '../../../domain/src/index.js';

import { CapabilityCatalogSnapshotBuilder } from './capability-summary-builder.js';
import type { CapabilitySummaryView } from './capability-summary-service.js';
import type {
  CapabilityCardRepository,
  CapabilityCatalogSource,
  CognitiveStructuredModelStageInvoker,
} from './ports.js';

const PUBLIC_LIMITATION_MESSAGES = Object.freeze({
  confirmation_required: 'Some uses require explicit confirmation.',
  not_composable: 'Some uses are not available for automatic composition.',
} as const);

const NarrativeSchema = z.object({ description: z.string().trim().min(1).max(2048) }).strict();

const NarrativeJsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['description'],
  properties: { description: { type: 'string', minLength: 1, maxLength: 2048 } },
});

const PROHIBITED_NARRATIVE =
  /(?:https?:\/\/|credential|api[ _-]?key|access[ _-]?token|provider|endpoint|workflow|prompt|private|user data|real[- ]?time resource|tool policy)/iu;

export class PublicCapabilityProjectionPolicy {
  project(summary: RuntimeCapabilitySummarySnapshot, generatedAt: string): PublicCapabilityProfile {
    const capabilities = summary.items
      .filter((item) => item.public)
      .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
      .map((item): PublicCapabilityItem => {
        const limitations = publicLimitations(item.limitations.map((value) => value.reasonCode));
        return Object.freeze({
          capabilityId: item.capabilityId,
          domain: item.domain,
          title: item.title,
          description: item.shortDescription,
          effects: Object.freeze([...item.effects]),
          evidence: Object.freeze([...item.evidence]),
          artifacts: Object.freeze([...item.artifacts]),
          modes: Object.freeze([...item.modes]),
          taskTypes: Object.freeze([...item.taskTypes]),
          limitations,
        });
      });
    const domains = Object.freeze([...new Set(capabilities.map((item) => item.domain))].sort());
    const limitations = publicLimitations(
      capabilities.flatMap((item) => item.limitations.map((value) => value.code)),
    );
    return Object.freeze({
      profileVersion: '1.0',
      catalogHash: summary.catalogHash,
      domains,
      capabilities: Object.freeze(capabilities),
      limitations,
      generatedAt,
    });
  }
}

export class CapabilityCardPublisher {
  readonly #summaries: Readonly<{
    getSummary(): Promise<CapabilitySummaryView | undefined>;
  }>;
  readonly #catalog: CapabilityCatalogSource;
  readonly #repository: CapabilityCardRepository;
  readonly #narrative: CognitiveStructuredModelStageInvoker | undefined;
  readonly #policy: PublicCapabilityProjectionPolicy;
  readonly #catalogBuilder = new CapabilityCatalogSnapshotBuilder();
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextCardId: () => string;

  constructor(
    dependencies: Readonly<{
      summaries: Readonly<{ getSummary(): Promise<CapabilitySummaryView | undefined> }>;
      catalog: CapabilityCatalogSource;
      repository: CapabilityCardRepository;
      narrative?: CognitiveStructuredModelStageInvoker;
      policy?: PublicCapabilityProjectionPolicy;
      clock: Readonly<{ now(): string }>;
      nextCardId(): string;
    }>,
  ) {
    this.#summaries = dependencies.summaries;
    this.#catalog = dependencies.catalog;
    this.#repository = dependencies.repository;
    this.#narrative = dependencies.narrative;
    this.#policy = dependencies.policy ?? new PublicCapabilityProjectionPolicy();
    this.#clock = dependencies.clock;
    this.#nextCardId = dependencies.nextCardId;
  }

  findActive(): Promise<PublicCapabilityCardSnapshot | undefined> {
    return this.#repository.findActive();
  }

  findById(cardId: string): Promise<PublicCapabilityCardSnapshot | undefined> {
    return this.#repository.findById(cardId);
  }

  async publish(
    rebuiltView?: CapabilitySummaryView,
    expectedActiveRevision?: number,
  ): Promise<PublicCapabilityCardSnapshot> {
    const view = rebuiltView ?? (await this.#summaries.getSummary());
    if (view === undefined) throw new Error('CAPABILITY_CARD_SUMMARY_NOT_AVAILABLE');
    const active = await this.#repository.findActive();
    if (
      expectedActiveRevision !== undefined &&
      (active?.revision ?? 0) !== expectedActiveRevision
    ) {
      throw new CapabilityCardRevisionConflictError();
    }
    const skills = await this.#catalog.listEnabledSkillVersions();
    const catalog = this.#catalogBuilder.build(skills);
    if (catalog.catalogHash !== view.summary.catalogHash) {
      throw new Error('CAPABILITY_CARD_CATALOG_HASH_MISMATCH');
    }
    const existing = await this.#repository.findByCatalogHash(
      view.summary.catalogHash,
      view.summary.generationPolicyVersion,
    );
    if (existing?.status === 'active') return existing;

    const generatedAt = this.#clock.now();
    const profile = this.#policy.project(view.summary, generatedAt);
    const deterministicDescription = deterministicNarrative(profile);
    const narrative = await this.#optionalNarrative(profile);
    const description = narrative ?? deterministicDescription;
    const generationMode =
      narrative === undefined
        ? this.#narrative === undefined
          ? ('deterministic' as const)
          : ('deterministic_fallback' as const)
        : ('model_narrative' as const);
    const publicSkills = publicSkillSnapshots(skills);
    const publicContent = {
      agentName: 'Skill-Driven Agent Runtime',
      description,
      profile,
      publicSkills,
    };
    return this.#repository.activate(
      createPublicCapabilityCardSnapshot({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        cardId: this.#nextCardId(),
        revision: (active?.revision ?? 0) + 1,
        summaryId: view.summary.summaryId,
        catalogHash: view.summary.catalogHash,
        generationPolicyVersion: view.summary.generationPolicyVersion,
        profileVersion: '1.0',
        status: 'candidate',
        agentName: publicContent.agentName,
        description: publicContent.description,
        profile: publicContent.profile,
        publicSkills: publicContent.publicSkills,
        sourceSkillRefs: publicSkillRefs(skills),
        generationMode,
        cardContentHash: hashCanonical(publicContent),
        generatedAt,
      }),
      expectedActiveRevision ?? active?.revision,
    );
  }

  async #optionalNarrative(profile: PublicCapabilityProfile): Promise<string | undefined> {
    if (this.#narrative === undefined) return undefined;
    try {
      const invocation = await this.#narrative.generate({
        stage: 'capability_narrative',
        instruction: JSON.stringify({
          operation: 'write_public_capability_narrative',
          policy:
            'Write one concise public description using only this allowlisted capability profile.',
          profile,
        }),
        responseSchema: NarrativeJsonSchema,
        sourceRefs: [],
        maxAttempts: 1,
        timeoutMs: 5_000,
      });
      const result = NarrativeSchema.parse(invocation.structuredResult);
      return PROHIBITED_NARRATIVE.test(result.description) ? undefined : result.description;
    } catch {
      return undefined;
    }
  }
}

export class CapabilityCardRevisionConflictError extends Error {
  readonly code = 'CAPABILITY_CARD_ACTIVE_REVISION_CONFLICT' as const;

  constructor() {
    super('CAPABILITY_CARD_ACTIVE_REVISION_CONFLICT');
  }
}

function publicSkillSnapshots(
  skills: readonly SkillVersion[],
): readonly PublicAgentSkillSnapshot[] {
  return Object.freeze(
    skills
      .filter(isPublicSkill)
      .sort(
        (left, right) => left.skillId.localeCompare(right.skillId) || left.version - right.version,
      )
      .map((skill) =>
        Object.freeze({
          id: skill.skillId,
          name: skill.name,
          description: skill.description,
          tags: Object.freeze([...skill.capabilities].sort()),
          inputModes: Object.freeze(['text/plain']),
          outputModes: Object.freeze(['text/plain', 'application/json']),
        }),
      ),
  );
}

function publicSkillRefs(skills: readonly SkillVersion[]): readonly string[] {
  return Object.freeze(
    skills
      .filter(isPublicSkill)
      .sort(
        (left, right) => left.skillId.localeCompare(right.skillId) || left.version - right.version,
      )
      .map((skill) => `${skill.skillId}:${String(skill.version)}`),
  );
}

function isPublicSkill(skill: SkillVersion): boolean {
  return (
    skill.usageSpecification?.visibility.userSelectable === true &&
    !skill.usageSpecification.visibility.internalOnly
  );
}

function publicLimitations(codes: readonly string[]): readonly PublicCapabilityLimitation[] {
  return Object.freeze(
    [...new Set(codes)]
      .filter(
        (code): code is keyof typeof PUBLIC_LIMITATION_MESSAGES =>
          code in PUBLIC_LIMITATION_MESSAGES,
      )
      .sort()
      .map((code) => Object.freeze({ code, message: PUBLIC_LIMITATION_MESSAGES[code] })),
  );
}

function deterministicNarrative(profile: PublicCapabilityProfile): string {
  const capabilityWord = profile.capabilities.length === 1 ? 'capability' : 'capabilities';
  const domainWord = profile.domains.length === 1 ? 'domain' : 'domains';
  return `Skill-Driven Agent Runtime provides ${String(profile.capabilities.length)} public ${capabilityWord} across ${String(profile.domains.length)} ${domainWord}.`;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
