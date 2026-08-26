import { describe, expect, it, vi } from 'vitest';

import { createMcpServer } from '../../../packages/domain/src/index.js';
import { reconcileRegisteredProviderBindings } from '../src/provider-binding-reconciler.js';

const timestamp = '2026-08-26T00:00:00.000Z';
const registered = Object.freeze({
  observedAt: timestamp,
  binding: Object.freeze({
    bindingId: 'binding-1',
    revision: 3,
    localServerId: 'provider-1',
    originType: 'direct' as const,
    providerId: 'ugv',
    endpointRef: 'http://127.0.0.1:18080/mcp',
    catalogRevision: '1.0:3',
    catalogChecksum: 'a'.repeat(64),
    operationCount: 1,
    availabilityStatus: 'unavailable' as const,
    availabilityValidUntil: '2025-01-01T00:00:00.000Z',
  }),
});

function server(serverId: string) {
  return createMcpServer({
    serverId,
    name: serverId,
    endpoint: 'http://127.0.0.1:18080/mcp',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    protocolMode: 'frozen_v1',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

describe('registered Provider semantic reconciliation', () => {
  it('synchronizes the current semantic authority even when health is expired/unavailable', async () => {
    const synchronize = vi.fn().mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue(registered);
    const onFailure = vi.fn();
    const result = await reconcileRegisteredProviderBindings({
      servers: { listServers: () => Promise.resolve([server('provider-1')]) },
      authority: { loadCurrentMcpProviderBinding: load },
      synchronize,
      onFailure,
    });
    expect(result).toEqual({ checkedCount: 1, failedCount: 0 });
    expect(load).toHaveBeenCalledExactlyOnceWith({ localServerId: 'provider-1' });
    expect(synchronize).toHaveBeenCalledExactlyOnceWith(registered);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('reports a failed authority read and still reconciles the next Provider', async () => {
    const failure = Object.assign(new Error('unavailable'), { code: 'AUTHORITY_UNAVAILABLE' });
    const synchronize = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const result = await reconcileRegisteredProviderBindings({
      servers: {
        listServers: () => Promise.resolve([server('failed'), server('provider-1')]),
      },
      authority: {
        loadCurrentMcpProviderBinding: vi
          .fn()
          .mockRejectedValueOnce(failure)
          .mockResolvedValueOnce(registered),
      },
      synchronize,
      onFailure,
    });
    expect(result).toEqual({ checkedCount: 1, failedCount: 1 });
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('failed', failure);
    expect(synchronize).toHaveBeenCalledExactlyOnceWith(registered);
  });

  it('does not discover disabled servers', async () => {
    const load = vi.fn();
    const synchronize = vi.fn();
    const result = await reconcileRegisteredProviderBindings({
      servers: {
        listServers: () =>
          Promise.resolve([{ ...server('disabled'), status: 'disabled' as const }]),
      },
      authority: { loadCurrentMcpProviderBinding: load },
      synchronize,
      onFailure: vi.fn(),
    });
    expect(result).toEqual({ checkedCount: 0, failedCount: 0 });
    expect(load).not.toHaveBeenCalled();
    expect(synchronize).not.toHaveBeenCalled();
  });
});
