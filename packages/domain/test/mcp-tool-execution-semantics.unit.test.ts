import { describe, expect, it } from 'vitest';

import {
  createMcpTool,
  createMcpToolExecutionSemantics,
  DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
  type McpToolExecutionSemanticsValues,
} from '../src/index.js';

const values = {
  effect: 'read_only',
  execution: 'task_capable',
  cancellation: 'task_cancel',
  idempotency: 'client_request_key',
  replay: 'allowed',
} as const;

describe('MCP Tool execution semantics', () => {
  it('uses MCP declaration, then administrator override, then conservative unknown', () => {
    const declared = createMcpTool({
      serverId: 'mcp.devices',
      toolName: 'status',
      inputSchema: { type: 'object' },
      declaredExecutionSemantics: createMcpToolExecutionSemantics(values, 'mcp_declared'),
      adminExecutionSemanticsOverride: createMcpToolExecutionSemantics(
        { ...values, replay: 'forbidden' },
        'admin_override',
      ),
      discoveredAt: '2026-07-16T00:00:00.000Z',
    });
    const overridden = createMcpTool({
      serverId: declared.serverId,
      toolName: declared.toolName,
      inputSchema: declared.inputSchema,
      adminExecutionSemanticsOverride: createMcpToolExecutionSemantics(
        { ...values, replay: 'forbidden' },
        'admin_override',
      ),
      discoveredAt: declared.discoveredAt,
    });
    const unknown = createMcpTool({
      serverId: 'mcp.devices',
      toolName: 'undeclared',
      inputSchema: { type: 'object' },
      discoveredAt: '2026-07-16T00:00:00.000Z',
    });

    expect(declared.executionSemantics).toEqual({ ...values, source: 'mcp_declared' });
    expect(overridden.executionSemantics).toEqual({
      ...values,
      replay: 'forbidden',
      source: 'admin_override',
    });
    expect(unknown.executionSemantics).toEqual(DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS);
  });

  it('rejects unsupported and inconsistent persisted semantics', () => {
    expect(() =>
      createMcpToolExecutionSemantics(
        { ...values, replay: 'execute_again' } as unknown as McpToolExecutionSemanticsValues,
        'admin_override',
      ),
    ).toThrow(expect.objectContaining({ code: 'MCP_TOOL_EXECUTION_SEMANTICS_INVALID' }));

    expect(() =>
      createMcpTool({
        serverId: 'mcp.devices',
        toolName: 'status',
        inputSchema: { type: 'object' },
        declaredExecutionSemantics: createMcpToolExecutionSemantics(values, 'mcp_declared'),
        executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
        discoveredAt: '2026-07-16T00:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'MCP_TOOL_EXECUTION_SEMANTICS_INCONSISTENT' }));
  });

  it('rejects contradictory default authority and freezes accepted snapshots', () => {
    expect(() => createMcpToolExecutionSemantics(values, 'default_unknown')).toThrow(
      expect.objectContaining({ code: 'MCP_TOOL_EXECUTION_SEMANTICS_INVALID' }),
    );

    expect(Object.isFrozen(createMcpToolExecutionSemantics(values, 'mcp_declared'))).toBe(true);
  });
});
