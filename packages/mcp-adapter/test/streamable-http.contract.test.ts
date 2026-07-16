import { afterEach, describe, expect, it } from 'vitest';

import {
  MCP_TASKS_EXTENSION_ID,
  MCP_TASKS_SCHEMA_REVISION,
  MCP_TASKS_TESTED_PROTOCOL_REVISION,
  startMcpTasksMockProvider,
  startMcpLoopbackServer,
  startMcpStreamableHttpSpike,
  type McpLoopbackServerHandle,
  type McpSpikeHandle,
  type McpTasksMockProviderHandle,
  StreamableHttpMcpAdapter,
} from '../src/index.js';

describe('official MCP Streamable HTTP transport', () => {
  let handle: McpSpikeHandle | undefined;
  let server: McpLoopbackServerHandle | undefined;
  let tasksProvider: McpTasksMockProviderHandle | undefined;
  let adapter: StreamableHttpMcpAdapter | undefined;

  afterEach(async () => {
    await handle?.close();
    await adapter?.close();
    await server?.close();
    await tasksProvider?.close();
    handle = undefined;
    server = undefined;
    tasksProvider = undefined;
    adapter = undefined;
  });

  it('discovers and calls a Tool over a real loopback HTTP server', async () => {
    handle = await startMcpStreamableHttpSpike();

    const tools = await handle.client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(['device_status', 'slow_probe']);
    expect(tools.tools[0]?.inputSchema).toEqual(expect.objectContaining({ type: 'object' }));

    const result = await handle.client.callTool({
      name: 'device_status',
      arguments: { deviceId: 'device-42' },
    });
    expect(result.structuredContent).toEqual({ deviceId: 'device-42', status: 'online' });
  });

  it('keeps official SDK types behind the production transport adapter', async () => {
    server = await startMcpLoopbackServer();
    adapter = new StreamableHttpMcpAdapter();
    const tools = await adapter.discover({ endpoint: server.endpoint.toString(), headers: {} });
    expect(tools.map((tool) => tool.name)).toEqual(['device_status', 'slow_probe']);
    expect(tools[0]?.declaredExecutionSemantics).toEqual({
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'cooperative',
      idempotency: 'client_request_key',
      replay: 'allowed',
    });
    const result = await adapter.call({
      endpoint: server.endpoint.toString(),
      headers: {},
      toolName: 'device_status',
      arguments: { deviceId: 'device-42' },
      executionContext: { mode: 'live' },
    });
    expect(result).toEqual({
      kind: 'immediate',
      result: expect.objectContaining({
        structuredContent: { deviceId: 'device-42', status: 'online' },
        isError: false,
      }),
    });
    await expect(
      adapter.capabilities({ endpoint: server.endpoint.toString(), headers: {} }),
    ).resolves.toEqual({
      protocolEra: 'legacy',
      protocolRevision: '2025-11-25',
      tasksExtension: false,
      tasksSchemaRevision: MCP_TASKS_SCHEMA_REVISION,
    });
  });

  it('fails discovery instead of silently downgrading a malformed exact declaration', async () => {
    server = await startMcpLoopbackServer({
      deviceExecutionSemantics: {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'execute_again',
      },
    });
    adapter = new StreamableHttpMcpAdapter();

    await expect(
      adapter.discover({ endpoint: server.endpoint.toString(), headers: {} }),
    ).rejects.toMatchObject({ code: 'MCP_TOOL_EXECUTION_SEMANTICS_DECLARATION_INVALID' });
  });

  it('delivers runtime-owned simulation Headers to the real MCP HTTP server', async () => {
    server = await startMcpLoopbackServer();
    adapter = new StreamableHttpMcpAdapter();
    const input = {
      endpoint: server.endpoint.toString(),
      headers: {
        Authorization: 'Bearer secret',
        'X-SDAR-Execution-Mode': 'simulation',
        'X-SDAR-Simulation-Id': 'simulation-real-1',
      },
      toolName: 'device_status',
      arguments: { deviceId: 'device-42' },
      executionContext: { mode: 'simulation' as const, simulationId: 'simulation-real-1' },
    };
    await expect(adapter.call(input)).resolves.toEqual({
      kind: 'immediate',
      result: expect.objectContaining({
        structuredContent: { deviceId: 'device-42', status: 'online' },
      }),
    });
    await expect(adapter.call(input)).resolves.toEqual({
      kind: 'immediate',
      result: expect.objectContaining({
        structuredContent: { deviceId: 'device-42', status: 'online' },
      }),
    });

    expect(server.receivedHeaders).toContainEqual(
      expect.objectContaining({
        authorization: 'Bearer secret',
        'x-sdar-execution-mode': 'simulation',
        'x-sdar-simulation-id': 'simulation-real-1',
      }),
    );
  });

  it('rejects arguments that violate the original Tool input schema', async () => {
    handle = await startMcpStreamableHttpSpike();

    const result = await handle.client.callTool({
      name: 'device_status',
      arguments: { deviceId: '' },
    });
    expect(result.isError).toBe(true);
  });

  it('negotiates the frozen Tasks extension and executes call/get/update/cancel over real HTTP', async () => {
    tasksProvider = await startMcpTasksMockProvider();
    adapter = new StreamableHttpMcpAdapter();
    const endpoint = tasksProvider.endpoint.toString();
    const headers = {
      Authorization: 'Bearer task-secret',
      'X-SDAR-Execution-Mode': 'historical-replay',
      'X-SDAR-Simulation-Id': 'replay-task-1',
    };

    await expect(adapter.capabilities({ endpoint, headers })).resolves.toEqual({
      protocolEra: 'modern',
      protocolRevision: MCP_TASKS_TESTED_PROTOCOL_REVISION,
      tasksExtension: true,
      tasksSchemaRevision: MCP_TASKS_SCHEMA_REVISION,
    });
    await expect(
      adapter.call({
        endpoint,
        headers,
        toolName: 'sync_success',
        arguments: {},
        executionContext: { mode: 'historical-replay', simulationId: 'replay-task-1' },
      }),
    ).resolves.toEqual({
      kind: 'immediate',
      result: expect.objectContaining({
        structuredContent: { status: 'sync_complete' },
        isError: false,
      }),
    });
    const accepted = await adapter.call({
      endpoint,
      headers,
      toolName: 'async_success',
      arguments: {},
      executionContext: { mode: 'historical-replay', simulationId: 'replay-task-1' },
    });
    expect(accepted).toEqual({
      kind: 'remote_task',
      task: expect.objectContaining({
        remoteTaskId: 'remote-task-0000000000000001',
        status: 'working',
        providerObservation: {
          revision: '1.0',
          remoteRevision: 'provider-revision-1',
          substate: 'queued',
          eventId: 'provider-event-1',
          observedAt: '2026-07-16T00:00:00.000Z',
          progress: { percent: 0 },
        },
      }),
    });
    const remoteTaskId =
      accepted.kind === 'remote_task' ? accepted.task.remoteTaskId : 'unreachable';
    await expect(adapter.getTask({ endpoint, headers, remoteTaskId })).resolves.toEqual(
      expect.objectContaining({
        remoteTaskId,
        status: 'completed',
        protocolRevision: MCP_TASKS_TESTED_PROTOCOL_REVISION,
        providerObservation: {
          revision: '1.0',
          remoteRevision: 'provider-revision-2',
          substate: 'stopping',
          eventId: 'provider-event-2',
          observedAt: '2026-07-16T00:01:00.000Z',
          progress: { percent: 100 },
        },
        result: expect.objectContaining({ structuredContent: { status: 'remote_complete' } }),
      }),
    );
    await expect(
      adapter.updateTask({
        endpoint,
        headers,
        remoteTaskId,
        inputResponses: { approval: { action: 'accept', content: { approved: true } } },
      }),
    ).resolves.toEqual({
      acknowledged: true,
      protocolRevision: MCP_TASKS_TESTED_PROTOCOL_REVISION,
    });
    await expect(adapter.cancelTask({ endpoint, headers, remoteTaskId })).resolves.toEqual({
      acknowledged: true,
      protocolRevision: MCP_TASKS_TESTED_PROTOCOL_REVISION,
    });

    const discover = tasksProvider.requests.find((request) => request.method === 'server/discover');
    expect(discover?.params).toEqual(
      expect.objectContaining({
        _meta: expect.objectContaining({
          'io.modelcontextprotocol/clientCapabilities': expect.objectContaining({
            extensions: { [MCP_TASKS_EXTENSION_ID]: {} },
          }),
        }),
      }),
    );
    for (const request of tasksProvider.requests.filter((item) =>
      item.method.startsWith('tasks/'),
    )) {
      expect(request.headers).toEqual(
        expect.objectContaining({
          authorization: 'Bearer task-secret',
          'x-sdar-execution-mode': 'historical-replay',
          'x-sdar-simulation-id': 'replay-task-1',
          'mcp-method': request.method,
          'mcp-name': remoteTaskId,
        }),
      );
      expect(request.params).toEqual(expect.objectContaining({ taskId: remoteTaskId }));
    }
  });

  it('rejects Task results from a Provider that did not declare the extension', async () => {
    tasksProvider = await startMcpTasksMockProvider({ declareTasks: false });
    adapter = new StreamableHttpMcpAdapter();
    const endpoint = tasksProvider.endpoint.toString();
    await expect(
      adapter.call({
        endpoint,
        headers: {},
        toolName: 'async_success',
        arguments: {},
        executionContext: { mode: 'live' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_CAPABILITY_REQUIRED' });
  });

  it.each([
    'malformed_task_id',
    'unknown_task_status',
    'unknown_task_field',
    'malformed_task_metadata',
  ])('fails closed for malformed Task response %s', async (toolName) => {
    tasksProvider = await startMcpTasksMockProvider();
    adapter = new StreamableHttpMcpAdapter();
    await expect(
      adapter.call({
        endpoint: tasksProvider.endpoint.toString(),
        headers: {},
        toolName,
        arguments: {},
        executionContext: { mode: 'live' },
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_RESPONSE_INVALID' });
  });

  it('keeps a synchronous business rejection immediate and creates no remote Task ID', async () => {
    tasksProvider = await startMcpTasksMockProvider();
    adapter = new StreamableHttpMcpAdapter();
    const outcome = await adapter.call({
      endpoint: tasksProvider.endpoint.toString(),
      headers: {},
      toolName: 'rejected_without_task',
      arguments: {},
      executionContext: { mode: 'live' },
    });
    expect(outcome).toEqual({
      kind: 'immediate',
      result: expect.objectContaining({
        isError: true,
        structuredContent: expect.objectContaining({ outcome: 'admission_rejected' }),
      }),
    });
    expect(JSON.stringify(outcome)).not.toContain('remoteTaskId');
  });

  it('discovers Task execution metadata and checks availability over exact loopback wire', async () => {
    tasksProvider = await startMcpTasksMockProvider();
    adapter = new StreamableHttpMcpAdapter();
    const endpoint = tasksProvider.endpoint.toString();
    const tools = await adapter.discover({ endpoint, headers: { Authorization: 'Bearer test' } });
    expect(tools.find((tool) => tool.name === 'async_success')?.taskExecution).toEqual({
      execution: 'task_required',
      availability: 'dynamic',
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      cancellation: 'task_cancel',
      revision: '1.0',
    });

    await expect(
      adapter.checkTaskAvailability({
        endpoint,
        headers: {
          Authorization: 'Bearer test',
          'X-SDAR-Execution-Mode': 'simulation',
          'X-SDAR-Simulation-Id': 'simulation-availability-1',
        },
        requests: [
          {
            nodeId: 'patrol',
            operationName: 'async_success',
            arguments: { unresolved: false, value: { route: 'A' } },
            timing: {
              start: { mode: 'immediate', startToleranceMs: 0 },
              maxElapsedMs: null,
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      availabilitySchemaRevision: '1.0',
      results: [{ nodeId: 'patrol', availability: 'available', riskLevel: 'low' }],
    });
    const request = tasksProvider.requests.find(
      (item) => item.method === 'io.sdar/tasks/checkAvailability',
    );
    expect(request).toMatchObject({
      params: {
        revision: '1.0',
        requests: [
          expect.objectContaining({
            nodeId: 'patrol',
            arguments: { unresolved: false, value: { route: 'A' } },
          }),
        ],
      },
      headers: {
        authorization: 'Bearer test',
        'x-sdar-execution-mode': 'simulation',
        'x-sdar-simulation-id': 'simulation-availability-1',
      },
    });
    expect(request?.headers['mcp-name']).toBeUndefined();
    expect(request?.headers['mcp-method']).toBeUndefined();
  });

  it('puts resolved execution metadata outside business arguments and rejects require_task sync', async () => {
    tasksProvider = await startMcpTasksMockProvider();
    adapter = new StreamableHttpMcpAdapter();
    const endpoint = tasksProvider.endpoint.toString();
    const taskExecution = {
      mode: 'require_task' as const,
      availabilityCheck: 'required' as const,
      timing: {
        start: {
          mode: 'scheduled' as const,
          scheduledAt: '2026-07-17T01:00:00.000Z',
          startToleranceMs: 30_000,
        },
        maxElapsedMs: 900_000,
      },
      reservationRef: 'reservation-123',
    };
    await adapter.call({
      endpoint,
      headers: {},
      toolName: 'async_success',
      arguments: {},
      executionContext: { mode: 'live' },
      taskExecution,
    });
    const request = tasksProvider.requests.find(
      (item) => item.method === 'tools/call' && item.params['name'] === 'async_success',
    );
    expect(request?.params).toMatchObject({
      name: 'async_success',
      arguments: {},
      _meta: {
        'io.sdar/taskExecution': {
          revision: '1.0',
          mode: 'require_task',
          timing: taskExecution.timing,
          reservationRef: 'reservation-123',
        },
      },
    });
    expect(request?.params['arguments']).toEqual({});
    await expect(
      adapter.call({
        endpoint,
        headers: {},
        toolName: 'sync_success',
        arguments: {},
        executionContext: { mode: 'live' },
        taskExecution,
      }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_REQUIRED_RESULT_MISMATCH' });
  });

  it('propagates client cancellation to the remote Tool AbortSignal', async () => {
    handle = await startMcpStreamableHttpSpike();
    const controller = new AbortController();
    const call = handle.client.callTool({ name: 'slow_probe', arguments: {} }, undefined, {
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort();
    }, 20);
    await expect(call).rejects.toThrow();
    await expect(
      Promise.race([
        handle.cancellationObserved,
        new Promise<boolean>((resolve) =>
          setTimeout(() => {
            resolve(false);
          }, 2_000),
        ),
      ]),
    ).resolves.toBe(true);
  });
});
