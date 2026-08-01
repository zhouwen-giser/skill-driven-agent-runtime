import type { Pool, QueryResultRow } from 'pg';

import {
  ArtifactPersistenceError,
  type ArtifactExecutionCompletion,
  type ArtifactExecutionRecord,
  type ArtifactExecutionStart,
  type ArtifactFeedbackInput,
  type RuleUsageRepository,
} from '../../../application/src/index.js';
import { PostgresArtifactExecutionRepository } from './artifact-repositories.js';

interface ExecutionRow extends QueryResultRow {
  artifact_execution_id: string;
  artifact_id: string;
  artifact_version: number;
  task_id: string;
  goal_id: string | null;
  goal_version: number | null;
  mode: string;
  decision_snapshot: Readonly<Record<string, unknown>>;
  generated_plan_id: string | null;
  status: ArtifactExecutionRecord['status'];
  fallback_reason_code: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

interface FeedbackRow extends QueryResultRow {
  feedback_id: string;
  artifact_execution_id: string;
  artifact_id: string;
  feedback_type: string;
  reason_code: string;
  summary: string;
  impact: Readonly<Record<string, unknown>>;
  outcome_ref: string | null;
  created_at: Date | string;
}

/**
 * Idempotency adapter over P02's canonical execution and feedback authority.
 * It creates no P09-owned authority or table: exact replay is accepted, while
 * reuse of an id with different immutable data is a stable conflict.
 */
export class PostgresRuleUsageRepository implements RuleUsageRepository {
  readonly #pool: Pool;
  readonly #repository: PostgresArtifactExecutionRepository;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#repository = new PostgresArtifactExecutionRepository(pool);
  }

  async startOrLoad(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord> {
    try {
      return await this.#repository.start(input);
    } catch (error) {
      const existing = await this.#findExecution(input.artifactExecutionId);
      if (existing === undefined) throw error;
      if (!sameExecutionStart(existing, input)) {
        throw conflict(
          'RULE_USAGE_IDEMPOTENCY_CONFLICT',
          'Artifact execution id was reused with different Rule evaluation data.',
        );
      }
      return existing;
    }
  }

  async completeOnce(input: ArtifactExecutionCompletion): Promise<void> {
    try {
      await this.#repository.complete(input);
    } catch (error) {
      const existing = await this.#findExecution(input.artifactExecutionId);
      if (existing === undefined) throw error;
      if (
        existing.status !== input.status ||
        existing.fallbackReasonCode !== input.fallbackReasonCode ||
        existing.completedAt !== input.completedAt
      ) {
        throw conflict(
          'RULE_USAGE_CAS_CONFLICT',
          'Rule execution is already terminal with a different result.',
        );
      }
    }
  }

  async appendFeedbackOnce(input: ArtifactFeedbackInput): Promise<void> {
    try {
      await this.#repository.appendFeedback(input);
    } catch (error) {
      const result = await this.#pool.query<FeedbackRow>(
        `SELECT feedback_id,artifact_execution_id,artifact_id,feedback_type,reason_code,
           summary,impact,outcome_ref,created_at
         FROM artifact_feedback WHERE feedback_id=$1`,
        [input.feedbackId],
      );
      const row = result.rows[0];
      if (row === undefined) throw error;
      if (
        row.artifact_execution_id !== input.artifactExecutionId ||
        row.artifact_id !== input.artifactId ||
        row.feedback_type !== input.feedbackType ||
        row.reason_code !== input.reasonCode ||
        row.summary !== input.summary ||
        canonical(row.impact) !== canonical(input.impact) ||
        (row.outcome_ref ?? undefined) !== input.outcomeRef ||
        iso(row.created_at) !== input.createdAt
      ) {
        throw conflict(
          'RULE_FEEDBACK_IDEMPOTENCY_CONFLICT',
          'Feedback id was reused with different Rule usage evidence.',
        );
      }
    }
  }

  async #findExecution(artifactExecutionId: string): Promise<ArtifactExecutionRecord | undefined> {
    const result = await this.#pool.query<ExecutionRow>(
      `SELECT artifact_execution_id,artifact_id,artifact_version,task_id,goal_id,
         goal_version,mode,decision_snapshot,generated_plan_id,status,
         fallback_reason_code,started_at,completed_at
       FROM artifact_execution WHERE artifact_execution_id=$1`,
      [artifactExecutionId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      artifactExecutionId: row.artifact_execution_id,
      artifactId: row.artifact_id,
      version: row.artifact_version,
      taskId: row.task_id,
      ...(row.goal_id === null ? {} : { goalId: row.goal_id }),
      ...(row.goal_version === null ? {} : { goalVersion: row.goal_version }),
      mode: row.mode,
      decisionSnapshot: Object.freeze({ ...row.decision_snapshot }),
      ...(row.generated_plan_id === null ? {} : { generatedPlanId: row.generated_plan_id }),
      status: row.status,
      ...(row.fallback_reason_code === null
        ? {}
        : { fallbackReasonCode: row.fallback_reason_code }),
      startedAt: iso(row.started_at),
      ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    });
  }
}

function sameExecutionStart(
  existing: ArtifactExecutionRecord,
  input: ArtifactExecutionStart,
): boolean {
  return (
    existing.artifactId === input.artifactId &&
    existing.version === input.version &&
    existing.taskId === input.taskId &&
    existing.goalId === input.goalId &&
    existing.goalVersion === input.goalVersion &&
    existing.mode === input.mode &&
    canonical(normalizeDecisionSnapshot(existing.decisionSnapshot)) ===
      canonical(normalizeDecisionSnapshot(input.decisionSnapshot)) &&
    existing.generatedPlanId === input.generatedPlanId
  );
}

function normalizeDecisionSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const evaluation = snapshot['evaluation'];
  if (evaluation === null || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    return snapshot;
  }
  const { createdAt: _observedAt, ...stableEvaluation } = evaluation as Readonly<
    Record<string, unknown>
  >;
  void _observedAt;
  return { ...snapshot, evaluation: stableEvaluation };
}

function conflict(code: string, message: string): ArtifactPersistenceError {
  return new ArtifactPersistenceError(code, message);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
