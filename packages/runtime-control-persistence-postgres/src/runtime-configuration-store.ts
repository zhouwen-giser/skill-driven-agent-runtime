import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  rehydrateConfigurationRevision,
  type ConfigurationRevision,
  type JsonObject,
  type JsonValue,
  type RuntimeRevisionAck,
} from '../../node-control-domain/src/index.js';
import type {
  RuntimeConfigurationStore,
  RuntimeConfigurationTarget,
  RuntimeTaskConfigurationBinding,
} from '../../runtime-control-application/src/index.js';

interface SnapshotRow extends QueryResultRow {
  configuration_id: string;
  revision: string;
  target_type: ConfigurationRevision['targetType'];
  target_id: string;
  apply_mode: ConfigurationRevision['applyMode'];
  content: JsonValue;
  checksum: string;
  created_by: string;
  created_at: Date;
  published_at: Date;
}

interface AckRow extends QueryResultRow {
  runtime_instance_id: string;
  target_type: ConfigurationRevision['targetType'];
  target_id: string;
  revision: string;
  status: RuntimeRevisionAck['status'];
  observed_runtime_version: string;
  active_checksum: string | null;
  reason_code: string | null;
  detail: JsonObject;
  acknowledged_at: Date;
}

interface BindingRow extends QueryResultRow {
  task_id: string;
  target_type: ConfigurationRevision['targetType'];
  target_id: string;
  configuration_id: string;
  revision: string;
  checksum: string;
  bound_at: Date;
}

export class PostgresRuntimeConfigurationStore implements RuntimeConfigurationStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findLkg(target: RuntimeConfigurationTarget): Promise<ConfigurationRevision | undefined> {
    const result = await this.#pool.query<SnapshotRow>(
      `${SNAPSHOT_SELECT}
        WHERE target_type=$1 AND target_id=$2 AND is_lkg=true`,
      [target.targetType, target.targetId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapSnapshot(row);
  }

  recordOutcome(
    revision: ConfigurationRevision,
    acknowledgement: RuntimeRevisionAck,
    activate: boolean,
  ): Promise<void> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
        revision.targetType,
        revision.targetId,
      ]);
      if (activate) {
        await client.query(
          `UPDATE runtime_configuration_snapshot SET is_active=false,is_lkg=false
            WHERE target_type=$1 AND target_id=$2 AND (is_active OR is_lkg)`,
          [revision.targetType, revision.targetId],
        );
        await client.query(
          `INSERT INTO runtime_configuration_snapshot (
             configuration_id,revision,target_type,target_id,apply_mode,content,checksum,
             created_by,created_at,published_at,is_active,is_lkg,applied_at
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,true,true,$11)
           ON CONFLICT (configuration_id,revision) DO UPDATE SET
             is_active=true,is_lkg=true,applied_at=EXCLUDED.applied_at`,
          [
            revision.configurationId,
            revision.revision,
            revision.targetType,
            revision.targetId,
            revision.applyMode,
            JSON.stringify(revision.content),
            revision.checksum,
            revision.createdBy,
            revision.createdAt,
            revision.publishedAt ?? revision.createdAt,
            acknowledgement.acknowledgedAt,
          ],
        );
      }
      await insertAck(client, acknowledgement);
    });
  }

  pinTask(
    taskId: string,
    target: RuntimeConfigurationTarget,
    boundAt: string,
  ): Promise<RuntimeTaskConfigurationBinding> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
        taskId,
        `${target.targetType}:${target.targetId}`,
      ]);
      const snapshot = await client.query<SnapshotRow>(
        `${SNAPSHOT_SELECT}
          WHERE target_type=$1 AND target_id=$2 AND is_active=true`,
        [target.targetType, target.targetId],
      );
      const active = snapshot.rows[0];
      if (active === undefined) throw new Error('RUNTIME_ACTIVE_CONFIGURATION_UNAVAILABLE');
      await client.query(
        `INSERT INTO runtime_task_configuration_binding (
           task_id,target_type,target_id,configuration_id,revision,checksum,bound_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (task_id,target_type,target_id) DO NOTHING`,
        [
          taskId,
          target.targetType,
          target.targetId,
          active.configuration_id,
          active.revision,
          active.checksum,
          boundAt,
        ],
      );
      const binding = await client.query<BindingRow>(
        `SELECT task_id,target_type,target_id,configuration_id,revision::text,checksum::text,bound_at
           FROM runtime_task_configuration_binding
          WHERE task_id=$1 AND target_type=$2 AND target_id=$3`,
        [taskId, target.targetType, target.targetId],
      );
      const row = binding.rows[0];
      if (row === undefined) throw new Error('RUNTIME_TASK_CONFIGURATION_BINDING_MISSING');
      return mapBinding(row);
    });
  }

  async listPendingAcks(limit: number): Promise<readonly RuntimeRevisionAck[]> {
    const result = await this.#pool.query<AckRow>(
      `SELECT runtime_instance_id,target_type,target_id,revision::text,status,
              observed_runtime_version,active_checksum::text,reason_code,detail,acknowledged_at
         FROM runtime_configuration_ack_outbox
        WHERE delivered_at IS NULL
        ORDER BY acknowledged_at,ack_id
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapAck);
  }

  async markAckDelivered(acknowledgement: RuntimeRevisionAck, deliveredAt: string): Promise<void> {
    await this.#pool.query(
      `UPDATE runtime_configuration_ack_outbox
          SET delivered_at=$6,delivery_attempts=delivery_attempts+1,last_error=NULL
        WHERE runtime_instance_id=$1 AND target_type=$2 AND target_id=$3
          AND revision=$4 AND status=$5`,
      [
        acknowledgement.runtimeInstanceId,
        acknowledgement.targetType,
        acknowledgement.targetId,
        acknowledgement.revision,
        acknowledgement.status,
        deliveredAt,
      ],
    );
  }

  async recordAckDeliveryFailure(
    acknowledgement: RuntimeRevisionAck,
    error: string,
  ): Promise<void> {
    await this.#pool.query(
      `UPDATE runtime_configuration_ack_outbox
          SET delivery_attempts=delivery_attempts+1,last_error=$6
        WHERE runtime_instance_id=$1 AND target_type=$2 AND target_id=$3
          AND revision=$4 AND status=$5`,
      [
        acknowledgement.runtimeInstanceId,
        acknowledgement.targetType,
        acknowledgement.targetId,
        acknowledgement.revision,
        acknowledgement.status,
        error.slice(0, 2048),
      ],
    );
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

const SNAPSHOT_SELECT = `
  SELECT configuration_id,revision::text,target_type,target_id,apply_mode,content,
         checksum::text,created_by,created_at,published_at
    FROM runtime_configuration_snapshot`;

async function insertAck(client: PoolClient, acknowledgement: RuntimeRevisionAck): Promise<void> {
  const ackId = stableId(
    'runtime-config-ack',
    `${acknowledgement.runtimeInstanceId}:${acknowledgement.targetType}:${acknowledgement.targetId}:${String(acknowledgement.revision)}:${acknowledgement.status}`,
  );
  await client.query(
    `INSERT INTO runtime_configuration_ack_outbox (
       ack_id,runtime_instance_id,target_type,target_id,revision,status,observed_runtime_version,
       active_checksum,reason_code,detail,acknowledged_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT (runtime_instance_id,target_type,target_id,revision,status) DO UPDATE SET
       observed_runtime_version=EXCLUDED.observed_runtime_version,
       active_checksum=EXCLUDED.active_checksum,reason_code=EXCLUDED.reason_code,
       detail=EXCLUDED.detail,acknowledged_at=EXCLUDED.acknowledged_at`,
    [
      ackId,
      acknowledgement.runtimeInstanceId,
      acknowledgement.targetType,
      acknowledgement.targetId,
      acknowledgement.revision,
      acknowledgement.status,
      acknowledgement.observedRuntimeVersion,
      acknowledgement.activeChecksum ?? null,
      acknowledgement.reasonCode ?? null,
      JSON.stringify(acknowledgement.detail ?? {}),
      acknowledgement.acknowledgedAt,
    ],
  );
}

function mapSnapshot(row: SnapshotRow): ConfigurationRevision {
  return rehydrateConfigurationRevision({
    configurationId: row.configuration_id,
    revision: Number(row.revision),
    targetType: row.target_type,
    targetId: row.target_id,
    status: 'applied',
    applyMode: row.apply_mode,
    content: row.content,
    checksum: row.checksum,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at.toISOString(),
  });
}

function mapAck(row: AckRow): RuntimeRevisionAck {
  return Object.freeze({
    runtimeInstanceId: row.runtime_instance_id,
    targetType: row.target_type,
    targetId: row.target_id,
    revision: Number(row.revision),
    status: row.status,
    observedRuntimeVersion: row.observed_runtime_version,
    ...(row.active_checksum === null ? {} : { activeChecksum: row.active_checksum }),
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    ...(Object.keys(row.detail).length === 0 ? {} : { detail: row.detail }),
    acknowledgedAt: row.acknowledged_at.toISOString(),
  });
}

function mapBinding(row: BindingRow): RuntimeTaskConfigurationBinding {
  return Object.freeze({
    taskId: row.task_id,
    targetType: row.target_type,
    targetId: row.target_id,
    configurationId: row.configuration_id,
    revision: Number(row.revision),
    checksum: row.checksum,
    boundAt: row.bound_at.toISOString(),
  });
}

function stableId(namespace: string, value: string): string {
  return `${namespace}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}
