import { describe, expect, it } from 'vitest';

import {
  createRemoteTaskAuthoritySnapshot,
  createRemoteTaskBinding,
  classifyRemoteTaskObservation,
  type RemoteTaskSnapshot,
  type RemoteTaskAdmission,
} from '../src/index.js';

const capturedAt = '2026-08-13T01:00:00.000Z';

describe('Remote Task frozen authority', () => {
  it('persists explicit Episode/task/A2A mapping and keeps all revision domains and instance distinct', () => {
    const binding = createRemoteTaskBinding(admission());
    expect(binding.bindingAuthority).toEqual({
      originType: 'smpp_registry',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      environment: 'development',
      episodeId: 'task-1',
      a2aTaskId: 'task-1',
      providerSourceId: 'smpp-source-1',
      externalProviderId: 'external-provider-1',
      externalProviderInstanceId: 'instance-distinct-from-server',
      externalServerId: 'external-server-1',
      registryRevision: '3',
      registryChecksum: 'a'.repeat(64),
    });
    expect(binding.version).toBe(1);
    expect(binding.authoritySnapshot.providerBinding?.revision).toBe(7);
  });

  it('does not infer missing Provider instance or trusted scope', () => {
    const input = admission();
    const { providerIdentity, ...missingIdentity } = input;
    expect(providerIdentity).toBeDefined();
    expect(() => createRemoteTaskBinding(missingIdentity)).toThrow(
      expect.objectContaining({ code: 'REMOTE_TASK_PROVIDER_IDENTITY_REQUIRED' }),
    );
    const snapshot = authoritySnapshot();
    const { scope, ...provider } = snapshot.providerBinding;
    expect(scope).toBeDefined();
    expect(() =>
      createRemoteTaskBinding({
        ...input,
        authoritySnapshot: { ...snapshot, providerBinding: provider },
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_SCOPE_REQUIRED' }));
    expect(() =>
      createRemoteTaskBinding({
        ...input,
        providerIdentity: {
          profileVersion: '1.0',
          providerId: 'other',
          providerInstanceId: 'instance-distinct-from-server',
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'REMOTE_TASK_PROVIDER_IDENTITY_CONFLICT' }));
  });

  it('compares Provider revisions losslessly, distinguishes duplicates/conflicts and prevents terminal rollback', () => {
    const base = createRemoteTaskBinding(admission());
    if (base.providerIdentity === undefined) throw new Error('TEST_IDENTITY_REQUIRED');
    const snapshot: RemoteTaskSnapshot = {
      remoteTaskId: base.remoteTaskId,
      providerIdentity: base.providerIdentity,
      status: 'working',
      createdAt: capturedAt,
      lastUpdatedAt: capturedAt,
      ttlMs: null,
      protocolRevision: base.protocolRevision,
      tasksSchemaRevision: base.tasksSchemaRevision,
      runtimeRevision: '9007199254740993',
      providerRevision: 'adapter:opaque',
    };
    const binding = {
      ...base,
      runtimeRevision: '9007199254740993',
      lastTaskSnapshot: snapshot,
      lastTaskProjection: 'detailed' as const,
    };
    expect(classifyRemoteTaskObservation(binding, snapshot)).toBe('duplicate');
    expect(
      classifyRemoteTaskObservation(binding, {
        ...snapshot,
        runtimeRevision: '9007199254740992',
        lastUpdatedAt: '2099-01-01T00:00:00Z',
      }),
    ).toBe('stale_provider_revision');
    expect(classifyRemoteTaskObservation(binding, { ...snapshot, statusMessage: 'changed' })).toBe(
      'revision_content_conflict',
    );
    expect(
      classifyRemoteTaskObservation(binding, {
        ...snapshot,
        providerIdentity: { ...base.providerIdentity, providerInstanceId: 'changed' },
      }),
    ).toBe('identity_conflict');
    expect(
      classifyRemoteTaskObservation(
        { ...binding, protocolStatus: 'completed', terminalAt: capturedAt },
        { ...snapshot, runtimeRevision: '9007199254740994' },
      ),
    ).toBe('terminal_conflict');
  });
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

  it('freezes legacy missing cancellation authority as fail-closed unknown', () => {
    const { taskCancellation, ...legacyAdmission } = admission();
    expect(taskCancellation).toBe('task_cancel');

    const binding = createRemoteTaskBinding(legacyAdmission);

    expect(binding.taskCancellation).toBe('unknown');
    expect(Object.isFrozen(binding)).toBe(true);
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
      registry: {
        externalProviderId: 'external-provider-1',
        revision: '3',
        checksum: 'a'.repeat(64),
      },
      scope: { tenantId: 'tenant-1', projectId: 'project-1', environment: 'development' },
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
    providerIdentity: {
      profileVersion: '1.0',
      providerId: 'external-provider-1',
      providerInstanceId: 'instance-distinct-from-server',
    },
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
    taskCancellation: 'task_cancel',
    runtimeRevision: '1',
    executionContext: { mode: 'live' },
    authoritySnapshot: authoritySnapshot(),
    credentialRevision: 'credential-revision-1',
    sessionRevision: '2026-07-28/tasks-v1',
    lastProviderUpdatedAt: capturedAt,
    pollIntervalMs: 100,
    createdAt: capturedAt,
  };
}
