import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { ReflectionRepository } from '../../../application/src/cognitive/ports.js';
import {
  createExperienceReflection,
  createKnowledgeCandidateIdentity,
  createKnowledgeCandidateSnapshot,
  createKnowledgeEvidence,
  type CognitiveSourceRef,
  type ExperienceReflection,
  type KnowledgeCandidateIdentity,
  type KnowledgeCandidateSnapshot,
  type KnowledgeDelta,
  type KnowledgeEvidence,
  type KnowledgeKind,
} from '../../../domain/src/index.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const JsonArraySchema = z.array(z.unknown());
const StringListSchema = z.array(z.string());
const DefinitionSchema = z
  .object({
    title: z.string(),
    summary: z.string(),
    fingerprint: z.string(),
    identity: JsonObjectSchema,
  })
  .strict();

interface ReflectionRow extends QueryResultRow {
  reflection_id: string;
  observation_id: string;
  revision: number;
  status: ExperienceReflection['status'];
  delta: unknown;
  model_invocation_id: string | null;
  created_at: Date | string;
  observation_ids: unknown;
  group_key: unknown;
  impacts: unknown;
  reflection_hash: string;
  model_invocation_refs: unknown;
}

interface IdentityRow extends QueryResultRow {
  knowledge_id: string;
  knowledge_revision: number;
  fingerprint: string;
  identity: unknown;
}

interface CandidateRow extends QueryResultRow {
  knowledge_id: string;
  revision: number;
  status: KnowledgeCandidateSnapshot['status'];
  scope: KnowledgeCandidateSnapshot['scope'];
  tenant_id: string | null;
  user_id: string | null;
  risk: KnowledgeCandidateSnapshot['risk'];
  definition: unknown;
  created_at: Date | string;
}

interface EvidenceRow extends QueryResultRow {
  polarity: 'support' | 'contradiction';
  source_ref: unknown;
}

const tables: Readonly<Record<KnowledgeKind, Readonly<{ definition: string; evidence: string }>>> =
  Object.freeze({
    planning_heuristic: {
      definition: 'planning_heuristic',
      evidence: 'planning_heuristic_evidence',
    },
    task_type: {
      definition: 'task_type_definition',
      evidence: 'task_type_evidence',
    },
    capability_pattern: {
      definition: 'capability_pattern_definition',
      evidence: 'capability_pattern_evidence',
    },
  });

export class PostgresReflectionRepository implements ReflectionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(reflectionId: string): Promise<ExperienceReflection | undefined> {
    const result = await this.#pool.query<ReflectionRow>(
      'SELECT * FROM experience_reflection WHERE reflection_id=$1',
      [reflectionId],
    );
    return result.rows[0] === undefined ? undefined : mapReflection(result.rows[0]);
  }

  async findByObservation(observationId: string): Promise<ExperienceReflection | undefined> {
    const result = await this.#pool.query<ReflectionRow>(
      `SELECT * FROM experience_reflection
       WHERE observation_ids @> to_jsonb(ARRAY[$1]::text[])
       ORDER BY revision DESC,reflection_id DESC LIMIT 1`,
      [observationId],
    );
    return result.rows[0] === undefined ? undefined : mapReflection(result.rows[0]);
  }

  async list(limit = 100): Promise<readonly ExperienceReflection[]> {
    const result = await this.#pool.query<ReflectionRow>(
      'SELECT * FROM experience_reflection ORDER BY created_at DESC,reflection_id LIMIT $1',
      [limit],
    );
    return result.rows.map(mapReflection);
  }

  async listCandidateIdentities(kind: KnowledgeKind, limit = 50) {
    const table = tables[kind].definition;
    const result = await this.#pool.query<IdentityRow>(
      `SELECT DISTINCT ON (l.knowledge_id)
         l.knowledge_id,l.knowledge_revision,l.fingerprint,l.identity
       FROM knowledge_candidate_lineage l
       JOIN ${table} k ON k.knowledge_id=l.knowledge_id AND k.revision=l.knowledge_revision
       WHERE l.knowledge_kind=$1 AND k.status='candidate'
       ORDER BY l.knowledge_id,l.knowledge_revision DESC LIMIT $2`,
      [kind, limit],
    );
    return result.rows.map((row) => ({
      knowledgeId: row.knowledge_id,
      revision: row.knowledge_revision,
      fingerprint: row.fingerprint,
      identity: createKnowledgeCandidateIdentity(
        JsonObjectSchema.parse(row.identity) as unknown as KnowledgeCandidateIdentity,
      ),
    }));
  }

  async findCandidate(
    kind: KnowledgeKind,
    knowledgeId: string,
  ): Promise<KnowledgeCandidateSnapshot | undefined> {
    const table = tables[kind];
    const result = await this.#pool.query<CandidateRow>(
      `SELECT * FROM ${table.definition}
       WHERE knowledge_id=$1 ORDER BY revision DESC LIMIT 1`,
      [knowledgeId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const evidence = await this.#pool.query<EvidenceRow>(
      `SELECT polarity,source_ref FROM ${table.evidence}
       WHERE knowledge_id=$1 AND knowledge_revision=$2 ORDER BY evidence_id`,
      [knowledgeId, row.revision],
    );
    const definition = DefinitionSchema.parse(row.definition);
    const items = evidence.rows.map((item) =>
      createKnowledgeEvidence(
        JsonObjectSchema.parse(item.source_ref) as unknown as KnowledgeEvidence,
      ),
    );
    return createKnowledgeCandidateSnapshot({
      schemaVersion: '1.0',
      knowledgeId: row.knowledge_id,
      kind,
      revision: row.revision,
      status: row.status,
      scope: row.scope,
      ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
      ...(row.user_id === null ? {} : { userId: row.user_id }),
      title: definition.title,
      summary: definition.summary,
      risk: row.risk,
      supportSourceRefs: sourceRefs(items.filter((item) => item.polarity === 'support')),
      contradictionSourceRefs: sourceRefs(
        items.filter((item) => item.polarity === 'contradiction'),
      ),
      createdAt: timestamp(row.created_at),
    });
  }

  async save(input: ExperienceReflection): Promise<boolean> {
    const reflection = createExperienceReflection(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `experience-reflection:${reflection.seedObservationId}`,
      ]);
      const observations = await client.query<{ observation_id: string } & QueryResultRow>(
        'SELECT observation_id FROM experience_observation WHERE observation_id=ANY($1::text[])',
        [reflection.observationIds],
      );
      if (observations.rowCount !== reflection.observationIds.length) {
        throw new Error('EXPERIENCE_REFLECTION_SOURCE_OBSERVATION_MISSING');
      }
      const existing = await client.query<ReflectionRow>(
        `SELECT * FROM experience_reflection
         WHERE reflection_id=$1 OR reflection_hash=$2 OR (observation_id=$3 AND revision=$4)`,
        [
          reflection.reflectionId,
          reflection.reflectionHash,
          reflection.seedObservationId,
          reflection.revision,
        ],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (
          prior.reflection_id === reflection.reflectionId &&
          prior.reflection_hash === reflection.reflectionHash
        ) {
          await client.query('COMMIT');
          return false;
        }
        throw new Error('EXPERIENCE_REFLECTION_CONFLICT');
      }
      await client.query(
        `INSERT INTO experience_reflection(
           reflection_id,observation_id,revision,status,delta,model_invocation_id,created_at,
           observation_ids,group_key,impacts,reflection_hash,model_invocation_refs)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb)`,
        [
          reflection.reflectionId,
          reflection.seedObservationId,
          reflection.revision,
          reflection.status,
          JSON.stringify(reflection.deltas),
          reflection.modelInvocationRefs[0] ?? null,
          reflection.createdAt,
          JSON.stringify(reflection.observationIds),
          JSON.stringify(reflection.group),
          JSON.stringify(reflection.impacts),
          reflection.reflectionHash,
          JSON.stringify(reflection.modelInvocationRefs),
        ],
      );
      for (const delta of reflection.deltas) await saveDelta(client, delta, reflection);
      await appendOutbox(client, {
        eventId: stableId('outbox-reflection-completed', reflection.reflectionId),
        eventType: 'experience.reflection_completed',
        aggregateType: 'experience_reflection',
        aggregateId: reflection.reflectionId,
        aggregateVersion: reflection.revision,
        payload: {
          reflectionId: reflection.reflectionId,
          observationIds: reflection.observationIds,
          status: reflection.status,
        },
        occurredAt: reflection.createdAt,
      });
      await client.query('COMMIT');
      return true;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function saveDelta(
  client: PoolClient,
  delta: KnowledgeDelta,
  reflection: ExperienceReflection,
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_delta_record(
       delta_id,reflection_id,operation,knowledge_kind,target_knowledge_id,target_revision,
       candidate_knowledge_id,candidate_revision,fingerprint,delta,model_invocation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
    [
      delta.deltaId,
      reflection.reflectionId,
      delta.operation,
      delta.knowledgeKind,
      delta.targetKnowledgeId ?? null,
      delta.targetRevision ?? null,
      delta.candidate?.knowledgeId ?? null,
      delta.candidate?.revision ?? null,
      delta.fingerprint,
      JSON.stringify(delta),
      delta.modelInvocationId ?? null,
      delta.createdAt,
    ],
  );
  if (delta.candidate === undefined) return;
  const candidate = delta.candidate;
  const table = tables[candidate.kind];
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `knowledge-candidate:${candidate.kind}:${candidate.knowledgeId}`,
  ]);
  const latest = await client.query<{ revision: number } & QueryResultRow>(
    `SELECT revision FROM ${table.definition} WHERE knowledge_id=$1 ORDER BY revision DESC LIMIT 1`,
    [candidate.knowledgeId],
  );
  const priorRevision = latest.rows[0]?.revision;
  if (
    (candidate.revision === 1 && priorRevision !== undefined) ||
    (candidate.revision > 1 && priorRevision !== candidate.revision - 1)
  ) {
    throw new Error('KNOWLEDGE_CANDIDATE_REVISION_CONFLICT');
  }
  await client.query(
    `INSERT INTO ${table.definition}(
       knowledge_id,revision,status,scope,tenant_id,user_id,risk,definition,version,created_at)
     VALUES($1,$2,'candidate',$3,$4,$5,$6,$7::jsonb,$2,$8)`,
    [
      candidate.knowledgeId,
      candidate.revision,
      candidate.scope,
      candidate.tenantId ?? null,
      candidate.userId ?? null,
      candidate.risk,
      JSON.stringify({
        title: candidate.title,
        summary: candidate.summary,
        fingerprint: delta.fingerprint,
        identity: delta.identity,
      }),
      candidate.createdAt,
    ],
  );
  if (priorRevision !== undefined) {
    await client.query(
      `INSERT INTO ${table.evidence}(
         knowledge_id,knowledge_revision,evidence_id,polarity,source_ref,created_at)
       SELECT knowledge_id,$2,evidence_id,polarity,source_ref,created_at
       FROM ${table.evidence} WHERE knowledge_id=$1 AND knowledge_revision=$3`,
      [candidate.knowledgeId, candidate.revision, priorRevision],
    );
  }
  for (const evidence of [...delta.supportEvidence, ...delta.contradictionEvidence]) {
    await client.query(
      `INSERT INTO ${table.evidence}(
         knowledge_id,knowledge_revision,evidence_id,polarity,source_ref,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (knowledge_id,knowledge_revision,evidence_id) DO NOTHING`,
      [
        candidate.knowledgeId,
        candidate.revision,
        evidence.evidenceId,
        evidence.polarity,
        JSON.stringify(evidence),
        evidence.createdAt,
      ],
    );
  }
  await client.query(
    `INSERT INTO knowledge_candidate_lineage(
       knowledge_kind,knowledge_id,knowledge_revision,reflection_id,delta_id,operation,
       fingerprint,identity,parent_refs,related_refs,model_invocation_refs,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12)`,
    [
      candidate.kind,
      candidate.knowledgeId,
      candidate.revision,
      reflection.reflectionId,
      delta.deltaId,
      delta.operation,
      delta.fingerprint,
      JSON.stringify(delta.identity),
      JSON.stringify(
        delta.targetKnowledgeId === undefined
          ? []
          : [`${delta.knowledgeKind}:${delta.targetKnowledgeId}:${String(delta.targetRevision)}`],
      ),
      JSON.stringify(delta.relatedKnowledgeIds),
      JSON.stringify(delta.modelInvocationId === undefined ? [] : [delta.modelInvocationId]),
      delta.createdAt,
    ],
  );
  await appendOutbox(client, {
    eventId: stableId('outbox-knowledge-candidate', delta.deltaId),
    eventType: 'knowledge.candidate_created',
    aggregateType: candidate.kind,
    aggregateId: candidate.knowledgeId,
    aggregateVersion: candidate.revision,
    payload: {
      knowledgeKind: candidate.kind,
      knowledgeId: candidate.knowledgeId,
      revision: candidate.revision,
      reflectionId: reflection.reflectionId,
      deltaId: delta.deltaId,
    },
    occurredAt: delta.createdAt,
  });
  if (delta.contradictionEvidence.length > 0) {
    await appendOutbox(client, {
      eventId: stableId('outbox-knowledge-contradiction', delta.deltaId),
      eventType: 'knowledge.contradiction_recorded',
      aggregateType: candidate.kind,
      aggregateId: candidate.knowledgeId,
      aggregateVersion: candidate.revision,
      payload: {
        knowledgeKind: candidate.kind,
        knowledgeId: candidate.knowledgeId,
        revision: candidate.revision,
        evidenceIds: delta.contradictionEvidence.map((item) => item.evidenceId),
      },
      occurredAt: delta.createdAt,
    });
  }
}

async function appendOutbox(
  client: PoolClient,
  input: Readonly<{
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: Readonly<Record<string, unknown>>;
    occurredAt: string;
  }>,
): Promise<void> {
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,$3,$4,$5,jsonb_build_object('correlationId',$4),$6::jsonb,$7,NULL)`,
    [
      input.eventId,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      JSON.stringify(input.payload),
      input.occurredAt,
    ],
  );
}

function mapReflection(row: ReflectionRow): ExperienceReflection {
  return createExperienceReflection({
    schemaVersion: '1.0',
    reflectionId: row.reflection_id,
    seedObservationId: row.observation_id,
    observationIds: StringListSchema.parse(row.observation_ids),
    revision: row.revision,
    status: row.status,
    group: JsonObjectSchema.parse(row.group_key) as unknown as ExperienceReflection['group'],
    impacts: JsonArraySchema.parse(row.impacts) as unknown as ExperienceReflection['impacts'],
    deltas: JsonArraySchema.parse(row.delta) as unknown as ExperienceReflection['deltas'],
    modelInvocationRefs: StringListSchema.parse(row.model_invocation_refs),
    reflectionHash: row.reflection_hash,
    createdAt: timestamp(row.created_at),
  });
}

function sourceRefs(items: readonly KnowledgeEvidence[]): readonly CognitiveSourceRef[] {
  const result = new Map<string, CognitiveSourceRef>();
  for (const source of items.flatMap((item) => item.sourceRefs ?? [])) {
    result.set(source.sourceRefId, source);
  }
  return Object.freeze([...result.values()]);
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
