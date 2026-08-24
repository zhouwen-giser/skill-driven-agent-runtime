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
