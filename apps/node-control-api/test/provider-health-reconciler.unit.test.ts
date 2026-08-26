import { describe, expect, it, vi } from 'vitest';

import type {
  McpProviderBindingDetail,
  NodeControlMcpProviderBindingService,
} from '../../../packages/node-control-application/src/index.js';
import {
  createManagementOperation,
  transitionManagementOperation,
  type ManagementOperation,
} from '../../../packages/node-control-domain/src/index.js';
import { NodeControlProviderHealthReconciler } from '../src/provider-health-reconciler.js';

const NOW = '2026-08-26T02:00:00.000Z';
type BindingService = Pick<
  NodeControlMcpProviderBindingService,
  'listBindings' | 'getBinding' | 'refresh'
>;

describe('registered Provider health reconciliation', () => {
  it('refreshes only due active registrations and never creates execution requests', async () => {
    const bindings = [
      binding('fresh', 120_000),
      binding('near-expiry', 59_000),
      binding('expired', -1),
      binding('unavailable', 120_000, { availabilityStatus: 'unavailable' }),
      binding('degraded-health', 120_000, { availabilityStatus: 'degraded' }),
      binding('suspended', -1, { status: 'suspended' }),
      binding('removed', -1, { status: 'removed' }),
      binding('candidate', -1, { status: 'candidate' }),
    ];
    const refresh = vi.fn<BindingService['refresh']>(() => Promise.resolve(operation()));
    const getBinding = vi.fn<BindingService['getBinding']>((id) => {
      const record = bindings.find((item) => item.bindingId === id);
      if (record === undefined) throw new Error('UNIT_BINDING_NOT_FOUND');
      return Promise.resolve(record);
    });
    const reconciler = new NodeControlProviderHealthReconciler({
      bindings: { listBindings: () => Promise.resolve(bindings), getBinding, refresh },
      clock: { now: () => NOW },
    });

    await expect(reconciler.reconcile()).resolves.toEqual({
      refreshedCount: 4,
      skippedCount: 4,
      failures: [],
    });

    expect(refresh.mock.calls.map(([id]) => id)).toEqual([
      'near-expiry',
      'expired',
      'unavailable',
      'degraded-health',
    ]);
    for (const args of refresh.mock.calls) {
      expect(args).toHaveLength(3);
      expect(args[1]).toMatch(/^provider-health-[a-f0-9]{64}$/u);
      expect(args[2]).toContain('without executing tools');
    }
    expect(getBinding.mock.calls.map(([id]) => id)).not.toContain('suspended');
    expect(getBinding.mock.calls.map(([id]) => id)).not.toContain('removed');
    expect(bindings.every((record) => record.revision === 1)).toBe(true);
  });

  it('rechecks registration state after listing so explicit suspension cannot be refreshed', async () => {
    const refresh = vi.fn<BindingService['refresh']>(() => Promise.resolve(operation()));
    const reconciler = new NodeControlProviderHealthReconciler({
      bindings: {
        listBindings: () => Promise.resolve([binding('changed', -1)]),
        getBinding: () => Promise.resolve(binding('changed', -1, { status: 'suspended' })),
        refresh,
      },
      clock: { now: () => NOW },
    });

    await expect(reconciler.reconcile()).resolves.toEqual({
      refreshedCount: 0,
      skippedCount: 1,
      failures: [],
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('is single-flight and derives replay keys from binding identity, revision and time bucket', async () => {
    let release: ((value: ManagementOperation) => void) | undefined;
    const deferred = new Promise<ManagementOperation>((resolve) => {
      release = resolve;
    });
    const refresh = vi
      .fn<BindingService['refresh']>(() => Promise.resolve(operation()))
      .mockImplementationOnce(() => deferred);
    let current = binding('renewable', -1);
    let now = NOW;
    const reconciler = new NodeControlProviderHealthReconciler({
      bindings: {
        listBindings: () => Promise.resolve([current]),
        getBinding: () => Promise.resolve(current),
        refresh,
      },
      clock: { now: () => now },
    });

    const first = reconciler.reconcile();
    const simultaneous = reconciler.reconcile();
    expect(simultaneous).toBe(first);
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalledOnce();
    });
    release?.(operation());
    await first;

    await reconciler.reconcile();
    expect(refresh.mock.calls[1]?.[1]).toBe(refresh.mock.calls[0]?.[1]);
    current = { ...current, revision: 2 };
    await reconciler.reconcile();
    expect(refresh.mock.calls[2]?.[1]).not.toBe(refresh.mock.calls[1]?.[1]);
    now = '2026-08-26T02:00:30.000Z';
    await reconciler.reconcile();
    expect(refresh.mock.calls[3]?.[1]).not.toBe(refresh.mock.calls[2]?.[1]);
  });

  it('records stable per-binding failures and continues observing the other registrations', async () => {
    const bindings = [
      binding('operation-failed', -1),
      binding('transport-failed', -1),
      binding('lookup-failed', -1),
      binding('healthy-next', -1),
    ];
    const refresh = vi.fn<BindingService['refresh']>((id) => {
      if (id === 'operation-failed')
        return Promise.resolve(operation('MCP_PROVIDER_DISCOVERY_FAILED'));
      if (id === 'transport-failed')
        return Promise.reject(new Error('Provider response included secret-token-value'));
      return Promise.resolve(operation());
    });
    const reconciler = new NodeControlProviderHealthReconciler({
      bindings: {
        listBindings: () => Promise.resolve(bindings),
        getBinding: (id) => {
          if (id === 'lookup-failed')
            return Promise.reject(
              Object.assign(new Error('Binding disappeared.'), {
                code: 'MCP_PROVIDER_BINDING_NOT_FOUND',
              }),
            );
          const record = bindings.find((value) => value.bindingId === id);
          if (record === undefined) throw new Error('UNIT_BINDING_NOT_FOUND');
          return Promise.resolve(record);
        },
        refresh,
      },
      clock: { now: () => NOW },
    });

    const result = await reconciler.reconcile();

    expect(result).toEqual({
      refreshedCount: 1,
      skippedCount: 0,
      failures: [
        { bindingId: 'operation-failed', errorCode: 'MCP_PROVIDER_DISCOVERY_FAILED' },
        { bindingId: 'transport-failed', errorCode: 'MCP_PROVIDER_HEALTH_REFRESH_FAILED' },
        { bindingId: 'lookup-failed', errorCode: 'MCP_PROVIDER_BINDING_NOT_FOUND' },
      ],
    });
    expect(refresh.mock.calls.at(-1)?.[0]).toBe('healthy-next');
    expect(JSON.stringify(result)).not.toContain('secret-token-value');
  });

  it('releases the single-flight guard after a listing failure', async () => {
    const listBindings = vi
      .fn<BindingService['listBindings']>(() => Promise.resolve([]))
      .mockRejectedValueOnce(new Error('PROVIDER_BINDING_LIST_FAILED'));
    const reconciler = new NodeControlProviderHealthReconciler({
      bindings: {
        listBindings,
        getBinding: () => Promise.reject(new Error('UNIT_UNEXPECTED_BINDING_LOOKUP')),
        refresh: () => Promise.reject(new Error('UNIT_UNEXPECTED_BINDING_REFRESH')),
      },
      clock: { now: () => NOW },
    });

    await expect(reconciler.reconcile()).rejects.toThrow('PROVIDER_BINDING_LIST_FAILED');
    await expect(reconciler.reconcile()).resolves.toEqual({
      refreshedCount: 0,
      skippedCount: 0,
      failures: [],
    });
    expect(listBindings).toHaveBeenCalledTimes(2);
  });
});

function binding(
  bindingId: string,
  remainingMs: number,
  overrides: Partial<McpProviderBindingDetail> = {},
): McpProviderBindingDetail {
  return {
    bindingId,
    localServerId: `server.${bindingId}`,
    originType: 'direct',
    catalogRevision: 'catalog.1',
    catalogChecksum: 'a'.repeat(64),
    endpointRef: 'http://127.0.0.1:19999/mcp',
    status: 'active',
    availabilityStatus: 'available',
    revision: 1,
    availabilityValidUntil: new Date(Date.parse(NOW) + remainingMs).toISOString(),
    catalogObservedAt: '2026-08-26T01:59:00.000Z',
    operationCount: 1,
    ...overrides,
  };
}

function operation(errorCode?: string): ManagementOperation {
  const started = transitionManagementOperation(
    createManagementOperation(
      {
        operationId: 'provider-health-observation',
        operationType: 'mcp_provider_binding.refresh',
        target: { type: 'mcp_provider_binding', id: 'provider', version: '1' },
        actorId: 'node-control-api',
        reason: 'Observe Provider health.',
        idempotencyKeyHash: 'a'.repeat(64),
        inputHash: 'b'.repeat(64),
      },
      NOW,
    ),
    'running',
    NOW,
  );
  return transitionManagementOperation(
    started,
    errorCode === undefined ? 'succeeded' : 'failed',
    NOW,
    errorCode === undefined ? {} : { errorCode },
  );
}
