import { describe, expect, it, vi } from 'vitest';

import type {
  McpDependencyWarning,
  McpInvocation,
  McpInvocationOutcome,
  McpManagementOperation,
  McpProtocolDiscoverySnapshot,
  McpServer,
  McpTool,
  ResolvedMcpTaskExecution,
} from '../../domain/src/index.js';
import {
  deriveFrozenMcpCatalogAuthority,
  LIVE_RUNTIME_EXECUTION_CONTEXT,
} from '../../domain/src/index.js';
import {
  createMcpProviderDispatchHash,
  McpRegistryService,
  type FrozenTaskAvailabilityRuntimePort,
  type FrozenTaskLifecycleRuntimePort,
} from '../src/mcp-registry.js';
import {
  governedControlSnapshotHash,
  type GovernedControlInvocation,
} from '../src/governed-control-authority.js';
import type { McpRegistryRepository, McpServerRecord } from '../src/ports.js';
import { McpRuntimeBindingAuthorityVerifier } from '../src/mcp-runtime-binding-authority.js';

const timestamp = '2026-08-11T01:00:00.000Z';

describe('MCP Registry invocation boundary', () => {
  it.each([
    {
      availabilityStatus: 'unavailable' as const,
      availabilityValidUntil: '2026-08-11T02:00:00.000Z',
    },
    { availabilityStatus: 'available' as const, availabilityValidUntil: timestamp },
  ])(
    'keeps registered authority but rejects execution without fresh available health: %j',
    async (health) => {
      const fixture = createFixture();
      const verifier = new McpRuntimeBindingAuthorityVerifier({
        repository: fixture.repository,
        clock: { now: () => timestamp },
      });
      const runtime = await verifier.loadRuntimeAuthority('provider-1');
      const input = {
        bindingId: 'binding-provider-1',
        localServerId: 'provider-1',
        authority: {
          observedAt: timestamp,
          binding: {
            bindingId: 'binding-provider-1',
            revision: 1,
            localServerId: 'provider-1',
            providerId: 'external-provider-1',
            originType: 'direct' as const,
            endpointRef: runtime.record.server.endpoint,
            ...runtime.catalogAuthority,
            ...health,
          },
        },
      };
      await expect(verifier.assertRegistered(input)).resolves.toBeUndefined();
      await expect(verifier.assertCurrent(input)).rejects.toMatchObject({
        code: 'MCP_PROVIDER_NOT_READY',
      });
      expect(fixture.call).not.toHaveBeenCalled();
      expect(fixture.repository.invocations).toHaveLength(0);
    },
  );
  it('can omit only the live execution-mode header while retaining live invocation evidence', async () => {
    const fixture = createFixture({ executionModeHeaderPolicy: 'omit_live' });

    await fixture.service.callDetailed('provider-1', 'light_get_state', {});

    expect(fixture.call).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        headers: { authorization: 'Bearer provider-secret' },
      }),
    );
    expect(fixture.repository.invocations).toEqual([
      expect.objectContaining({ executionMode: 'live' }),
    ]);
  });

  it('keeps explicit simulation headers when live-header omission is enabled', async () => {
    const fixture = createFixture({ executionModeHeaderPolicy: 'omit_live' });

    await fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
      executionContext: { mode: 'simulation', simulationId: 'simulation-header-test' },
    });

    expect(fixture.call).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        headers: {
          authorization: 'Bearer provider-secret',
          'X-SDAR-Execution-Mode': 'simulation',
          'X-SDAR-Simulation-Id': 'simulation-header-test',
        },
      }),
    );
  });

  it('journals a remote receipt atomically instead of saving the invocation separately', async () => {
    const outcome: McpInvocationOutcome = {
      kind: 'remote_task',
      task: {
        protocolMode: 'frozen_v1',
        remoteTaskId: 'remote-task-journal-1',
        status: 'working',
        createdAt: '2026-08-13T00:00:00.000Z',
        lastUpdatedAt: '2026-08-13T00:00:00.000Z',
        ttlMs: 60_000,
        protocolRevision: '2026-07-28',
        tasksSchemaRevision: 'tasks-v1',
        runtimeRevision: 'runtime-1',
      },
    };
    const markDispatching = vi.fn().mockResolvedValue(undefined);
    const recordRemoteReceipt = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const markUncertain = vi.fn().mockResolvedValue(undefined);
    const fixture = createFixture({ outcome, toolName: 'task_success' });

    await expect(
      fixture.service.callDetailed('provider-1', 'task_success', {}, undefined, {
        remoteAdmissionJournal: {
          invocationId: 'invocation-remote-journal',
          markDispatching,
          recordRemoteReceipt,
          close,
          markUncertain,
        },
      }),
    ).resolves.toMatchObject({
      invocationId: 'invocation-remote-journal',
      outcome: { kind: 'remote_task', task: { remoteTaskId: 'remote-task-journal-1' } },
    });
    expect(markDispatching).toHaveBeenCalledOnce();
    expect(recordRemoteReceipt).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        taskCancellation: 'unsupported',
        authoritySnapshot: expect.objectContaining({
          schemaVersion: '1.0',
          runtime: expect.objectContaining({
            serverId: 'provider-1',
            endpoint: 'https://provider.test/mcp',
            protocolSnapshotId: 'snapshot-1',
          }),
          providerBinding: expect.objectContaining({
            bindingId: 'binding-provider-1',
            revision: 1,
            providerId: 'external-provider-1',
          }),
        }),
      }),
    );
    expect(fixture.repository.invocations).toEqual([]);
    expect(close).not.toHaveBeenCalled();
    expect(markUncertain).not.toHaveBeenCalled();
  });

  it('continues tasks/get when only Provider readiness observation timestamps refresh', async () => {
    let readCount = 0;
    const fixture = createFixture({
      outcome: remoteTaskOutcome(),
      currentBinding: () =>
        readCount++ === 0
          ? {}
          : {
              revision: 2,
              catalogRevision: '1.0.0:2',
              bindingAvailabilityValidUntil: '2026-08-11T03:00:00.000Z',
              observedAt: '2026-08-11T01:00:30.000Z',
            },
    });
    const admitted = await fixture.service.callDetailed('provider-1', 'light_get_state', {});
    if (admitted.protocolContract === undefined) throw new Error('TEST_PROTOCOL_CONTRACT_MISSING');
    const providerBinding = admitted.authoritySnapshot.providerBinding;
    if (providerBinding === undefined) throw new Error('TEST_PROVIDER_AUTHORITY_MISSING');
    const historicalAuthority = {
      ...admitted.authoritySnapshot,
      providerBinding: {
        ...providerBinding,
        observedAt: '2026-08-11T00:59:30.000Z',
        availabilityValidUntil: '2026-08-11T01:30:00.000Z',
      },
    };
    const decryptCountBeforeRead = fixture.decrypt.mock.calls.length;

    await expect(
      fixture.service.readRemoteTask({
        serverId: 'provider-1',
        operationName: 'light_get_state',
        remoteTaskId: 'remote-task-read-1',
        executionContext: LIVE_RUNTIME_EXECUTION_CONTEXT,
        authoritySnapshot: historicalAuthority,
        credentialRevision: timestamp,
        protocolContract: admitted.protocolContract,
      }),
    ).resolves.toMatchObject({
      kind: 'snapshot',
      snapshot: { remoteTaskId: 'remote-task-read-1' },
    });
    expect(fixture.get).toHaveBeenCalledOnce();
    expect(fixture.decrypt).toHaveBeenCalledTimes(decryptCountBeforeRead + 1);
  });

  it.each([
    ['legacy row without a snapshot', () => undefined],
    [
      'Runtime endpoint drift',
      (
        authority: Awaited<ReturnType<McpRegistryService['callDetailed']>>['authoritySnapshot'],
      ) => ({
        ...authority,
        runtime: { ...authority.runtime, endpoint: 'https://stale-runtime.test/mcp' },
      }),
    ],
    [
      'Runtime Catalog drift',
      (
        authority: Awaited<ReturnType<McpRegistryService['callDetailed']>>['authoritySnapshot'],
      ) => ({
        ...authority,
        runtime: { ...authority.runtime, catalogChecksum: 'f'.repeat(64) },
      }),
    ],
    [
      'Provider Binding revision drift',
      (authority: Awaited<ReturnType<McpRegistryService['callDetailed']>>['authoritySnapshot']) => {
        if (authority.providerBinding === undefined)
          throw new Error('TEST_PROVIDER_AUTHORITY_MISSING');
        return {
          ...authority,
          providerBinding: {
            ...authority.providerBinding,
            revision: authority.providerBinding.revision + 1,
          },
        };
      },
    ],
  ])('quarantines %s before tasks/get transport', async (_case, mutateAuthority) => {
    const fixture = createFixture({ outcome: remoteTaskOutcome() });
    const admitted = await fixture.service.callDetailed('provider-1', 'light_get_state', {});
    if (admitted.protocolContract === undefined) throw new Error('TEST_PROTOCOL_CONTRACT_MISSING');
    const decryptCountBeforeRead = fixture.decrypt.mock.calls.length;
    const authoritySnapshot = mutateAuthority(admitted.authoritySnapshot);

    await expect(
      fixture.service.readRemoteTask({
        serverId: 'provider-1',
        operationName: 'light_get_state',
        remoteTaskId: 'remote-task-read-1',
        executionContext: LIVE_RUNTIME_EXECUTION_CONTEXT,
        ...(authoritySnapshot === undefined ? {} : { authoritySnapshot }),
        credentialRevision: timestamp,
        protocolContract: admitted.protocolContract,
      }),
    ).resolves.toEqual({
      kind: 'provider_protocol',
      errorCode: 'MCP_REMOTE_TASK_AUTHORITY_CHANGED',
    });
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.decrypt).toHaveBeenCalledTimes(decryptCountBeforeRead);
  });

  it.each([
    ['Binding revision rollback', { revision: 0 }],
    ['Provider identity change', { providerId: 'replacement-provider' }],
    ['Binding identity change', { bindingId: 'replacement-binding' }],
    ['Binding origin change', { originType: 'direct' as const }],
    ['external Server identity change', { externalServerId: 'replacement-server' }],
    ['SMPP source identity change', { smppSourceId: 'replacement-source' }],
    ['endpoint change', { endpoint: 'https://replacement-provider.test/mcp' }],
    ['Catalog checksum change', { catalogChecksum: 'f'.repeat(64) }],
    ['expired current availability', { bindingAvailabilityValidUntil: timestamp }],
  ])('quarantines current Provider %s before tasks/get transport', async (_case, current) => {
    let readCount = 0;
    const fixture = createFixture({
      outcome: remoteTaskOutcome(),
      currentBinding: () => (readCount++ === 0 ? {} : current),
    });
    const admitted = await fixture.service.callDetailed('provider-1', 'light_get_state', {});
    if (admitted.protocolContract === undefined) throw new Error('TEST_PROTOCOL_CONTRACT_MISSING');
    const decryptCountBeforeRead = fixture.decrypt.mock.calls.length;

    await expect(
      fixture.service.readRemoteTask({
        serverId: 'provider-1',
        operationName: 'light_get_state',
        remoteTaskId: 'remote-task-read-1',
        executionContext: LIVE_RUNTIME_EXECUTION_CONTEXT,
        authoritySnapshot: admitted.authoritySnapshot,
        credentialRevision: timestamp,
        protocolContract: admitted.protocolContract,
      }),
    ).resolves.toEqual({
      kind: 'provider_protocol',
      errorCode: 'MCP_REMOTE_TASK_AUTHORITY_CHANGED',
    });
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.decrypt).toHaveBeenCalledTimes(decryptCountBeforeRead);
  });
  it('rejects a discovered side-effecting Tool without governed Task authority', async () => {
    const fixture = createFixture({ toolEffect: 'side_effecting' });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_set_state', {
        resourceId: 'living-room-main-light',
      }),
    ).rejects.toMatchObject({ code: 'MCP_CONTROL_AUTHORITY_REQUIRED' });

    expect(fixture.controlAuthority).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('rejects unknown Tool effect before transport even when Task identity is supplied', async () => {
    const fixture = createFixture({ toolEffect: 'unknown' });

    await expect(
      fixture.service.callDetailed(
        'provider-1',
        'light_set_state',
        { resourceId: 'living-room-main-light' },
        undefined,
        {
          taskId: 'task-control-1',
          capabilityAttemptId: 'capability-attempt-control-1',
          providerBindingId: 'binding-provider-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'MCP_CONTROL_SEMANTICS_NOT_EXPLICIT' });

    expect(fixture.controlAuthority).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it('hard-denies vehicle_fire_weapon even when a Catalog mislabels it read-only', async () => {
    const fixture = createFixture({ toolName: 'vehicle_fire_weapon', toolEffect: 'read_only' });

    await expect(
      fixture.service.callDetailed('provider-1', 'vehicle_fire_weapon', {}),
    ).rejects.toMatchObject({ code: 'MCP_CONTROL_TOOL_HARD_DENIED' });

    expect(fixture.controlAuthority).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it('crosses transport only after exact governed side-effect authority succeeds', async () => {
    const order: string[] = [];
    const fixture = createFixture({ toolEffect: 'side_effecting', order });
    const arguments_ = { resourceId: 'living-room-main-light' };

    await expect(
      fixture.service.callDetailed('provider-1', 'light_set_state', arguments_, undefined, {
        taskId: 'task-control-1',
        capabilityAttemptId: 'capability-attempt-control-1',
        providerBindingId: 'binding-provider-1',
        providerId: 'external-provider-1',
      }),
    ).resolves.toMatchObject({ invocationId: 'invocation-1' });

    expect(fixture.controlAuthority).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        invocationId: 'invocation-1',
        dispatchHash: createMcpProviderDispatchHash({
          invocationId: 'invocation-1',
          taskId: 'task-control-1',
          providerBindingId: 'binding-provider-1',
          providerId: 'external-provider-1',
          serverId: 'provider-1',
          toolName: 'light_set_state',
          arguments: arguments_,
        }),
        taskId: 'task-control-1',
        capabilityAttemptId: 'capability-attempt-control-1',
        providerBindingId: 'binding-provider-1',
        serverId: 'provider-1',
        toolName: 'light_set_state',
        arguments: arguments_,
      }),
    );
    expect(order).toEqual([
      'frozen-authority',
      'binding-authority',
      'control-authority',
      'provider-call',
    ]);
    expect(fixture.repository.invocations).toEqual([
      expect.objectContaining({
        invocationId: 'invocation-1',
        controlConfirmationId: 'confirmation-control-1',
        controlProviderBindingId: 'binding-provider-1',
        controlArgumentsHash: governedControlSnapshotHash(arguments_),
        controlDispatchHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    ]);
  });

  it('forwards exact nested navigate distance arguments through authority before transport', async () => {
    const order: string[] = [];
    const fixture = createFixture({
      toolName: 'vehicle_navigate',
      toolEffect: 'side_effecting',
      order,
    });
    const arguments_ = {
      resourceId: 'vehicle:ugv1',
      mission: { type: 'distance', direction: 'forward', distanceM: 2 },
    };

    await fixture.service.callDetailed('provider-1', 'vehicle_navigate', arguments_, undefined, {
      taskId: 'task-control-1',
      capabilityAttemptId: 'capability-attempt-control-1',
      providerBindingId: 'binding-provider-1',
      providerId: 'external-provider-1',
    });

    expect(fixture.controlAuthority).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'vehicle_navigate',
        arguments: arguments_,
      }),
    );
    expect(fixture.call).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'vehicle_navigate',
        arguments: arguments_,
      }),
    );
    expect(order.indexOf('control-authority')).toBeLessThan(order.indexOf('provider-call'));
  });

  it('rejects a disabled Server before Frozen authority lookup or Provider transport', async () => {
    const fixture = createFixture({ serverStatus: 'disabled' });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}),
    ).rejects.toMatchObject({ code: 'MCP_SERVER_NOT_ENABLED' });

    expect(fixture.repository.protocolSnapshotReads).toBe(0);
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('requires Frozen snapshot and Tool authority before Provider transport', async () => {
    const fixture = createFixture({ protocolSnapshot: undefined });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}),
    ).rejects.toMatchObject({ code: 'MCP_FROZEN_PROTOCOL_SNAPSHOT_REQUIRED' });

    expect(fixture.repository.protocolSnapshotReads).toBe(1);
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('rechecks exact current Node Control Binding authority before Provider transport', async () => {
    const fixture = createFixture({ bindingEndpoint: 'https://stale-provider.test/mcp' });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
        providerBindingId: 'binding-provider-1',
      }),
    ).rejects.toMatchObject({ code: 'MCP_PROVIDER_BINDING_NOT_CURRENT' });

    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('rejects Runtime frozen Catalog drift before Provider transport or persistence', async () => {
    const fixture = createFixture({ bindingCatalogChecksum: 'f'.repeat(64) });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
        providerBindingId: 'binding-provider-1',
        providerId: 'external-provider-1',
      }),
    ).rejects.toMatchObject({ code: 'MCP_PROVIDER_BINDING_NOT_CURRENT' });
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('preserves standalone direct MCP calls when no Binding reader or explicit Binding is present', async () => {
    const fixture = createFixture({ providerBindingsConfigured: false });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}),
    ).resolves.toMatchObject({ invocationId: 'invocation-1' });
    expect(fixture.call).toHaveBeenCalledOnce();
  });

  it('fails closed when an explicit governed Binding has no configured authority reader', async () => {
    const fixture = createFixture({ providerBindingsConfigured: false });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
        providerBindingId: 'binding-provider-1',
      }),
    ).rejects.toMatchObject({ code: 'MCP_PROVIDER_BINDING_AUTHORITY_UNAVAILABLE' });
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it.each([
    ['exact entity value', { target: 'light.kitchen' }],
    ['resource-prefixed entity value', { target: 'resource:light.kitchen' }],
    ['entity value with a third segment', { target: 'light.kitchen.secret' }],
    [
      'resource-prefixed entity value with a third segment',
      { target: 'resource:light.kitchen.extra' },
    ],
    [
      'entity value in URI path',
      { target: 'https://home-assistant.test/api/states/climate.living_room/history' },
    ],
    [
      'entity value in URI query',
      { target: 'https://home-assistant.test/state?entity=climate.living_room&public=true' },
    ],
    ['entity key', { entityId: 'redacted' }],
    ['physical resource key', { physical_resource_id: 'redacted' }],
    ['camel physical resource key', { physicalResourceId: 'redacted' }],
  ])(
    'rejects a physical identifier in Tool arguments %s before transport or persistence',
    async (_case, args) => {
      const fixture = createFixture();

      await expect(
        fixture.service.callDetailed('provider-1', 'light_get_state', args),
      ).rejects.toMatchObject({ code: 'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN' });

      expect(fixture.call).not.toHaveBeenCalled();
      expect(fixture.repository.invocations).toEqual([]);
    },
  );

  it.each([
    'light.state.observation',
    'light.brightness.observation',
    'climate.state.observation',
    'climate.hvac_mode.observation',
    'climate.target_temperature.observation',
  ])(
    'allows exact governed semantic evidence type %s with public resource lineage',
    async (type) => {
      const digest = `sha256:${'a'.repeat(64)}`;
      const fixture = createFixture({
        outcome: immediateOutcome({
          structuredContent: {
            resourceId: 'living-room-main-light',
            evidenceType: type,
            resultHash: digest,
          },
          evidence: [
            {
              evidenceId: 'provider-evidence-1',
              evidenceType: type,
              observedAt: timestamp,
              subjectRef: 'resource:living-room-main-light',
              producer: 'provider:ha-light-lab',
              payloadRef: { kind: 'structured_content', jsonPointer: '' },
              metadata: {
                semanticType: type,
                entityIdentityAuthority: 'public_resource_id',
                physicalResourceIdentifierKind: 'public_resource_id',
                integrity: digest,
              },
            },
          ],
        }),
      });

      await expect(
        fixture.service.callDetailed('provider-1', 'light_get_state', {
          requestedEvidenceType: type,
          resourceId: 'living-room-main-light',
        }),
      ).resolves.toMatchObject({
        outcome: { result: { structuredContent: { resultHash: digest } } },
      });

      expect(fixture.call).toHaveBeenCalledOnce();
      expect(fixture.repository.invocations).toHaveLength(1);
      expect(fixture.repository.invocations[0]).toMatchObject({ status: 'succeeded' });
    },
  );

  it.each([
    ['subjectRef', { subjectRef: 'light.kitchen' }],
    ['producer', { producer: 'home-assistant://climate.living_room' }],
    [
      'metadata URI path value',
      { metadata: { source: 'https://home-assistant.test/api/states/climate.living_room' } },
    ],
    ['metadata resource value', { metadata: { source: 'resource:light.kitchen' } }],
    ['metadata key', { metadata: { entity_id: 'redacted' } }],
  ])(
    'rejects an HA entity ID in Provider evidence %s before any result is persisted',
    async (_case, unsafeEvidence) => {
      const fixture = createFixture({
        outcome: immediateOutcome({
          structuredContent: { resourceId: 'living-room-main-light' },
          evidence: [
            {
              evidenceId: 'provider-evidence-1',
              evidenceType: 'light.state.observation',
              observedAt: timestamp,
              payloadRef: { kind: 'structured_content', jsonPointer: '' },
              ...unsafeEvidence,
            },
          ],
        }),
      });

      await expect(
        fixture.service.callDetailed('provider-1', 'light_get_state', {}),
      ).rejects.toMatchObject({ code: 'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN' });

      expect(fixture.call).toHaveBeenCalledOnce();
      expect(fixture.repository.invocations).toHaveLength(1);
      expect(fixture.repository.invocations[0]).toMatchObject({
        status: 'failed',
        errorCode: 'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN',
      });
      expect(fixture.repository.invocations[0]?.result).toBeUndefined();
      const persisted = JSON.stringify(fixture.repository.invocations[0]);
      expect(persisted).not.toContain('living_room');
      expect(persisted).not.toContain('light.kitchen');
      expect(persisted).not.toContain('"entity_id":"redacted"');
    },
  );

  it('persists the exact Capability attempt lineage on a successful invocation', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
        taskId: 'task-capability-1',
        contextId: 'context-capability-1',
        capabilityAttemptId: 'capability-attempt-current',
      }),
    ).resolves.toMatchObject({ invocationId: 'invocation-1' });

    expect(fixture.repository.invocations).toEqual([
      expect.objectContaining({
        taskId: 'task-capability-1',
        contextId: 'context-capability-1',
        capabilityAttemptId: 'capability-attempt-current',
        status: 'succeeded',
      }),
    ]);
  });

  it('persists the exact Capability attempt lineage on a failed invocation', async () => {
    const fixture = createFixture({
      callError: Object.assign(new Error('provider unavailable'), {
        code: 'PROVIDER_TRANSPORT_FAILED',
      }),
    });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
        taskId: 'task-capability-1',
        contextId: 'context-capability-1',
        capabilityAttemptId: 'capability-attempt-current',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TRANSPORT_FAILED' });

    expect(fixture.repository.invocations).toEqual([
      expect.objectContaining({
        taskId: 'task-capability-1',
        contextId: 'context-capability-1',
        capabilityAttemptId: 'capability-attempt-current',
        status: 'failed',
        errorCode: 'PROVIDER_TRANSPORT_FAILED',
      }),
    ]);
  });

  it('redacts transport failure messages before persisting the failed invocation', async () => {
    const fixture = createFixture({
      callError: Object.assign(
        new Error('Provider https://user:secret@provider.test leaked light.private_living_room'),
        { code: 'PROVIDER_TRANSPORT_FAILED' },
      ),
    });

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}),
    ).rejects.toMatchObject({ code: 'PROVIDER_TRANSPORT_FAILED' });
    expect(fixture.repository.invocations).toHaveLength(1);
    expect(fixture.repository.invocations[0]).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_TRANSPORT_FAILED',
      errorMessage: 'MCP Tool call failed.',
    });
    expect(JSON.stringify(fixture.repository.invocations[0])).not.toContain('secret');
    expect(JSON.stringify(fixture.repository.invocations[0])).not.toContain('private_living_room');
  });

  it('persists and returns a safe result only after Frozen authority is resolved', async () => {
    const order: string[] = [];
    const fixture = createFixture({ order });

    const receipt = await fixture.service.callDetailed('provider-1', 'light_get_state', {});

    expect(order).toEqual(['frozen-authority', 'binding-authority', 'provider-call']);
    expect(receipt.protocolContract).toMatchObject({ serverDiscoverySnapshotId: 'snapshot-1' });
    expect(fixture.repository.invocations).toHaveLength(1);
    expect(fixture.repository.invocations[0]).toMatchObject({ status: 'succeeded' });
  });

  it('constructs the full Task call profile from authoritative dispatch identity and readiness', async () => {
    const fixture = createFixture({
      outcome: remoteTaskOutcome(),
      toolName: 'vehicle_navigate',
      toolEffect: 'side_effecting',
      toolExecution: 'task_required',
      toolIdempotency: 'server_managed',
      taskBehavior: 'task_required',
    });
    const enter = vi.fn(() => Promise.resolve());

    const result = await fixture.service.callDetailed(
      'provider-1',
      'vehicle_navigate',
      { resourceId: 'vehicle:ugv1' },
      undefined,
      {
        taskId: 'task-navigate-1',
        capabilityAttemptId: 'attempt-navigate-1',
        providerBindingId: 'binding-provider-1',
        providerId: 'external-provider-1',
        preTransportFence: {
          invocationId: 'invocation-authoritative-navigate-1',
          signal: new AbortController().signal,
          enter,
        },
        taskExecution: {
          protocolMode: 'frozen_v1',
          availabilityCheck: 'required',
          timing: {
            start: {
              mode: 'scheduled',
              scheduledAt: '2026-08-11T01:10:00+00:00',
              startToleranceMs: 2_500,
            },
            maxElapsedMs: 60_000,
          },
          reservationRef: 'reservation-navigate-1',
        },
      },
    );

    expect(result.invocationId).toBe('invocation-authoritative-navigate-1');
    expect(fixture.call).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        taskCallProfile: {
          profileVersion: '1.0',
          idempotencyKey: 'invocation-authoritative-navigate-1',
          timing: {
            start: {
              mode: 'scheduled',
              scheduledAt: '2026-08-11T01:10:00.000Z',
              startToleranceMs: 2_500,
            },
            maxElapsedMs: 60_000,
          },
          reservationRef: 'reservation-navigate-1',
        },
      }),
    );
    expect(enter).toHaveBeenCalledOnce();
  });

  it('sends a key-only profile for idempotent Task-required operations', async () => {
    const fixture = createFixture({
      toolName: 'task_operation',
      toolExecution: 'task_required',
      toolIdempotency: 'client_request_key',
      taskBehavior: 'task_required',
    });

    await fixture.service.callDetailed('provider-1', 'task_operation', {}, undefined, {
      taskExecution: { protocolMode: 'frozen_v1', availabilityCheck: 'required' },
    });

    expect(fixture.call).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        taskCallProfile: { profileVersion: '1.0', idempotencyKey: 'invocation-1' },
      }),
    );
  });

  it('does not invent an idempotency key when Task semantics declare none', async () => {
    const fixture = createFixture({
      toolName: 'task_without_idempotency',
      toolExecution: 'task_required',
      toolIdempotency: 'none',
      taskBehavior: 'task_required',
    });

    await fixture.service.callDetailed('provider-1', 'task_without_idempotency', {}, undefined, {
      taskExecution: {
        protocolMode: 'frozen_v1',
        availabilityCheck: 'required',
        timing: {
          start: { mode: 'immediate', startToleranceMs: 0 },
          maxElapsedMs: null,
        },
      },
    });

    expect(fixture.call).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        taskCallProfile: {
          profileVersion: '1.0',
          timing: {
            start: { mode: 'immediate', startToleranceMs: 0 },
            maxElapsedMs: null,
          },
        },
      }),
    );
    expect(fixture.call.mock.calls[0]?.[0].taskCallProfile).not.toHaveProperty('idempotencyKey');
  });

  it('omits the Task call profile when Task execution was not resolved', async () => {
    const fixture = createFixture({
      toolName: 'task_without_readiness',
      toolExecution: 'task_required',
      toolIdempotency: 'server_managed',
      taskBehavior: 'task_required',
    });

    await fixture.service.callDetailed('provider-1', 'task_without_readiness', {});

    expect(fixture.call).toHaveBeenCalledOnce();
    expect(fixture.call.mock.calls[0]?.[0]).not.toHaveProperty('taskCallProfile');
  });

  it('keeps synchronous reads free of Task call metadata', async () => {
    const fixture = createFixture({ toolIdempotency: 'server_managed' });

    await fixture.service.callDetailed('provider-1', 'light_get_state', {});

    expect(fixture.call).toHaveBeenCalledOnce();
    expect(fixture.call.mock.calls[0]?.[0]).not.toHaveProperty('taskCallProfile');
  });

  it.each([
    [
      'an unknown timing field',
      {
        start: { mode: 'immediate', startToleranceMs: 0 },
        maxElapsedMs: null,
        unexpected: true,
      },
    ],
    ['an undefined start', { start: undefined, maxElapsedMs: null }],
    [
      'an undefined maximum elapsed value',
      { start: { mode: 'immediate', startToleranceMs: 0 }, maxElapsedMs: undefined },
    ],
  ])('rejects %s before entering a fence or crossing transport', async (_case, timing) => {
    const fixture = createFixture({
      toolName: 'task_invalid_timing',
      toolExecution: 'task_required',
      toolIdempotency: 'server_managed',
      taskBehavior: 'task_required',
    });
    const enter = vi.fn(() => Promise.resolve());
    const malformed = {
      protocolMode: 'frozen_v1',
      availabilityCheck: 'required',
      timing,
    } as unknown as ResolvedMcpTaskExecution;

    await expect(
      fixture.service.callDetailed('provider-1', 'task_invalid_timing', {}, undefined, {
        taskExecution: malformed,
        preTransportFence: {
          invocationId: 'invocation-invalid-timing-1',
          signal: new AbortController().signal,
          enter,
        },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_CALL_PROFILE_INVALID', name: 'DomainError' });
    expect(enter).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it('rejects an overlong authoritative idempotency key before transport', async () => {
    const fixture = createFixture({
      toolName: 'task_invalid_key',
      toolExecution: 'task_required',
      toolIdempotency: 'server_managed',
      taskBehavior: 'task_required',
    });
    const enter = vi.fn(() => Promise.resolve());

    await expect(
      fixture.service.callDetailed('provider-1', 'task_invalid_key', {}, undefined, {
        taskExecution: { protocolMode: 'frozen_v1', availabilityCheck: 'required' },
        preTransportFence: {
          invocationId: 'i'.repeat(257),
          signal: new AbortController().signal,
          enter,
        },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_CALL_PROFILE_INVALID', name: 'DomainError' });
    expect(enter).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it('rejects Task call data for a synchronous read before transport', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.callDetailed('provider-1', 'light_get_state', {}, undefined, {
        taskExecution: { protocolMode: 'frozen_v1', availabilityCheck: 'required' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_CALL_PROFILE_CONFLICT' });
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.decrypt).not.toHaveBeenCalled();
  });

  it('enters the exact durable dispatch fence after catalog and binding checks and before transport', async () => {
    const order: string[] = [];
    const fixture = createFixture({ order });
    const arguments_ = { resourceId: 'living-room-main-light' };
    const enter = vi.fn(() => {
      order.push('provider-dispatch');
      return Promise.resolve();
    });

    const receipt = await fixture.service.callDetailed(
      'provider-1',
      'light_get_state',
      arguments_,
      undefined,
      {
        taskId: 'task-deterministic-1',
        contextId: 'context-deterministic-1',
        providerBindingId: 'binding-provider-1',
        providerId: 'external-provider-1',
        preTransportFence: {
          invocationId: 'invocation-deterministic-1',
          signal: new AbortController().signal,
          enter,
        },
      },
    );

    expect(order).toEqual([
      'frozen-authority',
      'binding-authority',
      'provider-dispatch',
      'provider-call',
    ]);
    expect(receipt.invocationId).toBe('invocation-deterministic-1');
    expect(enter).toHaveBeenCalledExactlyOnceWith({
      dispatchId: 'invocation-deterministic-1',
      dispatchHash: createMcpProviderDispatchHash({
        invocationId: 'invocation-deterministic-1',
        taskId: 'task-deterministic-1',
        contextId: 'context-deterministic-1',
        providerBindingId: 'binding-provider-1',
        providerId: 'external-provider-1',
        serverId: 'provider-1',
        toolName: 'light_get_state',
        arguments: arguments_,
      }),
    });
    expect(fixture.repository.invocations).toHaveLength(1);
  });

  it('does not call or persist an invocation when the durable dispatch fence rejects', async () => {
    const fixture = createFixture();
    const enter = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('lease lost'), {
          code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST',
        }),
      ),
    );

    await expect(
      fixture.service.callDetailed(
        'provider-1',
        'light_get_state',
        { resourceId: 'living-room-main-light' },
        undefined,
        {
          taskId: 'task-deterministic-1',
          contextId: 'context-deterministic-1',
          providerBindingId: 'binding-provider-1',
          providerId: 'external-provider-1',
          preTransportFence: {
            invocationId: 'invocation-deterministic-1',
            signal: new AbortController().signal,
            enter,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST' });

    expect(enter).toHaveBeenCalledOnce();
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('does not consume side-effect confirmation when the durable dispatch fence rejects', async () => {
    const fixture = createFixture({ toolEffect: 'side_effecting' });
    const enter = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error('lease lost'), {
          code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST',
        }),
      ),
    );

    await expect(
      fixture.service.callDetailed(
        'provider-1',
        'light_set_state',
        { resourceId: 'living-room-main-light' },
        undefined,
        {
          taskId: 'task-control-1',
          capabilityAttemptId: 'capability-attempt-control-1',
          providerBindingId: 'binding-provider-1',
          providerId: 'external-provider-1',
          preTransportFence: {
            invocationId: 'invocation-control-fenced-1',
            signal: new AbortController().signal,
            enter,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST' });

    expect(enter).toHaveBeenCalledOnce();
    expect(fixture.controlAuthority).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('does not enter the fence, call, or persist when the lease is already aborted', async () => {
    const fixture = createFixture();
    const abort = new AbortController();
    abort.abort();
    const enter = vi.fn(() => Promise.resolve());

    await expect(
      fixture.service.callDetailed(
        'provider-1',
        'light_get_state',
        { resourceId: 'living-room-main-light' },
        undefined,
        {
          taskId: 'task-deterministic-1',
          contextId: 'context-deterministic-1',
          providerBindingId: 'binding-provider-1',
          providerId: 'external-provider-1',
          preTransportFence: {
            invocationId: 'invocation-deterministic-1',
            signal: abort.signal,
            enter,
          },
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(enter).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it('blocks availability for a disabled Server before decrypt or Provider transport', async () => {
    const fixture = createFixture({ serverStatus: 'disabled' });

    await expect(
      fixture.service.checkTaskAvailability({
        serverId: 'provider-1',
        requests: [],
        executionContext: LIVE_RUNTIME_EXECUTION_CONTEXT,
      }),
    ).resolves.toEqual({ kind: 'provider_protocol', errorCode: 'MCP_SERVER_NOT_ENABLED' });
    expect(fixture.repository.protocolSnapshotReads).toBe(0);
    expect(fixture.decrypt).not.toHaveBeenCalled();
    expect(fixture.checkAvailability).not.toHaveBeenCalled();
    expect(fixture.repository.invocations).toEqual([]);
  });

  it.each([
    ['catalog drift', { bindingCatalogChecksum: 'f'.repeat(64) }],
    ['endpoint drift', { bindingEndpoint: 'https://stale-provider.test/mcp' }],
    ['stale Binding', { bindingAvailabilityValidUntil: '2026-08-11T00:59:59.000Z' }],
  ])(
    'blocks availability for %s before decrypt or Provider transport',
    async (_case, fixtureOptions) => {
      const fixture = createFixture(fixtureOptions);

      await expect(
        fixture.service.checkTaskAvailability({
          serverId: 'provider-1',
          requests: [],
          executionContext: LIVE_RUNTIME_EXECUTION_CONTEXT,
        }),
      ).resolves.toEqual({
        kind: 'provider_protocol',
        errorCode: 'MCP_PROVIDER_BINDING_NOT_CURRENT',
      });
      expect(fixture.decrypt).not.toHaveBeenCalled();
      expect(fixture.checkAvailability).not.toHaveBeenCalled();
      expect(fixture.repository.invocations).toEqual([]);
    },
  );
});

function createFixture(
  options: Readonly<{
    serverStatus?: McpServer['status'];
    protocolSnapshot?: McpProtocolDiscoverySnapshot | undefined;
    outcome?: McpInvocationOutcome;
    callError?: Error;
    order?: string[];
    bindingEndpoint?: string;
    bindingCatalogRevision?: string;
    bindingCatalogChecksum?: string;
    bindingOperationCount?: number;
    bindingProviderId?: string;
    bindingAvailabilityValidUntil?: string;
    providerBindingsConfigured?: boolean;
    currentBinding?: () => Readonly<{
      revision?: number;
      providerId?: string;
      bindingId?: string;
      endpoint?: string;
      catalogRevision?: string;
      catalogChecksum?: string;
      bindingAvailabilityValidUntil?: string;
      observedAt?: string;
      originType?: 'direct' | 'smpp_registry';
      externalServerId?: string;
      smppSourceId?: string;
    }>;
    toolName?: string;
    toolEffect?: McpTool['executionSemantics']['effect'];
    toolExecution?: McpTool['executionSemantics']['execution'];
    toolIdempotency?: McpTool['executionSemantics']['idempotency'];
    taskBehavior?: NonNullable<McpTool['taskExecutionProfile']>['taskBehavior'];
    executionModeHeaderPolicy?: 'emit' | 'omit_live';
  }> = {},
) {
  const order = options.order ?? [];
  const serverValue = server(options.serverStatus ?? 'enabled');
  const toolValue = tool(
    options.toolName ??
      (options.toolEffect === undefined || options.toolEffect === 'read_only'
        ? 'light_get_state'
        : 'light_set_state'),
    options.toolEffect,
    options.toolExecution,
    options.toolIdempotency,
    options.taskBehavior,
  );
  const snapshotValue = Object.prototype.hasOwnProperty.call(options, 'protocolSnapshot')
    ? options.protocolSnapshot
    : protocolSnapshot();
  const repository = new MemoryMcpRegistryRepository(serverValue, toolValue, snapshotValue, order);
  const catalogAuthority =
    snapshotValue === undefined
      ? { catalogRevision: 'unknown:1', catalogChecksum: '0'.repeat(64), operationCount: 1 }
      : deriveFrozenMcpCatalogAuthority(snapshotValue, [toolValue], serverValue.toolRevision);
  const call = vi.fn<FrozenTaskLifecycleRuntimePort['call']>(() => {
    order.push('provider-call');
    if (options.callError !== undefined) return Promise.reject(options.callError);
    return Promise.resolve(options.outcome ?? immediateOutcome());
  });
  const get = vi.fn<FrozenTaskLifecycleRuntimePort['get']>((input) =>
    Promise.resolve({
      remoteTaskId: input.remoteTaskId,
      status: 'working',
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
      ttlMs: 60_000,
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'tasks-v1',
      runtimeRevision: 'runtime-1',
    }),
  );
  const checkAvailability = vi.fn<FrozenTaskAvailabilityRuntimePort['check']>(() =>
    Promise.resolve({
      kind: 'results',
      protocolRevision: '2026-07-28',
      availabilitySchemaRevision: '1.0',
      results: [],
    }),
  );
  const decrypt = vi.fn(() => ({ authorization: 'Bearer provider-secret' }));
  const controlAuthority = vi.fn((input: GovernedControlInvocation) => {
    order.push('control-authority');
    return Promise.resolve({
      confirmationId: 'confirmation-control-1',
      providerBindingId: input.providerBindingId,
      argumentsHash: governedControlSnapshotHash(input.arguments),
      invocationId: input.invocationId,
      dispatchHash: input.dispatchHash,
      consumedAt: timestamp,
    });
  });
  const service = new McpRegistryService({
    repository,
    cipher: {
      encrypt: () => 'encrypted',
      decrypt,
    },
    frozenAvailability: { check: checkAvailability },
    schemas: {
      checkSchema: () => ({ valid: true, errors: [] }),
      validate: () => ({ valid: true, errors: [] }),
    },
    frozenLifecycle: {
      call,
      get,
      update: () => Promise.reject(new Error('unused')),
      cancel: () => Promise.reject(new Error('unused')),
    },
    controlAuthority: { authorizeAndConsume: controlAuthority },
    ...(options.executionModeHeaderPolicy === undefined
      ? {}
      : { executionModeHeaderPolicy: options.executionModeHeaderPolicy }),
    ...(options.providerBindingsConfigured === false
      ? {}
      : {
          providerBindings: {
            loadCurrentMcpProviderBinding: (input: {
              bindingId?: string;
              localServerId: string;
            }) => {
              order.push('binding-authority');
              const current = options.currentBinding?.() ?? {};
              const originType = current.originType ?? 'smpp_registry';
              const externalServerId = current.externalServerId ?? 'external-server-1';
              return Promise.resolve({
                observedAt: current.observedAt ?? timestamp,
                binding: {
                  bindingId: current.bindingId ?? input.bindingId ?? 'binding-provider-1',
                  revision: current.revision ?? 1,
                  localServerId: input.localServerId,
                  originType,
                  providerId:
                    current.providerId ?? options.bindingProviderId ?? 'external-provider-1',
                  ...(originType === 'direct' ? {} : { externalServerId }),
                  endpointRef:
                    current.endpoint ?? options.bindingEndpoint ?? 'https://provider.test/mcp',
                  catalogRevision:
                    current.catalogRevision ??
                    options.bindingCatalogRevision ??
                    catalogAuthority.catalogRevision,
                  catalogChecksum:
                    current.catalogChecksum ??
                    options.bindingCatalogChecksum ??
                    catalogAuthority.catalogChecksum,
                  operationCount: options.bindingOperationCount ?? catalogAuthority.operationCount,
                  availabilityStatus: 'available' as const,
                  availabilityValidUntil:
                    current.bindingAvailabilityValidUntil ??
                    options.bindingAvailabilityValidUntil ??
                    '2026-08-11T02:00:00.000Z',
                },
                ...(originType === 'direct'
                  ? {}
                  : {
                      sourceCandidateLineage: {
                        smppSourceId: current.smppSourceId ?? 'smpp-source-1',
                        externalServerId,
                      },
                    }),
              });
            },
          },
        }),
    clock: { now: () => timestamp },
    ids: {
      nextInvocationId: () => 'invocation-1',
      nextManagementOperationId: () => 'operation-1',
    },
  });
  return { call, get, checkAvailability, controlAuthority, decrypt, repository, service };
}

class MemoryMcpRegistryRepository implements McpRegistryRepository {
  readonly invocations: McpInvocation[] = [];
  protocolSnapshotReads = 0;
  readonly #record: McpServerRecord;
  readonly #tool: McpTool;
  readonly #snapshot: McpProtocolDiscoverySnapshot | undefined;
  readonly #order: string[];

  constructor(
    serverValue: McpServer,
    toolValue: McpTool,
    snapshotValue: McpProtocolDiscoverySnapshot | undefined,
    order: string[],
  ) {
    this.#record = { server: serverValue, encryptedCredential: 'encrypted' };
    this.#tool = toolValue;
    this.#snapshot = snapshotValue;
    this.#order = order;
  }

  findServer(serverId: string) {
    return Promise.resolve(serverId === this.#record.server.serverId ? this.#record : undefined);
  }
  listServers() {
    return Promise.resolve([this.#record.server]);
  }
  listTools(serverId: string) {
    return Promise.resolve(serverId === this.#tool.serverId ? [this.#tool] : []);
  }
  findCurrentProtocolSnapshot() {
    this.protocolSnapshotReads += 1;
    this.#order.push('frozen-authority');
    return Promise.resolve(this.#snapshot);
  }
  saveServerAndReplaceTools() {
    return Promise.resolve();
  }
  deleteServer() {
    return Promise.resolve();
  }
  saveInvocation(invocation: McpInvocation) {
    this.invocations.push(invocation);
    return Promise.resolve();
  }
  listInvocations(serverId: string) {
    return Promise.resolve(this.invocations.filter((item) => item.serverId === serverId));
  }
  listInvocationsByTask(taskId: string) {
    return Promise.resolve(this.invocations.filter((item) => item.taskId === taskId));
  }
  saveManagementOperation() {
    return Promise.resolve();
  }
  listManagementOperations(): Promise<readonly McpManagementOperation[]> {
    return Promise.resolve([]);
  }
  listDependencyWarnings(): Promise<readonly McpDependencyWarning[]> {
    return Promise.resolve([]);
  }
  updateToolEnhancement() {
    return Promise.resolve();
  }
  updateToolExecutionSemantics() {
    return Promise.resolve(false);
  }
}

function server(status: McpServer['status']): McpServer {
  return {
    serverId: 'provider-1',
    name: 'Provider 1',
    endpoint: 'https://provider.test/mcp',
    transport: 'streamable_http',
    status,
    toolRevision: 1,
    protocolMode: 'frozen_v1',
    currentProtocolSnapshotId: 'snapshot-1',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function tool(
  toolName = 'light_get_state',
  effect: McpTool['executionSemantics']['effect'] = 'read_only',
  execution: McpTool['executionSemantics']['execution'] = 'synchronous',
  idempotency: McpTool['executionSemantics']['idempotency'] = 'none',
  taskBehavior: NonNullable<McpTool['taskExecutionProfile']>['taskBehavior'] = 'synchronous_only',
): McpTool {
  return {
    serverId: 'provider-1',
    toolName,
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: { type: 'object' },
    protocolMode: 'frozen_v1',
    executionSemantics: {
      effect,
      execution,
      cancellation: 'unsupported',
      idempotency,
      replay: 'allowed',
      source: 'mcp_declared',
    },
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior,
      availability: taskBehavior === 'task_required' ? 'dynamic' : 'not_supported',
      supportsScheduling: taskBehavior === 'task_required',
      supportsMaxElapsed: taskBehavior === 'task_required',
      supportsObservations: taskBehavior === 'task_required',
      supportsInputRequired: false,
      idempotency,
    },
    discoveredAt: timestamp,
  };
}

function protocolSnapshot(): McpProtocolDiscoverySnapshot {
  return {
    snapshotId: 'snapshot-1',
    serverId: 'provider-1',
    protocolMode: 'frozen_v1',
    protocolVersion: '2026-07-28',
    baselineSha256: 'a'.repeat(64),
    supportedVersions: ['2026-07-28'],
    capabilities: {},
    serverInfo: { name: 'Provider 1', version: '1.0.0' },
    taskNotifications: false,
    discoveredAt: timestamp,
    toolRevision: 1,
  };
}

function immediateOutcome(overrides: Readonly<Record<string, unknown>> = {}): McpInvocationOutcome {
  return {
    kind: 'immediate',
    result: {
      content: [],
      structuredContent: { resourceId: 'living-room-main-light', state: 'off' },
      isError: false,
      evidence: [],
      ...overrides,
    },
  };
}

function remoteTaskOutcome(): McpInvocationOutcome {
  return {
    kind: 'remote_task',
    task: {
      protocolMode: 'frozen_v1',
      remoteTaskId: 'remote-task-read-1',
      status: 'working',
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
      ttlMs: 60_000,
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'tasks-v1',
      runtimeRevision: 'runtime-1',
    },
  };
}
