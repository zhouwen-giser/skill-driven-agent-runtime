import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  buildRuntimeSourceArtifact,
  hashSourceArtifactJson,
} from '../../domain/src/evidence/source-artifact-ref.js';
import {
  hashCanonicalEvidenceJson,
  EvidenceContractError,
} from '../../domain/src/evidence/canonical-evidence.js';
import type { EvidenceJsonValue } from '../../domain/src/evidence/canonical-evidence.js';
import type { TaskProjectionArtifact } from '../../application/src/task-projection.js';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import type {
  TaskBusinessCommit,
  TaskBusinessRepository,
  TaskBusinessTarget,
} from '../../application/src/task-business-sync.js';
import { sameRemoteTaskAdmission, type BusinessEventInboxRecord } from '../../domain/src/index.js';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import {
  assertTaskBusinessIdentity,
  parseTaskBusinessProjection,
  taskBusinessContentDigest,
  taskBusinessRefKey,
  TaskBusinessError,
  TASK_BUSINESS_LIMITS,
  type TaskBusinessContent,
  type TaskBusinessProjection,
} from '../../domain/src/task-business.js';
import { PostgresRemoteTaskRepository } from './remote-task-repository.js';
import { PostgresRemoteTaskProviderExecutionLinkStore } from './remote-task-consumer-sync-repository.js';
import {
  readGowmMcpOwner,
  remoteTaskScopeSql,
  remoteTaskChildScopeSql,
} from './gowm-mcp-ownership.js';
import { markBusinessEventProcessedInTransaction } from './business-event-checkpoint.js';
import {
  buildTaskBusinessSourceArtifact,
  taskBusinessEvidencePolicySchema,
} from '../../domain/src/task-business-evidence.js';
import type { ArtifactRef } from '../../domain/src/evidence/canonical-evidence.js';

const chunkSchema = z
  .object({
    recordType: z.literal('task_business.content'),
    schemaVersion: z.literal('sdar.task-business-content/v1'),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    offset: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    bytes: z.string(),
  })
  .strict();
const objectSchema = z
  .object({
    recordType: z.literal('task_business.object'),
    refKey: z.string(),
    digest: z.string(),
    metadataHash: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Native observation extension: bounded immutable content, exact owner, no second mutable binding or DDL. */
export class PostgresTaskBusinessRepository implements TaskBusinessRepository {
  constructor(
    readonly pool: Pool,
    readonly deviceScope?: DeviceWorkScope,
  ) {}

  async exportTaskArtifacts(taskId: string): Promise<readonly TaskProjectionArtifact[]> {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 2, 'observation');
    const result = await this.pool.query<{ observation_id: string; payload_json: unknown }>(
      `SELECT DISTINCT ON (binding.binding_id,observation.payload_json->>'recordType',COALESCE(observation.payload_json->'command'->'intent'->>'intentId','')) observation_id,payload_json FROM remote_task_observation observation JOIN remote_task_binding binding ON binding.binding_id=observation.binding_id
      WHERE binding.agent_task_id=$1 AND ${scope.predicate} AND payload_json->>'recordType' IN ('task_business.projection','task_business.command')
      ORDER BY binding.binding_id,observation.payload_json->>'recordType',COALESCE(observation.payload_json->'command'->'intent'->>'intentId',''),sequence DESC LIMIT 32`,
      [taskId, ...scope.values],
    );
    return result.rows.map((row) => {
      const raw = z.record(z.string(), z.unknown()).parse(row.payload_json);
      const source = buildRuntimeSourceArtifact({
        sourceTable: 'remote_task_observation',
        sourceRecordId: row.observation_id,
        sourceVersion: 1,
        value: raw as EvidenceJsonValue,
      });
      const projection =
        raw['recordType'] === 'task_business.projection'
          ? parseTaskBusinessProjection(raw['projection'])
          : undefined;
      const command =
        raw['recordType'] === 'task_business.command'
          ? z.record(z.string(), z.unknown()).parse(raw['command'])
          : undefined;
      return {
        artifactId: row.observation_id,
        name: String(raw['recordType']),
        data: {
          schemaVersion: 'sdar.task-business-task-artifact/v1',
          completeEvidenceRef: source.artifactRef,
          ...(projection === undefined
            ? {
                state: command?.['state'],
                intentId: z.record(z.string(), z.unknown()).parse(command?.['intent'])['intentId'],
              }
            : {
                identity: projection.identity,
                quality: projection.quality,
                businessOutcome: projection.businessOutcome ?? null,
                geometry: projection.geometry?.slice(0, 16) ?? [],
                contents: projection.objects
                  .filter((object) => object.artifactRef !== undefined)
                  .slice(0, 128)
                  .map((object) => object.artifactRef),
                objectCount: projection.objects.length,
              }),
          exportLimit: 32,
          completeRecordAvailableByReference: true,
        },
      };
    });
  }

  async loadTarget(bindingId: string): Promise<TaskBusinessTarget | undefined> {
    const binding = await new PostgresRemoteTaskRepository(this.pool, this.deviceScope).findById(
      bindingId,
    );
    if (binding?.authoritySnapshot === undefined) return undefined;
    const scope = remoteTaskScopeSql(this.deviceScope, 2, 'binding');
    const rows = await this.pool.query<{
      arguments_json: unknown;
      capabilities_json: unknown;
      runtime_policy_json: unknown;
    }>(
      `SELECT invocation.arguments_json,snapshot.capabilities_json,version.runtime_policy_json FROM remote_task_binding binding
       JOIN mcp_invocation invocation ON invocation.invocation_id=binding.mcp_invocation_id
       JOIN agent_task task ON task.task_id=binding.agent_task_id
       LEFT JOIN skill_version version ON version.skill_id=task.selected_skill_id AND version.version=task.selected_skill_version AND version.status='enabled' AND version.validation_passed=true
       LEFT JOIN mcp_protocol_snapshot snapshot ON snapshot.snapshot_id=binding.authority_snapshot_json->'runtime'->>'protocolSnapshotId'
       WHERE binding.binding_id=$1 AND ${scope.predicate}`,
      [bindingId, ...scope.values],
    );
    const row = rows.rows[0];
    const args = z.record(z.string(), z.unknown()).safeParse(row?.arguments_json);
    if (!args.success || typeof args.data['resourceId'] !== 'string') return undefined;
    const resourceId = args.data['resourceId'];
    const capabilities = z
      .object({ extensions: z.record(z.string(), z.unknown()) })
      .loose()
      .safeParse(row?.capabilities_json);
    const catalog = capabilities.success
      ? capabilities.data.extensions['io.sdar/providerCatalog']
      : undefined;
    const provider = z
      .object({ providerId: z.string().min(1) })
      .loose()
      .safeParse(catalog);
    const providerId =
      binding.authoritySnapshot.providerBinding?.providerId ??
      (provider.success ? provider.data.providerId : undefined);
    if (providerId === undefined) return undefined;
    if (this.deviceScope !== undefined) {
      const owner = await readGowmMcpOwner(
        this.pool,
        this.deviceScope,
        binding.agentTaskId,
        binding.serverId,
        args.data,
      );
      if (
        owner.deviceId !== null &&
        (owner.resourceId !== resourceId || owner.providerId !== providerId)
      )
        throw new TaskBusinessError('TASK_BUSINESS_DEVICE_OWNER_CONFLICT');
    }
    const [link, previous] = await Promise.all([
      new PostgresRemoteTaskProviderExecutionLinkStore(this.pool, this.deviceScope).findByBindingId(
        bindingId,
      ),
      this.find(bindingId),
    ]);
    if (
      link !== undefined &&
      (link.executionStatus === 'conflict' ||
        link.remoteTaskId !== binding.remoteTaskId ||
        link.providerId !== providerId ||
        link.operationName !== binding.operationName)
    )
      throw new TaskBusinessError('TASK_BUSINESS_EXECUTION_CONFLICT');
    const executionId = link?.externalExecutionId ?? previous?.identity.executionId;
    const runtimePolicy = z.record(z.string(), z.unknown()).safeParse(row?.runtime_policy_json);
    const rawEvidencePolicy = runtimePolicy.success
      ? runtimePolicy.data['taskBusinessEvidencePolicy']
      : undefined;
    const evidencePolicy =
      rawEvidencePolicy === undefined
        ? undefined
        : taskBusinessEvidencePolicySchema.parse(rawEvidencePolicy);
    return {
      binding,
      resourceId,
      providerId,
      sourceTimeQualified:
        providerId === 'isr.vehicle.ugv.ugv' && binding.operationName === 'vehicle_navigate',
      ...(executionId === undefined ? {} : { executionId }),
      ...(evidencePolicy === undefined ? {} : { evidencePolicy }),
    };
  }

  async find(bindingId: string): Promise<TaskBusinessProjection | undefined> {
    const filter = remoteTaskChildScopeSql(this.deviceScope, 2, 'observation');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM remote_task_observation observation WHERE binding_id=$1 AND ${filter.predicate}
        AND payload_json->>'recordType'='task_business.projection' ORDER BY sequence DESC LIMIT 1`,
      [bindingId, ...filter.values],
    );
    return projectionFromPayload(rows.rows[0]?.payload_json);
  }
  async listByTask(taskId: string): Promise<readonly TaskBusinessProjection[]> {
    const filter = remoteTaskScopeSql(this.deviceScope, 2, 'binding');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT latest.payload_json FROM remote_task_binding binding CROSS JOIN LATERAL (
        SELECT payload_json FROM remote_task_observation WHERE binding_id=binding.binding_id
          AND payload_json->>'recordType'='task_business.projection' ORDER BY sequence DESC LIMIT 1) latest
       WHERE agent_task_id=$1 AND ${filter.predicate} ORDER BY binding.binding_id LIMIT 128`,
      [taskId, ...filter.values],
    );
    return rows.rows
      .map((row) => projectionFromPayload(row.payload_json))
      .filter((item): item is TaskBusinessProjection => item !== undefined);
  }
  async listRefreshable(limit: number, afterBindingId?: string): Promise<readonly string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 128)
      throw new TaskBusinessError('TASK_BUSINESS_REFRESH_LIMIT');
    const scope = remoteTaskScopeSql(this.deviceScope, 3, 'binding');
    const rows = await this.pool.query<{ binding_id: string }>(
      `SELECT binding.binding_id FROM remote_task_binding binding
       WHERE ${scope.predicate} AND binding.authority_snapshot_json IS NOT NULL AND binding.invalidated_at IS NULL
         AND (binding.terminal_at IS NULL OR binding.terminal_at > clock_timestamp()-interval '2 minutes')
         AND ($2::text IS NULL OR binding.binding_id>$2)
       ORDER BY binding.binding_id LIMIT $1`,
      [limit, afterBindingId ?? null, ...scope.values],
    );
    return rows.rows.map((row) => row.binding_id);
  }

  async commit(input: TaskBusinessCommit): Promise<'applied' | 'stale'> {
    return this.#transaction(async (client) => {
      if (!(await this.#commit(client, input))) return 'stale';
      if (input.event !== undefined)
        await markBusinessEventProcessedInTransaction(
          client,
          input.event.inboxId,
          input.projection.projectedAt,
          this.deviceScope,
          input.event.processingToken,
        );
      return 'applied';
    });
  }
  async commitMany(
    inputs: readonly TaskBusinessCommit[],
    event: BusinessEventInboxRecord,
  ): Promise<'applied' | 'stale'> {
    return this.#transaction<'applied' | 'stale'>(async (client) => {
      for (const input of [...inputs].sort((a, b) => a.bindingId.localeCompare(b.bindingId)))
        if (!(await this.#commit(client, input)))
          throw new TaskBusinessError('TASK_BUSINESS_PROJECTION_CAS_FAILED');
      await markBusinessEventProcessedInTransaction(
        client,
        event.inboxId,
        new Date().toISOString(),
        this.deviceScope,
        event.processingToken,
      );
      return 'applied';
    });
  }
  async #commit(client: PoolClient, input: TaskBusinessCommit): Promise<boolean> {
    // Match native Goal/control ordering explicitly; a joined row-lock query can
    // acquire Binding before Task and deadlock with the single-sender boundary.
    await client.query('SELECT task_id FROM agent_task WHERE task_id=$1 FOR NO KEY UPDATE', [
      input.observedBinding.agentTaskId,
    ]);
    const filter = remoteTaskScopeSql(this.deviceScope, 2, 'binding');
    const rows = await client.query<{
      version: string | number;
      terminal_at: Date | null;
      invalidated_at: Date | null;
      remote_task_id: string;
      operation_name: string;
      agent_task_id: string;
      phase: string;
      local_state: string;
      arguments_json: unknown;
      authority_snapshot_json: unknown;
      capabilities_json: unknown;
    }>(
      `SELECT binding.version,binding.terminal_at,binding.invalidated_at,binding.remote_task_id,binding.operation_name,
        binding.agent_task_id,binding.local_state,task.phase,invocation.arguments_json,binding.authority_snapshot_json,snapshot.capabilities_json
       FROM remote_task_binding binding JOIN agent_task task ON task.task_id=binding.agent_task_id
       JOIN mcp_invocation invocation ON invocation.invocation_id=binding.mcp_invocation_id
       LEFT JOIN mcp_protocol_snapshot snapshot ON snapshot.snapshot_id=binding.authority_snapshot_json->'runtime'->>'protocolSnapshotId'
       WHERE binding.binding_id=$1 AND ${filter.predicate} FOR UPDATE OF binding`,
      [input.bindingId, ...filter.values],
    );
    const owner = rows.rows[0];
    if (owner === undefined) throw new TaskBusinessError('TASK_BUSINESS_OWNER_NOT_FOUND');
    const currentBinding = await new PostgresRemoteTaskRepository(
      this.pool,
      this.deviceScope,
    ).findById(input.bindingId, client);
    if (
      currentBinding === undefined ||
      !sameRemoteTaskAdmission(currentBinding, input.observedBinding)
    )
      throw new TaskBusinessError('TASK_BUSINESS_NATIVE_AUTHORITY_CONFLICT');
    const args = z.record(z.string(), z.unknown()).parse(owner.arguments_json);
    const authority = z
      .object({ providerBinding: z.object({ providerId: z.string() }).loose().optional() })
      .loose()
      .parse(owner.authority_snapshot_json);
    const capabilities = z
      .object({ extensions: z.record(z.string(), z.unknown()) })
      .loose()
      .safeParse(owner.capabilities_json);
    const catalog = capabilities.success
      ? z
          .object({ providerId: z.string() })
          .loose()
          .safeParse(capabilities.data.extensions['io.sdar/providerCatalog'])
      : undefined;
    const providerId =
      authority.providerBinding?.providerId ??
      (catalog?.success === true ? catalog.data.providerId : undefined);
    if (
      providerId === undefined ||
      input.projection.identity.providerId !== providerId ||
      input.projection.identity.resourceId !== args['resourceId']
    )
      throw new TaskBusinessError('TASK_BUSINESS_IDENTITY_CONFLICT');
    if (
      input.projection.bindingId !== input.bindingId ||
      input.projection.taskId !== owner.agent_task_id ||
      input.projection.identity.taskId !== owner.remote_task_id ||
      input.projection.identity.operationName !== owner.operation_name
    )
      throw new TaskBusinessError('TASK_BUSINESS_IDENTITY_CONFLICT');
    const current = await client.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM remote_task_observation WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.projection' ORDER BY sequence DESC LIMIT 1`,
      [input.bindingId],
    );
    const previous = projectionFromPayload(current.rows[0]?.payload_json);
    if (previous !== undefined)
      assertTaskBusinessIdentity(input.projection.identity, previous.identity);
    const link = await client.query<{
      external_execution_id: string | null;
      execution_status: string;
    }>(
      'SELECT external_execution_id,execution_status FROM remote_task_provider_execution_link WHERE binding_id=$1',
      [input.bindingId],
    );
    if (
      link.rows[0]?.execution_status === 'conflict' ||
      (link.rows[0]?.external_execution_id != null &&
        link.rows[0].external_execution_id !== input.projection.identity.executionId)
    )
      throw new TaskBusinessError('TASK_BUSINESS_EXECUTION_CONFLICT');
    if ((previous?.projectionRevision ?? 0) !== input.expectedProjectionRevision) return false;
    const currentFacts =
      owner.invalidated_at === null &&
      owner.local_state !== 'quarantined' &&
      !['canceled', 'failed', 'capability_gap', 'invalidated'].includes(owner.phase);
    // Rebase only a poll's mutable lease/version against the exact immutable admission.
    // A newly terminal result needs a new read so final geometry and outcome use the same facts.
    if (
      currentFacts &&
      Number(owner.version) !== input.expectedBindingVersion &&
      (currentBinding.terminalAt !== input.observedBinding.terminalAt ||
        !isDeepStrictEqual(currentBinding.resultSnapshot, input.observedBinding.resultSnapshot) ||
        !isDeepStrictEqual(currentBinding.errorSnapshot, input.observedBinding.errorSnapshot))
    )
      return false;
    const active = currentFacts && owner.terminal_at === null && owner.phase !== 'completed';
    const projection: TaskBusinessProjection = {
      ...input.projection,
      projectionRevision: (previous?.projectionRevision ?? 0) + 1,
      status: currentFacts ? 'current' : 'history',
      ...(active ? {} : { allowedInterventions: [], interactionRequests: [] }),
    };
    if (previous !== undefined && projection.contextRevision < previous.contextRevision)
      return false;
    const artifactRefs = new Map<string, ArtifactRef>();
    for (const content of input.contents) {
      assertTaskBusinessIdentity(content.identity, projection.identity);
      artifactRefs.set(
        taskBusinessRefKey(content.ref),
        await this.#retainContent(client, input.bindingId, content, projection.projectedAt, active),
      );
    }
    await appendTaskBusinessObservation(
      client,
      input.bindingId,
      {
        recordType: 'task_business.projection',
        projection: {
          ...projection,
          objects: projection.objects.map((object) => {
            const artifactRef = artifactRefs.get(taskBusinessRefKey(object.ref));
            return artifactRef === undefined ? object : { ...object, artifactRef };
          }),
        },
      },
      projection.projectedAt,
      active,
    );
    return true;
  }

  async #retainContent(
    client: PoolClient,
    bindingId: string,
    content: TaskBusinessContent,
    observedAt: string,
    active: boolean,
  ): Promise<ArtifactRef> {
    if (
      content.bytes.byteLength > TASK_BUSINESS_LIMITS.artifactBytes ||
      content.digest !== taskBusinessContentDigest(content.bytes)
    )
      throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INVALID');
    const refKey = taskBusinessRefKey(content.ref);
    let metadataHash: string;
    try {
      metadataHash = hashCanonicalEvidenceJson(content.metadata);
    } catch (error: unknown) {
      if (!(error instanceof EvidenceContractError) || error.code !== 'EVIDENCE_JSON_SIZE_EXCEEDED')
        throw error;
      metadataHash = hashSourceArtifactJson(content.metadata as EvidenceJsonValue);
    }
    const existing = await client.query<{ observation_id: string; payload_json: unknown }>(
      `SELECT observation_id,payload_json FROM remote_task_observation WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.object'
         AND payload_json->>'refKey'=$2 ORDER BY sequence LIMIT 1`,
      [bindingId, refKey],
    );
    if (existing.rows[0] !== undefined) {
      const object = objectSchema.parse(existing.rows[0].payload_json);
      if (object.digest !== content.digest || object.metadataHash !== metadataHash)
        throw new TaskBusinessError('TASK_BUSINESS_OBJECT_CONFLICT');
      return buildTaskBusinessSourceArtifact(existing.rows[0].observation_id, content).artifactRef;
    }
    const observationId = await appendTaskBusinessObservation(
      client,
      bindingId,
      {
        recordType: 'task_business.object',
        refKey,
        digest: content.digest,
        metadataHash,
        metadata: content.metadata,
      },
      observedAt,
      active,
    );
    const stored = await client.query(
      "SELECT 1 FROM remote_task_observation WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.content' AND payload_json->>'digest'=$2 LIMIT 1",
      [bindingId, content.digest],
    );
    if (stored.rowCount !== 0)
      return buildTaskBusinessSourceArtifact(observationId, content).artifactRef;
    for (
      let offset = 0;
      offset < Math.max(1, content.bytes.byteLength);
      offset += TASK_BUSINESS_LIMITS.chunkBytes
    ) {
      const bytes = Buffer.from(
        content.bytes.subarray(offset, offset + TASK_BUSINESS_LIMITS.chunkBytes),
      ).toString('base64');
      await appendTaskBusinessObservation(
        client,
        bindingId,
        {
          recordType: 'task_business.content',
          schemaVersion: 'sdar.task-business-content/v1',
          digest: content.digest,
          offset,
          totalBytes: content.bytes.byteLength,
          bytes,
        },
        observedAt,
        active,
      );
    }
    return buildTaskBusinessSourceArtifact(observationId, content).artifactRef;
  }

  async readContent(bindingId: string, digest: string): Promise<Uint8Array | undefined> {
    const scope = remoteTaskChildScopeSql(this.deviceScope, 3, 'observation');
    const rows = await this.pool.query<{ payload_json: unknown }>(
      `SELECT payload_json FROM remote_task_observation observation WHERE binding_id=$1 AND ${scope.predicate}
        AND payload_json->>'recordType'='task_business.content' AND payload_json->>'digest'=$2
       ORDER BY (payload_json->>'offset')::integer LIMIT 172`,
      [bindingId, digest, ...scope.values],
    );
    if (rows.rows.length === 0) return undefined;
    let offset = 0;
    let total: number | undefined;
    const chunks: Buffer[] = [];
    for (const row of rows.rows) {
      const chunk = chunkSchema.parse(row.payload_json);
      const bytes = Buffer.from(chunk.bytes, 'base64');
      if (
        chunk.digest !== digest ||
        chunk.offset !== offset ||
        bytes.toString('base64') !== chunk.bytes ||
        (total !== undefined && total !== chunk.totalBytes) ||
        chunk.totalBytes > TASK_BUSINESS_LIMITS.artifactBytes
      )
        throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INVALID');
      total = chunk.totalBytes;
      offset += bytes.byteLength;
      chunks.push(bytes);
    }
    const content = Buffer.concat(chunks);
    if (offset !== total || taskBusinessContentDigest(content) !== digest)
      throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INCOMPLETE');
    return content;
  }
  async markRefreshFailed(bindingId: string, errorCode: string, observedAt: string): Promise<void> {
    const previous = await this.find(bindingId);
    await this.#transaction(async (client) => {
      const scope = remoteTaskScopeSql(this.deviceScope, 2, 'binding');
      const locked = await client.query(
        `SELECT binding_id FROM remote_task_binding binding WHERE binding_id=$1 AND ${scope.predicate} FOR UPDATE`,
        [bindingId, ...scope.values],
      );
      if (locked.rowCount !== 1) throw new TaskBusinessError('TASK_BUSINESS_OWNER_NOT_FOUND');
      const current = await client.query<{ payload_json: unknown }>(
        `SELECT payload_json FROM remote_task_observation WHERE binding_id=$1 AND payload_json->>'recordType'='task_business.projection' ORDER BY sequence DESC LIMIT 1`,
        [bindingId],
      );
      const latest = projectionFromPayload(current.rows[0]?.payload_json);
      await appendTaskBusinessObservation(
        client,
        bindingId,
        { recordType: 'task_business.refresh_failure', errorCode, observedAt },
        observedAt,
        false,
      );
      if (previous === undefined || latest?.projectionRevision !== previous.projectionRevision)
        return;
      await appendTaskBusinessObservation(
        client,
        bindingId,
        {
          recordType: 'task_business.projection',
          projection: {
            ...previous,
            projectionRevision: previous.projectionRevision + 1,
            status: 'history',
            projectedAt: observedAt,
            allowedInterventions: [],
            interactionRequests: [],
            quality: {
              ...previous.quality,
              currentStateComplete: false,
              requiredObjectsResolved: false,
              gaps: [...new Set([...previous.quality.gaps, `refresh_failed:${errorCode}`])],
            },
          },
        },
        observedAt,
        false,
      );
    });
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

export async function appendTaskBusinessObservation(
  client: PoolClient,
  bindingId: string,
  payload: unknown,
  observedAt: string,
  active = true,
): Promise<string> {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) > 1_000_000)
    throw new TaskBusinessError('TASK_BUSINESS_RECORD_LIMIT');
  const observationId = `task-business-${randomUUID()}`;
  await client.query(
    `INSERT INTO remote_task_observation(observation_id,binding_id,sequence,observation_type,payload_json,accepted,rejection_reason,observed_at,observation_source)
     SELECT $1,$2,COALESCE(MAX(sequence),0)+1,'task.snapshot',$3::jsonb,$4,$5,$6,'reconciliation'
       FROM remote_task_observation WHERE binding_id=$2`,
    [observationId, bindingId, json, active, active ? null : 'binding_closed', observedAt],
  );
  return observationId;
}
function projectionFromPayload(raw: unknown): TaskBusinessProjection | undefined {
  if (raw === undefined) return undefined;
  const envelope = z
    .object({ recordType: z.literal('task_business.projection'), projection: z.unknown() })
    .strict()
    .parse(raw);
  return parseTaskBusinessProjection(envelope.projection);
}
