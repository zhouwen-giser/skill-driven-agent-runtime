import { afterEach, describe, expect, it } from 'vitest';

import {
  startMcpTasksMockProvider,
  StreamableHttpMcpAdapter,
  type McpTasksMockProviderHandle,
} from '../src/index.js';

const PHASE_SIX_SCENARIOS = [
  'sync_success',
  'task_success',
  'task_business_failure',
  'task_protocol_failure',
  'task_cancelled',
  'task_input_required',
  'task_multi_input',
  'task_restricted_accept',
  'task_restricted_reject',
  'task_scheduled_success',
  'task_start_window_missed',
  'task_deadline_reached',
  'task_pause_resume_observation',
  'task_provider_unreachable',
  'task_malformed_response',
  'task_duplicate_terminal',
] as const;

describe('Phase 6 deterministic MCP Tasks Mock Provider', () => {
  let provider: McpTasksMockProviderHandle | undefined;
  let adapter: StreamableHttpMcpAdapter | undefined;

  afterEach(async () => {
    await adapter?.close();
    await provider?.close();
    adapter = undefined;
    provider = undefined;
  });

  it('advertises all sixteen named scenarios with bounded schemas', async () => {
    const runtime = await createRuntime();
    const tools = await runtime.adapter.discover({ endpoint: runtime.endpoint, headers: {} });

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([...PHASE_SIX_SCENARIOS]),
    );
    for (const scenario of PHASE_SIX_SCENARIOS) {
      expect(tools.find((tool) => tool.name === scenario)?.inputSchema).toEqual({
        type: 'object',
        additionalProperties: false,
      });
    }
  });

  it('returns immediate sync success and deterministic success/task-failure sequences', async () => {
    const runtime = await createRuntime();
    await expect(call(runtime, 'sync_success')).resolves.toMatchObject({
      kind: 'immediate',
      result: { isError: false, structuredContent: { status: 'sync_complete' } },
    });

    const successId = await callTask(runtime, 'task_success');
    await expect(get(runtime, successId)).resolves.toMatchObject({
      status: 'working',
      providerObservation: { substate: 'running', progress: { percent: 50 } },
    });
    await expect(get(runtime, successId)).resolves.toMatchObject({
      status: 'completed',
      result: { isError: false, structuredContent: { status: 'remote_complete' } },
    });

    const businessId = await callTask(runtime, 'task_business_failure');
    await expect(get(runtime, businessId)).resolves.toMatchObject({
      status: 'completed',
      result: {
        isError: true,
        structuredContent: {
          outcome: 'business_failure',
          reasonCode: 'BUSINESS_RULE_REJECTED',
          retryable: false,
        },
      },
    });

    const protocolId = await callTask(runtime, 'task_protocol_failure');
    await expect(get(runtime, protocolId)).resolves.toMatchObject({
      status: 'failed',
      error: {
        code: -32_603,
        data: { reasonCode: 'REMOTE_PROTOCOL_OPERATION_FAILED' },
      },
    });
  });

  it('separates cancellation acknowledgement from the Provider terminal observation', async () => {
    const runtime = await createRuntime();
    const taskId = await callTask(runtime, 'task_cancelled');
    await expect(get(runtime, taskId)).resolves.toMatchObject({ status: 'working' });
    await expect(
      runtime.adapter.cancelTask({ endpoint: runtime.endpoint, headers: {}, remoteTaskId: taskId }),
    ).resolves.toMatchObject({ acknowledged: true });
    await expect(get(runtime, taskId)).resolves.toMatchObject({ status: 'cancelled' });

    expect(
      runtime.provider.requests.find((request) => request.method === 'tasks/cancel')?.params,
    ).toMatchObject({ taskId });
  });

  it('supports one-round and two-round exact tasks/update form elicitation', async () => {
    const runtime = await createRuntime();
    const oneRoundId = await callTask(runtime, 'task_input_required');
    await expect(get(runtime, oneRoundId)).resolves.toMatchObject({
      status: 'input_required',
      providerObservation: { remoteRevision: 'provider-revision-2' },
      inputRequests: {
        approval: {
          method: 'elicitation/create',
          params: { mode: 'form', requestedSchema: { type: 'object' } },
        },
      },
    });
    await update(runtime, oneRoundId, {
      approval: { action: 'accept', content: { approved: true } },
    });
    await expect(get(runtime, oneRoundId)).resolves.toMatchObject({ status: 'completed' });

    const twoRoundId = await callTask(runtime, 'task_multi_input');
    await expect(get(runtime, twoRoundId)).resolves.toMatchObject({
      status: 'input_required',
      inputRequests: { approval: expect.any(Object) },
    });
    await update(runtime, twoRoundId, {
      approval: { action: 'accept', content: { approved: true } },
    });
    await expect(get(runtime, twoRoundId)).resolves.toMatchObject({
      status: 'input_required',
      providerObservation: { remoteRevision: 'provider-revision-3' },
      inputRequests: { details: expect.any(Object) },
    });
    await update(runtime, twoRoundId, {
      details: { action: 'accept', content: { note: 'proceed' } },
    });
    await expect(get(runtime, twoRoundId)).resolves.toMatchObject({
      status: 'completed',
      result: { structuredContent: { status: 'multi_input_complete' } },
    });

    const updates = runtime.provider.requests.filter(
      (request) => request.method === 'tasks/update',
    );
    expect(updates.map((request) => request.params)).toMatchObject([
      {
        taskId: oneRoundId,
        inputResponses: { approval: { action: 'accept', content: { approved: true } } },
      },
      {
        taskId: twoRoundId,
        inputResponses: { approval: { action: 'accept', content: { approved: true } } },
      },
      {
        taskId: twoRoundId,
        inputResponses: { details: { action: 'accept', content: { note: 'proceed' } } },
      },
    ]);
  });

  it('returns deterministic restricted acceptance/rejection and scheduled availability', async () => {
    const runtime = await createRuntime();
    const availability = await runtime.adapter.checkTaskAvailability({
      endpoint: runtime.endpoint,
      headers: {},
      requests: [
        availabilityRequest('accept', 'task_restricted_accept'),
        availabilityRequest('reject', 'task_restricted_reject'),
        {
          ...availabilityRequest('scheduled', 'task_scheduled_success'),
          timing: {
            start: {
              mode: 'scheduled',
              scheduledAt: '2036-02-03T04:05:06.000Z',
              startToleranceMs: 30_000,
            },
            maxElapsedMs: 900_000,
          },
        },
      ],
    });
    expect(availability).toMatchObject({
      results: [
        {
          availability: 'restricted',
          riskLevel: 'high',
          reasonCode: 'OPERATOR_CONFIRMATION_REQUIRED',
          validUntil: expect.any(String),
        },
        {
          availability: 'restricted',
          riskLevel: 'high',
          reasonCode: 'OPERATOR_CONFIRMATION_REQUIRED',
          validUntil: expect.any(String),
        },
        {
          availability: 'available',
          reservationMode: 'guaranteed',
          reservationRef: 'mock-reservation-scheduled-success',
          earliestStartTime: '2036-02-03T04:05:06.000Z',
          nextAvailableWindows: [
            {
              startTime: '2036-02-03T04:05:06.000Z',
              endTime: '2036-02-03T05:05:06.000Z',
            },
          ],
        },
      ],
    });
    expect(Date.parse(availability.results[0]?.validUntil ?? '')).toBeGreaterThan(Date.now());
    expect(Date.parse(availability.results[1]?.validUntil ?? '')).toBeGreaterThan(Date.now());

    const acceptedId = await callTask(runtime, 'task_restricted_accept');
    await expect(get(runtime, acceptedId)).resolves.toMatchObject({ status: 'working' });
    await expect(call(runtime, 'task_restricted_reject')).resolves.toMatchObject({
      kind: 'immediate',
      result: {
        isError: true,
        structuredContent: { outcome: 'admission_rejected' },
      },
    });

    const scheduledId = await callTask(runtime, 'task_scheduled_success');
    await expect(get(runtime, scheduledId)).resolves.toMatchObject({
      status: 'working',
      providerObservation: { substate: 'scheduled' },
    });
    await expect(get(runtime, scheduledId)).resolves.toMatchObject({ status: 'completed' });
  });

  it.each([
    ['task_start_window_missed', 'start_window_missed', 'START_WINDOW_MISSED'],
    ['task_deadline_reached', 'deadline_reached', 'MAX_ELAPSED_TIME_REACHED'],
  ] as const)(
    'returns Provider-declared timing outcome for %s',
    async (scenario, outcome, reasonCode) => {
      const runtime = await createRuntime();
      const taskId = await callTask(runtime, scenario);
      await expect(get(runtime, taskId)).resolves.toMatchObject({
        status: 'completed',
        result: { isError: true, structuredContent: { outcome, reasonCode, retryable: true } },
      });
    },
  );

  it('keeps pause/resume observation-only before one terminal result', async () => {
    const runtime = await createRuntime();
    const taskId = await callTask(runtime, 'task_pause_resume_observation');
    await expect(get(runtime, taskId)).resolves.toMatchObject({
      status: 'working',
      providerObservation: { substate: 'paused', progress: { percent: 25 } },
    });
    await expect(get(runtime, taskId)).resolves.toMatchObject({
      status: 'working',
      providerObservation: { substate: 'resuming', progress: { percent: 50 } },
    });
    await expect(get(runtime, taskId)).resolves.toMatchObject({ status: 'completed' });
  });

  it('injects one transport outage without fabricating a terminal status', async () => {
    const runtime = await createRuntime();
    const taskId = await callTask(runtime, 'task_provider_unreachable');
    await expect(get(runtime, taskId)).rejects.toThrow();
    await expect(get(runtime, taskId)).resolves.toMatchObject({
      status: 'completed',
      result: { structuredContent: { status: 'recovered_complete' } },
    });
  });

  it('fails closed on a malformed snapshot and repeats a byte-stable terminal observation', async () => {
    const runtime = await createRuntime();
    const malformedId = await callTask(runtime, 'task_malformed_response');
    await expect(get(runtime, malformedId)).rejects.toMatchObject({
      code: 'MCP_TASK_RESPONSE_INVALID',
    });

    const duplicateId = await callTask(runtime, 'task_duplicate_terminal');
    const first = await get(runtime, duplicateId);
    const duplicate = await get(runtime, duplicateId);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ status: 'completed' });
  });

  async function createRuntime() {
    provider = await startMcpTasksMockProvider();
    adapter = new StreamableHttpMcpAdapter();
    return { provider, adapter, endpoint: provider.endpoint.toString() };
  }
});

interface Runtime {
  readonly provider: McpTasksMockProviderHandle;
  readonly adapter: StreamableHttpMcpAdapter;
  readonly endpoint: string;
}

async function call(runtime: Runtime, toolName: string) {
  return runtime.adapter.call({
    endpoint: runtime.endpoint,
    headers: {},
    toolName,
    arguments: {},
    executionContext: { mode: 'live' },
  });
}

async function callTask(runtime: Runtime, toolName: string): Promise<string> {
  const outcome = await call(runtime, toolName);
  if (outcome.kind !== 'remote_task') throw new Error(`${toolName} did not create a remote Task.`);
  return outcome.task.remoteTaskId;
}

function get(runtime: Runtime, remoteTaskId: string) {
  return runtime.adapter.getTask({
    endpoint: runtime.endpoint,
    headers: {},
    remoteTaskId,
  });
}

function update(
  runtime: Runtime,
  remoteTaskId: string,
  inputResponses: Readonly<Record<string, unknown>>,
) {
  return runtime.adapter.updateTask({
    endpoint: runtime.endpoint,
    headers: {},
    remoteTaskId,
    inputResponses,
  });
}

function availabilityRequest(nodeId: string, operationName: string) {
  return {
    nodeId,
    operationName,
    arguments: { unresolved: false as const, value: {} },
  };
}
