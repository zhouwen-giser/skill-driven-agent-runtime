import type { ProviderEvidenceItem } from './mcp-frozen-protocol.js';

export interface InternalToolResult {
  readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly evidence?: readonly ProviderEvidenceItem[];
  readonly validatedEvidence?: Readonly<Record<string, boolean>>;
}

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export type RemoteTaskProviderSubstate =
  'accepted' | 'scheduled' | 'queued' | 'running' | 'paused' | 'resuming' | 'stopping';

/** Provider-local identity, never Runtime Episode/source/server authority. */
export interface RemoteTaskProviderIdentity {
  readonly profileVersion: '1.0';
  readonly providerId: string;
  readonly providerInstanceId: string;
}

export interface RemoteTaskProviderObservation {
  readonly revision: '1.0';
  readonly remoteRevision?: string;
  readonly substate?: RemoteTaskProviderSubstate;
  readonly eventId?: string;
  readonly observedAt?: string;
  readonly progress?: Readonly<{ percent: number }>;
}

export interface RemoteTaskCreated {
  readonly providerIdentity?: RemoteTaskProviderIdentity;
  readonly protocolMode?: 'frozen_v1';
  readonly remoteTaskId: string;
  readonly status: McpTaskStatus;
  readonly statusMessage?: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly ttlMs: number | null;
  readonly expiresAt?: string;
  readonly pollIntervalMs?: number;
  readonly protocolRevision: string;
  readonly tasksSchemaRevision: string;
  readonly providerObservation?: RemoteTaskProviderObservation;
  readonly runtimeRevision?: string;
  readonly providerRevision?: string;
}

type RemoteTaskSnapshotBase = RemoteTaskCreated;

export interface WorkingRemoteTaskSnapshot extends RemoteTaskSnapshotBase {
  readonly status: 'working';
}

export interface InputRequiredRemoteTaskSnapshot extends RemoteTaskSnapshotBase {
  readonly status: 'input_required';
  readonly inputRequests: Readonly<Record<string, unknown>>;
}

export interface CompletedRemoteTaskSnapshot extends RemoteTaskSnapshotBase {
  readonly status: 'completed';
  readonly result: InternalToolResult;
}

export interface FailedRemoteTaskSnapshot extends RemoteTaskSnapshotBase {
  readonly status: 'failed';
  readonly error: Readonly<{
    code: number;
    message: string;
    data?: unknown;
  }>;
}

export interface CancelledRemoteTaskSnapshot extends RemoteTaskSnapshotBase {
  readonly status: 'cancelled';
}

export type RemoteTaskSnapshot =
  | WorkingRemoteTaskSnapshot
  | InputRequiredRemoteTaskSnapshot
  | CompletedRemoteTaskSnapshot
  | FailedRemoteTaskSnapshot
  | CancelledRemoteTaskSnapshot;

export interface RemoteTaskOperationAck {
  readonly acknowledged: true;
  readonly protocolRevision: string;
}

export type McpInvocationOutcome =
  | Readonly<{ kind: 'immediate'; result: InternalToolResult }>
  | Readonly<{
      kind: 'remote_task';
      task: RemoteTaskCreated;
      reconciledTask?: RemoteTaskSnapshot;
    }>;
