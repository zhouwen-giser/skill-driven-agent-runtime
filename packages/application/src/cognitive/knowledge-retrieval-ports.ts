import type {
  ActiveKnowledgeDefinition,
  ExactSkillKnowledgeDetail,
  ExperienceUsageRecord,
  KnowledgeRelation,
  KnowledgeUsageScope,
} from '../../../domain/src/index.js';

export interface KnowledgeSearchFilters {
  readonly scope: KnowledgeUsageScope;
  readonly catalogHash: string;
  readonly promotionPolicyVersion: string;
  readonly applicabilityTerms: readonly string[];
  readonly minConfidence: number;
  readonly limit: number;
}

export interface KnowledgeSearchHit {
  readonly entry: ActiveKnowledgeDefinition;
  readonly confidence: number;
}

export interface FusedKnowledgeHit {
  readonly entry: ActiveKnowledgeDefinition;
  readonly rrfScore: number;
  readonly sources: readonly ('text' | 'vector')[];
  readonly textConfidence?: number;
  readonly vectorConfidence?: number;
}

export interface KnowledgeSearchRepository {
  vectorSearch(
    input: Readonly<{
      providerId: string;
      vector: readonly number[];
      filters: KnowledgeSearchFilters;
    }>,
  ): Promise<readonly KnowledgeSearchHit[]>;
  textSearch(
    query: string,
    filters: KnowledgeSearchFilters,
  ): Promise<readonly KnowledgeSearchHit[]>;
  loadDefinitions(
    authoritativeRefs: readonly string[],
    filters: KnowledgeSearchFilters,
  ): Promise<readonly ActiveKnowledgeDefinition[]>;
  listRelations(
    authoritativeRefs: readonly string[],
    limit: number,
  ): Promise<readonly KnowledgeRelation[]>;
  listUsedAuthoritativeRefs(planningSessionId: string): Promise<readonly string[]>;
  recordUsage(records: readonly ExperienceUsageRecord[]): Promise<readonly string[]>;
}

export interface ExactSkillKnowledgeSource {
  loadCurrentExact(
    exactSkillVersionRefs: readonly string[],
  ): Promise<readonly ExactSkillKnowledgeDetail[]>;
}
