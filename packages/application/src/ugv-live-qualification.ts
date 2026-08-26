import type { McpInvocation, RemoteTaskAuthoritySnapshot } from '../../domain/src/index.js';

/** Runtime-local observation provenance; never a remote Task/Episode binding. */
export interface UgvLiveQualificationRecord {
  readonly requestId: string;
  readonly invocationId: string;
  readonly executionContext: Readonly<{ mode: 'live' }>;
  readonly status: 'dispatching' | 'completed' | 'uncertain';
  readonly createdAt: string;
  readonly authoritySnapshot?: RemoteTaskAuthoritySnapshot;
  readonly dispatchHash?: string;
  readonly resultHash?: `sha256:${string}`;
}

export interface UgvLiveQualificationStore {
  reserve(
    input: Pick<UgvLiveQualificationRecord, 'requestId' | 'invocationId' | 'createdAt'>,
  ): Promise<boolean>;
  freezeDispatch(
    input: Readonly<{
      requestId: string;
      invocationId: string;
      dispatchHash: string;
      authoritySnapshot: RemoteTaskAuthoritySnapshot;
    }>,
  ): Promise<void>;
  complete(requestId: string, invocationId: string, resultHash: `sha256:${string}`): Promise<void>;
  markUncertain(requestId: string, invocationId: string): Promise<void>;
  load(requestId: string): Promise<
    | Readonly<{
        record: UgvLiveQualificationRecord;
        invocation?: McpInvocation;
      }>
    | undefined
  >;
}

/** Stable verified binding identity; observation/availability clocks remain separate facts. */
export function ugvQualificationAuthorityIdentity(snapshot: RemoteTaskAuthoritySnapshot) {
  const { capturedAt, ...authority } = snapshot;
  void capturedAt;
  if (authority.providerBinding === undefined)
    throw new Error('UGV_QUALIFICATION_PROVIDER_REQUIRED');
  const { observedAt, availabilityValidUntil, ...provider } = authority.providerBinding;
  void observedAt;
  void availabilityValidUntil;
  return { ...authority, providerBinding: provider };
}
