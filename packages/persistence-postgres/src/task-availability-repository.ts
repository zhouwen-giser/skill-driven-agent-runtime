import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import type {
  DslExecutionReadiness,
  DslRiskDecision,
  TaskAvailabilityCheckResult,
  TaskAvailabilitySnapshot,
} from '../../domain/src/index.js';
import type { TaskAvailabilityEvidenceRepository } from '../../application/src/index.js';

interface ReadinessRow extends QueryResultRow {
  readiness_id: string;
  workflow_plan_id: string;
  plan_attempt: number;
  check_phase: DslExecutionReadiness['checkPhase'];
  workflow_instance_id: string | null;
  workflow_node_run_id: string | null;
  dsl_hash: string;
  disposition: DslExecutionReadiness['disposition'];
  permitted_actions_json: unknown;
  model_decision_json: unknown;
  guard_action: DslExecutionReadiness['guardAction'];
  guard_reason_codes_json: unknown;
  confirmation_required: boolean;
  created_at: Date | string;
}

interface SnapshotRow extends QueryResultRow {
  snapshot_id: string;
  readiness_id: string;
  node_id: string;
  server_id: string;
  operation_name: string;
  arguments_snapshot_json: unknown;
  arguments_hash: string;
  timing_snapshot_json: unknown;
  result_json: unknown;
  source_revision: string;
  checked_at: Date | string;
  normalization_reason_codes_json: unknown;
}

const StringArray = z.array(z.string());
const RiskDecisionSchema: z.ZodType<DslRiskDecision> = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('proceed'), acceptedRiskNodeIds: StringArray, summary: z.string() })
    .strict(),
  z
    .object({
      action: z.literal('reschedule'),
      nodeId: z.string(),
      selectedStartTime: z.string(),
      summary: z.string(),
    })
    .strict(),
  z.object({ action: z.literal('revise_dsl'), summary: z.string() }).strict(),
  z
    .object({
      action: z.literal('request_confirmation'),
      riskNodeIds: StringArray,
      summary: z.string(),
    })
    .strict(),
  z.object({ action: z.literal('abort'), summary: z.string() }).strict(),
]);
const ArgumentsSchema = z.discriminatedUnion('unresolved', [
  z.object({ unresolved: z.literal(false), value: z.record(z.string(), z.unknown()) }).strict(),
  z
    .object({
      unresolved: z.literal(true),
      knownArguments: z.record(z.string(), z.unknown()),
      unresolvedPaths: StringArray,
    })
    .strict(),
]);
const TimingSchema = z
  .object({
    start: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('immediate'), startToleranceMs: z.number() }).strict(),
      z
        .object({
          mode: z.literal('scheduled'),
          scheduledAt: z.string(),
          startToleranceMs: z.number(),
        })
        .strict(),
    ]),
    maxElapsedMs: z.number().nullable(),
  })
  .strict();
const AvailabilityResultSchema: z.ZodType<TaskAvailabilityCheckResult> = z
  .object({
    nodeId: z.string(),
    operationName: z.string(),
    availability: z.enum(['available', 'restricted', 'disabled', 'unknown']),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    reasonCode: z.string().optional(),
    description: z.string().optional(),
    validUntil: z.string().optional(),
    earliestStartTime: z.string().optional(),
    nextAvailableWindows: z.array(
      z.object({ startTime: z.string(), endTime: z.string() }).strict(),
    ),
    estimatedDelayMs: z.number().optional(),
    reservationMode: z.enum(['none', 'best_effort', 'guaranteed']),
    reservationRef: z.string().optional(),
    possibleEffects: z.array(
      z.enum([
        'task_preemption',
        'task_pause',
        'start_rejection',
        'start_window_missed',
        'deadline_reached',
        'partial_completion',
      ]),
    ),
  })
  .strict();

export class PostgresTaskAvailabilityEvidenceRepository implements TaskAvailabilityEvidenceRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveEvaluation(
    readiness: DslExecutionReadiness,
    snapshots: readonly TaskAvailabilitySnapshot[],
  ): Promise<void> {
    if (snapshots.some((snapshot) => snapshot.readinessId !== readiness.readinessId))
      throw new TaskAvailabilityPersistenceError(
        'TASK_READINESS_EVIDENCE_MISMATCH',
        'Every snapshot must belong to the saved readiness.',
      );
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO task_execution_readiness
           (readiness_id,workflow_plan_id,plan_attempt,check_phase,workflow_instance_id,
            workflow_node_run_id,dsl_hash,disposition,permitted_actions_json,
            model_decision_json,guard_action,guard_reason_codes_json,confirmation_required,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14)`,
        [
          readiness.readinessId,
          readiness.workflowPlanId,
          readiness.planAttempt,
          readiness.checkPhase,
          readiness.workflowInstanceId ?? null,
          readiness.workflowNodeRunId ?? null,
          readiness.dslHash,
          readiness.disposition,
          JSON.stringify(readiness.permittedActions),
          readiness.modelDecision === undefined ? null : JSON.stringify(readiness.modelDecision),
          readiness.guardAction,
          JSON.stringify(readiness.guardReasonCodes),
          readiness.confirmationRequired,
          readiness.createdAt,
        ],
      );
      for (const snapshot of snapshots)
        await client.query(
          `INSERT INTO task_availability_snapshot
             (snapshot_id,readiness_id,node_id,server_id,operation_name,arguments_snapshot_json,
              arguments_hash,timing_snapshot_json,result_json,availability,risk_level,
              reservation_mode,reservation_ref,valid_until,source_revision,checked_at,
              normalization_reason_codes_json)
           VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
          [
            snapshot.snapshotId,
            snapshot.readinessId,
            snapshot.nodeId,
            snapshot.serverId,
            snapshot.operationName,
            JSON.stringify(snapshot.arguments),
            snapshot.argumentsHash,
            snapshot.timing === undefined ? null : JSON.stringify(snapshot.timing),
            JSON.stringify(snapshot.result),
            snapshot.result.availability,
            snapshot.result.riskLevel,
            snapshot.result.reservationMode,
            snapshot.result.reservationRef ?? null,
            snapshot.result.validUntil ?? null,
            snapshot.sourceRevision,
            snapshot.checkedAt,
            JSON.stringify(snapshot.normalizationReasonCodes),
          ],
        );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isPgUniqueViolation(error))
        throw new TaskAvailabilityPersistenceError(
          'TASK_READINESS_EVIDENCE_CONFLICT',
          'Readiness evidence is append-only and the supplied identity already exists.',
        );
      throw error;
    } finally {
      client.release();
    }
  }

  async listByPlan(
    planId: string,
    filter: Readonly<{ phase?: DslExecutionReadiness['checkPhase']; limit?: number }> = {},
  ) {
    const limit = filter.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new TaskAvailabilityPersistenceError(
        'TASK_READINESS_QUERY_INVALID',
        'Readiness query limit must be an integer between 1 and 1000.',
      );
    const readinessResult = await this.#pool.query<ReadinessRow>(
      `SELECT * FROM task_execution_readiness
       WHERE workflow_plan_id=$1 AND ($2::text IS NULL OR check_phase=$2)
       ORDER BY created_at DESC,readiness_id DESC LIMIT $3`,
      [planId, filter.phase ?? null, limit],
    );
    if (readinessResult.rows.length === 0) return [];
    const snapshotResult = await this.#pool.query<SnapshotRow>(
      `SELECT * FROM task_availability_snapshot
       WHERE readiness_id = ANY($1::text[]) ORDER BY checked_at,node_id,snapshot_id`,
      [readinessResult.rows.map((row) => row.readiness_id)],
    );
    const byReadiness = new Map<string, SnapshotRow[]>();
    for (const row of snapshotResult.rows)
      byReadiness.set(row.readiness_id, [...(byReadiness.get(row.readiness_id) ?? []), row]);
    return readinessResult.rows.map((row) => {
      const readiness = mapReadiness(row);
      return {
        readiness,
        snapshots: (byReadiness.get(row.readiness_id) ?? []).map((snapshot) =>
          mapSnapshot(snapshot, readiness),
        ),
      };
    });
  }

  async findLatestPlanning(planId: string) {
    return (await this.listByPlan(planId, { phase: 'planning', limit: 1 }))[0];
  }
}

function mapReadiness(row: ReadinessRow): DslExecutionReadiness {
  return {
    readinessId: row.readiness_id,
    workflowPlanId: row.workflow_plan_id,
    planAttempt: row.plan_attempt,
    checkPhase: row.check_phase,
    ...(row.workflow_instance_id === null ? {} : { workflowInstanceId: row.workflow_instance_id }),
    ...(row.workflow_node_run_id === null ? {} : { workflowNodeRunId: row.workflow_node_run_id }),
    dslHash: row.dsl_hash,
    disposition: row.disposition,
    permittedActions: z
      .array(z.enum(['proceed', 'reschedule', 'revise_dsl', 'request_confirmation', 'abort']))
      .parse(row.permitted_actions_json),
    ...(row.model_decision_json === null
      ? {}
      : { modelDecision: RiskDecisionSchema.parse(row.model_decision_json) }),
    guardAction: row.guard_action,
    guardReasonCodes: StringArray.parse(row.guard_reason_codes_json),
    confirmationRequired: row.confirmation_required,
    createdAt: toIso(row.created_at),
  };
}

function mapSnapshot(row: SnapshotRow, readiness: DslExecutionReadiness): TaskAvailabilitySnapshot {
  return {
    snapshotId: row.snapshot_id,
    readinessId: row.readiness_id,
    workflowPlanId: readiness.workflowPlanId,
    planAttempt: readiness.planAttempt,
    checkPhase: readiness.checkPhase,
    ...(readiness.workflowInstanceId === undefined
      ? {}
      : { workflowInstanceId: readiness.workflowInstanceId }),
    ...(readiness.workflowNodeRunId === undefined
      ? {}
      : { workflowNodeRunId: readiness.workflowNodeRunId }),
    nodeId: row.node_id,
    serverId: row.server_id,
    operationName: row.operation_name,
    arguments: ArgumentsSchema.parse(row.arguments_snapshot_json),
    argumentsHash: row.arguments_hash,
    ...(row.timing_snapshot_json === null
      ? {}
      : { timing: TimingSchema.parse(row.timing_snapshot_json) }),
    result: AvailabilityResultSchema.parse(row.result_json),
    sourceRevision: row.source_revision,
    checkedAt: toIso(row.checked_at),
    normalizationReasonCodes: StringArray.parse(row.normalization_reason_codes_json),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isPgUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export type TaskAvailabilityPersistenceErrorCode =
  | 'TASK_READINESS_EVIDENCE_MISMATCH'
  | 'TASK_READINESS_EVIDENCE_CONFLICT'
  | 'TASK_READINESS_QUERY_INVALID';

export class TaskAvailabilityPersistenceError extends Error {
  readonly code: TaskAvailabilityPersistenceErrorCode;
  constructor(code: TaskAvailabilityPersistenceErrorCode, message: string) {
    super(message);
    this.name = 'TaskAvailabilityPersistenceError';
    this.code = code;
  }
}
