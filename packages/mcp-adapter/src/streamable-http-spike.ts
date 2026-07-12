import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server as HttpServer } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

export interface McpSpikeHandle {
  readonly client: Client;
  readonly endpoint: URL;
  readonly cancellationObserved: Promise<boolean>;
  close(): Promise<void>;
}

export interface McpLoopbackServerHandle {
  readonly endpoint: URL;
  readonly cancellationObserved: Promise<boolean>;
  close(): Promise<void>;
}

export async function startMcpStreamableHttpSpike(): Promise<McpSpikeHandle> {
  const server = await startMcpLoopbackServer();
  const clientTransport = new StreamableHTTPClientTransport(server.endpoint);
  const client = new Client({ name: 'sdar-mcp-spike-client', version: '0.0.0' });
  await client.connect(asSdkTransport(clientTransport));
  return {
    client,
    endpoint: server.endpoint,
    cancellationObserved: server.cancellationObserved,
    async close(): Promise<void> {
      await client.close();
      await server.close();
    },
  };
}

export async function startMcpLoopbackServer(): Promise<McpLoopbackServerHandle> {
  let reportCancellation: (observed: boolean) => void = () => undefined;
  const cancellationObserved = new Promise<boolean>((resolve) => {
    reportCancellation = resolve;
  });
  const mcpServer = new McpServer({ name: 'sdar-mock-mcp', version: '0.0.0' });
  mcpServer.registerTool(
    'device_status',
    {
      description: 'Returns deterministic read-only device status.',
      inputSchema: {
        deviceId: z.string().min(1),
        delayMs: z.number().int().nonnegative().optional(),
      },
    },
    async ({ deviceId, delayMs }) => {
      if (delayMs !== undefined)
        await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
      return {
        content: [{ type: 'text', text: JSON.stringify({ deviceId, status: 'online' }) }],
        structuredContent: { deviceId, status: 'online' },
      };
    },
  );
  mcpServer.registerTool(
    'slow_probe',
    {
      description: 'Waits until the client cancels, for transport cancellation verification.',
      inputSchema: {},
    },
    async (_input, extra) => {
      await new Promise<void>((resolve) => {
        if (extra.signal.aborted) {
          reportCancellation(true);
          resolve();
          return;
        }
        extra.signal.addEventListener(
          'abort',
          () => {
            reportCancellation(true);
            resolve();
          },
          { once: true },
        );
      });
      return { content: [{ type: 'text', text: 'canceled' }], isError: true };
    },
  );

  const serverTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcpServer.connect(asSdkTransport(serverTransport));

  const httpServer = createServer((request, response) => {
    void serverTransport.handleRequest(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : 'Unknown MCP transport error');
    });
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');

  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    await closeHttpServer(httpServer);
    throw new Error('MCP_SPIKE_ADDRESS_UNAVAILABLE');
  }

  const endpoint = new URL(`http://127.0.0.1:${String(address.port)}/mcp`);
  return {
    endpoint,
    cancellationObserved,
    async close(): Promise<void> {
      await mcpServer.close();
      await closeHttpServer(httpServer);
    },
  };
}

// SDK 1.29.0's concrete transports declare optional callback properties as `T | undefined`,
// while its Transport interface declares them as exact optional properties. Runtime behavior is
// verified by the loopback contract tests; keep this compatibility cast inside the adapter only.
function asSdkTransport(transport: unknown): Transport {
  return transport as Transport;
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}
