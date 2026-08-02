import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  A2aCommandContext,
  NodeControlA2aExposureRepository,
} from '../../node-control-application/src/index.js';
import {
  createA2aExposureVersion,
  type A2aExposureStatus,
  type A2aExposureVersion,
  type AgentCardRevision,
  type AgentCardRevisionStatus,
  type JsonObject,
  type ManagementOperation,
  type RuntimeAgentCardCandidate,
} from '../../node-control-domain/src/index.js';

interface ExposureRow extends QueryResultRow {
  exposure_id: string;
  version: string;
  capability_id: string;
  capability_version: string;
  agent_skill_id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  input_modes: string[];
  output_modes: string[];
  request_schema: JsonObject;
  result_schema: JsonObject;
  visibility: 'organization' | 'public';
  requester_policy: JsonObject | null;
  readiness_publication_policy:
    'publish_when_available' | 'publish_degraded' | 'always_publish_with_status';
  status: A2aExposureStatus;
  exposure_hash: string;
}

interface CardRow extends QueryResultRow {
  revision: string;
  node_id: string;
  exposure_refs: string[];
  content_hash: string;
  capability_catalog_hash: string;
  status: AgentCardRevisionStatus;
  generated_at: Date;
  activated_at: Date | null;
  rejection_code: string | null;
}

interface OperationRow extends QueryResultRow {
  operation_id: string;
  operation_type: string;
  target_type: string;
  target_id: string;
  target_version: string | null;
  target_revision: string | null;
  status: ManagementOperation['status'];
  actor_id: string;
  reason: string;
  idempotency_key_hash: string;
  input_hash: string;
  result: Record<string, unknown> | null;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export class PostgresNodeControlA2aExposureRepository implements NodeControlA2aExposureRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(exposureId: string, version: number) {
    const result = await this.#pool.query<ExposureRow>(
      `${exposureSelect} WHERE exposure_id=$1 AND version=$2`,
      [exposureId, version],
    );
    return result.rows[0] === undefined ? undefined : mapExposure(result.rows[0]);
  }

  async list(status: string | undefined, limit: number) {
    const result = await this.#pool.query<ExposureRow>(
      `${exposureSelect} WHERE ($1::text IS NULL OR status=$1)
       ORDER BY exposure_id,version DESC LIMIT $2`,
      [status ?? null, limit],
    );
    return Object.freeze(result.rows.map(mapExposure));
  }

  async listPublished() {
    return this.list('published', 1_000);
  }

  async create(exposure: A2aExposureVersion, command: A2aCommandContext) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `a2a-exposure:${exposure.exposureId}:${String(exposure.version)}`,
      ]);
      const replay = await readReceipt(client, command);
      if (replay !== undefined) {
        const existing = await this.find(exposure.exposureId, exposure.version);
        if (existing === undefined) throw new Error('A2A_EXPOSURE_RECEIPT_DANGLING');
        await client.query('COMMIT');
        return existing;
      }
      await client.query(
        `INSERT INTO sdar_control.a2a_exposure_version(
           exposure_id,version,capability_id,capability_version,agent_skill_id,name,description,
           tags,examples,input_modes,output_modes,request_schema,result_schema,visibility,
           requester_policy,readiness_publication_policy,status,exposure_hash,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,
                $14,$15::jsonb,$16,$17,$18,$19,$19)`,
        exposureValues(exposure, command.occurredAt),
      );
      await insertReceipt(client, command, exposure.exposureId, exposure.version, null);
      await insertAudit(client, exposure, command, 'a2a.exposure_created');
      await client.query('COMMIT');
      return exposure;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findCommandReplay(_scope: string, command: A2aCommandContext) {
    const receipt = await readReceipt(this.#pool, command);
    if (receipt?.operation_id === null || receipt === undefined) return undefined;
    return findOperation(this.#pool, receipt.operation_id);
  }

  async transition(
    prior: A2aExposureVersion,
    next: A2aExposureVersion,
    operation: ManagementOperation,
    command: A2aCommandContext,
  ) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `a2a-exposure:${prior.exposureId}:${String(prior.version)}`,
      ]);
      const current = await client.query<{ status: A2aExposureStatus }>(
        `SELECT status FROM sdar_control.a2a_exposure_version WHERE exposure_id=$1 AND version=$2`,
        [prior.exposureId, prior.version],
      );
      if (current.rows[0]?.status !== prior.status)
        throw new Error('A2A_EXPOSURE_CONCURRENT_CHANGE');
      await client.query(
        `UPDATE sdar_control.a2a_exposure_version SET status=$3,updated_at=$4
          WHERE exposure_id=$1 AND version=$2`,
        [prior.exposureId, prior.version, next.status, command.occurredAt],
      );
      const completed = completeOperation(operation, command.occurredAt, next);
      await insertOperation(client, completed);
      await insertReceipt(client, command, next.exposureId, next.version, completed.operationId);
      await insertAudit(client, next, command, `a2a.exposure_${next.status}`);
      await client.query('COMMIT');
      return completed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async nextAgentCardRevision() {
    const result = await this.#pool.query<{ revision: string }>(
      "SELECT nextval('sdar_control.agent_card_revision_sequence') AS revision",
    );
    return Number(result.rows[0]?.revision ?? 1);
  }

  async findActiveAgentCard() {
    const result = await this.#pool.query<CardRow>(
      `${cardSelect} WHERE status='active' ORDER BY revision DESC LIMIT 1`,
    );
    return result.rows[0] === undefined ? undefined : mapCard(result.rows[0]);
  }

  async saveCandidate(candidate: RuntimeAgentCardCandidate) {
    await this.#pool.query(
      `INSERT INTO sdar_control.agent_card_revision(
         revision,node_id,exposure_refs,content_hash,capability_catalog_hash,status,card,generated_at)
       VALUES($1,$2,$3::jsonb,$4,$5,'candidate',$6::jsonb,$7)`,
      [
        candidate.revision.revision,
        candidate.revision.nodeId,
        JSON.stringify(candidate.revision.exposureRefs ?? []),
        candidate.revision.contentHash,
        candidate.revision.capabilityCatalogHash,
        JSON.stringify(candidate.card),
        candidate.revision.generatedAt,
      ],
    );
    return candidate.revision;
  }

  async markAgentCard(
    revision: number,
    status: AgentCardRevisionStatus,
    activatedAt?: string,
    rejectionCode?: string,
  ) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('agent-card-active'))");
      if (status === 'active')
        await client.query(
          "UPDATE sdar_control.agent_card_revision SET status='superseded' WHERE status='active' AND revision<>$1",
          [revision],
        );
      const result = await client.query<CardRow>(
        `UPDATE sdar_control.agent_card_revision
            SET status=$2,activated_at=$3,rejection_code=$4
          WHERE revision=$1 RETURNING revision,node_id,exposure_refs,content_hash,
            capability_catalog_hash,status,generated_at,activated_at,rejection_code`,
        [revision, status, activatedAt ?? null, rejectionCode ?? null],
      );
      if (result.rows[0] === undefined) throw new Error('AGENT_CARD_REVISION_NOT_FOUND');
      await client.query('COMMIT');
      return mapCard(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listAgentCards(limit: number) {
    const result = await this.#pool.query<CardRow>(
      `${cardSelect} ORDER BY revision DESC LIMIT $1`,
      [limit],
    );
    return Object.freeze(result.rows.map(mapCard));
  }

  async findAgentCard(revision: number) {
    const result = await this.#pool.query<CardRow>(`${cardSelect} WHERE revision=$1`, [revision]);
    return result.rows[0] === undefined ? undefined : mapCard(result.rows[0]);
  }

  async transitionOperation(
    _operation: ManagementOperation,
    command: A2aCommandContext,
    completed: ManagementOperation,
  ) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await readReceipt(client, command);
      if (replay?.operation_id !== null && replay !== undefined) {
        const existing = await findOperation(client, replay.operation_id);
        if (existing === undefined) throw new Error('A2A_OPERATION_RECEIPT_DANGLING');
        await client.query('COMMIT');
        return existing;
      }
      await insertOperation(client, completed);
      await insertReceipt(
        client,
        command,
        completed.target.id,
        Number(completed.target.version),
        completed.operationId,
      );
      await client.query('COMMIT');
      return completed;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

const exposureSelect = `SELECT exposure_id,version,capability_id,capability_version,agent_skill_id,
  name,description,tags,examples,input_modes,output_modes,request_schema,result_schema,visibility,
  requester_policy,readiness_publication_policy,status,exposure_hash
  FROM sdar_control.a2a_exposure_version`;
const cardSelect = `SELECT revision,node_id,exposure_refs,content_hash,capability_catalog_hash,status,
  generated_at,activated_at,rejection_code FROM sdar_control.agent_card_revision`;

function exposureValues(exposure: A2aExposureVersion, occurredAt: string): unknown[] {
  return [
    exposure.exposureId,
    exposure.version,
    exposure.capabilityId,
    exposure.capabilityVersion,
    exposure.agentSkillId,
    exposure.name,
    exposure.description,
    JSON.stringify(exposure.tags ?? []),
    JSON.stringify(exposure.examples ?? []),
    JSON.stringify(exposure.inputModes ?? []),
    JSON.stringify(exposure.outputModes ?? []),
    JSON.stringify(exposure.requestSchema),
    JSON.stringify(exposure.resultSchema),
    exposure.visibility,
    exposure.requesterPolicy === undefined ? null : JSON.stringify(exposure.requesterPolicy),
    exposure.readinessPublicationPolicy ?? 'publish_when_available',
    exposure.status,
    exposure.exposureHash,
    occurredAt,
  ];
}

function mapExposure(row: ExposureRow): A2aExposureVersion {
  return createA2aExposureVersion({
    exposureId: row.exposure_id,
    version: Number(row.version),
    capabilityId: row.capability_id,
    capabilityVersion: Number(row.capability_version),
    agentSkillId: row.agent_skill_id,
    name: row.name,
    description: row.description,
    tags: row.tags,
    examples: row.examples,
    inputModes: row.input_modes,
    outputModes: row.output_modes,
    requestSchema: row.request_schema,
    resultSchema: row.result_schema,
    visibility: row.visibility,
    ...(row.requester_policy === null ? {} : { requesterPolicy: row.requester_policy }),
    readinessPublicationPolicy: row.readiness_publication_policy,
    status: row.status,
    exposureHash: row.exposure_hash.trim(),
  });
}

function mapCard(row: CardRow): AgentCardRevision {
  return Object.freeze({
    revision: Number(row.revision),
    nodeId: row.node_id,
    exposureRefs: Object.freeze(row.exposure_refs),
    contentHash: row.content_hash.trim(),
    capabilityCatalogHash: row.capability_catalog_hash.trim(),
    status: row.status,
    generatedAt: row.generated_at.toISOString(),
    ...(row.activated_at === null ? {} : { activatedAt: row.activated_at.toISOString() }),
    ...(row.rejection_code === null ? {} : { rejectionCode: row.rejection_code }),
  });
}

function completeOperation(
  operation: ManagementOperation,
  occurredAt: string,
  result: unknown,
): ManagementOperation {
  return Object.freeze({
    ...operation,
    status: 'succeeded',
    result,
    startedAt: occurredAt,
    completedAt: occurredAt,
  });
}

async function readReceipt(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  command: A2aCommandContext,
) {
  const result = await database.query<{ request_hash: string; operation_id: string | null }>(
    `SELECT request_hash::text,operation_id FROM sdar_control.configuration_command_receipt
      WHERE command_scope=$1 AND idempotency_key_hash=$2`,
    [command.scope, hash(command.idempotencyKey)],
  );
  const row = result.rows[0];
  if (row !== undefined && row.request_hash.trim() !== command.requestHash)
    throw new Error('IDEMPOTENCY_KEY_REUSED');
  return row;
}

function insertReceipt(
  client: PoolClient,
  command: A2aCommandContext,
  id: string,
  version: number,
  operationId: string | null,
) {
  return client.query(
    `INSERT INTO sdar_control.configuration_command_receipt(
       command_scope,idempotency_key_hash,request_hash,configuration_id,revision,operation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      command.scope,
      hash(command.idempotencyKey),
      command.requestHash,
      id,
      version,
      operationId,
      command.occurredAt,
    ],
  );
}

function insertOperation(client: PoolClient, operation: ManagementOperation) {
  return client.query(
    `INSERT INTO sdar_control.management_operation(
       operation_id,operation_type,target_type,target_id,target_version,target_revision,status,
       idempotency_key_hash,input_hash,actor_id,reason,result,error_code,created_at,started_at,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)`,
    [
      operation.operationId,
      operation.operationType,
      operation.target.type,
      operation.target.id,
      operation.target.version ?? null,
      operation.target.revision ?? null,
      operation.status,
      operation.idempotencyKeyHash,
      operation.inputHash,
      operation.actorId,
      operation.reason,
      operation.result === undefined ? null : JSON.stringify(operation.result),
      operation.errorCode ?? null,
      operation.createdAt,
      operation.startedAt ?? null,
      operation.completedAt ?? null,
    ],
  );
}

function insertAudit(
  client: PoolClient,
  exposure: A2aExposureVersion,
  command: A2aCommandContext,
  resultCode: string,
) {
  return client.query(
    `INSERT INTO sdar_control.control_audit_event(
       audit_id,actor_id,action,aggregate_type,aggregate_id,result_revision,reason,request_hash,result_code,created_at)
     VALUES(gen_random_uuid()::text,'node-control-api','a2a.exposure.command','a2a_exposure',$1,$2,$3,$4,$5,$6)`,
    [
      exposure.exposureId,
      exposure.version,
      command.scope,
      command.requestHash,
      resultCode,
      command.occurredAt,
    ],
  );
}

async function findOperation(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  operationId: string,
) {
  const result = await database.query<OperationRow>(
    'SELECT * FROM sdar_control.management_operation WHERE operation_id=$1',
    [operationId],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return Object.freeze({
    operationId: row.operation_id,
    operationType: row.operation_type,
    target: Object.freeze({
      type: row.target_type,
      id: row.target_id,
      ...(row.target_version === null ? {} : { version: row.target_version }),
      ...(row.target_revision === null ? {} : { revision: Number(row.target_revision) }),
    }),
    status: row.status,
    actorId: row.actor_id,
    reason: row.reason,
    idempotencyKeyHash: row.idempotency_key_hash.trim(),
    inputHash: row.input_hash.trim(),
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: row.created_at.toISOString(),
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  }) as ManagementOperation;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
