import { describe, expect, it } from 'vitest';

import {
  createRemoteTaskAuthoritySnapshot,
  createRemoteTaskBinding,
  type RemoteTaskAdmission,
} from '../src/index.js';

const capturedAt = '2026-08-13T01:00:00.000Z';

describe('Remote Task frozen authority', () => {
  it('freezes exact Runtime and Provider identity while retaining readiness timestamps for audit', () => {
    const input = authoritySnapshot();

    const snapshot = createRemoteTaskAuthoritySnapshot(input);

    expect(snapshot).toEqual(input);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.runtime)).toBe(true);
    expect(Object.isFrozen(snapshot.providerBinding)).toBe(true);
  });

  it('rejects a Provider Binding whose Catalog differs from the Runtime snapshot', () => {
    const input = authoritySnapshot();

    expect(() =>
      createRemoteTaskAuthoritySnapshot({
        ...input,
        providerBinding: { ...input.providerBinding, catalogChecksum: 'f'.repeat(64) },
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_AUTHORITY_SNAPSHOT_INVALID' }));
  });

  it('rejects an unknown snapshot schema and incomplete SMPP remote identity', () => {
    const input = authoritySnapshot();

    expect(() =>
      createRemoteTaskAuthoritySnapshot({ ...input, schemaVersion: '0.9' } as never),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_AUTHORITY_SNAPSHOT_INVALID' }));
    expect(() =>
      createRemoteTaskAuthoritySnapshot({
        ...input,
        providerBinding: { ...input.providerBinding, externalServerId: undefined } as never,
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_AUTHORITY_SNAPSHOT_INVALID' }));
  });

  it('rejects admission when the snapshot is not tied to its credential and discovery revision', () => {
    const input = admission();

    expect(() =>
      createRemoteTaskBinding({ ...input, credentialRevision: 'different-credential' }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_AUTHORITY_SNAPSHOT_MISMATCH' }));
    expect(() =>
      createRemoteTaskBinding({
        ...input,
        protocolContract: { ...input.protocolContract, serverDiscoverySnapshotId: 'different' },
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_AUTHORITY_SNAPSHOT_MISMATCH' }));
  });
});

function authoritySnapshot() {
  return {
    schemaVersion: '1.0' as const,
    capturedAt,
    runtime: {
      serverId: 'provider-1',
      endpoint: 'https://provider.test/mcp',
      serverUpdatedAt: 'credential-revision-1',
      toolRevision: 4,
      protocolSnapshotId: 'protocol-snapshot-4',
      catalogRevision: 'catalog-revision-4',
      catalogChecksum: 'c'.repeat(64),
      operationCount: 2,
    },
    providerBinding: {
      bindingId: 'binding-1',
      revision: 7,
      originType: 'smpp_registry' as const,
      providerId: 'external-provider-1',
      externalServerId: 'external-server-1',
      smppSourceId: 'smpp-source-1',
      endpointRef: 'https://provider.test/mcp',
      catalogRevision: 'catalog-revision-4',
      catalogChecksum: 'c'.repeat(64),
      operationCount: 2,
      availabilityValidUntil: '2026-08-13T01:10:00.000Z',
      observedAt: '2026-08-13T00:59:59.000Z',
    },
  };
}

function admission(): RemoteTaskAdmission {
  return {
    bindingId: 'remote-binding-1',
    serverId: 'provider-1',
    operationName: 'long_operation',
    remoteTaskId: 'provider-task-1',
    agentTaskId: 'task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'remote-node',
    workflowNodeRunId: 'remote-node:1',
    mcpInvocationId: 'invocation-1',
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'tasks-v1',
    protocolContract: {
      mode: 'frozen_v1',
      protocolVersion: '2026-07-28',
      baselineSha256: 'b'.repeat(64),
      serverDiscoverySnapshotId: 'protocol-snapshot-4',
    },
    taskBehavior: 'server_directed',
    runtimeRevision: 'runtime-1',
    executionContext: { mode: 'live' },
    authoritySnapshot: authoritySnapshot(),
    credentialRevision: 'credential-revision-1',
    sessionRevision: '2026-07-28/tasks-v1',
    lastProviderUpdatedAt: capturedAt,
    pollIntervalMs: 100,
    createdAt: capturedAt,
  };
}
