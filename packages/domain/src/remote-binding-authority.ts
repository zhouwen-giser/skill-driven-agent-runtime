import { DomainError } from './errors.js';
import type { RemoteTaskAuthoritySnapshot } from './remote-task.js';
import type {
  RemoteTaskProviderIdentity,
  RemoteTaskCreated,
  RemoteTaskSnapshot,
} from './mcp-task.js';
import type { RemoteTaskBinding } from './remote-task.js';
import { compareRuntimeRevisions } from './mcp-frozen-protocol.js';

export interface RuntimeBindingScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly environment: string;
}

export type RemoteBindingAuthority =
  | Readonly<{ originType: 'direct' }>
  | Readonly<
      RuntimeBindingScope & {
        originType: 'smpp_registry';
        episodeId: string;
        a2aTaskId: string;
        providerSourceId: string;
        externalProviderId: string;
        externalProviderInstanceId: string;
        externalServerId: string;
        registryRevision: string;
        registryChecksum: string;
      }
    >;

export function validateRuntimeBindingScope(
  scope: RuntimeBindingScope | undefined,
): RuntimeBindingScope {
  if (
    scope === undefined ||
    [scope.tenantId, scope.projectId, scope.environment].some(
      (value) => typeof value !== 'string' || value.length === 0,
    )
  )
    throw new DomainError(
      'REMOTE_TASK_SCOPE_REQUIRED',
      'SMPP admission requires explicit trusted Runtime tenant, project and environment.',
    );
  return Object.freeze({ ...scope });
}

export function validateRemoteTaskProviderIdentity(value: unknown): RemoteTaskProviderIdentity {
  const fields =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  if (
    fields?.['profileVersion'] !== '1.0' ||
    Object.keys(fields).some(
      (key) => !['profileVersion', 'providerId', 'providerInstanceId'].includes(key),
    ) ||
    [fields['providerId'], fields['providerInstanceId']].some(
      (id) => typeof id !== 'string' || id.length < 1 || id.length > 256,
    )
  )
    throw new DomainError(
      'REMOTE_TASK_PROVIDER_IDENTITY_REQUIRED',
      'Task requires the exact validated io.sdar/providerIdentity extension.',
    );
  return Object.freeze({ ...(value as RemoteTaskProviderIdentity) });
}

export function createRemoteBindingAuthority(
  taskId: string,
  snapshot: RemoteTaskAuthoritySnapshot,
  identity?: RemoteTaskProviderIdentity,
): RemoteBindingAuthority {
  const provider = snapshot.providerBinding;
  if (provider?.originType !== 'smpp_registry') return Object.freeze({ originType: 'direct' });
  const local = validateRemoteTaskProviderIdentity(identity);
  if (local.providerId !== provider.registry.externalProviderId)
    throw new DomainError(
      'REMOTE_TASK_PROVIDER_IDENTITY_CONFLICT',
      'Provider identity differs from the frozen verified registry provider.',
    );
  return Object.freeze({
    originType: 'smpp_registry',
    ...validateRuntimeBindingScope(provider.scope),
    episodeId: taskId,
    a2aTaskId: taskId,
    providerSourceId: provider.smppSourceId,
    externalProviderId: provider.registry.externalProviderId,
    externalProviderInstanceId: local.providerInstanceId,
    externalServerId: provider.externalServerId,
    registryRevision: provider.registry.revision,
    registryChecksum: provider.registry.checksum,
  });
}

/** Validated semantic fields only: no arrival time, derived expiry, trace or unknown _meta. */
export function remoteTaskSemanticContent(
  task: RemoteTaskCreated | RemoteTaskSnapshot,
  baseOnly = false,
): unknown {
  return {
    remoteTaskId: task.remoteTaskId,
    providerIdentity: task.providerIdentity ?? null,
    status: task.status,
    statusMessage: task.statusMessage ?? null,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: task.ttlMs,
    pollIntervalMs: task.pollIntervalMs ?? null,
    runtimeRevision: task.runtimeRevision,
    providerRevision: task.providerRevision ?? null,
    providerObservation:
      task.providerObservation === undefined
        ? null
        : {
            substate: task.providerObservation.substate ?? null,
            progress: task.providerObservation.progress ?? null,
            eventId: task.providerObservation.eventId ?? null,
            observedAt: task.providerObservation.observedAt ?? null,
          },
    ...(baseOnly
      ? {}
      : {
          ...('inputRequests' in task ? { inputRequests: task.inputRequests } : {}),
          ...('result' in task
            ? {
                result: {
                  content: task.result.content,
                  structuredContent: task.result.structuredContent ?? null,
                  isError: task.result.isError,
                },
              }
            : {}),
          ...('error' in task ? { error: task.error } : {}),
        }),
  };
}

export type RemoteTaskObservationDisposition =
  | 'accept'
  | 'duplicate'
  | 'stale_provider_revision'
  | 'identity_conflict'
  | 'revision_content_conflict'
  | 'input_key_conflict'
  | 'terminal_conflict';

export function classifyRemoteTaskObservation(
  binding: RemoteTaskBinding,
  snapshot: RemoteTaskSnapshot,
): RemoteTaskObservationDisposition {
  if (
    snapshot.remoteTaskId !== binding.remoteTaskId ||
    canonicalTaskJson(snapshot.providerIdentity ?? null) !==
      canonicalTaskJson(binding.providerIdentity ?? null)
  )
    return 'identity_conflict';
  if (snapshot.runtimeRevision === undefined || binding.runtimeRevision === undefined)
    return 'revision_content_conflict';
  const order = compareRuntimeRevisions(snapshot.runtimeRevision, binding.runtimeRevision);
  if (order < 0) return 'stale_provider_revision';
  const previous = binding.lastTaskSnapshot;
  if (order === 0 && previous !== undefined) {
    const baseOnly = binding.lastTaskProjection === 'create';
    if (
      canonicalTaskJson(remoteTaskSemanticContent(snapshot, baseOnly)) !==
      canonicalTaskJson(remoteTaskSemanticContent(previous, baseOnly))
    )
      return 'revision_content_conflict';
    return baseOnly ? 'accept' : 'duplicate';
  }
  if (
    binding.terminalAt !== undefined ||
    ['completed', 'failed', 'cancelled'].includes(binding.protocolStatus)
  )
    return 'terminal_conflict';
  return 'accept';
}

/** Task values are bounded at protocol/persistence boundaries, not by Evidence export policy. */
function canonicalTaskJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalTaskJson).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalTaskJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
