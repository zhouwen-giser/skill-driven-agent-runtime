import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';
import type { RuntimeExecutionMode } from './runtime-execution.js';

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

export type McpToolEffect = 'read_only' | 'side_effecting' | 'unknown';
export type McpToolExecution = 'synchronous' | 'task_capable' | 'task_required' | 'unknown';
export type McpToolCancellation = 'unsupported' | 'cooperative' | 'task_cancel' | 'unknown';
export type McpToolIdempotency = 'none' | 'client_request_key' | 'server_managed' | 'unknown';
export type McpToolReplay = 'allowed' | 'simulation_only' | 'forbidden' | 'unknown';
export type McpToolExecutionSemanticsSource = 'mcp_declared' | 'admin_override' | 'default_unknown';

export interface McpToolExecutionSemantics {
  readonly effect: McpToolEffect;
  readonly execution: McpToolExecution;
  readonly cancellation: McpToolCancellation;
  readonly idempotency: McpToolIdempotency;
  readonly replay: McpToolReplay;
  readonly source: McpToolExecutionSemanticsSource;
}

export type McpToolExecutionSemanticsValues = Omit<McpToolExecutionSemantics, 'source'>;

export const DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS: McpToolExecutionSemantics = Object.freeze({
  effect: 'unknown',
  execution: 'unknown',
  cancellation: 'unknown',
  idempotency: 'unknown',
  replay: 'unknown',
  source: 'default_unknown',
});

export interface McpTool {
  readonly serverId: string;
  readonly toolName: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: unknown;
  readonly enhancement?: McpToolEnhancement;
  readonly executionSemantics: McpToolExecutionSemantics;
  readonly declaredExecutionSemantics?: McpToolExecutionSemantics;
  readonly adminExecutionSemanticsOverride?: McpToolExecutionSemantics;
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
  readonly executionMode: RuntimeExecutionMode;
  readonly simulationId?: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly executionSemantics: McpToolExecutionSemantics;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly status: McpInvocationStatus;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export type McpManagementOperationType =
  | 'register'
  | 'refresh'
  | 'health_check'
  | 'credentials_update'
  | 'tool_metadata_update'
  | 'tool_semantics_override'
  | 'delete';

export interface McpManagementOperation {
  readonly operationId: string;
  readonly serverId: string;
  readonly operationType: McpManagementOperationType;
  readonly actor: 'anonymous-management';
  readonly target?: string;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
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

export function createMcpTool(
  input: Omit<McpTool, 'executionSemantics'> &
    Readonly<{ executionSemantics?: McpToolExecutionSemantics }>,
): McpTool {
  const serverId = requireIdentifier(input.serverId, 'MCP_SERVER_ID_REQUIRED');
  const toolName = input.toolName.trim();
  if (toolName === '')
    throw new DomainError('MCP_TOOL_NAME_REQUIRED', 'MCP Tool name is required.');
  const declared =
    input.declaredExecutionSemantics === undefined
      ? undefined
      : createMcpToolExecutionSemantics(input.declaredExecutionSemantics, 'mcp_declared');
  const adminOverride =
    input.adminExecutionSemanticsOverride === undefined
      ? undefined
      : createMcpToolExecutionSemantics(input.adminExecutionSemanticsOverride, 'admin_override');
  const executionSemantics = resolveMcpToolExecutionSemantics(declared, adminOverride);
  if (
    input.executionSemantics !== undefined &&
    !sameMcpToolExecutionSemantics(input.executionSemantics, executionSemantics)
  ) {
    throw new DomainError(
      'MCP_TOOL_EXECUTION_SEMANTICS_INCONSISTENT',
      'Effective MCP Tool execution semantics do not match authoritative sources.',
    );
  }
  return {
    ...input,
    serverId,
    toolName,
    executionSemantics,
    ...(declared === undefined ? {} : { declaredExecutionSemantics: declared }),
    ...(adminOverride === undefined ? {} : { adminExecutionSemanticsOverride: adminOverride }),
  };
}

export function createMcpToolExecutionSemantics(
  input: McpToolExecutionSemanticsValues | McpToolExecutionSemantics,
  source: McpToolExecutionSemanticsSource,
): McpToolExecutionSemantics {
  const semantics = { ...input, source };
  if (
    !(['read_only', 'side_effecting', 'unknown'] as const).includes(semantics.effect) ||
    !(['synchronous', 'task_capable', 'task_required', 'unknown'] as const).includes(
      semantics.execution,
    ) ||
    !(['unsupported', 'cooperative', 'task_cancel', 'unknown'] as const).includes(
      semantics.cancellation,
    ) ||
    !(['none', 'client_request_key', 'server_managed', 'unknown'] as const).includes(
      semantics.idempotency,
    ) ||
    !(['allowed', 'simulation_only', 'forbidden', 'unknown'] as const).includes(semantics.replay)
  ) {
    throw new DomainError(
      'MCP_TOOL_EXECUTION_SEMANTICS_INVALID',
      'MCP Tool execution semantics contain an unsupported value.',
    );
  }
  if (
    source === 'default_unknown' &&
    (semantics.effect !== 'unknown' ||
      semantics.execution !== 'unknown' ||
      semantics.cancellation !== 'unknown' ||
      semantics.idempotency !== 'unknown' ||
      semantics.replay !== 'unknown')
  ) {
    throw new DomainError(
      'MCP_TOOL_EXECUTION_SEMANTICS_INVALID',
      'Default MCP Tool execution semantics must remain conservatively unknown.',
    );
  }
  return Object.freeze(semantics);
}

export function resolveMcpToolExecutionSemantics(
  declared?: McpToolExecutionSemantics,
  adminOverride?: McpToolExecutionSemantics,
): McpToolExecutionSemantics {
  if (declared !== undefined) return createMcpToolExecutionSemantics(declared, 'mcp_declared');
  if (adminOverride !== undefined)
    return createMcpToolExecutionSemantics(adminOverride, 'admin_override');
  return DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS;
}

export function withMcpToolAdminExecutionSemanticsOverride(
  tool: McpTool,
  adminOverride: McpToolExecutionSemantics,
): McpTool {
  return createMcpTool({
    serverId: tool.serverId,
    toolName: tool.toolName,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.enhancement === undefined ? {} : { enhancement: tool.enhancement }),
    ...(tool.declaredExecutionSemantics === undefined
      ? {}
      : { declaredExecutionSemantics: tool.declaredExecutionSemantics }),
    adminExecutionSemanticsOverride: adminOverride,
    discoveredAt: tool.discoveredAt,
  });
}

function sameMcpToolExecutionSemantics(
  left: McpToolExecutionSemantics,
  right: McpToolExecutionSemantics,
): boolean {
  return (
    left.effect === right.effect &&
    left.execution === right.execution &&
    left.cancellation === right.cancellation &&
    left.idempotency === right.idempotency &&
    left.replay === right.replay &&
    left.source === right.source
  );
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
