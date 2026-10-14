import { describe, expect, it, vi } from 'vitest';
import { createRemoteTaskBinding } from '../../domain/src/index.js';
import { taskBusinessFixture } from '../../domain/test/task-business-fixture.js';
import type { TaskBusinessProjection } from '../../domain/src/task-business.js';
import {
  TaskBusinessSyncService,
  type TaskBusinessCommit,
  type TaskBusinessRepository,
  type TaskBusinessReader,
} from '../src/task-business-sync.js';

function fixture() {
  const view = taskBusinessFixture();
  const binding = createRemoteTaskBinding({
    bindingId: 'binding-1',
    serverId: 'registered-server-1',
    operationName: view.context.identity.operationName,
    remoteTaskId: view.context.identity.taskId,
    agentTaskId: 'agent-task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'node-1:1',
    mcpInvocationId: 'invocation-1',
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'tasks-frozen-1',
    protocolContract: {
      mode: 'frozen_v1',
      protocolVersion: '2026-07-28',
      baselineSha256: 'a'.repeat(64),
      serverDiscoverySnapshotId: 'snapshot-1',
    },
    taskBehavior: 'server_directed',
    runtimeRevision: '1',
    taskCancellation: 'task_cancel',
    authoritySnapshot: {
      schemaVersion: '1.0',
      capturedAt: '2026-10-10T12:00:00.000Z',
      runtime: {
        serverId: 'registered-server-1',
        endpoint: 'http://127.0.0.1:1/mcp',
        serverUpdatedAt: 'original-credential-revision',
        protocolSnapshotId: 'snapshot-1',
        toolRevision: 1,
        catalogRevision: 'catalog-revision-1',
        catalogChecksum: 'c'.repeat(64),
        operationCount: 1,
      },
    },
    executionContext: { mode: 'live' },
    credentialRevision: 'original-credential-revision',
    sessionRevision: 'original-session',
    lastProviderUpdatedAt: '2026-10-10T12:00:00.000Z',
    pollIntervalMs: 1000,
    createdAt: '2026-10-10T12:00:00.000Z',
  });
  let projection: TaskBusinessProjection | undefined;
  const commits: TaskBusinessCommit[] = [];
  const markRefreshFailed = vi.fn(() => Promise.resolve());
  const repository: TaskBusinessRepository = {
    loadTarget: vi.fn(() =>
      Promise.resolve({
        binding,
        providerId: view.context.identity.providerId,
        resourceId: view.context.identity.resourceId,
      }),
    ),
    find: () => Promise.resolve(projection),
    listByTask: () => Promise.resolve(projection === undefined ? [] : [projection]),
    listRefreshable: () => Promise.resolve([binding.bindingId]),
    commit: (input) => {
      commits.push(input);
      projection = input.projection;
      return Promise.resolve('applied');
    },
    commitMany: () => Promise.resolve('applied'),
    readContent: () => Promise.resolve(undefined),
    markRefreshFailed,
  };
  const artifact = view.objects.find((object) => object.kind === 'artifact');
  if (artifact === undefined) throw new Error('FROZEN_CATALOG_ARTIFACT_MISSING');
  const reader = {
    readRemoteTaskBusinessContext: vi.fn<TaskBusinessReader['readRemoteTaskBusinessContext']>(() =>
      Promise.resolve(view),
    ),
    readRemoteTaskBusinessArtifact: vi.fn<TaskBusinessReader['readRemoteTaskBusinessArtifact']>(
      () => Promise.resolve({ artifact: artifact.value }),
    ),
    readRemoteTaskBusinessArtifactContent: vi.fn<
      TaskBusinessReader['readRemoteTaskBusinessArtifactContent']
    >(() => Promise.resolve(Buffer.from(JSON.stringify(artifact.value['content'])))),
  };
  const service = new TaskBusinessSyncService({
    repository,
    reader,
    clock: { now: () => '2026-10-10T12:00:00.000Z' },
    maxConcurrent: 2,
  });
  return { view, binding, repository, reader, service, commits, markRefreshFailed };
}

describe('TaskBusiness sync through the admitted Task authority', () => {
  it.each(['empty', 'not_produced_yet', 'unavailable', 'not_supported'])(
    'retains %s references as gaps while restoring other scoped objects',
    async (availability) => {
      const f = fixture();
      const artifact = f.view.objects.find((item) => item.kind === 'artifact');
      if (!artifact) throw Error('TEST_ARTIFACT_REQUIRED');
      f.reader.readRemoteTaskBusinessArtifact.mockResolvedValue({
        artifact: { ...artifact.value, availability },
      });
      await f.service.reconcile();
      expect(f.reader.readRemoteTaskBusinessArtifactContent).not.toHaveBeenCalled();
      expect(f.commits[0]?.projection.objects).toContainEqual({
        ref: {
          kind: 'artifact',
          id: artifact.value['artifactId'],
          revision: artifact.value.revision,
        },
        resolution: 'unresolved',
      });
      expect(f.commits[0]?.projection.quality.currentStateComplete).toBe(false);
      expect(f.commits[0]?.projection.quality.gaps).toContain('unresolved_object_content');
    },
  );
  it('AC-010 reads and recovers the same binding without any start or Tool dispatch port', async () => {
    const f = fixture();
    await f.service.reconcile();
    const recovered = new TaskBusinessSyncService({
      repository: f.repository,
      reader: f.reader,
      clock: { now: () => '2026-10-10T12:01:00.000Z' },
    });
    await recovered.reconcile();
    expect(f.reader.readRemoteTaskBusinessContext).toHaveBeenCalledTimes(2);
    expect(
      f.commits.every(
        (commit) =>
          commit.bindingId === f.binding.bindingId &&
          commit.projection.identity.executionId === f.view.context.identity.executionId,
      ),
    ).toBe(true);
    expect(f.reader.readRemoteTaskBusinessContext.mock.calls[0]?.[0]).toMatchObject({
      serverId: f.binding.serverId,
      remoteTaskId: f.binding.remoteTaskId,
      resourceId: f.view.context.identity.resourceId,
      credentialRevision: 'original-credential-revision',
      executionContext: { mode: 'live' },
    });
  });
  it('AC-007 refuses foreign Artifact execution before requesting its content', async () => {
    const f = fixture();
    f.reader.readRemoteTaskBusinessArtifact.mockResolvedValue({
      artifact: {
        ...f.view.objects.find((object) => object.kind === 'artifact')?.value,
        identity: { ...f.view.context.identity, executionId: 'foreign' },
      },
    });
    await expect(f.service.refresh(f.binding.bindingId)).rejects.toMatchObject({
      code: 'TASK_BUSINESS_EXECUTION_CONFLICT',
    });
    expect(f.reader.readRemoteTaskBusinessArtifactContent).not.toHaveBeenCalled();
    expect(f.commits).toEqual([]);
    expect(f.markRefreshFailed).toHaveBeenCalledOnce();
  });
  it('AC-009 leaves unsupported Providers on their original Task lifecycle', async () => {
    const f = fixture();
    f.reader.readRemoteTaskBusinessContext.mockRejectedValue(
      Object.assign(new Error('unsupported'), { code: 'SMPP_BUSINESS_EXTENSION_UNAVAILABLE' }),
    );
    expect(await f.service.refresh(f.binding.bindingId)).toBe('unsupported');
    expect(f.commits).toEqual([]);
    expect(f.markRefreshFailed).not.toHaveBeenCalled();
  });
  it('re-reads a poll-version CAS loss before publishing current business facts', async () => {
    const f = fixture();
    const commit = vi
      .fn<TaskBusinessRepository['commit']>()
      .mockResolvedValueOnce('stale')
      .mockResolvedValueOnce('applied');
    f.repository.commit = commit;
    expect(await f.service.refresh(f.binding.bindingId)).toBe('applied');
    expect(f.reader.readRemoteTaskBusinessContext).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(f.markRefreshFailed).not.toHaveBeenCalled();
  });
  it('bounds read-only CAS reconciliation at three reads without publishing stale facts', async () => {
    const f = fixture();
    f.repository.commit = vi.fn<TaskBusinessRepository['commit']>().mockResolvedValue('stale');
    expect(await f.service.refresh(f.binding.bindingId)).toBe('stale');
    expect(f.reader.readRemoteTaskBusinessContext).toHaveBeenCalledTimes(3);
    expect(f.commits).toEqual([]);
    expect(f.markRefreshFailed).not.toHaveBeenCalled();
  });
  it('AC-012 keeps distinct inbox checkpoints at the same Context revision', async () => {
    const f = fixture();
    for (const sequence of ['13', '14'])
      await f.service.refresh(f.binding.bindingId, {
        inboxId: `inbox-${sequence}`,
        subscriptionId: 'subscription-1',
        eventId: `event-${sequence}`,
        sequence,
        envelopeHash: `sha256:${'a'.repeat(64)}`,
        envelope: { streamId: f.view.resumeFrom.streamId },
        status: 'processing',
        admittedAt: '2026-10-10T12:00:00.000Z',
      });
    expect(f.commits.map((commit) => commit.projection.contextRevision)).toEqual([4, 4]);
    expect(f.commits.map((commit) => commit.projection.appliedEvent?.sequence)).toEqual([
      '13',
      '14',
    ]);
    expect(f.commits.map((commit) => commit.projection.projectionRevision)).toEqual([1, 2]);
  });
  it('AC-015 retains a discontinuity when a current snapshot moves to a new stream', async () => {
    const f = fixture();
    await f.service.refresh(f.binding.bindingId);
    f.reader.readRemoteTaskBusinessContext.mockResolvedValue({
      ...f.view,
      resumeFrom: { streamId: 'new-stream', afterSequence: '0' },
    });
    await f.service.refresh(f.binding.bindingId);
    expect(f.commits.at(-1)?.projection.quality.historyContinuous).toBe(false);
    expect(f.commits.at(-1)?.projection.quality.currentStateComplete).toBe(true);
  });
  it('AC-016 polling fallback records failure without starving another admitted binding', async () => {
    const f = fixture();
    f.repository.listRefreshable = () =>
      Promise.resolve(['unavailable-binding', 'healthy-binding']);
    f.reader.readRemoteTaskBusinessContext.mockRejectedValueOnce(
      new Error('temporary read failure'),
    );
    const result = await f.service.reconcile();
    expect(result).toMatchObject({
      examined: 2,
      applied: 1,
      lastBindingId: 'healthy-binding',
      failures: [{ bindingId: 'unavailable-binding', errorCode: 'TASK_BUSINESS_READ_FAILED' }],
    });
    expect(f.markRefreshFailed).toHaveBeenCalledOnce();
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0]?.bindingId).toBe('healthy-binding');
  });
  it('AC-016 bounds concurrent reads, cancels shutdown work, and leaves no new sends', async () => {
    const f = fixture();
    const signals: AbortSignal[] = [];
    f.reader.readRemoteTaskBusinessContext.mockImplementation(
      (input) =>
        new Promise((_resolve, reject) => {
          if (input.signal === undefined) throw new Error('READ_ABORT_SIGNAL_MISSING');
          signals.push(input.signal);
          input.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('READ_ABORTED'));
            },
            {
              once: true,
            },
          );
        }),
    );
    const first = f.service.prepare('binding-1');
    const second = f.service.prepare('binding-2');
    const settled = Promise.allSettled([first, second]);
    await expect(f.service.prepare('binding-3')).rejects.toMatchObject({
      code: 'TASK_BUSINESS_BACKPRESSURE',
    });
    await vi.waitFor(() => {
      expect(signals).toHaveLength(2);
    });
    await f.service.stop();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect((await settled).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    await expect(f.service.prepare('binding-1')).rejects.toMatchObject({
      code: 'TASK_BUSINESS_SYNC_STOPPED',
    });
    expect(f.commits).toEqual([]);
  });
});
