import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  KnowledgeSearchFilters,
  KnowledgeSearchHit,
  KnowledgeSearchRepository,
} from '../../../application/src/cognitive/index.js';
import {
  createActiveKnowledgeDefinition,
  createExperienceUsageRecord,
  createKnowledgeRelation,
  type ActiveKnowledgeDefinition,
  type ExperienceUsageRecord,
  type KnowledgeKind,
  type KnowledgeRelation,
} from '../../../domain/src/index.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const ExactMappingsSchema = z.array(
  z.looseObject({
    exactSkillVersionRef: z.string(),
  }),
);

interface ActiveKnowledgeRow extends QueryResultRow {
  kind: KnowledgeKind;
  knowledge_id: string;
  revision: number;
  version: number;
  scope: ActiveKnowledgeDefinition['scope'];
  tenant_id: string | null;
  user_id: string | null;
  risk: ActiveKnowledgeDefinition['risk'];
  definition: unknown;
  catalog_hash: string | null;
  promotion_policy_version: string;
  created_at: Date | string;
  confidence?: number;
}

interface RelationRow extends QueryResultRow {
  relation_id: string;
  source_kind: KnowledgeKind;
  source_knowledge_id: string;
  source_revision: number;
  target_kind: KnowledgeKind;
  target_knowledge_id: string;
  target_revision: number;
  relation_type: KnowledgeRelation['relationType'];
  evidence_refs: unknown;
  created_at: Date | string;
}

export class PostgresKnowledgeSearchRepository implements KnowledgeSearchRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async vectorSearch(
    input: Readonly<{
      providerId: string;
      vector: readonly number[];
      filters: KnowledgeSearchFilters;
    }>,
  ): Promise<readonly KnowledgeSearchHit[]> {
    const parameters = filterParameters(input.filters);
    const result = await this.#pool.query<ActiveKnowledgeRow>(
      `${activeKnowledgeCte}
       SELECT ranked.*
       FROM (
         SELECT a.*,
           GREATEST(0,LEAST(1,(2-(m.embedding <=> $1::vector))/2))::double precision
             AS confidence
         FROM active_knowledge a
         JOIN memory_item m
           ON m.status='active'
          AND m.durability='durable'
          AND m.content_json->>'projectionType'='active_knowledge'
          AND m.content_json->>'authoritativeRef'=
            concat(a.kind,':',a.knowledge_id,':',a.revision::text)
          AND m.embedding_provider_id=$2
          AND m.embedding_dimensions=$3
         WHERE ${filterClause(4)}
       ) ranked
       WHERE ranked.confidence>=$9
       ORDER BY ranked.confidence DESC,ranked.kind,ranked.knowledge_id,ranked.revision
       LIMIT $10`,
      [
        vectorLiteral(input.vector),
        input.providerId,
        input.vector.length,
        ...parameters,
        input.filters.minConfidence,
        input.filters.limit,
      ],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({ entry: mapDefinition(row), confidence: row.confidence ?? 0 }),
      ),
    );
  }

  async textSearch(
    query: string,
    filters: KnowledgeSearchFilters,
  ): Promise<readonly KnowledgeSearchHit[]> {
    const parameters = filterParameters(filters);
    const result = await this.#pool.query<ActiveKnowledgeRow>(
      `${activeKnowledgeCte}
       SELECT ranked.*
       FROM (
         SELECT a.*,
           LEAST(
             1,
             ts_rank_cd(
               to_tsvector(
                 'simple',
                 COALESCE(a.definition->>'title','') || ' ' ||
                 COALESCE(a.definition->>'summary','') || ' ' ||
                 a.definition::text
               ),
               websearch_to_tsquery('simple',$1)
             ) * 4
           )::double precision AS confidence
         FROM active_knowledge a
         WHERE ${filterClause(2)}
       ) ranked
       WHERE ranked.confidence>=$7
       ORDER BY ranked.confidence DESC,ranked.kind,ranked.knowledge_id,ranked.revision
       LIMIT $8`,
      [query, ...parameters, filters.minConfidence, filters.limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({ entry: mapDefinition(row), confidence: row.confidence ?? 0 }),
      ),
    );
  }

  async loadDefinitions(
    authoritativeRefs: readonly string[],
    filters: KnowledgeSearchFilters,
  ): Promise<readonly ActiveKnowledgeDefinition[]> {
    if (authoritativeRefs.length === 0) return [];
    const result = await this.#pool.query<ActiveKnowledgeRow>(
      `${activeKnowledgeCte}
       SELECT a.* FROM active_knowledge a
       WHERE concat(a.kind,':',a.knowledge_id,':',a.revision::text)=ANY($1::text[])
         AND ${filterClause(2)}
       ORDER BY a.kind,a.knowledge_id,a.revision`,
      [authoritativeRefs, ...filterParameters(filters)],
    );
    return Object.freeze(result.rows.map(mapDefinition));
  }

  async listRelations(
    authoritativeRefs: readonly string[],
    limit: number,
  ): Promise<readonly KnowledgeRelation[]> {
    if (authoritativeRefs.length === 0 || limit === 0) return [];
    const result = await this.#pool.query<RelationRow>(
      `SELECT relation_id,source_kind,source_knowledge_id,source_revision,
         target_kind,target_knowledge_id,target_revision,relation_type,evidence_refs,created_at
       FROM knowledge_relation
       WHERE concat(source_kind,':',source_knowledge_id,':',source_revision::text)
         =ANY($1::text[])
       ORDER BY source_kind,source_knowledge_id,source_revision,relation_type,relation_id
       LIMIT $2`,
      [authoritativeRefs, limit],
    );
    return Object.freeze(result.rows.map(mapRelation));
  }

  async listUsedAuthoritativeRefs(planningSessionId: string): Promise<readonly string[]> {
    const result = await this.#pool.query<{ authoritative_ref: string } & QueryResultRow>(
      `SELECT authoritative_ref FROM experience_usage_record
       WHERE planning_session_id=$1
       ORDER BY retrieval_rank,created_at,usage_id`,
      [planningSessionId],
    );
    return Object.freeze(result.rows.map((row) => row.authoritative_ref));
  }

  async recordUsage(records: readonly ExperienceUsageRecord[]): Promise<readonly string[]> {
    if (records.length === 0) return [];
    const validated = records.map(createExperienceUsageRecord);
    const sessionIds = new Set(validated.map((record) => record.planningSessionId));
    if (sessionIds.size !== 1) throw new Error('KNOWLEDGE_USAGE_SESSION_MISMATCH');
    const planningSessionId = validated[0]?.planningSessionId;
    if (planningSessionId === undefined) return [];
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `planning-knowledge-usage:${planningSessionId}`,
      ]);
      const inserted: string[] = [];
      for (const record of validated) {
        const result = await insertUsage(client, record);
        if (!result) continue;
        inserted.push(record.authoritativeRef);
        await insertUsageEvent(client, record);
      }
      await client.query('COMMIT');
      return Object.freeze(inserted);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const activeKnowledgeCte = `
WITH active_knowledge AS (
  SELECT 'planning_heuristic'::text AS kind,k.knowledge_id,k.revision,k.version,k.scope,
    k.tenant_id,k.user_id,k.risk,k.definition,NULL::text AS catalog_hash,
    e.policy_version AS promotion_policy_version,k.created_at
  FROM planning_heuristic k
  JOIN knowledge_promotion_evaluation e
    ON e.knowledge_kind='planning_heuristic'
   AND e.knowledge_id=k.knowledge_id
   AND e.knowledge_revision=k.revision
   AND e.status='passed'
  WHERE k.status='active'
  UNION ALL
  SELECT 'task_type'::text,k.knowledge_id,k.revision,k.version,k.scope,
    k.tenant_id,k.user_id,k.risk,k.definition,NULL::text,
    e.policy_version,k.created_at
  FROM task_type_definition k
  JOIN knowledge_promotion_evaluation e
    ON e.knowledge_kind='task_type'
   AND e.knowledge_id=k.knowledge_id
   AND e.knowledge_revision=k.revision
   AND e.status='passed'
  WHERE k.status='active'
  UNION ALL
  SELECT 'capability_pattern'::text,k.knowledge_id,k.revision,k.version,k.scope,
    k.tenant_id,k.user_id,k.risk,k.definition,k.catalog_hash,
    e.policy_version,k.created_at
  FROM capability_pattern_definition k
  JOIN knowledge_promotion_evaluation e
    ON e.knowledge_kind='capability_pattern'
   AND e.knowledge_id=k.knowledge_id
   AND e.knowledge_revision=k.revision
   AND e.status='passed'
  WHERE k.status='active'
)`;

function filterClause(firstParameter: number): string {
  const catalog = `$${String(firstParameter)}`;
  const policy = `$${String(firstParameter + 1)}`;
  const task = `$${String(firstParameter + 2)}`;
  const tenant = `$${String(firstParameter + 3)}`;
  const user = `$${String(firstParameter + 4)}`;
  return `a.promotion_policy_version=${policy}
    AND (a.kind<>'capability_pattern' OR a.catalog_hash=${catalog})
    AND (
      a.scope='global_candidate'
      OR (a.scope='task' AND a.definition->>'taskId'=${task})
      OR (a.scope='tenant' AND a.tenant_id=${tenant})
      OR (a.scope='user' AND a.user_id=${user})
    )`;
}

function filterParameters(filters: KnowledgeSearchFilters): readonly unknown[] {
  return [
    filters.catalogHash,
    filters.promotionPolicyVersion,
    filters.scope.taskId ?? null,
    filters.scope.tenantId ?? null,
    filters.scope.userId ?? null,
  ];
}

function mapDefinition(row: ActiveKnowledgeRow): ActiveKnowledgeDefinition {
  const definition = JsonObjectSchema.parse(row.definition);
  const embeddedStatus = definition['status'];
  const embeddedVersion = definition['version'];
  if (
    ((row.kind === 'task_type' || row.kind === 'capability_pattern') &&
      embeddedStatus !== 'active') ||
    (row.kind === 'capability_pattern' && embeddedVersion !== row.version)
  ) {
    throw new Error('KNOWLEDGE_SEARCH_PERSISTENCE_INTEGRITY_VIOLATION');
  }
  return createActiveKnowledgeDefinition({
    schemaVersion: '1.0',
    kind: row.kind,
    knowledgeId: row.knowledge_id,
    revision: row.revision,
    version: row.version,
    status: 'active',
    scope: row.scope,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    risk: row.risk,
    title: stringField(definition, 'title'),
    summary: stringField(definition, 'summary'),
    definition,
    authoritativeRef: `${row.kind}:${row.knowledge_id}:${String(row.revision)}`,
    exactSkillVersionRefs:
      row.kind === 'capability_pattern'
        ? ExactMappingsSchema.parse(definition['exactSkillVersionMappings']).map(
            (mapping) => mapping.exactSkillVersionRef,
          )
        : [],
    ...(row.catalog_hash === null ? {} : { catalogHash: row.catalog_hash }),
    promotionPolicyVersion: row.promotion_policy_version,
    createdAt: timestamp(row.created_at),
  });
}

function mapRelation(row: RelationRow): KnowledgeRelation {
  return createKnowledgeRelation({
    schemaVersion: '1.0',
    relationId: row.relation_id,
    sourceKind: row.source_kind,
    sourceKnowledgeId: row.source_knowledge_id,
    sourceRevision: row.source_revision,
    targetKind: row.target_kind,
    targetKnowledgeId: row.target_knowledge_id,
    targetRevision: row.target_revision,
    relationType: row.relation_type,
    evidenceRefs: z.array(z.string()).parse(row.evidence_refs),
    createdAt: timestamp(row.created_at),
  });
}

async function insertUsage(client: PoolClient, input: ExperienceUsageRecord): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO experience_usage_record(
       usage_id,planning_session_id,plan_candidate_id,knowledge_kind,knowledge_id,
       knowledge_revision,injection_mode,influence,user_action,validator_result,
       final_outcome_ref,created_at,authoritative_ref,query_fingerprint,retrieval_rank,
       affected_skill_goal_ids)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULL,NULL,NULL,$9,$10,$11,$12,$13::jsonb)
     ON CONFLICT (planning_session_id,knowledge_kind,knowledge_id,knowledge_revision)
     DO NOTHING
     RETURNING usage_id`,
    [
      input.usageId,
      input.planningSessionId,
      input.planCandidateId,
      input.knowledgeKind,
      input.knowledgeId,
      input.knowledgeRevision,
      input.injectionMode,
      JSON.stringify(input.influence),
      input.createdAt,
      input.authoritativeRef,
      input.queryFingerprint,
      input.retrievalRank,
      JSON.stringify(input.affectedSkillGoalIds),
    ],
  );
  return result.rowCount === 1;
}

function insertUsageEvent(client: PoolClient, input: ExperienceUsageRecord): Promise<unknown> {
  return client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,'planning.knowledge_used','experience_usage_record',$3,1,
       jsonb_build_object('correlationId',$2::text),
       jsonb_build_object(
         'usageId',$3::text,'planCandidateId',$4::text,
         'knowledgeKind',$5::text,'knowledgeId',$6::text,
         'knowledgeRevision',$7::integer,'authoritativeRef',$8::text,
         'queryFingerprint',$9::text,'retrievalRank',$10::integer,
         'injectionMode',$11::text,'affectedSkillGoalIds',$12::jsonb
       ),$13,NULL)`,
    [
      stableId('outbox-planning-knowledge-used', input.usageId),
      input.planningSessionId,
      input.usageId,
      input.planCandidateId,
      input.knowledgeKind,
      input.knowledgeId,
      input.knowledgeRevision,
      input.authoritativeRef,
      input.queryFingerprint,
      input.retrievalRank,
      input.injectionMode,
      JSON.stringify(input.affectedSkillGoalIds),
      input.createdAt,
    ],
  );
}

function stringField(input: Readonly<Record<string, unknown>>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('KNOWLEDGE_SEARCH_DEFINITION_INVALID');
  }
  return value;
}

function vectorLiteral(values: readonly number[]): string {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('KNOWLEDGE_SEARCH_VECTOR_INVALID');
  }
  return `[${values.join(',')}]`;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
