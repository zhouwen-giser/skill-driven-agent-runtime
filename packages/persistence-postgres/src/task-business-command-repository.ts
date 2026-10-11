import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import type { RemoteTaskBinding } from '../../domain/src/index.js';
import { hashCanonicalEvidenceJson } from '../../domain/src/evidence/canonical-evidence.js';
import {
  TaskBusinessError,
  parseTaskBusinessProjection,
  taskBusinessRefKey,
} from '../../domain/src/task-business.js';
import {
  assertTaskBusinessCommandScope,
  parseTaskBusinessCommandRecord,
  parseTaskBusinessControlScope,
  taskBusinessMutationPolicySchema,
  type TaskBusinessCommandIntent,
  type TaskBusinessCommandRecord,
  type TaskBusinessControlScope,
} from '../../domain/src/task-business-command.js';
import {
  taskBusinessFrozenBindingHash,
  taskBusinessInputLinkHash,
  type TaskBusinessCommandRepository,
} from '../../application/src/task-business-commands.js';
import { PostgresGovernedControlManagementAuthorityReader } from './governed-control-management-authority-reader.js';
import { consumeGovernedControlConfirmationInTransaction } from './governed-control-authority-repository.js';
import { PostgresRemoteTaskRepository } from './remote-task-repository.js';
import { PostgresRemoteTaskInputRepository } from './remote-task-input-repository.js';
import {
  PostgresTaskBusinessRepository,
  appendTaskBusinessObservation,
} from './task-business-repository.js';
import {
  readGowmMcpOwner,
  remoteTaskScopeSql,
  remoteTaskChildScopeSql,
} from './gowm-mcp-ownership.js';

/** Tagged native observation journal. Every write shares the original binding's transaction lock. */
export class PostgresTaskBusinessCommandRepository implements TaskBusinessCommandRepository {
  readonly #dispatchLeaseMs: number;
  readonly #readLeaseMs: number;
  constructor(
    readonly pool: Pool,
    readonly deviceScope?: DeviceWorkScope,
    leases: Readonly<{ dispatchLeaseMs?: number; readLeaseMs?: number }> = {},
  ) {
    this.#dispatchLeaseMs = leaseDuration(leases.dispatchLeaseMs ?? 30_000);
    this.#readLeaseMs = leaseDuration(leases.readLeaseMs ?? 30_000);
  }

  async loadAuthority(taskId: string, query: Pick<Pool, 'query'> = this.pool) {
    const authority = await new PostgresGovernedControlManagementAuthorityReader(
      query,
    ).issueAuthority(taskId);
    if (authority === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_CONTROL_AUTHORITY_REQUIRED');
    const rows = await query.query<{
      constraint_snapshot: unknown;
      runtime_policy_json: unknown;
      input_snapshot: unknown;
    }>(
      `SELECT binding.constraint_snapshot,version.runtime_policy_json,binding.input_snapshot
       FROM task_capability_binding binding JOIN agent_task task ON task.task_id=binding.task_id
       JOIN skill_version version ON version.skill_id=task.selected_skill_id AND version.version=task.selected_skill_version
       WHERE binding.task_id=$1 AND binding.binding_id=$2`,
      [taskId, authority.capabilityBindingId],
    );
    const row = rows.rows[0];
    const constraints = z.array(z.record(z.string(), z.unknown())).parse(row?.constraint_snapshot);
    const matches = constraints.filter((item) => item['type'] === 'task_business_mutation_policy');
    const policy = taskBusinessMutationPolicySchema.safeParse(
      matches.length === 1 ? matches[0] : undefined,
    );
    const runtime = z.record(z.string(), z.unknown()).parse(row?.runtime_policy_json);
    const runtimePolicy = taskBusinessMutationPolicySchema.safeParse(
      runtime['taskBusinessMutationPolicy'],
    );
    if (
      !policy.success ||
      !runtimePolicy.success ||
      hashCanonicalEvidenceJson(runtimePolicy.data) !== hashCanonicalEvidenceJson(policy.data)
    )
      throw new TaskBusinessError('TASK_BUSINESS_MUTATION_POLICY_DENIED');
    const scope = parseTaskBusinessControlScope({
      taskId: authority.taskId,
      capabilityBindingId: authority.capabilityBindingId,
      capabilityId: authority.capabilityId,
      capabilityVersion: authority.capabilityVersion,
      capabilityAttemptId: authority.capabilityAttemptId,
      planId: authority.planId,
      planHash: authority.planHash,
      skillId: authority.skillId,
      skillVersion: authority.skillVersion,
      providerBindingId: authority.providerBindingId,
      serverId: authority.serverId,
      toolName: authority.toolName,
    });
    return { scope, policy: policy.data, constraints, inputSnapshot: row?.input_snapshot };
  }
  async resolveTaskBinding(taskId: string, operationName: string) {
    const scope = remoteTaskScopeSql(this.deviceScope, 3, 'binding');
    const rows = await this.pool.query<{ binding_id: string }>(
      `SELECT binding_id FROM remote_task_binding binding WHERE agent_task_id=$1 AND operation_name=$2 AND ${scope.predicate}
       AND terminal_at IS NULL AND invalidated_at IS NULL ORDER BY binding_id LIMIT 2`,
      [taskId, operationName, ...scope.values],
    );
    if (rows.rows.length !== 1) return undefined;
    const id = rows.rows[0]?.binding_id;
    return id === undefined
      ? undefined
      : new PostgresTaskBusinessRepository(this.pool, this.deviceScope).loadTarget(id);
  }
  async loadInput(inputRequestId: string) {
    const link = await new PostgresRemoteTaskInputRepository(this.pool, this.deviceScope).findLink(
      inputRequestId,
    );
    if (link === undefined) return undefined;
    const target = await new PostgresTaskBusinessRepository(this.pool, this.deviceScope).loadTarget(
      link.bindingId,
    );
    if (target === undefined) return undefined;
    return { link, target };
  }
  async find(taskId: string, intentId: string): Promise<TaskBusinessCommandRecord | undefined> {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 3, 'observation');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT observation.payload_json FROM remote_task_observation observation JOIN remote_task_binding binding ON binding.binding_id=observation.binding_id
       WHERE binding.agent_task_id=$1 AND payload_json->>'recordType'='task_business.command'
         AND payload_json->'command'->'intent'->>'intentId'=$2 AND ${scope.predicate} ORDER BY sequence DESC LIMIT 1`,
      [taskId, intentId, ...scope.values],
    );
    return fromPayload(rows.rows[0]?.payload_json);
  }
  async findByInput(inputRequestId: string): Promise<TaskBusinessCommandRecord | undefined> {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 2, 'observation');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM remote_task_observation observation WHERE payload_json->>'recordType'='task_business.command'
       AND payload_json->'command'->'intent'->'request'->>'inputRequestId'=$1 AND ${scope.predicate} ORDER BY sequence DESC LIMIT 1`,
      [inputRequestId, ...scope.values],
    );
    return fromPayload(rows.rows[0]?.payload_json);
  }
  async list(taskId: string): Promise<readonly TaskBusinessCommandRecord[]> {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 2, 'observation');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT DISTINCT ON (payload_json->'command'->'intent'->>'intentId') payload_json FROM remote_task_observation observation
       JOIN remote_task_binding binding ON binding.binding_id=observation.binding_id
       WHERE binding.agent_task_id=$1 AND payload_json->>'recordType'='task_business.command' AND ${scope.predicate}
       ORDER BY payload_json->'command'->'intent'->>'intentId',sequence DESC LIMIT 256`,
      [taskId, ...scope.values],
    );
    return rows.rows
      .map((row) => fromPayload(row.payload_json))
      .filter((row): row is TaskBusinessCommandRecord => row !== undefined);
  }
  prepare(intent: TaskBusinessCommandIntent): Promise<TaskBusinessCommandRecord> {
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, intent);
      const existing = await this.#latest(client, intent);
      if (existing !== undefined) {
        if (existing.intent.contentHash !== intent.contentHash)
          throw new TaskBusinessError('TASK_BUSINESS_COMMAND_CONTENT_CONFLICT');
        return existing;
      }
      await this.#assertActive(client, locked, intent, 'prepare');
      const now = await databaseNow(client);
      if (Date.parse(intent.validUntil) <= Date.parse(now))
        throw new TaskBusinessError('TASK_BUSINESS_REQUEST_EXPIRED');
      const record = parseTaskBusinessCommandRecord({
        intent,
        revision: 1,
        state: 'prepared',
        updatedAt: now,
        readAttempts: 0,
      });
      await this.#append(client, record, locked.active);
      return record;
    });
  }
  async pendingRecovery(): Promise<readonly TaskBusinessCommandRecord[]> {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 1, 'observation');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM (
      SELECT DISTINCT ON (payload_json->'command'->'intent'->>'intentId') payload_json FROM remote_task_observation observation
      WHERE payload_json->>'recordType'='task_business.command' AND ${scope.predicate}
      ORDER BY payload_json->'command'->'intent'->>'intentId',sequence DESC) latest
      WHERE payload_json->'command'->>'state' IN ('prepared','dispatching','accepted','uncertain')
        AND COALESCE(payload_json->'command'->>'errorCode','')<>'TASK_BUSINESS_RECONCILIATION_EXHAUSTED'
        AND (payload_json->'command'->>'state'<>'prepared' OR (payload_json->'command'->'intent'->>'validUntil')::timestamptz<=clock_timestamp())
      ORDER BY payload_json->'command'->>'updatedAt' LIMIT 4`,
      [...scope.values],
    );
    return rows.rows
      .map((row) => fromPayload(row.payload_json))
      .filter((row): row is TaskBusinessCommandRecord => row !== undefined);
  }
  async attachConfirmation(
    taskId: string,
    intentId: string,
    confirmationId: string,
  ): Promise<TaskBusinessCommandRecord> {
    const record = await this.find(taskId, intentId);
    if (record === undefined) throw new TaskBusinessError('TASK_BUSINESS_COMMAND_NOT_FOUND');
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, record.intent);
      const current = await this.#required(client, record.intent);
      if (current.state !== 'prepared' || current.confirmationId !== undefined) return current;
      await this.#assertActive(client, locked, current.intent, 'prepare');
      const confirmation = await client.query<{
        confirmed_at: Date;
        expires_at: Date;
        actor_id: string;
      }>(
        `SELECT confirmed_at,expires_at,actor_id FROM governed_control_confirmation
        WHERE confirmation_id=$1 AND task_id=$2 AND arguments_hash=$3 AND revoked_at IS NULL AND consumed_at IS NULL
          AND confirmed_at<=clock_timestamp() AND expires_at>clock_timestamp()`,
        [confirmationId, taskId, current.intent.contentHash.slice(7)],
      );
      if (confirmation.rowCount !== 1)
        throw new TaskBusinessError('TASK_BUSINESS_CONFIRMATION_INVALID');
      const fact = confirmation.rows[0];
      if (fact === undefined) throw new TaskBusinessError('TASK_BUSINESS_CONFIRMATION_INVALID');
      const next = {
        ...current,
        confirmationId,
        confirmationFact: {
          confirmationId,
          contentHash: current.intent.contentHash,
          scopeHash: hashCanonicalEvidenceJson(current.intent.authority),
          actorHash: hashCanonicalEvidenceJson(fact.actor_id),
          confirmedAt: fact.confirmed_at.toISOString(),
          expiresAt: fact.expires_at.toISOString(),
        },
        revision: current.revision + 1,
        updatedAt: await databaseNow(client),
      };
      await this.#append(client, next, locked.active);
      return next;
    });
  }
  claim(
    record: TaskBusinessCommandRecord,
    scope: TaskBusinessControlScope,
  ): Promise<TaskBusinessCommandRecord | undefined> {
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, record.intent);
      const current = await this.#required(client, record.intent);
      if (current.state !== 'prepared' || current.revision !== record.revision) return undefined;
      assertTaskBusinessCommandScope(scope, current.intent.authority);
      await this.#assertActive(client, locked, current.intent, 'dispatch');
      const now = await databaseNow(client);
      if (Date.parse(current.intent.validUntil) <= Date.parse(now))
        throw new TaskBusinessError('TASK_BUSINESS_REQUEST_EXPIRED');
      const pending = await client.query(
        `SELECT 1 FROM (
        SELECT DISTINCT ON (payload_json->'command'->'intent'->>'intentId') payload_json FROM remote_task_observation
          WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.command'
          ORDER BY payload_json->'command'->'intent'->>'intentId',sequence DESC) latest
        WHERE payload_json->'command'->'intent'->>'intentId'<>$2
          AND payload_json->'command'->>'state' IN ('dispatching','accepted','uncertain') LIMIT 1`,
        [current.intent.bindingId, current.intent.intentId],
      );
      if (pending.rowCount !== 0)
        throw new TaskBusinessError('TASK_BUSINESS_CONFLICTING_COMMAND_UNRESOLVED');
      if (current.confirmationId === undefined)
        throw new TaskBusinessError('TASK_BUSINESS_TRUSTED_CONFIRMATION_REQUIRED');
      const confirmation = await consumeGovernedControlConfirmationInTransaction(
        client,
        {
          confirmationId: current.confirmationId,
          taskId: scope.taskId,
          capabilityBindingId: scope.capabilityBindingId,
          capabilityAttemptId: scope.capabilityAttemptId,
          providerBindingId: scope.providerBindingId,
          serverId: scope.serverId,
          toolName: scope.toolName,
          argumentsHash: current.intent.contentHash.slice(7),
          invocationId: `task-business:${current.intent.intentId}`,
          dispatchHash: current.intent.contentHash,
          consumedAt: now,
        },
        scope,
      );
      if (confirmation === undefined)
        throw new TaskBusinessError('TASK_BUSINESS_CONFIRMATION_INVALID');
      const next: TaskBusinessCommandRecord = {
        ...current,
        dispatchClaim: {
          confirmationId: confirmation.confirmationId,
          invocationId: `task-business:${current.intent.intentId}`,
          dispatchHash: current.intent.contentHash,
          consumedAt: now,
        },
        state: 'dispatching',
        revision: current.revision + 1,
        dispatchToken: randomUUID(),
        dispatchLeaseExpiresAt: new Date(Date.parse(now) + this.#dispatchLeaseMs).toISOString(),
        updatedAt: now,
      };
      await this.#append(client, next, true);
      return next;
    });
  }
  recordDispatch(
    record: TaskBusinessCommandRecord,
    outcome: Parameters<TaskBusinessCommandRepository['recordDispatch']>[1],
  ): Promise<TaskBusinessCommandRecord> {
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, record.intent);
      const current = await this.#required(client, record.intent);
      const now = await databaseNow(client);
      if (
        current.state !== 'dispatching' ||
        current.dispatchToken !== record.dispatchToken ||
        current.dispatchLeaseExpiresAt === undefined ||
        Date.parse(current.dispatchLeaseExpiresAt) <= Date.parse(now)
      )
        throw new TaskBusinessError('TASK_BUSINESS_DISPATCH_LEASE_LOST');
      const next: TaskBusinessCommandRecord = {
        ...current,
        ...outcome,
        revision: current.revision + 1,
        updatedAt: now,
      };
      await this.#append(client, next, locked.active);
      return next;
    });
  }
  rejectBeforeSend(
    record: TaskBusinessCommandRecord,
    errorCode: string,
  ): Promise<TaskBusinessCommandRecord> {
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, record.intent);
      const current = await this.#required(client, record.intent);
      if (current.state !== 'prepared' || current.revision !== record.revision) return current;
      const next: TaskBusinessCommandRecord = {
        ...current,
        state: 'obsolete',
        errorCode,
        revision: current.revision + 1,
        updatedAt: await databaseNow(client),
      };
      await this.#append(client, next, locked.active);
      return next;
    });
  }
  async claimReconciliation(
    taskId: string,
    intentId: string,
  ): Promise<TaskBusinessCommandRecord | undefined> {
    const record = await this.find(taskId, intentId);
    if (record === undefined) throw new TaskBusinessError('TASK_BUSINESS_COMMAND_NOT_FOUND');
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, record.intent);
      const current = await this.#required(client, record.intent);
      const now = await databaseNow(client);
      if (
        !['dispatching', 'accepted', 'uncertain'].includes(current.state) ||
        (current.readLeaseExpiresAt !== undefined &&
          Date.parse(current.readLeaseExpiresAt) > Date.parse(now)) ||
        (current.state === 'dispatching' &&
          current.dispatchLeaseExpiresAt !== undefined &&
          Date.parse(current.dispatchLeaseExpiresAt) > Date.parse(now))
      )
        return undefined;
      if (
        current.readAttempts >= 5 ||
        Date.parse(current.intent.reconcileUntil) <= Date.parse(now)
      ) {
        if (current.errorCode !== 'TASK_BUSINESS_RECONCILIATION_EXHAUSTED')
          await this.#append(
            client,
            {
              ...current,
              state: 'uncertain',
              errorCode: 'TASK_BUSINESS_RECONCILIATION_EXHAUSTED',
              revision: current.revision + 1,
              updatedAt: now,
            },
            locked.active,
          );
        return undefined;
      }
      const next: TaskBusinessCommandRecord = {
        ...current,
        state: current.state === 'dispatching' ? 'uncertain' : current.state,
        readAttempts: current.readAttempts + 1,
        readToken: randomUUID(),
        readLeaseExpiresAt: new Date(Date.parse(now) + this.#readLeaseMs).toISOString(),
        revision: current.revision + 1,
        updatedAt: now,
      };
      await this.#append(client, next, locked.active);
      return next;
    });
  }
  recordReconciliation(
    record: TaskBusinessCommandRecord,
    outcome: Parameters<TaskBusinessCommandRepository['recordReconciliation']>[1],
  ): Promise<TaskBusinessCommandRecord> {
    return this.#transaction(async (client) => {
      const locked = await this.#lock(client, record.intent);
      const current = await this.#required(client, record.intent);
      const now = await databaseNow(client);
      if (
        current.readToken !== record.readToken ||
        record.readToken === undefined ||
        current.revision !== record.revision ||
        current.readLeaseExpiresAt === undefined ||
        Date.parse(current.readLeaseExpiresAt) <= Date.parse(now)
      )
        throw new TaskBusinessError('TASK_BUSINESS_RECONCILIATION_LEASE_LOST');
      if (!['accepted', 'uncertain', 'confirmed', 'rejected'].includes(outcome.state))
        throw new TaskBusinessError('TASK_BUSINESS_COMMAND_TRANSITION_INVALID');
      const { readToken: ignoredToken, readLeaseExpiresAt: ignoredExpiry, ...released } = current;
      void ignoredToken;
      void ignoredExpiry;
      const next: TaskBusinessCommandRecord = {
        ...released,
        ...outcome,
        revision: current.revision + 1,
        updatedAt: now,
      };
      await this.#append(client, next, locked.active);
      return next;
    });
  }
  async rollbackPreflight(): Promise<
    Readonly<{ writeTakeoverAllowed: boolean; pendingIntentIds: readonly string[] }>
  > {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 1, 'observation');
    const rows = await this.pool.query<{ intent_id: string }>(
      `SELECT payload_json->'command'->'intent'->>'intentId' intent_id FROM (
       SELECT DISTINCT ON (payload_json->'command'->'intent'->>'intentId') payload_json FROM remote_task_observation observation
        WHERE payload_json->>'recordType'='task_business.command' AND ${scope.predicate}
        ORDER BY payload_json->'command'->'intent'->>'intentId',sequence DESC) latest
       WHERE payload_json->'command'->>'state' IN ('prepared','dispatching','accepted','uncertain') ORDER BY intent_id LIMIT 10000`,
      [...scope.values],
    );
    return {
      writeTakeoverAllowed: rows.rows.length === 0,
      pendingIntentIds: rows.rows.map((row) => row.intent_id),
    };
  }

  async #lock(
    client: PoolClient,
    intent: TaskBusinessCommandIntent,
  ): Promise<Readonly<{ binding: RemoteTaskBinding; active: boolean }>> {
    const binding = await new PostgresRemoteTaskRepository(this.pool, this.deviceScope).findById(
      intent.bindingId,
      client,
    );
    if (
      binding?.agentTaskId !== intent.taskId ||
      binding.goalId !== intent.goalId ||
      binding.goalVersion !== intent.goalVersion ||
      taskBusinessFrozenBindingHash(binding) !== intent.frozenBindingHash
    )
      throw new TaskBusinessError('TASK_BUSINESS_CONTROL_SCOPE_INVALID');
    // Same lock order as native Goal patch/cancellation: Goal -> Task -> original binding.
    const goal = await client.query<{ version: number; status: string }>(
      'SELECT version,status FROM goal WHERE goal_id=$1 FOR UPDATE',
      [binding.goalId],
    );
    const task = await client.query<{ phase: string; plan_id: string | null }>(
      'SELECT phase,plan_id FROM agent_task WHERE task_id=$1 FOR NO KEY UPDATE',
      [binding.agentTaskId],
    );
    const filter = remoteTaskScopeSql(this.deviceScope, 2, 'binding');
    const remote = await client.query<{
      terminal_at: Date | null;
      invalidated_at: Date | null;
      local_state: string;
      has_cancel_request: boolean;
    }>(
      `SELECT terminal_at,invalidated_at,local_state,EXISTS(SELECT 1 FROM remote_task_cancel_request cancel WHERE cancel.binding_id=binding.binding_id) AS has_cancel_request
       FROM remote_task_binding binding WHERE binding_id=$1 AND ${filter.predicate} FOR UPDATE`,
      [binding.bindingId, ...filter.values],
    );
    const owner = remote.rows[0];
    if (owner === undefined) throw new TaskBusinessError('TASK_BUSINESS_CONTROL_SCOPE_INVALID');
    if (this.deviceScope !== undefined)
      await readGowmMcpOwner(client, this.deviceScope, binding.agentTaskId, binding.serverId, {
        resourceId: intent.identity.resourceId,
      });
    const active =
      goal.rows[0]?.version === intent.goalVersion &&
      goal.rows[0].status === 'active' &&
      task.rows[0]?.plan_id === intent.authority.planId &&
      !['completed', 'failed', 'canceled', 'cancelled', 'capability_gap', 'invalidated'].includes(
        task.rows[0].phase,
      ) &&
      owner.terminal_at === null &&
      owner.invalidated_at === null &&
      !owner.has_cancel_request &&
      !['cancel_observing', 'terminal'].includes(owner.local_state);
    return { binding, active };
  }
  async #assertActive(
    client: PoolClient,
    locked: Readonly<{ binding: RemoteTaskBinding; active: boolean }>,
    intent: TaskBusinessCommandIntent,
    phase: 'prepare' | 'dispatch',
  ): Promise<void> {
    if (!locked.active) throw new TaskBusinessError('TASK_BUSINESS_SEND_BOUNDARY_CLOSED');
    const current = await this.loadAuthority(intent.taskId, client);
    assertTaskBusinessCommandScope(current.scope, intent.authority);
    if (
      intent.identity.providerId !==
        locked.binding.authoritySnapshot?.providerBinding?.providerId ||
      intent.identity.taskId !== locked.binding.remoteTaskId ||
      intent.identity.operationName !== locked.binding.operationName ||
      !current.policy.allowedOperations.includes(intent.request.operation)
    )
      throw new TaskBusinessError('TASK_BUSINESS_MUTATION_POLICY_DENIED');
    const rows = await client.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM remote_task_observation WHERE binding_id=$1
      AND payload_json->>'recordType'='task_business.projection' ORDER BY sequence DESC LIMIT 1`,
      [intent.bindingId],
    );
    const payload = z.object({ projection: z.unknown() }).loose().parse(rows.rows[0]?.payload_json);
    const projection = parseTaskBusinessProjection(payload.projection);
    if (
      projection.status !== 'current' ||
      !projection.quality.currentStateComplete ||
      hashCanonicalEvidenceJson(projection.identity) !== hashCanonicalEvidenceJson(intent.identity)
    )
      throw new TaskBusinessError('TASK_BUSINESS_CURRENT_EVIDENCE_REQUIRED');
    const request = intent.request;
    if (request.operation === 'navigation_adjust_plan') {
      const candidate = projection.allowedInterventions.find(
        (item) =>
          item['interventionId'] === request.interventionId &&
          item['revision'] === request.expectedInterventionRevision,
      );
      if (
        candidate?.['state'] !== 'available' ||
        projection.effectivePlanRevision !== request.expectedEffectivePlanRevision ||
        candidate['revision'] !== request.expectedInterventionRevision
      )
        throw new TaskBusinessError('TASK_BUSINESS_PLAN_REVISION_CONFLICT');
    } else {
      const native = await client.query<{
        input_requests_json: unknown;
        status: string;
        remote_revision: string;
        result_hash: string;
      }>(
        `SELECT input_requests_json,status,remote_revision,result_hash FROM remote_task_input_link WHERE input_request_id=$1 AND binding_id=$2 FOR UPDATE`,
        [request.inputRequestId, intent.bindingId],
      );
      const link = native.rows[0];
      if (
        link?.status !== (phase === 'dispatch' ? 'answered' : 'waiting') ||
        taskBusinessInputLinkHash({
          inputRequestId: request.inputRequestId,
          bindingId: intent.bindingId,
          remoteRevision: link.remote_revision,
          resultHash: link.result_hash,
          inputRequests: z.record(z.string(), z.unknown()).parse(link.input_requests_json),
        }) !== request.inputLinkHash
      )
        throw new TaskBusinessError('TASK_BUSINESS_INPUT_LINK_STALE');
      const candidate = projection.interactionRequests.find(
        (item) =>
          item['requestId'] === request.requestId &&
          item['revision'] === request.expectedRequestRevision &&
          item['requestKey'] === request.requestKey,
      );
      if (
        candidate?.['state'] !== 'pending' ||
        hashCanonicalEvidenceJson(candidate['subjectBinding']) !==
          hashCanonicalEvidenceJson(request.expectedSubjectBinding)
      )
        throw new TaskBusinessError('TASK_BUSINESS_INPUT_NOT_CURRENT');
    }
    if (
      !projection.objects.some(
        (object) =>
          object.resolution === 'resolved' &&
          taskBusinessRefKey(object.ref) ===
            taskBusinessRefKey({
              kind: request.operation === 'input_response' ? 'input_request' : 'intervention',
              id:
                request.operation === 'input_response' ? request.requestId : request.interventionId,
              revision:
                request.operation === 'input_response'
                  ? request.expectedRequestRevision
                  : request.expectedInterventionRevision,
            }),
      )
    )
      throw new TaskBusinessError('TASK_BUSINESS_REQUIRED_OBJECTS_INCOMPLETE');
  }
  async #latest(
    client: PoolClient,
    intent: TaskBusinessCommandIntent,
  ): Promise<TaskBusinessCommandRecord | undefined> {
    const rows = await client.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM remote_task_observation WHERE binding_id=$1
      AND payload_json->>'recordType'='task_business.command' AND payload_json->'command'->'intent'->>'intentId'=$2 ORDER BY sequence DESC LIMIT 1`,
      [intent.bindingId, intent.intentId],
    );
    return fromPayload(rows.rows[0]?.payload_json);
  }
  async #required(
    client: PoolClient,
    intent: TaskBusinessCommandIntent,
  ): Promise<TaskBusinessCommandRecord> {
    const record = await this.#latest(client, intent);
    if (record?.intent.contentHash !== intent.contentHash)
      throw new TaskBusinessError('TASK_BUSINESS_COMMAND_CONTENT_CONFLICT');
    return record;
  }
  async #append(
    client: PoolClient,
    record: TaskBusinessCommandRecord,
    active: boolean,
  ): Promise<void> {
    parseTaskBusinessCommandRecord(record);
    await appendTaskBusinessObservation(
      client,
      record.intent.bindingId,
      { recordType: 'task_business.command', command: record },
      record.updatedAt,
      active,
    );
  }
  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
function leaseDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000)
    throw new TaskBusinessError('TASK_BUSINESS_LEASE_CONFIGURATION_INVALID');
  return value;
}
function fromPayload(raw: unknown): TaskBusinessCommandRecord | undefined {
  if (raw === undefined) return undefined;
  return parseTaskBusinessCommandRecord(
    z
      .object({ recordType: z.literal('task_business.command'), command: z.unknown() })
      .strict()
      .parse(raw).command,
  );
}
async function databaseNow(client: PoolClient): Promise<string> {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const now = result.rows[0]?.now;
  if (now === undefined) throw new TaskBusinessError('TASK_BUSINESS_DATABASE_CLOCK_UNAVAILABLE');
  return now.toISOString();
}
