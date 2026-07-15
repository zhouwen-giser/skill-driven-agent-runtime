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
      }),
    });
    const remoteTaskId =
      accepted.kind === 'remote_task' ? accepted.task.remoteTaskId : 'unreachable';
    await expect(adapter.getTask({ endpoint, headers, remoteTaskId })).resolves.toEqual(
      expect.objectContaining({
        remoteTaskId,
        status: 'completed',
        protocolRevision: MCP_TASKS_TESTED_PROTOCOL_REVISION,
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

  it.each(['malformed_task_id', 'unknown_task_status', 'unknown_task_field'])(
    'fails closed for malformed Task response %s',
    async (toolName) => {
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
    },
  );

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
