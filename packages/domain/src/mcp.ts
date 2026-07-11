import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type McpTransportKind = 'streamable_http';
export type McpServerStatus = 'enabled' | 'disabled' | 'unreachable';

export interface McpServer {
  readonly serverId: string;
  readonly name: string;
  readonly endpoint: string;
  readonly transport: McpTransportKind;
  readonly status: McpServerStatus;
  readonly toolRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface McpToolEnhancement {
  readonly purpose: string;
  readonly scenarios: readonly string[];
  readonly constraints: readonly string[];
  readonly returnDescription: string;
  readonly commonErrors: readonly string[];
  readonly tags: readonly string[];
}

export interface McpTool {
  readonly serverId: string;
  readonly toolName: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: unknown;
  readonly enhancement?: McpToolEnhancement;
  readonly discoveredAt: string;
}

export type McpDependencyWarningReason = 'removed' | 'schema_changed';
export interface McpToolDependencyChange {
  readonly toolName: string;
  readonly reason: McpDependencyWarningReason;
}
export interface McpDependencyWarning {
  readonly warningId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly reason: McpDependencyWarningReason;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly toolRevision: number;
  readonly createdAt: string;
  readonly acknowledgedAt?: string;
}

export type McpInvocationStatus = 'succeeded' | 'failed' | 'canceled';
export interface McpInvocation {
  readonly invocationId: string;
  readonly taskId?: string;
  readonly contextId?: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly status: McpInvocationStatus;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export function createMcpServer(input: McpServer): McpServer {
  const serverId = requireIdentifier(input.serverId, 'MCP_SERVER_ID_REQUIRED');
  const name = input.name.trim();
  if (name === '')
    throw new DomainError('MCP_SERVER_NAME_REQUIRED', 'MCP Server name is required.');
  const endpoint = parseRemoteEndpoint(input.endpoint);
  if (!Number.isInteger(input.toolRevision) || input.toolRevision < 1) {
    throw new DomainError('MCP_TOOL_REVISION_INVALID', 'MCP Tool revision must be positive.');
  }
  return { ...input, serverId, name, endpoint };
}

export function createMcpTool(input: McpTool): McpTool {
  const serverId = requireIdentifier(input.serverId, 'MCP_SERVER_ID_REQUIRED');
  const toolName = input.toolName.trim();
  if (toolName === '')
    throw new DomainError('MCP_TOOL_NAME_REQUIRED', 'MCP Tool name is required.');
  return { ...input, serverId, toolName };
}

export function createMcpToolEnhancement(input: McpToolEnhancement): McpToolEnhancement {
  const purpose = input.purpose.trim();
  const returnDescription = input.returnDescription.trim();
  if (purpose === '' || returnDescription === '') {
    throw new DomainError(
      'MCP_TOOL_ENHANCEMENT_INVALID',
      'Tool enhancement purpose and return description are required.',
    );
  }
  return {
    purpose,
    scenarios: normalizeTextList(input.scenarios),
    constraints: normalizeTextList(input.constraints),
    returnDescription,
    commonErrors: normalizeTextList(input.commonErrors),
    tags: normalizeTextList(input.tags),
  };
}

function normalizeTextList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

function parseRemoteEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new DomainError('MCP_ENDPOINT_INVALID', 'MCP endpoint must be an absolute HTTP URL.');
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new DomainError('MCP_ENDPOINT_INVALID', 'Only remote HTTP MCP endpoints are supported.');
  }
  return endpoint.toString();
}
