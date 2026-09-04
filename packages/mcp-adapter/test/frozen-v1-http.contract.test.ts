import { describe, expect, it } from 'vitest';

import {
  FROZEN_MCP_PROTOCOL_VERSION,
  FrozenMcpProtocolError,
  FrozenV1McpClient,
  FrozenV1RuntimeLifecycleAdapter,
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

  it('preserves full, key-only, and absent Task call profiles through the Runtime adapter', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequestBody(init);
      bodies.push(body);
      return Promise.resolve(
        jsonResponse(
          { resultType: 'complete', content: [], structuredContent: {}, isError: false },
          body['id'],
        ),
      );
    });
    const adapter = new FrozenV1RuntimeLifecycleAdapter({ client });
    const base = {
      endpoint,
      headers: {},
      arguments: {},
      outputValidator: {
        checkSchema: () => ({ valid: true as const, errors: [] }),
        validate: () => ({ valid: true as const, errors: [] }),
      },
    };

    await adapter.call({
      ...base,
      toolName: 'vehicle_navigate',
      taskCallProfile: {
        profileVersion: '1.0',
        idempotencyKey: 'invocation-navigate-1',
        timing: {
          start: {
            mode: 'scheduled',
            scheduledAt: '2026-08-11T01:10:00.000Z',
            startToleranceMs: 2_500,
          },
          maxElapsedMs: 60_000,
        },
        reservationRef: 'reservation-navigate-1',
      },
    });
    await adapter.call({
      ...base,
      toolName: 'task_key_only',
      taskCallProfile: {
        profileVersion: '1.0',
        idempotencyKey: 'invocation-key-only-1',
      },
    });
    await adapter.call({ ...base, toolName: 'vehicle_get_state' });

    const profiles = bodies.map((body) => {
      const params = body['params'] as Record<string, unknown>;
      const meta = params['_meta'] as Record<string, unknown>;
      return meta['io.sdar/taskExecution'];
    });
    expect(profiles).toEqual([
      {
        profileVersion: '1.0',
        idempotencyKey: 'invocation-navigate-1',
        timing: {
          start: {
            mode: 'scheduled',
            scheduledAt: '2026-08-11T01:10:00.000Z',
            startToleranceMs: 2_500,
          },
          maxElapsedMs: 60_000,
        },
        reservationRef: 'reservation-navigate-1',
      },
      { profileVersion: '1.0', idempotencyKey: 'invocation-key-only-1' },
      undefined,
    ]);
    expect(bodies.map((body) => body['method'])).toEqual([
      'tools/call',
      'tools/call',
      'tools/call',
    ]);
  });

  it('uses only the frozen idempotency profile for reconciliation and never accepts an immediate result', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequestBody(init);
      bodies.push(body);
      return Promise.resolve(
        jsonResponse(
          { resultType: 'complete', content: [], structuredContent: {}, isError: false },
          body['id'],
        ),
      );
    });
    const adapter = new FrozenV1RuntimeLifecycleAdapter({ client });
    const result = await adapter.reconcile({
      endpoint,
      headers: {},
      toolName: 'vehicle_navigate',
      arguments: { resourceId: 'vehicle:ugv1' },
      taskCallProfile: {
        profileVersion: '1.0',
        idempotencyKey: `mcp-logical-${'a'.repeat(64)}`,
      },
      outputValidator: {
        checkSchema: () => ({ valid: true as const, errors: [] }),
        validate: () => ({ valid: true as const, errors: [] }),
      },
    });

    expect(result).toEqual({
      status: 'conflict',
      safeErrorCode: 'MCP_RECONCILIATION_RETURNED_IMMEDIATE_RESULT',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'vehicle_navigate',
        _meta: {
          'io.sdar/taskExecution': {
            profileVersion: '1.0',
            idempotencyKey: `mcp-logical-${'a'.repeat(64)}`,
          },
        },
      },
    });
  });

  it('classifies source-locked uncertain not-found without a fallback dispatch', async () => {
    let requestCount = 0;
    const client = new FrozenV1McpClient((_url, init) => {
      requestCount += 1;
      const body = parseRequestBody(init);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body['id'],
            error: { code: -32000, message: 'ADAPTER_RECONCILE_NOT_FOUND_UNCERTAIN' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });
    const adapter = new FrozenV1RuntimeLifecycleAdapter({ client });
    await expect(
      adapter.reconcile({
        endpoint,
        headers: {},
        toolName: 'vehicle_navigate',
        arguments: { resourceId: 'vehicle:ugv1' },
        taskCallProfile: {
          profileVersion: '1.0',
          idempotencyKey: `mcp-logical-${'b'.repeat(64)}`,
        },
        outputValidator: {
          checkSchema: () => ({ valid: true as const, errors: [] }),
          validate: () => ({ valid: true as const, errors: [] }),
        },
      }),
    ).resolves.toEqual({
      status: 'not_found',
      safeErrorCode: 'MCP_RECONCILIATION_NOT_FOUND',
    });
    expect(requestCount).toBe(1);
  });

  it('recovers the one committed Provider Task after a tools/call response is lost', async () => {
    let providerStartCount = 0;
    let toolsCallCount = 0;
    const profiles: unknown[] = [];
    const client = new FrozenV1McpClient((_url, init) => {
      const body = parseRequestBody(init);
      if (body['method'] === 'tasks/get')
        return Promise.resolve(jsonResponse(remoteTaskResult('complete'), body['id']));
      toolsCallCount += 1;
      const params = body['params'] as Record<string, unknown>;
      const meta = params['_meta'] as Record<string, unknown>;
      profiles.push(meta['io.sdar/taskExecution']);
      if (providerStartCount === 0) providerStartCount += 1;
      if (toolsCallCount === 1)
        return Promise.reject(new Error('socket closed after Provider commit'));
      return Promise.resolve(jsonResponse(remoteTaskResult('task'), body['id']));
    });
    const adapter = new FrozenV1RuntimeLifecycleAdapter({
      client,
      now: () => '2026-08-31T07:00:02.000Z',
    });
    const input = {
      endpoint,
      headers: {},
      toolName: 'vehicle_navigate',
      arguments: { resourceId: 'vehicle:ugv1' },
      taskCallProfile: {
        profileVersion: '1.0' as const,
        idempotencyKey: `mcp-logical-${'c'.repeat(64)}`,
      },
      outputValidator: {
        checkSchema: () => ({ valid: true as const, errors: [] }),
        validate: () => ({ valid: true as const, errors: [] }),
      },
    };

    await expect(adapter.call(input)).rejects.toMatchObject({
      code: 'FROZEN_MCP_TRANSPORT_FAILED',
    });
    await expect(adapter.reconcile(input)).resolves.toMatchObject({
      status: 'found_exact',
      outcome: { kind: 'remote_task', task: { remoteTaskId: 'provider-task-response-loss' } },
    });
    expect(providerStartCount).toBe(1);
    expect(toolsCallCount).toBe(2);
    expect(profiles).toEqual([input.taskCallProfile, input.taskCallProfile]);
  });

  it('strictly validates and retains the optional Provider Catalog manifest identity', async () => {
    const providerCatalog = {
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash: 'b'.repeat(64),
    };
    const discovery = discoveryResult();
    const withProvider = {
      ...discovery,
      capabilities: {
        ...discovery.capabilities,
        extensions: {
          ...discovery.capabilities.extensions,
          'io.sdar/providerCatalog': providerCatalog,
        },
      },
    };
    const client = new FrozenV1McpClient(() => Promise.resolve(jsonResponse(withProvider)));

    await expect(
      client.discoverSnapshot({
        endpoint,
        headers: {},
        snapshotId: 'snapshot-provider-catalog',
        serverId: 'provider-1',
        baselineSha256: 'a'.repeat(64),
        discoveredAt: '2026-07-18T00:00:00.000Z',
        toolRevision: 1,
      }),
    ).resolves.toMatchObject({ providerCatalog });

    for (const malformed of [
      { ...providerCatalog, manifestHash: 'A'.repeat(64) },
      { ...providerCatalog, providerType: 'isr vehicle ugv' },
      { ...providerCatalog, readiness: 'online' },
    ]) {
      const invalid = {
        ...withProvider,
        capabilities: {
          ...withProvider.capabilities,
          extensions: {
            ...withProvider.capabilities.extensions,
            'io.sdar/providerCatalog': malformed,
          },
        },
      };
      await expect(
        new FrozenV1McpClient(() => Promise.resolve(jsonResponse(invalid))).discover({
          endpoint,
          headers: {},
        }),
      ).rejects.toMatchObject({ code: 'FROZEN_MCP_DISCOVERY_INVALID' });
    }
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

function remoteTaskResult(resultType: 'task' | 'complete'): Record<string, unknown> {
  return {
    resultType,
    taskId: 'provider-task-response-loss',
    status: 'working',
    createdAt: '2026-08-31T07:00:00.000Z',
    lastUpdatedAt: '2026-08-31T07:00:01.000Z',
    ttlMs: 60_000,
    pollIntervalMs: 1_000,
    _meta: {
      'io.sdar/taskExecution': { profileVersion: '1.0', runtimeRevision: '1' },
    },
  };
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
