import { createHash } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  CognitiveOutboxRepository,
  CognitiveRuntimeFactReader,
  ExperienceJobRepository,
  GoalExperienceEpisodeRepository,
} from '../../../application/src/cognitive/ports.js';
import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveDomainEvent,
  createCognitiveSourceRef,
  createExperienceDeadLetter,
  createExperienceJob,
  createGoalExperienceEpisode,
  type CognitiveDomainEvent,
  type CognitiveSourceKind,
  type CognitiveSourceRef,
  type ExperienceDeadLetter,
  type ExperienceJob,
  type GoalExperienceEpisode,
} from '../../../domain/src/index.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const StringListSchema = z.array(z.string());
const CorrelationSchema = z
  .object({
    correlationId: z.string(),
    causationId: z.string().optional(),
    goalId: z.string().optional(),
    taskId: z.string().optional(),
    tenantId: z.string().optional(),
    userId: z.string().optional(),
  })
  .strict();
interface OutboxRow extends QueryResultRow {
  event_id: string;
  event_type: CognitiveDomainEvent['eventType'];
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation: unknown;
  payload: unknown;
  occurred_at: Date | string;
}

interface ExperienceJobRow extends QueryResultRow {
  job_id: string;
  job_type: ExperienceJob['jobType'];
  subject_id: string;
  status: ExperienceJob['status'];
  attempt: number;
  max_attempts: number;
  available_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  idempotency_key: string;
  payload: unknown;
  result_ref: string | null;
  last_error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EpisodeRow extends QueryResultRow {
  episode_id: string;
  goal_id: string;
  goal_version: number;
  task_id: string | null;
  context_id: string;
  episode_type: GoalExperienceEpisode['episodeType'];
  revision: number;
  terminal_outcome_ref: string;
  source_hash: string;
  episode_hash: string;
  completeness: string | number;
  status: GoalExperienceEpisode['status'];
  data_classification: GoalExperienceEpisode['dataClassification'];
  redaction_codes: unknown;
  snapshot: unknown;
  created_at: Date | string;
}

interface DeadLetterRow extends QueryResultRow {
  dead_letter_id: string;
  job_id: string;
  error_code: string;
  error_summary: string;
  failed_at: Date | string;
  replayed_at: Date | string | null;
  replayed_by: string | null;
}

export class PostgresCognitiveOutboxRepository implements CognitiveOutboxRepository {
  readonly #pool: Pool;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    pool: Pool,
    clock: Readonly<{ now(): string }> = { now: () => new Date().toISOString() },
  ) {
    this.#pool = pool;
    this.#clock = clock;
  }

  async append(event: CognitiveDomainEvent): Promise<void> {
    const validated = createCognitiveDomainEvent(event);
    const result = await this.#pool.query(
      `INSERT INTO cognitive_runtime_outbox(
         event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         correlation,payload,occurred_at,published_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,NULL)
       ON CONFLICT(event_id) DO NOTHING`,
      [
        validated.eventId,
        validated.eventType,
        validated.aggregateType,
        validated.aggregateId,
        validated.aggregateVersion,
        JSON.stringify(validated.correlation),
        JSON.stringify(validated.payload),
        validated.occurredAt,
      ],
    );
    if (result.rowCount === 0) {
      const existing = await this.#pool.query<OutboxRow>(
        'SELECT * FROM cognitive_runtime_outbox WHERE event_id=$1',
        [validated.eventId],
      );
      const row = existing.rows[0];
      if (row === undefined || !sameOutbox(row, validated)) {
        throw new Error('COGNITIVE_OUTBOX_EVENT_CONFLICT');
      }
    }
  }

  async dispatchTerminalEvents(limit = 100): Promise<readonly ExperienceJob[]> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<OutboxRow>(
        `SELECT * FROM cognitive_runtime_outbox
         WHERE event_type='user_goal.terminal_committed' AND published_at IS NULL
         ORDER BY occurred_at,event_id
         FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      const jobs: ExperienceJob[] = [];
      const now = this.#clock.now();
      for (const row of selected.rows) {
        const event = mapOutbox(row);
        const outcomeId = requireString(event.payload['outcomeId'], 'outcomeId');
        const inserted = await client.query<ExperienceJobRow>(
          `INSERT INTO experience_job(
             job_id,job_type,subject_id,status,attempt,max_attempts,available_at,
             lease_owner,lease_expires_at,idempotency_key,payload,last_error_code,
             created_at,updated_at,source_event_id,result_ref)
           VALUES($1,'episode',$2,'pending',0,5,$3,NULL,NULL,$4,$5::jsonb,NULL,$3,$3,$6,NULL)
           ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=experience_job.updated_at
           RETURNING *`,
          [
            stableId('experience-job', row.event_id),
            row.aggregate_id,
            now,
            `terminal:${outcomeId}`,
            JSON.stringify({
              goalId: row.aggregate_id,
              goalVersion: row.aggregate_version,
              outcomeId,
              sourceEventId: row.event_id,
            }),
            row.event_id,
          ],
        );
        jobs.push(mapJob(requireFirst(inserted.rows, 'EXPERIENCE_JOB_INSERT_FAILED')));
      }
      if (selected.rows.length > 0) {
        const eventIds = selected.rows.map((row) => row.event_id);
        const lastEvent = requireFirst(
          [...selected.rows].reverse(),
          'EXPERIENCE_OUTBOX_CURSOR_EVENT_MISSING',
        );
        await client.query(
          `UPDATE cognitive_runtime_outbox SET published_at=$2
           WHERE event_id=ANY($1::text[]) AND published_at IS NULL`,
          [eventIds, now],
        );
        await client.query(
          `INSERT INTO cognitive_runtime_consumer_cursor(consumer_name,last_event_id,version,updated_at)
           VALUES('experience.episode-dispatch',$1,1,$2)
           ON CONFLICT(consumer_name) DO UPDATE SET
             last_event_id=EXCLUDED.last_event_id,
             version=cognitive_runtime_consumer_cursor.version+1,
             updated_at=EXCLUDED.updated_at`,
          [lastEvent.event_id, now],
        );
      }
      await client.query('COMMIT');
      return jobs;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresExperienceJobRepository implements ExperienceJobRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createEpisodeJob(event: CognitiveDomainEvent, now: string): Promise<ExperienceJob> {
    const outcomeId = requireString(event.payload['outcomeId'], 'outcomeId');
    const result = await this.#pool.query<ExperienceJobRow>(
      `INSERT INTO experience_job(
         job_id,job_type,subject_id,status,attempt,max_attempts,available_at,
         lease_owner,lease_expires_at,idempotency_key,payload,last_error_code,
         created_at,updated_at,source_event_id,result_ref)
       VALUES($1,'episode',$2,'pending',0,5,$3,NULL,NULL,$4,$5::jsonb,NULL,$3,$3,$6,NULL)
       ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=experience_job.updated_at
       RETURNING *`,
      [
        stableId('experience-job', event.eventId),
        event.aggregateId,
        now,
        `terminal:${outcomeId}`,
        JSON.stringify({
          goalId: event.aggregateId,
          goalVersion: event.aggregateVersion,
          outcomeId,
          sourceEventId: event.eventId,
        }),
        event.eventId,
      ],
    );
    return mapJob(requireFirst(result.rows, 'EXPERIENCE_JOB_INSERT_FAILED'));
  }

  async claim(workerId: string, now: string, leaseMs: number, limit: number) {
    return this.#claimType('episode', workerId, now, leaseMs, limit);
  }

  async claimObservation(workerId: string, now: string, leaseMs: number, limit: number) {
    return this.#claimType('observe', workerId, now, leaseMs, limit);
  }

  async claimReflection(workerId: string, now: string, leaseMs: number, limit: number) {
    return this.#claimType('reflect', workerId, now, leaseMs, limit);
  }

  async #claimType(
    jobType: ExperienceJob['jobType'],
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ) {
    const result = await this.#pool.query<ExperienceJobRow>(
      `WITH claimable AS (
         SELECT job_id FROM experience_job
         WHERE job_type=$5 AND (
           (status IN ('pending','retry_wait') AND available_at <= $2)
           OR (status='leased' AND lease_expires_at <= $2)
         )
         ORDER BY available_at,job_id
         FOR UPDATE SKIP LOCKED LIMIT $3
       )
       UPDATE experience_job j SET
         status='leased',attempt=j.attempt+1,lease_owner=$1,
         lease_expires_at=$2::timestamptz + ($4::text || ' milliseconds')::interval,
         updated_at=$2
       FROM claimable c WHERE j.job_id=c.job_id
       RETURNING j.*`,
      [workerId, now, limit, leaseMs, jobType],
    );
    return result.rows.map(mapJob);
  }

  async complete(jobId: string, workerId: string, now: string, episodeId: string): Promise<void> {
    return this.#completeWithResult(jobId, workerId, now, `goal-experience-episode:${episodeId}`);
  }

  async completeObservation(
    jobId: string,
    workerId: string,
    now: string,
    observationId: string,
  ): Promise<void> {
    return this.#completeWithResult(
      jobId,
      workerId,
      now,
      `experience-observation:${observationId}`,
    );
  }

  async completeReflection(
    jobId: string,
    workerId: string,
    now: string,
    reflectionId: string,
  ): Promise<void> {
    return this.#completeWithResult(jobId, workerId, now, `experience-reflection:${reflectionId}`);
  }

  async #completeWithResult(
    jobId: string,
    workerId: string,
    now: string,
    resultRef: string,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE experience_job SET status='completed',lease_owner=NULL,lease_expires_at=NULL,
         result_ref=$4,last_error_code=NULL,updated_at=$3
       WHERE job_id=$1 AND status='leased' AND lease_owner=$2`,
      [jobId, workerId, now, resultRef],
    );
    if (result.rowCount === 0) {
      const existing = await this.#pool.query<ExperienceJobRow>(
        'SELECT * FROM experience_job WHERE job_id=$1',
        [jobId],
      );
      const row = existing.rows[0];
      if (row?.status !== 'completed' || row.result_ref !== resultRef) {
        throw new Error('EXPERIENCE_JOB_LEASE_CONFLICT');
      }
    }
  }

  async fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<ExperienceJobRow>(
        `UPDATE experience_job SET status=$4,lease_owner=NULL,lease_expires_at=NULL,
           available_at=COALESCE($5,available_at),last_error_code=$6,updated_at=$3
         WHERE job_id=$1 AND status='leased' AND lease_owner=$2
         RETURNING *`,
        [
          jobId,
          workerId,
          now,
          retryAt === undefined ? 'dead_letter' : 'retry_wait',
          retryAt ?? null,
          errorCode,
        ],
      );
      if (updated.rows[0] === undefined) throw new Error('EXPERIENCE_JOB_LEASE_CONFLICT');
      if (retryAt === undefined) {
        await client.query(
          `INSERT INTO experience_dead_letter(
             dead_letter_id,job_id,error_code,error_summary,failed_at,replayed_at,replayed_by)
           VALUES($1,$2,$3,$4,$5,NULL,NULL)
           ON CONFLICT(job_id) DO NOTHING`,
          [stableId('experience-dead-letter', jobId), jobId, errorCode, errorSummary, now],
        );
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRequeueable(now: string, limit = 100): Promise<readonly ExperienceJob[]> {
    return this.#listRequeueableType('episode', now, limit);
  }

  async listObservationRequeueable(now: string, limit = 100): Promise<readonly ExperienceJob[]> {
    return this.#listRequeueableType('observe', now, limit);
  }

  async listReflectionRequeueable(now: string, limit = 100): Promise<readonly ExperienceJob[]> {
    return this.#listRequeueableType('reflect', now, limit);
  }

  async #listRequeueableType(
    jobType: ExperienceJob['jobType'],
    now: string,
    limit: number,
  ): Promise<readonly ExperienceJob[]> {
    const result = await this.#pool.query<ExperienceJobRow>(
      `SELECT * FROM experience_job
       WHERE ((status IN ('pending','retry_wait') AND available_at <= $1)
         OR (status='leased' AND lease_expires_at <= $1))
         AND job_type=$3
       ORDER BY available_at,job_id LIMIT $2`,
      [now, limit, jobType],
    );
    return result.rows.map(mapJob);
  }

  async replayDeadLetter(
    deadLetterId: string,
    actorId: string,
    now: string,
  ): Promise<ExperienceJob> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const letter = await client.query<DeadLetterRow>(
        'SELECT * FROM experience_dead_letter WHERE dead_letter_id=$1 FOR UPDATE',
        [deadLetterId],
      );
      const row = letter.rows[0];
      if (row === undefined) throw new Error('EXPERIENCE_DEAD_LETTER_NOT_FOUND');
      if (row.replayed_at !== null) throw new Error('EXPERIENCE_DEAD_LETTER_ALREADY_REPLAYED');
      const updated = await client.query<ExperienceJobRow>(
        `UPDATE experience_job SET status='pending',attempt=0,available_at=$2,
           lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=$2
         WHERE job_id=$1 AND status='dead_letter' RETURNING *`,
        [row.job_id, now],
      );
      if (updated.rows[0] === undefined) throw new Error('EXPERIENCE_DEAD_LETTER_JOB_CONFLICT');
      await client.query(
        'UPDATE experience_dead_letter SET replayed_at=$2,replayed_by=$3 WHERE dead_letter_id=$1',
        [deadLetterId, now, actorId],
      );
      await client.query('COMMIT');
      return mapJob(updated.rows[0]);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listDeadLetters(limit = 100): Promise<readonly ExperienceDeadLetter[]> {
    const result = await this.#pool.query<DeadLetterRow>(
      'SELECT * FROM experience_dead_letter ORDER BY failed_at DESC,dead_letter_id LIMIT $1',
      [limit],
    );
    return result.rows.map(mapDeadLetter);
  }
}

export class PostgresGoalExperienceEpisodeRepository implements GoalExperienceEpisodeRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findById(episodeId: string): Promise<GoalExperienceEpisode | undefined> {
    const result = await this.#pool.query<EpisodeRow>(
      'SELECT * FROM goal_experience_episode WHERE episode_id=$1',
      [episodeId],
    );
    return result.rows[0] === undefined ? undefined : this.#map(result.rows[0]);
  }

  async findByGoal(goalId: string): Promise<readonly GoalExperienceEpisode[]> {
    const result = await this.#pool.query<EpisodeRow>(
      'SELECT * FROM goal_experience_episode WHERE goal_id=$1 ORDER BY goal_version,revision',
      [goalId],
    );
    return Promise.all(result.rows.map((row) => this.#map(row)));
  }

  async list(limit = 100, goalId?: string): Promise<readonly GoalExperienceEpisode[]> {
    const result = await this.#pool.query<EpisodeRow>(
      `SELECT * FROM goal_experience_episode
       WHERE ($2::text IS NULL OR goal_id=$2)
       ORDER BY created_at DESC,episode_id LIMIT $1`,
      [limit, goalId ?? null],
    );
    return Promise.all(result.rows.map((row) => this.#map(row)));
  }

  async saveIfAbsent(input: GoalExperienceEpisode): Promise<boolean> {
    const episode = createGoalExperienceEpisode(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `goal-experience:${episode.goalId}:${String(episode.goalVersion)}`,
      ]);
      const outcomeId = episode.terminalOutcomeRef.replace(/^runtime-terminal-outcome:/u, '');
      const existing = await client.query(
        `SELECT 1 FROM goal_experience_episode
         WHERE (goal_id=$1 AND goal_version=$2 AND episode_hash=$3)
            OR terminal_outcome_ref=$4`,
        [episode.goalId, episode.goalVersion, episode.episodeHash, outcomeId],
      );
      if (existing.rowCount !== 0) {
        await client.query('COMMIT');
        return false;
      }
      await client.query(
        `INSERT INTO goal_experience_episode(
           episode_id,goal_id,goal_version,task_id,context_id,episode_type,revision,
           terminal_outcome_ref,source_hash,episode_hash,completeness,status,
           data_classification,redaction_codes,snapshot,created_at,tenant_id,user_scope_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,NULL,NULL)`,
        [
          episode.episodeId,
          episode.goalId,
          episode.goalVersion,
          episode.taskId ?? null,
          episode.contextId,
          episode.episodeType,
          episode.revision,
          outcomeId,
          episode.sourceHash,
          episode.episodeHash,
          episode.completeness,
          episode.status,
          episode.dataClassification,
          JSON.stringify(episode.redactionCodes),
          JSON.stringify(episode.snapshot),
          episode.createdAt,
        ],
      );
      for (const source of episode.sourceRefs) {
        await client.query(
          `INSERT INTO goal_experience_episode_source(
             episode_id,source_ref_id,source_kind,source_id,source_revision,authority,
             data_classification,content_hash,captured_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            episode.episodeId,
            source.sourceRefId,
            source.sourceKind,
            source.sourceId,
            source.sourceRevision,
            source.authority,
            source.dataClassification,
            source.contentHash ?? null,
            source.capturedAt,
          ],
        );
      }
      const eventId = stableId('outbox-episode', episode.episodeId);
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at,published_at)
         VALUES($1,'experience.episode_created','goal_experience_episode',$2,$3,
           $4::jsonb,$5::jsonb,$6,NULL)`,
        [
          eventId,
          episode.episodeId,
          episode.revision,
          JSON.stringify({
            correlationId: episode.episodeId,
            goalId: episode.goalId,
            ...(episode.taskId === undefined ? {} : { taskId: episode.taskId }),
          }),
          JSON.stringify({
            episodeId: episode.episodeId,
            goalId: episode.goalId,
            goalVersion: episode.goalVersion,
          }),
          episode.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO experience_job(
           job_id,job_type,subject_id,status,attempt,max_attempts,available_at,
           lease_owner,lease_expires_at,idempotency_key,payload,last_error_code,
           created_at,updated_at,source_event_id,result_ref)
         VALUES($1,'observe',$2,'pending',0,5,$3,NULL,NULL,$4,$5::jsonb,NULL,$3,$3,$6,NULL)`,
        [
          stableId('experience-observe-job', episode.episodeId),
          episode.episodeId,
          episode.createdAt,
          `observe:${episode.episodeId}`,
          JSON.stringify({ episodeId: episode.episodeId }),
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

  async #map(row: EpisodeRow): Promise<GoalExperienceEpisode> {
    const sources = await this.#pool.query<
      QueryResultRow & {
        source_ref_id: string;
        source_kind: CognitiveSourceRef['sourceKind'];
        source_id: string;
        source_revision: number;
        authority: CognitiveSourceRef['authority'];
        data_classification: CognitiveSourceRef['dataClassification'];
        content_hash: string | null;
        captured_at: Date | string;
      }
    >('SELECT * FROM goal_experience_episode_source WHERE episode_id=$1 ORDER BY source_ref_id', [
      row.episode_id,
    ]);
    return createGoalExperienceEpisode({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      episodeId: row.episode_id,
      goalId: row.goal_id,
      goalVersion: row.goal_version,
      ...(row.task_id === null ? {} : { taskId: row.task_id }),
      contextId: row.context_id,
      episodeType: row.episode_type,
      revision: row.revision,
      terminalOutcomeRef: `runtime-terminal-outcome:${row.terminal_outcome_ref}`,
      sourceHash: row.source_hash,
      episodeHash: row.episode_hash,
      completeness: Number(row.completeness),
      status: row.status,
      dataClassification: row.data_classification,
      snapshot: JsonObjectSchema.parse(row.snapshot),
      sourceRefs: sources.rows.map((source) =>
        createCognitiveSourceRef({
          schemaVersion: COGNITIVE_SCHEMA_VERSION,
          sourceRefId: source.source_ref_id,
          sourceKind: source.source_kind,
          sourceId: source.source_id,
          sourceRevision: source.source_revision,
          authority: source.authority,
          dataClassification: source.data_classification,
          ...(source.content_hash === null ? {} : { contentHash: source.content_hash }),
          capturedAt: timestamp(source.captured_at),
        }),
      ),
      redactionCodes: StringListSchema.parse(row.redaction_codes),
      createdAt: timestamp(row.created_at),
    });
  }
}

export class PostgresCognitiveRuntimeFactReader implements CognitiveRuntimeFactReader {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async readGoalFacts(
    goalId: string,
    goalVersion: number,
  ): Promise<Readonly<Record<string, unknown>>> {
    const goal = await oneJson(
      this.#pool,
      `SELECT to_jsonb(g) AS value FROM goal g WHERE goal_id=$1 AND version=$2`,
      [goalId, goalVersion],
    );
    const contract = await oneJson(
      this.#pool,
      `SELECT jsonb_build_object(
         'goalId',goal_id,'goalVersion',goal_version,'contractHash',contract_hash,
         'contract',contract_json,'createdAt',created_at) AS value
       FROM user_goal_contract WHERE goal_id=$1 AND goal_version=$2`,
      [goalId, goalVersion],
    );
    const plans = await manyJson(
      this.#pool,
      `SELECT jsonb_build_object(
         'planId',plan_id,'revision',revision,'revisionKind',revision_kind,'status',status,
         'contractHash',contract_hash,'contentHash',content_hash,'plan',plan_json,
         'createdAt',created_at,'updatedAt',updated_at) AS value
       FROM user_goal_plan WHERE goal_id=$1 AND goal_version=$2 ORDER BY revision`,
      [goalId, goalVersion],
    );
    const terminal = await oneJson(
      this.#pool,
      `SELECT jsonb_build_object(
         'outcomeId',outcome_id,'kind',outcome_kind,'taskId',task_id,'controlId',control_id,
         'controlStatus',control_status,'roundIndex',round_index,'finalInstanceId',final_instance_id,
         'resultId',result_id,'summary',summary,'authority',authority,'committedAt',committed_at) AS value
       FROM runtime_terminal_outcome WHERE goal_id=$1 AND goal_version=$2
       ORDER BY committed_at DESC LIMIT 1`,
      [goalId, goalVersion],
    );
    const taskId =
      terminal === undefined || typeof terminal['taskId'] !== 'string'
        ? undefined
        : terminal['taskId'];
    const task =
      taskId === undefined
        ? goal === undefined
          ? undefined
          : { contextId: goal['context_id'] }
        : await oneJson(
            this.#pool,
            `SELECT jsonb_build_object('taskId',task_id,'contextId',context_id,'goalId',goal_id,
             'goalVersion',goal_version,'phase',phase,'createdAt',created_at,'updatedAt',updated_at) AS value
           FROM agent_task WHERE task_id=$1`,
            [taskId],
          );
    const currentPlan = plans.at(-1);
    const judgment = await oneJson(
      this.#pool,
      `SELECT jsonb_build_object(
         'decisionId',d.outcome_decision_id,'status',d.status,'confidence',d.confidence,
         'decision',d.decision_json,'planId',d.plan_id,'createdAt',d.created_at) AS value
       FROM outcome_decision d JOIN user_goal_plan p ON p.plan_id=d.plan_id
       WHERE p.goal_id=$1 AND p.goal_version=$2 AND d.level='user_goal' AND d.subject_id=$1
       ORDER BY d.created_at DESC LIMIT 1`,
      [goalId, goalVersion],
    );
    const planIds = plans.flatMap((plan) =>
      typeof plan['planId'] === 'string' ? [plan['planId']] : [],
    );
    const attempts =
      planIds.length === 0
        ? []
        : await manyJson(
            this.#pool,
            `SELECT to_jsonb(a) AS value FROM skill_attempt a
       WHERE plan_id=ANY($1::text[]) ORDER BY created_at,attempt_id`,
            [planIds],
          );
    const outcomes =
      planIds.length === 0
        ? []
        : await manyJson(
            this.#pool,
            `SELECT to_jsonb(d) AS value FROM outcome_decision d
       WHERE plan_id=ANY($1::text[]) ORDER BY created_at,outcome_decision_id`,
            [planIds],
          );
    const progress =
      planIds.length === 0
        ? []
        : await manyJson(
            this.#pool,
            `SELECT to_jsonb(p) AS value FROM progress_observation p
       WHERE plan_id=ANY($1::text[]) ORDER BY observed_at,progress_observation_id`,
            [planIds],
          );
    const recovery =
      planIds.length === 0
        ? []
        : await manyJson(
            this.#pool,
            `SELECT to_jsonb(r) AS value FROM recovery_decision r
       WHERE plan_id=ANY($1::text[]) ORDER BY created_at,recovery_decision_id`,
            [planIds],
          );
    const eventImpacts =
      planIds.length === 0
        ? []
        : await manyJson(
            this.#pool,
            `SELECT to_jsonb(e) AS value FROM event_impact_assessment e
       WHERE goal_id=$1 OR plan_id=ANY($2::text[]) ORDER BY created_at,assessment_id`,
            [goalId, planIds],
          );
    const interactions =
      taskId === undefined
        ? []
        : await manyJson(
            this.#pool,
            `SELECT jsonb_build_object(
         'episodeId',episode_id,'revision',revision,'episodeHash',episode_hash,
         'completeness',completeness,'snapshot',snapshot,'createdAt',created_at) AS value
       FROM planning_interaction_episode WHERE task_id=$1 ORDER BY revision`,
            [taskId],
          );

    const sources: CognitiveSourceRef[] = [];
    addSource(sources, 'goal_contract', contract, 'goalId', 'goal-unknown', 1);
    for (const plan of plans)
      addSource(
        sources,
        'plan_revision',
        plan,
        'planId',
        'plan-unknown',
        number(plan['revision'], 1),
      );
    for (const attempt of attempts)
      addSource(sources, 'skill_attempt', attempt, 'attempt_id', 'attempt-unknown', 1);
    for (const item of recovery)
      addSource(sources, 'recovery_decision', item, 'recovery_decision_id', 'recovery-unknown', 1);
    for (const item of eventImpacts)
      addSource(sources, 'business_event', item, 'assessment_id', 'event-impact-unknown', 1);
    for (const interaction of interactions)
      addSource(
        sources,
        'planning_correction',
        interaction,
        'episodeId',
        'interaction-unknown',
        number(interaction['revision'], 1),
      );
    addSource(sources, 'runtime_terminal_outcome', terminal, 'outcomeId', 'outcome-unknown', 1);

    return Object.freeze({
      ...(task === undefined ? {} : { task }),
      ...(contract === undefined ? {} : { contract }),
      ...(currentPlan === undefined ? {} : { currentPlan }),
      planRevisions: plans,
      attempts,
      outcomes,
      progress,
      recovery,
      eventImpacts,
      interactions,
      ...(judgment === undefined ? {} : { userGoalJudgment: judgment }),
      ...(terminal === undefined ? {} : { terminalOutcome: terminal }),
      sourceRefs: Object.freeze(sources),
    });
  }
}

async function oneJson(pool: Pool, sql: string, values: readonly unknown[]) {
  const result = await pool.query<QueryResultRow & { value: unknown }>(sql, [...values]);
  return result.rows[0] === undefined ? undefined : JsonObjectSchema.parse(result.rows[0].value);
}

async function manyJson(pool: Pool, sql: string, values: readonly unknown[]) {
  const result = await pool.query<QueryResultRow & { value: unknown }>(sql, [...values]);
  return result.rows.map((row) => JsonObjectSchema.parse(row.value));
}

function addSource(
  target: CognitiveSourceRef[],
  sourceKind: CognitiveSourceKind,
  value: Readonly<Record<string, unknown>> | undefined,
  idField: string,
  fallbackId: string,
  sourceRevision: number,
): void {
  if (value === undefined) return;
  const sourceId = typeof value[idField] === 'string' ? value[idField] : fallbackId;
  const capturedAt = sourceTimestamp(value);
  target.push(
    createCognitiveSourceRef({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      sourceRefId: stableId(`source-${sourceKind}`, `${sourceId}:${String(sourceRevision)}`),
      sourceKind,
      sourceId,
      sourceRevision,
      authority: 'runtime_fact',
      dataClassification: 'internal',
      capturedAt,
      contentHash: hash(value),
    }),
  );
}

function sourceTimestamp(value: Readonly<Record<string, unknown>>): string {
  for (const key of [
    'committedAt',
    'createdAt',
    'created_at',
    'updatedAt',
    'updated_at',
    'observed_at',
  ]) {
    const item = value[key];
    if (typeof item === 'string' && Number.isFinite(Date.parse(item)))
      return new Date(item).toISOString();
  }
  throw new Error('EXPERIENCE_SOURCE_TIMESTAMP_MISSING');
}

function mapOutbox(row: OutboxRow): CognitiveDomainEvent {
  const correlation = CorrelationSchema.parse(row.correlation);
  return createCognitiveDomainEvent({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    eventId: row.event_id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: timestamp(row.occurred_at),
    correlation: {
      correlationId: correlation.correlationId,
      ...(correlation.causationId === undefined ? {} : { causationId: correlation.causationId }),
      ...(correlation.goalId === undefined ? {} : { goalId: correlation.goalId }),
      ...(correlation.taskId === undefined ? {} : { taskId: correlation.taskId }),
      ...(correlation.tenantId === undefined ? {} : { tenantId: correlation.tenantId }),
      ...(correlation.userId === undefined ? {} : { userId: correlation.userId }),
    },
    payload: JsonObjectSchema.parse(row.payload),
  });
}

function sameOutbox(row: OutboxRow, event: CognitiveDomainEvent): boolean {
  return canonicalJson(mapOutbox(row)) === canonicalJson(event);
}

function mapJob(row: ExperienceJobRow): ExperienceJob {
  return createExperienceJob({
    jobId: row.job_id,
    jobType: row.job_type,
    subjectId: row.subject_id,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    availableAt: timestamp(row.available_at),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: timestamp(row.lease_expires_at) }),
    idempotencyKey: row.idempotency_key,
    payload: JsonObjectSchema.parse(row.payload),
    ...(row.result_ref === null ? {} : { resultRef: row.result_ref }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function mapDeadLetter(row: DeadLetterRow): ExperienceDeadLetter {
  return createExperienceDeadLetter({
    deadLetterId: row.dead_letter_id,
    jobId: row.job_id,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    failedAt: timestamp(row.failed_at),
    ...(row.replayed_at === null ? {} : { replayedAt: timestamp(row.replayed_at) }),
    ...(row.replayed_by === null ? {} : { replayedBy: row.replayed_by }),
  });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`EXPERIENCE_${field.toUpperCase()}_INVALID`);
  return value;
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : fallback;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('EXPERIENCE_NON_JSON_VALUE');
  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function requireFirst<T>(rows: readonly T[], code: string): T {
  const first = rows[0];
  if (first === undefined) throw new Error(code);
  return first;
}
