import { z } from 'zod';

import type { FrozenMcpDiscoveryPort } from '../../application/src/index.js';
import {
  createMcpTool,
  createMcpToolExecutionSemantics,
  type McpToolExecutionSemantics,
} from '../../domain/src/index.js';

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
const SDAR_EXECUTION_SEMANTICS_META_KEY = 'io.sdar/tool-execution-semantics';
const executionSemanticsValuesSchema = z
  .object({
    effect: z.enum(['read_only', 'side_effecting', 'unknown']),
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
    replay: z.enum(['allowed', 'simulation_only', 'forbidden', 'unknown']),
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
      const declaredExecutionSemantics = parseDeclaredExecutionSemantics(tool._meta);
      return createMcpTool({
        serverId: input.server.serverId,
        toolName: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        protocolMode: 'frozen_v1',
        ...(declaredExecutionSemantics === undefined ? {} : { declaredExecutionSemantics }),
        taskExecutionProfile: parseFrozenTaskExecutionProfile(tool._meta),
        discoveredAt: input.discoveredAt,
      });
    });
    return Object.freeze({ snapshot, tools: Object.freeze(tools) });
  }
}

function parseDeclaredExecutionSemantics(
  metadata: Readonly<Record<string, unknown>>,
): McpToolExecutionSemantics | undefined {
  if (!Object.prototype.hasOwnProperty.call(metadata, SDAR_EXECUTION_SEMANTICS_META_KEY))
    return undefined;
  const parsed = executionSemanticsValuesSchema.safeParse(
    metadata[SDAR_EXECUTION_SEMANTICS_META_KEY],
  );
  if (!parsed.success)
    throw new FrozenV1RegistryError(
      'FROZEN_TOOLS_DISCOVERY_INVALID',
      'Frozen Tool execution semantics declaration must contain exactly five valid fields.',
    );
  return createMcpToolExecutionSemantics(parsed.data, 'mcp_declared');
}

export class FrozenV1RegistryError extends Error {
  readonly code: 'FROZEN_TOOLS_DISCOVERY_INVALID';
  constructor(code: 'FROZEN_TOOLS_DISCOVERY_INVALID', message: string) {
    super(message);
    this.name = 'FrozenV1RegistryError';
    this.code = code;
  }
}
