import { z } from 'zod';

import type { FrozenMcpDiscoveryPort } from '../../application/src/index.js';
import { createMcpTool, DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS } from '../../domain/src/index.js';

import { parseFrozenTaskExecutionProfile } from './frozen-v1-availability.js';
import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

const toolSchema = z
  .object({
    name: z.string().min(1).max(256),
    title: z.string().min(1).max(512).optional(),
    description: z.string().max(8192).optional(),
    inputSchema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
    outputSchema: z.union([z.boolean(), z.record(z.string(), z.unknown())]),
    _meta: z.record(z.string(), z.unknown()),
  })
  .strict();
const listToolsSchema = z
  .object({
    tools: z.array(toolSchema).max(1024),
    nextCursor: z.string().optional(),
  })
  .strict();

export class FrozenV1RegistryAdapter implements FrozenMcpDiscoveryPort {
  readonly #client: FrozenV1McpClient;

  constructor(client: FrozenV1McpClient = new FrozenV1McpClient()) {
    this.#client = client;
  }

  async discover(input: Parameters<FrozenMcpDiscoveryPort['discover']>[0]) {
    const snapshot = await this.#client.discoverSnapshot({
      endpoint: input.server.endpoint,
      headers: input.headers,
      snapshotId: input.snapshotId,
      serverId: input.server.serverId,
      baselineSha256: input.baselineSha256,
      discoveredAt: input.discoveredAt,
      toolRevision: input.server.toolRevision,
    });
    const parsed = listToolsSchema.safeParse(
      await this.#client.request({
        endpoint: input.server.endpoint,
        headers: input.headers,
        method: 'tools/list',
        params: {},
      }),
    );
    if (!parsed.success || parsed.data.nextCursor !== undefined)
      throw new FrozenV1RegistryError(
        'FROZEN_TOOLS_DISCOVERY_INVALID',
        'Frozen tools/list must return one bounded complete Tool catalog.',
      );
    const names = new Set<string>();
    const tools = parsed.data.tools.map((tool) => {
      if (names.has(tool.name))
        throw new FrozenV1RegistryError(
          'FROZEN_TOOLS_DISCOVERY_INVALID',
          'Frozen tools/list contains duplicate Tool names.',
        );
      names.add(tool.name);
      return createMcpTool({
        serverId: input.server.serverId,
        toolName: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        protocolMode: 'frozen_v1',
        executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
        taskExecutionProfile: parseFrozenTaskExecutionProfile(tool._meta),
        discoveredAt: input.discoveredAt,
      });
    });
    return Object.freeze({ snapshot, tools: Object.freeze(tools) });
  }
}

export class FrozenV1RegistryError extends Error {
  readonly code: 'FROZEN_TOOLS_DISCOVERY_INVALID';
  constructor(code: 'FROZEN_TOOLS_DISCOVERY_INVALID', message: string) {
    super(message);
    this.name = 'FrozenV1RegistryError';
    this.code = code;
  }
}
