import type {
  ActiveKnowledgeProjection,
  KnowledgeKind,
  MemoryItem,
} from '../../../domain/src/index.js';
import { MemoryApplicationError, type MemoryService } from '../memory-service.js';
import type {
  ActiveKnowledgeProjectionInventory,
  ActiveKnowledgeProjectionRepository,
} from './promotion-ports.js';

export class MemoryActiveKnowledgeProjectionRepository implements ActiveKnowledgeProjectionRepository {
  readonly #memories: Pick<MemoryService, 'create' | 'get' | 'invalidate'>;
  readonly #inventory: ActiveKnowledgeProjectionInventory | undefined;

  constructor(
    memories: Pick<MemoryService, 'create' | 'get' | 'invalidate'>,
    inventory?: ActiveKnowledgeProjectionInventory,
  ) {
    this.#memories = memories;
    this.#inventory = inventory;
  }

  async upsert(projection: ActiveKnowledgeProjection): Promise<void> {
    const existing = await this.#find(projection.projectionId);
    if (existing?.status === 'active') return;
    if (existing !== undefined) {
      throw new Error('KNOWLEDGE_MEMORY_PROJECTION_STATUS_CONFLICT');
    }
    await this.#memories.create({
      memoryId: projection.projectionId,
      type: memoryType(projection.knowledgeKind),
      content: {
        projectionType: 'active_knowledge',
        authoritativeRef: projection.authoritativeRef,
        knowledgeKind: projection.knowledgeKind,
        knowledgeId: projection.knowledgeId,
        knowledgeRevision: projection.knowledgeRevision,
        risk: projection.risk,
      },
      summary: projection.summary,
      sourceRefs: [projection.authoritativeRef],
      supersedes: [],
      confidence: 1,
      durability: 'durable',
      authority: 'admin',
      durabilityReason:
        'Rebuildable search projection of an explicitly promoted PostgreSQL Knowledge revision.',
    });
  }

  async remove(
    knowledgeKind: KnowledgeKind,
    knowledgeId: string,
    knowledgeRevision: number,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const memoryId = projectionId(knowledgeKind, knowledgeId, knowledgeRevision);
    const existing = await this.#find(memoryId);
    if (existing === undefined || existing.status === 'invalid') return;
    await this.#memories.invalidate(memoryId, actorId, reason);
  }

  async prune(
    activeProjectionIds: ReadonlySet<string>,
    actorId: string,
    reason: string,
  ): Promise<number> {
    if (this.#inventory === undefined) return 0;
    let count = 0;
    for (const memoryId of await this.#inventory.listActiveProjectionIds()) {
      if (activeProjectionIds.has(memoryId)) continue;
      await this.#memories.invalidate(memoryId, actorId, reason);
      count += 1;
    }
    return count;
  }

  async #find(memoryId: string): Promise<MemoryItem | undefined> {
    try {
      return await this.#memories.get(memoryId);
    } catch (error: unknown) {
      if (error instanceof MemoryApplicationError && error.code === 'MEMORY_NOT_FOUND') {
        return undefined;
      }
      throw error;
    }
  }
}

function memoryType(kind: KnowledgeKind): MemoryItem['type'] {
  return kind === 'planning_heuristic' ? 'workflow_pattern' : 'skill_learning';
}

function projectionId(kind: KnowledgeKind, knowledgeId: string, revision: number): string {
  return `knowledge-projection-${kind}-${knowledgeId}-${String(revision)}`;
}
