import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { taskChildScopeSql } from './gowm-work-scope.js';
import { remoteTaskScopeSql, remoteTaskChildScopeSql } from './gowm-mcp-ownership.js';
import type { Pool, QueryResultRow } from 'pg';

import type {
  RemoteTaskProviderExecutionLinkStore,
  RemoteTaskReconciliationAttempt,
  RemoteTaskReconciliationAttemptStore,
} from '../../application/src/index.js';
import { canonicalHash } from '../../application/src/index.js';
import {
  createRemoteTaskProviderExecutionLink,
  type RemoteTaskProviderExecutionLink,
} from '../../domain/src/index.js';

interface AttemptRow extends QueryResultRow {
  attempt_id: string;
  intent_id: string;
  logical_invocation_id: string;
  expected_intent_version: number | string;
  attempt_number: number | string;
  source_contract: RemoteTaskReconciliationAttempt['sourceContract'];
  request_hash: string;
  status: RemoteTaskReconciliationAttempt['status'];
  remote_task_id: string | null;
  external_execution_id: string | null;
  identity_validated: boolean;
  safe_error_code: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: number;
  result_hash: string;
  version: number | string;
}

interface LinkRow extends QueryResultRow {
  link_id: string;
  binding_id: string;
  logical_invocation_id: string;
  remote_task_id: string;
  provider_id: string;
  runtime_server_id: string;
  provider_binding_id: string | null;
  provider_origin_type: 'direct' | 'smpp_registry' | null;
  smpp_source_id: string | null;
  external_server_id: string | null;
  operation_name: string;
  execution_status: RemoteTaskProviderExecutionLink['executionStatus'];
  external_execution_id: string | null;
  mission_status: RemoteTaskProviderExecutionLink['missionStatus'];
  device_mission_id: string | null;
  provenance: RemoteTaskProviderExecutionLink['provenance'];
  source_contract: RemoteTaskProviderExecutionLink['sourceContract'];
  source_revision: string;
  observed_at: Date | string;
  content_hash: string;
}

export class PostgresRemoteTaskReconciliationAttemptStore implements RemoteTaskReconciliationAttemptStore {
  readonly #pool: Pool;

  readonly #deviceScope: DeviceWorkScope | undefined;

  constructor(pool: Pool, deviceScope?: DeviceWorkScope) {
    this.#pool = pool;
    this.#deviceScope = deviceScope;
  }

  async append(attempt: RemoteTaskReconciliationAttempt): Promise<RemoteTaskReconciliationAttempt> {
    const owner = taskChildScopeSql(this.#deviceScope, 18, 'owner_intent');
    await this.#pool.query(
      `INSERT INTO remote_task_reconciliation_attempt(
         attempt_id,intent_id,logical_invocation_id,expected_intent_version,attempt_number,
         source_contract,request_hash,status,remote_task_id,
         external_execution_id,identity_validated,safe_error_code,started_at,completed_at,
         duration_ms,result_hash,version)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
       WHERE EXISTS(SELECT 1 FROM remote_task_admission_intent owner_intent
         WHERE owner_intent.intent_id=$2 AND owner_intent.logical_invocation_id=$3 AND ${owner.predicate})
       ON CONFLICT DO NOTHING`,
      [
        attempt.attemptId,
        attempt.intentId,
        attempt.logicalInvocationId,
        attempt.expectedIntentVersion,
        attempt.attemptNumber,
        attempt.sourceContract,
        attempt.requestHash,
        attempt.status,
        attempt.remoteTaskId ?? null,
        attempt.externalExecutionId ?? null,
        attempt.identityValidated,
        attempt.safeErrorCode ?? null,
        attempt.startedAt,
        attempt.completedAt,
        attempt.durationMs,
        attempt.resultHash,
        attempt.version,
        ...owner.values,
      ],
    );
    const scope = reconciliationScopeSql(this.#deviceScope, 4);
    const result = await this.#pool.query<AttemptRow>(
      `SELECT * FROM remote_task_reconciliation_attempt
        WHERE (attempt_id=$1 OR (intent_id=$2 AND attempt_number=$3)) AND ${scope.predicate}
        ORDER BY attempt_id=$1 DESC LIMIT 1`,
      [attempt.attemptId, attempt.intentId, attempt.attemptNumber, ...scope.values],
    );
    const current = result.rows[0] === undefined ? undefined : mapAttempt(result.rows[0]);
    if (current === undefined || canonicalHash(current) !== canonicalHash(attempt))
      throw new Error('REMOTE_TASK_RECONCILIATION_ATTEMPT_CONFLICT');
    return current;
  }

  async nextAttemptNumber(intentId: string): Promise<number> {
    const scope = taskChildScopeSql(this.#deviceScope, 2, 'owner_intent');
    const result = await this.#pool.query<{ next_attempt: number | string }>(
      this.#deviceScope === undefined
        ? `SELECT COALESCE(MAX(attempt_number),0)+1 AS next_attempt FROM remote_task_reconciliation_attempt WHERE intent_id=$1`
        : `SELECT COALESCE(MAX(attempt.attempt_number),0)+1 AS next_attempt
           FROM remote_task_admission_intent owner_intent LEFT JOIN remote_task_reconciliation_attempt attempt ON attempt.intent_id=owner_intent.intent_id
           WHERE owner_intent.intent_id=$1 AND ${scope.predicate} GROUP BY owner_intent.intent_id`,
      [intentId, ...scope.values],
    );
    if (this.#deviceScope !== undefined && result.rows[0] === undefined)
      throw new Error('REMOTE_TASK_RECONCILIATION_INTENT_SCOPE_DENIED');
    return Number(result.rows[0]?.next_attempt ?? 1);
  }

  async listByIntentId(intentId: string): Promise<readonly RemoteTaskReconciliationAttempt[]> {
    const scope = reconciliationScopeSql(this.#deviceScope, 2);
    const result = await this.#pool.query<AttemptRow>(
      `SELECT * FROM remote_task_reconciliation_attempt
        WHERE intent_id=$1 AND ${scope.predicate} ORDER BY attempt_number`,
      [intentId, ...scope.values],
    );
    return result.rows.map(mapAttempt);
  }
}

export class PostgresRemoteTaskProviderExecutionLinkStore implements RemoteTaskProviderExecutionLinkStore {
  readonly #pool: Pool;

  readonly #deviceScope: DeviceWorkScope | undefined;

  constructor(pool: Pool, deviceScope?: DeviceWorkScope) {
    this.#pool = pool;
    this.#deviceScope = deviceScope;
  }

  async save(link: RemoteTaskProviderExecutionLink): Promise<RemoteTaskProviderExecutionLink> {
    const owner = remoteTaskScopeSql(this.#deviceScope, 21, 'owner_binding');
    await this.#pool.query(
      `INSERT INTO remote_task_provider_execution_link(
         link_id,binding_id,logical_invocation_id,remote_task_id,provider_id,operation_name,
         runtime_server_id,provider_binding_id,provider_origin_type,smpp_source_id,
         external_server_id,execution_status,external_execution_id,mission_status,
         device_mission_id,provenance,source_contract,source_revision,observed_at,content_hash)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
       WHERE (${this.#deviceScope === undefined ? 'TRUE' : 'FALSE'} OR EXISTS(SELECT 1 FROM remote_task_binding owner_binding
         WHERE owner_binding.binding_id=$2 AND owner_binding.remote_task_id=$4 AND owner_binding.server_id=$7
           AND owner_binding.operation_name=$6 AND ${owner.predicate}))
       ON CONFLICT DO NOTHING`,
      [
        link.linkId,
        link.bindingId,
        link.logicalInvocationId,
        link.remoteTaskId,
        link.providerId,
        link.operationName,
        link.runtimeServerId,
        link.providerBindingId ?? null,
        link.providerOriginType ?? null,
        link.smppSourceId ?? null,
        link.externalServerId ?? null,
        link.executionStatus,
        link.externalExecutionId ?? null,
        link.missionStatus,
        link.deviceMissionId ?? null,
        link.provenance,
        link.sourceContract,
        link.sourceRevision,
        link.observedAt,
        link.contentHash,
        ...owner.values,
      ],
    );
    const scope = remoteTaskChildScopeSql(
      this.#deviceScope,
      6,
      'remote_task_provider_execution_link',
    );
    const result = await this.#pool.query<LinkRow>(
      `SELECT * FROM remote_task_provider_execution_link
        WHERE (link_id=$1 OR binding_id=$2 OR logical_invocation_id=$3
           OR (remote_task_id=$4 AND runtime_server_id=$5)) AND ${scope.predicate}
        ORDER BY link_id=$1 DESC LIMIT 1`,
      [
        link.linkId,
        link.bindingId,
        link.logicalInvocationId,
        link.remoteTaskId,
        link.runtimeServerId,
        ...scope.values,
      ],
    );
    const current = result.rows[0] === undefined ? undefined : mapLink(result.rows[0]);
    if (current === undefined || canonicalHash(current) !== canonicalHash(link))
      throw new Error('REMOTE_TASK_PROVIDER_EXECUTION_LINK_CONFLICT');
    return current;
  }

  async findByBindingId(bindingId: string): Promise<RemoteTaskProviderExecutionLink | undefined> {
    const scope = remoteTaskChildScopeSql(
      this.#deviceScope,
      2,
      'remote_task_provider_execution_link',
    );
    const result = await this.#pool.query<LinkRow>(
      `SELECT * FROM remote_task_provider_execution_link WHERE binding_id=$1 AND ${scope.predicate}`,
      [bindingId, ...scope.values],
    );
    return result.rows[0] === undefined ? undefined : mapLink(result.rows[0]);
  }
}

function mapAttempt(row: AttemptRow): RemoteTaskReconciliationAttempt {
  return {
    attemptId: row.attempt_id,
    intentId: row.intent_id,
    logicalInvocationId: row.logical_invocation_id,
    expectedIntentVersion: Number(row.expected_intent_version),
    attemptNumber: Number(row.attempt_number),
    sourceContract: row.source_contract,
    requestHash: row.request_hash,
    status: row.status,
    ...(row.remote_task_id === null ? {} : { remoteTaskId: row.remote_task_id }),
    ...(row.external_execution_id === null
      ? {}
      : { externalExecutionId: row.external_execution_id }),
    identityValidated: row.identity_validated,
    ...(row.safe_error_code === null ? {} : { safeErrorCode: row.safe_error_code }),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    durationMs: row.duration_ms,
    resultHash: row.result_hash,
    version: Number(row.version) as 1,
  };
}

function mapLink(row: LinkRow): RemoteTaskProviderExecutionLink {
  const link = createRemoteTaskProviderExecutionLink({
    bindingId: row.binding_id,
    logicalInvocationId: row.logical_invocation_id,
    remoteTaskId: row.remote_task_id,
    providerId: row.provider_id,
    runtimeServerId: row.runtime_server_id,
    ...(row.provider_binding_id === null ? {} : { providerBindingId: row.provider_binding_id }),
    ...(row.provider_origin_type === null ? {} : { providerOriginType: row.provider_origin_type }),
    ...(row.smpp_source_id === null ? {} : { smppSourceId: row.smpp_source_id }),
    ...(row.external_server_id === null ? {} : { externalServerId: row.external_server_id }),
    operationName: row.operation_name,
    executionStatus: row.execution_status,
    ...(row.external_execution_id === null
      ? {}
      : { externalExecutionId: row.external_execution_id }),
    missionStatus: row.mission_status,
    ...(row.device_mission_id === null ? {} : { deviceMissionId: row.device_mission_id }),
    provenance: row.provenance,
    sourceContract: row.source_contract,
    sourceRevision: row.source_revision,
    observedAt: iso(row.observed_at),
  });
  if (link.linkId !== row.link_id || link.contentHash !== row.content_hash)
    throw new Error('REMOTE_TASK_PROVIDER_EXECUTION_LINK_PERSISTENCE_CONFLICT');
  return link;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function reconciliationScopeSql(scope: DeviceWorkScope | undefined, firstParameter: number) {
  const owner = taskChildScopeSql(scope, firstParameter, 'scope_intent');
  if (scope === undefined) return owner;
  return {
    predicate: `EXISTS(SELECT 1 FROM remote_task_admission_intent scope_intent WHERE scope_intent.intent_id=remote_task_reconciliation_attempt.intent_id AND ${owner.predicate})`,
    values: owner.values,
  };
}
