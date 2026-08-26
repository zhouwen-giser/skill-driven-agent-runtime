import { describe, expect, it } from 'vitest';

import {
  deriveFrozenMcpCatalogAuthority,
  withMcpToolAdminExecutionSemanticsOverride,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTool,
} from '../../domain/src/index.js';
import {
  FrozenMcpRegistryService,
  type CurrentMcpProviderBindingAuthorityPort,
  type FrozenMcpDiscoveryPort,
  type FrozenMcpRegistryRepository,
  type McpServerRecord,
} from '../src/index.js';

const timestamp = '2026-07-19T03:00:00.000Z';

describe('Frozen MCP registry', () => {
  it('registers an explicit Frozen identity and persists discovery atomically', async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);

    const result = await service.register({
      serverId: 'provider-1',
      name: 'Provider 1',
      endpoint: 'https://provider.test/mcp',
      credentialHeaders: { Authorization: 'Bearer secret' },
    });

    expect(result.server).toMatchObject({
      protocolMode: 'frozen_v1',
      toolRevision: 1,
      currentProtocolSnapshotId: 'snapshot-1',
    });
    expect(repository.record?.encryptedCredential).toBe('encrypted');
    expect(repository.snapshot?.baselineSha256).toBe('a'.repeat(64));
    expect(repository.tools).toHaveLength(1);
  });

  it('detects removed or changed Tools on Frozen refresh', async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);
    repository.record = {
      server: server({ protocolMode: 'frozen_v1', currentProtocolSnapshotId: 'snapshot-0' }),
      encryptedCredential: 'encrypted',
    };
    repository.tools = [tool('removed'), tool('move_to', { type: 'string' })];
    const result = await service.refresh('provider-1');
    expect(result.server.toolRevision).toBe(2);
    expect(result.dependencyWarnings).toEqual([
      { toolName: 'removed', reason: 'removed' },
      { toolName: 'move_to', reason: 'schema_changed' },
    ]);
  });

  it('keeps unchanged health discovery from rotating active remote Task anchors', async () => {
    const repository = new MemoryRepository();
    let now = timestamp;
    let discoveries = 0;
    const service = createService(repository, {
      now: () => now,
      onDiscover: () => {
        discoveries += 1;
      },
    });
    const registered = await service.register(registration());
    const remoteTaskAnchor = {
      serverUpdatedAt: registered.server.updatedAt,
      toolRevision: registered.server.toolRevision,
      snapshotId: registered.snapshot.snapshotId,
    };
    now = '2026-07-20T03:00:00.000Z';

    const refreshed = await service.refresh('provider-1');

    expect(discoveries).toBe(2);
    expect(repository.writes).toBe(1);
    expect(refreshed.server).toBe(registered.server);
    expect(refreshed.snapshot).toBe(registered.snapshot);
    expect(refreshed.dependencyWarnings).toEqual([]);
    expect({
      serverUpdatedAt: refreshed.server.updatedAt,
      toolRevision: refreshed.server.toolRevision,
      snapshotId: refreshed.snapshot.snapshotId,
    }).toEqual(remoteTaskAnchor);
  });

  it('does not discover or write for unchanged registered authority despite stale health', async () => {
    const repository = new MemoryRepository();
    let discoveries = 0;
    const service = createService(repository, {
      onDiscover: () => {
        discoveries += 1;
      },
    });
    const registered = await service.register(registration());

    const result = await service.reconcileProviderBinding(
      providerAuthority(1, registered.tools, {
        availabilityStatus: 'unavailable',
        availabilityValidUntil: '2020-01-01T00:00:00.000Z',
      }),
    );

    expect(discoveries).toBe(1);
    expect(repository.writes).toBe(1);
    expect(result.server).toBe(registered.server);
    expect(result.snapshot).toBe(registered.snapshot);
  });

  it('materializes the exact new semantic Binding revision and Catalog without executing a Tool', async () => {
    const repository = new MemoryRepository();
    let currentTools = [tool('move_to')];
    let discoveries = 0;
    const service = createService(repository, {
      tools: () => currentTools,
      onDiscover: () => {
        discoveries += 1;
      },
    });
    await service.register(registration());
    currentTools = [tool('move_to', { type: 'object', required: ['target'] }), tool('get_state')];
    const authority = providerAuthority(7, currentTools);

    const result = await service.reconcileProviderBinding(authority);

    expect(result.server.toolRevision).toBe(7);
    expect(result.snapshot.toolRevision).toBe(7);
    expect(result.server.currentProtocolSnapshotId).toBe(result.snapshot.snapshotId);
    expect(
      deriveFrozenMcpCatalogAuthority(result.snapshot, result.tools, result.server.toolRevision),
    ).toEqual({
      catalogRevision: authority.binding.catalogRevision,
      catalogChecksum: authority.binding.catalogChecksum,
      operationCount: 2,
    });
    expect(result.dependencyWarnings).toEqual([{ toolName: 'move_to', reason: 'schema_changed' }]);
    expect(repository.writes).toBe(2);
    expect(discoveries).toBe(2);
    await service.reconcileProviderBinding(authority);
    expect(repository.writes).toBe(2);
    expect(discoveries).toBe(2);
  });

  it.each(['checksum', 'revision', 'count', 'endpoint'] as const)(
    'rejects registered %s mismatch before writing Runtime authority',
    async (mismatch) => {
      const repository = new MemoryRepository();
      const service = createService(repository);
      const registered = await service.register(registration());
      const authority = providerAuthority(mismatch === 'count' ? 1 : 2, registered.tools, {
        ...(mismatch === 'checksum' ? { catalogChecksum: 'f'.repeat(64) } : {}),
        ...(mismatch === 'revision' ? { catalogRevision: 'unexpected:2' } : {}),
        ...(mismatch === 'count' ? { operationCount: 2 } : {}),
        ...(mismatch === 'endpoint' ? { endpointRef: 'https://other.example.test/mcp' } : {}),
      });

      await expect(service.reconcileProviderBinding(authority)).rejects.toMatchObject({
        code: 'MCP_PROVIDER_BINDING_CONFLICT',
      });
      expect(repository.writes).toBe(1);
      expect(repository.record?.server).toBe(registered.server);
      expect(repository.snapshot).toBe(registered.snapshot);
    },
  );

  it('retains approved admin overrides when reconciling a new registered semantic contract', async () => {
    const repository = new MemoryRepository();
    let discovered = tool('move_to');
    const service = createService(repository, { tools: () => [discovered] });
    await service.register(registration());
    const override = {
      effect: 'side_effecting',
      execution: 'task_required',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: 'forbidden',
      source: 'admin_override',
    } as const;
    repository.tools = [withMcpToolAdminExecutionSemanticsOverride(discovered, override)];
    discovered = tool('move_to', { type: 'object', required: ['target'] });
    const effective = withMcpToolAdminExecutionSemanticsOverride(discovered, override);

    const result = await service.reconcileProviderBinding(providerAuthority(2, [effective]));

    expect(result.tools).toEqual([effective]);
    expect(repository.tools[0]?.adminExecutionSemanticsOverride).toEqual(override);
    expect(repository.writes).toBe(2);
  });

  it('serializes refresh so overlapping health polls do not replace a semantic revision twice', async () => {
    const repository = new MemoryRepository();
    let signalEntered: (() => void) | undefined;
    let releaseDiscovery: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    let block = false;
    let discoveries = 0;
    const service = createService(repository, {
      tools: () => (block ? [tool('move_to', { type: 'string' })] : [tool('move_to')]),
      onDiscover: async () => {
        discoveries += 1;
        if (block) {
          signalEntered?.();
          await released;
        }
      },
    });
    await service.register(registration());
    block = true;
    const first = service.refresh('provider-1');
    await entered;
    const second = service.refresh('provider-1');
    expect(discoveries).toBe(2);
    releaseDiscovery?.();
    const results = await Promise.all([first, second]);

    expect(repository.writes).toBe(2);
    expect(results[0].server.toolRevision).toBe(2);
    expect(results[1].server).toBe(results[0].server);
    expect(results[1].snapshot).toBe(results[0].snapshot);
  });

  it('retains the governed admin execution-semantics override across Frozen refresh', async () => {
    const repository = new MemoryRepository();
    const service = createService(repository);
    repository.record = {
      server: server({ protocolMode: 'frozen_v1', currentProtocolSnapshotId: 'snapshot-0' }),
      encryptedCredential: 'encrypted',
    };
    repository.tools = [
      withMcpToolAdminExecutionSemanticsOverride(tool('move_to'), {
        effect: 'side_effecting',
        execution: 'task_required',
        cancellation: 'unsupported',
        idempotency: 'server_managed',
        replay: 'forbidden',
        source: 'admin_override',
      }),
    ];

    const result = await service.refresh('provider-1');

    expect(result.tools).toEqual([
      expect.objectContaining({
        toolName: 'move_to',
        adminExecutionSemanticsOverride: expect.objectContaining({
          effect: 'side_effecting',
          replay: 'forbidden',
          source: 'admin_override',
        }),
        executionSemantics: expect.objectContaining({
          effect: 'side_effecting',
          replay: 'forbidden',
          source: 'admin_override',
        }),
      }),
    ]);
    expect(repository.tools).toEqual(result.tools);
  });

  it('rejects execution-control headers as persisted credentials', async () => {
    await expect(
      createService(new MemoryRepository()).register({
        serverId: 'provider-1',
        name: 'Provider 1',
        endpoint: 'https://provider.test/mcp',
        credentialHeaders: { 'X-SDAR-Execution-Mode': 'live' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_RESERVED_HEADER_FORBIDDEN' });
  });

  it('replaces an unreadable stored credential without discovery or old-value decryption', async () => {
    const repository = new MemoryRepository();
    repository.record = {
      server: server({ protocolMode: 'frozen_v1' }),
      encryptedCredential: 'encrypted-with-previous-key',
    };
    let discoveries = 0;
    let decryptions = 0;
    const service = createService(repository, {
      onDiscover: () => {
        discoveries += 1;
      },
      onDecrypt: () => {
        decryptions += 1;
      },
    });

    await service.replaceCredentials('provider-1', { Authorization: 'Bearer replacement' });

    expect(repository.record).toMatchObject({
      encryptedCredential: 'encrypted',
      server: { updatedAt: timestamp, toolRevision: 1 },
    });
    expect(discoveries).toBe(0);
    expect(decryptions).toBe(0);
  });

  it('rejects reserved replacement headers and reports a missing Server deterministically', async () => {
    const service = createService(new MemoryRepository());

    await expect(
      service.replaceCredentials('provider-1', { 'x-sdar-simulation-id': 'operator-value' }),
    ).rejects.toMatchObject({ code: 'MCP_RESERVED_HEADER_FORBIDDEN' });
    await expect(
      service.replaceCredentials('provider-1', { Authorization: 'Bearer replacement' }),
    ).rejects.toMatchObject({ code: 'MCP_SERVER_NOT_FOUND' });
  });
});

class MemoryRepository implements FrozenMcpRegistryRepository {
  record: McpServerRecord | undefined;
  tools: readonly McpTool[] = [];
  snapshot: McpProtocolDiscoverySnapshot | undefined;
  writes = 0;
  changes = [] as readonly Readonly<{ toolName: string; reason: 'removed' | 'schema_changed' }>[];

  findServer() {
    return Promise.resolve(this.record);
  }
  listTools() {
    return Promise.resolve(this.tools);
  }
  findCurrentProtocolSnapshot() {
    return Promise.resolve(this.snapshot);
  }
  replaceEncryptedCredential(_serverId: string, encryptedCredential: string, updatedAt: string) {
    if (this.record === undefined) return Promise.resolve(false);
    this.record = {
      server: { ...this.record.server, updatedAt },
      encryptedCredential,
    };
    return Promise.resolve(true);
  }
  saveFrozenServerAndReplaceTools(
    record: McpServerRecord,
    tools: readonly McpTool[],
    snapshot: McpProtocolDiscoverySnapshot,
    changes = [],
  ) {
    this.writes += 1;
    this.record = record;
    this.tools = tools;
    this.snapshot = snapshot;
    this.changes = changes;
    return Promise.resolve();
  }
}

function registration() {
  return {
    serverId: 'provider-1',
    name: 'Provider 1',
    endpoint: 'https://provider.test/mcp',
    credentialHeaders: { Authorization: 'Bearer secret' },
  };
}

type ProviderAuthority = Awaited<
  ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
>;

function providerAuthority(
  revision: number,
  tools: readonly McpTool[],
  overrides: Partial<ProviderAuthority['binding']> = {},
): ProviderAuthority {
  return {
    observedAt: timestamp,
    binding: {
      bindingId: 'binding-provider-1',
      revision,
      localServerId: 'provider-1',
      originType: 'direct',
      providerId: 'provider-1',
      endpointRef: 'https://provider.test/mcp',
      ...deriveFrozenMcpCatalogAuthority(snapshot(revision, 'authority'), tools, revision),
      availabilityStatus: 'available',
      availabilityValidUntil: '2026-07-19T04:00:00.000Z',
      ...overrides,
    },
  };
}

function createService(
  repository: MemoryRepository,
  hooks: Readonly<{
    onDiscover?: () => void | Promise<void>;
    onDecrypt?: () => void;
    tools?: () => readonly McpTool[];
    now?: () => string;
  }> = {},
) {
  let snapshotSequence = 0;
  const discovery: FrozenMcpDiscoveryPort = {
    discover: async (input) => {
      await hooks.onDiscover?.();
      return {
        snapshot: {
          ...snapshot(input.server.toolRevision, input.snapshotId),
          discoveredAt: input.discoveredAt,
        },
        tools: hooks.tools?.() ?? [tool('move_to')],
      };
    },
  };
  return new FrozenMcpRegistryService({
    repository,
    discovery,
    cipher: {
      encrypt: () => 'encrypted',
      decrypt: () => {
        hooks.onDecrypt?.();
        return { Authorization: 'Bearer secret' };
      },
    },
    clock: { now: hooks.now ?? (() => timestamp) },
    nextSnapshotId: () => `snapshot-${String(++snapshotSequence)}`,
    baselineSha256: 'a'.repeat(64),
  });
}

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    serverId: 'provider-1',
    name: 'Provider 1',
    endpoint: 'https://provider.test/mcp',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function tool(toolName: string, inputSchema: unknown = { type: 'object' }): McpTool {
  return {
    serverId: 'provider-1',
    toolName,
    inputSchema,
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect: 'unknown',
      execution: 'unknown',
      cancellation: 'unknown',
      idempotency: 'unknown',
      replay: 'unknown',
      source: 'default_unknown',
    },
    taskExecutionProfile: profile,
    discoveredAt: timestamp,
  };
}

function snapshot(toolRevision: number, snapshotId: string): McpProtocolDiscoverySnapshot {
  return {
    snapshotId,
    serverId: 'provider-1',
    protocolMode: 'frozen_v1',
    protocolVersion: '2026-07-28',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {},
    serverInfo: { name: 'Provider 1', version: '1.0.0' },
    taskNotifications: true,
    discoveredAt: timestamp,
    toolRevision,
  };
}

const profile = {
  profileVersion: '1.0',
  taskBehavior: 'task_required',
  availability: 'dynamic',
  supportsScheduling: true,
  supportsMaxElapsed: true,
  supportsObservations: true,
  supportsInputRequired: true,
  idempotency: 'client_request_key',
} as const;
