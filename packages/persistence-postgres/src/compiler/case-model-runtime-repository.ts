import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  CaseRuntimeEvidenceRepository,
  ModelRouteEvidenceRepository,
} from '../../../application/src/index.js';

interface EvidenceRow extends QueryResultRow {
  evidence: unknown;
}

/**
 * P11's immutable type-specific evidence store. It intentionally has no
 * provider credential or P02 Artifact mutation methods.
 */
export class PostgresCaseModelRuntimeRepository
  implements CaseRuntimeEvidenceRepository, ModelRouteEvidenceRepository
{
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveMatch(input: Parameters<CaseRuntimeEvidenceRepository['saveMatch']>[0]): Promise<void> {
    await this.#insertImmutable(
      'case_runtime_match',
      'runtime_request_ref',
      input.request.runtimeRequestRef,
      `INSERT INTO case_runtime_match(
         runtime_request_ref,tenant_id,goal_context_ref,task_type_id,
         request_snapshot,matches,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
       ON CONFLICT(runtime_request_ref) DO NOTHING`,
      [
        input.request.runtimeRequestRef,
        input.request.tenantId,
        input.request.goalContextRef,
        input.request.taskTypeId,
        JSON.stringify(input.request),
        JSON.stringify(input.matches),
        input.createdAt,
      ],
      { request: input.request, matches: input.matches },
      `SELECT jsonb_build_object(
         'request',request_snapshot,'matches',matches
       ) AS evidence
       FROM case_runtime_match WHERE runtime_request_ref=$1`,
    );
  }

  async saveAdaptation(
    input: Parameters<CaseRuntimeEvidenceRepository['saveAdaptation']>[0],
  ): Promise<void> {
    await this.#insertImmutable(
      'case_runtime_adaptation',
      'adaptation_id',
      input.adaptationId,
      `INSERT INTO case_runtime_adaptation(
         adaptation_id,case_ref,goal_context_ref,artifact_hash,
         active_pointer_version,request_snapshot,adaptation_result,created_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT(adaptation_id) DO NOTHING`,
      [
        input.adaptationId,
        input.request.caseRef,
        input.request.goalContextRef,
        input.artifactHash,
        input.activePointerVersion,
        JSON.stringify(input.request),
        JSON.stringify(input.result),
        input.createdAt,
      ],
      {
        request: input.request,
        result: input.result,
        artifactHash: input.artifactHash,
        activePointerVersion: input.activePointerVersion,
      },
      `SELECT jsonb_build_object(
         'request',request_snapshot,'result',adaptation_result,
         'artifactHash',artifact_hash,'activePointerVersion',active_pointer_version
       ) AS evidence
       FROM case_runtime_adaptation WHERE adaptation_id=$1`,
    );
  }

  async saveDecision(
    input: Parameters<ModelRouteEvidenceRepository['saveDecision']>[0],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO model_route_decision(
           route_decision_ref,tenant_id,request_ref,artifact_ref,artifact_hash,
           active_pointer_version,route_context,route_decision,decision_hash,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
         ON CONFLICT(route_decision_ref) DO NOTHING`,
        [
          input.routeDecisionRef,
          input.context.tenantId,
          input.context.requestRef,
          input.artifactRef,
          input.artifactHash,
          input.activePointerVersion,
          JSON.stringify(input.context),
          JSON.stringify(input.decision),
          input.decision.decisionHash,
          input.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        await assertEvidence(
          client,
          `SELECT jsonb_build_object(
             'context',route_context,'artifactRef',artifact_ref,'artifactHash',artifact_hash,
             'activePointerVersion',active_pointer_version,'decision',route_decision
           ) AS evidence
           FROM model_route_decision WHERE route_decision_ref=$1`,
          input.routeDecisionRef,
          {
            context: input.context,
            artifactRef: input.artifactRef,
            artifactHash: input.artifactHash,
            activePointerVersion: input.activePointerVersion,
            decision: input.decision,
          },
        );
        await client.query('COMMIT');
        return;
      }
      await writeOutbox(client, {
        eventId: `model-route-selected:${input.routeDecisionRef}`,
        eventType: 'model_route.selected',
        aggregateType: 'model_route_decision',
        aggregateId: input.routeDecisionRef,
        occurredAt: input.createdAt,
        payload: {
          requestRef: input.context.requestRef,
          artifactRef: input.artifactRef,
          selectedProfileRefs: input.decision.selectedProfileRefs,
          decisionHash: input.decision.decisionHash,
        },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveCascade(
    input: Parameters<ModelRouteEvidenceRepository['saveCascade']>[0],
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO model_cascade_run(
           cascade_run_id,route_decision_ref,decision_hash,run_snapshot,status,completed_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6)
         ON CONFLICT(cascade_run_id) DO NOTHING`,
        [
          input.run.cascadeRunId,
          input.run.routeDecisionRef,
          input.decisionHash,
          JSON.stringify(input.run),
          input.run.status,
          input.run.completedAt ?? null,
        ],
      );
      if (inserted.rowCount !== 1) {
        await assertEvidence(
          client,
          `SELECT jsonb_build_object(
             'run',run_snapshot,'decisionHash',decision_hash,
             'steps',COALESCE((
               SELECT jsonb_agg(step.step_evidence ORDER BY step.step_ref)
               FROM model_cascade_step step
               WHERE step.cascade_run_id=model_cascade_run.cascade_run_id
             ),'[]'::jsonb)
           ) AS evidence
           FROM model_cascade_run WHERE cascade_run_id=$1`,
          input.run.cascadeRunId,
          {
            run: input.run,
            decisionHash: input.decisionHash,
            steps: [...input.steps].sort((left, right) =>
              left.stepRef.localeCompare(right.stepRef),
            ),
          },
        );
        await client.query('COMMIT');
        return;
      }
      for (const step of input.steps) {
        await client.query(
          `INSERT INTO model_cascade_step(
             step_ref,cascade_run_id,profile_ref,attempt,status,step_evidence)
           VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            step.stepRef,
            input.run.cascadeRunId,
            step.profileRef,
            step.attempt,
            step.status,
            JSON.stringify(step),
          ],
        );
      }
      const escalated = input.steps.filter((step) => step.status !== 'accepted').length;
      if (escalated > 0) {
        await writeOutbox(client, {
          eventId: `model-cascade-escalated:${input.run.cascadeRunId}`,
          eventType: 'model_cascade.escalated',
          aggregateType: 'model_cascade_run',
          aggregateId: input.run.cascadeRunId,
          occurredAt: input.run.completedAt ?? new Date(0).toISOString(),
          payload: {
            routeDecisionRef: input.run.routeDecisionRef,
            stepCount: input.steps.length,
            escalatedSteps: escalated,
            status: input.run.status,
          },
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findCaseAdaptation(adaptationId: string): Promise<unknown> {
    const result = await this.#pool.query<EvidenceRow>(
      `SELECT adaptation_result AS evidence
       FROM case_runtime_adaptation WHERE adaptation_id=$1`,
      [adaptationId],
    );
    return result.rows[0]?.evidence;
  }

  async findCascade(cascadeRunId: string): Promise<unknown> {
    const result = await this.#pool.query<EvidenceRow>(
      `SELECT jsonb_build_object(
         'run',run_snapshot,
         'steps',COALESCE((
           SELECT jsonb_agg(step.step_evidence ORDER BY step.step_ref)
           FROM model_cascade_step step
           WHERE step.cascade_run_id=model_cascade_run.cascade_run_id
         ),'[]'::jsonb)
       ) AS evidence
       FROM model_cascade_run WHERE cascade_run_id=$1`,
      [cascadeRunId],
    );
    return result.rows[0]?.evidence;
  }

  async findRuntimeEvidenceByRequest(requestRef: string): Promise<unknown> {
    const result = await this.#pool.query<EvidenceRow>(
      `SELECT jsonb_build_object(
         'requestRef',$1::text,
         'case',(
           SELECT jsonb_build_object(
             'goalContextRef',goal_context_ref,
             'taskTypeId',task_type_id,
             'matches',matches,
             'createdAt',created_at
           )
           FROM case_runtime_match
           WHERE runtime_request_ref=$1
         ),
         'modelRoute',(
           SELECT jsonb_build_object(
             'routeDecisionRef',decision.route_decision_ref,
             'artifactRef',decision.artifact_ref,
             'decision',decision.route_decision,
             'createdAt',decision.created_at,
             'cascades',COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'run',run.run_snapshot,
                 'steps',COALESCE((
                   SELECT jsonb_agg(step.step_evidence ORDER BY step.step_ref)
                   FROM model_cascade_step step
                   WHERE step.cascade_run_id=run.cascade_run_id
                 ),'[]'::jsonb)
               ) ORDER BY run.cascade_run_id)
               FROM model_cascade_run run
               WHERE run.route_decision_ref=decision.route_decision_ref
             ),'[]'::jsonb)
           )
           FROM model_route_decision decision
           WHERE decision.request_ref=$1
           ORDER BY decision.created_at DESC,decision.route_decision_ref DESC
           LIMIT 1
         )
       ) AS evidence`,
      [requestRef],
    );
    const evidence = result.rows[0]?.evidence;
    if (!hasRuntimeEvidence(evidence)) return undefined;
    return evidence;
  }

  async #insertImmutable(
    table: string,
    keyColumn: string,
    key: string,
    insertSql: string,
    values: readonly unknown[],
    expected: unknown,
    readSql: string,
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(insertSql, [...values]);
      if (inserted.rowCount !== 1) await assertEvidence(client, readSql, key, expected);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new CaseModelRuntimePersistenceError(
        'P11_EVIDENCE_WRITE_FAILED',
        `${table}.${keyColumn} immutable write failed.`,
        error,
      );
    } finally {
      client.release();
    }
  }
}

async function assertEvidence(
  client: PoolClient,
  sql: string,
  key: string,
  expected: unknown,
): Promise<void> {
  const result = await client.query<EvidenceRow>(sql, [key]);
  if (result.rows[0] === undefined || canonical(result.rows[0].evidence) !== canonical(expected)) {
    throw new CaseModelRuntimePersistenceError(
      'P11_IDEMPOTENCY_CONFLICT',
      'Evidence identifier is already bound to different content.',
    );
  }
}

async function writeOutbox(
  client: PoolClient,
  event: Readonly<{
    eventId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    occurredAt: string;
    payload: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,$3,$4,1,'{}'::jsonb,$5::jsonb,$6,NULL)
     ON CONFLICT(event_id) DO NOTHING`,
    [
      event.eventId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.occurredAt,
    ],
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

function hasRuntimeEvidence(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return record['case'] !== null || record['modelRoute'] !== null;
}

export class CaseModelRuntimePersistenceError extends Error {
  readonly code: string;
  override readonly cause: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'CaseModelRuntimePersistenceError';
    this.code = code;
    this.cause = cause;
  }
}
