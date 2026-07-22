import { createHash } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { ObservationRepository } from '../../../application/src/cognitive/ports.js';
import {
  createExperienceExtraction,
  createExperienceObservation,
  createExperienceObservationStatement,
  type ExperienceExtraction,
  type ExperienceObservation,
  type ExperienceObservationStatement,
} from '../../../domain/src/index.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const StringListSchema = z.array(z.string());
const StatementSchema = z
  .object({
    statementId: z.string(),
    kind: z.enum(['fact', 'inference', 'candidate_lesson', 'uncertainty', 'contradiction']),
    summary: z.string(),
    confidence: z.number(),
    sourceRefIds: z.array(z.string()),
  })
  .strict();
const SuggestionSchema = z
  .object({
    action: z.enum([
      'create_candidate',
      'create_revision',
      'suggest_supersede',
      'suggest_reject',
      'no_change',
    ]),
    summary: z.string(),
    sourceRefIds: z.array(z.string()),
  })
  .strict();
const ExtractionResultSchema = z
  .object({
    statements: z.array(StatementSchema),
    changeSuggestions: z.array(SuggestionSchema),
  })
  .strict();

interface ObservationRow extends QueryResultRow {
  observation_id: string;
  episode_id: string;
  revision: number;
  status: ExperienceObservation['status'];
  model_invocation_id: string | null;
  summary: unknown;
  created_at: Date | string;
  scope: ExperienceObservation['scope'];
  source_episode_ids: unknown;
  observation_hash: string;
  model_invocation_refs: unknown;
}

interface StatementRow extends QueryResultRow {
  statement_id: string;
  kind: ExperienceObservationStatement['kind'];
  summary: string;
  confidence: string | number;
  source_ref_ids: unknown;
}

interface ExtractionRow extends QueryResultRow {
  extraction_id: string;
  observation_id: string;
  extractor_kind: ExperienceExtraction['extractorKind'];
  status: ExperienceExtraction['status'];
  result: unknown;
  error_code: string | null;
  created_at: Date | string;
  model_invocation_id: string | null;
  source_episode_ids: unknown;
  model_tier: ExperienceExtraction['modelTier'];
  input_bytes: number;
  output_bytes: number;
}

export class PostgresObservationRepository implements ObservationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(observationId: string): Promise<ExperienceObservation | undefined> {
    const result = await this.#pool.query<ObservationRow>(
      'SELECT * FROM experience_observation WHERE observation_id=$1',
      [observationId],
    );
    return result.rows[0] === undefined ? undefined : this.#map(result.rows[0]);
  }

  async findByEpisode(episodeId: string): Promise<readonly ExperienceObservation[]> {
    const result = await this.#pool.query<ObservationRow>(
      `SELECT * FROM experience_observation
       WHERE source_episode_ids @> to_jsonb(ARRAY[$1]::text[])
       ORDER BY revision,observation_id`,
      [episodeId],
    );
    return Promise.all(result.rows.map((row) => this.#map(row)));
  }

  async list(limit = 100, goalId?: string): Promise<readonly ExperienceObservation[]> {
    const result = await this.#pool.query<ObservationRow>(
      `SELECT o.* FROM experience_observation o
       JOIN goal_experience_episode e ON e.episode_id=o.episode_id
       WHERE ($2::text IS NULL OR e.goal_id=$2)
       ORDER BY o.created_at DESC,o.observation_id LIMIT $1`,
      [limit, goalId ?? null],
    );
    return Promise.all(result.rows.map((row) => this.#map(row)));
  }

  async listPrevious(
    goalId: string,
    excludeEpisodeId: string,
    limit: number,
  ): Promise<readonly ExperienceObservation[]> {
    const result = await this.#pool.query<ObservationRow>(
      `SELECT o.* FROM experience_observation o
       JOIN goal_experience_episode e ON e.episode_id=o.episode_id
       WHERE e.goal_id=$1 AND o.episode_id<>$2
       ORDER BY o.created_at DESC,o.observation_id LIMIT $3`,
      [goalId, excludeEpisodeId, limit],
    );
    return Promise.all(result.rows.map((row) => this.#map(row)));
  }

  async save(input: ExperienceObservation): Promise<boolean> {
    const observation = createExperienceObservation(input);
    const primaryEpisodeId = observation.sourceEpisodeIds[0];
    if (primaryEpisodeId === undefined) throw new Error('EXPERIENCE_OBSERVATION_EPISODE_REQUIRED');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `experience-observation:${primaryEpisodeId}`,
      ]);
      const sources = await client.query<{ episode_id: string } & QueryResultRow>(
        'SELECT episode_id FROM goal_experience_episode WHERE episode_id=ANY($1::text[])',
        [observation.sourceEpisodeIds],
      );
      if (sources.rowCount !== observation.sourceEpisodeIds.length) {
        throw new Error('EXPERIENCE_OBSERVATION_SOURCE_EPISODE_MISSING');
      }
      const existing = await client.query<ObservationRow>(
        `SELECT * FROM experience_observation
         WHERE observation_id=$1 OR observation_hash=$2 OR (episode_id=$3 AND revision=$4)`,
        [
          observation.observationId,
          observation.observationHash,
          primaryEpisodeId,
          observation.revision,
        ],
      );
      const prior = existing.rows[0];
      if (prior !== undefined) {
        if (
          prior.observation_id === observation.observationId &&
          prior.observation_hash === observation.observationHash
        ) {
          await client.query('COMMIT');
          return false;
        }
        throw new Error('EXPERIENCE_OBSERVATION_CONFLICT');
      }
      await client.query(
        `INSERT INTO experience_observation(
           observation_id,episode_id,revision,status,model_invocation_id,summary,created_at,
           scope,source_episode_ids,observation_hash,model_invocation_refs)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11::jsonb)`,
        [
          observation.observationId,
          primaryEpisodeId,
          observation.revision,
          observation.status,
          observation.modelInvocationRefs[0] ?? null,
          JSON.stringify(observation.summary),
          observation.createdAt,
          observation.scope,
          JSON.stringify(observation.sourceEpisodeIds),
          observation.observationHash,
          JSON.stringify(observation.modelInvocationRefs),
        ],
      );
      for (const statement of observation.statements) {
        await client.query(
          `INSERT INTO experience_observation_fact(
             observation_id,statement_id,kind,summary,confidence,source_ref_ids)
           VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            observation.observationId,
            statement.statementId,
            statement.kind,
            statement.summary,
            statement.confidence,
            JSON.stringify(statement.sourceRefIds),
          ],
        );
      }
      for (const extraction of observation.extractions) {
        await client.query(
          `INSERT INTO experience_extraction(
             extraction_id,observation_id,extractor_kind,status,result,error_code,created_at,
             model_invocation_id,source_episode_ids,model_tier,input_bytes,output_bytes)
           VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
          [
            extraction.extractionId,
            observation.observationId,
            extraction.extractorKind,
            extraction.status,
            JSON.stringify({
              statements: extraction.statements,
              changeSuggestions: extraction.changeSuggestions,
            }),
            extraction.errorCode ?? null,
            extraction.createdAt,
            extraction.modelInvocationId ?? null,
            JSON.stringify(extraction.sourceEpisodeIds),
            extraction.modelTier,
            extraction.inputBytes,
            extraction.outputBytes,
          ],
        );
      }
      const eventId = stableId('outbox-observation-completed', observation.observationId);
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES($1,'experience.observation_completed','experience_observation',$2,$3,
           jsonb_build_object('correlationId',$2),
           jsonb_build_object('observationId',$2,'sourceEpisodeIds',$4::jsonb,'status',$5),
           $6,NULL)`,
        [
          eventId,
          observation.observationId,
          observation.revision,
          JSON.stringify(observation.sourceEpisodeIds),
          observation.status,
          observation.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO experience_job(
           job_id,job_type,subject_id,status,attempt,max_attempts,available_at,
           lease_owner,lease_expires_at,idempotency_key,payload,last_error_code,
           created_at,updated_at,source_event_id,result_ref)
         VALUES($1,'reflect',$2,'pending',0,5,$3,NULL,NULL,$4,$5::jsonb,NULL,$3,$3,$6,NULL)`,
        [
          stableId('experience-reflect-job', observation.observationId),
          observation.observationId,
          observation.createdAt,
          `reflect:${observation.observationId}`,
          JSON.stringify({ observationId: observation.observationId }),
          eventId,
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #map(row: ObservationRow): Promise<ExperienceObservation> {
    const [statements, extractions] = await Promise.all([
      this.#pool.query<StatementRow>(
        `SELECT * FROM experience_observation_fact
         WHERE observation_id=$1 ORDER BY statement_id`,
        [row.observation_id],
      ),
      this.#pool.query<ExtractionRow>(
        `SELECT * FROM experience_extraction
         WHERE observation_id=$1 ORDER BY extractor_kind`,
        [row.observation_id],
      ),
    ]);
    return createExperienceObservation({
      schemaVersion: '1.0',
      observationId: row.observation_id,
      scope: row.scope,
      sourceEpisodeIds: StringListSchema.parse(row.source_episode_ids),
      revision: row.revision,
      status: row.status,
      statements: statements.rows.map((statement) =>
        createExperienceObservationStatement({
          statementId: statement.statement_id,
          kind: statement.kind,
          summary: statement.summary,
          confidence: Number(statement.confidence),
          sourceRefIds: StringListSchema.parse(statement.source_ref_ids),
        }),
      ),
      extractions: extractions.rows.map(mapExtraction),
      modelInvocationRefs: StringListSchema.parse(row.model_invocation_refs),
      observationHash: row.observation_hash,
      summary: JsonObjectSchema.parse(row.summary),
      createdAt: timestamp(row.created_at),
    });
  }
}

function mapExtraction(row: ExtractionRow): ExperienceExtraction {
  const result = ExtractionResultSchema.parse(row.result);
  return createExperienceExtraction({
    extractionId: row.extraction_id,
    observationId: row.observation_id,
    extractorKind: row.extractor_kind,
    status: row.status,
    modelTier: row.model_tier,
    sourceEpisodeIds: StringListSchema.parse(row.source_episode_ids),
    statements: result.statements,
    changeSuggestions: result.changeSuggestions,
    ...(row.model_invocation_id === null ? {} : { modelInvocationId: row.model_invocation_id }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    createdAt: timestamp(row.created_at),
  });
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
