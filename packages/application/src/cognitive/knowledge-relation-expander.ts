import type { KnowledgeRelation } from '../../../domain/src/index.js';
import type { FusedKnowledgeHit } from './knowledge-retrieval-ports.js';

export class KnowledgeRelationExpander {
  readonly #maxRelations: number;

  constructor(options: Readonly<{ maxRelations?: number }> = {}) {
    this.#maxRelations = options.maxRelations ?? 16;
    if (!Number.isSafeInteger(this.#maxRelations) || this.#maxRelations < 0) {
      throw new Error('KNOWLEDGE_RELATION_LIMIT_INVALID');
    }
  }

  expand(
    input: Readonly<{
      seeds: readonly FusedKnowledgeHit[];
      relations: readonly KnowledgeRelation[];
      related: readonly FusedKnowledgeHit[];
    }>,
  ): Readonly<{
    included: readonly FusedKnowledgeHit[];
    conflicts: readonly KnowledgeRelation[];
  }> {
    const seedRefs = new Set(input.seeds.map((item) => item.entry.authoritativeRef));
    const related = new Map(
      input.related.map((item) => [item.entry.authoritativeRef, item] as const),
    );
    const included = new Map(
      input.seeds.map((item) => [item.entry.authoritativeRef, item] as const),
    );
    const conflicts: KnowledgeRelation[] = [];
    let examined = 0;
    for (const relation of input.relations) {
      if (examined >= this.#maxRelations) break;
      const sourceRef = ref(
        relation.sourceKind,
        relation.sourceKnowledgeId,
        relation.sourceRevision,
      );
      if (!seedRefs.has(sourceRef)) continue;
      examined += 1;
      const targetRef = ref(
        relation.targetKind,
        relation.targetKnowledgeId,
        relation.targetRevision,
      );
      if (relation.relationType === 'contradicts' || relation.relationType === 'supersedes') {
        if (!related.has(targetRef)) continue;
        conflicts.push(relation);
        included.delete(targetRef);
        continue;
      }
      const target = related.get(targetRef);
      if (target !== undefined && !included.has(targetRef)) {
        included.set(
          targetRef,
          Object.freeze({ ...target, sources: Object.freeze(target.sources) }),
        );
      }
    }
    return Object.freeze({
      included: Object.freeze([...included.values()]),
      conflicts: Object.freeze(conflicts),
    });
  }
}

function ref(kind: string, knowledgeId: string, revision: number): string {
  return `${kind}:${knowledgeId}:${String(revision)}`;
}
