import { afterEach, describe, expect, it } from 'vitest';

import { startMcpStreamableHttpSpike, type McpSpikeHandle } from '../src/streamable-http-spike.js';

describe('official MCP Streamable HTTP transport', () => {
  let handle: McpSpikeHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
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
