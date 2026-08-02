import { describe, expect, it } from 'vitest';

import {
  computeSmppSnapshotChecksum,
  createSmppRegistrySnapshot,
  createSmppRegistrySource,
  effectiveSmppSnapshotValidUntil,
  smppCandidateIdentity,
  type SmppProviderCandidate,
  type SmppRegistrySnapshot,
} from '../src/index.js';

describe('P04 SMPP Registry domain', () => {
  it('validates secret-reference-only sources and bounds the local LKG TTL', () => {
    const source = createSmppRegistrySource({
      smppSourceId: 'source-a',
      registryEndpoint: 'https://registry.example.test/latest',
      credentialRef: 'secret://env/SMPP_TOKEN',
      environment: 'integration',
      syncMode: 'watch',
      snapshotTtlSeconds: 60,
      lkgPolicy: 'allow_unexpired',
      status: 'draft',
      revision: 1,
    });
    const snapshot = validSnapshot('source-a', 1, [candidate('source-a', 'provider-1')]);
    expect(effectiveSmppSnapshotValidUntil(source, snapshot, '2026-08-02T00:00:00.000Z')).toBe(
      '2026-08-02T00:01:00.000Z',
    );
    expect(() =>
      createSmppRegistrySource({
        ...source,
        registryEndpoint: 'https://user:password@registry.example.test/latest',
      }),
    ).toThrow(/cannot contain credentials/u);
    expect(() => createSmppRegistrySource({ ...source, credentialRef: 'plaintext-token' })).toThrow(
      /SecretRef/u,
    );
  });

  it('uses source/provider/server composite identity and verifies canonical checksums', () => {
    const first = candidate('source-a', 'provider-shared');
    const second = candidate('source-b', 'provider-shared');
    expect(first.compositeIdentity).not.toBe(second.compositeIdentity);
    expect(createSmppRegistrySnapshot(validSnapshot('source-a', 1, [first]))).toMatchObject({
      smppSourceId: 'source-a',
      revision: 1,
      candidates: [first],
    });
    expect(() =>
      createSmppRegistrySnapshot({
        ...validSnapshot('source-a', 1, [first]),
        checksum: '0'.repeat(64),
      }),
    ).toThrow(/checksum/u);
  });

  it('rejects duplicate composite candidates and source mismatch', () => {
    const first = candidate('source-a', 'provider-1');
    const duplicate = { ...first };
    expect(() => validSnapshot('source-a', 1, [first, duplicate])).toThrow(/unique/u);
    expect(() => validSnapshot('source-a', 1, [candidate('source-b', 'provider-1')])).toThrow(
      /must match/u,
    );
  });
});

function candidate(sourceId: string, providerId: string): SmppProviderCandidate {
  const externalServerId = 'server-shared';
  return {
    smppSourceId: sourceId,
    externalProviderId: providerId,
    externalServerId,
    compositeIdentity: smppCandidateIdentity(sourceId, providerId, externalServerId),
    serverEndpoint: `https://${sourceId}.example.test/mcp`,
    catalogRevision: 'catalog-1',
    labels: { region: 'test' },
  };
}

function validSnapshot(
  sourceId: string,
  revision: number,
  candidates: readonly SmppProviderCandidate[],
): SmppRegistrySnapshot {
  const input = {
    smppSourceId: sourceId,
    revision,
    generatedAt: '2026-08-02T00:00:00.000Z',
    expiresAt: '2026-08-03T00:00:00.000Z',
    candidates,
  };
  return createSmppRegistrySnapshot({
    ...input,
    checksum: computeSmppSnapshotChecksum(input),
    etag: `"snapshot-${String(revision)}"`,
  });
}
