import {
  createExperienceUsageRecord,
  createPlanningKnowledgeBundle,
  type CognitiveInjectionMode,
  type ExperienceUsageRecord,
  type KnowledgeRelation,
  type KnowledgeUsageScope,
  type PlanningKnowledgeBundle,
} from '../../../domain/src/index.js';
import type { TextEmbeddingProvider } from '../ports.js';
import type { KnowledgeApplicabilityEvaluator } from './knowledge-applicability-evaluator.js';
import type {
  ExactSkillKnowledgeSource,
  FusedKnowledgeHit,
  KnowledgeSearchFilters,
  KnowledgeSearchRepository,
} from './knowledge-retrieval-ports.js';
import type { KnowledgeQueryFingerprintBuilder } from './knowledge-query-fingerprint.js';
import type { KnowledgeRelationExpander } from './knowledge-relation-expander.js';
import type { PlanningContextBudget } from './planning-context-budget.js';
import type { ReciprocalRankFusion } from './rrf-ranker.js';

export class PlanningKnowledgeRetriever {
  readonly #repository: KnowledgeSearchRepository;
  readonly #embeddings: TextEmbeddingProvider;
  readonly #skills: ExactSkillKnowledgeSource;
  readonly #fingerprints: KnowledgeQueryFingerprintBuilder;
  readonly #ranker: ReciprocalRankFusion;
  readonly #relations: KnowledgeRelationExpander;
  readonly #applicability: KnowledgeApplicabilityEvaluator;
  readonly #budget: PlanningContextBudget;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #monotonicNow: () => number;
  readonly #nextUsageId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: KnowledgeSearchRepository;
      embeddings: TextEmbeddingProvider;
      skills: ExactSkillKnowledgeSource;
      fingerprints: KnowledgeQueryFingerprintBuilder;
      ranker: ReciprocalRankFusion;
      relations: KnowledgeRelationExpander;
      applicability: KnowledgeApplicabilityEvaluator;
      budget: PlanningContextBudget;
      clock: Readonly<{ now(): string }>;
      monotonicNow?: () => number;
      nextUsageId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#embeddings = dependencies.embeddings;
    this.#skills = dependencies.skills;
    this.#fingerprints = dependencies.fingerprints;
    this.#ranker = dependencies.ranker;
    this.#relations = dependencies.relations;
    this.#applicability = dependencies.applicability;
    this.#budget = dependencies.budget;
    this.#clock = dependencies.clock;
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
    this.#nextUsageId = dependencies.nextUsageId;
  }

  async retrieve(
    input: Readonly<{
      query: string;
      applicabilityTerms: readonly string[];
      scope: KnowledgeUsageScope;
      catalogHash: string;
      promotionPolicyVersion: string;
      planningSessionId: string;
      planCandidateId: string;
      injectionMode: CognitiveInjectionMode;
      limit?: number;
    }>,
  ): Promise<PlanningKnowledgeBundle> {
    const started = this.#monotonicNow();
    const query = input.query.trim();
    if (query.length === 0) throw new Error('KNOWLEDGE_RETRIEVAL_QUERY_REQUIRED');
    const queryFingerprint = this.#fingerprints.build({
      query,
      applicabilityTerms: input.applicabilityTerms,
      scope: input.scope,
      catalogHash: input.catalogHash,
      promotionPolicyVersion: input.promotionPolicyVersion,
    });
    if (input.injectionMode === 'off') {
      return emptyBundle(queryFingerprint, this.#monotonicNow() - started);
    }
    const filters: KnowledgeSearchFilters = Object.freeze({
      scope: input.scope,
      catalogHash: input.catalogHash,
      promotionPolicyVersion: input.promotionPolicyVersion,
      applicabilityTerms: Object.freeze([...input.applicabilityTerms]),
      minConfidence: 0.2,
      limit: input.limit ?? 32,
    });
    const [used, vector, text] = await Promise.all([
      this.#repository.listUsedAuthoritativeRefs(input.planningSessionId),
      this.#embeddings
        .embed(query)
        .then((embedding) => this.#repository.vectorSearch({ ...embedding, filters })),
      this.#repository.textSearch(query, filters),
    ]);
    const usedRefs = new Set(used);
    const ranked = this.#ranker.merge({ vector, text }).filter(
      (item) =>
        !usedRefs.has(item.entry.authoritativeRef) &&
        this.#applicability.applies(item.entry, {
          query,
          applicabilityTerms: input.applicabilityTerms,
        }),
    );
    const seedRefs = ranked.map((item) => item.entry.authoritativeRef);
    const relations = await this.#repository.listRelations(seedRefs, 16);
    const targetRefs = relationTargets(relations);
    const relatedDefinitions = await this.#repository.loadDefinitions(targetRefs, filters);
    const related: FusedKnowledgeHit[] = relatedDefinitions
      .filter(
        (definition) =>
          !usedRefs.has(definition.authoritativeRef) &&
          this.#applicability.applies(definition, {
            query,
            applicabilityTerms: input.applicabilityTerms,
          }),
      )
      .map((entry) => ({
        entry,
        rrfScore: 0,
        sources: Object.freeze([]),
      }));
    const expanded = this.#relations.expand({ seeds: ranked, relations, related });
    const exactRefs = [
      ...new Set(expanded.included.flatMap((item) => item.entry.exactSkillVersionRefs)),
    ];
    const exactSkills = await this.#skills.loadCurrentExact(exactRefs);
    const provisional = this.#budget.apply({
      queryFingerprint,
      ranked: expanded.included,
      exactSkills,
      conflicts: expanded.conflicts,
      elapsedMs: this.#monotonicNow() - started,
    });
    const records = provisional.definitions.map((definition, index) =>
      this.#usageRecord({
        definition,
        rank: index + 1,
        queryFingerprint,
        planningSessionId: input.planningSessionId,
        planCandidateId: input.planCandidateId,
        injectionMode: input.injectionMode,
        ranked: expanded.included,
      }),
    );
    const reservedRefs = new Set(await this.#repository.recordUsage(records));
    const reserved = expanded.included.filter((item) =>
      reservedRefs.has(item.entry.authoritativeRef),
    );
    return this.#budget.apply({
      queryFingerprint,
      ranked: reserved,
      exactSkills,
      conflicts: relevantConflicts(expanded.conflicts, reservedRefs),
      elapsedMs: this.#monotonicNow() - started,
    });
  }

  #usageRecord(
    input: Readonly<{
      definition: PlanningKnowledgeBundle['definitions'][number];
      rank: number;
      queryFingerprint: string;
      planningSessionId: string;
      planCandidateId: string;
      injectionMode: CognitiveInjectionMode;
      ranked: readonly FusedKnowledgeHit[];
    }>,
  ): ExperienceUsageRecord {
    const hit = input.ranked.find(
      (item) => item.entry.authoritativeRef === input.definition.authoritativeRef,
    );
    return createExperienceUsageRecord({
      schemaVersion: '1.0',
      usageId: this.#nextUsageId(),
      planningSessionId: input.planningSessionId,
      planCandidateId: input.planCandidateId,
      knowledgeKind: input.definition.kind,
      knowledgeId: input.definition.knowledgeId,
      knowledgeRevision: input.definition.revision,
      authoritativeRef: input.definition.authoritativeRef,
      queryFingerprint: input.queryFingerprint,
      retrievalRank: input.rank,
      injectionMode: input.injectionMode,
      influence: {
        rrfScore: hit?.rrfScore ?? 0,
        sources: hit?.sources ?? [],
        ...(hit?.textConfidence === undefined ? {} : { textConfidence: hit.textConfidence }),
        ...(hit?.vectorConfidence === undefined ? {} : { vectorConfidence: hit.vectorConfidence }),
      },
      createdAt: this.#clock.now(),
    });
  }
}

function relationTargets(relations: readonly KnowledgeRelation[]): readonly string[] {
  return [
    ...new Set(
      relations.map(
        (relation) =>
          `${relation.targetKind}:${relation.targetKnowledgeId}:${String(relation.targetRevision)}`,
      ),
    ),
  ];
}

function relevantConflicts(
  conflicts: readonly KnowledgeRelation[],
  authoritativeRefs: ReadonlySet<string>,
): readonly KnowledgeRelation[] {
  return conflicts.filter((relation) =>
    authoritativeRefs.has(
      `${relation.sourceKind}:${relation.sourceKnowledgeId}:${String(relation.sourceRevision)}`,
    ),
  );
}

function emptyBundle(queryFingerprint: string, elapsedMs: number): PlanningKnowledgeBundle {
  const context = { index: [], definitions: [], exactSkills: [], conflicts: [] };
  return createPlanningKnowledgeBundle({
    schemaVersion: '1.0',
    queryFingerprint,
    index: [],
    definitions: [],
    exactSkills: [],
    conflicts: [],
    disclosureOrder: [],
    characterCount: JSON.stringify(context).length,
    truncated: false,
    elapsedMs,
  });
}
