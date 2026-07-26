import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  ArtifactPersistenceError,
  assertArtifactStatus,
  hashValidationSummary,
  type ArtifactActivationInput,
  type ArtifactCandidatePersistence,
  type ArtifactDeprecationInput,
  type ArtifactExecutionCompletion,
  type ArtifactExecutionRecord,
  type ArtifactExecutionRepository,
  type ArtifactExecutionStart,
  type ArtifactFeedbackInput,
  type ArtifactIndexEntry,
  type ArtifactIndexQuery,
  type ArtifactRef,
  type ArtifactRepository,
  type ArtifactValidationRepository,
  type ArtifactValidationRun,
  type ValidationResultInput,
  type ValidationRunInput,
  type ValidationSummary,
} from '../../../application/src/index.js';
import {
  canonicalizeArtifactData,
  createArtifactLineage,
  createArtifactRuntimeBinding,
  createCompiledArtifact,
  type ArtifactLineage,
  type ArtifactRuntimeBinding,
  type CompiledArtifact,
  type CompiledArtifactStatus,
  type CompiledArtifactType,
} from '../../../domain/src/index.js';

interface StoredArtifactEnvelope {
  readonly schemaVersion: '1.0';
  readonly artifact: CompiledArtifact;
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding?: ArtifactRuntimeBinding;
}

interface ArtifactRow extends QueryResultRow {
  artifact_id: string;
  artifact_key: string;
  version: number;
  artifact_type: CompiledArtifactType;
  tenant_id: string | null;
  domain: string;
  status: CompiledArtifactStatus;
  risk_level: CompiledArtifact['riskLevel'];
  definition: unknown;
  applicability: CompiledArtifact['applicability'];
  dependency_snapshot: CompiledArtifact['dependencySnapshot'];
  lineage_id: string;
  content_hash: string;
  validation_summary_id: string | null;
  created_at: Date | string;
}

interface ActiveIndexRow extends ArtifactRow {
  artifact_version: number;
  lock_version: number;
  activated_at: Date | string;
}

interface LineageRow extends QueryResultRow {
  lineage_id: string;
  artifact_id: string;
  artifact_version: number;
  source_episode_refs: string[];
  source_knowledge_refs: string[];
  source_correction_refs: string[];
  source_pattern_refs: string[];
  generation_methods: ArtifactLineage['generationMethods'];
  compiler_version: string;
  created_at: Date | string;
}

interface ValidationRow extends QueryResultRow {
  validation_run_id: string;
  artifact_id: string;
  artifact_version: number;
  validation_type: ArtifactValidationRun['validationType'];
  dataset_ref: string;
  status: ArtifactValidationRun['status'];
  result: string | null;
  metrics: Readonly<Record<string, unknown>>;
  counterexample_refs: string[];
  started_at: Date | string;
  completed_at: Date | string | null;
}

interface ExecutionRow extends QueryResultRow {
  artifact_execution_id: string;
  artifact_id: string;
  artifact_version: number;
  task_id: string;
  goal_id: string | null;
  goal_version: number | null;
  mode: string;
  decision_snapshot: Readonly<Record<string, unknown>>;
  generated_plan_id: string | null;
  status: ArtifactExecutionRecord['status'];
  fallback_reason_code: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
}

export class PostgresArtifactRepository implements ArtifactRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findActiveIndex(query: ArtifactIndexQuery): Promise<readonly ArtifactIndexEntry[]> {
    const limit = query.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw persistenceError('ARTIFACT_QUERY_INVALID', 'Active index limit is invalid.');
    }
    const result = await this.#pool.query<ActiveIndexRow>(
      `SELECT artifact.artifact_id,artifact.artifact_key,artifact.version,
         artifact.artifact_type,artifact.tenant_id,artifact.domain,artifact.status,
         artifact.risk_level,artifact.definition,artifact.applicability,
         artifact.dependency_snapshot,artifact.lineage_id,artifact.content_hash,
         artifact.validation_summary_id,artifact.created_at,
         pointer.artifact_version,pointer.lock_version,pointer.activated_at
       FROM artifact_active_pointer pointer
       JOIN compiled_artifact artifact
         ON artifact.artifact_id=pointer.artifact_id
        AND artifact.version=pointer.artifact_version
       WHERE artifact.status='active'
         AND ($1::text IS NULL OR artifact.tenant_id=$1)
         AND ($2::text IS NULL OR artifact.domain=$2)
         AND ($3::text[] IS NULL OR artifact.artifact_type=ANY($3))
         AND ($4::text IS NULL OR artifact.artifact_key>$4)
       ORDER BY artifact.artifact_key,artifact.version DESC
       LIMIT $5`,
      [
        query.tenantId ?? null,
        query.domain ?? null,
        query.artifactTypes === undefined ? null : [...query.artifactTypes],
        query.afterArtifactKey ?? null,
        limit,
      ],
    );
    return Object.freeze(
      await Promise.all(
        result.rows.map(async (row) => {
          const envelope = parseEnvelope(row.definition);
          assertEnvelopeProjection(row, envelope);
          assertLineageProjection(
            await selectLineage(this.#pool, {
              artifactId: row.artifact_id,
              version: row.version,
            }),
            envelope,
          );
          return Object.freeze({
            artifactId: row.artifact_id,
            artifactKey: row.artifact_key,
            artifactVersion: row.artifact_version,
            artifactType: row.artifact_type,
            ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
            domain: row.domain,
            riskLevel: row.risk_level,
            contentHash: row.content_hash,
            dependencySnapshot: Object.freeze({ ...row.dependency_snapshot }),
            pointerLockVersion: row.lock_version,
            activatedAt: iso(row.activated_at),
          });
        }),
      ),
    );
  }

  async getDefinition(ref: ArtifactRef): Promise<CompiledArtifact | undefined> {
    const result = await this.#pool.query<ArtifactRow>(
      `SELECT artifact_id,artifact_key,version,artifact_type,tenant_id,domain,status,risk_level,
         definition,applicability,dependency_snapshot,lineage_id,content_hash,
         validation_summary_id,created_at
       FROM compiled_artifact WHERE artifact_id=$1 AND version=$2`,
      [ref.artifactId, ref.version],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const envelope = parseEnvelope(row.definition);
    assertEnvelopeProjection(row, envelope);
    const lineage = await selectLineage(this.#pool, ref);
    assertLineageProjection(lineage, envelope);
    const currentArtifact = {
      ...envelope.artifact,
      status: row.status,
      ...(row.validation_summary_id === null
        ? {}
        : { validationSummaryRef: row.validation_summary_id }),
    };
    return createCompiledArtifact(
      currentArtifact,
      row.status === 'active' ? { validationPassed: true, approvalRecorded: true } : undefined,
    );
  }

  async saveCandidate(candidate: ArtifactCandidatePersistence): Promise<void> {
    const artifact = createCompiledArtifact(candidate.artifact);
    const lineage = createArtifactLineage(candidate.lineage);
    const binding =
      candidate.runtimeBinding === undefined
        ? undefined
        : createArtifactRuntimeBinding(candidate.runtimeBinding);
    assertArtifactStatus(artifact.status, ['candidate'], 'candidate persistence');
    if (
      lineage.artifactId !== artifact.artifactId ||
      lineage.artifactVersion !== artifact.version ||
      lineage.lineageId !== artifact.lineageRef
    ) {
      throw persistenceError(
        'ARTIFACT_LINEAGE_MISMATCH',
        'Artifact and lineage identity must match.',
      );
    }
    if (
      binding !== undefined &&
      (binding.artifactId !== artifact.artifactId || binding.artifactVersion !== artifact.version)
    ) {
      throw persistenceError(
        'ARTIFACT_RUNTIME_BINDING_MISMATCH',
        'Artifact and Runtime Binding identity must match.',
      );
    }
    const envelope = Object.freeze({
      schemaVersion: '1.0' as const,
      artifact,
      lineage,
      ...(binding === undefined ? {} : { runtimeBinding: binding }),
    });
    await inTransaction(this.#pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO compiled_artifact(
           artifact_id,artifact_key,version,artifact_type,tenant_id,domain,status,risk_level,
           definition,applicability,dependency_snapshot,lineage_id,validation_summary_id,
           content_hash,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15)
         ON CONFLICT(artifact_id) DO NOTHING`,
        [
          artifact.artifactId,
          artifact.artifactKey,
          artifact.version,
          artifact.artifactType,
          artifact.scope.tenantId ?? null,
          artifact.scope.domain,
          artifact.status,
          artifact.riskLevel,
          JSON.stringify(envelope),
          JSON.stringify(artifact.applicability),
          JSON.stringify(artifact.dependencySnapshot),
          lineage.lineageId,
          artifact.validationSummaryRef ?? null,
          artifact.contentHash,
          artifact.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        const existing = await client.query<{ same: boolean }>(
          `SELECT definition=$2::jsonb AS same
           FROM compiled_artifact WHERE artifact_id=$1`,
          [artifact.artifactId, JSON.stringify(envelope)],
        );
        if (existing.rows[0]?.same !== true) {
          throw persistenceError(
            'ARTIFACT_VERSION_IMMUTABLE',
            'Artifact identity already contains different immutable content.',
          );
        }
        return;
      }
      await client.query(
        `INSERT INTO artifact_lineage(
           lineage_id,artifact_id,artifact_version,source_episode_refs,source_knowledge_refs,
           source_correction_refs,source_pattern_refs,generation_methods,compiler_version,created_at)
         VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
        [
          lineage.lineageId,
          lineage.artifactId,
          lineage.artifactVersion,
          JSON.stringify(lineage.sourceEpisodeRefs),
          JSON.stringify(lineage.sourceKnowledgeRefs),
          JSON.stringify(lineage.sourceCorrectionRefs),
          JSON.stringify(lineage.sourcePatternRefs),
          JSON.stringify(lineage.generationMethods),
          artifact.dependencySnapshot.compilerVersion,
          artifact.createdAt,
        ],
      );
      await writeOutbox(client, {
        eventId: `artifact-candidate-${artifact.artifactId}-${String(artifact.version)}`,
        eventType: 'compiler.artifact_candidate_created',
        aggregateId: artifact.artifactId,
        aggregateVersion: artifact.version,
        occurredAt: artifact.createdAt,
        payload: {
          artifactId: artifact.artifactId,
          artifactKey: artifact.artifactKey,
          artifactVersion: artifact.version,
          contentHash: artifact.contentHash,
        },
      });
    });
  }

  async activate(input: ArtifactActivationInput): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const audit = await claimActivationAudit(client, input);
      if (audit === 'completed') return;
      await lockArtifactKey(client, input.artifactKey);
      const artifact = await selectArtifactForUpdate(client, input);
      const envelope = parseEnvelope(artifact.definition);
      assertEnvelopeProjection(artifact, envelope);
      assertLineageProjection(await selectLineage(client, input), envelope);
      if (input.expectedVersion !== artifact.version) {
        throw persistenceError('ARTIFACT_EXPECTED_VERSION_CONFLICT', 'Artifact version changed.');
      }
      if (input.tenantId !== undefined && artifact.tenant_id !== input.tenantId) {
        throw persistenceError('ARTIFACT_TENANT_SCOPE_DENIED', 'Artifact tenant is out of scope.');
      }
      assertArtifactStatus(artifact.status, ['awaiting_approval'], 'activation');
      const validation = await client.query<ValidationRow>(
        `SELECT * FROM artifact_validation_run
         WHERE validation_run_id=$1 AND artifact_id=$2 AND artifact_version=$3
           AND status='passed'`,
        [artifact.validation_summary_id, input.artifactId, input.version],
      );
      const validationRow = validation.rows[0];
      if (
        validationRow?.result === undefined ||
        validationRow.result === null ||
        validationRow.completed_at === null
      ) {
        throw persistenceError(
          'ARTIFACT_VALIDATION_REQUIRED',
          'Activation requires the current passed validation run.',
        );
      }
      const validationRunId = validationRow.validation_run_id;
      if (
        hashValidationSummary(validationSummaryFromRow(validationRow)) !==
        input.validationSummaryHash
      ) {
        throw persistenceError(
          'ARTIFACT_VALIDATION_EVIDENCE_INVALID',
          'Activation evidence is not bound to the current validation result.',
        );
      }
      const approval = await client.query<{ decision: 'approved' | 'rejected' }>(
        `SELECT decision FROM artifact_approval
         WHERE artifact_id=$1 AND artifact_version=$2 AND validation_summary_hash=$3
         ORDER BY created_at DESC,approval_id DESC LIMIT 1`,
        [input.artifactId, input.version, input.validationSummaryHash],
      );
      if (approval.rows[0]?.decision !== 'approved') {
        throw persistenceError(
          'ARTIFACT_APPROVAL_REQUIRED',
          'Activation requires matching approval evidence from the authorized actor.',
        );
      }
      const pointer = await client.query<{
        artifact_id: string;
        artifact_version: number;
        lock_version: number;
      }>(
        `SELECT artifact_id,artifact_version,lock_version
         FROM artifact_active_pointer WHERE artifact_key=$1 FOR UPDATE`,
        [input.artifactKey],
      );
      const current = pointer.rows[0];
      const currentVersion = current?.lock_version ?? 0;
      if (currentVersion !== input.expectedLockVersion) {
        throw persistenceError('ARTIFACT_CAS_CONFLICT', 'Active Pointer version changed.');
      }
      if (current !== undefined) {
        await client.query(
          `UPDATE compiled_artifact SET status='deprecated'
           WHERE artifact_id=$1 AND version=$2 AND status='active'`,
          [current.artifact_id, current.artifact_version],
        );
      }
      await client.query(
        `UPDATE compiled_artifact
         SET status='active',validation_summary_id=$3
         WHERE artifact_id=$1 AND version=$2`,
        [input.artifactId, input.version, validationRunId],
      );
      await client.query(
        `INSERT INTO artifact_active_pointer(
           artifact_key,artifact_id,artifact_version,activated_by,activated_at,lock_version)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(artifact_key) DO UPDATE SET
           artifact_id=EXCLUDED.artifact_id,
           artifact_version=EXCLUDED.artifact_version,
           activated_by=EXCLUDED.activated_by,
           activated_at=EXCLUDED.activated_at,
           lock_version=EXCLUDED.lock_version`,
        [
          input.artifactKey,
          input.artifactId,
          input.version,
          input.actorId,
          input.activatedAt,
          currentVersion + 1,
        ],
      );
      await writeOutbox(client, {
        eventId: `artifact-activated-${input.artifactId}-${String(input.version)}-${String(currentVersion + 1)}`,
        eventType: 'artifact.activated',
        aggregateId: input.artifactId,
        aggregateVersion: currentVersion + 1,
        occurredAt: input.activatedAt,
        payload: {
          artifactId: input.artifactId,
          artifactKey: input.artifactKey,
          artifactVersion: input.version,
          pointerLockVersion: currentVersion + 1,
        },
      });
      await completeActivationAudit(client, input);
    });
  }

  async deprecate(input: ArtifactDeprecationInput): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      await lockArtifactKey(client, input.artifactKey);
      const pointer = await client.query<{ lock_version: number; tenant_id: string | null }>(
        `SELECT pointer.lock_version,artifact.tenant_id
         FROM artifact_active_pointer pointer
         JOIN compiled_artifact artifact
           ON artifact.artifact_id=pointer.artifact_id
          AND artifact.version=pointer.artifact_version
         WHERE pointer.artifact_key=$1 AND pointer.artifact_id=$2
           AND pointer.artifact_version=$3
         FOR UPDATE OF pointer`,
        [input.artifactKey, input.artifactId, input.version],
      );
      if ((pointer.rows[0]?.lock_version ?? -1) !== input.expectedLockVersion) {
        throw persistenceError('ARTIFACT_CAS_CONFLICT', 'Active Pointer version changed.');
      }
      if (input.expectedVersion !== input.version) {
        throw persistenceError('ARTIFACT_EXPECTED_VERSION_CONFLICT', 'Artifact version changed.');
      }
      if (input.tenantId !== undefined && pointer.rows[0]?.tenant_id !== input.tenantId) {
        throw persistenceError('ARTIFACT_TENANT_SCOPE_DENIED', 'Artifact tenant is out of scope.');
      }
      const updated = await client.query(
        `UPDATE compiled_artifact SET status='deprecated'
         WHERE artifact_id=$1 AND version=$2 AND status='active'`,
        [input.artifactId, input.version],
      );
      if (updated.rowCount !== 1) {
        throw persistenceError('ARTIFACT_STATE_INVALID', 'Only an Active Artifact can deprecate.');
      }
      await client.query(
        `UPDATE artifact_active_pointer
         SET activated_by=$2,activated_at=$3,lock_version=lock_version+1
         WHERE artifact_key=$1 AND lock_version=$4`,
        [input.artifactKey, input.actorId, input.deprecatedAt, input.expectedLockVersion],
      );
      await writeOutbox(client, {
        eventId: `artifact-deprecated-${input.artifactId}-${String(input.version)}-${String(input.expectedLockVersion + 1)}`,
        eventType: 'artifact.deprecated',
        aggregateId: input.artifactId,
        aggregateVersion: input.expectedLockVersion + 1,
        occurredAt: input.deprecatedAt,
        payload: {
          artifactId: input.artifactId,
          artifactKey: input.artifactKey,
          artifactVersion: input.version,
          actorId: input.actorId,
        },
      });
    });
  }
}

export class PostgresArtifactValidationRepository implements ArtifactValidationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async createRun(input: ValidationRunInput): Promise<ArtifactValidationRun> {
    const result = await this.#pool.query<ValidationRow>(
      `INSERT INTO artifact_validation_run(
         validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,
         result,metrics,counterexample_refs,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'pending',NULL,$6::jsonb,$7::jsonb,$8,NULL)
       RETURNING *`,
      [
        input.validationRunId,
        input.artifactId,
        input.artifactVersion,
        input.validationType,
        input.datasetRef,
        JSON.stringify(input.metrics),
        JSON.stringify(input.counterexampleRefs),
        input.startedAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw persistenceError('ARTIFACT_VALIDATION_WRITE_FAILED', 'No row.');
    return validationFromRow(row);
  }

  async appendResult(input: ValidationResultInput): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const updated = await client.query<{
        artifact_id: string;
        artifact_version: number;
      }>(
        `UPDATE artifact_validation_run
         SET status=$2,result=$3,metrics=$4::jsonb,counterexample_refs=$5::jsonb,completed_at=$6
         WHERE validation_run_id=$1 AND status IN ('pending','running')
         RETURNING artifact_id,artifact_version`,
        [
          input.validationRunId,
          input.status,
          input.result,
          JSON.stringify(input.metrics),
          JSON.stringify(input.counterexampleRefs),
          input.completedAt,
        ],
      );
      const run = updated.rows[0];
      if (run === undefined) {
        throw persistenceError(
          'ARTIFACT_VALIDATION_CAS_CONFLICT',
          'Validation run is missing or already terminal.',
        );
      }
      const transitioned = await client.query(
        `UPDATE compiled_artifact
         SET status=$3,validation_summary_id=$4
         WHERE artifact_id=$1 AND version=$2 AND status IN ('validating','revalidating')`,
        [
          run.artifact_id,
          run.artifact_version,
          input.status === 'passed' ? 'awaiting_approval' : 'rejected',
          input.validationRunId,
        ],
      );
      if (transitioned.rowCount !== 1) {
        throw persistenceError(
          'ARTIFACT_VALIDATION_STATE_CONFLICT',
          'Artifact state does not accept validation completion.',
        );
      }
      await writeOutbox(client, {
        eventId: `artifact-validation-completed-${input.validationRunId}`,
        eventType: 'artifact.validation_completed',
        aggregateType: 'artifact_validation',
        aggregateId: input.validationRunId,
        aggregateVersion: 2,
        occurredAt: input.completedAt,
        payload: {
          artifactId: run.artifact_id,
          artifactVersion: run.artifact_version,
          validationRunId: input.validationRunId,
          status: input.status,
        },
      });
      if (input.status === 'passed') {
        await writeOutbox(client, {
          eventId: `artifact-promotion-ready-${input.validationRunId}`,
          eventType: 'artifact.promotion_ready',
          aggregateType: 'artifact_validation',
          aggregateId: input.validationRunId,
          aggregateVersion: 3,
          occurredAt: input.completedAt,
          payload: {
            artifactId: run.artifact_id,
            artifactVersion: run.artifact_version,
            validationRunId: input.validationRunId,
          },
        });
      }
    });
  }

  async findPromotionSummary(ref: ArtifactRef): Promise<ValidationSummary | undefined> {
    const result = await this.#pool.query<ValidationRow>(
      `SELECT * FROM artifact_validation_run
       WHERE artifact_id=$1 AND artifact_version=$2 AND status IN ('passed','failed')
       ORDER BY completed_at DESC,validation_run_id DESC LIMIT 1`,
      [ref.artifactId, ref.version],
    );
    const row = result.rows[0];
    if (row?.result === undefined || row.result === null || row.completed_at === null) {
      return undefined;
    }
    return Object.freeze({
      validationRunId: row.validation_run_id,
      artifactId: row.artifact_id,
      artifactVersion: row.artifact_version,
      status: row.status as 'passed' | 'failed',
      result: row.result,
      metrics: Object.freeze({ ...row.metrics }),
      completedAt: iso(row.completed_at),
    });
  }
}

export class PostgresArtifactExecutionRepository implements ArtifactExecutionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async start(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord> {
    return inTransaction(this.#pool, async (client) => {
      const result = await client.query<ExecutionRow>(
        `INSERT INTO artifact_execution(
           artifact_execution_id,artifact_id,artifact_version,task_id,goal_id,goal_version,mode,
           decision_snapshot,generated_plan_id,status,fallback_reason_code,started_at,completed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'started',NULL,$10,NULL)
         RETURNING *`,
        [
          input.artifactExecutionId,
          input.artifactId,
          input.version,
          input.taskId,
          input.goalId ?? null,
          input.goalVersion ?? null,
          input.mode,
          JSON.stringify(input.decisionSnapshot),
          input.generatedPlanId ?? null,
          input.startedAt,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw persistenceError('ARTIFACT_EXECUTION_WRITE_FAILED', 'No row.');
      await writeOutbox(client, {
        eventId: `artifact-execution-started-${input.artifactExecutionId}`,
        eventType: 'artifact.execution_started',
        aggregateType: 'artifact_execution',
        aggregateId: input.artifactExecutionId,
        aggregateVersion: 1,
        occurredAt: input.startedAt,
        payload: {
          artifactExecutionId: input.artifactExecutionId,
          artifactId: input.artifactId,
          artifactVersion: input.version,
          taskId: input.taskId,
        },
      });
      return executionFromRow(row);
    });
  }

  async complete(input: ArtifactExecutionCompletion): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const updated = await client.query<{
        artifact_id: string;
        artifact_version: number;
        task_id: string;
      }>(
        `UPDATE artifact_execution
         SET status=$2,fallback_reason_code=$3,completed_at=$4
         WHERE artifact_execution_id=$1 AND status='started'
         RETURNING artifact_id,artifact_version,task_id`,
        [
          input.artifactExecutionId,
          input.status,
          input.fallbackReasonCode ?? null,
          input.completedAt,
        ],
      );
      const execution = updated.rows[0];
      if (execution === undefined) {
        throw persistenceError(
          'ARTIFACT_EXECUTION_CAS_CONFLICT',
          'Execution is missing or already terminal.',
        );
      }
      await writeOutbox(client, {
        eventId: `artifact-execution-${input.status}-${input.artifactExecutionId}`,
        eventType:
          input.status === 'completed'
            ? 'artifact.execution_completed'
            : 'artifact.execution_failed',
        aggregateType: 'artifact_execution',
        aggregateId: input.artifactExecutionId,
        aggregateVersion: 2,
        occurredAt: input.completedAt,
        payload: {
          artifactExecutionId: input.artifactExecutionId,
          artifactId: execution.artifact_id,
          artifactVersion: execution.artifact_version,
          taskId: execution.task_id,
          status: input.status,
          ...(input.fallbackReasonCode === undefined
            ? {}
            : { fallbackReasonCode: input.fallbackReasonCode }),
        },
      });
    });
  }

  async appendFeedback(input: ArtifactFeedbackInput): Promise<void> {
    await inTransaction(this.#pool, async (client) => {
      const execution = await client.query<{ artifact_version: number }>(
        `SELECT artifact_version FROM artifact_execution
         WHERE artifact_execution_id=$1 AND artifact_id=$2`,
        [input.artifactExecutionId, input.artifactId],
      );
      const version = execution.rows[0]?.artifact_version;
      if (version === undefined) {
        throw persistenceError(
          'ARTIFACT_FEEDBACK_EXECUTION_MISMATCH',
          'Feedback must reference its Artifact execution.',
        );
      }
      await client.query(
        `INSERT INTO artifact_feedback(
           feedback_id,artifact_execution_id,artifact_id,feedback_type,reason_code,summary,
           impact,outcome_ref,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          input.feedbackId,
          input.artifactExecutionId,
          input.artifactId,
          input.feedbackType,
          input.reasonCode,
          input.summary,
          JSON.stringify(input.impact),
          input.outcomeRef ?? null,
          input.createdAt,
        ],
      );
      await writeOutbox(client, {
        eventId: `artifact-feedback-${input.feedbackId}`,
        eventType: 'artifact.feedback_recorded',
        aggregateType: 'artifact_feedback',
        aggregateId: input.feedbackId,
        aggregateVersion: 1,
        occurredAt: input.createdAt,
        payload: {
          feedbackId: input.feedbackId,
          artifactExecutionId: input.artifactExecutionId,
          artifactId: input.artifactId,
          artifactVersion: version,
          feedbackType: input.feedbackType,
          reasonCode: input.reasonCode,
        },
      });
    });
  }
}

async function selectArtifactForUpdate(
  client: PoolClient,
  input: ArtifactActivationInput,
): Promise<ArtifactRow> {
  const result = await client.query<ArtifactRow>(
    `SELECT artifact_id,artifact_key,version,artifact_type,tenant_id,domain,status,risk_level,
       definition,applicability,dependency_snapshot,lineage_id,content_hash,
       validation_summary_id,created_at
     FROM compiled_artifact
     WHERE artifact_id=$1 AND version=$2 AND artifact_key=$3
     FOR UPDATE`,
    [input.artifactId, input.version, input.artifactKey],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw persistenceError('ARTIFACT_NOT_FOUND', 'Artifact version does not exist.');
  }
  return row;
}

async function selectLineage(
  queryable: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  ref: ArtifactRef,
): Promise<LineageRow> {
  const result = await queryable.query<LineageRow>(
    `SELECT lineage_id,artifact_id,artifact_version,source_episode_refs,
       source_knowledge_refs,source_correction_refs,source_pattern_refs,generation_methods,
       compiler_version,created_at
     FROM artifact_lineage WHERE artifact_id=$1 AND artifact_version=$2`,
    [ref.artifactId, ref.version],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw persistenceError('ARTIFACT_LINEAGE_NOT_FOUND', 'Artifact lineage does not exist.');
  }
  return row;
}

async function lockArtifactKey(client: PoolClient, artifactKey: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `artifact-key:${artifactKey}`,
  ]);
}

async function claimActivationAudit(
  client: PoolClient,
  input: ArtifactActivationInput,
): Promise<'claimed' | 'completed'> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `artifact-activation:${input.artifactId}:${input.idempotencyKey}`,
  ]);
  const requestHash = activationRequestHash(input);
  const actionId = activationActionId(requestHash);
  const inserted = await client.query(
    `INSERT INTO cognitive_management_action(
       action_id,operation,subject_id,expected_version,idempotency_key,actor_id,reason,
       request_hash,status,claimed_at,updated_at)
     VALUES($1,'artifact_activate',$2,$3,$4,$5,$6,$7,'pending',$8,$8)
     ON CONFLICT(operation,subject_id,idempotency_key) DO NOTHING`,
    [
      actionId,
      `${input.artifactId}:${String(input.version)}`,
      input.expectedVersion,
      input.idempotencyKey,
      input.actorId,
      input.reason,
      requestHash,
      input.activatedAt,
    ],
  );
  if (inserted.rowCount === 1) return 'claimed';
  const existing = await client.query<{
    request_hash: string;
    status: 'pending' | 'completed' | 'failed';
    error_code: string | null;
  }>(
    `SELECT request_hash,status,error_code FROM cognitive_management_action
     WHERE operation='artifact_activate' AND subject_id=$1 AND idempotency_key=$2`,
    [`${input.artifactId}:${String(input.version)}`, input.idempotencyKey],
  );
  const row = existing.rows[0];
  if (row?.request_hash !== requestHash) {
    throw persistenceError(
      'ARTIFACT_ACTIVATION_IDEMPOTENCY_CONFLICT',
      'Activation idempotency key has different content.',
    );
  }
  if (row.status === 'completed') return 'completed';
  throw persistenceError(
    row.status === 'failed'
      ? (row.error_code ?? 'ARTIFACT_ACTIVATION_PRIOR_FAILURE')
      : 'ARTIFACT_ACTIVATION_IN_PROGRESS',
    'Activation idempotency claim is unavailable.',
  );
}

async function completeActivationAudit(
  client: PoolClient,
  input: ArtifactActivationInput,
): Promise<void> {
  const requestHash = activationRequestHash(input);
  const updated = await client.query(
    `UPDATE cognitive_management_action
     SET status='completed',result=$2::jsonb,completed_at=$3,updated_at=$3
     WHERE action_id=$1 AND status='pending'`,
    [
      activationActionId(requestHash),
      JSON.stringify({
        artifactId: input.artifactId,
        artifactVersion: input.version,
        artifactKey: input.artifactKey,
        status: 'active',
      }),
      input.activatedAt,
    ],
  );
  if (updated.rowCount !== 1) {
    throw persistenceError(
      'ARTIFACT_ACTIVATION_AUDIT_CONFLICT',
      'Activation audit could not complete.',
    );
  }
}

function activationRequestHash(input: ArtifactActivationInput): string {
  const canonical = JSON.stringify([
    input.artifactId,
    input.version,
    input.artifactKey,
    input.expectedLockVersion,
    input.expectedVersion,
    input.actorId,
    input.tenantId ?? null,
    input.validationSummaryHash,
    input.idempotencyKey,
    input.reason,
    input.activatedAt,
  ]);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function activationActionId(requestHash: string): string {
  return `artifact-activation-${requestHash.slice('sha256:'.length)}`;
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
    throw persistenceError(
      'ARTIFACT_OUTBOX_IDEMPOTENCY_CONFLICT',
      'Outbox event identity already contains different content.',
    );
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

function parseEnvelope(value: unknown): StoredArtifactEnvelope {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== '1.0' ||
    !('artifact' in value) ||
    !('lineage' in value)
  ) {
    throw persistenceError(
      'ARTIFACT_PERSISTENCE_ENVELOPE_INVALID',
      'Stored Artifact envelope is invalid.',
    );
  }
  const artifact = createCompiledArtifact(
    value.artifact as CompiledArtifact,
    (value.artifact as CompiledArtifact).status === 'active'
      ? { validationPassed: true, approvalRecorded: true }
      : undefined,
  );
  const lineage = createArtifactLineage(value.lineage as ArtifactLineage);
  const binding =
    'runtimeBinding' in value && value.runtimeBinding !== undefined
      ? createArtifactRuntimeBinding(value.runtimeBinding as ArtifactRuntimeBinding)
      : undefined;
  return Object.freeze({
    schemaVersion: '1.0',
    artifact,
    lineage,
    ...(binding === undefined ? {} : { runtimeBinding: binding }),
  });
}

function assertEnvelopeProjection(row: ArtifactRow, envelope: StoredArtifactEnvelope): void {
  const artifact = envelope.artifact;
  if (
    artifact.artifactId !== row.artifact_id ||
    artifact.artifactKey !== row.artifact_key ||
    artifact.version !== row.version ||
    artifact.artifactType !== row.artifact_type ||
    artifact.riskLevel !== row.risk_level ||
    artifact.contentHash !== row.content_hash ||
    artifact.scope.domain !== row.domain ||
    (artifact.scope.tenantId ?? null) !== row.tenant_id ||
    artifact.lineageRef !== row.lineage_id ||
    artifact.createdAt !== iso(row.created_at) ||
    canonicalProjection(artifact.applicability) !== canonicalProjection(row.applicability) ||
    canonicalProjection(artifact.dependencySnapshot) !==
      canonicalProjection(row.dependency_snapshot)
  ) {
    throw persistenceError(
      'ARTIFACT_PERSISTENCE_PROJECTION_DRIFT',
      'Stored Artifact projection differs from its canonical envelope.',
    );
  }
}

function canonicalProjection(value: unknown): string {
  return canonicalizeArtifactData(value as Parameters<typeof canonicalizeArtifactData>[0]);
}

function validationSummaryFromRow(row: ValidationRow): ValidationSummary {
  if (
    row.result === null ||
    row.completed_at === null ||
    row.status === 'pending' ||
    row.status === 'running'
  ) {
    throw persistenceError(
      'ARTIFACT_VALIDATION_EVIDENCE_INVALID',
      'Validation result is not terminal.',
    );
  }
  return Object.freeze({
    validationRunId: row.validation_run_id,
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    status: row.status,
    result: row.result,
    metrics: Object.freeze({ ...row.metrics }),
    completedAt: iso(row.completed_at),
  });
}

function assertLineageProjection(row: LineageRow, envelope: StoredArtifactEnvelope): void {
  const lineage = envelope.lineage;
  if (
    lineage.lineageId !== row.lineage_id ||
    lineage.artifactId !== row.artifact_id ||
    lineage.artifactVersion !== row.artifact_version ||
    JSON.stringify(lineage.sourceEpisodeRefs) !== JSON.stringify(row.source_episode_refs) ||
    JSON.stringify(lineage.sourceKnowledgeRefs) !== JSON.stringify(row.source_knowledge_refs) ||
    JSON.stringify(lineage.sourceCorrectionRefs) !== JSON.stringify(row.source_correction_refs) ||
    JSON.stringify(lineage.sourcePatternRefs) !== JSON.stringify(row.source_pattern_refs) ||
    JSON.stringify(lineage.generationMethods) !== JSON.stringify(row.generation_methods) ||
    envelope.artifact.dependencySnapshot.compilerVersion !== row.compiler_version ||
    envelope.artifact.createdAt !== iso(row.created_at)
  ) {
    throw persistenceError(
      'ARTIFACT_LINEAGE_PROJECTION_DRIFT',
      'Stored Artifact lineage differs from its canonical envelope.',
    );
  }
}

function validationFromRow(row: ValidationRow): ArtifactValidationRun {
  return Object.freeze({
    validationRunId: row.validation_run_id,
    artifactId: row.artifact_id,
    artifactVersion: row.artifact_version,
    validationType: row.validation_type,
    datasetRef: row.dataset_ref,
    status: row.status,
    ...(row.result === null ? {} : { result: row.result }),
    metrics: Object.freeze({ ...row.metrics }),
    counterexampleRefs: Object.freeze([...row.counterexample_refs]),
    startedAt: iso(row.started_at),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
  });
}

function executionFromRow(row: ExecutionRow): ArtifactExecutionRecord {
  return Object.freeze({
    artifactExecutionId: row.artifact_execution_id,
    artifactId: row.artifact_id,
    version: row.artifact_version,
    taskId: row.task_id,
    ...(row.goal_id === null ? {} : { goalId: row.goal_id }),
    ...(row.goal_version === null ? {} : { goalVersion: row.goal_version }),
    mode: row.mode,
    decisionSnapshot: Object.freeze({ ...row.decision_snapshot }),
    ...(row.generated_plan_id === null ? {} : { generatedPlanId: row.generated_plan_id }),
    status: row.status,
    ...(row.fallback_reason_code === null ? {} : { fallbackReasonCode: row.fallback_reason_code }),
    startedAt: iso(row.started_at),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
  });
}

function persistenceError(code: string, message: string): ArtifactPersistenceError {
  return new ArtifactPersistenceError(code, message);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
