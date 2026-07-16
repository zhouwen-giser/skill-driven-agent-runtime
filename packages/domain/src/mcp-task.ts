export type McpProtocolEra = 'legacy' | 'modern';

export interface McpProtocolCapabilities {
  readonly protocolEra: McpProtocolEra;
  readonly protocolRevision: string;
  readonly tasksExtension: boolean;
  readonly tasksSchemaRevision: string;
}

export interface InternalToolResult {
  readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
  readonly isError: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export type RemoteTaskProviderSubstate =
  'scheduled' | 'queued' | 'running' | 'paused' | 'resuming' | 'stopping';

export interface RemoteTaskProviderObservation {
  readonly revision: '1.0';
  readonly remoteRevision?: string;
  readonly substate?: RemoteTaskProviderSubstate;
  readonly eventId?: string;
  readonly observedAt?: string;
  readonly progress?: Readonly<{ percent: number }>;
}

export interface RemoteTaskCreated {
  readonly remoteTaskId: string;
  readonly status: McpTaskStatus;
  readonly statusMessage?: string;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly ttlMs: number | null;
  readonly pollIntervalMs?: number;
  readonly protocolRevision: string;
  readonly tasksSchemaRevision: string;
  readonly providerObservation?: RemoteTaskProviderObservation;
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
  | Readonly<{ kind: 'remote_task'; task: RemoteTaskCreated }>;
