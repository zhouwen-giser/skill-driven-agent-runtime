import { createKnowledgeDelta, type KnowledgeDelta } from '../../../domain/src/index.js';

export class KnowledgeDeltaValidator {
  validate(input: KnowledgeDelta): KnowledgeDelta {
    const delta = createKnowledgeDelta(input);
    const evidenceCount = delta.supportEvidence.length + delta.contradictionEvidence.length;
    if (delta.operation === 'NO_CHANGE') return delta;
    if (evidenceCount === 0) throw new Error('KNOWLEDGE_DELTA_SOURCE_EVIDENCE_REQUIRED');
    if (
      [...delta.supportEvidence, ...delta.contradictionEvidence].some(
        (item) => item.sourceRefIds.length === 0 || item.sourceEpisodeIds.length === 0,
      )
    ) {
      throw new Error('KNOWLEDGE_DELTA_SOURCE_LINEAGE_REQUIRED');
    }
    if (delta.operation === 'CREATE_REVISION') {
      if (delta.candidate?.status !== 'candidate') {
        throw new Error('KNOWLEDGE_DELTA_CANDIDATE_REVISION_REQUIRED');
      }
      return delta;
    }
    if (delta.operation === 'ADD_EVIDENCE') {
      if (delta.targetKnowledgeId === undefined || delta.supportEvidence.length === 0) {
        throw new Error('KNOWLEDGE_DELTA_SUPPORT_TARGET_REQUIRED');
      }
      if (delta.candidate === undefined) throw new Error('KNOWLEDGE_DELTA_REVISION_REQUIRED');
      return delta;
    }
    if (delta.operation === 'ADD_CONTRADICTION') {
      if (delta.targetKnowledgeId === undefined || delta.contradictionEvidence.length === 0) {
        throw new Error('KNOWLEDGE_DELTA_CONTRADICTION_TARGET_REQUIRED');
      }
      if (delta.candidate === undefined) throw new Error('KNOWLEDGE_DELTA_REVISION_REQUIRED');
      return delta;
    }
    if (
      ['SUGGEST_MERGE', 'SUGGEST_SUPERSEDE'].includes(delta.operation) &&
      (delta.targetKnowledgeId === undefined || delta.relatedKnowledgeIds.length === 0)
    ) {
      throw new Error('KNOWLEDGE_DELTA_RELATION_TARGET_REQUIRED');
    }
    if (delta.candidate !== undefined) {
      throw new Error('KNOWLEDGE_DELTA_SUGGESTION_CANNOT_MUTATE');
    }
    return delta;
  }
}
