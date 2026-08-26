import { describe, expect, it, vi } from 'vitest';

import { createMcpProviderDispatchHash } from '../../../packages/application/src/index.js';
import { createAgentTask } from '../../../packages/domain/src/index.js';
import type { CurrentMcpProviderBindingAuthoritySnapshot } from '../../../packages/runtime-control-application/src/index.js';
import {
  currentTaskProviderBindingContext,
  type UgvTaskProviderBindingExpectation,
} from '../src/runtime.js';

const bindingId = 'smpp-binding-ugv1-p2-b03';
const serverId = 'ugv-runtime-p2-b03';
const providerId = 'isr.vehicle.ugv.ugv1';
const task = createAgentTask({
  taskId: 'task-provider-binding-context',
  contextId: 'context-provider-binding-context',
  userId: 'operator-provider-binding-context',
  requestText: 'Resolve the current Provider Binding context.',
  requestMetadata: {},
  timestamp: '2026-08-21T01:00:00.000Z',
});

describe('Task MCP Provider Binding context', () => {
  it('preserves the ordinary profile context shape when no current authority reader is supplied', async () => {
    await expect(
      currentTaskProviderBindingContext(task, serverId, taskCapabilities()),
    ).resolves.toEqual({
      providerBindingId: bindingId,
      capabilityAttemptId: 'capability-attempt-1',
    });
  });

  it('binds the exact UGV Provider identity into the Provider dispatch hash', async () => {
    const loadCurrentMcpProviderBinding = vi.fn(() => Promise.resolve(providerAuthority()));
    const context = await currentTaskProviderBindingContext(
      task,
      serverId,
      taskCapabilities(),
      {
        loadCurrentMcpProviderBinding,
      },
      ugvExpectation(),
    );
    if (context === undefined) throw new Error('TEST_PROVIDER_BINDING_CONTEXT_REQUIRED');

    expect(loadCurrentMcpProviderBinding).toHaveBeenCalledWith({
      bindingId,
      localServerId: serverId,
    });
    expect(context).toEqual({
      providerBindingId: bindingId,
      providerId,
      capabilityAttemptId: 'capability-attempt-1',
    });
    const dispatch = dispatchHash(context);
    expect(dispatch).toBe(
      dispatchHash({
        providerBindingId: bindingId,
        providerId,
        capabilityAttemptId: 'capability-attempt-1',
      }),
    );
    expect(dispatch).not.toBe(
      dispatchHash({
        providerBindingId: bindingId,
        capabilityAttemptId: 'capability-attempt-1',
      }),
    );
  });

  it('does not let deterministic metadata bypass the strict live UGV authority', async () => {
    const spoofedTask = createAgentTask({
      taskId: 'task-provider-binding-context-spoofed',
      contextId: 'context-provider-binding-context-spoofed',
      userId: 'operator-provider-binding-context',
      requestText: 'Attempt to override the strict UGV Provider authority.',
      requestMetadata: {
        'io.sdar/deterministicCapabilityExecution': {
          mcpProviderBindingId: 'smpp-binding-spoofed',
          providerId: 'isr.vehicle.ugv.spoofed',
          serverId: 'ugv-runtime-spoofed',
        },
      },
      timestamp: '2026-08-21T01:00:00.000Z',
    });
    const loadCurrentMcpProviderBinding = vi.fn(() => Promise.resolve(providerAuthority()));
    const authorizeControl = vi.fn();
    const crossTransport = vi.fn();
    const dispatch = async (): Promise<void> => {
      const context = await currentTaskProviderBindingContext(
        spoofedTask,
        serverId,
        taskCapabilities(),
        { loadCurrentMcpProviderBinding },
        ugvExpectation(),
      );
      authorizeControl(context);
      crossTransport(context);
    };

    await expect(dispatch()).rejects.toThrow('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
    expect(loadCurrentMcpProviderBinding).toHaveBeenCalledWith({
      bindingId,
      localServerId: serverId,
    });
    expect(authorizeControl).not.toHaveBeenCalled();
    expect(crossTransport).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'rejected reader',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () =>
          Promise.reject(new Error('CURRENT_PROVIDER_BINDING_NOT_FOUND')),
      },
      expected: ugvExpectation(),
    },
    {
      label: 'missing binding with an active attempt',
      capabilities: taskCapabilities({
        bindingId: undefined,
        attemptId: 'capability-attempt-1',
      }),
      reader: { loadCurrentMcpProviderBinding: () => Promise.resolve(providerAuthority()) },
      expected: ugvExpectation(),
    },
    {
      label: 'missing attempt with a current binding',
      capabilities: taskCapabilities({ bindingId, attemptId: undefined }),
      reader: { loadCurrentMcpProviderBinding: () => Promise.resolve(providerAuthority()) },
      expected: ugvExpectation(),
    },
    {
      label: 'undefined reader',
      capabilities: taskCapabilities(),
      reader: undefined,
      expected: ugvExpectation(),
    },
    {
      label: 'undefined reader snapshot',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () =>
          Promise.resolve(undefined as unknown as CurrentMcpProviderBindingAuthoritySnapshot),
      },
      expected: ugvExpectation(),
    },
    {
      label: 'binding drift',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () =>
          Promise.resolve(providerAuthority({ bindingId: 'smpp-binding-different' })),
      },
      expected: ugvExpectation(),
    },
    {
      label: 'Provider identity drift',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () =>
          Promise.resolve(providerAuthority({ providerId: 'isr.vehicle.ugv.different' })),
      },
      expected: ugvExpectation(),
    },
    {
      label: 'binding revision drift',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () => Promise.resolve(providerAuthority({ revision: 8 })),
      },
      expected: ugvExpectation(),
    },
    {
      label: 'catalog revision drift',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () =>
          Promise.resolve(providerAuthority({ catalogRevision: 'catalog-revision-2' })),
      },
      expected: ugvExpectation(),
    },
    {
      label: 'catalog checksum drift',
      capabilities: taskCapabilities(),
      reader: {
        loadCurrentMcpProviderBinding: () =>
          Promise.resolve(providerAuthority({ catalogChecksum: 'f'.repeat(64) })),
      },
      expected: ugvExpectation(),
    },
  ])(
    'fails closed for $label before control authorization or transport',
    async ({ capabilities, reader, expected }) => {
      const authorizeControl = vi.fn();
      const crossTransport = vi.fn();
      const dispatch = async (): Promise<void> => {
        const context = await currentTaskProviderBindingContext(
          task,
          serverId,
          capabilities,
          reader,
          expected,
        );
        authorizeControl(context);
        crossTransport(context);
      };

      await expect(dispatch()).rejects.toThrow('TASK_MCP_PROVIDER_BINDING_CONTEXT_INVALID');
      expect(authorizeControl).not.toHaveBeenCalled();
      expect(crossTransport).not.toHaveBeenCalled();
    },
  );
});

function taskCapabilities(
  override: Readonly<{
    bindingId: string | undefined;
    attemptId: string | undefined;
  }> = {
    bindingId,
    attemptId: 'capability-attempt-1',
  },
) {
  return {
    resolveCurrentProviderBindingId: () => Promise.resolve(override.bindingId),
    resolveCurrentCapabilityAttemptId: () => Promise.resolve(override.attemptId),
  };
}

function providerAuthority(
  override: Readonly<{
    bindingId?: string;
    providerId?: string;
    revision?: number;
    catalogRevision?: string;
    catalogChecksum?: string;
  }> = {},
): CurrentMcpProviderBindingAuthoritySnapshot {
  return Object.freeze({
    observedAt: '2026-08-21T01:00:00.000Z',
    binding: Object.freeze({
      bindingId: override.bindingId ?? bindingId,
      revision: override.revision ?? 7,
      localServerId: serverId,
      originType: 'smpp_registry' as const,
      providerId: override.providerId ?? providerId,
      externalProviderId: providerId,
      externalServerId: 'ugv1-external-smpp-server',
      registryRevision: 11,
      registryChecksum: 'a'.repeat(64),
      catalogRevision: override.catalogRevision ?? 'catalog-revision-1',
      catalogChecksum: override.catalogChecksum ?? 'b'.repeat(64),
      endpointRef: 'http://127.0.0.1:10001/mcp',
      availabilityStatus: 'available' as const,
      availabilityValidUntil: '2026-08-21T01:30:00.000Z',
      catalogObservedAt: '2026-08-21T01:00:00.000Z',
      operationCount: 2,
    }),
    sourceCandidateLineage: Object.freeze({
      smppSourceId: 'smpp-source-ugv1',
      externalProviderId: providerId,
      externalServerId: 'ugv1-external-smpp-server',
      registryRevision: 11,
      registryChecksum: 'a'.repeat(64),
      nativeRevision: 3,
      nativeChecksum: 'c'.repeat(64),
      projectionContract: 'sdar-registry-v1' as const,
      candidateEndpoint: 'http://127.0.0.1:10001/mcp',
    }),
  });
}

function ugvExpectation(): UgvTaskProviderBindingExpectation {
  return Object.freeze({
    bindingId,
    bindingRevision: 7,
    providerId,
    localServerId: serverId,
    catalogRevision: 'catalog-revision-1',
    catalogChecksum: 'b'.repeat(64),
  });
}

function dispatchHash(
  context: Readonly<{
    providerBindingId?: string;
    providerId?: string;
    capabilityAttemptId?: string;
  }>,
): string {
  return createMcpProviderDispatchHash({
    invocationId: 'mcp-invocation-1',
    taskId: task.taskId,
    contextId: task.contextId,
    ...(context.providerBindingId === undefined
      ? {}
      : { providerBindingId: context.providerBindingId }),
    ...(context.providerId === undefined ? {} : { providerId: context.providerId }),
    serverId,
    toolName: 'vehicle_navigate',
    arguments: {
      resourceId: 'vehicle:ugv1',
      mission: { type: 'point', target: { longitude: 106.814, latitude: 29.7204 } },
      stopOnObstacle: true,
    },
  });
}
