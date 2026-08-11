import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  NodeControlCapabilityError,
  type ConfigurationMutationContext,
  type NodeControlCapabilityRepository,
} from '../../node-control-application/src/index.js';
import {
  createCapabilityImplementationBinding,
  createNodeCapabilityDefinition,
  type CapabilityImplementationBinding,
  type JsonObject,
  type JsonValue,
  type ManagementOperation,
  type NodeCapabilityDefinitionVersion,
  type NodeCapabilityStatus,
} from '../../node-control-domain/src/index.js';

interface CapabilityRow extends QueryResultRow {
  capability_id: string;
  version: string;
  domain: string;
  name: string;
  description: string;
  input_schema: JsonObject;
  output_schema: JsonObject;
  success_criteria: JsonObject[];
  required_evidence: JsonObject[];
  effects: string[];
  artifacts: string[];
  constraints: JsonObject[];
  supported_modes: string[];
  risk_level: NodeCapabilityDefinitionVersion['riskLevel'];
  status: NodeCapabilityStatus;
  definition_hash: string;
  previous_version: string | null;
  created_by: string | null;
  created_at: Date | null;
}

interface BindingRow extends QueryResultRow {
  binding_id: string;
  capability_id: string;
  capability_version: string;
  implementation_type: CapabilityImplementationBinding['implementationType'];
  implementation_id: string;
  implementation_version: string;
  role: CapabilityImplementationBinding['role'];
  priority: number;
  activation_condition: JsonValue | null;
  provider_policy_override: JsonValue | null;
  has_provider_policy_override: boolean;
  status: CapabilityImplementationBinding['status'];
  revision: string;
}

interface ReceiptRow extends QueryResultRow {
  request_hash: string;
  operation_id: string | null;
}

interface OperationRow extends QueryResultRow {
  operation_id: string;
  operation_type: string;
  target_type: string;
  target_id: string;
  target_version: string | null;
  target_revision: string | null;
  status: ManagementOperation['status'];
  idempotency_key_hash: string;
  input_hash: string;
  actor_id: string;
  reason: string;
  result: unknown;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export class PostgresNodeControlCapabilityRepository implements NodeControlCapabilityRepository {
  readonly #pool: Pool;
  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createDraft(
    capability: NodeCapabilityDefinitionVersion,
    context: ConfigurationMutationContext,
  ) {
    try {
      return await this.transaction(async (client) => {
        await lockCapability(client, capability.capabilityId, capability.version);
        const receipt = await readReceipt(client, 'capability:create', context);
        if (receipt !== undefined) {
          const replay = await findCapability(client, capability.capabilityId, capability.version);
          if (replay === undefined) throw new Error('CONTROL_CAPABILITY_RECEIPT_DANGLING');
          return replay;
        }
        if (
          (await findCapability(client, capability.capabilityId, capability.version)) !== undefined
        )
          throw new NodeControlCapabilityError(
            'NODE_CAPABILITY_CONFLICT',
            'Capability Version already exists.',
          );
        await insertCapability(client, capability, context.occurredAt);
        await insertReceipt(
          client,
          'capability:create',
          context,
          capability.capabilityId,
          capability.version,
          null,
        );
        await insertAudit(client, capability, context, 'capability_draft_created');
        return capability;
      });
    } catch (error) {
      if (postgresCode(error) === '23505')
        throw new NodeControlCapabilityError(
          'NODE_CAPABILITY_CONFLICT',
          'Capability Version already exists.',
        );
      throw error;
    }
  }

  async find(capabilityId: string, version: number) {
    return findCapability(this.#pool, capabilityId, version);
  }

  async list(status: string | undefined, limit: number) {
    const result = await this.#pool.query<CapabilityRow>(
      `SELECT * FROM sdar_control.node_capability_definition_version
        WHERE ($1::text IS NULL OR status=$1)
        ORDER BY capability_id,version DESC LIMIT $2`,
      [status ?? null, limit],
    );
    return result.rows.map(mapCapability);
  }

  async createImplementation(
    binding: CapabilityImplementationBinding,
    context: ConfigurationMutationContext,
  ) {
    try {
      return await this.transaction(async (client) => {
        await lockCapability(client, binding.capabilityId, binding.capabilityVersion);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `capability-implementation:${binding.bindingId}`,
        ]);
        const receipt = await readReceipt(client, 'capability-implementation:create', context);
        if (receipt !== undefined) {
          const replay = await findBinding(client, binding.bindingId, binding.revision);
          if (replay === undefined) throw new Error('CONTROL_CAPABILITY_RECEIPT_DANGLING');
          return replay;
        }
        const capability = await findCapability(
          client,
          binding.capabilityId,
          binding.capabilityVersion,
        );
        if (capability?.status !== 'draft' && capability?.status !== 'validating') conflict();
        await client.query(
          `INSERT INTO sdar_control.capability_implementation_binding(
           binding_id,revision,capability_id,capability_version,implementation_type,
           implementation_id,implementation_version,role,priority,activation_condition,
           provider_policy_override,status,created_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)`,
          [
            binding.bindingId,
            binding.revision,
            binding.capabilityId,
            binding.capabilityVersion,
            binding.implementationType,
            binding.implementationId,
            binding.implementationVersion,
            binding.role,
            binding.priority,
            binding.activationCondition === undefined
              ? null
              : JSON.stringify(binding.activationCondition),
            binding.providerPolicyOverride === undefined
              ? null
              : JSON.stringify(binding.providerPolicyOverride),
            binding.status,
            context.occurredAt,
          ],
        );
        await insertReceipt(
          client,
          'capability-implementation:create',
          context,
          binding.bindingId,
          binding.revision,
          null,
        );
        await insertBindingAudit(client, binding, context);
        return binding;
      });
    } catch (error) {
      if (postgresCode(error) === '23505')
        throw new NodeControlCapabilityError(
          'NODE_CAPABILITY_CONFLICT',
          'Capability Implementation Binding revision already exists.',
        );
      throw error;
    }
  }

  async listImplementations(capabilityId: string, version: number, limit: number) {
    const result = await this.#pool.query<BindingRow>(
      `SELECT DISTINCT ON (binding_id) *,
              provider_policy_override IS NOT NULL AS has_provider_policy_override
         FROM sdar_control.capability_implementation_binding
        WHERE capability_id=$1 AND capability_version=$2
        ORDER BY binding_id,revision DESC LIMIT $3`,
      [capabilityId, version, limit],
    );
    return result.rows
      .map(mapBinding)
      .sort(
        (left, right) =>
          left.priority - right.priority || left.bindingId.localeCompare(right.bindingId),
      );
  }

  async validate(
    prior: NodeCapabilityDefinitionVersion,
    validating: NodeCapabilityDefinitionVersion,
    context: ConfigurationMutationContext,
  ) {
    return this.transaction(async (client) => {
      await lockCapability(client, prior.capabilityId, prior.version);
      const receipt = await readReceipt(client, 'capability:validate', context);
      if (receipt !== undefined) {
        const replay = await findCapability(client, prior.capabilityId, prior.version);
        if (replay === undefined) throw new Error('CONTROL_CAPABILITY_RECEIPT_DANGLING');
        return replay;
      }
      const updated = await client.query(
        `UPDATE sdar_control.node_capability_definition_version
            SET status='validating',updated_at=$3
          WHERE capability_id=$1 AND version=$2 AND status='draft'`,
        [prior.capabilityId, prior.version, context.occurredAt],
      );
      if (updated.rowCount !== 1 && prior.status !== 'validating') conflict();
      await insertReceipt(
        client,
        'capability:validate',
        context,
        prior.capabilityId,
        prior.version,
        null,
      );
      await insertAudit(client, validating, context, 'capability_validated');
      return validating;
    });
  }

  async findCommandReplay(scope: string, context: ConfigurationMutationContext) {
    const receipt = await readReceipt(this.#pool, scope, context);
    if (receipt?.operation_id === null || receipt?.operation_id === undefined) return undefined;
    const operation = await findOperation(this.#pool, receipt.operation_id);
    if (operation === undefined) throw new Error('CONTROL_CAPABILITY_RECEIPT_DANGLING');
    return operation;
  }

  async hasCommandReceipt(scope: string, context: ConfigurationMutationContext) {
    return (await readReceipt(this.#pool, scope, context)) !== undefined;
  }

  async findImplementationReplay(
    context: ConfigurationMutationContext,
    bindingId: string,
    revision: number,
  ) {
    const receipt = await readReceipt(this.#pool, 'capability-implementation:create', context);
    if (receipt === undefined) return undefined;
    const binding = await findBinding(this.#pool, bindingId, revision);
    if (binding === undefined) throw new Error('CONTROL_CAPABILITY_RECEIPT_DANGLING');
    return binding;
  }

  async transition(
    prior: NodeCapabilityDefinitionVersion,
    next: NodeCapabilityDefinitionVersion,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    resultCode: string,
  ) {
    const scope = `capability:${next.status}`;
    return this.transaction(async (client) => {
      await lockCapability(client, prior.capabilityId, prior.version);
      const receipt = await readReceipt(client, scope, context);
      if (receipt?.operation_id !== null && receipt?.operation_id !== undefined) {
        const replay = await findOperation(client, receipt.operation_id);
        if (replay === undefined) throw new Error('CONTROL_CAPABILITY_RECEIPT_DANGLING');
        return replay;
      }
      const updated = await client.query(
        `UPDATE sdar_control.node_capability_definition_version
            SET status=$3,updated_at=$4
          WHERE capability_id=$1 AND version=$2 AND status=$5 AND definition_hash=$6`,
        [
          prior.capabilityId,
          prior.version,
          next.status,
          context.occurredAt,
          prior.status,
          prior.definitionHash,
        ],
      );
      if (updated.rowCount !== 1) conflict();
      await insertOperation(client, operation);
      await insertReceipt(
        client,
        scope,
        context,
        prior.capabilityId,
        prior.version,
        operation.operationId,
      );
      await insertAudit(client, next, context, resultCode);
      return operation;
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function insertCapability(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  capability: NodeCapabilityDefinitionVersion,
  updatedAt: string,
) {
  return database.query(
    `INSERT INTO sdar_control.node_capability_definition_version(
       capability_id,version,domain,name,description,input_schema,output_schema,success_criteria,
       required_evidence,effects,artifacts,constraints,supported_modes,risk_level,status,
       definition_hash,previous_version,created_by,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
            $12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19,$20)`,
    [
      capability.capabilityId,
      capability.version,
      capability.domain,
      capability.name,
      capability.description,
      JSON.stringify(capability.inputSchema),
      JSON.stringify(capability.outputSchema),
      JSON.stringify(capability.successCriteria),
      JSON.stringify(capability.requiredEvidence),
      JSON.stringify(capability.effects ?? []),
      JSON.stringify(capability.artifacts ?? []),
      JSON.stringify(capability.constraints ?? []),
      JSON.stringify(capability.supportedModes ?? []),
      capability.riskLevel,
      capability.status,
      capability.definitionHash,
      capability.previousVersion ?? null,
      capability.createdBy ?? null,
      capability.createdAt ?? null,
      updatedAt,
    ],
  );
}

async function findCapability(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  capabilityId: string,
  version: number,
) {
  const result = await database.query<CapabilityRow>(
    `SELECT * FROM sdar_control.node_capability_definition_version
      WHERE capability_id=$1 AND version=$2`,
    [capabilityId, version],
  );
  return result.rows[0] === undefined ? undefined : mapCapability(result.rows[0]);
}

async function findBinding(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  bindingId: string,
  revision: number,
) {
  const result = await database.query<BindingRow>(
    `SELECT *,provider_policy_override IS NOT NULL AS has_provider_policy_override
       FROM sdar_control.capability_implementation_binding
      WHERE binding_id=$1 AND revision=$2`,
    [bindingId, revision],
  );
  return result.rows[0] === undefined ? undefined : mapBinding(result.rows[0]);
}

function mapCapability(row: CapabilityRow): NodeCapabilityDefinitionVersion {
  return createNodeCapabilityDefinition({
    capabilityId: row.capability_id,
    version: Number(row.version),
    domain: row.domain,
    name: row.name,
    description: row.description,
    inputSchema: row.input_schema,
    outputSchema: row.output_schema,
    successCriteria: row.success_criteria,
    requiredEvidence: row.required_evidence,
    effects: row.effects,
    artifacts: row.artifacts,
    constraints: row.constraints,
    supportedModes: row.supported_modes,
    riskLevel: row.risk_level,
    status: row.status,
    definitionHash: row.definition_hash.trim(),
    ...(row.previous_version === null ? {} : { previousVersion: Number(row.previous_version) }),
    ...(row.created_by === null ? {} : { createdBy: row.created_by }),
    ...(row.created_at === null ? {} : { createdAt: row.created_at.toISOString() }),
  });
}

function mapBinding(row: BindingRow): CapabilityImplementationBinding {
  return createCapabilityImplementationBinding({
    bindingId: row.binding_id,
    capabilityId: row.capability_id,
    capabilityVersion: Number(row.capability_version),
    implementationType: row.implementation_type,
    implementationId: row.implementation_id,
    implementationVersion: row.implementation_version,
    role: row.role,
    priority: row.priority,
    ...(row.activation_condition === null ? {} : { activationCondition: row.activation_condition }),
    ...(row.has_provider_policy_override
      ? { providerPolicyOverride: row.provider_policy_override }
      : {}),
    status: row.status,
    revision: Number(row.revision),
  });
}

async function readReceipt(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  scope: string,
  context: ConfigurationMutationContext,
) {
  const result = await database.query<ReceiptRow>(
    `SELECT request_hash::text,operation_id
       FROM sdar_control.configuration_command_receipt
      WHERE command_scope=$1 AND idempotency_key_hash=$2`,
    [scope, context.idempotencyKeyHash],
  );
  const receipt = result.rows[0];
  if (receipt !== undefined && receipt.request_hash.trim() !== context.requestHash)
    throw new NodeControlCapabilityError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was already used for a different command.',
    );
  return receipt;
}

function insertReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
  capabilityId: string,
  version: number,
  operationId: string | null,
) {
  return client.query(
    `INSERT INTO sdar_control.configuration_command_receipt(
       command_scope,idempotency_key_hash,request_hash,configuration_id,revision,operation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope,
      context.idempotencyKeyHash,
      context.requestHash,
      capabilityId,
      version,
      operationId,
      context.occurredAt,
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
  capability: NodeCapabilityDefinitionVersion,
  context: ConfigurationMutationContext,
  resultCode: string,
) {
  return client.query(
    `INSERT INTO sdar_control.control_audit_event(
       audit_id,actor_id,action,aggregate_type,aggregate_id,result_revision,reason,
       request_hash,result_code,created_at)
     VALUES(gen_random_uuid()::text,$1,'node_capability.command','node_capability',$2,$3,$4,$5,$6,$7)`,
    [
      context.actorId,
      capability.capabilityId,
      capability.version,
      context.reason,
      context.requestHash,
      resultCode,
      context.occurredAt,
    ],
  );
}

function insertBindingAudit(
  client: PoolClient,
  binding: CapabilityImplementationBinding,
  context: ConfigurationMutationContext,
) {
  return client.query(
    `INSERT INTO sdar_control.control_audit_event(
       audit_id,actor_id,action,aggregate_type,aggregate_id,result_revision,reason,
       request_hash,result_code,created_at)
     VALUES(gen_random_uuid()::text,$1,'capability_implementation.create',
            'capability_implementation_binding',$2,$3,$4,$5,'binding_created',$6)`,
    [
      context.actorId,
      binding.bindingId,
      binding.revision,
      context.reason,
      context.requestHash,
      context.occurredAt,
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
  }) satisfies ManagementOperation;
}

function lockCapability(client: PoolClient, capabilityId: string, version: number) {
  return client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `capability:${capabilityId}:${String(version)}`,
  ]);
}

function conflict(): never {
  throw new NodeControlCapabilityError(
    'NODE_CAPABILITY_CONFLICT',
    'Capability Version changed before the command completed.',
  );
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
