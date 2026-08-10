import { createHash } from 'node:crypto';

import type {
  EvidenceConfigurationMetadata,
  EvidenceDeadLetterMetadata,
  EvidenceManifestMetadata,
  EvidenceMetadataPage,
  EvidenceOperationsPageQuery,
  EvidenceOperationsStatusMetadata,
  EvidenceOutboxRecordMetadata,
  EvidenceProjectionCheckpointMetadata,
  EvidenceProjectionIssueMetadata,
  EvidenceQualityIssueMetadata,
  EvidenceRecoveryRequest,
  EvidenceRecoveryRunMetadata,
} from '../../runtime-control-application/src/index.js';
import {
  createManagementOperation,
  transitionManagementOperation,
  type ControlAuditEvent,
  type ManagementOperation,
} from '../../node-control-domain/src/index.js';
import type { NodeControlFoundationRepository } from './ports.js';

export interface NodeControlRuntimeEvidenceOperationsClient {
  configuration(): Promise<EvidenceConfigurationMetadata | undefined>;
  status(): Promise<EvidenceOperationsStatusMetadata>;
  outbox(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceOutboxRecordMetadata>>;
  checkpoints(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionCheckpointMetadata>>;
  projectionIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceProjectionIssueMetadata>>;
  qualityIssues(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceQualityIssueMetadata>>;
  manifest(episodeId: string): Promise<EvidenceManifestMetadata | undefined>;
  deadLetters(
    query: EvidenceOperationsPageQuery,
  ): Promise<EvidenceMetadataPage<EvidenceDeadLetterMetadata>>;
  recover(request: EvidenceRecoveryRequest): Promise<EvidenceRecoveryRunMetadata>;
}

export interface EvidenceOperationsPrincipal {
  readonly actorId: string;
  readonly role:
    'node_admin' | 'security_admin' | 'node_operator' | 'node_viewer' | 'organization_service';
}

export type NodeControlEvidenceRecoveryIntent =
  | Readonly<{ operation: 'replay_record'; recordId: string }>
  | Readonly<{
      operation: 'replay_source_partition';
      sourceFamily: string;
      sourcePartition: string;
    }>
  | Readonly<{ operation: 'replay_episode'; episodeId: string }>
  | Readonly<{ operation: 'retry_dead_letter'; deadLetterId: string }>
  | Readonly<{ operation: 'reconcile_coverage'; episodeId?: string }>;

/** Control-owned RBAC/audit facade over Runtime-owned Evidence recovery authority. */
export class NodeControlEvidenceOperationsService {
  readonly #runtime: NodeControlRuntimeEvidenceOperationsClient;
  readonly #operations: NodeControlFoundationRepository;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(input: {
    readonly runtime: NodeControlRuntimeEvidenceOperationsClient;
    readonly operations: NodeControlFoundationRepository;
    readonly clock: Readonly<{ now(): string }>;
  }) {
    this.#runtime = input.runtime;
    this.#operations = input.operations;
    this.#clock = input.clock;
  }

  configuration() {
    return this.#runtime.configuration();
  }

  status() {
    return this.#runtime.status();
  }

  outbox(query: EvidenceOperationsPageQuery) {
    return this.#runtime.outbox(query);
  }

  checkpoints(query: EvidenceOperationsPageQuery) {
    return this.#runtime.checkpoints(query);
  }

  projectionIssues(query: EvidenceOperationsPageQuery) {
    return this.#runtime.projectionIssues(query);
  }

  qualityIssues(query: EvidenceOperationsPageQuery) {
    return this.#runtime.qualityIssues(query);
  }

  manifest(episodeId: string) {
    return this.#runtime.manifest(episodeId);
  }

  deadLetters(query: EvidenceOperationsPageQuery) {
    return this.#runtime.deadLetters(query);
  }

  async recover(
    intent: NodeControlEvidenceRecoveryIntent,
    principal: EvidenceOperationsPrincipal,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    assertPrivilegedPrincipal(principal);
    const cleanKey = bounded(idempotencyKey, 'idempotencyKey', 8, 512);
    const cleanReason = bounded(reason, 'reason', 1, 2_048);
    const idempotencyKeyHash = sha256(cleanKey);
    const operationType = controlOperationType(intent.operation);
    const target = recoveryTarget(intent);
    const inputHash = sha256(
      JSON.stringify({ operationType, target, actorId: principal.actorId, reason: cleanReason }),
    );
    const replayReader = requiredReplayReader(this.#operations);
    const intentWriter = requiredOperationWriter(this.#operations);
    const completionWriter = requiredOperationCompletionWriter(this.#operations);
    const replay = await replayReader(operationType, idempotencyKeyHash);
    if (replay !== undefined) {
      if (replay.inputHash !== inputHash) {
        throw controlError(
          'EVIDENCE_OPERATIONS_IDEMPOTENCY_CONFLICT',
          'Evidence recovery idempotency key was reused with different input.',
          409,
        );
      }
      if (['succeeded', 'failed', 'canceled'].includes(replay.status)) return replay;
    }

    const requestedAt = this.#clock.now();
    const operationId = `control-evidence-recovery-${sha256(`${operationType}:${idempotencyKeyHash}`)}`;
    const running =
      replay ??
      (await (async () => {
        const accepted = createManagementOperation(
          {
            operationId,
            operationType,
            target: {
              type: 'evidence_recovery',
              id: targetId(intent),
            },
            actorId: bounded(principal.actorId, 'actorId', 1, 256),
            reason: cleanReason,
            idempotencyKeyHash,
            inputHash,
          },
          requestedAt,
        );
        const started = transitionManagementOperation(accepted, 'running', requestedAt);
        return intentWriter(started, auditForRecovery(started, inputHash, 'STARTED'));
      })());
    if (['succeeded', 'failed', 'canceled'].includes(running.status)) return running;
    let completed: ManagementOperation;
    try {
      const recovery = await this.#runtime.recover({
        ...intent,
        operationId: running.operationId,
        idempotencyKeyHash: `sha256:${idempotencyKeyHash}`,
        actorId: principal.actorId,
        reason: cleanReason,
        requestedAt,
      });
      if (recovery.status === 'requested' || recovery.status === 'running') {
        return running;
      }
      completed = transitionManagementOperation(
        running,
        recovery.status === 'succeeded' ? 'succeeded' : 'failed',
        this.#clock.now(),
        recovery.status === 'succeeded'
          ? { result: recovery }
          : { errorCode: recovery.errorCode ?? 'EVIDENCE_RECOVERY_FAILED' },
      );
    } catch {
      // Runtime PostgreSQL may have committed the idempotent recovery run even when the
      // response was lost. Keep the Control operation running so the same key can safely
      // re-drive and observe the authoritative terminal result.
      return running;
    }
    return completionWriter(
      completed,
      auditForRecovery(
        completed,
        inputHash,
        completed.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
      ),
    );
  }
}

function controlOperationType(operation: NodeControlEvidenceRecoveryIntent['operation']): string {
  switch (operation) {
    case 'replay_record':
    case 'replay_source_partition':
    case 'replay_episode':
      return 'evidence.replay';
    case 'retry_dead_letter':
      return 'evidence.dead_letter.retry';
    case 'reconcile_coverage':
      return 'evidence.coverage.reconcile';
  }
}

function recoveryTarget(
  intent: NodeControlEvidenceRecoveryIntent,
): Readonly<Record<string, string>> {
  switch (intent.operation) {
    case 'replay_record':
      return Object.freeze({ recordId: intent.recordId });
    case 'replay_source_partition':
      return Object.freeze({
        sourceFamily: intent.sourceFamily,
        sourcePartition: intent.sourcePartition,
      });
    case 'replay_episode':
      return Object.freeze({ episodeId: intent.episodeId });
    case 'retry_dead_letter':
      return Object.freeze({ deadLetterId: intent.deadLetterId });
    case 'reconcile_coverage':
      return intent.episodeId === undefined
        ? Object.freeze({})
        : Object.freeze({ episodeId: intent.episodeId });
  }
}

function targetId(intent: NodeControlEvidenceRecoveryIntent): string {
  const target = recoveryTarget(intent);
  return Object.values(target).join(':') || 'all';
}

function assertPrivilegedPrincipal(principal: EvidenceOperationsPrincipal): void {
  if (!['node_admin', 'security_admin'].includes(principal.role)) {
    throw controlError(
      'EVIDENCE_OPERATIONS_ROLE_FORBIDDEN',
      'Evidence recovery requires node_admin or security_admin.',
      403,
    );
  }
}

function requiredReplayReader(repository: NodeControlFoundationRepository) {
  if (repository.findGovernanceOperationReplay === undefined) {
    throw controlError(
      'EVIDENCE_OPERATIONS_AUDIT_UNAVAILABLE',
      'Evidence recovery audit authority is unavailable.',
      503,
    );
  }
  return repository.findGovernanceOperationReplay.bind(repository);
}

function requiredOperationWriter(repository: NodeControlFoundationRepository) {
  if (repository.recordGovernanceOperation === undefined) {
    throw controlError(
      'EVIDENCE_OPERATIONS_AUDIT_UNAVAILABLE',
      'Evidence recovery audit authority is unavailable.',
      503,
    );
  }
  return repository.recordGovernanceOperation.bind(repository);
}

function requiredOperationCompletionWriter(repository: NodeControlFoundationRepository) {
  if (repository.completeGovernanceOperation === undefined) {
    throw controlError(
      'EVIDENCE_OPERATIONS_AUDIT_UNAVAILABLE',
      'Evidence recovery completion authority is unavailable.',
      503,
    );
  }
  return repository.completeGovernanceOperation.bind(repository);
}

function auditForRecovery(
  operation: ManagementOperation,
  requestHash: string,
  resultCode: 'STARTED' | 'SUCCEEDED' | 'FAILED',
): ControlAuditEvent {
  return Object.freeze({
    auditId: `audit-${operation.operationId}-${resultCode.toLowerCase()}`,
    actorId: operation.actorId,
    action: operation.operationType,
    aggregateType: operation.target.type,
    aggregateId: operation.target.id,
    reason: operation.reason,
    requestHash,
    resultCode,
    createdAt: operation.completedAt ?? operation.createdAt,
  });
}

function bounded(value: string, field: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw controlError(
      `EVIDENCE_OPERATIONS_${field.toUpperCase()}_INVALID`,
      `Evidence operations ${field} is invalid.`,
      400,
    );
  }
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function controlError(code: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { code, status });
}
