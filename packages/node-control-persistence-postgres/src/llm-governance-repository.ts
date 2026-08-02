import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  NodeControlLlmGovernanceError,
  type ConfigurationMutationContext,
  type NodeControlLlmGovernanceRepository,
} from '../../node-control-application/src/index.js';
import {
  rehydrateLlmProviderDefinition,
  rehydrateModelRouteDefinition,
  routeScopeIdentity,
  transitionManagementOperation,
  type LlmProviderDefinition,
  type ManagementOperation,
  type ModelRouteDefinition,
} from '../../node-control-domain/src/index.js';

interface ProviderRow extends QueryResultRow {
  provider_id: string;
  revision: string;
  provider_type: LlmProviderDefinition['providerType'];
  base_url: string;
  credential_ref: string;
  model_catalog: LlmProviderDefinition['models'];
  health_policy: LlmProviderDefinition['healthPolicy'];
  rate_limit_policy: LlmProviderDefinition['rateLimitPolicy'];
  status: LlmProviderDefinition['status'];
  secret_status: LlmProviderDefinition['secretStatus'];
  last_validated_at: Date | null;
}

interface RouteRow extends QueryResultRow {
  route_id: string;
  revision: string;
  stage: ModelRouteDefinition['stage'];
  primary_candidate: ModelRouteDefinition['primary'];
  fallback_candidates: ModelRouteDefinition['fallbacks'];
  budget_policy: ModelRouteDefinition['budgetPolicy'];
  status: ModelRouteDefinition['status'];
}

interface ReceiptRow extends QueryResultRow {
  request_hash: string;
  configuration_id: string | null;
  revision: string | null;
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

export class PostgresNodeControlLlmGovernanceRepository implements NodeControlLlmGovernanceRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  createProvider(
    definition: LlmProviderDefinition,
    context: ConfigurationMutationContext,
  ): Promise<LlmProviderDefinition> {
    return this.transaction(async (client) => {
      const replay = await readReceipt(client, 'llm-provider:create', context);
      if (replay !== undefined) {
        const provider = await findProvider(
          client,
          replay.configuration_id ?? '',
          Number(replay.revision),
        );
        if (provider === undefined) throw new Error('CONTROL_LLM_PROVIDER_RECEIPT_DANGLING');
        return provider;
      }
      await client.query(
        `INSERT INTO sdar_control.llm_provider_definition(
           provider_id,revision,provider_type,base_url,credential_ref,model_catalog,
           health_policy,rate_limit_policy,status,secret_status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$11)`,
        [
          definition.providerId,
          definition.revision,
          definition.providerType,
          definition.baseUrl,
          definition.credentialRef,
          JSON.stringify(definition.models),
          JSON.stringify(definition.healthPolicy),
          JSON.stringify(definition.rateLimitPolicy),
          definition.status,
          definition.secretStatus,
          context.occurredAt,
        ],
      );
      await insertReceipt(
        client,
        'llm-provider:create',
        context,
        definition.providerId,
        definition.revision,
      );
      await insertAudit(
        client,
        'llm_provider.create',
        'llm_provider',
        definition.providerId,
        definition.revision,
        context,
      );
      return definition;
    });
  }

  findProvider(providerId: string, revision?: number): Promise<LlmProviderDefinition | undefined> {
    return findProvider(this.#pool, providerId, revision);
  }

  async listProviders(limit: number): Promise<readonly LlmProviderDefinition[]> {
    const result = await this.#pool.query<ProviderRow>(
      `SELECT DISTINCT ON (provider_id) *
         FROM sdar_control.llm_provider_definition
        ORDER BY provider_id,revision DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapProvider);
  }

  validateProvider(
    providerId: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    return this.transaction(async (client) => {
      const replay = await readReceipt(client, 'llm-provider:validate', context);
      if (replay?.operation_id !== null && replay?.operation_id !== undefined) {
        const previous = await findOperation(client, replay.operation_id);
        if (previous === undefined) throw new Error('CONTROL_LLM_OPERATION_RECEIPT_DANGLING');
        return previous;
      }
      const provider = await findProvider(client, providerId);
      if (provider === undefined)
        throw new NodeControlLlmGovernanceError(
          'LLM_PROVIDER_NOT_FOUND',
          'LLM Provider was not found.',
        );
      const running = transitionManagementOperation(operation, 'running', context.occurredAt);
      const succeeded = transitionManagementOperation(running, 'succeeded', context.occurredAt, {
        result: Object.freeze({
          validation: 'static_catalog_and_policy',
          credentialResolution: 'runtime_required',
          modelCount: provider.models.length,
        }),
      });
      await insertOperation(client, succeeded);
      await insertReceipt(
        client,
        'llm-provider:validate',
        context,
        providerId,
        provider.revision,
        succeeded.operationId,
      );
      await insertAudit(
        client,
        'llm_provider.validate',
        'llm_provider',
        providerId,
        provider.revision,
        context,
      );
      return succeeded;
    });
  }

  createRoute(
    definition: ModelRouteDefinition,
    context: ConfigurationMutationContext,
  ): Promise<ModelRouteDefinition> {
    return this.transaction(async (client) => {
      const replay = await readReceipt(client, 'model-route:create', context);
      if (replay !== undefined) {
        const route = await findRoute(
          client,
          replay.configuration_id ?? '',
          Number(replay.revision),
        );
        if (route === undefined) throw new Error('CONTROL_MODEL_ROUTE_RECEIPT_DANGLING');
        return route;
      }
      const scope = routeScopeIdentity(definition);
      const conflict = await client.query<{ route_id: string }>(
        `SELECT route_id FROM sdar_control.model_route_definition
          WHERE stage=$1 AND scope_type=$2 AND scope_key=$3 AND route_id<>$4
            AND status IN ('draft','active')
          LIMIT 1`,
        [
          definition.stage,
          definition.budgetPolicy.selector.scope,
          definition.budgetPolicy.selector.key ?? '',
          definition.routeId,
        ],
      );
      if (conflict.rows[0] !== undefined)
        throw new NodeControlLlmGovernanceError(
          'MODEL_ROUTE_CONFLICT',
          `A Model Route already owns selector ${scope}.`,
        );
      await client.query(
        `INSERT INTO sdar_control.model_route_definition(
           route_id,revision,stage,primary_candidate,fallback_candidates,budget_policy,
           status,created_at,updated_at)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$8)`,
        [
          definition.routeId,
          definition.revision,
          definition.stage,
          JSON.stringify(definition.primary),
          JSON.stringify(definition.fallbacks),
          JSON.stringify(definition.budgetPolicy),
          definition.status,
          context.occurredAt,
        ],
      );
      await insertReceipt(
        client,
        'model-route:create',
        context,
        definition.routeId,
        definition.revision,
      );
      await insertAudit(
        client,
        'model_route.create',
        'model_route',
        definition.routeId,
        definition.revision,
        context,
      );
      return definition;
    });
  }

  findRoute(routeId: string, revision?: number): Promise<ModelRouteDefinition | undefined> {
    return findRoute(this.#pool, routeId, revision);
  }

  async listRoutes(limit: number): Promise<readonly ModelRouteDefinition[]> {
    const result = await this.#pool.query<RouteRow>(
      `SELECT DISTINCT ON (route_id) *
         FROM sdar_control.model_route_definition
        ORDER BY route_id,revision DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapRoute);
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

async function findProvider(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  providerId: string,
  revision?: number,
): Promise<LlmProviderDefinition | undefined> {
  const result = await database.query<ProviderRow>(
    `SELECT * FROM sdar_control.llm_provider_definition
      WHERE provider_id=$1 AND ($2::bigint IS NULL OR revision=$2)
      ORDER BY revision DESC LIMIT 1`,
    [providerId, revision ?? null],
  );
  return result.rows[0] === undefined ? undefined : mapProvider(result.rows[0]);
}

async function findRoute(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  routeId: string,
  revision?: number,
): Promise<ModelRouteDefinition | undefined> {
  const result = await database.query<RouteRow>(
    `SELECT * FROM sdar_control.model_route_definition
      WHERE route_id=$1 AND ($2::bigint IS NULL OR revision=$2)
      ORDER BY revision DESC LIMIT 1`,
    [routeId, revision ?? null],
  );
  return result.rows[0] === undefined ? undefined : mapRoute(result.rows[0]);
}

async function readReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
): Promise<ReceiptRow | undefined> {
  const result = await client.query<ReceiptRow>(
    `SELECT request_hash::text,configuration_id,revision::text,operation_id
       FROM sdar_control.configuration_command_receipt
      WHERE command_scope=$1 AND idempotency_key_hash=$2`,
    [scope, context.idempotencyKeyHash],
  );
  const receipt = result.rows[0];
  if (receipt !== undefined && receipt.request_hash !== context.requestHash)
    throw new NodeControlLlmGovernanceError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was already used for a different command.',
    );
  return receipt;
}

function insertReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
  id: string,
  revision: number,
  operationId?: string,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.configuration_command_receipt(
       command_scope,idempotency_key_hash,request_hash,configuration_id,revision,operation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope,
      context.idempotencyKeyHash,
      context.requestHash,
      id,
      revision,
      operationId ?? null,
      context.occurredAt,
    ],
  );
}

function insertAudit(
  client: PoolClient,
  action: string,
  aggregateType: string,
  aggregateId: string,
  revision: number,
  context: ConfigurationMutationContext,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.control_audit_event(
       audit_id,actor_id,action,aggregate_type,aggregate_id,result_revision,
       reason,request_hash,result_code,created_at)
     VALUES(gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,'accepted',$8)`,
    [
      context.actorId,
      action,
      aggregateType,
      aggregateId,
      revision,
      context.reason,
      context.requestHash,
      context.occurredAt,
    ],
  );
}

function insertOperation(client: PoolClient, operation: ManagementOperation): Promise<unknown> {
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

async function findOperation(
  client: PoolClient,
  operationId: string,
): Promise<ManagementOperation | undefined> {
  const result = await client.query<OperationRow>(
    'SELECT * FROM sdar_control.management_operation WHERE operation_id=$1',
    [operationId],
  );
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : Object.freeze({
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
        idempotencyKeyHash: row.idempotency_key_hash,
        inputHash: row.input_hash,
        ...(row.result === null ? {} : { result: row.result }),
        ...(row.error_code === null ? {} : { errorCode: row.error_code }),
        createdAt: row.created_at.toISOString(),
        ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
        ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
      });
}

function mapProvider(row: ProviderRow): LlmProviderDefinition {
  return rehydrateLlmProviderDefinition({
    providerId: row.provider_id,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    credentialRef: row.credential_ref,
    models: row.model_catalog,
    healthPolicy: row.health_policy,
    rateLimitPolicy: row.rate_limit_policy,
    status: row.status,
    secretStatus: row.secret_status,
    ...(row.last_validated_at === null
      ? {}
      : { lastValidatedAt: row.last_validated_at.toISOString() }),
    revision: Number(row.revision),
  });
}

function mapRoute(row: RouteRow): ModelRouteDefinition {
  return rehydrateModelRouteDefinition({
    routeId: row.route_id,
    stage: row.stage,
    primary: row.primary_candidate,
    fallbacks: row.fallback_candidates,
    budgetPolicy: row.budget_policy,
    status: row.status,
    revision: Number(row.revision),
  });
}
