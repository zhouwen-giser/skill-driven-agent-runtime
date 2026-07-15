import { afterEach, describe, expect, it } from 'vitest';

import {
  startMcpLoopbackServer,
  startMcpStreamableHttpSpike,
  type McpLoopbackServerHandle,
  type McpSpikeHandle,
} from '../src/streamable-http-spike.js';
import { StreamableHttpMcpAdapter } from '../src/streamable-http-adapter.js';

describe('official MCP Streamable HTTP transport', () => {
  let handle: McpSpikeHandle | undefined;
  let server: McpLoopbackServerHandle | undefined;
  let adapter: StreamableHttpMcpAdapter | undefined;

  afterEach(async () => {
    await handle?.close();
    await adapter?.close();
    await server?.close();
    handle = undefined;
    server = undefined;
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
    expect(result).toEqual(
      expect.objectContaining({ structuredContent: { deviceId: 'device-42', status: 'online' } }),
    );
  });

  it('delivers runtime-owned simulation Headers to the real MCP HTTP server', async () => {
    server = await startMcpLoopbackServer();
    adapter = new StreamableHttpMcpAdapter();
    await adapter.call({
      endpoint: server.endpoint.toString(),
      headers: {
        Authorization: 'Bearer secret',
        'X-SDAR-Execution-Mode': 'simulation',
        'X-SDAR-Simulation-Id': 'simulation-real-1',
      },
      toolName: 'device_status',
      arguments: { deviceId: 'device-42' },
      executionContext: { mode: 'simulation', simulationId: 'simulation-real-1' },
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
