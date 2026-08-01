import type { Pool } from 'pg';

import {
  ArtifactManagementError,
  type ArtifactManagementListQuery,
  type ArtifactManagementQueryRepository,
  type ArtifactManagementView,
  type ArtifactOutboxProjection,
  type ManagementReadAudit,
  type RuntimeManagementView,
} from '../../../application/src/index.js';

export class PostgresArtifactManagementQueryRepository implements ArtifactManagementQueryRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async listArtifacts(
    input: ArtifactManagementListQuery & Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  ): Promise<Readonly<{ items: readonly unknown[]; nextCursor?: string }>> {
    const parameters: unknown[] = [];
    const conditions = [tenantCondition(input, parameters, 'artifact')];
    if (input.status !== undefined)
      conditions.push(`artifact.status=$${String(push(parameters, input.status))}`);
    if (input.artifactType !== undefined)
      conditions.push(`artifact.artifact_type=$${String(push(parameters, input.artifactType))}`);
    if (input.riskLevel !== undefined)
      conditions.push(`artifact.risk_level=$${String(push(parameters, input.riskLevel))}`);
    if (input.createdFrom !== undefined)
      conditions.push(
        `artifact.created_at>=$${String(push(parameters, input.createdFrom))}::timestamptz`,
      );
    if (input.createdTo !== undefined)
      conditions.push(
        `artifact.created_at<=$${String(push(parameters, input.createdTo))}::timestamptz`,
      );
    if (input.driftSeverity !== undefined)
      conditions.push(
        `EXISTS (
           SELECT 1 FROM artifact_feedback feedback
           WHERE feedback.artifact_id=artifact.artifact_id
             AND (feedback.feedback_type='drift' OR feedback.reason_code ILIKE '%drift%')
             AND feedback.impact->>'severity'=$${String(push(parameters, input.driftSeverity))}
         )`,
      );
    if (input.active !== undefined)
      conditions.push(
        input.active ? 'pointer.artifact_id IS NOT NULL' : 'pointer.artifact_id IS NULL',
      );
    if (input.taskTypeId !== undefined) {
      conditions.push(
        `artifact.dependency_snapshot->'taskTypeVersionRefs'
           ? $${String(push(parameters, input.taskTypeId))}`,
      );
    }
    const cursor = decodeCursor(input.cursor);
    if (cursor !== undefined) {
      if (cursor.sort !== input.sort)
        throw new ArtifactManagementError('ARTIFACT_MANAGEMENT_CURSOR_SORT_MISMATCH', 400);
      if (input.sort === 'key_asc') {
        conditions.push(
          `(artifact.artifact_key,artifact.version,artifact.artifact_id) >
           ($${String(push(parameters, cursor.artifactKey))},$${String(
             push(parameters, cursor.version),
           )},$${String(push(parameters, cursor.artifactId))})`,
        );
      } else {
        const comparison = input.sort === 'created_asc' ? '>' : '<';
        conditions.push(
          `(artifact.created_at,artifact.artifact_id) ${comparison}
           ($${String(push(parameters, cursor.createdAt))}::timestamptz,
            $${String(push(parameters, cursor.artifactId))})`,
        );
      }
    }
    const direction = input.sort === 'created_asc' ? 'ASC' : 'DESC';
    const order =
      input.sort === 'key_asc'
        ? 'artifact.artifact_key ASC,artifact.version ASC,artifact.artifact_id ASC'
        : `artifact.created_at ${direction},artifact.artifact_id ${direction}`;
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT artifact.artifact_id,artifact.artifact_key,artifact.version,
              artifact.artifact_type,artifact.tenant_id,artifact.domain,artifact.status,
              artifact.risk_level,artifact.content_hash,artifact.created_at,
              pointer.lock_version AS active_pointer_version,
              validation.status AS validation_status,
              validation.completed_at AS validation_completed_at
       FROM compiled_artifact artifact
       LEFT JOIN artifact_active_pointer pointer ON pointer.artifact_id=artifact.artifact_id
       LEFT JOIN LATERAL (
         SELECT status,completed_at FROM artifact_validation_run run
         WHERE run.artifact_id=artifact.artifact_id AND run.artifact_version=artifact.version
         ORDER BY completed_at DESC NULLS LAST,started_at DESC LIMIT 1
       ) validation ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${order}
       LIMIT $${String(push(parameters, input.limit + 1))}`,
      parameters,
    );
    const hasMore = result.rows.length > input.limit;
    const items = result.rows.slice(0, input.limit);
    const last = items.at(-1);
    return Object.freeze({
      items: Object.freeze(items),
      ...(hasMore && last !== undefined
        ? {
            nextCursor: encodeCursor({
              sort: input.sort,
              createdAt: timestampCursorValue(last['created_at']),
              artifactId: String(last['artifact_id']),
              artifactKey: String(last['artifact_key']),
              version: Number(last['version']),
            }),
          }
        : {}),
    });
  }

  async getArtifact(
    artifactId: string,
    scope: Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  ): Promise<unknown> {
    const parameters: unknown[] = [artifactId];
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT artifact.*,pointer.lock_version AS active_pointer_version,
              pointer.activated_by,pointer.activated_at
       FROM compiled_artifact artifact
       LEFT JOIN artifact_active_pointer pointer ON pointer.artifact_id=artifact.artifact_id
       WHERE artifact.artifact_id=$1 AND ${tenantCondition(scope, parameters, 'artifact')}`,
      parameters,
    );
    return result.rows[0];
  }

  async getArtifactView(
    artifactId: string,
    view: ArtifactManagementView,
    scope: Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  ): Promise<unknown> {
    const artifact = await this.getArtifact(artifactId, scope);
    if (artifact === undefined) return undefined;
    const query = viewQuery(view);
    const parameters =
      view === 'audit'
        ? [artifactId, scope.tenantId ?? null, scope.includeGlobal]
        : [
            artifactId,
            String((artifact as Record<string, unknown>)['artifact_key']),
            (artifact as Record<string, unknown>)['tenant_id'] ?? null,
          ];
    const result = await this.#pool.query<Record<string, unknown>>(query.sql, parameters);
    return Object.freeze({ items: Object.freeze(result.rows) });
  }

  async getRuntimeView(
    view: RuntimeManagementView,
    input: Readonly<{ tenantId?: string; limit: number; cursor?: string }>,
  ): Promise<Readonly<{ items: readonly unknown[]; nextCursor?: string }>> {
    if (view === 'model-usage') return this.#getModelUsageRuntimeView(input);
    const after = input.cursor ?? '';
    const parameters: unknown[] = [after, input.limit + 1];
    const tenant = input.tenantId;
    const sql =
      view === 'decisions'
        ? `SELECT decision.*,request.tenant_id FROM fast_gateway_decision decision
           JOIN fast_gateway_request request USING(request_id)
           WHERE decision.gateway_decision_id>$1
             AND ($3::text IS NULL OR request.tenant_id=$3)
           ORDER BY decision.gateway_decision_id LIMIT $2`
        : `SELECT match.* FROM case_runtime_match match
           WHERE match.runtime_request_ref>$1
             AND ($3::text IS NULL OR match.tenant_id=$3)
           ORDER BY match.runtime_request_ref LIMIT $2`;
    parameters.push(tenant ?? null);
    const result = await this.#pool.query<Record<string, unknown>>(sql, parameters);
    const hasMore = result.rows.length > input.limit;
    const items = result.rows.slice(0, input.limit);
    const last = items.at(-1);
    const key = view === 'decisions' ? 'gateway_decision_id' : 'runtime_request_ref';
    return Object.freeze({
      items: Object.freeze(items),
      ...(hasMore && last !== undefined ? { nextCursor: String(last[key]) } : {}),
    });
  }

  async #getModelUsageRuntimeView(
    input: Readonly<{ tenantId?: string; limit: number; cursor?: string }>,
  ): Promise<Readonly<{ items: readonly unknown[]; nextCursor?: string }>> {
    const after = decodeModelUsageCursor(input.cursor);
    const result = await this.#pool.query<Record<string, unknown>>(
      `SELECT route.*,run.cascade_run_id,run.run_snapshot,run.status AS cascade_status
       FROM model_route_decision route
       LEFT JOIN model_cascade_run run USING(route_decision_ref)
       WHERE (route.route_decision_ref>$1
              OR (route.route_decision_ref=$1
                  AND COALESCE(run.cascade_run_id,'')>$2))
         AND ($4::text IS NULL OR route.tenant_id=$4)
       ORDER BY route.route_decision_ref,COALESCE(run.cascade_run_id,'') LIMIT $3`,
      [after.routeDecisionRef, after.cascadeRunId, input.limit + 1, input.tenantId ?? null],
    );
    const hasMore = result.rows.length > input.limit;
    const items = result.rows.slice(0, input.limit);
    const last = items.at(-1);
    return Object.freeze({
      items: Object.freeze(items),
      ...(hasMore && last !== undefined
        ? {
            nextCursor: encodeModelUsageCursor({
              routeDecisionRef: runtimeCursorString(last, 'route_decision_ref'),
              cascadeRunId: runtimeCursorString(last, 'cascade_run_id', true),
            }),
          }
        : {}),
    });
  }

  async getRuntimeDetail(
    view: RuntimeManagementView,
    id: string,
    input: Readonly<{ tenantId?: string }>,
  ): Promise<unknown> {
    const tenantId = input.tenantId ?? null;
    const sql =
      view === 'decisions'
        ? `SELECT decision.*,request.tenant_id FROM fast_gateway_decision decision
           JOIN fast_gateway_request request USING(request_id)
           WHERE decision.gateway_decision_id=$1
             AND ($2::text IS NULL OR request.tenant_id=$2)`
        : view === 'model-usage'
          ? `SELECT route.*,run.run_snapshot,run.status AS cascade_status
             FROM model_route_decision route
             LEFT JOIN model_cascade_run run USING(route_decision_ref)
             WHERE route.route_decision_ref=$1
               AND ($2::text IS NULL OR route.tenant_id=$2)`
          : `SELECT match.* FROM case_runtime_match match
             WHERE match.runtime_request_ref=$1
               AND ($2::text IS NULL OR match.tenant_id=$2)`;
    const result = await this.#pool.query<Record<string, unknown>>(sql, [id, tenantId]);
    return result.rows[0];
  }

  async listEvents(
    input: Readonly<{
      tenantId?: string;
      includeGlobal: boolean;
      afterSequence: number;
      limit: number;
    }>,
  ): Promise<readonly ArtifactOutboxProjection[]> {
    const result = await this.#pool.query<{
      outbox_sequence: string;
      event_id: string;
      event_type: string;
      correlation: Record<string, unknown>;
      payload: Record<string, unknown>;
      aggregate_id: string;
      occurred_at: Date;
      resolved_tenant_id: string | null;
    }>(
      `SELECT outbox.outbox_sequence,outbox.event_id,outbox.event_type,outbox.correlation,
              outbox.payload,outbox.aggregate_id,outbox.occurred_at,
              COALESCE(
                outbox.correlation->>'tenantId',
                outbox.payload->>'tenantId',
                gateway_request.tenant_id,
                feedback_request.tenant_id,
                model_route.tenant_id,
                cascade_route.tenant_id,
                artifact.tenant_id
              ) AS resolved_tenant_id
       FROM cognitive_runtime_outbox outbox
       LEFT JOIN fast_gateway_decision gateway_decision
         ON outbox.aggregate_type='fast_gateway_decision'
        AND gateway_decision.gateway_decision_id=outbox.aggregate_id
       LEFT JOIN fast_gateway_request gateway_request
         ON gateway_request.request_id=gateway_decision.request_id
       LEFT JOIN fast_gateway_feedback gateway_feedback
         ON outbox.aggregate_type='fast_gateway_feedback'
        AND gateway_feedback.feedback_id=outbox.aggregate_id
       LEFT JOIN fast_gateway_request feedback_request
         ON feedback_request.request_id=gateway_feedback.request_id
       LEFT JOIN model_route_decision model_route
         ON outbox.aggregate_type='model_route_decision'
        AND model_route.route_decision_ref=outbox.aggregate_id
       LEFT JOIN model_cascade_run model_cascade
         ON outbox.aggregate_type='model_cascade_run'
        AND model_cascade.cascade_run_id=outbox.aggregate_id
       LEFT JOIN model_route_decision cascade_route
         ON cascade_route.route_decision_ref=model_cascade.route_decision_ref
       LEFT JOIN compiled_artifact artifact
         ON artifact.artifact_id=COALESCE(outbox.payload->>'artifactId',outbox.aggregate_id)
       WHERE outbox_sequence>$1
         AND outbox_sequence IS NOT NULL
         AND event_type=ANY($4::text[])
         AND ($2::text IS NULL
           OR COALESCE(
                outbox.correlation->>'tenantId',
                outbox.payload->>'tenantId',
                gateway_request.tenant_id,
                feedback_request.tenant_id,
                model_route.tenant_id,
                cascade_route.tenant_id,
                artifact.tenant_id
              )=$2
           OR ($5::boolean
             AND COALESCE(
                outbox.correlation->>'tenantId',
                outbox.payload->>'tenantId',
                gateway_request.tenant_id,
                feedback_request.tenant_id,
                model_route.tenant_id,
                cascade_route.tenant_id,
                artifact.tenant_id
              ) IS NULL))
       ORDER BY outbox_sequence
       LIMIT $3`,
      [
        input.afterSequence,
        input.tenantId ?? null,
        input.limit,
        SSE_EVENT_TYPES,
        input.includeGlobal,
      ],
    );
    return Object.freeze(
      result.rows.map((row) => {
        const tenantId =
          typeof row.resolved_tenant_id === 'string'
            ? row.resolved_tenant_id
            : tenantFrom(row.correlation, row.payload);
        return Object.freeze({
          sequence: Number(row.outbox_sequence),
          eventId: row.event_id,
          eventType: projectEventType(row.event_type, row.payload),
          ...(tenantId === undefined ? {} : { tenantId }),
          payload: Object.freeze({ ...row.payload }),
          occurredAt: row.occurred_at.toISOString(),
        });
      }),
    );
  }

  async recordReadAudit(input: ManagementReadAudit): Promise<void> {
    await this.#pool.query(
      `INSERT INTO artifact_management_read_audit(
         audit_id,actor_id,roles,tenant_id,operation,target,request_id,result,source_ip,occurred_at
       ) VALUES($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(actor_id,request_id,operation,target) DO NOTHING`,
      [
        input.auditId,
        input.actorId,
        JSON.stringify(input.roles),
        input.tenantId ?? null,
        input.operation,
        input.target,
        input.requestId,
        input.result,
        input.sourceIp ?? null,
        input.occurredAt,
      ],
    );
  }
}

function viewQuery(view: ArtifactManagementView): Readonly<{ sql: string }> {
  const queries: Record<ArtifactManagementView, string> = {
    versions: `SELECT artifact_id,version,status,content_hash,created_at FROM compiled_artifact
       WHERE artifact_key=$2 AND tenant_id IS NOT DISTINCT FROM $3::text
       ORDER BY version DESC`,
    diff: `SELECT artifact_id,version,definition,applicability,dependency_snapshot,risk_level,
                  content_hash,created_at
           FROM compiled_artifact
           WHERE artifact_key=$2 AND tenant_id IS NOT DISTINCT FROM $3::text
           ORDER BY version DESC LIMIT 2`,
    lineage: 'SELECT * FROM artifact_lineage WHERE artifact_id=$1 ORDER BY created_at DESC',
    validation:
      'SELECT * FROM artifact_validation_run WHERE artifact_id=$1 ORDER BY started_at DESC',
    shadow: `SELECT run.*,result.comparison,result.policy_violation,result.unsafe_attempt,
                    result.stale,result.result_hash,result.completed_at
             FROM artifact_shadow_run run
             LEFT JOIN artifact_shadow_result result USING(shadow_run_id)
             WHERE run.artifact_id=$1 ORDER BY run.created_at DESC`,
    promotion: `SELECT package.*,assessment.coverage,assessment.reason_codes,
                       assessment.evidence_hash
                FROM artifact_promotion_package package
                LEFT JOIN artifact_promotion_assessment assessment USING(promotion_package_id)
                WHERE package.artifact_id=$1 ORDER BY package.created_at DESC`,
    approvals: 'SELECT * FROM artifact_approval WHERE artifact_id=$1 ORDER BY created_at DESC',
    activations:
      'SELECT * FROM artifact_activation_record WHERE artifact_id=$1 ORDER BY activated_at DESC',
    usage: 'SELECT * FROM artifact_execution WHERE artifact_id=$1 ORDER BY started_at DESC',
    outcomes: 'SELECT * FROM artifact_feedback WHERE artifact_id=$1 ORDER BY created_at DESC',
    drift: `SELECT * FROM artifact_feedback WHERE artifact_id=$1
            AND (feedback_type ILIKE '%drift%' OR reason_code ILIKE '%drift%')
            ORDER BY created_at DESC`,
    audit: `SELECT record_type,record,event_at
            FROM (
              SELECT 'write'::text AS record_type,to_jsonb(action) AS record,
                     action.updated_at AS event_at
              FROM cognitive_management_action action
              WHERE action.subject_id=$1 OR action.subject_id LIKE $1 || ':%'
              UNION ALL
              SELECT 'read'::text AS record_type,to_jsonb(read_audit) AS record,
                     read_audit.occurred_at AS event_at
              FROM artifact_management_read_audit read_audit
              WHERE read_audit.target=$1
                AND ($2::text IS NULL
                  OR read_audit.tenant_id=$2
                  OR ($3::boolean AND read_audit.tenant_id IS NULL))
            ) audit_records
            ORDER BY event_at DESC`,
  };
  return Object.freeze({ sql: queries[view] });
}

function tenantCondition(
  input: Readonly<{ tenantId?: string; includeGlobal: boolean }>,
  parameters: unknown[],
  alias: string,
): string {
  if (input.tenantId === undefined) return 'TRUE';
  const index = push(parameters, input.tenantId);
  return input.includeGlobal
    ? `(${alias}.tenant_id=$${String(index)} OR ${alias}.tenant_id IS NULL)`
    : `${alias}.tenant_id=$${String(index)}`;
}

function push(values: unknown[], value: unknown): number {
  values.push(value);
  return values.length;
}

interface ArtifactCursor {
  readonly sort: ArtifactManagementListQuery['sort'];
  readonly createdAt: string;
  readonly artifactId: string;
  readonly artifactKey: string;
  readonly version: number;
}

interface ModelUsageCursor {
  readonly routeDecisionRef: string;
  readonly cascadeRunId: string;
}

const MODEL_USAGE_CURSOR_PREFIX = 'model-usage:';

function runtimeCursorString(
  row: Readonly<Record<string, unknown>>,
  key: string,
  nullable = false,
): string {
  const value = row[key];
  if (nullable && (value === null || value === undefined)) return '';
  if (typeof value !== 'string')
    throw new ArtifactManagementError('ARTIFACT_MANAGEMENT_CURSOR_SOURCE_INVALID', 500);
  return value;
}

function encodeModelUsageCursor(value: ModelUsageCursor): string {
  return `${MODEL_USAGE_CURSOR_PREFIX}${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')}`;
}

function decodeModelUsageCursor(cursor: string | undefined): ModelUsageCursor {
  if (cursor === undefined) return Object.freeze({ routeDecisionRef: '', cascadeRunId: '' });
  if (!cursor.startsWith(MODEL_USAGE_CURSOR_PREFIX)) {
    return Object.freeze({ routeDecisionRef: cursor, cascadeRunId: '\uffff' });
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor.slice(MODEL_USAGE_CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    ) as { routeDecisionRef?: unknown; cascadeRunId?: unknown };
    if (typeof parsed.routeDecisionRef !== 'string' || typeof parsed.cascadeRunId !== 'string')
      throw new Error('invalid cursor');
    return Object.freeze({
      routeDecisionRef: parsed.routeDecisionRef,
      cascadeRunId: parsed.cascadeRunId,
    });
  } catch {
    throw new ArtifactManagementError('ARTIFACT_MANAGEMENT_CURSOR_INVALID', 400);
  }
}

function encodeCursor(value: ArtifactCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function timestampCursorValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.valueOf()))
    throw new ArtifactManagementError('ARTIFACT_MANAGEMENT_CURSOR_TIMESTAMP_INVALID', 500);
  return parsed.toISOString();
}

function decodeCursor(cursor: string | undefined): ArtifactCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      sort?: unknown;
      createdAt?: unknown;
      artifactId?: unknown;
      artifactKey?: unknown;
      version?: unknown;
    };
    if (
      !['created_desc', 'created_asc', 'key_asc'].includes(String(parsed.sort)) ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.artifactId !== 'string' ||
      typeof parsed.artifactKey !== 'string' ||
      typeof parsed.version !== 'number' ||
      !Number.isInteger(parsed.version) ||
      parsed.version < 1
    )
      throw new Error('invalid cursor');
    return Object.freeze({
      sort: parsed.sort as ArtifactManagementListQuery['sort'],
      createdAt: parsed.createdAt,
      artifactId: parsed.artifactId,
      artifactKey: parsed.artifactKey,
      version: parsed.version,
    });
  } catch {
    throw new ArtifactManagementError('ARTIFACT_MANAGEMENT_CURSOR_INVALID', 400);
  }
}

const SSE_EVENT_TYPES = Object.freeze([
  'compiler.artifact_candidate_created',
  'artifact.revalidating',
  'artifact.rule_evaluated',
  'artifact.feedback_recorded',
  'artifact.candidate_created',
  'artifact.validation_completed',
  'artifact.shadow_completed',
  'artifact.promotion_ready',
  'artifact.approval_recorded',
  'artifact.activated',
  'artifact.revalidation_requested',
  'artifact.deprecated',
  'artifact.rollback_completed',
  'artifact.kill_switch_changed',
  'gateway.route_selected',
  'gateway.confirmation_required',
  'gateway.fallback_started',
  'gateway.formal_handoff',
  'rule.evaluated',
  'template.instantiated',
  'case.adapted',
  'model_route.selected',
  'model_cascade.escalated',
  'artifact.outcome_linked',
  'artifact.correction_observed',
  'artifact.drift_detected',
  'artifact.revalidation_signalled',
]);

function projectEventType(eventType: string, payload: Readonly<Record<string, unknown>>): string {
  if (eventType === 'compiler.artifact_candidate_created') return 'artifact.candidate_created';
  if (eventType === 'artifact.revalidating') return 'artifact.revalidation_requested';
  if (eventType === 'artifact.rule_evaluated') return 'rule.evaluated';
  if (eventType === 'artifact.feedback_recorded') {
    const feedbackType = payload['feedbackType'];
    if (feedbackType === 'drift') return 'artifact.drift_detected';
    if (feedbackType === 'correction') return 'artifact.correction_observed';
    return 'artifact.outcome_linked';
  }
  if (eventType === 'artifact.deprecated' && payload['reasonCode'] === 'kill_switch')
    return 'artifact.kill_switch_changed';
  if (eventType === 'artifact.activated' && typeof payload['rollbackFromArtifactId'] === 'string')
    return 'artifact.rollback_completed';
  return eventType;
}

function tenantFrom(
  correlation: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  const value = correlation['tenantId'] ?? payload['tenantId'];
  return typeof value === 'string' ? value : undefined;
}
