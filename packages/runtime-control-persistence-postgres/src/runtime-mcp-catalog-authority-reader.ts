import type { Pool, QueryResultRow } from 'pg';
import { z } from 'zod';

import {
  createMcpToolExecutionSemantics,
  DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
  deriveFrozenMcpCatalogAuthority,
  type McpServer,
  type McpTaskExecutionProfile,
  type McpTool,
  type McpToolExecutionSemantics,
} from '../../domain/src/index.js';

export interface RuntimeMcpCatalogAuthority {
  readonly endpoint: string;
  readonly status: McpServer['status'];
  readonly serverUpdatedAt: string;
  readonly snapshotValidUntil: string | undefined;
  readonly toolRevision: number;
  readonly protocolMode: string;
  readonly snapshotToolRevision: number;
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
  readonly discoveredCatalogChecksum: string;
  readonly operationCount: number;
  readonly toolNames: readonly string[];
  readonly executionSemanticsOverrides?: Readonly<Record<string, McpToolExecutionSemantics>>;
}

export interface RuntimeMcpCatalogAuthorityReader {
  loadCurrentAuthority(serverId: string): Promise<RuntimeMcpCatalogAuthority | undefined>;
}

interface RuntimeMcpServerAuthorityRow extends QueryResultRow {
  endpoint: string;
  status: McpServer['status'];
  tool_revision: number;
  updated_at: Date | string;
}

interface RuntimeMcpSnapshotAuthorityRow extends QueryResultRow {
  protocol_mode: string;
  protocol_version: string;
  capabilities_json: unknown;
  server_info_json: unknown;
  tool_revision: number;
  valid_until: Date | string | null;
}

interface RuntimeMcpToolAuthorityRow extends QueryResultRow {
  server_id: string;
  tool_name: string;
  title: string | null;
  description: string | null;
  input_schema_json: unknown;
  output_schema_json: unknown;
  protocol_mode: NonNullable<McpServer['protocolMode']>;
  execution_semantics_json: unknown;
  declared_execution_semantics_json: unknown;
  admin_execution_semantics_override_json?: unknown;
  task_execution_json: unknown;
  discovered_at: Date | string;
}

const McpExecutionSemanticsSchema = z
  .object({
    effect: z.enum(['read_only', 'side_effecting', 'unknown']),
    execution: z.enum(['synchronous', 'task_capable', 'task_required', 'unknown']),
    cancellation: z.enum(['unsupported', 'cooperative', 'task_cancel', 'unknown']),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
    replay: z.enum(['allowed', 'simulation_only', 'forbidden', 'unknown']),
    source: z.enum(['mcp_declared', 'admin_override', 'default_unknown']),
  })
  .strict();

const McpTaskExecutionProfileSchema: z.ZodType<McpTaskExecutionProfile> = z
  .object({
    profileVersion: z.literal('1.0'),
    taskBehavior: z.enum(['synchronous_only', 'server_directed', 'task_required']),
    availability: z.enum(['not_supported', 'dynamic']),
    supportsScheduling: z.boolean(),
    supportsMaxElapsed: z.boolean(),
    supportsCancellation: z.boolean().optional(),
    supportsPauseResume: z.boolean().optional(),
    supportsObservations: z.boolean(),
    supportsInputRequired: z.boolean(),
    idempotency: z.enum(['none', 'client_request_key', 'server_managed', 'unknown']),
  })
  .strict();
const McpProviderCatalogIdentitySchema = z
  .object({
    providerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    providerType: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    providerVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u),
    manifestHash: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

/**
 * Loads one coherent Runtime MCP catalog authority under a read-only repeatable-read
 * transaction. No Runtime mutation repository or credential column crosses this boundary.
 */
export class PostgresRuntimeMcpCatalogAuthorityReader implements RuntimeMcpCatalogAuthorityReader {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async loadCurrentAuthority(serverId: string): Promise<RuntimeMcpCatalogAuthority | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const serverResult = await client.query<RuntimeMcpServerAuthorityRow>(
        `SELECT endpoint,status,tool_revision,updated_at
           FROM mcp_server WHERE server_id=$1`,
        [serverId],
      );
      const snapshotResult = await client.query<RuntimeMcpSnapshotAuthorityRow>(
        `SELECT snapshot.protocol_mode,snapshot.protocol_version,snapshot.capabilities_json,
                snapshot.server_info_json,snapshot.tool_revision,snapshot.valid_until
           FROM mcp_server server
           JOIN mcp_protocol_snapshot snapshot
             ON snapshot.snapshot_id=server.current_protocol_snapshot_id
          WHERE server.server_id=$1`,
        [serverId],
      );
      const toolsResult = await client.query<RuntimeMcpToolAuthorityRow>(
        `SELECT tool.server_id,tool.tool_name,tool.title,tool.description,
                tool.input_schema_json,tool.output_schema_json,server.protocol_mode,
                tool.execution_semantics_json,tool.declared_execution_semantics_json,
                tool.admin_execution_semantics_override_json,
                tool.task_execution_json,tool.discovered_at
           FROM mcp_tool tool
           JOIN mcp_server server ON server.server_id=tool.server_id
          WHERE tool.server_id=$1
          ORDER BY tool.tool_name`,
        [serverId],
      );
      const server = serverResult.rows[0];
      const snapshot = snapshotResult.rows[0];
      const authority =
        server === undefined || snapshot === undefined
          ? undefined
          : mapAuthority(server, snapshot, toolsResult.rows);
      await client.query('COMMIT');
      return authority;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapAuthority(
  server: RuntimeMcpServerAuthorityRow,
  snapshot: RuntimeMcpSnapshotAuthorityRow,
  toolRows: readonly RuntimeMcpToolAuthorityRow[],
): RuntimeMcpCatalogAuthority {
  const tools = Object.freeze(toolRows.map(mapTool));
  const providerCatalog = providerCatalogFromCapabilities(snapshot.capabilities_json);
  const catalogSnapshot = {
    protocolVersion: snapshot.protocol_version,
    serverInfo: Object.freeze(z.record(z.string(), z.unknown()).parse(snapshot.server_info_json)),
    ...(providerCatalog === undefined ? {} : { providerCatalog }),
  };
  const catalog = deriveFrozenMcpCatalogAuthority(catalogSnapshot, tools, server.tool_revision);
  const discoveredCatalog = deriveFrozenMcpCatalogAuthority(
    catalogSnapshot,
    toolRows.map(mapDiscoveredTool),
    server.tool_revision,
  );
  return Object.freeze({
    endpoint: server.endpoint,
    status: server.status,
    serverUpdatedAt: toIsoString(server.updated_at),
    snapshotValidUntil:
      snapshot.valid_until === null ? undefined : toIsoString(snapshot.valid_until),
    toolRevision: server.tool_revision,
    protocolMode: snapshot.protocol_mode,
    snapshotToolRevision: snapshot.tool_revision,
    catalogRevision: catalog.catalogRevision,
    catalogChecksum: catalog.catalogChecksum,
    discoveredCatalogChecksum: discoveredCatalog.catalogChecksum,
    operationCount: catalog.operationCount,
    toolNames: Object.freeze(tools.map((tool) => tool.toolName)),
    executionSemanticsOverrides: Object.freeze(
      Object.fromEntries(
        toolRows.flatMap((row) => {
          const value = row.admin_execution_semantics_override_json;
          if (value === null || value === undefined) return [];
          const semantics = McpExecutionSemanticsSchema.parse(value);
          if (semantics.source !== 'admin_override')
            throw new Error('MCP_RUNTIME_ADMIN_OVERRIDE_SOURCE_INVALID');
          return [[row.tool_name, createMcpToolExecutionSemantics(semantics, 'admin_override')]];
        }),
      ),
    ),
  });
}

function providerCatalogFromCapabilities(value: unknown) {
  const capabilities = z.record(z.string(), z.unknown()).parse(value);
  const extensions = z.record(z.string(), z.unknown()).optional().parse(capabilities['extensions']);
  const providerCatalog = extensions?.['io.sdar/providerCatalog'];
  return providerCatalog === undefined
    ? undefined
    : Object.freeze(McpProviderCatalogIdentitySchema.parse(providerCatalog));
}

function mapDiscoveredTool(row: RuntimeMcpToolAuthorityRow): McpTool {
  const effective =
    row.declared_execution_semantics_json === null
      ? DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS
      : createMcpToolExecutionSemantics(
          McpExecutionSemanticsSchema.parse(row.declared_execution_semantics_json),
          'mcp_declared',
        );
  return Object.freeze({ ...mapTool(row), executionSemantics: effective });
}

function mapTool(row: RuntimeMcpToolAuthorityRow): McpTool {
  const semantics = McpExecutionSemanticsSchema.parse(row.execution_semantics_json);
  return Object.freeze({
    serverId: row.server_id,
    toolName: row.tool_name,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.description === null ? {} : { description: row.description }),
    inputSchema: row.input_schema_json,
    ...(row.output_schema_json === null ? {} : { outputSchema: row.output_schema_json }),
    protocolMode: row.protocol_mode,
    executionSemantics: createMcpToolExecutionSemantics(semantics, semantics.source),
    taskExecutionProfile: McpTaskExecutionProfileSchema.parse(row.task_execution_json),
    discoveredAt: toIsoString(row.discovered_at),
  });
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return date.toISOString();
}
