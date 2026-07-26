import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  InteractivePlanningMutation,
  InteractivePlanningMutationResult,
  InteractivePlanningRepository,
} from '../../../application/src/cognitive/index.js';
import {
  createCognitiveSourceRef,
  createExperienceUsageRecord,
  createInteractivePlanningSessionSnapshot,
  createInteractivePlanningTurn,
  createUserGoalPlan,
  createUserGoalPlanCandidateSnapshot,
  type CognitiveSourceRef,
  type ExperienceUsageRecord,
  type InteractivePlanningSessionSnapshot,
  type InteractivePlanningTurn,
  type UserGoalPlan,
  type UserGoalPlanCandidateSnapshot,
} from '../../../domain/src/index.js';

interface SessionRow extends QueryResultRow {
  session_id: string;
  task_id: string;
  goal_session_id: string;
  confirmed_contract_candidate_id: string;
  goal_id: string;
  goal_version: number;
  state: InteractivePlanningSessionSnapshot['state'];
  version: number;
  current_candidate_id: string;
  current_candidate_revision: number;
  revision_count: number;
  max_revisions: number;
  max_elapsed_ms: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TurnRow extends QueryResultRow {
  turn_id: string;
  session_id: string;
  ordinal: number;
  expected_session_version: number;
  idempotency_key: string;
  action: InteractivePlanningTurn['action'];
  actor_id: string;
  payload: unknown;
  compiled_patch: unknown;
  created_at: Date | string;
}

interface CandidateRow extends QueryResultRow {
  candidate_id: string;
  session_id: string;
  revision: number;
  status: UserGoalPlanCandidateSnapshot['status'];
  base_plan_id: string | null;
  plan: unknown;
  plan_hash: string;
  validation: unknown;
  diff: unknown;
  experience_hints: unknown;
  confirmation_policy: UserGoalPlanCandidateSnapshot['confirmationPolicy'];
  risk_level: UserGoalPlanCandidateSnapshot['riskLevel'];
  planning_metadata: unknown;
  source_refs: unknown;
  patch_model_invocation_id: string | null;
  created_at: Date | string;
}

const StringListSchema = z.array(z.string());
const SkillGoalSchema = z
  .object({
    skillGoalId: z.string(),
    requiredResult: z.string(),
    capabilityNeeds: StringListSchema,
    coveredCriterionIds: StringListSchema,
    requiredEffectRefs: StringListSchema,
    evidenceRequirements: StringListSchema,
    artifactRequirements: StringListSchema,
    assumptions: StringListSchema,
    constraints: StringListSchema,
    status: z.enum([
      'pending',
      'ready',
      'dispatch_intent',
      'selecting',
      'executing',
      'judging',
      'achieved',
      'partially_achieved',
      'failed',
      'blocked',
      'superseded',
      'canceled',
    ]),
  })
  .strict();
const DependencySchema = z
  .object({
    dependencyId: z.string(),
    predecessorSkillGoalId: z.string(),
    successorSkillGoalId: z.string(),
    predicate: z.enum(['required', 'optional']),
  })
  .strict();
const PlanSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    planId: z.string(),
    goalId: z.string(),
    goalVersion: z.number().int().positive(),
    revision: z.number().int().positive(),
    revisionKind: z.enum(['initial', 'goal_patch', 'user_revision', 'recovery', 'event_impact']),
    sourcePlanId: z.string().optional(),
    status: z.enum([
      'planning',
      'validated',
      'active',
      'revision_pending',
      'superseded',
      'completed',
      'failed',
      'canceled',
    ]),
    contractHash: z.string(),
    contentHash: z.string(),
    skillGoals: z.array(SkillGoalSchema),
    dependencies: z.array(DependencySchema),
    inheritedCompletedEffectIds: StringListSchema,
    forbiddenReplayFingerprints: StringListSchema,
    createdAt: z.string(),
  })
  .strict();
const ValidationSchema = z
  .object({
    valid: z.boolean(),
    errorCodes: StringListSchema,
    checks: z.array(
      z
        .object({
          check: z.enum([
            'dag',
            'bounds',
            'coverage',
            'capability_shape',
            'policy',
            'side_effect',
            'no_replay',
          ]),
          passed: z.boolean(),
          errorCode: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const DiffSchema = z
  .object({
    changedFields: z.array(
      z.enum(['skillGoals', 'dependencies', 'confirmationPolicy', 'planningMetadata']),
    ),
    addedSkillGoalIds: StringListSchema,
    removedSkillGoalIds: StringListSchema,
  })
  .strict();
const PlanningMetadataSchema = z
  .object({
    priorities: z.record(z.string(), z.number().int()),
    parallelGroups: z.record(z.string(), StringListSchema),
  })
  .strict();
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

export class PostgresInteractivePlanningRepository implements InteractivePlanningRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findByTask(taskId: string): Promise<InteractivePlanningSessionSnapshot | undefined> {
    return this.#findOne('WHERE task_id=$1', [taskId]);
  }

  async find(sessionId: string): Promise<InteractivePlanningSessionSnapshot | undefined> {
    return this.#findOne('WHERE session_id=$1', [sessionId]);
  }

  async listTurns(sessionId: string): Promise<readonly InteractivePlanningTurn[]> {
    const result = await this.#pool.query<TurnRow>(
      `SELECT turn_id,session_id,ordinal,expected_session_version,idempotency_key,
              action,actor_id,payload,compiled_patch,created_at
       FROM interactive_planning_turn WHERE session_id=$1 ORDER BY ordinal`,
      [sessionId],
    );
    return result.rows.map(mapTurn);
  }

  async listCandidates(
    sessionId: string,
  ): Promise<readonly UserGoalPlanCandidateSnapshot<UserGoalPlan>[]> {
    const result = await this.#pool.query<CandidateRow>(candidateSelect('WHERE session_id=$1'), [
      sessionId,
    ]);
    return result.rows.map(mapCandidate);
  }

  async findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<InteractivePlanningTurn | undefined> {
    const result = await this.#pool.query<TurnRow>(
      `SELECT turn_id,session_id,ordinal,expected_session_version,idempotency_key,
              action,actor_id,payload,compiled_patch,created_at
       FROM interactive_planning_turn WHERE session_id=$1 AND idempotency_key=$2`,
      [sessionId, idempotencyKey],
    );
    return result.rows[0] === undefined ? undefined : mapTurn(result.rows[0]);
  }

  async start(
    session: InteractivePlanningSessionSnapshot,
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
  ): Promise<InteractivePlanningSessionSnapshot> {
    return this.#start(session, candidate, []);
  }

  async saveWithPlanCandidate(
    session: InteractivePlanningSessionSnapshot,
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
    usageRecords: readonly ExperienceUsageRecord[],
  ): Promise<InteractivePlanningSessionSnapshot> {
    return this.#start(session, candidate, usageRecords.map(createExperienceUsageRecord));
  }

  async #start(
    session: InteractivePlanningSessionSnapshot,
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
    usageRecords: readonly ExperienceUsageRecord[],
  ): Promise<InteractivePlanningSessionSnapshot> {
    const snapshot = createInteractivePlanningSessionSnapshot(session);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:planning-session:' || $1))",
        [snapshot.taskId],
      );
      const existing = await findSessionRow(client, 'WHERE task_id=$1', [snapshot.taskId]);
      if (existing !== undefined) {
        await client.query('COMMIT');
        return mapSession(existing);
      }
      await insertSession(client, snapshot);
      await upsertCandidate(client, candidate);
      for (const usage of usageRecords) {
        if (
          usage.planningSessionId !== snapshot.sessionId ||
          usage.planCandidateId !== candidate.candidateId
        ) {
          throw new Error('EXPERIENCE_USAGE_PLAN_CANDIDATE_BINDING_INVALID');
        }
        await insertExperienceUsage(client, usage, candidate.validation);
      }
      await appendEvent(client, 'plan.candidate_created', snapshot, 'start', {
        candidateId: candidate.candidateId,
        planHash: candidate.planHash,
      });
      if (candidate.status === 'confirmed')
        await appendEvent(client, 'plan.confirmed', snapshot, 'auto', {
          candidateId: candidate.candidateId,
          planHash: candidate.planHash,
        });
      await client.query('COMMIT');
      return snapshot;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async apply(mutation: InteractivePlanningMutation): Promise<InteractivePlanningMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:planning-session-id:' || $1))",
        [mutation.nextSession.sessionId],
      );
      const currentRow = await findSessionRow(client, 'WHERE session_id=$1', [
        mutation.nextSession.sessionId,
      ]);
      if (currentRow === undefined) throw new Error('INTERACTIVE_PLANNING_SESSION_NOT_FOUND');
      const duplicate = await client.query<{ present: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM interactive_planning_turn
                       WHERE session_id=$1 AND idempotency_key=$2) AS present`,
        [mutation.nextSession.sessionId, mutation.idempotencyKey],
      );
      if (duplicate.rows[0]?.present === true) {
        const current = mapSession(currentRow);
        const candidate = await findCurrentCandidate(client, current.currentCandidateId);
        await client.query('COMMIT');
        return { outcome: 'duplicate', session: current, candidate };
      }
      if (currentRow.version !== mutation.expectedVersion) {
        await client.query('COMMIT');
        return { outcome: 'conflict', session: mapSession(currentRow) };
      }
      await insertTurn(client, mutation.turn);
      if (mutation.candidate !== undefined) await upsertCandidate(client, mutation.candidate);
      const updated = await client.query(
        `UPDATE interactive_planning_session SET
           state=$2,version=$3,current_candidate_id=$4,current_candidate_revision=$5,
           revision_count=$6,updated_at=$7
         WHERE session_id=$1 AND version=$8`,
        [
          mutation.nextSession.sessionId,
          mutation.nextSession.state,
          mutation.nextSession.version,
          mutation.nextSession.currentCandidateId,
          mutation.nextSession.currentCandidateRevision,
          mutation.nextSession.revisionCount,
          mutation.nextSession.updatedAt,
          mutation.expectedVersion,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('INTERACTIVE_PLANNING_SESSION_CAS_FAILED');
      await client.query(
        `UPDATE experience_usage_record AS usage
         SET user_action=$2,validator_result=candidate.validation
         FROM user_goal_plan_candidate AS candidate
         WHERE usage.plan_candidate_id=$1
           AND candidate.candidate_id=usage.plan_candidate_id`,
        [currentRow.current_candidate_id, experienceUserAction(mutation.turn.action)],
      );
      if (mutation.turn.action === 'patch' && mutation.candidate !== undefined)
        await appendEvent(client, 'plan.revised', mutation.nextSession, mutation.turn.turnId, {
          candidateId: mutation.candidate.candidateId,
          planHash: mutation.candidate.planHash,
        });
      if (mutation.candidate?.status === 'confirmed')
        await appendEvent(client, 'plan.confirmed', mutation.nextSession, mutation.turn.turnId, {
          candidateId: mutation.candidate.candidateId,
          planHash: mutation.candidate.planHash,
          actorId: mutation.turn.actorId,
        });
      await client.query('COMMIT');
      return {
        outcome: 'applied',
        session: mutation.nextSession,
        ...(mutation.candidate === undefined ? {} : { candidate: mutation.candidate }),
      };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async #findOne(
    where: string,
    parameters: readonly unknown[],
  ): Promise<InteractivePlanningSessionSnapshot | undefined> {
    const row = await findSessionRow(this.#pool, where, parameters);
    return row === undefined ? undefined : mapSession(row);
  }
}

async function insertSession(client: PoolClient, session: InteractivePlanningSessionSnapshot) {
  await client.query(
    `INSERT INTO interactive_planning_session(
       session_id,task_id,goal_session_id,confirmed_contract_candidate_id,goal_id,goal_version,
       state,version,current_candidate_id,current_candidate_revision,revision_count,max_revisions,
       max_elapsed_ms,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      session.sessionId,
      session.taskId,
      session.goalSessionId,
      session.confirmedContractCandidateId,
      session.goalId,
      session.goalVersion,
      session.state,
      session.version,
      session.currentCandidateId,
      session.currentCandidateRevision,
      session.revisionCount,
      session.maxRevisions,
      session.maxElapsedMs,
      session.createdAt,
      session.updatedAt,
    ],
  );
}

async function insertTurn(client: PoolClient, turn: InteractivePlanningTurn) {
  const snapshot = createInteractivePlanningTurn(turn);
  await client.query(
    `INSERT INTO interactive_planning_turn(
       turn_id,session_id,ordinal,expected_session_version,idempotency_key,
       action,actor_id,payload,compiled_patch,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      snapshot.turnId,
      snapshot.sessionId,
      snapshot.ordinal,
      snapshot.expectedSessionVersion,
      snapshot.idempotencyKey,
      snapshot.action,
      snapshot.actorId,
      JSON.stringify(snapshot.payload),
      snapshot.compiledPatch === undefined ? null : JSON.stringify(snapshot.compiledPatch),
      snapshot.createdAt,
    ],
  );
}

async function upsertCandidate(
  client: PoolClient,
  candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
) {
  const snapshot = createUserGoalPlanCandidateSnapshot(candidate);
  const existing = await client.query<{ plan_hash: string }>(
    'SELECT plan_hash FROM user_goal_plan_candidate WHERE candidate_id=$1',
    [snapshot.candidateId],
  );
  const existingHash = existing.rows[0]?.plan_hash;
  if (existingHash !== undefined) {
    if (existingHash !== snapshot.planHash)
      throw new Error('INTERACTIVE_PLANNING_CANDIDATE_ID_COLLISION');
    await client.query('UPDATE user_goal_plan_candidate SET status=$2 WHERE candidate_id=$1', [
      snapshot.candidateId,
      snapshot.status,
    ]);
    return;
  }
  await client.query(
    "UPDATE user_goal_plan_candidate SET status='superseded' WHERE session_id=$1 AND status='candidate'",
    [snapshot.sessionId],
  );
  await client.query(
    `INSERT INTO user_goal_plan_candidate(
       candidate_id,session_id,revision,status,base_plan_id,plan,plan_hash,validation,diff,
       experience_hints,confirmation_policy,risk_level,planning_metadata,source_refs,
       patch_model_invocation_id,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      snapshot.candidateId,
      snapshot.sessionId,
      snapshot.revision,
      snapshot.status,
      snapshot.basePlanId ?? null,
      JSON.stringify(snapshot.plan),
      snapshot.planHash,
      JSON.stringify(snapshot.validation),
      JSON.stringify(snapshot.diff),
      JSON.stringify(snapshot.experienceHints),
      snapshot.confirmationPolicy,
      snapshot.riskLevel,
      JSON.stringify(snapshot.planningMetadata),
      JSON.stringify(snapshot.sourceRefs),
      snapshot.patchModelInvocationId ?? null,
      snapshot.createdAt,
    ],
  );
}

async function insertExperienceUsage(
  client: PoolClient,
  input: ExperienceUsageRecord,
  validatorResult: UserGoalPlanCandidateSnapshot<UserGoalPlan>['validation'],
): Promise<void> {
  const result = await client.query(
    `INSERT INTO experience_usage_record(
       usage_id,planning_session_id,plan_candidate_id,knowledge_kind,knowledge_id,
       knowledge_revision,injection_mode,influence,user_action,validator_result,
       final_outcome_ref,created_at,authoritative_ref,query_fingerprint,retrieval_rank,
       affected_skill_goal_ids)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NULL,$9::jsonb,NULL,$10,$11,$12,$13,$14::jsonb)
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
      JSON.stringify(validatorResult),
      input.createdAt,
      input.authoritativeRef,
      input.queryFingerprint,
      input.retrievalRank,
      JSON.stringify(input.affectedSkillGoalIds),
    ],
  );
  if (result.rowCount !== 1) return;
  await client.query(
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

async function appendEvent(
  client: PoolClient,
  eventType: 'plan.candidate_created' | 'plan.revised' | 'plan.confirmed',
  session: InteractivePlanningSessionSnapshot,
  suffix: string,
  payload: Readonly<Record<string, unknown>>,
) {
  const eventId = `${eventType}:${session.sessionId}:${suffix}`;
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at
     ) VALUES ($1,$2,'interactive_planning_session',$3,$4,$5,$6,$7)`,
    [
      eventId,
      eventType,
      session.sessionId,
      session.version,
      JSON.stringify({ correlationId: eventId, taskId: session.taskId }),
      JSON.stringify(payload),
      session.updatedAt,
    ],
  );
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function experienceUserAction(
  action: InteractivePlanningTurn['action'],
): 'accepted' | 'rejected' | 'patched' | 'canceled' {
  if (action === 'accept') return 'accepted';
  if (action === 'reject') return 'rejected';
  if (action === 'patch') return 'patched';
  return 'canceled';
}

async function findSessionRow(
  queryable: Pick<Pool, 'query'>,
  where: string,
  parameters: readonly unknown[],
): Promise<SessionRow | undefined> {
  const result = await queryable.query<SessionRow>(
    `SELECT session_id,task_id,goal_session_id,confirmed_contract_candidate_id,goal_id,goal_version,
            state,version,current_candidate_id,current_candidate_revision,revision_count,max_revisions,
            max_elapsed_ms,created_at,updated_at
     FROM interactive_planning_session ${where} LIMIT 1`,
    [...parameters],
  );
  return result.rows[0];
}

async function findCurrentCandidate(
  client: PoolClient,
  candidateId: string,
): Promise<UserGoalPlanCandidateSnapshot<UserGoalPlan>> {
  const result = await client.query<CandidateRow>(candidateSelect('WHERE candidate_id=$1'), [
    candidateId,
  ]);
  if (result.rows[0] === undefined) throw new Error('INTERACTIVE_PLANNING_CANDIDATE_NOT_FOUND');
  return mapCandidate(result.rows[0]);
}

function candidateSelect(where: string): string {
  return `SELECT candidate_id,session_id,revision,status,base_plan_id,plan,plan_hash,validation,
                 diff,experience_hints,confirmation_policy,risk_level,planning_metadata,source_refs,
                 patch_model_invocation_id,created_at
          FROM user_goal_plan_candidate ${where} ORDER BY revision`;
}

function mapSession(row: SessionRow): InteractivePlanningSessionSnapshot {
  return createInteractivePlanningSessionSnapshot({
    schemaVersion: '1.0',
    sessionId: row.session_id,
    taskId: row.task_id,
    goalSessionId: row.goal_session_id,
    confirmedContractCandidateId: row.confirmed_contract_candidate_id,
    goalId: row.goal_id,
    goalVersion: row.goal_version,
    state: row.state,
    version: row.version,
    currentCandidateId: row.current_candidate_id,
    currentCandidateRevision: row.current_candidate_revision,
    revisionCount: row.revision_count,
    maxRevisions: row.max_revisions,
    maxElapsedMs: row.max_elapsed_ms,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  });
}

function mapTurn(row: TurnRow): InteractivePlanningTurn {
  return createInteractivePlanningTurn({
    turnId: row.turn_id,
    sessionId: row.session_id,
    ordinal: row.ordinal,
    expectedSessionVersion: row.expected_session_version,
    idempotencyKey: row.idempotency_key,
    action: row.action,
    actorId: row.actor_id,
    payload: z.record(z.string(), z.unknown()).parse(row.payload),
    ...(row.compiled_patch === null ? {} : { compiledPatch: row.compiled_patch }),
    createdAt: toIsoString(row.created_at),
  });
}

function mapCandidate(row: CandidateRow): UserGoalPlanCandidateSnapshot<UserGoalPlan> {
  const parsedPlan = PlanSchema.parse(row.plan);
  return createUserGoalPlanCandidateSnapshot({
    schemaVersion: '1.0',
    candidateId: row.candidate_id,
    sessionId: row.session_id,
    revision: row.revision,
    status: row.status,
    ...(row.base_plan_id === null ? {} : { basePlanId: row.base_plan_id }),
    plan: createUserGoalPlan(parsedPlan as UserGoalPlan),
    planHash: row.plan_hash,
    validation: normalizeValidation(ValidationSchema.parse(row.validation)),
    diff: DiffSchema.parse(row.diff),
    experienceHints: StringListSchema.parse(row.experience_hints),
    confirmationPolicy: row.confirmation_policy,
    riskLevel: row.risk_level,
    planningMetadata: PlanningMetadataSchema.parse(row.planning_metadata),
    sourceRefs: z.array(SourceRefSchema).parse(row.source_refs).map(normalizeSourceRef),
    ...(row.patch_model_invocation_id === null
      ? {}
      : { patchModelInvocationId: row.patch_model_invocation_id }),
    createdAt: toIsoString(row.created_at),
  });
}

function normalizeSourceRef(value: z.infer<typeof SourceRefSchema>): CognitiveSourceRef {
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

function normalizeValidation(value: z.infer<typeof ValidationSchema>) {
  return {
    valid: value.valid,
    errorCodes: value.errorCodes,
    checks: value.checks.map((check) => ({
      check: check.check,
      passed: check.passed,
      ...(check.errorCode === undefined ? {} : { errorCode: check.errorCode }),
    })),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
