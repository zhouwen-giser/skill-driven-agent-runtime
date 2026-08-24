import { Task, TaskState } from '@a2a-js/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  createUgvB02PreparedMove,
  deriveUgvB02AdmissionIdempotencyKey,
  sha256,
  type UgvB02ProviderLedger,
} from '../src/ugv-agent-profile-a2a-move-contract.js';
import {
  UGV_B02_TERMINAL_SUMMARY,
  assertUgvB02TerminalProjection,
  observeUgvB02Move,
  observeUgvB02TerminalBoundary,
  prepareUgvB02Move,
  reconcileUgvB02ProviderSafety,
  type UgvB02A2AClient,
  type UgvB02MoveConfiguration,
} from '../src/ugv-agent-profile-a2a-move-driver.js';

const SIMULATION_ID = 'uap-p3-b02-driver-run-0001';
const TASK_ID = 'task-1';
const CONTEXT_ID = 'context-1';
const TARGET = Object.freeze({ x: 106.8134463, y: 29.72034353, frame: 'WGS84' as const });

describe('UAP-P3-B02 driver safety', () => {
  it.each([
    ['rogue A2A port', { a2aBaseUrl: 'http://127.0.0.1:11000' }],
    ['localhost alias', { a2aBaseUrl: 'http://localhost:10999' }],
    ['HTTPS alias', { runtimeManagementBaseUrl: 'https://127.0.0.1:10998' }],
    ['rogue Management port', { runtimeManagementBaseUrl: 'http://127.0.0.1:11098' }],
    ['rogue Node Control port', { nodeControlBaseUrl: 'http://127.0.0.1:10191' }],
    ['wrong simulation identity', { simulationId: 'uap-p3-b02-wrong-run-9999' }],
  ] as const)('rejects %s before client creation or HTTP', async (_name, drift) => {
    const request = vi.fn<typeof fetch>();
    const createA2AClient = vi.fn();
    const input = { ...configuration(), ...drift };
    await expect(
      prepareUgvB02Move(
        { ...input, preLedger: emptyLedger('2026-08-21T12:00:00.000Z') },
        { fetch: request, createA2AClient },
      ),
    ).rejects.toBeDefined();
    expect(request).not.toHaveBeenCalled();
    expect(createA2AClient).not.toHaveBeenCalled();
  });

  it('sends the unique initial admission once and never retries an ambiguous timeout', async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error('timeout')));
    const getTask = vi.fn();
    const client = { sendMessage, getTask } as unknown as UgvB02A2AClient;
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/a2a-exposures/'))
        return Promise.resolve(
          jsonResponse({
            exposureId: 'a2a.embodied.move',
            version: 2,
            capabilityId: 'embodied.move',
            capabilityVersion: 2,
            agentSkillId: 'embodied.move_to',
            status: 'published',
          }),
        );
      if (url.endsWith('/internal/v1/ugv-agent-profile/qualification-state'))
        return Promise.resolve(jsonResponse(qualification()));
      throw new Error(`unexpected URL: ${url}`);
    });

    await expect(
      prepareUgvB02Move(
        { ...configuration(), preLedger: emptyLedger('2026-08-21T11:59:59.000Z') },
        {
          fetch: request,
          createA2AClient: () => Promise.resolve(client),
          now: () => '2026-08-21T12:00:00.500Z',
          randomId: () => 'random-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'UGV_B02_INITIAL_ADMISSION_AMBIGUOUS_BLOCKED' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(getTask).not.toHaveBeenCalled();
  });

  it('accepts the production Workflow DSL condition and result node types', async () => {
    const sendMessage = vi.fn(() => Promise.resolve(inputRequiredA2aTask()));
    const getTask = vi.fn();
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.includes('/api/v1/a2a-exposures/'))
        return Promise.resolve(
          jsonResponse({
            exposureId: 'a2a.embodied.move',
            version: 2,
            capabilityId: 'embodied.move',
            capabilityVersion: 2,
            agentSkillId: 'embodied.move_to',
            status: 'published',
          }),
        );
      if (url.endsWith('/internal/v1/ugv-agent-profile/qualification-state'))
        return Promise.resolve(jsonResponse(qualification()));
      if (url.endsWith(`/api/v1/tasks/${TASK_ID}`))
        return Promise.resolve(jsonResponse(runtimeTask('awaiting_plan_confirmation')));
      if (url.endsWith('/api/v1/workflows/plans/plan-1'))
        return Promise.resolve(jsonResponse(formalPlan()));
      if (url.includes('/api/v1/mcp/invocations'))
        return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/remote-task-lifecycle'))
        return Promise.resolve(jsonResponse({ items: [] }));
      throw new Error(`unexpected URL: ${url}`);
    });

    const prepared = await prepareUgvB02Move(
      { ...configuration(), preLedger: emptyLedger('2026-08-21T11:59:59.000Z') },
      {
        fetch: request,
        createA2AClient: () => Promise.resolve({ sendMessage, getTask }),
        now: () => '2026-08-21T12:00:00.500Z',
        randomId: () => 'production-dsl',
      },
    );

    expect(prepared.runtime).toMatchObject({
      planId: 'plan-1',
      taskPhase: 'awaiting_plan_confirmation',
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(getTask).not.toHaveBeenCalled();
  });

  it('retains only bounded RFC7807 status/code for qualification diagnosis', async () => {
    const secretDetail = 'private-provider-secret-detail';
    const { error, sendMessage } = await rejectedQualification(
      new Response(
        JSON.stringify({
          type: 'https://errors.sdar.io/provider-authority-stale',
          title: 'Provider authority stale',
          status: 409,
          code: 'MCP_PROVIDER_BINDING_STALE',
          detail: secretDetail,
        }),
        { status: 409, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    expect(error).toMatchObject({
      code: 'UGV_B02_QUALIFICATION_FAILED',
      details: { status: 409, code: 'MCP_PROVIDER_BINDING_STALE' },
    });
    expect(JSON.stringify(error)).not.toContain(secretDetail);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    [
      'malformed',
      new Response('{not-json', {
        status: 503,
        headers: { 'content-type': 'application/problem+json' },
      }),
    ],
    [
      'oversize',
      new Response(
        JSON.stringify({
          status: 503,
          code: 'PROVIDER_UNAVAILABLE',
          detail: `private-${'x'.repeat(9 * 1024)}`,
        }),
        { status: 503, headers: { 'content-type': 'application/problem+json' } },
      ),
    ],
  ] as const)('drops %s qualification problem bodies completely', async (_name, response) => {
    const { error, sendMessage } = await rejectedQualification(response);
    expect(error).toMatchObject({ code: 'UGV_B02_QUALIFICATION_FAILED' });
    expect(error).toHaveProperty('details', undefined);
    expect(JSON.stringify(error)).not.toContain('private-');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('retries transient read failures and still seals the active-to-terminal continuation', async () => {
    let taskReads = 0;
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.endsWith(`/api/v1/tasks/${TASK_ID}`)) {
        taskReads += 1;
        if (taskReads === 1) return Promise.reject(new Error('transient'));
        return Promise.resolve(
          jsonResponse(
            taskReads === 2
              ? runtimeTask('executing')
              : { ...runtimeTask('completed'), output: { text: 'terminal', structured: {} } },
          ),
        );
      }
      if (url.includes('/trace'))
        return Promise.resolve(
          jsonResponse({
            instance: {
              instanceId: 'workflow-instance-1',
              status: taskReads <= 2 ? 'waiting_external' : 'succeeded',
            },
          }),
        );
      if (url.includes('/api/v1/mcp/invocations'))
        return Promise.resolve(jsonResponse({ items: [] }));
      if (url.endsWith('/remote-task-lifecycle'))
        return Promise.resolve(
          jsonResponse(remoteLifecycle(taskReads <= 2 ? 'active' : 'terminal')),
        );
      throw new Error(`unexpected URL: ${url}`);
    });
    const getTask = vi.fn(() => Promise.resolve(terminalA2aTask()));
    const observation = await observeUgvB02TerminalBoundary({
      configuration: { ...configuration(), maxPolls: 5, pollIntervalMs: 10 },
      prepared: preparedMove(),
      client: { getTask, sendMessage: vi.fn() },
      initial: inputRequiredA2aTask(),
      fetch: request,
      pause: () => Promise.resolve(),
    });
    expect(observation.waitingExternalObserved).toBe(true);
    expect(observation.activeContinuation).toEqual({
      snapshotId: 'snapshot-1',
      continuationId: 'continuation-1',
      stateVersion: 1,
    });
    expect(observation.a2a.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(getTask).toHaveBeenCalledTimes(1);
  });

  it('fails closed after bounded persistent read failures without a write or redispatch', async () => {
    const sendMessage = vi.fn();
    const getTask = vi.fn();
    await expect(
      observeUgvB02TerminalBoundary({
        configuration: { ...configuration(), maxPolls: 3, pollIntervalMs: 10 },
        prepared: preparedMove(),
        client: { getTask, sendMessage },
        initial: inputRequiredA2aTask(),
        fetch: vi.fn(() => Promise.reject(new Error('persistent read failure'))),
        pause: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: 'UGV_B02_EXECUTION_AMBIGUOUS_BLOCKED' });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getTask).not.toHaveBeenCalled();
  });

  it.each([
    ['transport ambiguity', 'timeout', 'UGV_B02_EXECUTION_AMBIGUOUS_BLOCKED'],
    ['wrong response Task', 'wrong-task', 'UGV_B02_CONFIRMATION_TASK_MISMATCH'],
  ] as const)(
    'sends confirmation once and safely reconciles %s plus persistent read failure',
    async (_label, outcome, expectedCode) => {
      const plan = formalPlan();
      let taskReads = 0;
      let invocationReads = 0;
      let remoteReads = 0;
      const request = vi.fn<typeof fetch>((input) => {
        const url = requestUrl(input);
        if (url.endsWith(`/api/v1/tasks/${TASK_ID}`)) {
          taskReads += 1;
          return taskReads === 1
            ? Promise.resolve(jsonResponse(runtimeTask('awaiting_plan_confirmation')))
            : Promise.reject(new Error('runtime read unavailable'));
        }
        if (url.endsWith('/api/v1/workflows/plans/plan-1'))
          return Promise.resolve(jsonResponse(plan));
        if (url.includes('/trace')) return Promise.reject(new Error('trace read unavailable'));
        if (url.includes('/api/v1/mcp/invocations')) {
          invocationReads += 1;
          return invocationReads === 1
            ? Promise.resolve(jsonResponse({ items: [] }))
            : Promise.reject(new Error('invocation read unavailable'));
        }
        if (url.endsWith('/remote-task-lifecycle')) {
          remoteReads += 1;
          return remoteReads === 1
            ? Promise.resolve(jsonResponse({ items: [] }))
            : Promise.reject(new Error('remote read unavailable'));
        }
        throw new Error(`unexpected URL: ${url}`);
      });
      let a2aReads = 0;
      const getTask = vi.fn(() => {
        a2aReads += 1;
        return a2aReads === 1
          ? Promise.resolve(inputRequiredA2aTask())
          : Promise.reject(new Error('A2A read unavailable'));
      });
      const sendMessage = vi.fn(() =>
        outcome === 'timeout'
          ? Promise.reject(new Error('confirmation timeout'))
          : Promise.resolve({ ...inputRequiredA2aTask(), id: 'wrong-task' }),
      );
      let ledgerCapture = 0;
      const captureProviderLedger = vi.fn(() => {
        ledgerCapture += 1;
        return Promise.resolve(
          zeroDispatchLedger(`2026-08-21T12:00:${String(ledgerCapture).padStart(2, '0')}.000Z`),
        );
      });
      await expect(
        observeUgvB02Move(
          {
            ...configuration(),
            maxPolls: 1,
            pollIntervalMs: 10,
            ledgerReconciliationMaxPolls: 2,
            prepared: preparedMove(plan),
            preLedger: emptyLedger('2026-08-21T11:59:59.000Z'),
          },
          {
            fetch: request,
            createA2AClient: () =>
              Promise.resolve({ getTask, sendMessage } as unknown as UgvB02A2AClient),
            pause: () => Promise.resolve(),
            captureProviderLedger,
            randomId: () => 'confirmation-message-1',
          },
        ),
      ).rejects.toMatchObject({
        code: expectedCode,
        reconciliation: {
          classification: outcome === 'timeout' ? 'zero_dispatch' : 'manual_unknown',
          attemptCount: 2,
          writesRetried: 0,
        },
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(captureProviderLedger).toHaveBeenCalledTimes(2);
    },
  );

  it('never accepts a wrong confirmation response Task even after the frozen Task reaches terminal', async () => {
    const plan = formalPlan();
    const preLedger = modelConfiguredPreLedger('2026-08-21T11:59:59.000Z');
    const expectedResult = terminalStructuredResult();
    let taskReads = 0;
    let remoteReads = 0;
    let invocationReads = 0;
    const request = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.endsWith(`/api/v1/tasks/${TASK_ID}`)) {
        taskReads += 1;
        if (taskReads === 1)
          return Promise.resolve(jsonResponse(runtimeTask('awaiting_plan_confirmation')));
        if (taskReads === 2) return Promise.resolve(jsonResponse(runtimeTask('executing')));
        return Promise.resolve(
          jsonResponse({
            ...runtimeTask('completed'),
            output: { text: UGV_B02_TERMINAL_SUMMARY, structured: expectedResult },
          }),
        );
      }
      if (url.endsWith('/api/v1/workflows/plans/plan-1'))
        return Promise.resolve(jsonResponse(plan));
      if (url.includes('/trace'))
        return Promise.resolve(
          jsonResponse({
            instance: {
              instanceId: 'workflow-instance-1',
              planId: 'plan-1',
              status: taskReads === 2 ? 'waiting_external' : 'succeeded',
              ...(taskReads === 2 ? {} : { result: expectedResult }),
            },
          }),
        );
      if (url.includes('/api/v1/mcp/invocations')) {
        invocationReads += 1;
        return Promise.resolve(
          jsonResponse({ items: invocationReads === 1 ? [] : terminalTaskInvocations() }),
        );
      }
      if (url.endsWith('/remote-task-lifecycle')) {
        remoteReads += 1;
        if (remoteReads === 1) return Promise.resolve(jsonResponse({ items: [] }));
        return Promise.resolve(
          jsonResponse(remoteReads === 2 ? remoteLifecycle('active') : terminalRemoteLifecycle()),
        );
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    let a2aReads = 0;
    const getTask = vi.fn(() => {
      a2aReads += 1;
      return Promise.resolve(a2aReads === 1 ? inputRequiredA2aTask() : terminalA2aTask());
    });
    const sendMessage = vi.fn(() =>
      Promise.resolve({ ...inputRequiredA2aTask(), id: 'wrong-task' }),
    );
    const captureProviderLedger = vi.fn(() =>
      Promise.resolve(fullTerminalLedger('2026-08-21T12:00:10.000Z', plan.definition)),
    );
    await expect(
      observeUgvB02Move(
        {
          ...configuration(),
          maxPolls: 3,
          pollIntervalMs: 10,
          prepared: preparedMove(plan, preLedger),
          preLedger,
        },
        {
          fetch: request,
          createA2AClient: () =>
            Promise.resolve({ getTask, sendMessage } as unknown as UgvB02A2AClient),
          pause: () => Promise.resolve(),
          captureProviderLedger,
          randomId: () => 'confirmation-message-1',
        },
      ),
    ).rejects.toMatchObject({ code: 'UGV_B02_CONFIRMATION_TASK_MISMATCH' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(captureProviderLedger).toHaveBeenCalledTimes(1);
  });

  it('proves zero dispatch only across the complete ambiguous-confirmation ledger window', async () => {
    const ledgers = [
      zeroDispatchLedger('2026-08-21T12:00:01.000Z'),
      zeroDispatchLedger('2026-08-21T12:00:02.000Z'),
    ];
    const capture = vi.fn((attempt: number) => Promise.resolve(requiredRow(ledgers, attempt - 1)));
    const result = await reconcileUgvB02ProviderSafety({
      preLedger: emptyLedger('2026-08-21T11:59:59.000Z'),
      prepared: preparedMove(),
      confirmationResponseAccepted: false,
      maxPolls: 2,
      pollIntervalMs: 10,
      captureProviderLedger: capture,
      pause: () => Promise.resolve(),
    });
    expect(result).toMatchObject({
      classification: 'zero_dispatch',
      attemptCount: 2,
      writesRetried: 0,
      reason: 'confirmation_not_durably_consumed',
    });
    expect(capture).toHaveBeenCalledTimes(2);

    const accepted = await reconcileUgvB02ProviderSafety({
      preLedger: emptyLedger('2026-08-21T11:59:59.000Z'),
      prepared: preparedMove(),
      confirmationResponseAccepted: true,
      maxPolls: 2,
      pollIntervalMs: 10,
      captureProviderLedger: capture,
      pause: () => Promise.resolve(),
    });
    expect(accepted).toMatchObject({
      classification: 'manual_unknown',
      writesRetried: 0,
    });
  });

  it('keeps reconciling a running Provider task until the unique terminal chain is durable', async () => {
    const running = terminalProviderLedger('2026-08-21T12:00:01.000Z');
    requiredRow(running.runtime.providerTasks, 0)['internalState'] = 'RUNNING';
    requiredRow(running.runtime.providerTasks, 0)['mcpStatus'] = 'working';
    requiredRow(running.adapter.executions, 0)['state'] = 'RUNNING';
    const terminal = terminalProviderLedger('2026-08-21T12:00:02.000Z');
    const capture = vi
      .fn<(attempt: number) => Promise<ReturnType<typeof emptyLedger>>>()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(terminal);
    const result = await reconcileUgvB02ProviderSafety({
      preLedger: emptyLedger('2026-08-21T11:59:59.000Z'),
      prepared: preparedMove(),
      confirmationResponseAccepted: true,
      maxPolls: 5,
      pollIntervalMs: 10,
      captureProviderLedger: capture,
      pause: () => Promise.resolve(),
    });
    expect(result).toMatchObject({
      classification: 'terminal_provider_safe',
      attemptCount: 4,
      navigateInvocationId: 'navigate-invocation-1',
      remoteTaskId: 'remote-task-1',
      writesRetried: 0,
    });
    expect(capture).toHaveBeenCalledTimes(4);
  });

  it('classifies persistent running or unreadable ledgers as manual unknown without writes', async () => {
    const running = terminalProviderLedger('2026-08-21T12:00:01.000Z');
    requiredRow(running.runtime.providerTasks, 0)['internalState'] = 'RUNNING';
    requiredRow(running.runtime.providerTasks, 0)['mcpStatus'] = 'working';
    requiredRow(running.adapter.executions, 0)['state'] = 'RUNNING';
    const runningResult = await reconcileUgvB02ProviderSafety({
      preLedger: emptyLedger('2026-08-21T11:59:59.000Z'),
      prepared: preparedMove(),
      confirmationResponseAccepted: true,
      maxPolls: 2,
      pollIntervalMs: 10,
      captureProviderLedger: () => Promise.resolve(running),
      pause: () => Promise.resolve(),
    });
    expect(runningResult).toMatchObject({
      classification: 'manual_unknown',
      reason: 'active_or_incomplete',
      writesRetried: 0,
    });

    const unreadableResult = await reconcileUgvB02ProviderSafety({
      preLedger: emptyLedger('2026-08-21T11:59:59.000Z'),
      prepared: preparedMove(),
      confirmationResponseAccepted: false,
      maxPolls: 2,
      pollIntervalMs: 10,
      captureProviderLedger: () => Promise.reject(new Error('postgres unavailable')),
      pause: () => Promise.resolve(),
    });
    expect(unreadableResult).toEqual({
      classification: 'manual_unknown',
      attemptCount: 2,
      writesRetried: 0,
      reason: 'capture_unreadable',
    });
  });

  it('requires exact Task identity, terminal text, and three-way structured result equality', () => {
    const expectedResult = {
      resourceId: 'vehicle:ugv1',
      status: 'completed',
      finalPosition: { x: 120.000_01, y: 30, frame: 'EPSG:4326' },
    };
    const projection = {
      a2aTask: Task.fromJSON({
        id: TASK_ID,
        contextId: CONTEXT_ID,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          timestamp: '2026-08-21T12:00:06.000Z',
        },
        artifacts: [
          {
            artifactId: `${TASK_ID}:result`,
            name: 'result',
            description: 'Natural-language and structured task result.',
            parts: [
              { text: UGV_B02_TERMINAL_SUMMARY, mediaType: 'text/plain' },
              { data: expectedResult, mediaType: 'application/json' },
            ],
          },
        ],
      }),
      runtimeTask: {
        taskId: TASK_ID,
        contextId: CONTEXT_ID,
        output: { text: UGV_B02_TERMINAL_SUMMARY, structured: expectedResult },
      },
      workflowResult: expectedResult,
      expectedResult,
      taskId: TASK_ID,
      contextId: CONTEXT_ID,
    };
    expect(() => {
      assertUgvB02TerminalProjection(projection);
    }).not.toThrow();
    for (const drift of [
      { ...projection, a2aTask: { ...projection.a2aTask, id: 'wrong-task' } },
      { ...projection, a2aTask: { ...projection.a2aTask, contextId: 'wrong-context' } },
      {
        ...projection,
        runtimeTask: {
          ...projection.runtimeTask,
          output: { ...projection.runtimeTask.output, text: 'inexact terminal text' },
        },
      },
      { ...projection, workflowResult: { ...expectedResult, status: 'failed' } },
    ])
      expect(() => {
        assertUgvB02TerminalProjection(drift);
      }).toThrow('UGV_B02_TERMINAL_RESULT_INVALID');
  });
});

function configuration(): UgvB02MoveConfiguration {
  return {
    simulationId: SIMULATION_ID,
    admissionIdempotencyKey: deriveUgvB02AdmissionIdempotencyKey(SIMULATION_ID),
    target: TARGET,
    a2aBaseUrl: 'http://127.0.0.1:10999',
    runtimeManagementBaseUrl: 'http://127.0.0.1:10998',
    nodeControlBaseUrl: 'http://127.0.0.1:10091',
    runtimeControlBearerToken: 'runtime-control-token-value',
    governedControlBearerToken: 'governed-control-token-value',
    nodeControlBearerToken: 'node-control-token-value',
  };
}

function qualification() {
  return {
    simulationId: SIMULATION_ID,
    invocationId: 'qualification-invocation-1',
    resultHash: `sha256:${'b'.repeat(64)}`,
    completedAt: '2026-08-21T12:00:00.000Z',
    observedAt: '2026-08-21T12:00:00.000Z',
    revision: 'a'.repeat(64),
    mqttIngressSequence: 10,
    serverId: 'server-1',
    providerBindingId: 'provider-binding-1',
    providerId: 'isr.vehicle.ugv.ugv1' as const,
    operationName: 'vehicle_get_state' as const,
    resourceId: 'vehicle:ugv1' as const,
    sourcePosition: { longitude: 120, latitude: TARGET.y },
  };
}

async function rejectedQualification(response: Response) {
  const sendMessage = vi.fn();
  const client = { sendMessage, getTask: vi.fn() } as unknown as UgvB02A2AClient;
  const request = vi.fn<typeof fetch>((input) => {
    const url = requestUrl(input);
    if (url.includes('/api/v1/a2a-exposures/'))
      return Promise.resolve(
        jsonResponse({
          exposureId: 'a2a.embodied.move',
          version: 2,
          capabilityId: 'embodied.move',
          capabilityVersion: 2,
          agentSkillId: 'embodied.move_to',
          status: 'published',
        }),
      );
    if (url.endsWith('/internal/v1/ugv-agent-profile/qualification-state'))
      return Promise.resolve(response);
    throw new Error(`unexpected URL: ${url}`);
  });
  const error = await prepareUgvB02Move(
    { ...configuration(), preLedger: emptyLedger('2026-08-21T11:59:59.000Z') },
    {
      fetch: request,
      createA2AClient: () => Promise.resolve(client),
      now: () => '2026-08-21T12:00:00.500Z',
    },
  ).then(
    () => new Error('qualification unexpectedly passed'),
    (caught: unknown) => caught,
  );
  return { error, sendMessage };
}

function preparedMove(
  plan: Record<string, unknown> = { definition: { nodes: ['frozen'] } },
  preLedger = emptyLedger('2026-08-21T11:59:59.000Z'),
) {
  return createUgvB02PreparedMove({
    schemaVersion: 'sdar.ugv-agent-profile-a2a-move-prepared/v1',
    preparedAt: '2026-08-21T12:00:00.500Z',
    simulationId: SIMULATION_ID,
    qualification: qualification(),
    admission: {
      messageId: 'message-1',
      idempotencyKey: deriveUgvB02AdmissionIdempotencyKey(SIMULATION_ID),
      exposureId: 'a2a.embodied.move',
      structuredInput: { resourceId: 'vehicle:ugv1', target: TARGET },
      submittedAt: '2026-08-21T12:00:00.500Z',
      taskId: TASK_ID,
      contextId: CONTEXT_ID,
    },
    runtime: {
      planId: 'plan-1',
      planSha256: sha256(plan),
      planDefinitionSha256: sha256(plan['definition']),
      taskPhase: 'awaiting_plan_confirmation',
      selectedSkillId: 'embodied.move_to',
      selectedSkillVersion: 1,
    },
    preExecution: {
      taskMcpInvocationCount: 0,
      taskRemoteBindingCount: 0,
      providerLedgerSha256: sha256(preLedger),
    },
  });
}

function formalPlan() {
  const nodes: Record<string, unknown>[] = [
    { nodeId: 'ugv_initial_state', type: 'mcp_tool', tool: { toolName: 'vehicle_get_state' } },
    { nodeId: 'ugv_context_current_position', type: 'condition' },
    { nodeId: 'ugv_context_resource_state', type: 'condition' },
    { nodeId: 'ugv_context_permission', type: 'condition' },
    {
      nodeId: 'ugv_navigate',
      type: 'mcp_tool',
      tool: { toolName: 'vehicle_navigate' },
      arguments: {
        resourceId: 'vehicle:ugv1',
        mission: {
          type: 'point',
          target: { longitude: TARGET.x, latitude: TARGET.y },
        },
        stopOnObstacle: true,
      },
    },
    { nodeId: 'ugv_final_state', type: 'mcp_tool', tool: { toolName: 'vehicle_get_state' } },
    { nodeId: 'ugv_evidence_final_position', type: 'condition' },
    { nodeId: 'ugv_success', type: 'result' },
    { nodeId: 'ugv_failure', type: 'result' },
  ];
  return { definition: { nodes } };
}

function runtimeTask(phase: string) {
  return {
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    phase,
    planId: 'plan-1',
    selectedSkillId: 'embodied.move_to',
    selectedSkillVersion: 1,
  };
}

function remoteLifecycle(lifecycle: 'active' | 'terminal') {
  return {
    items: [
      {
        binding: {
          agentTaskId: TASK_ID,
          workflowPlanId: 'plan-1',
          workflowNodeId: 'ugv_navigate',
          operationName: 'vehicle_navigate',
        },
        continuations: [
          {
            lifecycle,
            nodeId: 'ugv_navigate',
            waitState: 'waiting',
            snapshotId: 'snapshot-1',
            continuationId: 'continuation-1',
            stateVersion: 1,
          },
        ],
      },
    ],
  };
}

function inputRequiredA2aTask(): Task {
  return {
    id: TASK_ID,
    contextId: CONTEXT_ID,
    status: { state: TaskState.TASK_STATE_INPUT_REQUIRED },
  } as unknown as Task;
}

function terminalA2aTask(): Task {
  const structured = terminalStructuredResult();
  return Task.fromJSON({
    id: TASK_ID,
    contextId: CONTEXT_ID,
    status: {
      state: TaskState.TASK_STATE_COMPLETED,
      timestamp: '2026-08-21T12:00:06.000Z',
    },
    artifacts: [
      {
        artifactId: `${TASK_ID}:result`,
        name: 'result',
        description: 'Natural-language and structured task result.',
        parts: [
          { text: UGV_B02_TERMINAL_SUMMARY, mediaType: 'text/plain' },
          { data: structured, mediaType: 'application/json' },
        ],
      },
    ],
  });
}

function terminalStructuredResult() {
  return {
    resourceId: 'vehicle:ugv1',
    status: 'completed',
    finalPosition: {
      x: TARGET.x,
      y: TARGET.y,
      frame: 'EPSG:4326',
    },
  };
}

function stateResult(
  observedAt: string,
  revision: string,
  mqttIngressSequence: number,
  longitude: number,
) {
  return {
    structuredContent: {
      observedAt,
      revision,
      mqttIngressSequence,
      chassis: { position: { longitude, latitude: TARGET.y } },
    },
  };
}

function terminalTaskInvocations() {
  const argumentHash = navigateArgumentHash();
  return [
    {
      invocationId: 'initial-state-invocation-1',
      taskId: TASK_ID,
      capabilityAttemptId: 'attempt-1',
      toolName: 'vehicle_get_state',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
      result: stateResult('2026-08-21T12:00:01.000Z', 'b'.repeat(64), 11, 120),
    },
    {
      invocationId: 'navigate-invocation-1',
      taskId: TASK_ID,
      capabilityAttemptId: 'attempt-1',
      toolName: 'vehicle_navigate',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
      controlConfirmationId: 'confirmation-1',
      controlProviderBindingId: 'provider-binding-1',
      controlArgumentsHash: argumentHash,
      controlDispatchHash: '9'.repeat(64),
    },
    {
      invocationId: 'final-state-invocation-1',
      taskId: TASK_ID,
      capabilityAttemptId: 'attempt-1',
      toolName: 'vehicle_get_state',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
      result: stateResult('2026-08-21T12:00:03.000Z', 'c'.repeat(64), 12, TARGET.x),
    },
  ];
}

function terminalRemoteLifecycle() {
  const observedAt = '2026-08-21T12:00:02.000Z';
  const cursor = `oc1.${Buffer.from(
    JSON.stringify({
      version: 1,
      kind: 'field',
      observedAt,
      field: 'chassis.position.geodetic',
      topic: '/ugv/gnss',
      timeAuthority: 'source',
      ingestSequence: 12,
    }),
  ).toString('base64url')}`;
  return {
    items: [
      {
        binding: {
          bindingId: 'remote-binding-1',
          agentTaskId: TASK_ID,
          workflowPlanId: 'plan-1',
          workflowInstanceId: 'workflow-instance-1',
          workflowNodeId: 'ugv_navigate',
          mcpInvocationId: 'navigate-invocation-1',
          operationName: 'vehicle_navigate',
          protocolStatus: 'completed',
          localState: 'reentered',
          remoteTaskId: 'remote-task-1',
        },
        finalOutcome: {
          providerStatus: 'completed',
          authoritative: true,
          result: {
            structuredContent: {
              status: 'completed',
              resourceId: 'vehicle:ugv1',
              observationAuthority: 'post_dispatch',
              correlationStrength: 'STRICT_CORRELATED',
              snapshotRevision: 'c'.repeat(64),
              missionId: 'mission-1',
              observedAt,
              endPosition: {
                type: 'geodetic',
                longitude: TARGET.x,
                latitude: TARGET.y,
              },
              positionAuthority: {
                observedAt,
                field: 'chassis.position.geodetic',
                topic: '/ugv/gnss',
                timeAuthority: 'source',
                cursor,
              },
            },
          },
        },
        continuations: [
          {
            lifecycle: 'terminal',
            nodeId: 'ugv_navigate',
            waitState: 'waiting',
            snapshotId: 'snapshot-1',
            continuationId: 'continuation-1',
            stateVersion: 1,
          },
        ],
      },
    ],
  };
}

function modelConfiguredPreLedger(capturedAt: string) {
  const ledger = emptyLedger(capturedAt);
  ledger.sdar.stageModelRoutes.push({
    rowId: 'workflow_planning:structured_generation',
    providerId: 'model-provider-1',
  });
  ledger.sdar.modelProviders.push({
    providerId: 'model-provider-1',
    enabled: true,
    model: 'model-1',
  });
  return ledger;
}

function navigateArgumentHash() {
  const target = TARGET;
  return sha256({
    resourceId: 'vehicle:ugv1',
    mission: { type: 'point', target: { longitude: target.x, latitude: target.y } },
    stopOnObstacle: true,
  }).slice('sha256:'.length);
}

function fullTerminalLedger(capturedAt: string, planDefinition: unknown) {
  const ledger = terminalProviderLedger(capturedAt);
  const argumentHash = navigateArgumentHash();
  ledger.sdar.stageModelRoutes.push({
    rowId: 'workflow_planning:structured_generation',
    providerId: 'model-provider-1',
  });
  ledger.sdar.modelProviders.push({
    providerId: 'model-provider-1',
    enabled: true,
    model: 'model-1',
  });
  ledger.sdar.modelInvocations.push({
    invocationId: 'model-invocation-1',
    taskId: TASK_ID,
    stage: 'workflow_planning',
    status: 'succeeded',
    providerId: 'model-provider-1',
    model: 'model-1',
    operation: 'structured_generation',
    errorCode: null,
  });
  ledger.sdar.mcpInvocations.splice(
    0,
    ledger.sdar.mcpInvocations.length,
    {
      invocationId: 'qualification-invocation-1',
      taskId: null,
      capabilityAttemptId: null,
      toolName: 'vehicle_get_state',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
    },
    {
      invocationId: 'initial-state-invocation-1',
      taskId: TASK_ID,
      capabilityAttemptId: 'attempt-1',
      toolName: 'vehicle_get_state',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
    },
    {
      invocationId: 'navigate-invocation-1',
      taskId: TASK_ID,
      capabilityAttemptId: 'attempt-1',
      toolName: 'vehicle_navigate',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
      controlConfirmationId: 'confirmation-1',
      controlProviderBindingId: 'provider-binding-1',
      controlArgumentsHash: argumentHash,
      controlDispatchHash: '9'.repeat(64),
      startedAt: '2026-08-21T12:00:02.500Z',
      completedAt: '2026-08-21T12:00:05.000Z',
    },
    {
      invocationId: 'final-state-invocation-1',
      taskId: TASK_ID,
      capabilityAttemptId: 'attempt-1',
      toolName: 'vehicle_get_state',
      status: 'succeeded',
      executionMode: 'simulation',
      simulationId: SIMULATION_ID,
      serverId: 'server-1',
    },
  );
  Object.assign(requiredRow(ledger.sdar.initialTaskAdmissions, 0), {
    capabilityAttemptId: 'attempt-1',
    capabilityBindingId: 'capability-binding-1',
    created_context: true,
    requestHash: `sha256:${'a'.repeat(64)}`,
  });
  ledger.sdar.capabilityAttempts.push({
    attemptId: 'attempt-1',
    taskId: TASK_ID,
    capabilityBindingId: 'capability-binding-1',
    attemptNo: 1,
    planId: 'plan-1',
    reason: 'initial',
    status: 'succeeded',
    skill_version_refs: ['skill:embodied.move_to:1'],
    provider_binding_refs: ['provider-binding-1'],
    started_at: '2026-08-21T12:00:01.000Z',
    completedAt: '2026-08-21T12:00:06.000Z',
  });
  ledger.sdar.governedConfirmations.push({
    confirmationId: 'confirmation-1',
    taskId: TASK_ID,
    capabilityBindingId: 'capability-binding-1',
    capabilityAttemptId: 'attempt-1',
    capability_id: 'embodied.move',
    capability_version: 2,
    planId: 'plan-1',
    planHash: sha256(planDefinition).slice('sha256:'.length),
    skill_id: 'embodied.move_to',
    skill_version: 1,
    actor_id: 'uap-p3-b01-human-operator',
    actor_kind: 'human',
    authentication_method: 'configured_bearer',
    actor_roles_json: ['physical_control_approver'],
    revoked_at: null,
    revoked_by: null,
    providerBindingId: 'provider-binding-1',
    serverId: 'server-1',
    toolName: 'vehicle_navigate',
    argumentsHash: argumentHash,
    consumedInvocationId: 'navigate-invocation-1',
    consumedDispatchHash: '9'.repeat(64),
    confirmed_at: '2026-08-21T12:00:02.000Z',
    consumedAt: '2026-08-21T12:00:03.000Z',
    expires_at: '2026-08-21T12:01:00.000Z',
  });
  ledger.sdar.remoteAdmissionIntents.push({
    intentId: 'intent-1',
    invocationId: 'navigate-invocation-1',
    bindingId: 'remote-binding-1',
    taskId: TASK_ID,
    capabilityAttemptId: 'attempt-1',
    contextId: CONTEXT_ID,
    serverId: 'server-1',
    operationName: 'vehicle_navigate',
    argumentsHash: argumentHash,
    status: 'materialized',
    recordedInvocationId: 'navigate-invocation-1',
    materializedBindingId: 'remote-binding-1',
    materializedSnapshotId: 'snapshot-1',
    reason_code: null,
  });
  ledger.sdar.continuationSnapshots.push({
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    stateVersion: 1,
    predecessorSnapshotId: null,
    lifecycle: 'terminal',
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    planId: 'plan-1',
    workflowInstanceId: 'workflow-instance-1',
  });
  ledger.sdar.continuationAttempts.push({
    attemptId: 'continuation-attempt-1',
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    snapshotStateVersion: 1,
    workflowInstanceId: 'workflow-instance-1',
    status: 'succeeded',
    errorCode: null,
    completedAt: '2026-08-21T12:00:06.000Z',
  });
  Object.assign(requiredRow(ledger.sdar.tasks, 0), {
    phase: 'completed',
    planId: 'plan-1',
    selectedSkillId: 'embodied.move_to',
    selectedSkillVersion: 1,
    userGoalPlanId: 'user-goal-plan-1',
  });
  ledger.sdar.goals.push({
    goalId: 'goal-1',
    goalVersion: 1,
    contextId: CONTEXT_ID,
    status: 'achieved',
  });
  ledger.sdar.goalContracts.push({
    rowId: 'goal-1:1',
    goalId: 'goal-1',
    goalVersion: 1,
    contractHash: `sha256:${'b'.repeat(64)}`,
  });
  ledger.sdar.userGoalPlans.push({
    planId: 'user-goal-plan-1',
    goalId: 'goal-1',
    goalVersion: 1,
    revision: 1,
    status: 'completed',
    contractHash: `sha256:${'b'.repeat(64)}`,
  });
  ledger.sdar.workflowPlans.push({
    planId: 'plan-1',
    goalId: 'goal-1',
    goalVersion: 1,
    confirmation_status: 'confirmed',
    attempt_count: 1,
    definition_json: planDefinition,
  });
  ledger.sdar.workflowInstances.push({
    instanceId: 'workflow-instance-1',
    planId: 'plan-1',
    goalId: 'goal-1',
    goalVersion: 1,
    status: 'succeeded',
    completedAt: '2026-08-21T12:00:06.000Z',
    workflowDefinitionId: 'ugv-move-workflow',
    workflowDefinitionVersion: 1,
  });
  ledger.sdar.skillExecutions.push({
    executionId: 'skill-execution-1',
    taskId: TASK_ID,
    goalId: 'goal-1',
    goalVersion: 1,
    skillId: 'embodied.move_to',
    skillVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'ugv-move-workflow',
    workflowDefinitionVersion: 1,
  });
  ledger.sdar.skillExecutionEvents.push({
    eventId: 'skill-event-1',
    executionId: 'skill-execution-1',
    eventType: 'skill.execution_completed',
    statusAfter: 'completed',
  });
  ledger.sdar.terminalOutcomes.push({
    outcomeId: 'terminal-outcome-1',
    taskId: TASK_ID,
    goalId: 'goal-1',
    goalVersion: 1,
    outcome_kind: 'achieved',
    controlStatus: 'achieved',
    authority: 'user_goal_plan_controller',
    summary: 'durable final-position evidence',
    finalInstanceId: 'workflow-instance-1',
    capability_attempt_id: 'attempt-1',
    resultId: 'terminal-evidence-1',
  });
  ledger.sdar.processedResults.push({
    resultId: 'terminal-evidence-1',
    taskId: TASK_ID,
    skillId: 'embodied.move_to',
    skillVersion: 1,
  });
  ledger.sdar.workflowNodeEvents.push(
    {
      eventId: 'node-event-1',
      instanceId: 'workflow-instance-1',
      nodeId: 'ugv_navigate',
      eventType: 'node_started',
    },
    {
      eventId: 'node-event-2',
      instanceId: 'workflow-instance-1',
      nodeId: 'ugv_evidence_final_position',
      eventType: 'node_succeeded',
    },
  );
  return ledger;
}

function zeroDispatchLedger(capturedAt: string) {
  const ledger = emptyLedger(capturedAt);
  ledger.adapter.deviceToolCalls.push({
    callId: 'qualification-state-call-1',
    taskId: 'provider-sync-qualification-1',
    toolName: 'get_status',
    outcome: 'accepted',
  });
  ledger.sdar.mcpInvocations.push({
    invocationId: 'qualification-invocation-1',
    taskId: null,
    toolName: 'vehicle_get_state',
    status: 'succeeded',
    serverId: 'server-1',
    simulationId: SIMULATION_ID,
  });
  ledger.sdar.initialTaskAdmissions.push({
    idempotencyKey: deriveUgvB02AdmissionIdempotencyKey(SIMULATION_ID),
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
  });
  ledger.sdar.tasks.push({
    taskId: TASK_ID,
    contextId: CONTEXT_ID,
    phase: 'awaiting_plan_confirmation',
  });
  return ledger;
}

function terminalProviderLedger(capturedAt: string) {
  const ledger = zeroDispatchLedger(capturedAt);
  const target = TARGET;
  const argumentsValue = {
    resourceId: 'vehicle:ugv1',
    mission: {
      type: 'point',
      target: { longitude: target.x, latitude: target.y },
    },
    stopOnObstacle: true,
  };
  const argumentHash = sha256(argumentsValue).slice('sha256:'.length);
  const authorizationHash = 'd'.repeat(64);
  const executionContext = {
    executionMode: 'SIMULATION',
    simulationId: SIMULATION_ID,
    authorizationContextHash: authorizationHash,
    correlationId: 'provider-correlation-1',
  };
  ledger.sdar.mcpInvocations.push({
    invocationId: 'initial-state-invocation-1',
    taskId: TASK_ID,
    toolName: 'vehicle_get_state',
    status: 'succeeded',
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    serverId: 'server-1',
  });
  ledger.sdar.mcpInvocations.push({
    invocationId: 'navigate-invocation-1',
    taskId: TASK_ID,
    toolName: 'vehicle_navigate',
    status: 'succeeded',
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    serverId: 'server-1',
    controlProviderBindingId: 'provider-binding-1',
    controlArgumentsHash: argumentHash,
  });
  ledger.runtime.idempotencyRecords.push({
    rowId: `${authorizationHash}:vehicle_navigate:navigate-invocation-1:simulation:${SIMULATION_ID}`,
    operationName: 'vehicle_navigate',
    idempotencyKey: 'navigate-invocation-1',
    argumentHash,
    executionMode: 'simulation',
    taskId: 'remote-task-1',
    authorization_context_hash: authorizationHash,
    simulation_key: SIMULATION_ID,
    state: 'COMPLETE',
    stable_task_id: 'remote-task-1',
    lease_owner: null,
    lease_expires_at: null,
    synchronous_result: null,
    claim_attempt: 1,
  });
  ledger.runtime.providerTasks.push({
    taskId: 'remote-task-1',
    providerId: 'isr.vehicle.ugv.ugv1',
    authorization_context_hash: authorizationHash,
    operationName: 'vehicle_navigate',
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    arguments: argumentsValue,
    argumentHash,
    internalState: 'TERMINAL_COMPLETED',
    mcpStatus: 'completed',
    externalExecutionId: 'external-execution-1',
  });
  ledger.runtime.admissionIntents.push({
    taskId: 'remote-task-1',
    providerId: 'isr.vehicle.ugv.ugv1',
    authorization_context_hash: authorizationHash,
    operationName: 'vehicle_navigate',
    executionMode: 'simulation',
    simulationId: SIMULATION_ID,
    arguments: argumentsValue,
    argumentHash,
    state: 'PUBLISHED',
  });
  ledger.adapter.executions.push({
    taskId: 'remote-task-1',
    externalExecutionId: 'external-execution-1',
    operationName: 'vehicle_navigate',
    argumentHash,
    resourceId: 'vehicle:ugv1',
    state: 'SUCCEEDED',
    execution_context: executionContext,
    downstream_mission_ids: ['mission-1'],
    payload: {
      providerId: 'isr.vehicle.ugv.ugv1',
      arguments: argumentsValue,
      executionContext,
      downstreamMissionIds: ['mission-1'],
    },
  });
  ledger.adapter.deviceToolCalls.push(
    {
      callId: 'initial-state-call-1',
      taskId: 'provider-sync-initial-1',
      toolName: 'get_status',
      argumentHash: '2'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'final-state-call-1',
      taskId: 'provider-sync-final-1',
      toolName: 'get_status',
      argumentHash: '3'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'primary-call-1',
      taskId: 'remote-task-1',
      toolName: 'ugv_path_follow_mission',
      argumentHash: '4'.repeat(64),
      outcome: 'accepted',
    },
    {
      callId: 'followup-call-1',
      taskId: 'remote-task-1',
      toolName: 'ugv_mission_control',
      argumentHash: '5'.repeat(64),
      outcome: 'accepted',
    },
  );
  ledger.adapter.mutationJournal.push(
    {
      rowId: 'remote-task-1:start:01:primary',
      taskId: 'remote-task-1',
      stepId: 'start:01:primary',
      phase: 'PRIMARY',
      toolName: 'ugv_path_follow_mission',
      argumentHash: '4'.repeat(64),
      state: 'ACCEPTED',
      externalMissionId: 'mission-1',
      result_hash: '6'.repeat(64),
      payload: {
        taskId: 'remote-task-1',
        stepId: 'start:01:primary',
        toolName: 'ugv_path_follow_mission',
        argumentHash: '4'.repeat(64),
        externalMissionId: 'mission-1',
      },
    },
    {
      rowId: 'remote-task-1:start:02:followup',
      taskId: 'remote-task-1',
      stepId: 'start:02:followup',
      phase: 'FOLLOWUP',
      toolName: 'ugv_mission_control',
      argumentHash: '5'.repeat(64),
      state: 'ACCEPTED',
      externalMissionId: 'mission-1',
      result_hash: '7'.repeat(64),
      payload: {
        taskId: 'remote-task-1',
        stepId: 'start:02:followup',
        toolName: 'ugv_mission_control',
        argumentHash: '5'.repeat(64),
        externalMissionId: 'mission-1',
      },
    },
  );
  return ledger;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  throw new Error('unexpected request input');
}

function requiredRow<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`missing fixture row ${String(index)}`);
  return row;
}

function emptyLedger(capturedAt: string): UgvB02ProviderLedger {
  return {
    schemaVersion: 'sdar.ugv-agent-profile-provider-ledger/v1',
    capturedAt,
    runtime: { idempotencyRecords: [], providerTasks: [], admissionIntents: [] },
    adapter: { executions: [], deviceToolCalls: [], mutationJournal: [], commandAcks: [] },
    sdar: {
      modelInvocations: [],
      mcpInvocations: [],
      stageModelRoutes: [],
      modelProviders: [],
      initialTaskAdmissions: [],
      capabilityAttempts: [],
      governedConfirmations: [],
      remoteAdmissionIntents: [],
      continuationSnapshots: [],
      continuationAttempts: [],
      terminalOutcomes: [],
      workflowNodeEvents: [],
      tasks: [],
      goals: [],
      goalContracts: [],
      userGoalPlans: [],
      workflowPlans: [],
      workflowInstances: [],
      skillExecutions: [],
      skillExecutionEvents: [],
      processedResults: [],
    },
  };
}
