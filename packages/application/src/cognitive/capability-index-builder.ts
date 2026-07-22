import {
  COGNITIVE_SCHEMA_VERSION,
  createCapabilityIndexSnapshot,
  type CapabilityIndexEntry,
  type CapabilityIndexSnapshot,
  type RuntimeCapabilitySummarySnapshot,
} from '../../../domain/src/index.js';

export interface CapabilityIndexBudget {
  readonly maxEntries: number;
  readonly maxCharacters: number;
}

export const DEFAULT_CAPABILITY_INDEX_BUDGET: CapabilityIndexBudget = Object.freeze({
  maxEntries: 32,
  maxCharacters: 12_000,
});

export class CapabilityIndexBuilder {
  build(
    summary: RuntimeCapabilitySummarySnapshot,
    budget: CapabilityIndexBudget = DEFAULT_CAPABILITY_INDEX_BUDGET,
  ): CapabilityIndexSnapshot {
    assertBudget(budget);
    const candidates = summary.items.map((item): CapabilityIndexEntry => ({
      capabilityId: item.capabilityId,
      domain: item.domain,
      shortDescription: item.shortDescription,
      effectSummary: item.effects,
      evidenceSummary: item.evidence,
      limitationSummary: item.limitations.map((limitation) => limitation.reasonCode),
      detailRef: `capability://${summary.summaryId}/${item.capabilityId}`,
      public: item.public,
    }));
    const entries: CapabilityIndexEntry[] = [];
    for (const candidate of candidates) {
      if (entries.length >= budget.maxEntries) break;
      const next = [...entries, candidate];
      if (JSON.stringify(next).length > budget.maxCharacters) break;
      entries.push(candidate);
    }
    return createCapabilityIndexSnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      summaryId: summary.summaryId,
      catalogHash: summary.catalogHash,
      entries,
      characterCount: JSON.stringify(entries).length,
      truncated: entries.length < candidates.length,
    });
  }

  findDetail(
    summary: RuntimeCapabilitySummarySnapshot,
    capabilityId: string,
  ): RuntimeCapabilitySummarySnapshot['items'][number] | undefined {
    return summary.items.find((item) => item.capabilityId === capabilityId);
  }
}

function assertBudget(budget: CapabilityIndexBudget): void {
  if (
    !Number.isSafeInteger(budget.maxEntries) ||
    budget.maxEntries < 1 ||
    budget.maxEntries > 256 ||
    !Number.isSafeInteger(budget.maxCharacters) ||
    budget.maxCharacters < 256 ||
    budget.maxCharacters > 65_536
  ) {
    throw new Error('CAPABILITY_INDEX_BUDGET_INVALID');
  }
}
