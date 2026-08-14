import { describe, expect, it } from 'vitest';

import type { McpServer } from '../../domain/src/index.js';
import { FrozenV1McpClient, FrozenV1RegistryAdapter } from '../src/index.js';

describe('Frozen V1 registry adapter', () => {
  it('discovers the Frozen profile and complete Tool catalog without initialize', async () => {
    const methods: string[] = [];
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequest(init);
      methods.push(body.method);
      return Promise.resolve(
        Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: body.method === 'server/discover' ? discovery() : tools(),
        }),
      );
    });
    const result = await new FrozenV1RegistryAdapter(client).discover({
      server: server,
      headers: { Authorization: 'Bearer secret' },
      snapshotId: 'snapshot-1',
      baselineSha256: 'a'.repeat(64),
      discoveredAt: '2026-07-19T03:00:00.000Z',
    });

    expect(methods).toEqual(['server/discover', 'tools/list']);
    expect(methods).not.toContain('initialize');
    expect(result.tools).toEqual([
      expect.objectContaining({
        toolName: 'move_to',
        protocolMode: 'frozen_v1',
        outputSchema: { type: 'object' },
        executionSemantics: {
          effect: 'unknown',
          execution: 'unknown',
          cancellation: 'unknown',
          idempotency: 'unknown',
          replay: 'unknown',
          source: 'default_unknown',
        },
        taskExecutionProfile: expect.objectContaining({ taskBehavior: 'task_required' }),
      }),
    ]);
  });

  it('retains a complete exact Frozen Tool execution-semantics declaration', async () => {
    const result = await discoverTools(
      tools({
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'allowed',
      }),
    );

    expect(result.tools[0]).toMatchObject({
      declaredExecutionSemantics: {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'allowed',
        source: 'mcp_declared',
      },
      executionSemantics: {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'allowed',
        source: 'mcp_declared',
      },
    });
  });

  it.each([
    [{ effect: 'read_only' }, 'incomplete'],
    [
      {
        effect: 'unsafe',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'allowed',
      },
      'unsupported value',
    ],
    [
      {
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'cooperative',
        idempotency: 'client_request_key',
        replay: 'allowed',
        inferred: true,
      },
      'extra field',
    ],
  ])(
    'fails the complete discovery for malformed exact semantics: %s (%s)',
    async (value, _label) => {
      void _label;
      await expect(discoverTools(tools(value))).rejects.toMatchObject({
        code: 'FROZEN_TOOLS_DISCOVERY_INVALID',
      });
    },
  );

  it.each([
    [{ ...tools(), nextCursor: 'more' }, 'pagination'],
    [{ tools: [tools().tools[0], tools().tools[0]] }, 'duplicates'],
    [{ tools: [{ ...tools().tools[0], outputSchema: undefined }] }, 'output schema'],
  ])('fails closed for invalid Tool catalog: %s (%s)', async (toolResult, _label) => {
    void _label;
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequest(init);
      return Promise.resolve(
        Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: body.method === 'server/discover' ? discovery() : toolResult,
        }),
      );
    });
    await expect(
      new FrozenV1RegistryAdapter(client).discover({
        server,
        headers: {},
        snapshotId: 'snapshot-1',
        baselineSha256: 'a'.repeat(64),
        discoveredAt: '2026-07-19T03:00:00.000Z',
      }),
    ).rejects.toBeDefined();
  });
});

const server: McpServer = {
  serverId: 'provider-1',
  name: 'Provider 1',
  endpoint: 'https://provider.test/mcp',
  transport: 'streamable_http',
  status: 'enabled',
  toolRevision: 1,
  protocolMode: 'frozen_v1',
  createdAt: '2026-07-19T03:00:00.000Z',
  updatedAt: '2026-07-19T03:00:00.000Z',
};

function discovery() {
  return {
    resultType: 'complete',
    supportedVersions: ['2026-07-28'],
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/tasks': {},
        'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
      },
    },
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Provider 1', version: '1.0.0' } },
  };
}

function tools(executionSemantics?: unknown) {
  return {
    tools: [
      {
        name: 'move_to',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        _meta: {
          'io.sdar/taskExecution': {
            profileVersion: '1.0',
            taskBehavior: 'task_required',
            availability: 'dynamic',
            supportsScheduling: true,
            supportsMaxElapsed: true,
            supportsObservations: true,
            supportsInputRequired: true,
            idempotency: 'client_request_key',
          },
          ...(executionSemantics === undefined
            ? {}
            : { 'io.sdar/tool-execution-semantics': executionSemantics }),
        },
      },
    ],
  };
}

function discoverTools(toolResult: ReturnType<typeof tools>) {
  const client = new FrozenV1McpClient((_url, init) => {
    const body = parseRequest(init);
    return Promise.resolve(
      Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: body.method === 'server/discover' ? discovery() : toolResult,
      }),
    );
  });
  return new FrozenV1RegistryAdapter(client).discover({
    server,
    headers: {},
    snapshotId: 'snapshot-1',
    baselineSha256: 'a'.repeat(64),
    discoveredAt: '2026-07-19T03:00:00.000Z',
  });
}

function parseRequest(init: RequestInit | undefined): { id: number; method: string } {
  if (typeof init?.body !== 'string') throw new TypeError('Expected serialized request body.');
  return JSON.parse(init.body) as { id: number; method: string };
}
