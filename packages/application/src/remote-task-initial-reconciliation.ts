import { isDeepStrictEqual } from 'node:util';
import {
  compareRuntimeRevisions,
  type RemoteTaskBinding,
  type RemoteTaskSnapshot,
} from '../../domain/src/index.js';
import type { RemoteTaskRepository } from './ports.js';

/** Reconcile a retained admission receipt against concurrent native polls, without resending a Tool. */
export async function reconcileInitialRemoteTaskSnapshot(
  input: Readonly<{
    repository: Pick<RemoteTaskRepository, 'findById' | 'recordExternalSnapshot'>;
    admitted: RemoteTaskBinding;
    snapshot: RemoteTaskSnapshot;
    observationId: string;
    controlEventId?: string;
    resultHash?: string;
    observedAt: string;
  }>,
): Promise<void> {
  let current = input.admitted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await input.repository.recordExternalSnapshot({
      bindingId: current.bindingId,
      expectedVersion: current.version,
      snapshot: input.snapshot,
      observationId: input.observationId,
      source: 'reconciliation',
      ...(input.controlEventId === undefined ? {} : { controlEventId: input.controlEventId }),
      ...(input.resultHash === undefined ? {} : { resultHash: input.resultHash }),
      observedAt: input.observedAt,
    });
    if (result.applied) return;
    if (result.reason === 'missing') fail('missing');
    const found = await input.repository.findById(current.bindingId);
    if (found === undefined) fail('missing');
    if (!sameAdmission(found, input.admitted)) fail('identity_conflict');
    if (found.invalidatedAt !== undefined || found.localState === 'quarantined') fail('closed');
    // A newer accepted poll owns the lifecycle. The retained receipt cannot overwrite it.
    if (
      found.runtimeRevision !== undefined &&
      input.snapshot.runtimeRevision !== undefined &&
      compareRuntimeRevisions(found.runtimeRevision, input.snapshot.runtimeRevision) >= 0
    )
      return;
    if (result.reason === 'closed') fail('closed');
    if (found.terminalAt !== undefined) fail('closed');
    current = found;
  }
  fail('stale');
}

function sameAdmission(a: RemoteTaskBinding, b: RemoteTaskBinding): boolean {
  return (
    [
      'bindingId',
      'serverId',
      'operationName',
      'remoteTaskId',
      'agentTaskId',
      'contextId',
      'goalId',
      'goalVersion',
      'workflowPlanId',
      'workflowInstanceId',
      'workflowNodeId',
      'workflowNodeRunId',
      'mcpInvocationId',
      'protocolRevision',
      'credentialRevision',
      'sessionRevision',
    ].every((key) => a[key as keyof RemoteTaskBinding] === b[key as keyof RemoteTaskBinding]) &&
    isDeepStrictEqual(a.authoritySnapshot, b.authoritySnapshot) &&
    isDeepStrictEqual(a.protocolContract, b.protocolContract) &&
    isDeepStrictEqual(a.executionContext, b.executionContext)
  );
}
function fail(reason: 'stale' | 'closed' | 'missing' | 'identity_conflict'): never {
  const code = `REMOTE_TASK_INITIAL_RECONCILIATION_${reason.toUpperCase()}`;
  throw Object.assign(new Error(code), { code });
}
