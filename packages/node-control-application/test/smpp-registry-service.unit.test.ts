import { describe, expect, it } from 'vitest';

import {
  computeSmppSnapshotChecksum,
  transitionManagementOperation,
  type ManagementOperation,
  type SmppProviderCandidateDirectoryEntry,
  type SmppRegistrySnapshot,
  type SmppRegistrySource,
} from '../../node-control-domain/src/index.js';
import {
  NodeControlSmppRegistryService,
  type ConfigurationMutationContext,
  type NodeControlSmppRegistryRepository,
  type SmppRegistryClient,
  type SmppRegistryResponseLineage,
  type SmppRegistrySyncObservation,
  type SmppSnapshotHead,
} from '../src/index.js';

const NOW = '2026-08-11T00:00:00.000Z';
const SNAPSHOT_INPUT = Object.freeze({
  smppSourceId: 'source-a',
  revision: 1,
  generatedAt: '2026-08-10T23:59:00.000Z',
  expiresAt: '2026-08-11T01:00:00.000Z',
  candidates: Object.freeze([]),
});
const CHECKSUM = computeSmppSnapshotChecksum(SNAPSHOT_INPUT);
const NATIVE_CHECKSUM = 'b'.repeat(64);
const LINEAGE: SmppRegistryResponseLineage = Object.freeze({
  nativeRevision: 17,
  nativeChecksum: NATIVE_CHECKSUM,
  projectionContract: 'sdar-registry-v1',
});

describe('NodeControlSmppRegistryService revalidation', () => {
  it.each([
    {
      name: 'expired active pointer',
      active: head({ validUntil: '2026-08-10T23:59:59.000Z' }),
    },
    {
      name: 'legacy active pointer without stored lineage',
      active: legacyHead(),
    },
  ])('does not send If-None-Match for a $name and accepts a full 200', async ({ active }) => {
    const repository = new MemorySmppRegistryRepository(active);
    let conditionalEtag: string | undefined;
    const client: SmppRegistryClient = {
      fetchLatest: (_source, ifNoneMatch) => {
        conditionalEtag = ifNoneMatch;
        return Promise.resolve({
          status: 'snapshot',
          snapshot: snapshot(),
          nativeLineage: LINEAGE,
        });
      },
    };

    const result = await service(repository, client).synchronize(
      'source-a',
      `sync-${active.validUntil}`,
      'Refresh the Registry projection.',
    );

    expect(conditionalEtag).toBeUndefined();
    expect(result.status).toBe('succeeded');
    expect(repository.applied).toMatchObject({
      validUntil: '2026-08-11T00:05:00.000Z',
      nativeLineage: LINEAGE,
      snapshot: { revision: 1, checksum: CHECKSUM },
    });
  });

  it('sends a conditional request only for a fresh lineage-backed cache and accepts exact 304 lineage', async () => {
    const repository = new MemorySmppRegistryRepository(head());
    let conditionalEtag: string | undefined;
    const client: SmppRegistryClient = {
      fetchLatest: (_source, ifNoneMatch) => {
        conditionalEtag = ifNoneMatch;
        return Promise.resolve({
          status: 'not_modified',
          etag: `"${CHECKSUM}"`,
          nativeLineage: LINEAGE,
        });
      },
    };

    const result = await service(repository, client).synchronize(
      'source-a',
      'sync-exact-304',
      'Refresh the Registry projection.',
    );

    expect(conditionalEtag).toBe(`"${CHECKSUM}"`);
    expect(result.status).toBe('succeeded');
    expect(repository.notModified).toMatchObject({
      validUntil: '2026-08-11T00:05:00.000Z',
      nativeLineage: LINEAGE,
    });
  });

  it('rejects a 304 whose native lineage does not exactly match durable lineage', async () => {
    const repository = new MemorySmppRegistryRepository(head());
    const mismatched = Object.freeze({ ...LINEAGE, nativeChecksum: 'c'.repeat(64) });
    const client: SmppRegistryClient = {
      fetchLatest: () =>
        Promise.resolve({
          status: 'not_modified',
          etag: `"${CHECKSUM}"`,
          nativeLineage: mismatched,
        }),
    };

    const result = await service(repository, client).synchronize(
      'source-a',
      'sync-mismatch-304',
      'Refresh the Registry projection.',
    );

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SNAPSHOT_LINEAGE_MISMATCH',
    });
    expect(repository.failure).toMatchObject({
      errorCode: 'SMPP_SNAPSHOT_LINEAGE_MISMATCH',
      observation: { nativeLineage: mismatched },
    });
    expect(repository.notModified).toBeUndefined();
  });

  it('rejects 304 revalidation after external expiry and omits the conditional request', async () => {
    const repository = new MemorySmppRegistryRepository(
      head({
        externalExpiresAt: '2026-08-10T23:59:59.000Z',
        validUntil: '2026-08-11T00:01:00.000Z',
      }),
    );
    let conditionalEtag: string | undefined;
    const client: SmppRegistryClient = {
      fetchLatest: (_source, ifNoneMatch) => {
        conditionalEtag = ifNoneMatch;
        return Promise.resolve({
          status: 'not_modified',
          etag: `"${CHECKSUM}"`,
          nativeLineage: LINEAGE,
        });
      },
    };

    const result = await service(repository, client).synchronize(
      'source-a',
      'sync-expired-external-304',
      'Refresh the Registry projection.',
    );

    expect(conditionalEtag).toBeUndefined();
    expect(result).toMatchObject({ status: 'failed', errorCode: 'SMPP_SNAPSHOT_EXPIRED' });
  });

  it('rejects an unexpected 304 for a locally expired but externally fresh cache', async () => {
    const repository = new MemorySmppRegistryRepository(
      head({ validUntil: '2026-08-10T23:59:59.000Z' }),
    );
    let conditionalEtag: string | undefined;
    const client: SmppRegistryClient = {
      fetchLatest: (_source, ifNoneMatch) => {
        conditionalEtag = ifNoneMatch;
        return Promise.resolve({
          status: 'not_modified',
          etag: `"${CHECKSUM}"`,
          nativeLineage: LINEAGE,
        });
      },
    };

    const result = await service(repository, client).synchronize(
      'source-a',
      'sync-local-expired-304',
      'Refresh the Registry projection.',
    );

    expect(conditionalEtag).toBeUndefined();
    expect(result).toMatchObject({ status: 'failed', errorCode: 'SMPP_SNAPSHOT_EXPIRED' });
    expect(repository.notModified).toBeUndefined();
  });
});

class MemorySmppRegistryRepository implements NodeControlSmppRegistryRepository {
  readonly #source = source();
  readonly #active: SmppSnapshotHead;
  applied?: Readonly<{
    snapshot: SmppRegistrySnapshot;
    validUntil: string;
    nativeLineage: SmppRegistryResponseLineage;
  }>;
  notModified?: Readonly<{
    active: SmppSnapshotHead;
    validUntil: string;
    nativeLineage: SmppRegistryResponseLineage;
  }>;
  failure?: Readonly<{ errorCode: string; observation?: SmppRegistrySyncObservation }>;

  constructor(active: SmppSnapshotHead) {
    this.#active = active;
  }

  createSource(value: SmppRegistrySource): Promise<SmppRegistrySource> {
    return Promise.resolve(value);
  }

  findSource(): Promise<SmppRegistrySource> {
    return Promise.resolve(this.#source);
  }

  listSources(): Promise<readonly SmppRegistrySource[]> {
    return Promise.resolve([this.#source]);
  }

  listScheduledSources(): Promise<readonly SmppRegistrySource[]> {
    return Promise.resolve([this.#source]);
  }

  findActiveSnapshot(): Promise<SmppSnapshotHead> {
    return Promise.resolve(this.#active);
  }

  findSyncReplay(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  applySnapshot(
    _source: SmppRegistrySource,
    value: SmppRegistrySnapshot,
    validUntil: string,
    nativeLineage: SmppRegistryResponseLineage,
    operation: ManagementOperation,
  ): Promise<ManagementOperation> {
    this.applied = Object.freeze({ snapshot: value, validUntil, nativeLineage });
    return Promise.resolve(succeeded(operation));
  }

  recordNotModified(
    _source: SmppRegistrySource,
    active: SmppSnapshotHead,
    nativeLineage: SmppRegistryResponseLineage,
    validUntil: string,
    operation: ManagementOperation,
  ): Promise<ManagementOperation> {
    this.notModified = Object.freeze({ active, validUntil, nativeLineage });
    return Promise.resolve(succeeded(operation));
  }

  recordSyncFailure(
    _source: SmppRegistrySource,
    errorCode: string,
    operation: ManagementOperation,
    _context: ConfigurationMutationContext,
    observation?: SmppRegistrySyncObservation,
  ): Promise<ManagementOperation> {
    this.failure = Object.freeze({
      errorCode,
      ...(observation === undefined ? {} : { observation }),
    });
    return Promise.resolve(failed(operation, errorCode));
  }

  listCandidates(): Promise<readonly SmppProviderCandidateDirectoryEntry[]> {
    return Promise.resolve([]);
  }
}

function service(
  repository: NodeControlSmppRegistryRepository,
  client: SmppRegistryClient,
): NodeControlSmppRegistryService {
  return new NodeControlSmppRegistryService({
    repository,
    client,
    clock: { now: () => NOW },
    ids: { next: () => 'operation-smpp-sync' },
  });
}

function source(): SmppRegistrySource {
  return {
    smppSourceId: 'source-a',
    registryEndpoint: 'https://registry.example.test/latest',
    credentialRef: 'secret://env/SMPP_TOKEN',
    environment: 'integration',
    syncMode: 'watch',
    snapshotTtlSeconds: 300,
    lkgPolicy: 'allow_unexpired',
    status: 'active',
    activeSnapshotRevision: 1,
    activeSnapshotChecksum: CHECKSUM,
    activeSnapshotValidUntil: '2026-08-11T00:01:00.000Z',
    revision: 1,
  };
}

function head(overrides: Partial<SmppSnapshotHead> = {}): SmppSnapshotHead {
  return {
    revision: 1,
    checksum: CHECKSUM,
    etag: `"${CHECKSUM}"`,
    externalExpiresAt: '2026-08-11T01:00:00.000Z',
    validUntil: '2026-08-11T00:01:00.000Z',
    nativeLineage: LINEAGE,
    ...overrides,
  };
}

function legacyHead(): SmppSnapshotHead {
  return {
    revision: 1,
    checksum: CHECKSUM,
    etag: `"${CHECKSUM}"`,
    externalExpiresAt: '2026-08-11T01:00:00.000Z',
    validUntil: '2026-08-11T00:01:00.000Z',
  };
}

function snapshot(): SmppRegistrySnapshot {
  return { ...SNAPSHOT_INPUT, checksum: CHECKSUM, etag: `"${CHECKSUM}"` };
}

function succeeded(operation: ManagementOperation): ManagementOperation {
  return transitionManagementOperation(
    transitionManagementOperation(operation, 'running', NOW),
    'succeeded',
    NOW,
    { result: { resultCode: 'ok' } },
  );
}

function failed(operation: ManagementOperation, errorCode: string): ManagementOperation {
  return transitionManagementOperation(
    transitionManagementOperation(operation, 'running', NOW),
    'failed',
    NOW,
    { errorCode },
  );
}
