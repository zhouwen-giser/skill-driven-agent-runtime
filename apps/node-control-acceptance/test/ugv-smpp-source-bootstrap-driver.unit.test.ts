import { describe, expect, it } from 'vitest';

import {
  bootstrapUgvSmppSource,
  ugvSmppSourceBootstrapConfigurationFromEnvironment,
  type UgvSmppSourceBootstrapConfiguration,
} from '../src/ugv-smpp-source-bootstrap-driver.js';

const NOW = '2026-08-12T01:00:00.000Z';
const INITIAL_VALID_UNTIL = '2026-08-12T02:00:00.000Z';
const CONDITIONAL_VALID_UNTIL = '2026-08-12T02:05:00.000Z';
const REGISTRY_CHECKSUM = 'a'.repeat(64);
const NATIVE_CHECKSUM = 'b'.repeat(64);
const ADMIN_TOKEN = 'node-admin-secret-never-report-123456789';
const REGISTRY_ENDPOINT =
  'http://192.168.1.7:18088/api/v1/registry/production/consumers/sdar/v1/sources/ugv-smpp/latest';

describe('UGV SMPP Source bootstrap driver', () => {
  it('creates and synchronizes an explicit unauthenticated Source, then proves conditional 304', async () => {
    const api = new FakeNodeControl();

    const report = await bootstrapUgvSmppSource(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(report).toMatchObject({
      status: 'passed',
      evidenceClass: 'real_public_api',
      sourceAction: 'created',
      authenticationMode: 'none',
      sourceSyncMode: 'manual',
      snapshotRevision: 7,
      snapshotChecksum: REGISTRY_CHECKSUM,
      nativeRegistryRevision: 31,
      nativeRegistryChecksum: NATIVE_CHECKSUM,
      registryProjectionContract: 'sdar-registry-v1',
      candidateCount: 1,
      initialSyncOutcome: 'applied',
      conditionalSyncOutcome: 'not_modified',
      conditionalValidity: 'extended',
    });
    expect(api.commands).toEqual(['create', 'sync:applied', 'sync:not_modified']);
    expect(api.requests.every((request) => request.redirect === 'manual')).toBe(true);
    expect(api.requests.every((request) => request.authorization === `Bearer ${ADMIN_TOKEN}`)).toBe(
      true,
    );
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      ADMIN_TOKEN,
      REGISTRY_ENDPOINT,
      'unauthenticated://none',
      'isr.vehicle.ugv.ugv1',
      'production-ugv-direct-1',
      'http://192.168.1.7:19100/mcp',
    ])
      expect(serialized).not.toContain(forbidden);
    expect(serialized).not.toContain('"smppSourceId":"ugv-smpp"');
    expect(report.redaction).toEqual({
      secretsIncluded: false,
      credentialReferencesIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    });
  });

  it('reuses an exact active Source and keeps both synchronization operations idempotent', async () => {
    const api = new FakeNodeControl({ existing: true });

    const first = await bootstrapUgvSmppSource(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });
    const second = await bootstrapUgvSmppSource(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(first).toMatchObject({
      sourceAction: 'reused',
      initialSyncOutcome: 'not_modified',
      conditionalSyncOutcome: 'not_modified',
    });
    expect(second).toMatchObject({
      ...first,
      conditionalValidity: 'unchanged',
    });
    expect(api.commands).toEqual(['sync:not_modified', 'sync:not_modified']);
  });

  it('fails closed on immutable existing Source drift before any mutation', async () => {
    const api = new FakeNodeControl({ existing: true });
    api.source = { ...api.requireSource(), registryEndpoint: 'https://drift.example.test/latest' };

    await expect(
      bootstrapUgvSmppSource(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'SOURCE_IMMUTABLE_CONFIGURATION_DRIFT' });
    expect(api.commands).toEqual([]);
  });

  it('fails closed when an existing immutable Source has a different sync mode', async () => {
    const api = new FakeNodeControl({ existing: true });

    await expect(
      bootstrapUgvSmppSource(
        { ...configuration(), syncMode: 'poll' },
        { fetch: api.fetch, now: () => NOW },
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_IMMUTABLE_CONFIGURATION_DRIFT' });
    expect(api.commands).toEqual([]);
  });

  it.each([
    ['missing', []],
    ['duplicate', [candidate(INITIAL_VALID_UNTIL), candidate(INITIAL_VALID_UNTIL)]],
    [
      'wrong tuple',
      [
        {
          ...candidate(INITIAL_VALID_UNTIL),
          externalProviderId: 'wrong-provider',
          compositeIdentity: 'ugv-smpp::wrong-provider::production-ugv-direct-1',
        },
      ],
    ],
  ])('rejects a %s intended Candidate authority', async (_caseName, candidates) => {
    const api = new FakeNodeControl();
    api.candidateOverride = candidates;

    await expect(
      bootstrapUgvSmppSource(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({
      code:
        candidates.length === 1
          ? 'SOURCE_CANDIDATE_TUPLE_MISMATCH'
          : 'SOURCE_CANDIDATE_SET_NOT_EXACT',
    });
  });

  it('requires the second synchronization audit to prove not_modified', async () => {
    const api = new FakeNodeControl();
    api.secondSyncOutcome = 'applied';

    await expect(
      bootstrapUgvSmppSource(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'SOURCE_CONDITIONAL_304_NOT_OBSERVED' });
  });

  it('rejects shortened validity even when the second audit says not_modified', async () => {
    const api = new FakeNodeControl();
    api.conditionalValidUntil = '2026-08-12T01:59:00.000Z';

    await expect(
      bootstrapUgvSmppSource(configuration(), { fetch: api.fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'SOURCE_CONDITIONAL_VALIDITY_SHORTENED' });
  });

  it('requires an explicit Registry credential mode and separate bootstrap run ID from env', () => {
    const environment = deploymentEnvironment();
    expect(ugvSmppSourceBootstrapConfigurationFromEnvironment(environment)).toMatchObject({
      registryCredentialRef: 'unauthenticated://none',
      syncMode: 'poll',
      runId: 'ugv-source-bootstrap-20260812',
      snapshotTtlSeconds: 300,
      lkgPolicy: 'allow_unexpired',
    });
    delete environment['SMPP_REGISTRY_CREDENTIAL_REF'];
    expect(() => ugvSmppSourceBootstrapConfigurationFromEnvironment(environment)).toThrow(
      expect.objectContaining({ code: 'DRIVER_CONFIGURATION_INVALID' }),
    );

    const defaulted = deploymentEnvironment();
    delete defaulted['SMPP_SDAR_SYNC_MODE'];
    expect(ugvSmppSourceBootstrapConfigurationFromEnvironment(defaulted).syncMode).toBe('manual');

    const invalid = deploymentEnvironment();
    invalid['SMPP_SDAR_SYNC_MODE'] = 'watch';
    expect(() => ugvSmppSourceBootstrapConfigurationFromEnvironment(invalid)).toThrow(
      expect.objectContaining({ code: 'DRIVER_CONFIGURATION_INVALID' }),
    );
  });
});

function configuration(): UgvSmppSourceBootstrapConfiguration {
  return {
    nodeControlBaseUrl: 'http://127.0.0.1:10080',
    nodeControlAdminToken: ADMIN_TOKEN,
    smppSourceId: 'ugv-smpp',
    smppEnvironment: 'production',
    registryEndpoint: REGISTRY_ENDPOINT,
    registryCredentialRef: 'unauthenticated://none',
    syncMode: 'manual',
    snapshotTtlSeconds: 300,
    lkgPolicy: 'allow_unexpired',
    externalProviderId: 'isr.vehicle.ugv.ugv1',
    externalServerId: 'production-ugv-direct-1',
    runId: 'ugv-source-bootstrap-20260812',
  };
}

function deploymentEnvironment(): NodeJS.ProcessEnv {
  return {
    SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10080',
    SDAR_CONTROL_API_TOKEN: ADMIN_TOKEN,
    SMPP_SDAR_SOURCE_ID: 'ugv-smpp',
    SMPP_ENVIRONMENT: 'production',
    SMPP_SDAR_REGISTRY_ENDPOINT: REGISTRY_ENDPOINT,
    SMPP_REGISTRY_CREDENTIAL_REF: 'unauthenticated://none',
    SMPP_SDAR_SYNC_MODE: 'poll',
    SMPP_UGV_EXTERNAL_PROVIDER_ID: 'isr.vehicle.ugv.ugv1',
    SMPP_UGV_EXTERNAL_SERVER_ID: 'production-ugv-direct-1',
    SDAR_UGV_BOOTSTRAP_RUN_ID: 'ugv-source-bootstrap-20260812',
  };
}

class FakeNodeControl {
  readonly commands: string[] = [];
  readonly requests: { redirect: RequestInit['redirect']; authorization: string | null }[] = [];
  readonly #replays = new Map<string, Response>();
  readonly #audits = new Map<string, Record<string, unknown>>();
  source: Record<string, unknown> | undefined;
  candidateOverride: readonly unknown[] | undefined;
  secondSyncOutcome: 'applied' | 'not_modified' = 'not_modified';
  conditionalValidUntil = CONDITIONAL_VALID_UNTIL;
  #syncCount = 0;

  constructor(options: Readonly<{ existing?: boolean }> = {}) {
    if (options.existing === true) this.source = activeSource(INITIAL_VALID_UNTIL);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    await Promise.resolve();
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    this.requests.push({
      redirect: init?.redirect,
      authorization: headers.get('authorization'),
    });

    if (url.pathname === '/api/v1/smpp-sources' && init?.method !== 'POST')
      return json(200, {
        items: this.source === undefined ? [] : [this.source],
        totalEstimate: this.source === undefined ? 0 : 1,
        asOf: NOW,
      });
    if (url.pathname === '/api/v1/smpp-sources' && init?.method === 'POST') {
      const replay = this.replay(headers);
      if (replay !== undefined) return replay;
      const body = requestBody(init);
      this.source = { ...body, status: 'draft' };
      this.commands.push('create');
      return this.remember(headers, json(201, this.source));
    }
    if (url.pathname === '/api/v1/smpp-sources/ugv-smpp/sync') {
      const replay = this.replay(headers);
      if (replay !== undefined) return replay;
      this.#syncCount += 1;
      const body = requestBody(init);
      const reason = String(body['reason']);
      const outcome =
        this.#syncCount === 1 && this.source?.['status'] !== 'active'
          ? 'applied'
          : this.#syncCount === 2
            ? this.secondSyncOutcome
            : 'not_modified';
      const validUntil = this.#syncCount === 1 ? INITIAL_VALID_UNTIL : this.conditionalValidUntil;
      this.source = {
        ...this.requireSource(),
        status: 'active',
        activeSnapshotRevision: 7,
        activeSnapshotChecksum: REGISTRY_CHECKSUM,
        activeSnapshotValidUntil: validUntil,
        lastSyncAt: this.#syncCount === 1 ? '2026-08-12T01:00:01.000Z' : '2026-08-12T01:00:02.000Z',
      };
      this.commands.push(`sync:${outcome}`);
      this.#audits.set(reason, audit(reason, outcome));
      return this.remember(headers, json(202, operation(validUntil, outcome)));
    }
    if (url.pathname === '/api/v1/smpp-sources/ugv-smpp')
      return this.source === undefined
        ? json(404, { code: 'SMPP_SOURCE_NOT_FOUND' })
        : json(200, this.source);
    if (url.pathname === '/api/v1/mcp-provider-candidates') {
      const currentValidUntil = this.source?.['activeSnapshotValidUntil'];
      const validUntil =
        typeof currentValidUntil === 'string' ? currentValidUntil : INITIAL_VALID_UNTIL;
      return json(200, {
        items: this.candidateOverride ?? [candidate(validUntil)],
        totalEstimate: this.candidateOverride?.length ?? 1,
        asOf: NOW,
      });
    }
    if (url.pathname === '/api/v1/audit-events')
      return json(200, {
        items: [...this.#audits.values()].reverse(),
        totalEstimate: this.#audits.size,
        asOf: NOW,
      });
    return json(500, { code: 'UNEXPECTED_FAKE_ROUTE' });
  };

  requireSource(): Record<string, unknown> {
    if (this.source === undefined) throw new Error('FAKE_SOURCE_MISSING');
    return this.source;
  }

  private replay(headers: Headers): Response | undefined {
    const key = headers.get('idempotency-key');
    return key === null ? undefined : this.#replays.get(key)?.clone();
  }

  private remember(headers: Headers, response: Response): Response {
    const key = headers.get('idempotency-key');
    if (key !== null) this.#replays.set(key, response.clone());
    return response;
  }
}

function activeSource(validUntil: string): Record<string, unknown> {
  return {
    smppSourceId: 'ugv-smpp',
    registryEndpoint: REGISTRY_ENDPOINT,
    credentialRef: 'unauthenticated://none',
    environment: 'production',
    syncMode: 'manual',
    snapshotTtlSeconds: 300,
    lkgPolicy: 'allow_unexpired',
    status: 'active',
    activeSnapshotRevision: 7,
    activeSnapshotChecksum: REGISTRY_CHECKSUM,
    activeSnapshotValidUntil: validUntil,
    lastSyncAt: '2026-08-12T00:59:59.000Z',
    revision: 1,
  };
}

function candidate(validUntil: string): Record<string, unknown> {
  return {
    smppSourceId: 'ugv-smpp',
    externalProviderId: 'isr.vehicle.ugv.ugv1',
    externalServerId: 'production-ugv-direct-1',
    compositeIdentity: 'ugv-smpp::isr.vehicle.ugv.ugv1::production-ugv-direct-1',
    serverEndpoint: 'http://192.168.1.7:19100/mcp',
    catalogRevision: '1',
    labels: { environment: 'production', protocolMode: 'frozen_v1' },
    registryRevision: 7,
    registryChecksum: REGISTRY_CHECKSUM,
    registryEtag: `"${REGISTRY_CHECKSUM}"`,
    registryValidUntil: validUntil,
    nativeRegistryRevision: 31,
    nativeRegistryChecksum: NATIVE_CHECKSUM,
    registryProjectionContract: 'sdar-registry-v1',
  };
}

function operation(validUntil: string, outcome: 'applied' | 'not_modified') {
  return {
    operationId: `operation-${outcome}`,
    operationType: 'smpp_source.sync',
    target: { type: 'smpp_source', id: 'ugv-smpp', revision: 1 },
    status: 'succeeded',
    result: {
      snapshotRevision: 7,
      checksum: REGISTRY_CHECKSUM,
      etag: `"${REGISTRY_CHECKSUM}"`,
      validUntil,
      nativeLineage: {
        nativeRevision: 31,
        nativeChecksum: NATIVE_CHECKSUM,
        projectionContract: 'sdar-registry-v1',
      },
      authority: 'candidate_directory_only',
      ...(outcome === 'applied' ? { candidateCount: 1 } : {}),
    },
  };
}

function audit(reason: string, outcome: 'applied' | 'not_modified') {
  return {
    auditId: `audit-${outcome}-${String(reason.length)}`,
    action: 'smpp_source.sync',
    aggregateType: 'smpp_source',
    aggregateId: 'ugv-smpp',
    reason,
    resultCode: outcome,
    createdAt: NOW,
  };
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('FAKE_REQUEST_BODY_MISSING');
  return JSON.parse(init.body) as Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
