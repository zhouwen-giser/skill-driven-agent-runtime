import { describe, expect, it } from 'vitest';

import {
  CapabilityCardPublisher,
  CapabilitySummaryService,
  SkillRegistryService,
  type CapabilityCardRepository,
  type CapabilitySummaryRepository,
} from '../../../packages/application/src/index.js';
import {
  createPublicCapabilityCardSnapshot,
  createRuntimeCapabilitySummarySnapshot,
  type PublicCapabilityCardSnapshot,
  type RuntimeCapabilitySummarySnapshot,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  UGV_AGENT_PROFILE_ID,
  UgvAgentProfileSkillRepositoryView,
} from '../src/ugv-agent-profile.js';
import {
  InMemoryMutableSkillRepository,
  loadExactUgvProfileSkill,
} from './ugv-agent-profile-test-fixture.js';
const NOW = '2026-08-21T02:00:00.000Z';
const POLICY_VERSION = 'capability-policy-v1:ugv-agent-profile-v1';

describe('UGV Agent Profile Capability Card pipeline', () => {
  it('publishes exact SkillVersion authority and removes it through the normal Skill lifecycle', async () => {
    const skill = await loadExactUgvProfileSkill();
    const skillRepository = new InMemoryMutableSkillRepository([skill]);
    const profileCatalog = new UgvAgentProfileSkillRepositoryView(skillRepository);
    const summaries = new InMemoryCapabilitySummaryRepository();
    const cards = new InMemoryCapabilityCardRepository();
    let sequence = 0;
    const summaryService = new CapabilitySummaryService({
      catalog: { listEnabledSkillVersions: () => profileCatalog.listEnabledVersions() },
      repository: summaries,
      generationPolicyVersion: POLICY_VERSION,
      clock: { now: () => NOW },
      nextSummaryId: () => `summary.ugv.${String(++sequence)}`,
    });
    const publisher = new CapabilityCardPublisher({
      summaries: summaryService,
      catalog: { listEnabledSkillVersions: () => profileCatalog.listEnabledVersions() },
      repository: cards,
      agentName: UGV_AGENT_PROFILE_ID,
      requireCurrentCatalogOnRead: true,
      clock: { now: () => NOW },
      nextCardId: () => `card.ugv.${String(sequence)}`,
    });
    const registry = new SkillRegistryService({
      skills: skillRepository,
      validator: new AjvJsonSchemaValidator(),
      clock: { now: () => NOW },
      async afterCatalogChanged() {
        const rebuilt = await summaryService.rebuild();
        await publisher.publish(rebuilt);
      },
    });

    await summaryService.rebuild();
    const initialCard = await publisher.publish();
    const initialCardHash = initialCard.cardContentHash;

    // The Card pipeline has no Provider readiness dependency; rebuilding the same catalog is stable.
    const sameCatalogCard = await publisher.publish();
    expect(sameCatalogCard.cardContentHash).toBe(initialCardHash);
    expect(sameCatalogCard).toMatchObject({
      agentName: UGV_AGENT_PROFILE_ID,
      generationMode: 'deterministic',
      publicSkills: [{ id: 'embodied.move_to' }],
      sourceSkillRefs: ['embodied.move_to:1'],
      profile: {
        capabilities: [
          expect.objectContaining({
            capabilityId: 'embodied.move',
            taskTypes: ['embodied.move'],
          }),
          expect.objectContaining({ capabilityId: 'embodied.navigation' }),
        ],
      },
    });
    expect(JSON.stringify(sameCatalogCard)).not.toMatch(
      /ugv\.navigate|vehicle_area_recon|vehicle_fire_weapon/iu,
    );

    const disabledVersion = await registry.setEnabled('embodied.move_to', false);
    expect(disabledVersion).toMatchObject({ version: 2, previousVersion: 1, status: 'disabled' });
    const disabledCard = await publisher.findActive();
    expect(disabledCard).toMatchObject({
      publicSkills: [],
      sourceSkillRefs: [],
      profile: { capabilities: [] },
    });
    expect(disabledCard?.cardContentHash).not.toBe(initialCardHash);
  });
});

class InMemoryCapabilitySummaryRepository implements CapabilitySummaryRepository {
  readonly #items = new Map<string, RuntimeCapabilitySummarySnapshot>();
  #active: RuntimeCapabilitySummarySnapshot | undefined;

  findActive(): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return Promise.resolve(this.#active);
  }

  findById(summaryId: string): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return Promise.resolve(this.#items.get(summaryId));
  }

  findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<RuntimeCapabilitySummarySnapshot | undefined> {
    return Promise.resolve(
      [...this.#items.values()].find(
        (item) =>
          item.catalogHash === catalogHash &&
          item.generationPolicyVersion === generationPolicyVersion,
      ),
    );
  }

  saveAndActivate(
    snapshot: RuntimeCapabilitySummarySnapshot,
  ): Promise<RuntimeCapabilitySummarySnapshot> {
    const active = createRuntimeCapabilitySummarySnapshot({ ...snapshot, status: 'active' });
    this.#items.set(active.summaryId, active);
    this.#active = active;
    return Promise.resolve(active);
  }
}

class InMemoryCapabilityCardRepository implements CapabilityCardRepository {
  readonly #items = new Map<string, PublicCapabilityCardSnapshot>();
  #active: PublicCapabilityCardSnapshot | undefined;

  findActive(): Promise<PublicCapabilityCardSnapshot | undefined> {
    return Promise.resolve(this.#active);
  }

  findById(cardId: string): Promise<PublicCapabilityCardSnapshot | undefined> {
    return Promise.resolve(this.#items.get(cardId));
  }

  findByCatalogHash(
    catalogHash: string,
    generationPolicyVersion: string,
  ): Promise<PublicCapabilityCardSnapshot | undefined> {
    return Promise.resolve(
      [...this.#items.values()].find(
        (item) =>
          item.catalogHash === catalogHash &&
          item.generationPolicyVersion === generationPolicyVersion,
      ),
    );
  }

  activate(candidate: PublicCapabilityCardSnapshot): Promise<PublicCapabilityCardSnapshot> {
    const active = createPublicCapabilityCardSnapshot({ ...candidate, status: 'active' });
    this.#items.set(active.cardId, active);
    this.#active = active;
    return Promise.resolve(active);
  }
}
