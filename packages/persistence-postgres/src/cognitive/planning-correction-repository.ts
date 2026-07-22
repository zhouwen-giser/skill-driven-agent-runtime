import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { PlanningCorrectionRepository } from '../../../application/src/cognitive/ports.js';
import {
  createCognitiveSourceRef,
  createPlanningCorrectionFact,
  createPlanningInteractionEpisode,
  type PlanningCorrectionFact,
  type PlanningInteractionEpisode,
} from '../../../domain/src/index.js';

const JsonObjectSchema = z.record(z.string(), z.unknown());
const StringListSchema = z.array(z.string());
const SourceRefSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    sourceRefId: z.string(),
    sourceKind: z.enum([
      'task_request',
      'task_understanding',
      'capability_summary',
      'task_type_definition',
      'user_preference',
      'goal_contract',
      'plan_revision',
      'skill_attempt',
      'workflow_outcome',
      'runtime_terminal_outcome',
      'recovery_decision',
      'business_event',
      'planning_correction',
      'model_invocation',
      'knowledge_revision',
      'skill_version',
    ]),
    sourceId: z.string(),
    sourceRevision: z.number().int().positive(),
    authority: z.enum([
      'runtime_fact',
      'user_instruction',
      'user_confirmation',
      'domain_rule',
      'model_candidate',
      'promoted_knowledge',
      'skill_declaration',
    ]),
    dataClassification: z.enum(['public', 'internal', 'user_scoped', 'restricted']),
    capturedAt: z.string(),
    contentHash: z.string().optional(),
  })
  .strict();
const EpisodeSnapshotSchema = z
  .object({
    initialUnderstanding: JsonObjectSchema.optional(),
    initialGoalContract: JsonObjectSchema.optional(),
    initialPlan: JsonObjectSchema.optional(),
    acceptedGoalContract: JsonObjectSchema.optional(),
    acceptedPlan: JsonObjectSchema.optional(),
    turns: z.array(JsonObjectSchema),
    correctionIds: StringListSchema,
  })
  .strict();

interface CorrectionRow extends QueryResultRow {
  correction_id: string;
  task_id: string;
  goal_id: string | null;
  goal_version: number | null;
  session_id: string;
  turn_id: string;
  idempotency_key: string;
  actor_id: string;
  target_scope: PlanningCorrectionFact['target'];
  correction_type: PlanningCorrectionFact['correctionType'];
  scope: PlanningCorrectionFact['scope'];
  tenant_id: string | null;
  user_id: string | null;
  before_snapshot: unknown;
  user_instruction: string;
  structured_patch: unknown;
  after_snapshot: unknown;
  validation: unknown;
  accepted: boolean;
  preference_category: NonNullable<PlanningCorrectionFact['preferenceCategory']> | null;
  final_outcome_ref: string | null;
  counterexample_refs: unknown;
  correction_hash: string;
  source_refs: unknown;
  created_at: Date | string;
}

interface EpisodeRow extends QueryResultRow {
  episode_id: string;
  task_id: string;
  goal_id: string | null;
  goal_version: number | null;
  tenant_id: string | null;
  user_id: string | null;
  revision: number;
  original_request: string;
  outcome_ref: string | null;
  counterexample_refs: unknown;
  induction_fingerprint: string;
  episode_hash: string;
  completeness: number | string;
  snapshot: unknown;
  source_refs: unknown;
  created_at: Date | string;
}

export class PostgresPlanningCorrectionRepository implements PlanningCorrectionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findByIdempotencyKey(
    taskId: string,
    idempotencyKey: string,
  ): Promise<PlanningCorrectionFact | undefined> {
    const result = await this.#pool.query<CorrectionRow>(
      `${correctionSelect()} WHERE task_id=$1 AND idempotency_key=$2`,
      [taskId, idempotencyKey],
    );
    return result.rows[0] === undefined ? undefined : mapCorrection(result.rows[0]);
  }

  async saveIfAbsent(fact: PlanningCorrectionFact) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:planning-correction:' || $1))",
        [fact.taskId],
      );
      const existing = await findCorrection(client, fact.taskId, fact.idempotencyKey);
      if (existing !== undefined) {
        await client.query('COMMIT');
        return { fact: existing, inserted: false };
      }
      await client.query(
        `INSERT INTO planning_correction_fact(
           correction_id,task_id,goal_id,goal_version,session_id,turn_id,idempotency_key,actor_id,
           target_scope,correction_type,scope,tenant_id,user_id,before_snapshot,user_instruction,
           structured_patch,after_snapshot,validation,accepted,preference_category,final_outcome_ref,
           counterexample_refs,correction_hash,source_refs,created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16::jsonb,$17::jsonb,
           $18::jsonb,$19,$20,$21,$22::jsonb,$23,$24::jsonb,$25
         )`,
        [
          fact.correctionId,
          fact.taskId,
          fact.goalId ?? null,
          fact.goalVersion ?? null,
          fact.sessionId,
          fact.turnId,
          fact.idempotencyKey,
          fact.actorId,
          fact.target,
          fact.correctionType,
          fact.scope,
          fact.tenantId ?? null,
          fact.userId ?? null,
          JSON.stringify(fact.beforeSnapshot),
          fact.userInstruction,
          JSON.stringify(fact.structuredPatch),
          JSON.stringify(fact.afterSnapshot),
          JSON.stringify(fact.validation),
          fact.accepted,
          fact.preferenceCategory ?? null,
          fact.finalOutcomeRef ?? null,
          JSON.stringify(fact.counterexampleRefs),
          fact.correctionHash,
          JSON.stringify(fact.sourceRefs),
          fact.createdAt,
        ],
      );
      const eventId = `planning.correction_recorded:${fact.correctionId}`;
      await client.query(
        `INSERT INTO cognitive_runtime_outbox(
           event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
           correlation,payload,occurred_at
         ) VALUES ($1,'planning.correction_recorded','planning_correction',$2,1,$3::jsonb,$4::jsonb,$5)`,
        [
          eventId,
          fact.correctionId,
          JSON.stringify({
            correlationId: eventId,
            taskId: fact.taskId,
            ...(fact.goalId === undefined ? {} : { goalId: fact.goalId }),
            ...(fact.tenantId === undefined ? {} : { tenantId: fact.tenantId }),
            ...(fact.userId === undefined ? {} : { userId: fact.userId }),
          }),
          JSON.stringify({
            correctionId: fact.correctionId,
            target: fact.target,
            correctionType: fact.correctionType,
            scope: fact.scope,
            correctionHash: fact.correctionHash,
          }),
          fact.createdAt,
        ],
      );
      await client.query('COMMIT');
      return { fact, inserted: true };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listByTask(taskId: string): Promise<readonly PlanningCorrectionFact[]> {
    const result = await this.#pool.query<CorrectionRow>(
      `${correctionSelect()} WHERE task_id=$1 ORDER BY created_at,correction_id`,
      [taskId],
    );
    return result.rows.map(mapCorrection);
  }

  async listUserScoped(userId: string): Promise<readonly PlanningCorrectionFact[]> {
    const result = await this.#pool.query<CorrectionRow>(
      `${correctionSelect()} WHERE scope='user' AND user_id=$1 ORDER BY created_at,correction_id`,
      [userId],
    );
    return result.rows.map(mapCorrection);
  }

  async listTenantScoped(tenantId: string): Promise<readonly PlanningCorrectionFact[]> {
    const result = await this.#pool.query<CorrectionRow>(
      `${correctionSelect()} WHERE scope='tenant' AND tenant_id=$1 ORDER BY created_at,correction_id`,
      [tenantId],
    );
    return result.rows.map(mapCorrection);
  }

  async saveEpisode(input: PlanningInteractionEpisode): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:planning-interaction:' || $1))",
        [input.taskId],
      );
      const duplicate = await client.query<{ present: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM planning_interaction_episode WHERE task_id=$1 AND episode_hash=$2) AS present',
        [input.taskId, input.episodeHash],
      );
      if (duplicate.rows[0]?.present === true) {
        await client.query('COMMIT');
        return false;
      }
      const revisions = await client.query<{ next_revision: number }>(
        'SELECT COALESCE(MAX(revision),0)+1 AS next_revision FROM planning_interaction_episode WHERE task_id=$1',
        [input.taskId],
      );
      const revision = revisions.rows[0]?.next_revision ?? 1;
      const episode = createPlanningInteractionEpisode({ ...input, revision });
      await client.query(
        `INSERT INTO planning_interaction_episode(
           episode_id,task_id,goal_id,goal_version,tenant_id,user_id,revision,original_request,
           outcome_ref,counterexample_refs,induction_fingerprint,episode_hash,completeness,
           snapshot,source_refs,created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15::jsonb,$16)`,
        [
          episode.episodeId,
          episode.taskId,
          episode.goalId ?? null,
          episode.goalVersion ?? null,
          episode.tenantId ?? null,
          episode.userId ?? null,
          episode.revision,
          episode.originalRequest,
          episode.outcomeRef ?? null,
          JSON.stringify(episode.counterexampleRefs),
          episode.inductionFingerprint,
          episode.episodeHash,
          episode.completeness,
          JSON.stringify(episodeSnapshot(episode)),
          JSON.stringify(episode.sourceRefs),
          episode.createdAt,
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

  async listEpisodes(taskId: string): Promise<readonly PlanningInteractionEpisode[]> {
    const result = await this.#pool.query<EpisodeRow>(
      `${episodeSelect()} WHERE task_id=$1 ORDER BY revision`,
      [taskId],
    );
    return result.rows.map(mapEpisode);
  }
}

async function findCorrection(
  client: PoolClient,
  taskId: string,
  idempotencyKey: string,
): Promise<PlanningCorrectionFact | undefined> {
  const result = await client.query<CorrectionRow>(
    `${correctionSelect()} WHERE task_id=$1 AND idempotency_key=$2`,
    [taskId, idempotencyKey],
  );
  return result.rows[0] === undefined ? undefined : mapCorrection(result.rows[0]);
}

function correctionSelect(): string {
  return `SELECT correction_id,task_id,goal_id,goal_version,session_id,turn_id,idempotency_key,
                 actor_id,target_scope,correction_type,scope,tenant_id,user_id,before_snapshot,
                 user_instruction,structured_patch,after_snapshot,validation,accepted,
                 preference_category,final_outcome_ref,counterexample_refs,correction_hash,
                 source_refs,created_at
          FROM planning_correction_fact`;
}

function episodeSelect(): string {
  return `SELECT episode_id,task_id,goal_id,goal_version,tenant_id,user_id,revision,original_request,
                 outcome_ref,counterexample_refs,induction_fingerprint,episode_hash,completeness,
                 snapshot,source_refs,created_at
          FROM planning_interaction_episode`;
}

function mapCorrection(row: CorrectionRow): PlanningCorrectionFact {
  return createPlanningCorrectionFact({
    schemaVersion: '1.0',
    correctionId: row.correction_id,
    taskId: row.task_id,
    ...(row.goal_id === null || row.goal_version === null
      ? {}
      : { goalId: row.goal_id, goalVersion: row.goal_version }),
    sessionId: row.session_id,
    turnId: row.turn_id,
    idempotencyKey: row.idempotency_key,
    actorId: row.actor_id,
    target: row.target_scope,
    correctionType: row.correction_type,
    scope: row.scope,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    beforeSnapshot: JsonObjectSchema.parse(row.before_snapshot),
    userInstruction: row.user_instruction,
    structuredPatch: JsonObjectSchema.parse(row.structured_patch),
    afterSnapshot: JsonObjectSchema.parse(row.after_snapshot),
    validation: JsonObjectSchema.parse(row.validation),
    accepted: row.accepted,
    ...(row.preference_category === null ? {} : { preferenceCategory: row.preference_category }),
    ...(row.final_outcome_ref === null ? {} : { finalOutcomeRef: row.final_outcome_ref }),
    counterexampleRefs: StringListSchema.parse(row.counterexample_refs),
    correctionHash: row.correction_hash,
    sourceRefs: z.array(SourceRefSchema).parse(row.source_refs).map(normalizeSourceRef),
    createdAt: toIsoString(row.created_at),
  });
}

function mapEpisode(row: EpisodeRow): PlanningInteractionEpisode {
  const snapshot = EpisodeSnapshotSchema.parse(row.snapshot);
  return createPlanningInteractionEpisode({
    schemaVersion: '1.0',
    episodeId: row.episode_id,
    taskId: row.task_id,
    ...(row.goal_id === null || row.goal_version === null
      ? {}
      : { goalId: row.goal_id, goalVersion: row.goal_version }),
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.user_id === null ? {} : { userId: row.user_id }),
    revision: row.revision,
    originalRequest: row.original_request,
    ...(snapshot.initialUnderstanding === undefined
      ? {}
      : { initialUnderstanding: snapshot.initialUnderstanding }),
    ...(snapshot.initialGoalContract === undefined
      ? {}
      : { initialGoalContract: snapshot.initialGoalContract }),
    ...(snapshot.initialPlan === undefined ? {} : { initialPlan: snapshot.initialPlan }),
    ...(snapshot.acceptedGoalContract === undefined
      ? {}
      : { acceptedGoalContract: snapshot.acceptedGoalContract }),
    ...(snapshot.acceptedPlan === undefined ? {} : { acceptedPlan: snapshot.acceptedPlan }),
    turns: snapshot.turns,
    correctionIds: snapshot.correctionIds,
    ...(row.outcome_ref === null ? {} : { outcomeRef: row.outcome_ref }),
    counterexampleRefs: StringListSchema.parse(row.counterexample_refs),
    completeness: Number(row.completeness),
    inductionFingerprint: row.induction_fingerprint,
    episodeHash: row.episode_hash,
    sourceRefs: z.array(SourceRefSchema).parse(row.source_refs).map(normalizeSourceRef),
    createdAt: toIsoString(row.created_at),
  });
}

function episodeSnapshot(episode: PlanningInteractionEpisode) {
  return {
    ...(episode.initialUnderstanding === undefined
      ? {}
      : { initialUnderstanding: episode.initialUnderstanding }),
    ...(episode.initialGoalContract === undefined
      ? {}
      : { initialGoalContract: episode.initialGoalContract }),
    ...(episode.initialPlan === undefined ? {} : { initialPlan: episode.initialPlan }),
    ...(episode.acceptedGoalContract === undefined
      ? {}
      : { acceptedGoalContract: episode.acceptedGoalContract }),
    ...(episode.acceptedPlan === undefined ? {} : { acceptedPlan: episode.acceptedPlan }),
    turns: episode.turns,
    correctionIds: episode.correctionIds,
  };
}

function normalizeSourceRef(value: z.infer<typeof SourceRefSchema>) {
  return createCognitiveSourceRef({
    schemaVersion: value.schemaVersion,
    sourceRefId: value.sourceRefId,
    sourceKind: value.sourceKind,
    sourceId: value.sourceId,
    sourceRevision: value.sourceRevision,
    authority: value.authority,
    dataClassification: value.dataClassification,
    capturedAt: value.capturedAt,
    ...(value.contentHash === undefined ? {} : { contentHash: value.contentHash }),
  });
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
