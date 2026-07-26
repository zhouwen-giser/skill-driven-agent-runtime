import { createHash } from 'node:crypto';

import {
  createCapabilityGapCandidateSnapshot,
  type CapabilityGapCandidateSnapshot,
  type CapabilityPatternDefinitionSnapshot,
} from '../../../domain/src/index.js';
import type { CapabilityPatternRepository } from './ports.js';

export class CapabilityGapService {
  readonly #repository: CapabilityPatternRepository;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextGapId: (fingerprint: string) => string;
  readonly #nextProposalId: (fingerprint: string) => string;

  constructor(
    dependencies: Readonly<{
      repository: CapabilityPatternRepository;
      clock: Readonly<{ now(): string }>;
      nextGapId(fingerprint: string): string;
      nextProposalId(fingerprint: string): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#nextGapId = dependencies.nextGapId;
    this.#nextProposalId = dependencies.nextProposalId;
  }

  async createCandidate(
    pattern: CapabilityPatternDefinitionSnapshot,
  ): Promise<CapabilityGapCandidateSnapshot> {
    if (pattern.exactSkillVersionMappings.length !== 0) {
      throw new CapabilityGapError(
        'CAPABILITY_GAP_MAPPING_NOT_EMPTY',
        'A Capability Gap requires an empty current Skill mapping.',
      );
    }
    const fingerprint = hash(
      JSON.stringify({
        capabilityId: pattern.capabilityId,
        patternFingerprint: pattern.fingerprint,
        catalogHash: pattern.catalogHash,
      }),
    );
    const existing = await this.#repository.findGapByFingerprint(fingerprint);
    if (existing !== undefined) return existing;
    const candidate = createCapabilityGapCandidateSnapshot({
      schemaVersion: '1.0',
      gapId: this.#nextGapId(fingerprint),
      status: 'candidate',
      fingerprint,
      patternId: pattern.patternId,
      patternRevision: pattern.revision,
      capabilityId: pattern.capabilityId,
      catalogHash: pattern.catalogHash,
      exactSkillVersionRefs: [],
      executable: false,
      authoringProposal: {
        proposalId: this.#nextProposalId(fingerprint),
        status: 'proposed',
        reviewMode: 'manual',
        publishAllowed: false,
        capabilityId: pattern.capabilityId,
        title: `Author a Skill for ${pattern.capabilityId}`,
        summary: `Manual review proposal derived from Capability Gap ${pattern.patternId}; it cannot publish or execute a Skill.`,
      },
      sourceRefs: pattern.sourceRefs,
      createdAt: this.#clock.now(),
    });
    await this.#repository.saveGapCandidate(candidate);
    return candidate;
  }
}

export class CapabilityGapError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CapabilityGapError';
    this.code = code;
  }
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
