import { describe, expect, it } from 'vitest';

import {
  computeSmppSnapshotChecksum,
  createSmppRegistrySnapshot,
  createSmppRegistrySource,
  effectiveSmppRevalidatedValidUntil,
  effectiveSmppSnapshotValidUntil,
  rehydrateSmppRegistrySource,
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

  it('requires a complete active pointer and bounds 304 revalidation by external expiry', () => {
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
    expect(
      effectiveSmppRevalidatedValidUntil(
        source,
        '2026-08-02T00:00:30.000Z',
        '2026-08-02T00:00:00.000Z',
      ),
    ).toBe('2026-08-02T00:00:30.000Z');
    expect(() =>
      rehydrateSmppRegistrySource({
        ...source,
        status: 'active',
        activeSnapshotRevision: 1,
        activeSnapshotChecksum: 'a'.repeat(64),
      }),
    ).toThrow(/validUntil/u);
    expect(
      rehydrateSmppRegistrySource({
        ...source,
        status: 'active',
        activeSnapshotRevision: 1,
        activeSnapshotChecksum: 'a'.repeat(64),
        activeSnapshotValidUntil: '2026-08-02T00:00:30.000Z',
      }),
    ).toMatchObject({ activeSnapshotValidUntil: '2026-08-02T00:00:30.000Z' });
  });

  it('rejects duplicate composite candidates and source mismatch', () => {
    const first = candidate('source-a', 'provider-1');
    const duplicate = { ...first };
    expect(() => validSnapshot('source-a', 1, [first, duplicate])).toThrow(/unique/u);
    expect(() => validSnapshot('source-a', 1, [candidate('source-b', 'provider-1')])).toThrow(
      /must match/u,
    );
  });

  it('freezes the consumer-projection checksum bytes for strict provider inputs', () => {
    const input = {
      smppSourceId: 'home-lab-smpp',
      revision: 4,
      generatedAt: '2026-08-04T00:00:00.000Z',
      expiresAt: '2026-09-03T00:00:00.000Z',
      candidates: [
        projectionCandidate('ha-light-lab', 'ha-light-server', 'http://127.0.0.1:18082/mcp', '7', {
          environment: 'home-lab',
          protocolMode: 'frozen_v1',
        }),
        projectionCandidate(
          'ha-climate-lab',
          'ha-climate-server',
          'http://127.0.0.1:18081/mcp',
          '3',
          { environment: 'home-lab', protocolMode: 'frozen_v1' },
        ),
      ],
    };
    expect(computeSmppSnapshotChecksum(input)).toBe(
      'f62e57954c291375f63d5b418fa4bd6053dee82366a85c50b08a6e616dd7bbed',
    );
    expect(
      computeSmppSnapshotChecksum({
        ...input,
        candidates: [
          projectionCandidate(
            'ha-climate-lab',
            'ha-climate-server',
            'http://127.0.0.1:18081/mcp',
            '3',
            { protocolMode: 'frozen_v1', environment: 'home-lab' },
          ),
          projectionCandidate(
            'ha-light-lab',
            'ha-light-server',
            'http://127.0.0.1:18082/mcp',
            '7',
            { protocolMode: 'frozen_v1', environment: 'home-lab' },
          ),
        ],
      }),
    ).toBe('f62e57954c291375f63d5b418fa4bd6053dee82366a85c50b08a6e616dd7bbed');
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

function projectionCandidate(
  externalProviderId: string,
  externalServerId: string,
  serverEndpoint: string,
  catalogRevision: string,
  labels: Readonly<Record<string, string>>,
): SmppProviderCandidate {
  return {
    smppSourceId: 'home-lab-smpp',
    externalProviderId,
    externalServerId,
    compositeIdentity: smppCandidateIdentity('home-lab-smpp', externalProviderId, externalServerId),
    serverEndpoint,
    catalogRevision,
    labels,
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
