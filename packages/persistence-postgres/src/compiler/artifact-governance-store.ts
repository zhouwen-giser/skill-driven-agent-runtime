import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  ArtifactGovernanceError,
  hashValidationSummary,
  type ArtifactApprovalCommand,
  type ArtifactGovernanceStore,
  type ArtifactKillSwitchCommand,
  type ArtifactRollbackCommand,
  type ArtifactValidationCommand,
  type ValidationSummary,
} from '../../../application/src/index.js';

interface GovernedArtifactRow extends QueryResultRow {
  artifact_id: string;
  artifact_key: string;
  version: number;
  tenant_id: string | null;
  status: string;
  validation_summary_id: string | null;
}

interface ValidationSummaryRow extends QueryResultRow {
  validation_run_id: string;
  artifact_id: string;
  artifact_version: number;
  status: 'passed' | 'failed';
  result: string | null;
  metrics: Readonly<Record<string, unknown>>;
  completed_at: Date | string | null;
}

export class PostgresArtifactGovernanceStore implements ArtifactGovernanceStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async requestValidation(
    input: ArtifactValidationCommand & Readonly<{ actorId: string; tenantId?: string }>,
  ): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const artifact = await selectGovernedArtifact(client, input);
      requireTenantScope(artifact, input.tenantId);
      requireExpectedVersion(artifact, input.expectedVersion);
      if (artifact.status !== 'candidate') {
        throw governanceError('ARTIFACT_VALIDATION_STATE_INVALID');
      }
      await transitionAndCreateValidation(client, input, 'candidate', 'validating');
      await writeOutbox(client, {
        eventId: `artifact-validation-started-${input.validationRunId}`,
        eventType: 'artifact.validation_started',
        aggregateType: 'artifact_validation',
        aggregateId: input.validationRunId,
        aggregateVersion: 1,
        occurredAt: input.occurredAt,
        payload: {
          artifactId: input.artifactId,
          artifactVersion: input.version,
          validationRunId: input.validationRunId,
          validationType: input.validationType,
          actorId: input.actorId,
        },
      });
    });
  }

  async recordApproval(
    input: ArtifactApprovalCommand & Readonly<{ actorId: string; tenantId?: string }>,
  ): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const artifact = await selectGovernedArtifact(client, input);
      requireTenantScope(artifact, input.tenantId);
      requireExpectedVersion(artifact, input.expectedVersion);
      if (artifact.status !== 'awaiting_approval') {
        throw governanceError('ARTIFACT_APPROVAL_STATE_INVALID');
      }
      const summary = await latestValidationSummary(client, input.artifactId, input.version);
      if (
        summary?.status !== 'passed' ||
        hashValidationSummary(summary) !== input.validationSummaryHash
      ) {
        throw governanceError('ARTIFACT_APPROVAL_EVIDENCE_INVALID');
      }
      const inserted = await client.query(
        `INSERT INTO artifact_approval(
           approval_id,artifact_id,artifact_version,approver_id,decision,reason,
           validation_summary_hash,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(artifact_id,artifact_version,approver_id,decision,validation_summary_hash)
         DO NOTHING
         RETURNING approval_id`,
        [
          input.approvalId,
          input.artifactId,
          input.version,
          input.actorId,
          input.decision,
          input.reason,
          input.validationSummaryHash,
          input.occurredAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        throw governanceError('ARTIFACT_APPROVAL_IDEMPOTENCY_CONFLICT');
      }
      if (input.decision === 'rejected') {
        await client.query(
          `UPDATE compiled_artifact SET status='rejected'
           WHERE artifact_id=$1 AND version=$2 AND status='awaiting_approval'`,
          [input.artifactId, input.version],
        );
      }
      await writeOutbox(client, {
        eventId: `artifact-approval-${input.approvalId}`,
        eventType: 'artifact.approval_recorded',
        aggregateType: 'artifact_approval',
        aggregateId: input.approvalId,
        aggregateVersion: 1,
        occurredAt: input.occurredAt,
        payload: {
          artifactId: input.artifactId,
          artifactVersion: input.version,
          approvalId: input.approvalId,
          approverId: input.actorId,
          decision: input.decision,
          validationSummaryHash: input.validationSummaryHash,
        },
      });
    });
  }

  async requestRevalidation(
    input: ArtifactValidationCommand & Readonly<{ actorId: string; tenantId?: string }>,
  ): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const artifact = await selectGovernedArtifact(client, input);
      requireTenantScope(artifact, input.tenantId);
      requireExpectedVersion(artifact, input.expectedVersion);
      if (artifact.status !== 'active') {
        throw governanceError('ARTIFACT_REVALIDATION_STATE_INVALID');
      }
      await transitionAndCreateValidation(client, input, 'active', 'revalidating');
      await writeOutbox(client, {
        eventId: `artifact-revalidating-${input.validationRunId}`,
        eventType: 'artifact.revalidating',
        aggregateType: 'artifact_validation',
        aggregateId: input.validationRunId,
        aggregateVersion: 1,
        occurredAt: input.occurredAt,
        payload: {
          artifactId: input.artifactId,
          artifactVersion: input.version,
          validationRunId: input.validationRunId,
          actorId: input.actorId,
        },
      });
    });
  }

  async rollback(
    input: ArtifactRollbackCommand & Readonly<{ actorId: string; tenantId?: string }>,
  ): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `artifact-key:${input.artifactKey}`,
      ]);
      const pointer = await client.query<{
        artifact_id: string;
        artifact_version: number;
        lock_version: number;
      }>(
        `SELECT artifact_id,artifact_version,lock_version FROM artifact_active_pointer
         WHERE artifact_key=$1 FOR UPDATE`,
        [input.artifactKey],
      );
      const current = pointer.rows[0];
      if (current?.lock_version !== input.expectedLockVersion) {
        throw governanceError('ARTIFACT_CAS_CONFLICT');
      }
      if (
        current.artifact_id !== input.artifactId ||
        current.artifact_version !== input.version ||
        input.expectedVersion !== input.version
      ) {
        throw governanceError('ARTIFACT_EXPECTED_VERSION_CONFLICT');
      }
      const currentArtifact = await selectGovernedArtifact(client, {
        artifactId: current.artifact_id,
        version: current.artifact_version,
      });
      requireTenantScope(currentArtifact, input.tenantId);
      const target = await selectGovernedArtifact(client, {
        artifactId: input.targetArtifactId,
        version: input.targetVersion,
      });
      requireTenantScope(target, input.tenantId);
      if (target.artifact_key !== input.artifactKey || target.status !== 'deprecated') {
        throw governanceError('ARTIFACT_ROLLBACK_TARGET_INVALID');
      }
      const summary =
        target.validation_summary_id === null
          ? undefined
          : await validationSummaryById(
              client,
              target.validation_summary_id,
              input.targetArtifactId,
              input.targetVersion,
            );
      if (
        summary?.status !== 'passed' ||
        hashValidationSummary(summary) !== input.validationSummaryHash
      ) {
        throw governanceError('ARTIFACT_ROLLBACK_EVIDENCE_INVALID');
      }
      const approval = await client.query<{ decision: 'approved' | 'rejected' }>(
        `SELECT decision FROM artifact_approval
         WHERE artifact_id=$1 AND artifact_version=$2
           AND validation_summary_hash=$3
         ORDER BY created_at DESC,approval_id DESC LIMIT 1`,
        [input.targetArtifactId, input.targetVersion, input.validationSummaryHash],
      );
      if (approval.rows[0]?.decision !== 'approved') {
        throw governanceError('ARTIFACT_APPROVAL_REQUIRED');
      }
      await client.query(
        `UPDATE compiled_artifact SET status='deprecated'
         WHERE artifact_id=$1 AND version=$2 AND status='active'`,
        [current.artifact_id, current.artifact_version],
      );
      const activated = await client.query(
        `UPDATE compiled_artifact SET status='active'
         WHERE artifact_id=$1 AND version=$2 AND status='deprecated'`,
        [input.targetArtifactId, input.targetVersion],
      );
      if (activated.rowCount !== 1) throw governanceError('ARTIFACT_ROLLBACK_TARGET_INVALID');
      await client.query(
        `UPDATE artifact_active_pointer
         SET artifact_id=$2,artifact_version=$3,activated_by=$4,activated_at=$5,
             lock_version=lock_version+1
         WHERE artifact_key=$1 AND lock_version=$6`,
        [
          input.artifactKey,
          input.targetArtifactId,
          input.targetVersion,
          input.actorId,
          input.occurredAt,
          input.expectedLockVersion,
        ],
      );
      await writeOutbox(client, {
        eventId: `artifact-rollback-${input.idempotencyKey}`,
        eventType: 'artifact.activated',
        aggregateId: input.targetArtifactId,
        aggregateVersion: input.expectedLockVersion + 1,
        occurredAt: input.occurredAt,
        payload: {
          artifactId: input.targetArtifactId,
          artifactVersion: input.targetVersion,
          artifactKey: input.artifactKey,
          rollbackFromArtifactId: current.artifact_id,
          actorId: input.actorId,
        },
      });
    });
  }

  async killSwitch(
    input: ArtifactKillSwitchCommand & Readonly<{ actorId: string; tenantId?: string }>,
  ): Promise<void> {
    if (input.scope.artifactKey === undefined) {
      throw governanceError('ARTIFACT_KILL_SWITCH_SCOPE_REQUIRED');
    }
    const artifactKey = input.scope.artifactKey;
    await inTransaction(this.#pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `artifact-key:${artifactKey}`,
      ]);
      const selected = await client.query<{
        artifact_key: string;
        artifact_id: string;
        artifact_version: number;
        lock_version: number;
      }>(
        `SELECT pointer.artifact_key,pointer.artifact_id,pointer.artifact_version,
           pointer.lock_version
         FROM artifact_active_pointer pointer
         JOIN compiled_artifact artifact
           ON artifact.artifact_id=pointer.artifact_id
          AND artifact.version=pointer.artifact_version
         WHERE ($1::text IS NULL OR pointer.artifact_key=$1)
           AND ($2::text IS NULL OR artifact.tenant_id=$2)
           AND ($3::text IS NULL OR artifact.domain=$3)
         FOR UPDATE OF pointer`,
        [artifactKey, input.tenantId ?? null, input.scope.domain ?? null],
      );
      if ((selected.rows[0]?.lock_version ?? -1) !== input.expectedVersion) {
        throw governanceError('ARTIFACT_CAS_CONFLICT');
      }
      for (const row of selected.rows) {
        await client.query(
          `UPDATE compiled_artifact SET status='deprecated'
           WHERE artifact_id=$1 AND version=$2 AND status='active'`,
          [row.artifact_id, row.artifact_version],
        );
        await client.query(
          `UPDATE artifact_active_pointer
           SET activated_by=$2,activated_at=$3,lock_version=lock_version+1
           WHERE artifact_key=$1 AND lock_version=$4`,
          [row.artifact_key, input.actorId, input.occurredAt, row.lock_version],
        );
        await writeOutbox(client, {
          eventId: `artifact-kill-switch-${input.idempotencyKey}-${row.artifact_id}`,
          eventType: 'artifact.deprecated',
          aggregateId: row.artifact_id,
          aggregateVersion: row.lock_version + 1,
          occurredAt: input.occurredAt,
          payload: {
            artifactId: row.artifact_id,
            artifactVersion: row.artifact_version,
            artifactKey: row.artifact_key,
            actorId: input.actorId,
            reasonCode: 'kill_switch',
          },
        });
      }
    });
  }
}

async function transitionAndCreateValidation(
  client: PoolClient,
  input: ArtifactValidationCommand,
  from: 'candidate' | 'active',
  to: 'validating' | 'revalidating',
): Promise<void> {
  const transitioned = await client.query(
    `UPDATE compiled_artifact SET status=$4,validation_summary_id=NULL
     WHERE artifact_id=$1 AND version=$2 AND status=$3`,
    [input.artifactId, input.version, from, to],
  );
  if (transitioned.rowCount !== 1) throw governanceError('ARTIFACT_STATE_CAS_CONFLICT');
  await client.query(
    `INSERT INTO artifact_validation_run(
       validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,
       result,metrics,counterexample_refs,started_at,completed_at)
     VALUES($1,$2,$3,$4,$5,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$6,NULL)`,
    [
      input.validationRunId,
      input.artifactId,
      input.version,
      input.validationType,
      input.datasetRef,
      input.occurredAt,
    ],
  );
}

async function selectGovernedArtifact(
  client: PoolClient,
  ref: Readonly<{ artifactId: string; version: number }>,
): Promise<GovernedArtifactRow> {
  const result = await client.query<GovernedArtifactRow>(
    `SELECT artifact_id,artifact_key,version,tenant_id,status,validation_summary_id
     FROM compiled_artifact
     WHERE artifact_id=$1 AND version=$2 FOR UPDATE`,
    [ref.artifactId, ref.version],
  );
  const row = result.rows[0];
  if (row === undefined) throw governanceError('ARTIFACT_NOT_FOUND');
  return row;
}

async function latestValidationSummary(
  client: PoolClient,
  artifactId: string,
  version: number,
): Promise<ValidationSummary | undefined> {
  const result = await client.query<ValidationSummaryRow>(
    `SELECT validation_run_id,artifact_id,artifact_version,status,result,metrics,completed_at
     FROM artifact_validation_run
     WHERE artifact_id=$1 AND artifact_version=$2 AND status IN ('passed','failed')
     ORDER BY completed_at DESC,validation_run_id DESC LIMIT 1`,
    [artifactId, version],
  );
  const row = result.rows[0];
  if (row?.result === undefined || row.result === null || row.completed_at === null) {
    return undefined;
  }
  return Object.freeze({
    validationRunId: row.validation_run_id,
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    status: row.status,
    result: row.result,
    metrics: Object.freeze({ ...row.metrics }),
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : new Date(row.completed_at).toISOString(),
  });
}

async function validationSummaryById(
  client: PoolClient,
  validationRunId: string,
  artifactId: string,
  version: number,
): Promise<ValidationSummary | undefined> {
  const result = await client.query<ValidationSummaryRow>(
    `SELECT validation_run_id,artifact_id,artifact_version,status,result,metrics,completed_at
     FROM artifact_validation_run
     WHERE validation_run_id=$1 AND artifact_id=$2 AND artifact_version=$3
       AND status IN ('passed','failed')`,
    [validationRunId, artifactId, version],
  );
  const row = result.rows[0];
  if (row?.result === undefined || row.result === null || row.completed_at === null) {
    return undefined;
  }
  return Object.freeze({
    validationRunId: row.validation_run_id,
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    status: row.status,
    result: row.result,
    metrics: Object.freeze({ ...row.metrics }),
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : new Date(row.completed_at).toISOString(),
  });
}

function requireTenantScope(artifact: GovernedArtifactRow, tenantId: string | undefined): void {
  if (tenantId !== undefined && artifact.tenant_id !== tenantId) {
    throw governanceError('ARTIFACT_TENANT_SCOPE_DENIED');
  }
}

function requireExpectedVersion(artifact: GovernedArtifactRow, expectedVersion: number): void {
  if (artifact.version !== expectedVersion) {
    throw governanceError('ARTIFACT_EXPECTED_VERSION_CONFLICT');
  }
}

async function writeOutbox(
  client: PoolClient,
  event: Readonly<{
    eventId: string;
    eventType: string;
    aggregateType?: string;
    aggregateId: string;
    aggregateVersion: number;
    occurredAt: string;
    payload: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  const aggregateType = event.aggregateType ?? 'compiled_artifact';
  const payload = JSON.stringify(event.payload);
  const inserted = await client.query(
    `INSERT INTO cognitive_runtime_outbox(
       event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
       correlation,payload,occurred_at,published_at)
     VALUES($1,$2,$3,$4,$5,'{}'::jsonb,$6::jsonb,$7,NULL)
     ON CONFLICT(event_id) DO NOTHING
     RETURNING event_id`,
    [
      event.eventId,
      event.eventType,
      aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      payload,
      event.occurredAt,
    ],
  );
  if (inserted.rowCount === 1) return;
  const existing = await client.query<{ same: boolean }>(
    `SELECT event_type=$2
        AND aggregate_type=$3
        AND aggregate_id=$4
        AND aggregate_version=$5
        AND payload=$6::jsonb
        AND occurred_at=$7::timestamptz AS same
     FROM cognitive_runtime_outbox WHERE event_id=$1`,
    [
      event.eventId,
      event.eventType,
      aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      payload,
      event.occurredAt,
    ],
  );
  if (existing.rows[0]?.same !== true) {
    throw governanceError('ARTIFACT_OUTBOX_IDEMPOTENCY_CONFLICT');
  }
}

async function inTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function governanceError(code: string): ArtifactGovernanceError {
  return new ArtifactGovernanceError(code);
}
