import type { FusedKnowledgeHit, KnowledgeSearchHit } from './knowledge-retrieval-ports.js';

export class ReciprocalRankFusion {
  readonly #rankConstant: number;
  readonly #minimumConfidence: number;

  constructor(rankConstant = 60, minimumConfidence = 0.2) {
    if (!Number.isSafeInteger(rankConstant) || rankConstant < 1) {
      throw new Error('KNOWLEDGE_RRF_CONSTANT_INVALID');
    }
    if (!Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1) {
      throw new Error('KNOWLEDGE_RRF_CONFIDENCE_INVALID');
    }
    this.#rankConstant = rankConstant;
    this.#minimumConfidence = minimumConfidence;
  }

  merge(
    input: Readonly<{
      vector: readonly KnowledgeSearchHit[];
      text: readonly KnowledgeSearchHit[];
    }>,
  ): readonly FusedKnowledgeHit[] {
    const fused = new Map<
      string,
      {
        entry: KnowledgeSearchHit['entry'];
        score: number;
        textConfidence?: number;
        vectorConfidence?: number;
      }
    >();
    this.#accumulate(fused, 'vector', input.vector);
    this.#accumulate(fused, 'text', input.text);
    return Object.freeze(
      [...fused.values()]
        .map((item) =>
          Object.freeze({
            entry: item.entry,
            rrfScore: item.score,
            sources: Object.freeze(
              [
                ...(item.textConfidence === undefined ? [] : (['text'] as const)),
                ...(item.vectorConfidence === undefined ? [] : (['vector'] as const)),
              ].flat(),
            ),
            ...(item.textConfidence === undefined ? {} : { textConfidence: item.textConfidence }),
            ...(item.vectorConfidence === undefined
              ? {}
              : { vectorConfidence: item.vectorConfidence }),
          }),
        )
        .sort(
          (left, right) =>
            right.rrfScore - left.rrfScore ||
            left.entry.authoritativeRef.localeCompare(right.entry.authoritativeRef),
        ),
    );
  }

  #accumulate(
    fused: Map<
      string,
      {
        entry: KnowledgeSearchHit['entry'];
        score: number;
        textConfidence?: number;
        vectorConfidence?: number;
      }
    >,
    channel: 'text' | 'vector',
    hits: readonly KnowledgeSearchHit[],
  ): void {
    hits.forEach((hit, index) => {
      if (hit.confidence < this.#minimumConfidence) return;
      const current = fused.get(hit.entry.authoritativeRef) ?? {
        entry: hit.entry,
        score: 0,
      };
      current.score += 1 / (this.#rankConstant + index + 1);
      if (channel === 'text') current.textConfidence = hit.confidence;
      else current.vectorConfidence = hit.confidence;
      fused.set(hit.entry.authoritativeRef, current);
    });
  }
}
