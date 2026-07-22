import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createRuntimeCapabilitySummarySnapshot,
  createSkillUsageSpecification,
  createSkillVersion,
  type PublicCapabilityCardSnapshot,
  type SkillVersion,
} from '../../domain/src/index.js';
import {
  CapabilityCardPublisher,
  CapabilityCatalogSnapshotBuilder,
  PublicCapabilityProjectionPolicy,
  type CapabilityCardRepository,
} from '../src/cognitive/index.js';

describe('PublicCapabilityProjectionPolicy', () => {
  it('uses a strict public allowlist and excludes internal/readiness/source fields', () => {
    const profile = new PublicCapabilityProjectionPolicy().project(
      summary(),
      '2026-07-23T02:00:00.000Z',
    );

    expect(profile).toMatchObject({
      profileVersion: '1.0',
      catalogHash: publicCatalogHash(),
      domains: ['inspection'],
      capabilities: [expect.objectContaining({ capabilityId: 'inspection.device' })],
    });
    const wire = JSON.stringify(profile);
    expect(wire).not.toMatch(
      /internal|skill\.internal|provider|tool|workflow|credential|readiness|sourceRef/iu,
    );
  });
});

describe('CapabilityCardPublisher', () => {
  it('passes only the public profile to the optional narrative stage', async () => {
    let instruction = '';
    const publisher = new CapabilityCardPublisher({
      summaries: { getSummary: () => Promise.resolve({ summary: summary(), index: index() }) },
      catalog: { listEnabledSkillVersions: () => Promise.resolve([publicSkill()]) },
      repository: new InMemoryCapabilityCardRepository(),
      narrative: {
        generate: (input) => {
          instruction = input.instruction;
          return Promise.resolve({
            invocationId: 'invocation.narrative.1',
            structuredResult: { description: 'Public inspection is available.' },
          });
        },
      },
      clock: { now: () => '2026-07-23T02:00:00.000Z' },
      nextCardId: () => 'card.public.model',
    });

    const card = await publisher.publish();

    expect(card.generationMode).toBe('model_narrative');
    expect(card.description).toBe('Public inspection is available.');
    expect(JSON.parse(instruction)).toMatchObject({
      operation: 'write_public_capability_narrative',
      profile: { catalogHash: publicCatalogHash() },
    });
    expect(instruction).not.toMatch(/private-user-context|skill\.internal|sourceRef/iu);
  });

  it('falls back to a deterministic description when optional narrative generation fails', async () => {
    const repository = new InMemoryCapabilityCardRepository();
    const publisher = new CapabilityCardPublisher({
      summaries: { getSummary: () => Promise.resolve({ summary: summary(), index: index() }) },
      catalog: { listEnabledSkillVersions: () => Promise.resolve([publicSkill()]) },
      repository,
      narrative: {
        generate: () => Promise.reject(new Error('MODEL_UNAVAILABLE')),
      },
      clock: { now: () => '2026-07-23T02:00:00.000Z' },
      nextCardId: () => 'card.public.1',
    });

    const card = await publisher.publish();

    expect(card.generationMode).toBe('deterministic_fallback');
    expect(card.description).toBe(
      'Skill-Driven Agent Runtime provides 1 public capability across 1 domain.',
    );
    expect(card.publicSkills).toEqual([
      expect.objectContaining({ id: 'skill.public', inputModes: ['text/plain'] }),
    ]);
    expect(await repository.findActive()).toEqual(card);
  });

  it('rejects prohibited model narrative content and keeps the deterministic public description', async () => {
    const publisher = new CapabilityCardPublisher({
      summaries: { getSummary: () => Promise.resolve({ summary: summary(), index: index() }) },
      catalog: { listEnabledSkillVersions: () => Promise.resolve([publicSkill()]) },
      repository: new InMemoryCapabilityCardRepository(),
      narrative: {
        generate: () =>
          Promise.resolve({
            invocationId: 'invocation.narrative.private',
            structuredResult: { description: 'Use the private Provider endpoint.' },
          }),
      },
      clock: { now: () => '2026-07-23T02:00:00.000Z' },
      nextCardId: () => 'card.public.filtered',
    });

    await expect(publisher.publish()).resolves.toMatchObject({
      generationMode: 'deterministic_fallback',
      description: 'Skill-Driven Agent Runtime provides 1 public capability across 1 domain.',
    });
  });

  it('rejects activation when the exact catalog no longer matches the Summary hash', async () => {
    const publisher = new CapabilityCardPublisher({
      summaries: { getSummary: () => Promise.resolve({ summary: summary(), index: index() }) },
      catalog: { listEnabledSkillVersions: () => Promise.resolve([]) },
      repository: new InMemoryCapabilityCardRepository(),
      clock: { now: () => '2026-07-23T02:00:00.000Z' },
      nextCardId: () => 'card.public.stale',
    });

    await expect(publisher.publish()).rejects.toThrow('CAPABILITY_CARD_CATALOG_HASH_MISMATCH');
  });
});

function summary() {
  return createRuntimeCapabilitySummarySnapshot({
    schemaVersion: '1.0',
    summaryId: 'summary.public.1',
    revision: 1,
    catalogHash: publicCatalogHash(),
    generationPolicyVersion: 'capability-policy-v1',
    status: 'active',
    items: [
      {
        capabilityId: 'inspection.device',
        domain: 'inspection',
        title: 'Device inspection',
        shortDescription: 'Inspect a declared device.',
        public: true,
        effects: ['effect.inspected'],
        evidence: ['evidence.observation'],
        artifacts: ['artifact.report'],
        contexts: ['private-user-context'],
        modes: ['guidance'],
        taskTypes: ['device.inspect'],
        composition: ['skill:skill.internal:1'],
        limitations: [
          {
            limitationId: 'limitation.confirmation',
            reasonCode: 'confirmation_required',
            detail: 'Internal Skill skill.internal:1 requires confirmation.',
          },
          {
            limitationId: 'limitation.internal',
            reasonCode: 'internal_only',
            detail: 'Internal Skill skill.internal:1 is present.',
          },
        ],
        exactSkillVersionRefs: ['skill.public:1', 'skill.internal:1'],
      },
      {
        capabilityId: 'internal.operation',
        domain: 'internal',
        title: 'Internal operation',
        shortDescription: 'Never public.',
        public: false,
        effects: [],
        evidence: [],
        artifacts: [],
        contexts: [],
        modes: [],
        taskTypes: [],
        composition: [],
        limitations: [],
        exactSkillVersionRefs: ['skill.internal:1'],
      },
    ],
    sourceRefs: [],
    builtAt: '2026-07-23T01:59:00.000Z',
  });
}

function index() {
  return {
    schemaVersion: '1.0' as const,
    summaryId: 'summary.public.1',
    catalogHash: publicCatalogHash(),
    entries: [],
    characterCount: 2,
    truncated: false,
  };
}

function publicSkill(): SkillVersion {
  const outcome = {
    schemaVersion: '1.0' as const,
    skillId: 'skill.public',
    skillVersion: 1,
    effects: ['effect.inspected'],
    evidence: ['evidence.observation'],
    artifacts: ['artifact.report'],
    taskGoalPolicy: {},
    confidencePolicy: {},
    sideEffectPolicy: { classification: 'read_only' },
  };
  return createSkillVersion({
    skillId: 'skill.public',
    version: 1,
    name: 'Public inspection',
    summary: 'Inspect a declared device.',
    description: 'Inspect a declared device and return public evidence.',
    capabilities: ['inspection.device'],
    workflowGuidance: 'Use declared inputs.',
    outputInstruction: 'Return evidence.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-23T01:58:00.000Z',
    usageSpecification: createSkillUsageSpecification({
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Use public inputs.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Guidance', instructions: ['Guide.'] },
      },
      taskBindings: [],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    }),
    outcomeSpecification: {
      ...outcome,
      specificationHash: `sha256:${createHash('sha256').update(JSON.stringify(outcome)).digest('hex')}`,
    },
  });
}

function publicCatalogHash(): string {
  return new CapabilityCatalogSnapshotBuilder().build([publicSkill()]).catalogHash;
}

class InMemoryCapabilityCardRepository implements CapabilityCardRepository {
  #active: PublicCapabilityCardSnapshot | undefined;

  findActive(): Promise<PublicCapabilityCardSnapshot | undefined> {
    return Promise.resolve(this.#active);
  }

  findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<PublicCapabilityCardSnapshot | undefined> {
    return Promise.resolve(
      this.#active?.catalogHash === catalogHash &&
        this.#active.generationPolicyVersion === generationPolicyVersion
        ? this.#active
        : undefined,
    );
  }

  activate(candidate: PublicCapabilityCardSnapshot): Promise<PublicCapabilityCardSnapshot> {
    this.#active = { ...candidate, status: 'active' };
    return Promise.resolve(this.#active);
  }
}
