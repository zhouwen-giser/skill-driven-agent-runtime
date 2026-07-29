import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { GatewayDecisionPersistence } from '../../../application/src/index.js';
import {
  createGatewayDecisionRecord,
  createGatewayFeedbackEnvelope,
  createRuntimeRequestContext,
  type GatewayDecisionRecord,
  type GatewayFeedbackEnvelope,
  type RuntimeExecutionDecision,
  type RuntimeRequestContext,
} from '../../../domain/src/index.js';

interface StoredDecisionRow extends QueryResultRow {
  request_hash: string;
  runtime_decision: RuntimeExecutionDecision;
  decision_record: GatewayDecisionRecord;
  outbox_recorded?: boolean;
}

interface StoredFeedbackRow extends QueryResultRow {
  feedback_envelope: GatewayFeedbackEnvelope;
}

/** PostgreSQL authority for P10 route/correlation evidence and idempotency. */
export class PostgresFastGatewayRepository implements GatewayDecisionPersistence {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<
    | Readonly<{
        requestHash: string;
        decision: RuntimeExecutionDecision;
        record: GatewayDecisionRecord;
      }>
    | undefined
  > {
    const result = await this.#pool.query<StoredDecisionRow>(
      `SELECT request.request_hash,decision.runtime_decision,decision.decision_record
       FROM fast_gateway_request request
       JOIN fast_gateway_decision decision ON decision.request_id=request.request_id
       WHERE request.idempotency_key=$1`,
      [idempotencyKey],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      requestHash: row.request_hash,
      decision: parseRuntimeDecision(row.runtime_decision),
      record: createGatewayDecisionRecord(row.decision_record),
    });
  }

  async findByTaskId(taskId: string): Promise<
    | Readonly<{
        decision: RuntimeExecutionDecision;
        record: GatewayDecisionRecord;
        outboxRecorded: boolean;
      }>
    | undefined
  > {
    const result = await this.#pool.query<StoredDecisionRow>(
      `SELECT decision.runtime_decision,decision.decision_record,
         EXISTS(
           SELECT 1 FROM cognitive_runtime_outbox outbox
           WHERE outbox.aggregate_type='fast_gateway_decision'
             AND outbox.aggregate_id=decision.gateway_decision_id
         ) AS outbox_recorded
       FROM fast_gateway_request request
       JOIN fast_gateway_decision decision ON decision.request_id=request.request_id
       WHERE request.task_id=$1
       ORDER BY decision.created_at DESC,decision.gateway_decision_id DESC
       LIMIT 1`,
      [taskId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return Object.freeze({
      decision: parseRuntimeDecision(row.runtime_decision),
      record: createGatewayDecisionRecord(row.decision_record),
      outboxRecorded: row.outbox_recorded === true,
    });
  }

  async save(
    input: Readonly<{
      idempotencyKey: string;
      requestHash: string;
      context: RuntimeRequestContext;
      decision: RuntimeExecutionDecision;
      record: GatewayDecisionRecord;
    }>,
  ): Promise<void> {
    const context = createRuntimeRequestContext(input.context);
    const record = createGatewayDecisionRecord(input.record);
    const decision = parseRuntimeDecision(input.decision);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const requestInsert = await client.query(
        `INSERT INTO fast_gateway_request(
           request_id,task_id,context_id,tenant_id,idempotency_key,request_hash,
           request_context,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT(idempotency_key) DO NOTHING
         RETURNING request_id`,
        [
          context.requestId,
          context.taskId,
          context.contextId,
          context.actor.tenantId,
          input.idempotencyKey,
          input.requestHash,
          JSON.stringify(context),
          context.createdAt,
        ],
      );
      if (requestInsert.rowCount !== 1) {
        await this.#assertExisting(
          client,
          input.idempotencyKey,
          input.requestHash,
          decision,
          record,
        );
        await client.query('COMMIT');
        return;
      }
      await client.query(
        `INSERT INTO fast_gateway_decision(
           gateway_decision_id,request_id,runtime_decision_id,runtime_decision,
           decision_record,decision_hash,created_at)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)`,
        [
          record.gatewayDecisionId,
          context.requestId,
          decision.decisionId,
          JSON.stringify(decision),
          JSON.stringify(record),
          record.decisionHash,
          record.createdAt,
        ],
      );
      await writeOutbox(client, {
        eventId: `gateway-route-${record.gatewayDecisionId}`,
        eventType: routeEventType(decision),
        aggregateType: 'fast_gateway_decision',
        aggregateId: record.gatewayDecisionId,
        occurredAt: record.createdAt,
        payload: {
          requestId: context.requestId,
          runtimeDecisionRef: decision.decisionId,
          path: decision.path,
          selectedArtifactRef: decision.selectedArtifactRef ?? null,
          reasonCodes: record.reasonCodes,
          formalHandoffRef: record.formalHandoffRef ?? null,
          fallbackRef: record.fallbackRef ?? null,
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

  async appendFeedback(input: GatewayFeedbackEnvelope): Promise<void> {
    const envelope = createGatewayFeedbackEnvelope(input);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO fast_gateway_feedback(
           feedback_id,request_id,gateway_decision_id,feedback_type,
           feedback_envelope,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(feedback_id) DO NOTHING
         RETURNING feedback_id`,
        [
          envelope.feedbackId,
          envelope.requestId,
          envelope.gatewayDecisionRef,
          envelope.feedbackType,
          JSON.stringify(envelope),
          envelope.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        const existing = await client.query<StoredFeedbackRow>(
          `SELECT feedback_envelope FROM fast_gateway_feedback WHERE feedback_id=$1`,
          [envelope.feedbackId],
        );
        const row = existing.rows[0];
        if (
          row === undefined ||
          canonical(createGatewayFeedbackEnvelope(row.feedback_envelope)) !== canonical(envelope)
        ) {
          throw new FastGatewayPersistenceError(
            'GATEWAY_FEEDBACK_IDEMPOTENCY_CONFLICT',
            'Feedback ID is already bound to different evidence.',
          );
        }
        await client.query('COMMIT');
        return;
      }
      await writeOutbox(client, {
        eventId: `gateway-feedback-${envelope.feedbackId}`,
        eventType: 'artifact.feedback_recorded',
        aggregateType: 'fast_gateway_feedback',
        aggregateId: envelope.feedbackId,
        occurredAt: envelope.createdAt,
        payload: {
          requestId: envelope.requestId,
          gatewayDecisionRef: envelope.gatewayDecisionRef,
          feedbackType: envelope.feedbackType,
          selectedArtifactRefs: envelope.selectedArtifactRefs,
          formalOutcomeRef: envelope.formalOutcomeRef ?? null,
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

  async deleteActorScope(actorId: string): Promise<number> {
    if (actorId.trim().length === 0) {
      throw new FastGatewayPersistenceError(
        'GATEWAY_DELETION_IDENTITY_REQUIRED',
        'Actor identity is required for Gateway deletion propagation.',
      );
    }
    const result = await this.#pool.query(
      `DELETE FROM fast_gateway_request
       WHERE request_context#>>'{actor,actorId}'=$1
       RETURNING request_id`,
      [actorId],
    );
    return result.rowCount ?? 0;
  }

  async #assertExisting(
    client: PoolClient,
    idempotencyKey: string,
    requestHash: string,
    decision: RuntimeExecutionDecision,
    record: GatewayDecisionRecord,
  ): Promise<void> {
    const existing = await client.query<StoredDecisionRow>(
      `SELECT request.request_hash,decision.runtime_decision,decision.decision_record
       FROM fast_gateway_request request
       JOIN fast_gateway_decision decision ON decision.request_id=request.request_id
       WHERE request.idempotency_key=$1
       FOR UPDATE OF request`,
      [idempotencyKey],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new FastGatewayPersistenceError(
        'GATEWAY_IDEMPOTENCY_CONFLICT',
        'Gateway idempotency key has no completed decision.',
      );
    }
    if (
      row.request_hash !== requestHash ||
      canonical(parseRuntimeDecision(row.runtime_decision)) !== canonical(decision) ||
      canonical(createGatewayDecisionRecord(row.decision_record)) !== canonical(record)
    ) {
      throw new FastGatewayPersistenceError(
        'GATEWAY_IDEMPOTENCY_CONFLICT',
        'Gateway idempotency key is already bound to another decision.',
      );
    }
  }
}

function parseRuntimeDecision(input: RuntimeExecutionDecision): RuntimeExecutionDecision {
  if (
    typeof input.decisionId !== 'string' ||
    typeof input.requestId !== 'string' ||
    ![
      'compiled_fast',
      'template_adapt',
      'case_adapt',
      'small_model',
      'cognitive_runtime',
      'human_input',
      'denied',
    ].includes(input.path) ||
    typeof input.matcherSnapshotHash !== 'string' ||
    typeof input.policySnapshotHash !== 'string' ||
    typeof input.createdAt !== 'string'
  ) {
    throw new FastGatewayPersistenceError(
      'GATEWAY_DECISION_INVALID',
      'Stored RuntimeExecutionDecision is invalid.',
    );
  }
  return Object.freeze({
    ...input,
    parameterBindings: Object.freeze({ ...input.parameterBindings }),
    missingParameters: Object.freeze([...input.missingParameters]),
    requiredConfirmations: Object.freeze([...input.requiredConfirmations]),
    reasonCodes: Object.freeze([...input.reasonCodes]),
  });
}

function routeEventType(decision: RuntimeExecutionDecision): string {
  if (decision.path === 'human_input') return 'gateway.confirmation_required';
  if (decision.path === 'cognitive_runtime') return 'gateway.fallback_started';
  if (decision.path === 'compiled_fast' || decision.path === 'template_adapt') {
    return 'gateway.formal_handoff';
  }
  return 'gateway.route_selected';
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

export class FastGatewayPersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FastGatewayPersistenceError';
    this.code = code;
  }
}
