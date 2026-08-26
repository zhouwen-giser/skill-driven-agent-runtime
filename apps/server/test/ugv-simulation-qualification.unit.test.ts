import { createMcpProviderDispatchHash } from '../../../packages/application/src/mcp-registry.js';
import { UgvLiveQualificationService } from '../src/ugv-live-qualification.js';
import type {
  McpRegistryService,
  RuntimeCapabilityResolution,
  UgvLiveQualificationRecord,
  UgvLiveQualificationStore,
} from '../../../packages/application/src/index.js';
import type { RemoteTaskAuthoritySnapshot } from '../../../packages/domain/src/index.js';
import { describe, expect, it, vi } from 'vitest';

import type { McpInvocation } from '../../../packages/domain/src/index.js';
import { UgvSimulationQualificationService } from '../src/ugv-simulation-qualification.js';

const SIMULATION_ID = 'uap-p3-b02-run-00000001';
const SERVER_ID = 'ugv-runtime-1';
const PROVIDER_BINDING_ID = 'binding-ugv-runtime-1';
const PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const NOW = '2026-08-21T12:00:02.000Z';
const INITIAL_POSITION = Object.freeze({ longitude: 106.813_980_425_914_1, latitude: 29.720_4 });

describe('UGV simulation qualification service', () => {
  it('serializes concurrent capture, makes one fixed taskless state read, and returns its PG receipt', async () => {
    const invocations: McpInvocation[] = [];
    const callDetailed = vi.fn(
      (
        serverId: string,
        toolName: string,
        arguments_: Readonly<Record<string, unknown>>,
        signal: AbortSignal | undefined,
        context: Readonly<Record<string, unknown>>,
      ) => {
        void [serverId, toolName, arguments_, signal, context];
        const receipt = qualificationReceipt();
        invocations.push(receipt);
        return Promise.resolve({
          invocationId: receipt.invocationId,
          outcome: { kind: 'immediate' as const, result: receipt.result },
        });
      },
    );
    const listInvocations = vi.fn(() => Promise.resolve(Object.freeze([...invocations])));
    const service = qualificationService({ callDetailed, listInvocations });

    const [first, replay] = await Promise.all([
      service.capture({ simulationId: SIMULATION_ID }),
      service.capture({ simulationId: SIMULATION_ID }),
    ]);

    expect(first).toEqual(replay);
    expect(first).toEqual({
      simulationId: SIMULATION_ID,
      invocationId: 'qualification-invocation-1',
      resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      completedAt: '2026-08-21T12:00:01.000Z',
      observedAt: '2026-08-21T12:00:01.000Z',
      revision: 'd'.repeat(64),
      mqttIngressSequence: 42,
      serverId: SERVER_ID,
      providerBindingId: PROVIDER_BINDING_ID,
      providerId: PROVIDER_ID,
      operationName: 'vehicle_get_state',
      resourceId: 'vehicle:ugv1',
      sourcePosition: INITIAL_POSITION,
    });
    expect(callDetailed).toHaveBeenCalledOnce();
    expect(callDetailed).toHaveBeenCalledWith(
      SERVER_ID,
      'vehicle_get_state',
      { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
      undefined,
      {
        providerBindingId: PROVIDER_BINDING_ID,
        providerId: PROVIDER_ID,
        executionContext: { mode: 'simulation', simulationId: SIMULATION_ID },
      },
    );
    expect(listInvocations).toHaveBeenCalledTimes(3);
  });

  it('reuses one still-fresh persisted receipt after a lost response without another Tool call', async () => {
    const callDetailed = vi.fn();
    const service = qualificationService({
      callDetailed,
      listInvocations: vi.fn(() => Promise.resolve([qualificationReceipt()])),
    });

    await expect(service.capture({ simulationId: SIMULATION_ID })).resolves.toMatchObject({
      invocationId: 'qualification-invocation-1',
    });
    expect(callDetailed).not.toHaveBeenCalled();
  });

  it('fails closed for duplicate or stale receipts and never redispatches', async () => {
    for (const fixture of [
      {
        now: NOW,
        invocations: [
          qualificationReceipt(),
          qualificationReceipt({ invocationId: 'qualification-invocation-2' }),
        ],
        code: 'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT',
      },
      {
        now: '2026-08-21T12:00:04.001Z',
        invocations: [qualificationReceipt()],
        code: 'UGV_SIMULATION_QUALIFICATION_RECEIPT_STALE',
      },
    ]) {
      const callDetailed = vi.fn();
      const service = qualificationService({
        callDetailed,
        listInvocations: vi.fn(() => Promise.resolve(fixture.invocations)),
        now: fixture.now,
      });
      await expect(service.capture({ simulationId: SIMULATION_ID })).rejects.toMatchObject({
        code: fixture.code,
        status: 409,
      });
      expect(callDetailed).not.toHaveBeenCalled();
    }
  });

  it('rejects newly persisted task-bound or wrong-Provider receipts and fences the run', async () => {
    for (const invalidReceipt of [
      qualificationReceipt({ taskId: 'task-forbidden' }),
      qualificationReceipt({ providerId: 'isr.vehicle.ugv.other' }),
    ]) {
      const invocations: McpInvocation[] = [];
      const callDetailed = vi.fn(() => {
        invocations.push(invalidReceipt);
        return Promise.resolve({
          invocationId: invalidReceipt.invocationId,
          outcome: { kind: 'immediate' as const, result: invalidReceipt.result },
        });
      });
      const service = qualificationService({
        callDetailed,
        listInvocations: vi.fn(() => Promise.resolve([...invocations])),
      });

      await expect(service.capture({ simulationId: SIMULATION_ID })).rejects.toMatchObject({
        code: 'UGV_SIMULATION_QUALIFICATION_RECEIPT_INVALID',
        status: 502,
      });
      await expect(service.capture({ simulationId: SIMULATION_ID })).rejects.toMatchObject({
        code: 'UGV_SIMULATION_QUALIFICATION_RECEIPT_INVALID',
        status: 409,
      });
      expect(callDetailed).toHaveBeenCalledOnce();
    }
  });

  it('never redispatches after a successful call whose PG receipt is missing or duplicated', async () => {
    for (const afterCall of [
      Object.freeze([]),
      Object.freeze([
        qualificationReceipt(),
        qualificationReceipt({ invocationId: 'qualification-invocation-2' }),
      ]),
    ]) {
      const callDetailed = vi.fn(() =>
        Promise.resolve({
          invocationId: 'qualification-invocation-1',
          outcome: { kind: 'immediate' as const, result: qualificationResult() },
        }),
      );
      const listInvocations = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(afterCall)
        .mockResolvedValue(afterCall);
      const service = qualificationService({ callDetailed, listInvocations });

      await expect(service.capture({ simulationId: SIMULATION_ID })).rejects.toMatchObject({
        code: 'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT',
        status: 409,
      });
      await expect(service.capture({ simulationId: SIMULATION_ID })).rejects.toMatchObject({
        code: 'UGV_SIMULATION_QUALIFICATION_RECEIPT_CONFLICT',
        status: 409,
      });
      expect(callDetailed).toHaveBeenCalledOnce();
    }
  });

  it('passes resolved Provider binding authority to the registry and propagates drift', async () => {
    const error = Object.assign(new Error('Current Provider Binding differs.'), {
      code: 'MCP_PROVIDER_BINDING_NOT_CURRENT',
    });
    const callDetailed = vi.fn(() => Promise.reject(error));
    const service = qualificationService({
      callDetailed,
      listInvocations: vi.fn(() => Promise.resolve([])),
      resolveQualificationAuthority: vi.fn(() =>
        Promise.resolve({
          serverId: SERVER_ID,
          providerBindingId: 'wrong-provider-binding',
          providerId: PROVIDER_ID,
        }),
      ),
    });

    await expect(service.capture({ simulationId: SIMULATION_ID })).rejects.toBe(error);
    expect(callDetailed).toHaveBeenCalledWith(
      SERVER_ID,
      'vehicle_get_state',
      { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
      undefined,
      expect.objectContaining({ providerBindingId: 'wrong-provider-binding' }),
    );
  });

  it('rejects caller-controlled run identities before resolving Provider authority', async () => {
    const resolveQualificationAuthority = vi.fn();
    const service = qualificationService({
      callDetailed: vi.fn(),
      listInvocations: vi.fn(),
      resolveQualificationAuthority,
    });

    await expect(service.capture({ simulationId: 'sim-other' })).rejects.toMatchObject({
      code: 'UGV_SIMULATION_QUALIFICATION_ID_INVALID',
      status: 400,
    });
    expect(resolveQualificationAuthority).not.toHaveBeenCalled();
  });
});

function qualificationService(
  input: Readonly<{
    callDetailed: ReturnType<typeof vi.fn>;
    listInvocations: ReturnType<typeof vi.fn>;
    resolveQualificationAuthority?: ReturnType<typeof vi.fn>;
    now?: string;
  }>,
) {
  return new UgvSimulationQualificationService({
    registry: {
      callDetailed: input.callDetailed as never,
      listInvocations: input.listInvocations as never,
    },
    authority: {
      resolveQualificationAuthority: (input.resolveQualificationAuthority ??
        vi.fn(() =>
          Promise.resolve({
            serverId: SERVER_ID,
            providerBindingId: PROVIDER_BINDING_ID,
            providerId: PROVIDER_ID,
          }),
        )) as never,
    },
    clock: { now: () => input.now ?? NOW },
  });
}

function qualificationReceipt(
  options: Readonly<{ invocationId?: string; taskId?: string; providerId?: string }> = {},
): McpInvocation {
  return Object.freeze({
    invocationId: options.invocationId ?? 'qualification-invocation-1',
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    serverId: SERVER_ID,
    toolName: 'vehicle_get_state',
    executionSemantics: Object.freeze({
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: 'allowed',
      source: 'admin_override',
    }),
    arguments: Object.freeze({
      resourceId: 'vehicle:ugv1',
      include: Object.freeze(['chassis', 'health']),
    }),
    result: qualificationResult(options.providerId),
    status: 'succeeded',
    startedAt: '2026-08-21T12:00:00.800Z',
    completedAt: '2026-08-21T12:00:01.000Z',
    durationMs: 200,
  });
}

function qualificationResult(providerId = PROVIDER_ID) {
  return Object.freeze({
    content: Object.freeze([]),
    isError: false,
    structuredContent: Object.freeze({
      identity: Object.freeze({
        providerId,
        resourceId: 'vehicle:ugv1',
        vehicleType: 'ugv',
        executionMode: 'simulation',
      }),
      connectivity: Object.freeze({
        mqttConnected: true,
        deviceMcpConnected: true,
        deviceAvailable: true,
      }),
      freshness: Object.freeze({
        chassisObservedAt: '2026-08-21T12:00:01.000Z',
        healthObservedAt: '2026-08-21T12:00:01.000Z',
      }),
      chassis: Object.freeze({
        position: INITIAL_POSITION,
        speedKmh: 0,
        mission: Object.freeze({ state: 4 }),
      }),
      health: Object.freeze({
        chassisErrorCodes: Object.freeze([]),
        payloadErrorCodes: Object.freeze([]),
        components: Object.freeze({
          communications: 'normal',
          gnss: 'normal',
          navigation: 'normal',
        }),
      }),
      revision: 'd'.repeat(64),
      observedAt: '2026-08-21T12:00:01.000Z',
      mqttIngressSequence: 42,
    }),
  });
}

describe('UGV durable LIVE qualification', () => {
  it('freezes the actual pre-transport snapshot and recovers the exact receipt after restart', async () => {
    const f = liveFixture();
    const receipt = await f.service().capture(f.request);
    expect(receipt).toMatchObject({
      requestId: 'live-request-1',
      executionContext: { mode: 'live' },
      invocationId: 'qualification-invocation-1',
    });
    expect(f.record()?.authoritySnapshot).toEqual(f.snapshot());
    expect(f.invocation()?.simulationId).toBeUndefined();
    expect(f.invocation()?.result).toEqual(liveReceipt().result);
    f.setNow('2026-08-21T12:01:00.000Z');
    await expect(f.service().capture(f.request)).resolves.toEqual(receipt);
    expect(f.call).toHaveBeenCalledOnce();
    await expect(f.service().prepareAcceptance(f.acceptance(receipt))).rejects.toMatchObject({
      code: 'UGV_MOVE_SKILL_USAGE_QUALIFICATION_STALE',
    });
  });
  it('only one concurrent request reserves transport', async () => {
    const f = liveFixture();
    const results = await Promise.allSettled([
      f.service().capture(f.request),
      f.service().capture(f.request),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(f.call).toHaveBeenCalledOnce();
  });
  it.each(['missing', 'throw'] as const)(
    'never redispatches a %s durable result after restart',
    async (failure) => {
      const f = liveFixture(failure);
      await expect(f.service().capture(f.request)).rejects.toBeInstanceOf(Error);
      await expect(f.service().capture(f.request)).rejects.toMatchObject({
        code: 'UGV_LIVE_QUALIFICATION_INVALID',
      });
      expect(f.record()?.status).toBe('uncertain');
      expect(f.call).toHaveBeenCalledOnce();
    },
  );
  it.each(['', undefined, 'simulation-elsewhere'])(
    'rejects every supplied simulationId before reserving: %s',
    async (simulationId) => {
      const f = liveFixture();
      const malformedRequest = {
        ...f.request,
        executionContext: { mode: 'live' as const, simulationId },
      };
      await expect(f.service().capture(malformedRequest)).rejects.toMatchObject({
        code: 'UGV_LIVE_QUALIFICATION_INVALID',
      });
      expect(f.record()).toBeUndefined();
      expect(f.call).not.toHaveBeenCalled();
    },
  );
  it('freezes only an exact reference, rejects changed hashes/bindings, and reloads the same frozen constraint', async () => {
    const f = liveFixture();
    const receipt = await f.service().capture(f.request);
    const acceptance = f.acceptance(receipt);
    const constraints = await f.service().prepareAcceptance(acceptance);
    const constraint = constraints[0];
    if (constraint === undefined) throw new Error('constraint required');
    expect(constraint).toMatchObject({
      type: 'ugv_live_qualification',
      invocationId: receipt.invocationId,
      authoritySnapshot: f.snapshot(),
    });
    await expect(f.service().loadConstraint(constraint, NOW, NOW)).resolves.toEqual(f.invocation());
    await expect(
      f.service().prepareAcceptance({ ...acceptance, metadata: {} }),
    ).rejects.toMatchObject({ code: 'UGV_LIVE_QUALIFICATION_INVALID' });
    await expect(
      f.service().prepareAcceptance({
        ...acceptance,
        metadata: {
          'io.sdar/ugvQualification': {
            requestId: receipt.requestId,
            invocationId: receipt.invocationId,
            resultHash: `sha256:${'0'.repeat(64)}`,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'UGV_LIVE_QUALIFICATION_INVALID' });
    f.changeBinding();
    await expect(f.service().prepareAcceptance(acceptance)).rejects.toMatchObject({
      code: 'UGV_LIVE_QUALIFICATION_INVALID',
    });
    expect(f.call).toHaveBeenCalledOnce();
  });
  it('does not manufacture a remote mode and still rejects an explicitly wrong remote mode', async () => {
    const f = liveFixture();
    await f.service().capture(f.request);
    expect(
      (f.invocation()?.result as ReturnType<typeof qualificationResult>).structuredContent.identity,
    ).not.toHaveProperty('executionMode');
    const bad = liveFixture('wrong-mode');
    await expect(bad.service().capture(bad.request)).rejects.toMatchObject({
      code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED',
    });
  });
});

function liveReceipt(): McpInvocation {
  const { simulationId, ...receipt } = qualificationReceipt();
  void simulationId;
  const result = qualificationResult();
  const { executionMode, ...identity } = result.structuredContent.identity;
  void executionMode;
  return {
    ...receipt,
    executionMode: 'live',
    result: { ...result, structuredContent: { ...result.structuredContent, identity } },
  };
}
function liveSnapshot(): RemoteTaskAuthoritySnapshot {
  return {
    schemaVersion: '1.0',
    capturedAt: '2026-08-21T12:00:00.800Z',
    runtime: {
      serverId: SERVER_ID,
      endpoint: 'http://provider.test/mcp',
      serverUpdatedAt: NOW,
      toolRevision: 1,
      protocolSnapshotId: 'snapshot-1',
      catalogRevision: '1',
      catalogChecksum: 'c'.repeat(64),
      operationCount: 10,
    },
    providerBinding: {
      bindingId: PROVIDER_BINDING_ID,
      revision: 1,
      providerId: PROVIDER_ID,
      endpointRef: 'http://provider.test/mcp',
      catalogRevision: '1',
      catalogChecksum: 'c'.repeat(64),
      operationCount: 10,
      availabilityValidUntil: '2026-08-21T12:05:00.000Z',
      observedAt: NOW,
      originType: 'smpp_registry',
      externalServerId: 'external-server',
      smppSourceId: 'source-configured',
      registry: { externalProviderId: PROVIDER_ID, revision: '1', checksum: 'd'.repeat(64) },
      scope: { tenantId: 'tenant', projectId: 'project', environment: 'development' },
    },
  };
}
function liveFixture(failure?: 'missing' | 'throw' | 'wrong-mode') {
  let record: UgvLiveQualificationRecord | undefined;
  let invocation: McpInvocation | undefined;
  let snapshot = liveSnapshot();
  let now = NOW;
  const store: UgvLiveQualificationStore = {
    reserve: (input) => {
      if (record !== undefined) return Promise.resolve(false);
      record = { ...input, executionContext: { mode: 'live' }, status: 'dispatching' };
      return Promise.resolve(true);
    },
    freezeDispatch: (input) => {
      if (record === undefined) throw new Error('no reservation');
      record = {
        ...record,
        authoritySnapshot: input.authoritySnapshot,
        dispatchHash: input.dispatchHash,
      };
      return Promise.resolve();
    },
    complete: (_id, _inv, resultHash) => {
      if (record === undefined) throw new Error('no reservation');
      record = { ...record, status: 'completed', resultHash };
      return Promise.resolve();
    },
    markUncertain: () => {
      if (record?.status === 'dispatching') record = { ...record, status: 'uncertain' };
      return Promise.resolve();
    },
    load: () =>
      Promise.resolve(
        record === undefined
          ? undefined
          : { record, ...(invocation === undefined ? {} : { invocation }) },
      ),
  };
  const call = vi.fn<McpRegistryService['callDetailed']>(
    async (_server, _tool, _args, _signal, context) => {
      if (context?.preTransportFence === undefined) throw new Error('fence required');
      await context.preTransportFence.enter({
        dispatchId: context.preTransportFence.invocationId,
        dispatchHash: createMcpProviderDispatchHash({
          invocationId: context.preTransportFence.invocationId,
          serverId: SERVER_ID,
          toolName: 'vehicle_get_state',
          arguments: liveReceipt().arguments,
          providerBindingId: PROVIDER_BINDING_ID,
          providerId: PROVIDER_ID,
        }),
        authoritySnapshot: snapshot,
      });
      expect(record?.authoritySnapshot).toEqual(snapshot); // before injected transport result
      if (failure === 'throw') throw new Error('transport uncertain');
      if (failure !== 'missing')
        invocation =
          failure === 'wrong-mode'
            ? { ...liveReceipt(), result: qualificationResult() }
            : liveReceipt();
      return {
        invocationId: 'qualification-invocation-1',
        outcome: {
          kind: 'immediate',
          result: liveReceipt().result as ReturnType<typeof qualificationResult>,
        },
        completedAt: NOW,
        credentialRevision: '1',
        sessionRevision: '1',
        authoritySnapshot: snapshot,
      };
    },
  );
  const service = () =>
    new UgvLiveQualificationService({
      store,
      registry: { callDetailed: call },
      authority: {
        resolveQualificationAuthority: () =>
          Promise.resolve({
            serverId: SERVER_ID,
            providerBindingId: PROVIDER_BINDING_ID,
            providerId: PROVIDER_ID,
            authoritySnapshot: snapshot,
          }),
      },
      clock: { now: () => now },
      nextInvocationId: () => 'qualification-invocation-1',
    });
  const request = { requestId: 'live-request-1', executionContext: { mode: 'live' as const } };
  return {
    service,
    request,
    call,
    record: () => record,
    invocation: () => invocation,
    snapshot: () => snapshot,
    setNow: (value: string) => {
      now = value;
    },
    changeBinding: () => {
      snapshot = { ...snapshot, runtime: { ...snapshot.runtime, toolRevision: 2 } };
    },
    acceptance: (receipt: Awaited<ReturnType<UgvLiveQualificationService['capture']>>) => ({
      requestId: request.requestId,
      metadata: {
        'io.sdar/ugvQualification': {
          requestId: receipt.requestId,
          invocationId: receipt.invocationId,
          resultHash: receipt.resultHash,
        },
      },
      boundAt: NOW,
      resolution: {
        requestedCapabilityId: 'embodied.move',
        capabilityVersion: 2,
        exposureId: 'a2a.embodied.move',
        exposureVersion: 2,
        requestSchema: {},
        successCriteria: [],
        requiredEvidence: [],
        implementationRefs: ['skill:embodied.move_to:1'],
        providerBindingRefs: [PROVIDER_BINDING_ID],
        constraints: [
          { type: 'runtime_execution_mode_policy', mode: 'live' },
          {
            type: 'provider_binding_policy',
            localServerId: SERVER_ID,
            mcpProviderBindingId: PROVIDER_BINDING_ID,
          },
        ],
      } satisfies RuntimeCapabilityResolution,
    }),
  };
}
