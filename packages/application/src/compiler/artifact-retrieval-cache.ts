import type { RuntimeExecutionDecision } from '../../../domain/src/index.js';

/**
 * A rebuildable observation cache. Retrieval always begins with P02 PostgreSQL
 * active-pointer data, so this cache can never authorize a candidate.
 */
export interface ArtifactRetrievalCache {
  put(key: string, decision: RuntimeExecutionDecision): Promise<void>;
  invalidate(input: Readonly<{ artifactRef?: string; tenantId?: string }>): Promise<void>;
  clear(): Promise<void>;
}

export interface ArtifactRetrievalCacheKeyInput {
  readonly artifactRef: string;
  readonly activePointerVersion: number;
  readonly tenantId?: string;
  readonly catalogHash: string;
  readonly policyHash: string;
  readonly schemaVersion: string;
}

export function artifactRetrievalCacheKey(input: ArtifactRetrievalCacheKeyInput): string {
  return JSON.stringify([
    'p07-artifact-retrieval',
    input.artifactRef,
    input.activePointerVersion,
    input.tenantId ?? '*',
    input.catalogHash,
    input.policyHash,
    input.schemaVersion,
  ]);
}

export class InMemoryArtifactRetrievalCache implements ArtifactRetrievalCache {
  readonly #entries = new Map<string, RuntimeExecutionDecision>();

  put(key: string, decision: RuntimeExecutionDecision): Promise<void> {
    this.#entries.set(key, decision);
    return Promise.resolve();
  }

  invalidate(input: Readonly<{ artifactRef?: string; tenantId?: string }>): Promise<void> {
    for (const [key, decision] of this.#entries) {
      if (
        (input.artifactRef === undefined || decision.selectedArtifactRef === input.artifactRef) &&
        (input.tenantId === undefined || key.includes(JSON.stringify(input.tenantId)))
      ) {
        this.#entries.delete(key);
      }
    }
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.#entries.clear();
    return Promise.resolve();
  }
}
