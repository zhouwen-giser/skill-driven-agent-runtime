import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  startNodeControlApi,
  type NodeControlApiRuntime,
} from '../../../apps/node-control-api/src/runtime.js';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { NodeControlSmppRegistryService } from '../../node-control-application/src/index.js';
import {
  computeSmppSnapshotChecksum,
  smppCandidateIdentity,
  type SmppProviderCandidate,
} from '../../node-control-domain/src/index.js';
import {
  EnvironmentSmppCredentialResolver,
  HttpSmppRegistryClient,
} from '../../smpp-registry-adapter/src/index.js';
import { applyControlMigrations, PostgresNodeControlSmppRegistryRepository } from '../src/index.js';

const runtimeConnectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const controlConnectionString =
  process.env['SDAR_CONTROL_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_control_v14_integration_gate';
const apiToken = 'p04-control-api-token-000000000000000000000000';
const runtimeToken = 'p04-runtime-service-token-0000000000000000000';
const runtimePool = new Pool({ connectionString: runtimeConnectionString, max: 4 });
const controlPool = new Pool({ connectionString: controlConnectionString, max: 4 });
let registry: FakeSmppRegistry;
let registryServer: Server | undefined;
let registryBaseUrl = '';
let controlApi: NodeControlApiRuntime | undefined;
let previousToken: string | undefined;

beforeAll(async () => {
  await Promise.all([applyRuntimeMigrations(runtimePool), applyControlMigrations(controlPool)]);
  await controlPool.query(
    `TRUNCATE sdar_control.mcp_provider_catalog_observation,
              sdar_control.mcp_provider_binding,
              sdar_control.smpp_registry_sync_attempt,
              sdar_control.smpp_registry_snapshot_lineage,
              sdar_control.smpp_provider_candidate,
              sdar_control.smpp_registry_snapshot,
              sdar_control.smpp_registry_source,
              sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.model_route_definition,
              sdar_control.llm_provider_definition,
              sdar_control.control_audit_event,
              sdar_control.management_operation,
              sdar_control.node_profile`,
  );
  previousToken = process.env['SMPP_TEST_TOKEN'];
  process.env['SMPP_TEST_TOKEN'] = 'credential-value';
  registry = new FakeSmppRegistry();
  registryServer = createServer((request, response) => {
    registry.respond(request, response);
  });
  registryBaseUrl = await listen(registryServer);
  controlApi = await startNodeControlApi({
    SDAR_CONTROL_DATABASE_URL: controlConnectionString,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: 0,
    SDAR_CONTROL_API_TOKEN: apiToken,
    SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: runtimeToken,
    SDAR_CONTROL_NODE_ID: 'node-p04',
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'P04 Integration Node',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:9998',
    SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10080/api/v1/events',
    SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:9999/.well-known/agent-card.json',
  });
  await seedRunningTask();
});

afterAll(async () => {
  await controlApi?.close();
  if (registryServer !== undefined) await close(registryServer);
  await controlPool.query(
    `TRUNCATE sdar_control.mcp_provider_catalog_observation,
              sdar_control.mcp_provider_binding,
              sdar_control.smpp_registry_sync_attempt,
              sdar_control.smpp_registry_snapshot_lineage,
              sdar_control.smpp_provider_candidate,
              sdar_control.smpp_registry_snapshot,
              sdar_control.smpp_registry_source,
              sdar_control.configuration_application,
              sdar_control.configuration_command_receipt,
              sdar_control.configuration_target_state,
              sdar_control.configuration_revision,
              sdar_control.model_route_definition,
              sdar_control.llm_provider_definition,
              sdar_control.control_audit_event,
              sdar_control.management_operation,
              sdar_control.node_profile`,
  );
  await runtimePool.query("DELETE FROM agent_task WHERE task_id='task-p04-running'");
  await runtimePool.query(
    "DELETE FROM conversation_context WHERE context_id='context-p04-running'",
  );
  if (previousToken === undefined) delete process.env['SMPP_TEST_TOKEN'];
  else process.env['SMPP_TEST_TOKEN'] = previousToken;
  await Promise.all([runtimePool.end(), controlPool.end()]);
});

describe('P04 SMPP Registry federation', { concurrent: false }, () => {
  it('atomically federates isolated sources and preserves LKG and a running Runtime Task', async () => {
    registry.setSnapshot('source-a', 1, 'provider-shared', 'server-shared');
    registry.setSnapshot('source-b', 1, 'provider-shared', 'server-shared');
    await createSource('source-a', 'allow_unexpired');
    await createSource('source-b', 'deny_when_unavailable');

    const firstA = await sync('source-a', 'p04-sync-source-a-v1');
    const firstB = await sync('source-b', 'p04-sync-source-b-v1');
    expect(firstA).toMatchObject({ status: 'succeeded' });
    expect(firstB).toMatchObject({ status: 'succeeded' });
    const firstCandidates = await candidates();
    expect(firstCandidates).toHaveLength(2);
    expect(new Set(firstCandidates.map((item) => item['compositeIdentity'])).size).toBe(2);
    expect(firstCandidates.map((item) => item['externalProviderId'])).toEqual([
      'provider-shared',
      'provider-shared',
    ]);
    expect(firstCandidates).toMatchObject([
      {
        registryRevision: 1,
        registryChecksum: registry.checksum('source-a'),
        registryEtag: registry.etag('source-a'),
        nativeRegistryRevision: 1,
        nativeRegistryChecksum: 'e'.repeat(64),
        registryProjectionContract: 'sdar-registry-v1',
      },
      {
        registryRevision: 1,
        registryChecksum: registry.checksum('source-b'),
        registryEtag: registry.etag('source-b'),
        nativeRegistryRevision: 1,
        nativeRegistryChecksum: 'e'.repeat(64),
        registryProjectionContract: 'sdar-registry-v1',
      },
    ]);
    expect(firstCandidates.every((item) => typeof item['registryValidUntil'] === 'string')).toBe(
      true,
    );
    expect(JSON.stringify(firstCandidates)).not.toContain('credential-value');

    const callsBeforeReplay = registry.calls('source-a');
    await expect(sync('source-a', 'p04-sync-source-a-v1')).resolves.toEqual(firstA);
    expect(registry.calls('source-a')).toBe(callsBeforeReplay);
    await expect(sync('source-a', 'p04-sync-source-a-not-modified')).resolves.toMatchObject({
      status: 'succeeded',
      result: { snapshotRevision: 1 },
    });

    await createSource('source-a', 'allow_unexpired', 2);
    expect(await candidates('source-a')).toHaveLength(1);
    registry.setMode('source-a', 'unavailable');
    await expect(sync('source-a', 'p04-sync-source-a-revision-2-failed')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SOURCE_UNAVAILABLE',
    });
    expect(await candidates('source-a')).toHaveLength(1);
    registry.setMode('source-a', 'normal');
    await expect(sync('source-a', 'p04-sync-source-a-revision-2-active')).resolves.toMatchObject({
      status: 'succeeded',
      result: { snapshotRevision: 1 },
    });
    await expect(publicGet('/api/v1/smpp-sources/source-a')).resolves.toMatchObject({
      revision: 2,
      status: 'active',
      activeSnapshotRevision: 1,
    });

    registry.setSnapshot('source-a', 2, 'provider-v2', 'server-v2');
    const watchWorker = new NodeControlSmppRegistryService({
      repository: new PostgresNodeControlSmppRegistryRepository(controlPool),
      client: new HttpSmppRegistryClient(new EnvironmentSmppCredentialResolver()),
      clock: { now: () => new Date().toISOString() },
      ids: { next: randomUUID },
    });
    await expect(watchWorker.synchronizeScheduled()).resolves.toEqual({ attempted: 2, failed: 0 });
    await expect(publicGet('/api/v1/smpp-sources/source-a')).resolves.toMatchObject({
      activeSnapshotRevision: 2,
      activeSnapshotValidUntil: expect.any(String),
    });

    await controlPool.query(`TRUNCATE sdar_control.smpp_registry_snapshot_lineage`);
    await controlPool.query(
      `UPDATE sdar_control.smpp_registry_source
          SET active_snapshot_valid_until=now() - interval '1 second'
        WHERE smpp_source_id='source-a' AND status='active'`,
    );
    expect(await candidates('source-a')).toHaveLength(0);
    await expect(sync('source-a', 'p04-sync-source-a-legacy-refresh')).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        snapshotRevision: 2,
        nativeLineage: {
          nativeRevision: 2,
          nativeChecksum: 'e'.repeat(64),
          projectionContract: 'sdar-registry-v1',
        },
      },
    });
    expect(registry.lastIfNoneMatch('source-a')).toBeUndefined();
    expect(await candidates('source-a')).toMatchObject([
      {
        externalProviderId: 'provider-v2',
        nativeRegistryRevision: 2,
        nativeRegistryChecksum: 'e'.repeat(64),
        registryProjectionContract: 'sdar-registry-v1',
      },
    ]);
    expect((await candidates('source-b'))[0]).not.toHaveProperty('nativeRegistryRevision');

    registry.setMode('source-a', 'lineage_mismatch');
    await expect(sync('source-a', 'p04-sync-source-a-lineage-mismatch')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SNAPSHOT_LINEAGE_MISMATCH',
    });
    registry.setMode('source-a', 'normal');
    registry.setSnapshot('source-a', 1, 'provider-rollback', 'server-rollback');
    await expect(sync('source-a', 'p04-sync-source-a-rollback')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SNAPSHOT_ROLLBACK_REJECTED',
    });
    expect(await candidates('source-a')).toMatchObject([
      { externalProviderId: 'provider-v2', externalServerId: 'server-v2' },
    ]);

    registry.setSnapshot('source-a', 2, 'provider-drift', 'server-drift');
    await expect(sync('source-a', 'p04-sync-source-a-drift')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SNAPSHOT_DRIFT_REJECTED',
    });
    registry.setSnapshot('source-a', 3, 'provider-invalid', 'server-invalid');
    registry.setMode('source-a', 'bad_checksum');
    await expect(sync('source-a', 'p04-sync-source-a-bad-checksum')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SNAPSHOT_CHECKSUM_MISMATCH',
    });
    expect(await candidates('source-a')).toMatchObject([
      { externalProviderId: 'provider-v2', externalServerId: 'server-v2' },
    ]);

    registry.setMode('source-a', 'expired');
    await expect(sync('source-a', 'p04-sync-source-a-expired')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SNAPSHOT_EXPIRED',
    });
    expect(await candidates('source-a')).toMatchObject([
      { externalProviderId: 'provider-v2', externalServerId: 'server-v2' },
    ]);

    registry.setMode('source-a', 'unavailable');
    registry.setMode('source-b', 'unavailable');
    await expect(sync('source-a', 'p04-sync-source-a-outage')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SOURCE_UNAVAILABLE',
    });
    await expect(sync('source-b', 'p04-sync-source-b-outage')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SMPP_SOURCE_UNAVAILABLE',
    });
    expect(await candidates('source-a')).toHaveLength(1);
    expect(await candidates('source-b')).toHaveLength(0);

    const task = await runtimePool.query<{ phase: string }>(
      "SELECT phase FROM agent_task WHERE task_id='task-p04-running'",
    );
    expect(task.rows[0]?.phase).toBe('executing');
    const source = await publicGet('/api/v1/smpp-sources/source-a');
    expect(source).toMatchObject({
      status: 'active',
      activeSnapshotRevision: 2,
      lastErrorCode: 'SMPP_SOURCE_UNAVAILABLE',
    });
    expect(JSON.stringify(source)).not.toContain('credential-value');

    const attempts = await controlPool.query<{ outcome: string; count: string }>(
      `SELECT outcome,count(*)::text FROM sdar_control.smpp_registry_sync_attempt
        GROUP BY outcome ORDER BY outcome`,
    );
    expect(attempts.rows).toEqual([
      { outcome: 'applied', count: '3' },
      { outcome: 'failed', count: '8' },
      { outcome: 'not_modified', count: '4' },
    ]);
    const durableLineage = await controlPool.query<{
      observed_native_revision: string | null;
      observed_native_checksum: string | null;
      observed_projection_contract: string | null;
      observed_valid_until: Date | null;
    }>(
      `SELECT observed_native_revision::text,observed_native_checksum::text,
              observed_projection_contract,observed_valid_until
         FROM sdar_control.smpp_registry_sync_attempt
        WHERE outcome='not_modified'
        ORDER BY occurred_at`,
    );
    expect(durableLineage.rows).toHaveLength(4);
    expect(
      durableLineage.rows.every(
        (row) =>
          row.observed_native_revision !== null &&
          row.observed_native_checksum?.trim() === 'e'.repeat(64) &&
          row.observed_projection_contract === 'sdar-registry-v1' &&
          row.observed_valid_until !== null,
      ),
    ).toBe(true);
  });
});

async function createSource(
  sourceId: string,
  lkgPolicy: 'allow_unexpired' | 'deny_when_unavailable',
  revision = 1,
): Promise<void> {
  const response = await fetch(`${requireControlApi().baseUrl}/api/v1/smpp-sources`, {
    method: 'POST',
    headers: publicHeaders(`p04-create-${sourceId}-${String(revision)}`),
    body: JSON.stringify({
      smppSourceId: sourceId,
      name: `${sourceId}-revision-${String(revision)}`,
      registryEndpoint: `${registryBaseUrl}/${sourceId}`,
      credentialRef: 'secret://env/SMPP_TEST_TOKEN',
      environment: 'integration',
      syncMode: 'watch',
      snapshotTtlSeconds: 3_600,
      lkgPolicy,
      status: 'draft',
      revision,
    }),
  });
  expect(response.status).toBe(201);
}

async function sync(sourceId: string, idempotencyKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${requireControlApi().baseUrl}/api/v1/smpp-sources/${sourceId}/sync`,
    {
      method: 'POST',
      headers: publicHeaders(idempotencyKey),
      body: JSON.stringify({ reason: 'Refresh authoritative SMPP candidate Snapshot.' }),
    },
  );
  expect(response.status).toBe(202);
  return (await response.json()) as Record<string, unknown>;
}

async function candidates(sourceId?: string): Promise<readonly Record<string, unknown>[]> {
  const query = sourceId === undefined ? '' : `?smppSourceId=${encodeURIComponent(sourceId)}`;
  const body = (await publicGet(`/api/v1/mcp-provider-candidates${query}`)) as {
    items: readonly Record<string, unknown>[];
  };
  return body.items;
}

async function publicGet(path: string): Promise<unknown> {
  const response = await fetch(`${requireControlApi().baseUrl}${path}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  expect(response.status).toBe(200);
  return response.json();
}

function publicHeaders(idempotencyKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiToken}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
  };
}

async function seedRunningTask(): Promise<void> {
  const timestamp = new Date().toISOString();
  await runtimePool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-p04-running','user-p04',$1,$1)
     ON CONFLICT(context_id) DO NOTHING`,
    [timestamp],
  );
  await runtimePool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,phase,phase_message,request_text,request_metadata,created_at,updated_at)
     VALUES('task-p04-running','context-p04-running','user-p04','executing','Executing.',
            'Keep running during registry outage.','{}'::jsonb,$1,$1)
     ON CONFLICT(task_id) DO UPDATE SET phase='executing',updated_at=EXCLUDED.updated_at`,
    [timestamp],
  );
}

class FakeSmppRegistry {
  readonly #states = new Map<
    string,
    Readonly<{
      revision: number;
      etag: string;
      generatedAt: string;
      expiresAt: string;
      providers: readonly RawProvider[];
      checksum: string;
    }>
  >();
  readonly #modes = new Map<
    string,
    'normal' | 'bad_checksum' | 'expired' | 'lineage_mismatch' | 'unavailable'
  >();
  readonly #calls = new Map<string, number>();
  readonly #lastIfNoneMatch = new Map<string, string | undefined>();

  setSnapshot(
    sourceId: string,
    revision: number,
    externalProviderId: string,
    externalServerId: string,
  ): void {
    const generatedAt = new Date(Date.now() - 1_000).toISOString();
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const providers = Object.freeze([
      Object.freeze({
        externalProviderId,
        externalServerId,
        serverEndpoint: `https://${sourceId}.example.test/mcp`,
        catalogRevision: String(revision),
        labels: Object.freeze({ environment: 'integration', protocolMode: 'frozen_v1' }),
      }),
    ]);
    const candidates = providers.map((provider) => candidateFromRaw(sourceId, provider));
    const checksum = computeSmppSnapshotChecksum({
      smppSourceId: sourceId,
      revision,
      generatedAt,
      expiresAt,
      candidates,
    });
    this.#states.set(
      sourceId,
      Object.freeze({
        revision,
        etag: `"${checksum}"`,
        generatedAt,
        expiresAt,
        providers,
        checksum,
      }),
    );
    this.#modes.set(sourceId, 'normal');
  }

  setMode(
    sourceId: string,
    mode: 'normal' | 'bad_checksum' | 'expired' | 'lineage_mismatch' | 'unavailable',
  ): void {
    this.#modes.set(sourceId, mode);
  }

  calls(sourceId: string): number {
    return this.#calls.get(sourceId) ?? 0;
  }

  lastIfNoneMatch(sourceId: string): string | undefined {
    return this.#lastIfNoneMatch.get(sourceId);
  }

  checksum(sourceId: string): string {
    const state = this.#states.get(sourceId);
    if (state === undefined) throw new Error(`Missing fake SMPP source ${sourceId}.`);
    return state.checksum;
  }

  etag(sourceId: string): string {
    const state = this.#states.get(sourceId);
    if (state === undefined) throw new Error(`Missing fake SMPP source ${sourceId}.`);
    return state.etag;
  }

  respond(request: IncomingMessage, response: ServerResponse): void {
    const sourceId = request.url?.split('/').find((segment) => segment !== '') ?? '';
    this.#calls.set(sourceId, this.calls(sourceId) + 1);
    const ifNoneMatch = request.headers['if-none-match'];
    this.#lastIfNoneMatch.set(sourceId, typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined);
    if (request.headers.authorization !== 'Bearer credential-value') {
      response.writeHead(401).end();
      return;
    }
    const state = this.#states.get(sourceId);
    if (state === undefined || this.#modes.get(sourceId) === 'unavailable') {
      response.writeHead(503).end();
      return;
    }
    const mode = this.#modes.get(sourceId);
    const lineageHeaders = {
      'x-smpp-native-revision': String(state.revision),
      'x-smpp-native-checksum': mode === 'lineage_mismatch' ? 'f'.repeat(64) : 'e'.repeat(64),
      'x-smpp-projection-contract': 'sdar-registry-v1',
    };
    if (
      request.headers['if-none-match'] === state.etag &&
      (mode === 'normal' || mode === 'lineage_mismatch')
    ) {
      response.writeHead(304, { etag: state.etag, ...lineageHeaders }).end();
      return;
    }
    const generatedAt =
      mode === 'expired' ? new Date(Date.now() - 3_600_000).toISOString() : state.generatedAt;
    const expiresAt =
      mode === 'expired' ? new Date(Date.now() - 1_000).toISOString() : state.expiresAt;
    const projectedChecksum = computeSmppSnapshotChecksum({
      smppSourceId: sourceId,
      revision: state.revision,
      generatedAt,
      expiresAt,
      candidates: state.providers.map((provider) => candidateFromRaw(sourceId, provider)),
    });
    const responseChecksum = mode === 'bad_checksum' ? '0'.repeat(64) : projectedChecksum;
    response
      .writeHead(200, {
        'content-type': 'application/json',
        etag: `"${responseChecksum}"`,
        ...lineageHeaders,
      })
      .end(
        JSON.stringify({
          revision: state.revision,
          checksum: responseChecksum,
          generatedAt,
          expiresAt,
          providers: state.providers,
        }),
      );
  }
}

interface RawProvider {
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly serverEndpoint: string;
  readonly catalogRevision: string;
  readonly labels: Readonly<Record<string, string>>;
}

function candidateFromRaw(sourceId: string, provider: RawProvider): SmppProviderCandidate {
  return {
    smppSourceId: sourceId,
    externalProviderId: provider.externalProviderId,
    externalServerId: provider.externalServerId,
    compositeIdentity: smppCandidateIdentity(
      sourceId,
      provider.externalProviderId,
      provider.externalServerId,
    ),
    serverEndpoint: provider.serverEndpoint,
    catalogRevision: provider.catalogRevision,
    labels: provider.labels,
  };
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('P04_REGISTRY_ADDRESS_INVALID'));
        return;
      }
      resolve(`http://127.0.0.1:${String(address.port)}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function requireControlApi(): NodeControlApiRuntime {
  if (controlApi === undefined) throw new Error('P04_CONTROL_API_NOT_STARTED');
  return controlApi;
}
