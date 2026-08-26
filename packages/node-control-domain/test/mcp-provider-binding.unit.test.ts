import { describe, expect, it } from 'vitest';

import {
  MCP_UNAUTHENTICATED_CREDENTIAL_REF,
  createMcpProviderBindingRecord,
  mcpBindingSelectable,
  sameMcpProviderBindingContract,
  type McpProviderBinding,
  type McpProviderBindingRecord,
} from '../src/index.js';

describe('P05 MCP Provider Binding domain', () => {
  it('separates semantic Provider identity from health, governance and Registry observations', () => {
    const record = validRecord();
    const health = createMcpProviderBindingRecord({
      ...record,
      binding: {
        ...record.binding,
        status: 'suspended',
        availabilityStatus: 'unavailable',
        registryRevision: 4,
        registryChecksum: 'c'.repeat(64),
        catalogRevision: 'observation-only-counter',
      },
      availabilityValidUntil: record.catalogObservedAt,
    });
    expect(sameMcpProviderBindingContract(record, health)).toBe(true);
    for (const binding of [
      { ...record.binding, endpointRef: 'https://provider.example.test/changed' },
      { ...record.binding, externalProviderId: 'provider-b' },
      { ...record.binding, catalogChecksum: 'c'.repeat(64) },
    ]) {
      expect(
        sameMcpProviderBindingContract(
          record,
          createMcpProviderBindingRecord({ ...record, binding }),
        ),
      ).toBe(false);
    }
  });

  it('preserves exact SMPP lineage and selects only active fresh catalogs', () => {
    const record = validRecord();
    expect(record.binding).toMatchObject({
      originType: 'smpp_registry',
      smppSourceId: 'source-a',
      externalProviderId: 'provider-a',
      externalServerId: 'server-a',
      registryRevision: 3,
      registryChecksum: 'a'.repeat(64),
      status: 'active',
      availabilityStatus: 'available',
    });
    expect(mcpBindingSelectable(record, '2026-08-02T00:04:59.999Z')).toBe(true);
    expect(mcpBindingSelectable(record, '2026-08-02T00:05:00.000Z')).toBe(false);
    expect(
      mcpBindingSelectable(
        createMcpProviderBindingRecord({
          ...record,
          binding: { ...record.binding, status: 'suspended', revision: 2 },
        }),
        '2026-08-02T00:01:00.000Z',
      ),
    ).toBe(false);
  });

  it('rejects direct bindings with Registry lineage, unsafe endpoints and plaintext secrets', () => {
    const record = validRecord();
    expect(() =>
      createMcpProviderBindingRecord({
        ...record,
        binding: { ...record.binding, originType: 'direct' },
      }),
    ).toThrow(/cannot carry SMPP origin lineage/u);
    expect(() =>
      createMcpProviderBindingRecord({
        ...record,
        binding: { ...record.binding, endpointRef: 'https://user:password@example.test/mcp' },
      }),
    ).toThrow(/cannot contain credentials/u);
    expect(() =>
      createMcpProviderBindingRecord({ ...record, credentialRef: 'plain-token' }),
    ).toThrow(/opaque SecretRef|unauthenticated/u);
    expect(
      createMcpProviderBindingRecord({
        ...record,
        credentialRef: MCP_UNAUTHENTICATED_CREDENTIAL_REF,
      }),
    ).toMatchObject({ credentialRef: MCP_UNAUTHENTICATED_CREDENTIAL_REF });
    expect(() =>
      createMcpProviderBindingRecord({
        ...record,
        credentialRef: 'unauthenticated://fallback',
      }),
    ).toThrow(/unauthenticated:\/\/none/u);
  });

  it('rejects partial lineage, malformed hashes and non-forward availability windows', () => {
    const record = validRecord();
    const partialBinding: McpProviderBinding = {
      bindingId: record.binding.bindingId,
      localServerId: record.binding.localServerId,
      originType: record.binding.originType,
      smppSourceId: 'source-a',
      externalProviderId: 'provider-a',
      registryRevision: 3,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: record.binding.catalogRevision,
      catalogChecksum: record.binding.catalogChecksum,
      endpointRef: record.binding.endpointRef,
      status: record.binding.status,
      availabilityStatus: record.binding.availabilityStatus,
      revision: record.binding.revision,
    };
    expect(() => createMcpProviderBindingRecord({ ...record, binding: partialBinding })).toThrow(
      /complete Source, Provider, Server and Snapshot lineage/u,
    );
    expect(() =>
      createMcpProviderBindingRecord({
        ...record,
        binding: { ...record.binding, catalogChecksum: '0'.repeat(63) },
      }),
    ).toThrow(/lowercase SHA-256/u);
    expect(() =>
      createMcpProviderBindingRecord({
        ...record,
        availabilityValidUntil: record.catalogObservedAt,
      }),
    ).toThrow(/later than catalogObservedAt/u);
  });
});

function validRecord(): McpProviderBindingRecord {
  return createMcpProviderBindingRecord({
    binding: {
      bindingId: 'binding-a',
      localServerId: 'local-server-a',
      originType: 'smpp_registry',
      smppSourceId: 'source-a',
      externalProviderId: 'provider-a',
      externalServerId: 'server-a',
      registryRevision: 3,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: 'provider-1.0.0:1',
      catalogChecksum: 'b'.repeat(64),
      endpointRef: 'https://provider.example.test/mcp',
      status: 'active',
      availabilityStatus: 'available',
      revision: 1,
    },
    credentialRef: 'secret://env/MCP_TOKEN',
    availabilityValidUntil: '2026-08-02T00:05:00.000Z',
    catalogObservedAt: '2026-08-02T00:00:00.000Z',
    operationCount: 1,
  });
}
