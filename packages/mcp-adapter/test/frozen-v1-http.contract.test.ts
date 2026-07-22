import { describe, expect, it } from 'vitest';

import {
  FROZEN_MCP_PROTOCOL_VERSION,
  FrozenMcpProtocolError,
  FrozenV1McpClient,
} from '../src/index.js';

const endpoint = 'https://provider.example.test/mcp';

describe('Frozen V1 stateless HTTP client', () => {
  it('discovers without initialize and sends normative per-request metadata and headers', async () => {
    const requests: { body: Record<string, unknown>; headers: Headers }[] = [];
    const client = new FrozenV1McpClient((_url, init) => {
      requests.push({
        body: parseRequestBody(init),
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(jsonResponse(discoveryResult()));
    });

    const snapshot = await client.discoverSnapshot({
      endpoint,
      headers: { Authorization: 'Bearer configured-secret' },
      snapshotId: 'snapshot-1',
      serverId: 'provider-1',
      baselineSha256: 'a'.repeat(64),
      discoveredAt: '2026-07-18T00:00:00.000Z',
      toolRevision: 1,
    });

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.body['method']).toBe('server/discover');
    expect(JSON.stringify(requests)).not.toContain('initialize');
    expect(request?.headers.get('accept')).toBe('application/json, text/event-stream');
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(request?.headers.get('mcp-protocol-version')).toBe(FROZEN_MCP_PROTOCOL_VERSION);
    expect(request?.headers.get('mcp-method')).toBe('server/discover');
    expect(request?.headers.has('mcp-name')).toBe(false);
    expect(request?.headers.get('authorization')).toBe('Bearer configured-secret');
    expect(request?.body).toMatchObject({
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': FROZEN_MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'sdar', version: '1.2.1' },
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { 'io.modelcontextprotocol/tasks': {} },
          },
        },
      },
    });
    expect(snapshot).toMatchObject({
      protocolMode: 'frozen_v1',
      serverInfo: { name: 'untrusted-display-name', version: '9.9.9' },
      taskNotifications: true,
      validUntil: '2026-07-18T00:01:00.000Z',
    });
  });

  it('routes names exactly and keeps concurrent calls stateless', async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Headers[] = [];
    const client = new FrozenV1McpClient(async (_url, init) => {
      const body = parseRequestBody(init);
      bodies.push(body);
      headers.push(new Headers(init?.headers));
      await Promise.resolve();
      return jsonResponse({ resultType: 'complete', echoed: body['id'] }, body['id']);
    });

    await Promise.all([
      client.request({
        endpoint,
        headers: {},
        method: 'tools/call',
        params: { name: 'embodied.move', arguments: { resourceId: 'UGV-001' } },
      }),
      client.request({
        endpoint,
        headers: {},
        method: 'tasks/get',
        params: { taskId: 'task-1' },
      }),
      client.request({ endpoint, headers: {}, method: 'tools/list', params: {} }),
    ]);

    expect(new Set(bodies.map((body) => body['id'])).size).toBe(3);
    expect(headers.map((value) => value.get('mcp-name'))).toEqual([
      'embodied.move',
      'task-1',
      null,
    ]);
    expect(bodies.every((body) => body['method'] !== 'initialize')).toBe(true);
  });

  it('accepts a correlated SSE JSON-RPC response', async () => {
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequestBody(init);
      return Promise.resolve(
        new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body['id'], result: { resultType: 'complete' } })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    });
    await expect(
      client.request({ endpoint, headers: {}, method: 'subscriptions/listen', params: {} }),
    ).resolves.toEqual({ resultType: 'complete' });
  });

  it.each([
    [-32001, 'FROZEN_MCP_HEADER_MISMATCH'],
    [-32003, 'FROZEN_MCP_CAPABILITY_REQUIRED'],
    [-32004, 'FROZEN_MCP_VERSION_UNSUPPORTED'],
    [-32601, 'FROZEN_MCP_METHOD_NOT_FOUND'],
    [-32602, 'FROZEN_MCP_PARAMS_INVALID'],
  ] as const)('normalizes JSON-RPC error %i', async (rpcCode, code) => {
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequestBody(init);
      return Promise.resolve(jsonError(rpcCode, body['id']));
    });
    await expect(
      client.request({ endpoint, headers: {}, method: 'server/discover', params: {} }),
    ).rejects.toMatchObject({ code, rpcCode });
  });

  it('fails closed for invalid discovery and does not infer auth from serverInfo', async () => {
    const invalidVersionClient = new FrozenV1McpClient(() =>
      Promise.resolve(jsonResponse({ ...discoveryResult(), supportedVersions: ['2025-01-01'] })),
    );
    await expect(invalidVersionClient.discover({ endpoint, headers: {} })).rejects.toBeInstanceOf(
      FrozenMcpProtocolError,
    );

    const missingCapabilityClient = new FrozenV1McpClient(() =>
      Promise.resolve(
        jsonResponse({
          ...discoveryResult(),
          capabilities: { extensions: { 'io.modelcontextprotocol/tasks': {} } },
        }),
      ),
    );
    await expect(missingCapabilityClient.discover({ endpoint, headers: {} })).rejects.toMatchObject(
      {
        code: 'FROZEN_MCP_DISCOVERY_INVALID',
      },
    );
  });
});

function discoveryResult() {
  return {
    resultType: 'complete',
    supportedVersions: [FROZEN_MCP_PROTOCOL_VERSION],
    capabilities: {
      tools: {},
      extensions: {
        'io.modelcontextprotocol/tasks': {},
        'io.sdar/taskExecution': { profileVersion: '1.0', taskNotifications: true },
      },
    },
    _meta: {
      'io.modelcontextprotocol/serverInfo': {
        name: 'untrusted-display-name',
        version: '9.9.9',
      },
    },
    ttlMs: 60_000,
  };
}

function jsonResponse(result: unknown, id: unknown = 1): Response {
  return Response.json({ jsonrpc: '2.0', id, result });
}

function jsonError(code: number, id: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message: `RPC ${String(code)}` } });
}

function parseRequestBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') {
    throw new TypeError('Expected a serialized JSON request body');
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}
