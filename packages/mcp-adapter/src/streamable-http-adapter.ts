import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { McpTransportAdapter } from '../../application/src/index.js';
import type { RuntimeExecutionContext } from '../../domain/src/index.js';

export class StreamableHttpMcpAdapter implements McpTransportAdapter {
  readonly #clients = new Map<string, Promise<Client>>();

  async discover(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    return this.#withClient(input, async (client) => {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
      }));
    });
  }

  async call(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      toolName: string;
      arguments: Readonly<Record<string, unknown>>;
      executionContext: RuntimeExecutionContext;
      signal?: AbortSignal;
    }>,
  ): Promise<unknown> {
    return this.#withClient(input, (client) =>
      client.callTool(
        { name: input.toolName, arguments: input.arguments },
        undefined,
        input.signal === undefined ? undefined : { signal: input.signal },
      ),
    );
  }

  async #withClient<T>(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const client = await this.#getClient(input);
    return operation(client);
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(this.#clients.values());
    this.#clients.clear();
    await Promise.all(
      clients.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : [])),
    );
  }

  async disconnect(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void> {
    const key = clientKey(input);
    const client = this.#clients.get(key);
    this.#clients.delete(key);
    if (client !== undefined) await (await client).close();
  }

  async ping(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void> {
    const client = await this.#getClient(input);
    await client.ping();
  }

  #getClient(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    const key = clientKey(input);
    const existing = this.#clients.get(key);
    if (existing !== undefined) return existing;
    const connecting = this.#connect(input).catch((error: unknown) => {
      this.#clients.delete(key);
      throw error;
    });
    this.#clients.set(key, connecting);
    return connecting;
  }

  async #connect(input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>) {
    const transport = new StreamableHTTPClientTransport(new URL(input.endpoint), {
      requestInit: { headers: { ...input.headers } },
    });
    const client = new Client({ name: 'sdar-runtime', version: '1.0.0' });
    await client.connect(asSdkTransport(transport));
    return client;
  }
}

function clientKey(
  input: Readonly<{
    endpoint: string;
    headers: Readonly<Record<string, string>>;
  }>,
): string {
  return JSON.stringify([input.endpoint, Object.entries(input.headers).sort()]);
}

// SDK 1.29.0 has an exact-optional mismatch between concrete transports and Transport.
// The cast stays inside this adapter and loopback contract tests verify runtime behavior.
function asSdkTransport(transport: unknown): Transport {
  return transport as Transport;
}
