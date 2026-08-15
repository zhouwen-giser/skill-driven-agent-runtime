import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeSmppSnapshotChecksum } from '../../../packages/node-control-domain/src/index.js';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const PREFLIGHT_SCRIPT = resolve(REPOSITORY_ROOT, 'scripts/sdar-ugv-smpp/preflight.mjs');
const CONTROL_GATE_SCRIPT = resolve(REPOSITORY_ROOT, 'scripts/sdar-ugv-smpp/control-gate.mjs');
const REGISTRY_TOKEN = 'registry-token-never-report';
const RUNTIME_TOKEN = 'runtime-token-never-report';
const MODEL_TOKEN = 'model-token-never-report';
const NATIVE_CHECKSUM = 'd'.repeat(64);

describe('UGV SMPP deployment guards', () => {
  it('uses explicit unauthenticated credentials without sending Authorization', async () => {
    const registry = await startRegistry({ unauthenticated: true });
    try {
      const result = await runScript(
        PREFLIGHT_SCRIPT,
        [],
        preflightEnvironment(registry.port, {
          SMPP_REGISTRY_CREDENTIAL_REF: 'unauthenticated://none',
          SMPP_REGISTRY_TOKEN: undefined,
          SMPP_REGISTRY_TOKEN_FILE: undefined,
          SMPP_UGV_RUNTIME_CREDENTIAL_REF: 'unauthenticated://none',
          SMPP_UGV_RUNTIME_TOKEN: undefined,
          SMPP_UGV_RUNTIME_TOKEN_FILE: undefined,
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        registry: { authenticationMode: 'none' },
        runtime: { authenticationMode: 'none' },
      });
      expect(registry.authorizationHeaderCount()).toBe(0);
    } finally {
      await registry.close();
    }
  });

  it('rejects a secret alongside the explicit unauthenticated credential mode', async () => {
    const registry = await startRegistry({ unauthenticated: true });
    try {
      const result = await runScript(
        PREFLIGHT_SCRIPT,
        [],
        preflightEnvironment(registry.port, {
          SMPP_REGISTRY_CREDENTIAL_REF: 'unauthenticated://none',
        }),
      );
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        status: 'failed',
        code: 'UNAUTHENTICATED_CREDENTIAL_CONFLICT',
      });
    } finally {
      await registry.close();
    }
  });

  it('admits unsafe_test_open without allowlists only in explicit test/integration environments', async () => {
    const registry = await startRegistry();
    try {
      const environment = preflightEnvironment(registry.port, {
        NODE_ENV: 'test',
        SDAR_CONTROL_ENVIRONMENT: 'integration',
        SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
        SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: undefined,
        SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: undefined,
      });
      const result = await runScript(PREFLIGHT_SCRIPT, [], environment);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        outboundPolicy: { mode: 'unsafe_test_open', productionEligible: false },
      });
      for (const forbidden of [
        { NODE_ENV: 'production', SDAR_CONTROL_ENVIRONMENT: 'integration' },
        { NODE_ENV: 'test', SDAR_CONTROL_ENVIRONMENT: 'production' },
        { NODE_ENV: undefined, SDAR_CONTROL_ENVIRONMENT: 'integration' },
      ]) {
        const denied = await runScript(
          PREFLIGHT_SCRIPT,
          [],
          environmentWith(environment, forbidden),
        );
        expect(denied.exitCode).toBe(1);
        expect(JSON.parse(denied.stderr)).toEqual({
          status: 'failed',
          code: 'UNSAFE_OUTBOUND_POLICY_FORBIDDEN',
        });
      }
    } finally {
      await registry.close();
    }
  });

  it('accepts exact Registry authority and env-or-file secrets without emitting values', async () => {
    const registry = await startRegistry();
    const secretDirectory = await mkdtemp(join(tmpdir(), 'sdar-ugv-secrets-'));
    const registryFile = join(secretDirectory, 'registry-token');
    const runtimeFile = join(secretDirectory, 'runtime-token');
    const modelFile = join(secretDirectory, 'model-token');
    try {
      await Promise.all([
        writeFile(registryFile, `${REGISTRY_TOKEN}\n`, { mode: 0o600 }),
        writeFile(runtimeFile, `${RUNTIME_TOKEN}\n`, { mode: 0o600 }),
        writeFile(modelFile, `${MODEL_TOKEN}\n`, { mode: 0o600 }),
      ]);
      const environment = preflightEnvironment(registry.port, {
        SMPP_REGISTRY_TOKEN: undefined,
        SMPP_REGISTRY_TOKEN_FILE: registryFile,
        SMPP_UGV_RUNTIME_TOKEN: undefined,
        SMPP_UGV_RUNTIME_TOKEN_FILE: runtimeFile,
        SDAR_UGV_MODEL_API_KEY: undefined,
        SDAR_UGV_MODEL_API_KEY_FILE: modelFile,
      });

      const result = await runScript(PREFLIGHT_SCRIPT, [], environment);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'guard_checks_passed',
        evidenceClass: 'real',
        overallPreflightAuthority: 'pending_driver_checks',
        writeGates: 'closed',
        registry: {
          initialSnapshotAccepted: true,
          conditionalRevalidationAccepted: true,
          exactCandidateSelected: true,
        },
        runtime: {
          registryEndpointAligned: true,
          healthReachable: true,
          directMcpCallPerformed: false,
        },
        realModel: {
          enabled: true,
          connectivityAuthority: 'pending_driver_connectivity',
        },
      });
      expect(registry.requestCount()).toBe(2);
      expect(registry.healthRequestCount()).toBe(1);
      const emitted = `${result.stdout}\n${result.stderr}`;
      for (const forbidden of [
        REGISTRY_TOKEN,
        RUNTIME_TOKEN,
        MODEL_TOKEN,
        registryFile,
        runtimeFile,
        modelFile,
        'ugv-provider-01',
        'ugv-runtime-01',
        `127.0.0.1:${String(registry.port)}`,
      ])
        expect(emitted).not.toContain(forbidden);
    } finally {
      await registry.close();
      await rm(secretDirectory, { recursive: true, force: true });
    }
  });

  it('requires an exact Runtime authority rather than a host-wide allowlist', async () => {
    const registry = await startRegistry();
    try {
      const result = await runScript(
        PREFLIGHT_SCRIPT,
        [],
        preflightEnvironment(registry.port, {
          SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: '127.0.0.1',
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        status: 'failed',
        code: 'RUNTIME_ENDPOINT_NOT_ALLOWED',
      });
      expect(`${result.stdout}${result.stderr}`).not.toContain(REGISTRY_TOKEN);
    } finally {
      await registry.close();
    }
  });

  it.each([
    [
      'a non-projection URL',
      (port: number) => ({
        SMPP_SDAR_REGISTRY_ENDPOINT: `http://127.0.0.1:${String(port)}/latest`,
      }),
      'REGISTRY_PROJECTION_URL_INVALID',
    ],
    [
      'a missing external Provider ID',
      () => ({ SMPP_UGV_EXTERNAL_PROVIDER_ID: undefined }),
      'REQUIRED_CONFIGURATION_INVALID',
    ],
    [
      'an over-broad Provider authority set',
      (port: number) => ({
        SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: `127.0.0.1:${String(
          port,
        )},unused.example.invalid`,
      }),
      'PROVIDER_ENDPOINT_ALLOWLIST_SCOPE_INVALID',
    ],
    ['an open write gate', () => ({ ALLOW_REAL_UGV_SIDE_EFFECTS: 'YES' }), 'WRITE_GATE_NOT_CLOSED'],
    ['any fire gate value', () => ({ ALLOW_REAL_UGV_FIRE: '' }), 'FIRE_GATE_FORBIDDEN'],
  ])('preflight rejects %s before qualification', async (_name, overrides, expectedCode) => {
    const registry = await startRegistry();
    try {
      const result = await runScript(
        PREFLIGHT_SCRIPT,
        [],
        preflightEnvironment(registry.port, overrides(registry.port)),
      );
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({ status: 'failed', code: expectedCode });
    } finally {
      await registry.close();
    }
  });

  it('rejects projection ETag drift without exposing the response or credential', async () => {
    const registry = await startRegistry({ badEtag: true });
    try {
      const result = await runScript(PREFLIGHT_SCRIPT, [], preflightEnvironment(registry.port));
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        status: 'failed',
        code: 'REGISTRY_ETAG_INVALID',
      });
      expect(`${result.stdout}${result.stderr}`).not.toContain(REGISTRY_TOKEN);
    } finally {
      await registry.close();
    }
  });

  it('requires the Registry-selected MCP endpoint to match the separately configured Runtime', async () => {
    const registry = await startRegistry();
    try {
      const result = await runScript(
        PREFLIGHT_SCRIPT,
        [],
        preflightEnvironment(registry.port, { SMPP_UGV_RUNTIME_MCP_PATH: '/mcp-v2' }),
      );

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        status: 'failed',
        code: 'RUNTIME_ENDPOINT_PROJECTION_MISMATCH',
      });
      expect(registry.healthRequestCount()).toBe(0);
    } finally {
      await registry.close();
    }
  });

  it('fails closed when Runtime readiness is not HTTP 200', async () => {
    const registry = await startRegistry({ runtimeHealthUnavailable: true });
    try {
      const result = await runScript(PREFLIGHT_SCRIPT, [], preflightEnvironment(registry.port));

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({
        status: 'failed',
        code: 'RUNTIME_HEALTH_HTTP_200_REQUIRED',
      });
    } finally {
      await registry.close();
    }
  });

  it('permits deterministic preflight with the real-model phase explicitly disabled', async () => {
    const registry = await startRegistry();
    try {
      const result = await runScript(
        PREFLIGHT_SCRIPT,
        [],
        preflightEnvironment(registry.port, {
          SDAR_UGV_REAL_MODEL_ENABLED: 'NO',
          SDAR_UGV_MODEL_PROVIDER_ID: undefined,
          SDAR_UGV_MODEL_BASE_URL: undefined,
          SDAR_UGV_MODEL_NAME: undefined,
          SDAR_UGV_MODEL_API_STYLE: undefined,
          SDAR_UGV_MODEL_API_KEY: undefined,
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        realModel: { enabled: false, connectivityAuthority: 'not_enabled' },
      });
    } finally {
      await registry.close();
    }
  });

  it('keeps real motion closed by default', async () => {
    const result = await runScript(CONTROL_GATE_SCRIPT, [], cleanEnvironment());

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      status: 'failed',
      code: 'REAL_SIDE_EFFECT_GATE_CLOSED',
    });
  });

  it('prints only the exact public target/bounds and leaves live authority pending', async () => {
    const result = await runScript(CONTROL_GATE_SCRIPT, [], controlEnvironment());

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'environment_gate_passed',
      requestKind: 'bounded_movement',
      targetResourceId: 'ugv.field-test.vehicle-01',
      requestedDistanceM: 1,
      maximumDistanceM: 1.5,
      fireExecution: 'forbidden',
      authorityGate: 'pending_live_driver_verification',
    });
    expect(JSON.parse(result.stdout)).not.toHaveProperty('runId');
  });

  it.each([
    [
      'a distance beyond the site limit',
      [],
      { UGV_TEST_DISTANCE_M: '1.6' },
      'UGV_TEST_DISTANCE_EXCEEDS_LIMIT',
    ],
    [
      'coordinate navigation without its separate gate',
      ['--request-kind', 'coordinate_navigation'],
      {},
      'COORDINATE_GATE_CLOSED',
    ],
    [
      'reconnaissance without its separate gate',
      ['--request-kind', 'reconnaissance'],
      {},
      'RECON_GATE_CLOSED',
    ],
    [
      'a forbidden fire variable even when set to NO',
      [],
      { ALLOW_REAL_UGV_FIRE: 'NO' },
      'FIRE_GATE_FORBIDDEN',
    ],
    ['a weapon request', ['--request-text', 'launch weapon'], {}, 'WEAPON_REQUEST_FORBIDDEN'],
  ])('control gate rejects %s', async (_name, arguments_, overrides, expectedCode) => {
    const result = await runScript(
      CONTROL_GATE_SCRIPT,
      arguments_,
      environmentWith(controlEnvironment(), overrides),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ status: 'failed', code: expectedCode });
  });

  it('admits operator-provided coordinate fixtures only behind the separate gate', async () => {
    const result = await runScript(
      CONTROL_GATE_SCRIPT,
      ['--request-kind', 'coordinate_navigation'],
      environmentWith(controlEnvironment(), {
        ALLOW_UGV_COORDINATE_NAVIGATION: 'YES',
        UGV_TEST_DISTANCE_M: undefined,
        UGV_TEST_SAFE_POINT_JSON: '{"latitude":29.720426,"longitude":106.81413978,"altitude":500}',
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestKind: 'coordinate_navigation',
      coordinateTargetConfigured: true,
      authorityGate: 'pending_live_driver_verification',
    });
    expect(result.stdout).not.toContain('latitude');
  });

  it('rejects an out-of-range or incomplete coordinate point before control execution', async () => {
    const result = await runScript(
      CONTROL_GATE_SCRIPT,
      ['--request-kind', 'coordinate_navigation'],
      environmentWith(controlEnvironment(), {
        ALLOW_UGV_COORDINATE_NAVIGATION: 'YES',
        UGV_TEST_DISTANCE_M: undefined,
        UGV_TEST_SAFE_POINT_JSON: '{"latitude":103.1,"longitude":-36.6}',
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({
      status: 'failed',
      code: 'SAFE_POINT_FIXTURE_INVALID',
    });
  });
});

interface RegistryHandle {
  readonly port: number;
  requestCount(): number;
  healthRequestCount(): number;
  authorizationHeaderCount(): number;
  close(): Promise<void>;
}

async function startRegistry(
  options: Readonly<{
    badEtag?: boolean;
    runtimeHealthUnavailable?: boolean;
    unauthenticated?: boolean;
  }> = {},
): Promise<RegistryHandle> {
  let port = 0;
  let requests = 0;
  let healthRequests = 0;
  let authorizationHeaders = 0;
  const server = createServer((request, response) => {
    if (request.url === '/health/ready') {
      healthRequests += 1;
      const body = JSON.stringify({ status: 'ready' });
      response
        .writeHead(options.runtimeHealthUnavailable === true ? 503 : 200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(Buffer.byteLength(body)),
        })
        .end(body);
      return;
    }
    requests += 1;
    if (request.headers.authorization !== undefined) authorizationHeaders += 1;
    if (
      (options.unauthenticated === true && request.headers.authorization !== undefined) ||
      (options.unauthenticated !== true &&
        request.headers.authorization !== `Bearer ${REGISTRY_TOKEN}`)
    ) {
      response.writeHead(401).end();
      return;
    }
    const snapshot = registrySnapshot(port);
    const etag = options.badEtag === true ? `"${'e'.repeat(64)}"` : `"${snapshot.checksum}"`;
    const headers = {
      etag,
      'x-smpp-native-revision': String(snapshot.revision),
      'x-smpp-native-checksum': NATIVE_CHECKSUM,
      'x-smpp-projection-contract': 'sdar-registry-v1',
    };
    if (request.headers['if-none-match'] !== undefined) {
      response.writeHead(304, headers).end();
      return;
    }
    const body = JSON.stringify(snapshot);
    response
      .writeHead(200, {
        ...headers,
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
      })
      .end(body);
  });
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolveListening();
    });
  });
  const address = server.address() as AddressInfo;
  port = address.port;
  return Object.freeze({
    port,
    requestCount: () => requests,
    healthRequestCount: () => healthRequests,
    authorizationHeaderCount: () => authorizationHeaders,
    close: () =>
      new Promise<void>((resolveClosed, reject) => {
        server.close((error) => {
          if (error === undefined) resolveClosed();
          else reject(error);
        });
      }),
  });
}

function registrySnapshot(port: number) {
  const projection = {
    revision: 7,
    generatedAt: '2099-08-12T00:00:00.000Z',
    expiresAt: '2099-08-12T01:00:00.000Z',
    providers: [
      {
        externalProviderId: 'ugv-provider-01',
        externalServerId: 'ugv-runtime-01',
        serverEndpoint: `http://127.0.0.1:${String(port)}/mcp`,
        catalogRevision: '42',
        labels: { environment: 'field-test', protocolMode: 'frozen_v1' },
      },
    ],
  } as const;
  return Object.freeze({
    ...projection,
    checksum: snapshotChecksum('ugv-source', projection),
  });
}

function snapshotChecksum(
  sourceId: string,
  snapshot: Readonly<{
    revision: number;
    generatedAt: string;
    expiresAt: string;
    providers: readonly Readonly<{
      externalProviderId: string;
      externalServerId: string;
      serverEndpoint: string;
      catalogRevision: string;
      labels: Readonly<Record<string, string>>;
    }>[];
  }>,
): string {
  return computeSmppSnapshotChecksum({
    smppSourceId: sourceId,
    revision: snapshot.revision,
    generatedAt: snapshot.generatedAt,
    expiresAt: snapshot.expiresAt,
    candidates: snapshot.providers.map((provider) => ({
      smppSourceId: sourceId,
      externalProviderId: provider.externalProviderId,
      externalServerId: provider.externalServerId,
      compositeIdentity: `${sourceId}::${provider.externalProviderId}::${provider.externalServerId}`,
      serverEndpoint: provider.serverEndpoint,
      catalogRevision: provider.catalogRevision,
      labels: provider.labels,
    })),
  });
}

function preflightEnvironment(
  port: number,
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  return environmentWith(cleanEnvironment(), {
    SMPP_SDAR_SOURCE_ID: 'ugv-source',
    SMPP_ENVIRONMENT: 'field-test',
    SMPP_SDAR_REGISTRY_ENDPOINT: `http://127.0.0.1:${String(
      port,
    )}/api/v1/registry/field-test/consumers/sdar/v1/sources/ugv-source/latest`,
    SMPP_REGISTRY_CREDENTIAL_REF: 'secret://env/SMPP_REGISTRY_TOKEN',
    SMPP_REGISTRY_TOKEN: REGISTRY_TOKEN,
    SMPP_UGV_EXTERNAL_PROVIDER_ID: 'ugv-provider-01',
    SMPP_UGV_EXTERNAL_SERVER_ID: 'ugv-runtime-01',
    SMPP_UGV_RUNTIME_BASE_URL: `http://127.0.0.1:${String(port)}/`,
    SMPP_UGV_RUNTIME_MCP_PATH: '/mcp',
    SMPP_UGV_RUNTIME_HEALTH_PATH: '/health/ready',
    SMPP_UGV_RUNTIME_CREDENTIAL_REF: 'secret://env/SMPP_UGV_RUNTIME_TOKEN',
    SMPP_UGV_RUNTIME_TOKEN: RUNTIME_TOKEN,
    SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: `127.0.0.1:${String(port)}`,
    SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: `127.0.0.1:${String(port)}`,
    SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
    SDAR_UGV_MODEL_PROVIDER_ID: 'real-model-provider',
    SDAR_UGV_MODEL_BASE_URL: `http://127.0.0.1:${String(port)}/model`,
    SDAR_UGV_MODEL_NAME: 'structured-model',
    SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
    SDAR_UGV_MODEL_API_KEY: MODEL_TOKEN,
    ALLOW_REAL_UGV_SIDE_EFFECTS: 'NO',
    ALLOW_UGV_COORDINATE_NAVIGATION: 'NO',
    ALLOW_REAL_UGV_RECON: 'NO',
    ...overrides,
  });
}

function controlEnvironment(): NodeJS.ProcessEnv {
  return environmentWith(cleanEnvironment(), {
    ALLOW_REAL_UGV_SIDE_EFFECTS: 'YES',
    REAL_UGV_TEST_RUN_ID: '20260812T120000Z-test-001',
    UGV_TEST_RESOURCE_ID: 'ugv.field-test.vehicle-01',
    UGV_TEST_DISTANCE_M: '1',
    UGV_SITE_DISTANCE_LIMIT_M: '1.5',
    UGV_CONTROL_REQUEST_KIND: 'bounded_movement',
  });
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (
      name.startsWith('SMPP_') ||
      name.startsWith('SDAR_UGV_') ||
      name.startsWith('ALLOW_REAL_UGV') ||
      name.startsWith('ALLOW_UGV_') ||
      name.startsWith('REAL_UGV_') ||
      name.startsWith('UGV_') ||
      name === 'SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST' ||
      name === 'SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST' ||
      name === 'SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY' ||
      name === 'SDAR_CONTROL_ENVIRONMENT'
    )
      Reflect.deleteProperty(environment, name);
  }
  return environment;
}

function environmentWith(
  base: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const result = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(result, name);
    else result[name] = value;
  }
  return result;
}

interface ScriptResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runScript(
  script: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<ScriptResult> {
  return new Promise((resolveResult) => {
    execFile(
      process.execPath,
      [script, ...arguments_],
      { cwd: REPOSITORY_ROOT, env: environment, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolveResult(
          Object.freeze({
            exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
            stdout,
            stderr,
          }),
        );
      },
    );
  });
}
