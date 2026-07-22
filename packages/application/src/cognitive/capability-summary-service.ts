import type {
  CapabilityIndexSnapshot,
  RuntimeCapabilitySummarySnapshot,
} from '../../../domain/src/index.js';

import { CapabilityIndexBuilder, type CapabilityIndexBudget } from './capability-index-builder.js';
import { CapabilitySummaryBuilder } from './capability-summary-builder.js';
import type {
  CapabilityCatalogChangeSource,
  CapabilityCatalogSource,
  CapabilitySummaryRepository,
} from './ports.js';

export interface CapabilitySummaryView {
  readonly summary: RuntimeCapabilitySummarySnapshot;
  readonly index: CapabilityIndexSnapshot;
}

export class CapabilitySummaryService {
  readonly #catalog: CapabilityCatalogSource;
  readonly #repository: CapabilitySummaryRepository;
  readonly #builder: CapabilitySummaryBuilder;
  readonly #indexBuilder: CapabilityIndexBuilder;
  readonly #generationPolicyVersion: string;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #nextSummaryId: () => string;
  #cache: RuntimeCapabilitySummarySnapshot | undefined;

  constructor(
    dependencies: Readonly<{
      catalog: CapabilityCatalogSource;
      repository: CapabilitySummaryRepository;
      builder?: CapabilitySummaryBuilder;
      indexBuilder?: CapabilityIndexBuilder;
      generationPolicyVersion: string;
      clock: Readonly<{ now(): string }>;
      nextSummaryId(): string;
    }>,
  ) {
    this.#catalog = dependencies.catalog;
    this.#repository = dependencies.repository;
    this.#builder = dependencies.builder ?? new CapabilitySummaryBuilder();
    this.#indexBuilder = dependencies.indexBuilder ?? new CapabilityIndexBuilder();
    this.#generationPolicyVersion = dependencies.generationPolicyVersion;
    this.#clock = dependencies.clock;
    this.#nextSummaryId = dependencies.nextSummaryId;
  }

  async getSummary(budget?: CapabilityIndexBudget): Promise<CapabilitySummaryView | undefined> {
    const skills = await this.#catalog.listEnabledSkillVersions();
    const catalogHash = this.#builder.catalogHash(skills);
    if (this.#matchesCurrentCatalog(this.#cache, catalogHash)) {
      return this.#view(this.#cache, budget);
    }
    const active = await this.#repository.findActive();
    if (!this.#matchesCurrentCatalog(active, catalogHash)) {
      this.#cache = undefined;
      return undefined;
    }
    this.#cache = active;
    return this.#view(active, budget);
  }

  async rebuild(budget?: CapabilityIndexBudget): Promise<CapabilitySummaryView> {
    const skills = await this.#catalog.listEnabledSkillVersions();
    const active = await this.#repository.findActive();
    const candidate = this.#builder.build({
      summaryId: this.#nextSummaryId(),
      revision: (active?.revision ?? 0) + 1,
      generationPolicyVersion: this.#generationPolicyVersion,
      skillVersions: skills,
      builtAt: this.#clock.now(),
    });
    const saved = await this.#repository.saveAndActivate(candidate, active?.revision);
    this.#cache = saved;
    return this.#view(saved, budget);
  }

  async getDetail(
    capabilityId: string,
  ): Promise<RuntimeCapabilitySummarySnapshot['items'][number] | undefined> {
    const view = await this.getSummary();
    return view === undefined
      ? undefined
      : this.#indexBuilder.findDetail(view.summary, capabilityId);
  }

  invalidateCache(): void {
    this.#cache = undefined;
  }

  #matchesCurrentCatalog(
    snapshot: RuntimeCapabilitySummarySnapshot | undefined,
    catalogHash: string,
  ): snapshot is RuntimeCapabilitySummarySnapshot {
    return (
      snapshot?.status === 'active' &&
      snapshot.catalogHash === catalogHash &&
      snapshot.generationPolicyVersion === this.#generationPolicyVersion
    );
  }

  #view(
    summary: RuntimeCapabilitySummarySnapshot,
    budget?: CapabilityIndexBudget,
  ): CapabilitySummaryView {
    return {
      summary,
      index:
        budget === undefined
          ? this.#indexBuilder.build(summary)
          : this.#indexBuilder.build(summary, budget),
    };
  }
}

export class CapabilityCatalogChangeProjector {
  readonly #changes: CapabilityCatalogChangeSource;
  readonly #summaries: Pick<CapabilitySummaryService, 'invalidateCache' | 'rebuild'>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #afterRebuild: ((view: CapabilitySummaryView) => Promise<void>) | undefined;

  constructor(
    dependencies: Readonly<{
      changes: CapabilityCatalogChangeSource;
      summaries: Pick<CapabilitySummaryService, 'invalidateCache' | 'rebuild'>;
      clock: Readonly<{ now(): string }>;
      afterRebuild?(view: CapabilitySummaryView): Promise<void>;
    }>,
  ) {
    this.#changes = dependencies.changes;
    this.#summaries = dependencies.summaries;
    this.#clock = dependencies.clock;
    this.#afterRebuild = dependencies.afterRebuild;
  }

  async drain(limit = 100): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('CAPABILITY_CATALOG_CHANGE_LIMIT_INVALID');
    }
    const eventIds = await this.#changes.listPendingCatalogChangeEventIds(limit);
    if (eventIds.length === 0) return 0;
    this.#summaries.invalidateCache();
    const view = await this.#summaries.rebuild();
    await this.#afterRebuild?.(view);
    await this.#changes.markCatalogChangeEventsPublished(eventIds, this.#clock.now());
    return eventIds.length;
  }
}
