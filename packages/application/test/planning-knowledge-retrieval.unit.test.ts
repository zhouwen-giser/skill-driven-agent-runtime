import { describe, expect, it } from 'vitest';

import {
  KnowledgeQueryFingerprintBuilder,
  KnowledgeRelationExpander,
  KnowledgeApplicabilityEvaluator,
  PlanningKnowledgeRetriever,
  PlanningContextBudget,
  ReciprocalRankFusion,
  type ExactSkillKnowledgeSource,
  type FusedKnowledgeHit,
  type KnowledgeSearchFilters,
  type KnowledgeSearchHit,
  type KnowledgeSearchRepository,
} from '../src/index.js';
import type {
  ActiveKnowledgeDefinition,
  ExperienceUsageRecord,
  KnowledgeRelation,
  KnowledgeUsageScope,
} from '../../domain/src/index.js';

const timestamp = '2026-07-26T08:30:00.000Z';

describe('G13 planning knowledge retrieval', () => {
  it('builds one stable Query Fingerprint from normalized query, scope and authority versions', () => {
    const builder = new KnowledgeQueryFingerprintBuilder();
    const scope: KnowledgeUsageScope = {
      taskId: 'task.query',
      tenantId: 'tenant.query',
      userId: 'user.query',
    };
    expect(
      builder.build({
        query: '  Inspect   Pump A ',
        applicabilityTerms: ['Pressure', 'inspection'],
        scope,
        catalogHash: `sha256:${'1'.repeat(64)}`,
        promotionPolicyVersion: 'knowledge-promotion-v1',
      }),
    ).toBe(
      builder.build({
        query: 'inspect pump a',
        applicabilityTerms: ['inspection', 'pressure'],
        scope,
        catalogHash: `sha256:${'1'.repeat(64)}`,
        promotionPolicyVersion: 'knowledge-promotion-v1',
      }),
    );
  });

  it('fuses vector and text recall with deterministic reciprocal rank fusion', () => {
    const merged = new ReciprocalRankFusion(60).merge({
      vector: [hit('knowledge.a', 0.9), hit('knowledge.b', 0.8)],
      text: [hit('knowledge.b', 0.95), hit('knowledge.c', 0.7)],
    });
    expect(merged.map((item) => item.entry.knowledgeId)).toEqual([
      'knowledge.b',
      'knowledge.a',
      'knowledge.c',
    ]);
    expect(merged[0]).toMatchObject({
      sources: ['text', 'vector'],
      vectorConfidence: 0.8,
      textConfidence: 0.95,
    });
  });

  it('expands at most one bounded relation hop and keeps conflicts separate', () => {
    const seed = fused('knowledge.a');
    const related = [
      fused('knowledge.b'),
      fused('knowledge.c'),
      fused('knowledge.d'),
      fused('knowledge.e'),
      fused('knowledge.f'),
    ];
    const relations: KnowledgeRelation[] = [
      relation('knowledge.a', 'knowledge.b', 'requires'),
      relation('knowledge.a', 'knowledge.c', 'contradicts'),
      relation('knowledge.a', 'knowledge.d', 'related'),
      relation('knowledge.a', 'knowledge.e', 'supersedes'),
      relation('knowledge.a', 'knowledge.f', 'supported_by'),
      relation('knowledge.f', 'knowledge.a', 'related'),
    ];
    const expanded = new KnowledgeRelationExpander({ maxRelations: 5 }).expand({
      seeds: [seed],
      relations,
      related,
    });
    expect(expanded.included.map((item) => item.entry.knowledgeId)).toEqual([
      'knowledge.a',
      'knowledge.b',
      'knowledge.d',
      'knowledge.f',
    ]);
    expect(expanded.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetKnowledgeId: 'knowledge.c', relationType: 'contradicts' }),
        expect.objectContaining({ targetKnowledgeId: 'knowledge.e', relationType: 'supersedes' }),
      ]),
    );
  });

  it('applies kind limits and a hard 20K character budget with index-before-detail ordering', () => {
    const ranked = [
      ...Array.from({ length: 5 }, (_, index) => fused(`task-type.${String(index)}`, 'task_type')),
      ...Array.from({ length: 10 }, (_, index) =>
        fused(`capability.${String(index)}`, 'capability_pattern'),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        fused(`heuristic.${String(index)}`, 'planning_heuristic'),
      ),
    ];
    const budgeted = new PlanningContextBudget().apply({
      queryFingerprint: `sha256:${'2'.repeat(64)}`,
      ranked,
      exactSkills: [
        {
          skillId: 'skill.inspect',
          version: 2,
          name: 'Inspect',
          summary: 'Inspect safely.',
          status: 'enabled',
          declaration: { workflowGuidance: 'Inspect before changing state.' },
        },
      ],
      conflicts: [],
      elapsedMs: 10,
    });
    expect(budgeted.definitions.filter((item) => item.kind === 'task_type')).toHaveLength(3);
    expect(budgeted.definitions.filter((item) => item.kind === 'capability_pattern')).toHaveLength(
      8,
    );
    expect(budgeted.definitions.filter((item) => item.kind === 'planning_heuristic')).toHaveLength(
      8,
    );
    expect(budgeted.characterCount).toBeLessThanOrEqual(20_000);
    expect(budgeted.disclosureOrder.slice(0, budgeted.index.length)).toEqual(
      budgeted.index.map((item) => item.authoritativeRef),
    );
    expect(budgeted.index[0]).not.toHaveProperty('definition');
    expect(budgeted.exactSkills[0]).toMatchObject({
      skillId: 'skill.inspect',
      declaration: { workflowGuidance: 'Inspect before changing state.' },
    });
  });

  it('drops low-confidence and exact-Skill-version-mismatched knowledge before budgeting', () => {
    const ranker = new ReciprocalRankFusion();
    const merged = ranker.merge({
      vector: [hit('knowledge.low', 0.1), hit('knowledge.current', 0.9)],
      text: [],
    });
    expect(merged.map((item) => item.entry.knowledgeId)).toEqual(['knowledge.current']);
    expect(
      new PlanningContextBudget().apply({
        queryFingerprint: `sha256:${'3'.repeat(64)}`,
        ranked: [
          fused('knowledge.current', 'capability_pattern', ['skill.inspect:2']),
          fused('knowledge.stale', 'capability_pattern', ['skill.inspect:1']),
        ],
        exactSkills: [
          {
            skillId: 'skill.inspect',
            version: 2,
            name: 'Inspect',
            summary: 'Inspect safely.',
            status: 'enabled',
            declaration: { workflowGuidance: 'Inspect before changing state.' },
          },
        ],
        conflicts: [],
        elapsedMs: 5,
      }).definitions,
    ).toEqual([expect.objectContaining({ knowledgeId: 'knowledge.current' })]);
  });

  it('never emits a capability definition without its complete exact Skill declaration', () => {
    const bundle = new PlanningContextBudget().apply({
      queryFingerprint: `sha256:${'4'.repeat(64)}`,
      ranked: [fused('knowledge.oversized', 'capability_pattern', ['skill.inspect:2'])],
      exactSkills: [
        {
          skillId: 'skill.inspect',
          version: 2,
          name: 'Inspect',
          summary: 'Inspect safely.',
          status: 'enabled',
          declaration: { workflowGuidance: 'x'.repeat(20_000) },
        },
      ],
      conflicts: [],
      elapsedMs: 5,
    });
    expect(bundle.index).toHaveLength(1);
    expect(bundle.definitions).toEqual([]);
    expect(bundle.exactSkills).toEqual([]);
    expect(bundle.truncated).toBe(true);
  });

  it('records Session-level usage once and never reinjects the same authoritative revision', async () => {
    const repository = new InMemoryKnowledgeSearchRepository([
      definition('knowledge.session', 'planning_heuristic'),
    ]);
    const skills: ExactSkillKnowledgeSource = {
      loadCurrentExact: () => Promise.resolve([]),
    };
    let monotonic = 0;
    const service = new PlanningKnowledgeRetriever({
      repository,
      embeddings: {
        embed: () => Promise.resolve({ providerId: 'embedding.test', vector: [1, 0] }),
      },
      skills,
      fingerprints: new KnowledgeQueryFingerprintBuilder(),
      ranker: new ReciprocalRankFusion(),
      relations: new KnowledgeRelationExpander(),
      applicability: new KnowledgeApplicabilityEvaluator(),
      budget: new PlanningContextBudget(),
      clock: { now: () => timestamp },
      monotonicNow: () => (monotonic += 1),
      nextUsageId: () => `usage.${String(monotonic)}`,
    });
    const input = {
      query: 'inspect pump pressure',
      applicabilityTerms: ['inspection', 'pressure'],
      scope: { taskId: 'task.session', tenantId: 'tenant.a', userId: 'user.a' },
      catalogHash: `sha256:${'1'.repeat(64)}`,
      promotionPolicyVersion: 'knowledge-promotion-v1',
      planningSessionId: 'planning.session',
      planCandidateId: 'plan.candidate.1',
      injectionMode: 'advisory' as const,
    };

    await expect(service.retrieve(input)).resolves.toMatchObject({
      definitions: [expect.objectContaining({ knowledgeId: 'knowledge.session' })],
    });
    await expect(
      service.retrieve({ ...input, planCandidateId: 'plan.candidate.2' }),
    ).resolves.toMatchObject({ index: [], definitions: [] });
    expect(repository.records).toHaveLength(1);
    expect(repository.lastFilters).toMatchObject({
      scope: input.scope,
      catalogHash: input.catalogHash,
      promotionPolicyVersion: input.promotionPolicyVersion,
    });
  });
});

function hit(
  knowledgeId: string,
  confidence: number,
  kind: ActiveKnowledgeDefinition['kind'] = 'planning_heuristic',
): KnowledgeSearchHit {
  return {
    entry: definition(knowledgeId, kind),
    confidence,
  };
}

function fused(
  knowledgeId: string,
  kind: ActiveKnowledgeDefinition['kind'] = 'planning_heuristic',
  exactSkillVersionRefs: readonly string[] = [],
): FusedKnowledgeHit {
  return {
    entry: definition(
      knowledgeId,
      kind,
      kind === 'capability_pattern' && exactSkillVersionRefs.length === 0
        ? ['skill.inspect:2']
        : exactSkillVersionRefs,
    ),
    rrfScore: 1,
    sources: ['vector'],
    vectorConfidence: 0.9,
  };
}

function definition(
  knowledgeId: string,
  kind: ActiveKnowledgeDefinition['kind'],
  exactSkillVersionRefs: readonly string[] = [],
): ActiveKnowledgeDefinition {
  return {
    schemaVersion: '1.0',
    kind,
    knowledgeId,
    revision: 1,
    version: 3,
    status: 'active',
    scope: 'global_candidate',
    risk: 'low',
    title: `Title ${knowledgeId}`,
    summary: `Summary ${knowledgeId}`,
    definition: { content: `Definition ${knowledgeId}` },
    authoritativeRef: `${kind}:${knowledgeId}:1`,
    exactSkillVersionRefs,
    ...(kind === 'capability_pattern' ? { catalogHash: `sha256:${'1'.repeat(64)}` } : {}),
    promotionPolicyVersion: 'knowledge-promotion-v1',
    createdAt: timestamp,
  };
}

function relation(
  sourceKnowledgeId: string,
  targetKnowledgeId: string,
  relationType: KnowledgeRelation['relationType'],
): KnowledgeRelation {
  return {
    schemaVersion: '1.0',
    relationId: `relation.${sourceKnowledgeId}.${targetKnowledgeId}.${relationType}`,
    sourceKind: 'planning_heuristic',
    sourceKnowledgeId,
    sourceRevision: 1,
    targetKind: 'planning_heuristic',
    targetKnowledgeId,
    targetRevision: 1,
    relationType,
    evidenceRefs: ['episode.relation'],
    createdAt: timestamp,
  };
}

class InMemoryKnowledgeSearchRepository implements KnowledgeSearchRepository {
  readonly records: ExperienceUsageRecord[] = [];
  readonly #definitions: readonly ActiveKnowledgeDefinition[];
  lastFilters: KnowledgeSearchFilters | undefined;

  constructor(definitions: readonly ActiveKnowledgeDefinition[]) {
    this.#definitions = definitions;
  }

  vectorSearch(input: {
    providerId: string;
    vector: readonly number[];
    filters: KnowledgeSearchFilters;
  }) {
    this.lastFilters = input.filters;
    return Promise.resolve(this.#definitions.map((entry) => ({ entry, confidence: 0.9 })));
  }

  textSearch(_query: string, filters: KnowledgeSearchFilters) {
    this.lastFilters = filters;
    return Promise.resolve(this.#definitions.map((entry) => ({ entry, confidence: 0.8 })));
  }

  loadDefinitions() {
    return Promise.resolve([]);
  }

  listRelations() {
    return Promise.resolve([]);
  }

  listUsedAuthoritativeRefs(planningSessionId: string) {
    return Promise.resolve(
      this.records
        .filter((record) => record.planningSessionId === planningSessionId)
        .map((record) => record.authoritativeRef),
    );
  }

  recordUsage(records: readonly ExperienceUsageRecord[]) {
    const inserted: string[] = [];
    for (const record of records) {
      if (
        this.records.some(
          (existing) =>
            existing.planningSessionId === record.planningSessionId &&
            existing.authoritativeRef === record.authoritativeRef,
        )
      ) {
        continue;
      }
      this.records.push(record);
      inserted.push(record.authoritativeRef);
    }
    return Promise.resolve(inserted);
  }
}
