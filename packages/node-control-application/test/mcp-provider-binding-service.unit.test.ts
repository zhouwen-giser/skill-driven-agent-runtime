import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  createMcpProviderBindingRecord,
  transitionManagementOperation,
  type ManagementOperation,
  type McpProviderBindingRecord,
  type SmppProviderCandidateDirectoryEntry,
} from '../../node-control-domain/src/index.js';
import {
  NodeControlMcpProviderBindingService,
  type ConfigurationMutationContext,
  type CurrentMcpProviderBindingAuthority,
  type McpCatalogDiscoveryResult,
  type NodeControlMcpProviderBindingRepository,
} from '../src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';

const NOW = '2026-08-10T12:00:00.000Z';
const OLD_CHECKSUM = 'a'.repeat(64);
const NEW_CHECKSUM = 'b'.repeat(64);
const CATALOG_CHECKSUM = 'c'.repeat(64);

describe('NodeControlMcpProviderBindingService CAS rebind', () => {
  it('discovers an exact current Candidate before atomically selecting a new revision', async () => {
    const events: string[] = [];
    const repository = new MemoryBindingRepository(record(), candidate(), events);
    const service = createService(repository, events);

    const operation = await service.rebind(
      'binding-home-lab',
      rebindRequest(),
      'rebind-idempotency-key',
      'Select the new current Source Candidate.',
    );

    expect(operation).toMatchObject({
      status: 'succeeded',
      operationType: 'mcp_provider_binding.rebind',
      target: { id: 'binding-home-lab', revision: 2 },
      result: {
        revision: 2,
        status: 'active',
        catalogRevision: '2.0.0:2',
        resultCode: 'rebound',
      },
    });
    expect(events).toEqual(['candidate', 'discover', 'complete']);
    expect(repository.completed?.binding).toMatchObject({
      bindingId: 'binding-home-lab',
      revision: 2,
      externalServerId: 'server-v2',
      registryRevision: 2,
      registryChecksum: NEW_CHECKSUM,
      endpointRef: 'http://127.0.0.1:18081/mcp-v2',
      status: 'active',
      availabilityStatus: 'available',
    });
    expect(repository.completed?.credentialRef).toBe('secret://env/MCP_HOME_LAB_TOKEN');
  });

  it('exposes persisted freshness without exposing the credential reference', async () => {
    const repository = new MemoryBindingRepository(record(), candidate(), []);
    const service = createService(repository, []);

    const detail = await service.getBinding('binding-home-lab');

    expect(detail).toMatchObject({
      bindingId: 'binding-home-lab',
      availabilityValidUntil: '2026-08-10T13:00:00.000Z',
      catalogObservedAt: NOW,
      operationCount: 1,
    });
    expect(detail).not.toHaveProperty('credentialRef');
    const schema = JSON.parse(
      await readFile('protocol/node-control/v1/schemas/mcp-provider-binding.schema.json', 'utf8'),
    ) as unknown;
    expect(new AjvJsonSchemaValidator().validate(schema, detail)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('returns only the current secret-free Binding authority for an exact local Server', async () => {
    const repository = new MemoryBindingRepository(record(), candidate(), []);
    const service = createService(repository, []);

    const authority = await service.getCurrentAuthority({
      bindingId: 'binding-home-lab',
      localServerId: 'runtime-home-lab',
    });

    expect(authority).toMatchObject({
      observedAt: NOW,
      binding: {
        bindingId: 'binding-home-lab',
        localServerId: 'runtime-home-lab',
        providerId: 'provider-home-lab',
      },
      sourceCandidateLineage: { externalProviderId: 'provider-home-lab' },
    });
    expect(authority).not.toHaveProperty('credentialRef');
    expect(JSON.stringify(authority)).not.toContain('MCP_HOME_LAB_TOKEN');
  });

  it('rejects stale expectedRevision before Candidate lookup or live discovery', async () => {
    const events: string[] = [];
    const repository = new MemoryBindingRepository(record(), candidate(), events);
    const service = createService(repository, events);

    await expect(
      service.rebind(
        'binding-home-lab',
        { ...rebindRequest(), expectedRevision: 9 },
        'stale-revision-key',
        'Reject stale rebind.',
      ),
    ).rejects.toMatchObject({ code: 'MCP_PROVIDER_BINDING_CONFLICT' });
    expect(events).toEqual([]);
    expect(repository.completed).toBeUndefined();
  });

  it('rejects absent or endpoint-mismatched Candidates without changing Authority', async () => {
    const events: string[] = [];
    const repository = new MemoryBindingRepository(
      record(),
      { ...candidate(), serverEndpoint: 'http://127.0.0.1:18081/unexpected' },
      events,
    );
    const service = createService(repository, events);

    await expect(
      service.rebind(
        'binding-home-lab',
        rebindRequest(),
        'endpoint-drift-key',
        'Reject stale endpoint.',
      ),
    ).rejects.toMatchObject({ code: 'MCP_PROVIDER_BINDING_STALE' });
    expect(events).toEqual(['candidate']);
    expect(repository.completed).toBeUndefined();
  });

  it('retains the selected revision when live server/discover or tools/list fails', async () => {
    const events: string[] = [];
    const repository = new MemoryBindingRepository(record(), candidate(), events);
    const service = new NodeControlMcpProviderBindingService({
      repository,
      catalog: {
        discover: () => {
          events.push('discover');
          return Promise.reject(new Error('provider unavailable'));
        },
      },
      clock: { now: () => NOW },
      ids: { next: () => 'operation-or-snapshot' },
    });

    await expect(
      service.rebind(
        'binding-home-lab',
        rebindRequest(),
        'discovery-failure-key',
        'Keep old Authority on discovery failure.',
      ),
    ).rejects.toMatchObject({ code: 'MCP_PROVIDER_BINDING_STALE' });
    expect(events).toEqual(['candidate', 'discover']);
    expect(repository.completed).toBeUndefined();
  });
});

class MemoryBindingRepository implements NodeControlMcpProviderBindingRepository {
  completed: McpProviderBindingRecord | undefined;

  constructor(
    readonly current: McpProviderBindingRecord,
    readonly currentCandidate: SmppProviderCandidateDirectoryEntry | undefined,
    readonly events: string[],
  ) {}

  find(bindingId: string, revision?: number): Promise<McpProviderBindingRecord | undefined> {
    const match =
      bindingId === this.current.binding.bindingId &&
      (revision === undefined || revision === this.current.binding.revision);
    return Promise.resolve(match ? this.current : undefined);
  }

  findLatestActive(): Promise<McpProviderBindingRecord | undefined> {
    return Promise.resolve(this.current);
  }

  list(): Promise<readonly []> {
    return Promise.resolve([]);
  }

  findSelectable(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  findCurrentAuthority(
    input: Readonly<{ bindingId?: string; localServerId: string; observedAt: string }>,
  ): Promise<CurrentMcpProviderBindingAuthority | undefined> {
    if (
      input.bindingId !== this.current.binding.bindingId ||
      input.localServerId !== this.current.binding.localServerId
    )
      return Promise.resolve(undefined);
    const binding = this.current.binding;
    return Promise.resolve({
      observedAt: input.observedAt,
      binding: {
        bindingId: binding.bindingId,
        revision: binding.revision,
        localServerId: binding.localServerId,
        originType: binding.originType,
        providerId: binding.externalProviderId ?? binding.localServerId,
        ...(binding.externalProviderId === undefined
          ? {}
          : { externalProviderId: binding.externalProviderId }),
        ...(binding.externalServerId === undefined
          ? {}
          : { externalServerId: binding.externalServerId }),
        ...(binding.registryRevision === undefined
          ? {}
          : { registryRevision: binding.registryRevision }),
        ...(binding.registryChecksum === undefined
          ? {}
          : { registryChecksum: binding.registryChecksum }),
        catalogRevision: binding.catalogRevision,
        catalogChecksum: binding.catalogChecksum,
        endpointRef: binding.endpointRef,
        availabilityValidUntil: this.current.availabilityValidUntil,
        catalogObservedAt: this.current.catalogObservedAt,
        operationCount: this.current.operationCount,
      },
      ...(binding.originType === 'direct'
        ? {}
        : {
            sourceCandidateLineage: {
              smppSourceId: binding.smppSourceId ?? '',
              externalProviderId: binding.externalProviderId ?? '',
              externalServerId: binding.externalServerId ?? '',
              registryRevision: binding.registryRevision ?? 0,
              registryChecksum: binding.registryChecksum ?? '',
              nativeRevision: binding.registryRevision ?? 0,
              nativeChecksum: binding.registryChecksum ?? '',
              projectionContract: 'sdar-registry-v1',
              candidateEndpoint: binding.endpointRef,
            },
          }),
    });
  }

  findSmppCandidate(): Promise<SmppProviderCandidateDirectoryEntry | undefined> {
    this.events.push('candidate');
    return Promise.resolve(this.currentCandidate);
  }

  findCommandReplay(): Promise<ManagementOperation | undefined> {
    return Promise.resolve(undefined);
  }

  completeImport(): Promise<ManagementOperation> {
    throw new Error('not used');
  }

  completeRevision(
    _prior: McpProviderBindingRecord,
    record: McpProviderBindingRecord,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    resultCode: string,
  ): Promise<ManagementOperation> {
    this.events.push('complete');
    this.completed = record;
    return Promise.resolve(
      transitionManagementOperation(
        transitionManagementOperation(operation, 'running', context.occurredAt),
        'succeeded',
        context.occurredAt,
        {
          result: {
            revision: record.binding.revision,
            status: record.binding.status,
            catalogRevision: record.binding.catalogRevision,
            resultCode,
          },
        },
      ),
    );
  }

  recordImportFailure(): Promise<ManagementOperation> {
    throw new Error('not used');
  }
}

function createService(repository: NodeControlMcpProviderBindingRepository, events: string[]) {
  return new NodeControlMcpProviderBindingService({
    repository,
    catalog: {
      discover: () => {
        events.push('discover');
        return Promise.resolve(discovery());
      },
    },
    clock: { now: () => NOW },
    ids: { next: () => 'operation-or-snapshot' },
  });
}

function record(): McpProviderBindingRecord {
  return createMcpProviderBindingRecord({
    binding: {
      bindingId: 'binding-home-lab',
      localServerId: 'runtime-home-lab',
      originType: 'smpp_registry',
      smppSourceId: 'home-lab-smpp',
      externalProviderId: 'provider-home-lab',
      externalServerId: 'server-v1',
      registryRevision: 1,
      registryChecksum: OLD_CHECKSUM,
      catalogRevision: '1.0.0:1',
      catalogChecksum: OLD_CHECKSUM,
      endpointRef: 'http://127.0.0.1:18081/mcp',
      status: 'active',
      availabilityStatus: 'available',
      revision: 1,
    },
    credentialRef: 'secret://env/MCP_HOME_LAB_TOKEN',
    availabilityValidUntil: '2026-08-10T13:00:00.000Z',
    catalogObservedAt: NOW,
    operationCount: 1,
  });
}

function candidate(): SmppProviderCandidateDirectoryEntry {
  return Object.freeze({
    smppSourceId: 'home-lab-smpp',
    externalProviderId: 'provider-home-lab',
    externalServerId: 'server-v2',
    compositeIdentity: 'home-lab-smpp::provider-home-lab::server-v2',
    serverEndpoint: 'http://127.0.0.1:18081/mcp-v2',
    catalogRevision: '2',
    labels: Object.freeze({ environment: 'home-lab', protocolMode: 'frozen_v1' }),
    registryRevision: 2,
    registryChecksum: NEW_CHECKSUM,
    registryEtag: `"${NEW_CHECKSUM}"`,
    registryValidUntil: '2026-08-10T13:00:00.000Z',
  });
}

function rebindRequest() {
  return Object.freeze({
    expectedRevision: 1,
    smppSourceId: 'home-lab-smpp',
    externalProviderId: 'provider-home-lab',
    externalServerId: 'server-v2',
    registryRevision: 2,
    registryChecksum: NEW_CHECKSUM,
    endpointRef: 'http://127.0.0.1:18081/mcp-v2',
  });
}

function discovery(): McpCatalogDiscoveryResult {
  return Object.freeze({
    catalogRevision: '2.0.0:2',
    catalogChecksum: CATALOG_CHECKSUM,
    availabilityStatus: 'available',
    availabilityValidUntil: '2026-08-10T13:00:00.000Z',
    observedAt: NOW,
    operationCount: 1,
  });
}
