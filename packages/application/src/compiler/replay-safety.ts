import { createHash } from 'node:crypto';

import {
  createArtifactValidationFailure,
  type ArtifactValidationFailure,
} from '../../../domain/src/index.js';
import type { JsonValue } from '../../../domain/src/compiler/contracts.js';

export const ARTIFACT_REPLAY_QUEUE_NAME = 'sdar-artifact-replay' as const;

export type ReplaySnapshotOrigin = 'historical_snapshot' | 'frozen_fixture' | 'synthetic_scenario';

export interface ReplaySnapshotRecord {
  readonly snapshotRef: string;
  readonly origin: ReplaySnapshotOrigin;
  readonly contentHash: string;
  readonly value: JsonValue;
}

export interface ReplaySnapshotStore {
  load(snapshotRef: string, tenantId: string): Promise<ReplaySnapshotRecord | undefined>;
}

export interface ReplayIdNamespaces {
  readonly taskId: string;
  readonly goalId: string;
  readonly attemptId: string;
  readonly workflowId: string;
  readonly idempotencyKey: string;
  readonly queueName: typeof ARTIFACT_REPLAY_QUEUE_NAME;
  readonly databaseCorrelation: string;
  readonly telemetryDimension: string;
}

export interface ReplayExecutionContext {
  readonly executionMode: 'replay';
  readonly replayRunId: string;
  readonly validationRunId: string;
  readonly replayCaseId: string;
  readonly tenantId: string;
  readonly datasetId: string;
  readonly candidateId: string;
  readonly namespaces: ReplayIdNamespaces;
}

export type ReplayOperation =
  | {
      readonly kind: 'snapshot_read';
      readonly snapshotRef: string;
    }
  | {
      readonly kind:
        | 'credential_read'
        | 'network_request'
        | 'mcp_tool'
        | 'provider_task'
        | 'device_control'
        | 'external_write'
        | 'formal_notification'
        | 'formal_outcome_write'
        | 'formal_evidence_write'
        | 'active_pointer_write'
        | 'remote_task_control';
      readonly targetRef: string;
    };

export class ReplaySideEffectDeniedError extends Error {
  readonly failure: ArtifactValidationFailure;

  constructor(failure: ArtifactValidationFailure) {
    super(`REPLAY_SIDE_EFFECT_DENIED:${failure.actualRef ?? failure.category}`);
    this.name = 'ReplaySideEffectDeniedError';
    this.failure = failure;
  }
}

export class ReplayNoPhysicalProvider {
  readonly #snapshots: ReplaySnapshotStore;

  constructor(snapshots: ReplaySnapshotStore) {
    this.#snapshots = snapshots;
  }

  async execute(
    context: ReplayExecutionContext,
    operation: ReplayOperation,
  ): Promise<ReplaySnapshotRecord> {
    assertReplayContext(context);
    if (operation.kind !== 'snapshot_read') {
      const evidenceRef = stableId(
        'replay-denial',
        `${context.validationRunId}:${context.replayCaseId}:${operation.kind}:${operation.targetRef}`,
      );
      throw new ReplaySideEffectDeniedError(
        createArtifactValidationFailure({
          failureId: stableId('validation-failure', evidenceRef),
          validationRunRef: context.validationRunId,
          replayCaseRef: context.replayCaseId,
          category: 'side_effect_attempt',
          severity: 'critical',
          actualRef: `${operation.kind}:${operation.targetRef}`,
          evidenceRefs: [evidenceRef],
          explanation: `Replay denied ${operation.kind} before any physical adapter or credential boundary.`,
        }),
      );
    }
    const snapshot = await this.#snapshots.load(operation.snapshotRef, context.tenantId);
    if (snapshot === undefined) throw new Error('REPLAY_SNAPSHOT_NOT_FOUND');
    if (
      !['historical_snapshot', 'frozen_fixture', 'synthetic_scenario'].includes(snapshot.origin)
    ) {
      throw new Error('REPLAY_SNAPSHOT_ORIGIN_FORBIDDEN');
    }
    return snapshot;
  }
}

export function createReplayIdNamespaces(replayRunId: string): ReplayIdNamespaces {
  const prefix = `replay:${replayRunId}`;
  return Object.freeze({
    taskId: `${prefix}:task`,
    goalId: `${prefix}:goal`,
    attemptId: `${prefix}:attempt`,
    workflowId: `${prefix}:workflow`,
    idempotencyKey: `${prefix}:idempotency`,
    queueName: ARTIFACT_REPLAY_QUEUE_NAME,
    databaseCorrelation: `${prefix}:database`,
    telemetryDimension: `${prefix}:telemetry`,
  });
}

function assertReplayContext(context: unknown): asserts context is ReplayExecutionContext {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new Error('REPLAY_CONTEXT_INCOMPLETE');
  }
  const candidate = context as Readonly<Record<string, unknown>>;
  if (candidate['executionMode'] !== 'replay') {
    throw new Error('REPLAY_EXECUTION_MODE_REQUIRED');
  }
  const namespacesValue = candidate['namespaces'];
  if (
    typeof namespacesValue !== 'object' ||
    namespacesValue === null ||
    Array.isArray(namespacesValue)
  ) {
    throw new Error('REPLAY_CONTEXT_INCOMPLETE');
  }
  const namespaces = namespacesValue as Readonly<Record<string, unknown>>;
  if (namespaces['queueName'] !== ARTIFACT_REPLAY_QUEUE_NAME) {
    throw new Error('REPLAY_QUEUE_NAMESPACE_INVALID');
  }
  const required = [
    candidate['replayRunId'],
    candidate['validationRunId'],
    candidate['replayCaseId'],
    candidate['tenantId'],
    candidate['datasetId'],
    candidate['candidateId'],
  ];
  if (required.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
    throw new Error('REPLAY_CONTEXT_INCOMPLETE');
  }
  const prefix = `replay:${String(candidate['replayRunId'])}:`;
  for (const value of [
    namespaces['taskId'],
    namespaces['goalId'],
    namespaces['attemptId'],
    namespaces['workflowId'],
    namespaces['idempotencyKey'],
    namespaces['databaseCorrelation'],
    namespaces['telemetryDimension'],
  ]) {
    if (typeof value !== 'string' || !value.startsWith(prefix)) {
      throw new Error('REPLAY_NAMESPACE_NOT_ISOLATED');
    }
  }
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)}`;
}
