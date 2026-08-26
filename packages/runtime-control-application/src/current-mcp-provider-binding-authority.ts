export interface CurrentMcpProviderBindingAuthoritySnapshot {
  readonly observedAt: string;
  readonly binding: Readonly<{
    bindingId: string;
    revision: number;
    localServerId: string;
    originType: 'direct' | 'smpp_registry';
    providerId: string;
    externalProviderId?: string;
    externalServerId?: string;
    registryRevision?: number;
    registryChecksum?: string;
    catalogRevision: string;
    catalogChecksum: string;
    endpointRef: string;
    /** Health observation status; registration itself has no expiry. */
    availabilityStatus: 'unknown' | 'available' | 'degraded' | 'unavailable';
    availabilityValidUntil: string;
    catalogObservedAt: string;
    operationCount: number;
  }>;
  readonly sourceCandidateLineage?: Readonly<{
    smppSourceId: string;
    externalProviderId: string;
    externalServerId: string;
    registryRevision: number;
    registryChecksum: string;
    nativeRevision: number;
    nativeChecksum: string;
    projectionContract: 'sdar-registry-v1';
    candidateEndpoint: string;
  }>;
}

/** Authenticated, fail-closed reader for Node Control's current Binding authority. */
export interface CurrentMcpProviderBindingAuthorityReader {
  loadCurrentMcpProviderBinding(
    input: Readonly<{ bindingId?: string; localServerId: string }>,
  ): Promise<CurrentMcpProviderBindingAuthoritySnapshot>;
}
