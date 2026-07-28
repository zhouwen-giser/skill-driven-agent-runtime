import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_REPLAY_QUEUE_NAME,
  ReplayNoPhysicalProvider,
  ReplaySideEffectDeniedError,
  createReplayIdNamespaces,
  type ReplayExecutionContext,
  type ReplayOperation,
  type ReplaySnapshotStore,
} from '../src/index.js';

const snapshotStore: ReplaySnapshotStore = {
  load(snapshotRef, tenantId) {
    return Promise.resolve({
      snapshotRef,
      origin: 'historical_snapshot',
      contentHash: `sha256:${'a'.repeat(64)}`,
      value: { tenantId, frozen: true },
    });
  },
};

describe('P05 No-Physical Replay boundary', () => {
  it('reads only frozen snapshot records under a replay context', async () => {
    const result = await new ReplayNoPhysicalProvider(snapshotStore).execute(context(), {
      kind: 'snapshot_read',
      snapshotRef: 'policy-snapshot-1',
    });
    expect(result).toMatchObject({
      snapshotRef: 'policy-snapshot-1',
      origin: 'historical_snapshot',
    });
  });

  it.each([
    'credential_read',
    'network_request',
    'mcp_tool',
    'provider_task',
    'device_control',
    'external_write',
    'formal_notification',
    'formal_outcome_write',
    'formal_evidence_write',
    'active_pointer_write',
    'remote_task_control',
  ] as const)(
    'denies %s before a physical boundary and records critical unsafe evidence',
    async (kind) => {
      const operation: ReplayOperation = { kind, targetRef: `${kind}-target` };
      const rejection = new ReplayNoPhysicalProvider(snapshotStore).execute(context(), operation);
      await expect(rejection).rejects.toBeInstanceOf(ReplaySideEffectDeniedError);
      try {
        await rejection;
      } catch (error) {
        expect(error).toBeInstanceOf(ReplaySideEffectDeniedError);
        if (!(error instanceof ReplaySideEffectDeniedError)) throw error;
        expect(error.failure).toMatchObject({
          category: 'side_effect_attempt',
          severity: 'critical',
          validationRunRef: 'validation-run-1',
          replayCaseRef: 'replay-case-1',
        });
      }
    },
  );

  it('uses isolated IDs, queue and telemetry dimensions', () => {
    const namespaces = createReplayIdNamespaces('replay-run-1');
    expect(namespaces.queueName).toBe(ARTIFACT_REPLAY_QUEUE_NAME);
    for (const value of [
      namespaces.taskId,
      namespaces.goalId,
      namespaces.attemptId,
      namespaces.workflowId,
      namespaces.idempotencyKey,
      namespaces.databaseCorrelation,
      namespaces.telemetryDimension,
    ]) {
      expect(value).toMatch(/^replay:replay-run-1:/u);
    }
  });

  it('fails closed when a downstream context is not replay-aware', async () => {
    const invalid = {
      ...context(),
      namespaces: {
        ...context().namespaces,
        workflowId: 'formal-workflow-1',
      },
    };
    await expect(
      new ReplayNoPhysicalProvider(snapshotStore).execute(invalid, {
        kind: 'snapshot_read',
        snapshotRef: 'policy-snapshot-1',
      }),
    ).rejects.toThrow(/NAMESPACE_NOT_ISOLATED/u);
  });
});

function context(): ReplayExecutionContext {
  return {
    executionMode: 'replay',
    replayRunId: 'replay-run-1',
    validationRunId: 'validation-run-1',
    replayCaseId: 'replay-case-1',
    tenantId: 'tenant-p05',
    datasetId: 'dataset-1',
    candidateId: 'artifact-1:1',
    namespaces: createReplayIdNamespaces('replay-run-1'),
  };
}
