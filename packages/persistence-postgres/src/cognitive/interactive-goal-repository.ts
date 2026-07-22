import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  InteractiveGoalMutation,
  InteractiveGoalMutationResult,
  InteractiveGoalRepository,
} from '../../../application/src/cognitive/index.js';
import {
  createCognitiveSourceRef,
  createGoalContractCandidateSnapshot,
  createInteractiveGoalSessionSnapshot,
  createInteractiveGoalTurn,
  type CognitiveSourceRef,
  type GoalContractCandidateSnapshot,
  type InteractiveGoalSessionSnapshot,
  type InteractiveGoalTurn,
} from '../../../domain/src/index.js';

interface SessionRow extends QueryResultRow {
  session_id: string;
  task_id: string;
  state: InteractiveGoalSessionSnapshot['state'];
  version: number;
  current_understanding_id: string;
  current_candidate_id: string | null;
  current_candidate_revision: number | null;
  clarification_rounds: number;
  revision_count: number;
  max_clarification_rounds: number;
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
  action: InteractiveGoalTurn['action'];
  actor_id: string;
  payload: unknown;
  binding: unknown;
  created_at: Date | string;
}

interface CandidateRow extends QueryResultRow {
  candidate_id: string;
  session_id: string;
  revision: number;
  status: GoalContractCandidateSnapshot['status'];
  contract: unknown;
  contract_hash: string;
  source_refs: unknown;
  diff: unknown;
  model_invocation_id: string;
  created_at: Date | string;
}

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

const ContractSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    constraints: z.array(z.string()),
    successCriteria: z.array(z.string()),
  })
  .strict();
const DiffSchema = z
  .object({
    baseRevision: z.number().int().positive().optional(),
    changedFields: z.array(z.enum(['title', 'description', 'constraints', 'successCriteria'])),
  })
  .strict();
const BindingSchema = z
  .object({
    understandingRevision: z.number().int().positive(),
    dimensionId: z.string().optional(),
    criterionId: z.string().optional(),
    blockingReason: z.string().optional(),
  })
  .strict();

export class PostgresInteractiveGoalRepository implements InteractiveGoalRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findByTask(taskId: string): Promise<InteractiveGoalSessionSnapshot | undefined> {
    return this.#findOne('WHERE task_id=$1', [taskId]);
  }

  async find(sessionId: string): Promise<InteractiveGoalSessionSnapshot | undefined> {
    return this.#findOne('WHERE session_id=$1', [sessionId]);
  }

  async listTurns(sessionId: string): Promise<readonly InteractiveGoalTurn[]> {
    const result = await this.#pool.query<TurnRow>(
      `SELECT turn_id,session_id,ordinal,expected_session_version,idempotency_key,
              action,actor_id,payload,binding,created_at
       FROM interactive_goal_turn WHERE session_id=$1 ORDER BY ordinal`,
      [sessionId],
    );
    return result.rows.map(mapTurn);
  }

  async listCandidates(sessionId: string): Promise<readonly GoalContractCandidateSnapshot[]> {
    const result = await this.#pool.query<CandidateRow>(
      `SELECT candidate_id,session_id,revision,status,contract,contract_hash,source_refs,
              diff,model_invocation_id,created_at
       FROM goal_contract_candidate WHERE session_id=$1 ORDER BY revision`,
      [sessionId],
    );
    return result.rows.map(mapCandidate);
  }

  async findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<InteractiveGoalTurn | undefined> {
    const result = await this.#pool.query<TurnRow>(
      `SELECT turn_id,session_id,ordinal,expected_session_version,idempotency_key,
              action,actor_id,payload,binding,created_at
       FROM interactive_goal_turn WHERE session_id=$1 AND idempotency_key=$2`,
      [sessionId, idempotencyKey],
    );
    return result.rows[0] === undefined ? undefined : mapTurn(result.rows[0]);
  }

  async start(
    session: InteractiveGoalSessionSnapshot,
    candidate?: GoalContractCandidateSnapshot,
  ): Promise<InteractiveGoalSessionSnapshot> {
    const snapshot = createInteractiveGoalSessionSnapshot(session);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:goal-session:' || $1))",
        [snapshot.taskId],
      );
      const existing = await findSessionRow(client, 'WHERE task_id=$1', [snapshot.taskId]);
      if (existing !== undefined) {
        await client.query('COMMIT');
        return mapSession(existing);
      }
      await insertSession(client, snapshot);
      if (candidate !== undefined) await upsertCandidate(client, candidate);
      await appendStartEvents(client, snapshot, candidate);
      await client.query('COMMIT');
      return snapshot;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async apply(mutation: InteractiveGoalMutation): Promise<InteractiveGoalMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sdar:v123:goal-session-id:' || $1))",
        [mutation.nextSession.sessionId],
      );
      const currentRow = await findSessionRow(client, 'WHERE session_id=$1', [
        mutation.nextSession.sessionId,
      ]);
      if (currentRow === undefined) throw new Error('INTERACTIVE_GOAL_SESSION_NOT_FOUND');
      const duplicate = await client.query<{ present: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM interactive_goal_turn WHERE session_id=$1 AND idempotency_key=$2
         ) AS present`,
        [mutation.nextSession.sessionId, mutation.idempotencyKey],
      );
      if (duplicate.rows[0]?.present === true) {
        const current = mapSession(currentRow);
        const candidate = await findCurrentCandidate(client, current);
        await client.query('COMMIT');
        return {
          outcome: 'duplicate',
          session: current,
          ...(candidate === undefined ? {} : { candidate }),
        };
      }
      if (currentRow.version !== mutation.expectedVersion) {
        const current = mapSession(currentRow);
        await client.query('COMMIT');
        return { outcome: 'conflict', session: current };
      }
      await insertTurn(client, mutation.turn);
      if (mutation.candidate !== undefined) await upsertCandidate(client, mutation.candidate);
      const updated = await client.query(
        `UPDATE interactive_goal_session SET
           state=$2,version=$3,current_understanding_id=$4,current_candidate_id=$5,
           current_candidate_revision=$6,clarification_rounds=$7,revision_count=$8,updated_at=$9
         WHERE session_id=$1 AND version=$10`,
        [
          mutation.nextSession.sessionId,
          mutation.nextSession.state,
          mutation.nextSession.version,
          mutation.nextSession.currentUnderstandingId,
          mutation.nextSession.currentCandidateId ?? null,
          mutation.nextSession.currentCandidateRevision ?? null,
          mutation.nextSession.clarificationRounds,
          mutation.nextSession.revisionCount,
          mutation.nextSession.updatedAt,
          mutation.expectedVersion,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('INTERACTIVE_GOAL_SESSION_CAS_FAILED');
      await appendMutationEvents(client, mutation);
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
  ): Promise<InteractiveGoalSessionSnapshot | undefined> {
    const row = await findSessionRow(this.#pool, where, parameters);
    return row === undefined ? undefined : mapSession(row);
  }
}

async function insertSession(client: PoolClient, session: InteractiveGoalSessionSnapshot) {
  await client.query(
    `INSERT INTO interactive_goal_session(
       session_id,task_id,state,version,current_understanding_id,current_candidate_id,
       current_candidate_revision,clarification_rounds,revision_count,max_clarification_rounds,
       max_revisions,max_elapsed_ms,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      session.sessionId,
      session.taskId,
      session.state,
      session.version,
      session.currentUnderstandingId,
      session.currentCandidateId ?? null,
      session.currentCandidateRevision ?? null,
      session.clarificationRounds,
      session.revisionCount,
      session.maxClarificationRounds,
      session.maxRevisions,
      session.maxElapsedMs,
      session.createdAt,
      session.updatedAt,
    ],
  );
}

async function insertTurn(client: PoolClient, turn: InteractiveGoalTurn) {
  const snapshot = createInteractiveGoalTurn(turn);
  await client.query(
    `INSERT INTO interactive_goal_turn(
       turn_id,session_id,ordinal,expected_session_version,idempotency_key,
       action,actor_id,payload,binding,created_at
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
      JSON.stringify(snapshot.binding),
      snapshot.createdAt,
    ],
  );
}

async function upsertCandidate(client: PoolClient, candidate: GoalContractCandidateSnapshot) {
  const snapshot = createGoalContractCandidateSnapshot(candidate);
  const existing = await client.query<{ present: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM goal_contract_candidate WHERE candidate_id=$1) AS present',
    [snapshot.candidateId],
  );
  if (existing.rows[0]?.present === true) {
    await client.query('UPDATE goal_contract_candidate SET status=$2 WHERE candidate_id=$1', [
      snapshot.candidateId,
      snapshot.status,
    ]);
    return;
  }
  if (snapshot.status === 'candidate') {
    await client.query(
      "UPDATE goal_contract_candidate SET status='superseded' WHERE session_id=$1 AND status='candidate'",
      [snapshot.sessionId],
    );
  }
  await client.query(
    `INSERT INTO goal_contract_candidate(
       candidate_id,session_id,revision,status,contract,contract_hash,source_refs,diff,
       model_invocation_id,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      snapshot.candidateId,
      snapshot.sessionId,
      snapshot.revision,
      snapshot.status,
      JSON.stringify(snapshot.contract),
      snapshot.contractHash,
      JSON.stringify(snapshot.sourceRefs),
      JSON.stringify(snapshot.diff),
      snapshot.modelInvocationId,
      snapshot.createdAt,
    ],
  );
}

async function appendStartEvents(
  client: PoolClient,
  session: InteractiveGoalSessionSnapshot,
  candidate?: GoalContractCandidateSnapshot,
) {
  if (session.state === 'understand') {
    await appendEvent(client, 'task.clarification_requested', session, 'start', {
      understandingId: session.currentUnderstandingId,
    });
  }
  if (candidate !== undefined) {
    await appendEvent(client, 'goal.contract_candidate_created', session, 'start', {
      candidateId: candidate.candidateId,
      candidateRevision: candidate.revision,
      contractHash: candidate.contractHash,
    });
  }
}

async function appendMutationEvents(client: PoolClient, mutation: InteractiveGoalMutation) {
  const action = mutation.turn.action;
  if (action === 'answer' || action === 'restart_understanding') {
    await appendEvent(
      client,
      'task.clarification_answered',
      mutation.nextSession,
      mutation.turn.turnId,
      {
        understandingId: mutation.nextSession.currentUnderstandingId,
        dimensionId: mutation.turn.binding.dimensionId ?? null,
      },
    );
  }
  if (mutation.nextSession.state === 'understand') {
    await appendEvent(
      client,
      'task.clarification_requested',
      mutation.nextSession,
      mutation.turn.turnId,
      {
        understandingId: mutation.nextSession.currentUnderstandingId,
      },
    );
  }
  if (mutation.candidate?.status === 'candidate') {
    await appendEvent(
      client,
      'goal.contract_candidate_created',
      mutation.nextSession,
      mutation.turn.turnId,
      {
        candidateId: mutation.candidate.candidateId,
        candidateRevision: mutation.candidate.revision,
        contractHash: mutation.candidate.contractHash,
      },
    );
  }
  if (mutation.candidate?.status === 'confirmed') {
    await appendEvent(
      client,
      'goal.contract_confirmed',
      mutation.nextSession,
      mutation.turn.turnId,
      {
        candidateId: mutation.candidate.candidateId,
        candidateRevision: mutation.candidate.revision,
        contractHash: mutation.candidate.contractHash,
        actorId: mutation.turn.actorId,
      },
    );
  }
}

async function appendEvent(
  client: PoolClient,
  eventType:
    | 'task.clarification_requested'
    | 'task.clarification_answered'
    | 'goal.contract_candidate_created'
    | 'goal.contract_confirmed',
  session: InteractiveGoalSessionSnapshot,
  suffix: string,
  payload: Readonly<Record<string, unknown>>,
) {
  const eventId = `${eventType}:${session.sessionId}:${suffix}`;
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at
     ) VALUES ($1,$2,'interactive_goal_session',$3,$4,$5,$6,$7)`,
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

async function findSessionRow(
  queryable: Pick<Pool, 'query'>,
  where: string,
  parameters: readonly unknown[],
): Promise<SessionRow | undefined> {
  const result = await queryable.query<SessionRow>(
    `SELECT session_id,task_id,state,version,current_understanding_id,current_candidate_id,
            current_candidate_revision,clarification_rounds,revision_count,max_clarification_rounds,
            max_revisions,max_elapsed_ms,created_at,updated_at
     FROM interactive_goal_session ${where} LIMIT 1`,
    [...parameters],
  );
  return result.rows[0];
}

async function findCurrentCandidate(
  client: PoolClient,
  session: InteractiveGoalSessionSnapshot,
): Promise<GoalContractCandidateSnapshot | undefined> {
  if (session.currentCandidateId === undefined) return undefined;
  const result = await client.query<CandidateRow>(
    `SELECT candidate_id,session_id,revision,status,contract,contract_hash,source_refs,
            diff,model_invocation_id,created_at
     FROM goal_contract_candidate WHERE candidate_id=$1`,
    [session.currentCandidateId],
  );
  return result.rows[0] === undefined ? undefined : mapCandidate(result.rows[0]);
}

function mapSession(row: SessionRow): InteractiveGoalSessionSnapshot {
  return createInteractiveGoalSessionSnapshot({
    schemaVersion: '1.0',
    sessionId: row.session_id,
    taskId: row.task_id,
    state: row.state,
    version: row.version,
    currentUnderstandingId: row.current_understanding_id,
    ...(row.current_candidate_id === null
      ? {}
      : {
          currentCandidateId: row.current_candidate_id,
          currentCandidateRevision: row.current_candidate_revision ?? 0,
        }),
    clarificationRounds: row.clarification_rounds,
    revisionCount: row.revision_count,
    maxClarificationRounds: row.max_clarification_rounds,
    maxRevisions: row.max_revisions,
    maxElapsedMs: row.max_elapsed_ms,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  });
}

function mapTurn(row: TurnRow): InteractiveGoalTurn {
  const binding = BindingSchema.parse(row.binding);
  return createInteractiveGoalTurn({
    turnId: row.turn_id,
    sessionId: row.session_id,
    ordinal: row.ordinal,
    expectedSessionVersion: row.expected_session_version,
    idempotencyKey: row.idempotency_key,
    action: row.action,
    actorId: row.actor_id,
    payload: z.record(z.string(), z.unknown()).parse(row.payload),
    binding: normalizeBinding(binding),
    createdAt: toIsoString(row.created_at),
  });
}

function mapCandidate(row: CandidateRow): GoalContractCandidateSnapshot {
  const diff = DiffSchema.parse(row.diff);
  return createGoalContractCandidateSnapshot({
    schemaVersion: '1.0',
    candidateId: row.candidate_id,
    sessionId: row.session_id,
    revision: row.revision,
    status: row.status,
    contract: ContractSchema.parse(row.contract),
    contractHash: row.contract_hash,
    sourceRefs: z.array(SourceRefSchema).parse(row.source_refs).map(normalizeSourceRef),
    modelInvocationId: row.model_invocation_id,
    diff: {
      ...(diff.baseRevision === undefined ? {} : { baseRevision: diff.baseRevision }),
      changedFields: diff.changedFields,
    },
    createdAt: toIsoString(row.created_at),
  });
}

function normalizeBinding(value: z.infer<typeof BindingSchema>) {
  return {
    understandingRevision: value.understandingRevision,
    ...(value.dimensionId === undefined ? {} : { dimensionId: value.dimensionId }),
    ...(value.criterionId === undefined ? {} : { criterionId: value.criterionId }),
    ...(value.blockingReason === undefined ? {} : { blockingReason: value.blockingReason }),
  };
}

function normalizeSourceRef(value: z.infer<typeof SourceRefSchema>): CognitiveSourceRef {
  return createCognitiveSourceRef(
    value.contentHash === undefined
      ? {
          schemaVersion: value.schemaVersion,
          sourceRefId: value.sourceRefId,
          sourceKind: value.sourceKind,
          sourceId: value.sourceId,
          sourceRevision: value.sourceRevision,
          authority: value.authority,
          dataClassification: value.dataClassification,
          capturedAt: value.capturedAt,
        }
      : { ...value, contentHash: value.contentHash },
  );
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
