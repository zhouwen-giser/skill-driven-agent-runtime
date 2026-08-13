import { describe, expect, it } from 'vitest';

import {
  SMPP_UNAUTHENTICATED_CREDENTIAL_REF,
  computeSmppSnapshotChecksum,
  createSmppRegistrySnapshot,
  createSmppRegistrySource,
  smppCandidateIdentity,
  type SmppProviderCandidate,
  type SmppRegistrySource,
} from '../../node-control-domain/src/index.js';
import { HttpSmppRegistryClient, type SmppCredentialResolver } from '../src/index.js';

describe('SMPP Registry projection HTTP client', () => {
  it('accepts the frozen provider DTO, sends bearer credentials without redirect following and normalizes endpoints at the domain boundary', async () => {
    const provider = contractProvider({
      serverEndpoint: 'https://provider.example.test/mcp/#catalog',
    });
    const response = jsonResponse(snapshotBody([provider]));
    const stub = stubFetch(response);
    const client = new HttpSmppRegistryClient(credentials(), { fetch: stub.fetch });

    const result = await client.fetchLatest(source());

    expect(result.status).toBe('snapshot');
    if (result.status !== 'snapshot') throw new Error('Expected a Snapshot response.');
    expect(result.nativeLineage).toEqual({
      nativeRevision: 7,
      nativeChecksum: NATIVE_CHECKSUM,
      projectionContract: 'sdar-registry-v1',
    });
    const snapshot = createSmppRegistrySnapshot(result.snapshot);
    expect(snapshot.candidates).toEqual([
      expect.objectContaining({
        externalProviderId: 'ha-light-provider',
        externalServerId: 'ha-light-runtime',
        serverEndpoint: 'https://provider.example.test/mcp',
        catalogRevision: '42',
        labels: { environment: 'home-lab', protocolMode: 'frozen_v1' },
      }),
    ]);
    expect(stub.calls).toHaveLength(1);
    const request = stub.calls[0];
    expect(request === undefined ? undefined : requestUrl(request.input)).toBe(
      source().registryEndpoint,
    );
    expect(request?.init?.redirect).toBe('manual');
    expect(new Headers(request?.init?.headers).get('authorization')).toBe('Bearer registry-token');
    expect(new Headers(request?.init?.headers).get('accept')).toBe('application/json');
  });

  it('supports the explicit unauthenticated authority without resolving or sending a credential', async () => {
    const stub = stubFetch(jsonResponse(snapshotBody()));
    let resolverCalled = false;
    const client = new HttpSmppRegistryClient(
      {
        resolve: () => {
          resolverCalled = true;
          return Promise.resolve('must-not-be-used');
        },
      },
      { fetch: stub.fetch },
    );

    const result = await client.fetchLatest({
      ...source(),
      credentialRef: SMPP_UNAUTHENTICATED_CREDENTIAL_REF,
    });

    expect(result.status).toBe('snapshot');
    expect(resolverCalled).toBe(false);
    expect(new Headers(stub.calls[0]?.init?.headers).has('authorization')).toBe(false);
    expect(stub.calls[0]?.init?.redirect).toBe('manual');
  });

  it('returns an explicit 304 result and sends If-None-Match', async () => {
    const checksum = 'a'.repeat(64);
    const stub = stubFetch(
      new Response(null, {
        status: 304,
        headers: projectionHeaders(checksum, 7),
      }),
    );
    const client = new HttpSmppRegistryClient(credentials(), { fetch: stub.fetch });

    await expect(client.fetchLatest(source(), `"${checksum}"`)).resolves.toEqual({
      status: 'not_modified',
      etag: `"${checksum}"`,
      nativeLineage: {
        nativeRevision: 7,
        nativeChecksum: NATIVE_CHECKSUM,
        projectionContract: 'sdar-registry-v1',
      },
    });
    expect(new Headers(stub.calls[0]?.init?.headers).get('if-none-match')).toBe(`"${checksum}"`);
  });

  it.each([
    ['mismatched', `"${'b'.repeat(64)}"`],
    ['unquoted', 'a'.repeat(64)],
    ['weak', `W/"${'a'.repeat(64)}"`],
    ['missing', undefined],
  ])('rejects a 200 response with a %s projection ETag', async (_caseName, etag) => {
    const body = snapshotBody();
    const headers = projectionHeaders(body.checksum, body.revision);
    if (etag === undefined) headers.delete('etag');
    else headers.set('etag', etag);
    const client = new HttpSmppRegistryClient(credentials(), {
      fetch: stubFetch(new Response(JSON.stringify(body), { status: 200, headers })).fetch,
    });

    await expect(client.fetchLatest(source())).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
  });

  it.each([
    ['mismatched', `"${'b'.repeat(64)}"`],
    ['missing', undefined],
  ])('rejects a 304 response with a %s projection ETag', async (_caseName, etag) => {
    const checksum = 'a'.repeat(64);
    const headers = projectionHeaders(checksum, 7);
    if (etag === undefined) headers.delete('etag');
    else headers.set('etag', etag);
    const client = new HttpSmppRegistryClient(credentials(), {
      fetch: stubFetch(new Response(null, { status: 304, headers })).fetch,
    });

    await expect(client.fetchLatest(source(), `"${checksum}"`)).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
  });

  it('rejects a 304 response without complete native lineage headers', async () => {
    const checksum = 'a'.repeat(64);
    const headers = projectionHeaders(checksum, 7);
    headers.delete('x-smpp-projection-contract');
    const client = new HttpSmppRegistryClient(credentials(), {
      fetch: stubFetch(new Response(null, { status: 304, headers })).fetch,
    });

    await expect(client.fetchLatest(source(), `"${checksum}"`)).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
  });

  it.each([
    ['missing native revision', 'x-smpp-native-revision', undefined],
    ['non-canonical native revision', 'x-smpp-native-revision', '07'],
    ['mismatched native revision', 'x-smpp-native-revision', '8'],
    ['bad native checksum', 'x-smpp-native-checksum', 'native-checksum'],
    ['wrong projection contract', 'x-smpp-projection-contract', 'sdar-registry-v2'],
  ])('rejects %s lineage on 200', async (_caseName, header, value) => {
    const body = snapshotBody();
    const headers = projectionHeaders(body.checksum, body.revision);
    if (value === undefined) headers.delete(header);
    else headers.set(header, value);
    const client = new HttpSmppRegistryClient(credentials(), {
      fetch: stubFetch(new Response(JSON.stringify(body), { status: 200, headers })).fetch,
    });

    await expect(client.fetchLatest(source())).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
  });

  it.each([
    ['displayName', { ...contractProvider(), displayName: 'Contract-external field' }],
    ['unknown field', { ...contractProvider(), tools: [] }],
    ['numeric catalogRevision', { ...contractProvider(), catalogRevision: 42 }],
    ['zero catalogRevision', { ...contractProvider(), catalogRevision: '0' }],
    ['missing catalogRevision', without(contractProvider(), 'catalogRevision')],
    ['missing labels', without(contractProvider(), 'labels')],
    [
      'unknown label',
      { ...contractProvider(), labels: { ...contractProvider().labels, region: 'local' } },
    ],
    [
      'invalid environment label',
      {
        ...contractProvider(),
        labels: { environment: 'Home_Lab', protocolMode: 'frozen_v1' },
      },
    ],
    [
      'non-frozen protocol label',
      { ...contractProvider(), labels: { environment: 'home-lab', protocolMode: 'legacy' } },
    ],
  ])('rejects a provider DTO with %s', async (_caseName, provider) => {
    const stub = stubFetch(
      jsonResponse({
        revision: 7,
        checksum: '0'.repeat(64),
        generatedAt: GENERATED_AT,
        expiresAt: EXPIRES_AT,
        providers: [provider],
      }),
    );
    const client = new HttpSmppRegistryClient(credentials(), { fetch: stub.fetch });

    await expect(client.fetchLatest(source())).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
  });

  it('rejects a redirect response without issuing a second credential-bearing request', async () => {
    const stub = stubFetch(
      new Response(null, {
        status: 302,
        headers: { location: 'https://untrusted.example.test/steal-token' },
      }),
    );
    const client = new HttpSmppRegistryClient(credentials(), { fetch: stub.fetch });

    await expect(client.fetchLatest(source())).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.init?.redirect).toBe('manual');
    expect(new Headers(stub.calls[0]?.init?.headers).get('authorization')).toBe(
      'Bearer registry-token',
    );
  });

  it('leaves checksum rejection to the canonical domain boundary and rejects credential-bearing endpoints at ingress', async () => {
    const badChecksum = snapshotBody();
    const checksumStub = stubFetch(jsonResponse({ ...badChecksum, checksum: '0'.repeat(64) }));
    const checksumClient = new HttpSmppRegistryClient(credentials(), {
      fetch: checksumStub.fetch,
    });
    const checksumResult = await checksumClient.fetchLatest(source());
    if (checksumResult.status !== 'snapshot') throw new Error('Expected a Snapshot response.');
    expect(() => createSmppRegistrySnapshot(checksumResult.snapshot)).toThrow(/checksum/u);

    const credentialEndpointBody = {
      ...snapshotBody(),
      checksum: '0'.repeat(64),
      providers: [
        contractProvider({ serverEndpoint: 'https://user:secret@provider.example.test/mcp' }),
      ],
    };
    const endpointStub = stubFetch(jsonResponse(credentialEndpointBody));
    const endpointClient = new HttpSmppRegistryClient(credentials(), { fetch: endpointStub.fetch });
    await expect(endpointClient.fetchLatest(source())).rejects.toMatchObject({
      code: 'SMPP_SOURCE_UNAVAILABLE',
    });
  });
});

const GENERATED_AT = '2026-08-10T00:00:00.000Z';
const EXPIRES_AT = '2026-08-10T00:05:00.000Z';
const NATIVE_CHECKSUM = 'd'.repeat(64);

interface ContractProvider {
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly serverEndpoint: string;
  readonly catalogRevision: string;
  readonly labels: Readonly<Record<string, string>>;
}

function source(): SmppRegistrySource {
  return createSmppRegistrySource({
    smppSourceId: 'home-lab-smpp',
    registryEndpoint:
      'https://registry.example.test/consumers/sdar/v1/sources/home-lab-smpp/latest',
    credentialRef: 'secret://env/SMPP_REGISTRY_BEARER_TOKEN',
    environment: 'home-lab',
    syncMode: 'poll',
    snapshotTtlSeconds: 300,
    lkgPolicy: 'allow_unexpired',
    status: 'draft',
    revision: 1,
  });
}

function credentials(): SmppCredentialResolver {
  return Object.freeze({ resolve: () => Promise.resolve('registry-token') });
}

function contractProvider(overrides: Partial<ContractProvider> = {}): ContractProvider {
  return Object.freeze({
    externalProviderId: 'ha-light-provider',
    externalServerId: 'ha-light-runtime',
    serverEndpoint: 'https://provider.example.test/mcp',
    catalogRevision: '42',
    labels: Object.freeze({ environment: 'home-lab', protocolMode: 'frozen_v1' }),
    ...overrides,
  });
}

function snapshotBody(providers: readonly ContractProvider[] = [contractProvider()]) {
  const candidates = providers.map((provider) => candidate(provider));
  const input = Object.freeze({
    smppSourceId: 'home-lab-smpp',
    revision: 7,
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    candidates,
  });
  return Object.freeze({
    revision: input.revision,
    checksum: computeSmppSnapshotChecksum(input),
    generatedAt: input.generatedAt,
    expiresAt: input.expiresAt,
    providers,
  });
}

function candidate(provider: ContractProvider): SmppProviderCandidate {
  return Object.freeze({
    smppSourceId: 'home-lab-smpp',
    externalProviderId: provider.externalProviderId,
    externalServerId: provider.externalServerId,
    compositeIdentity: smppCandidateIdentity(
      'home-lab-smpp',
      provider.externalProviderId,
      provider.externalServerId,
    ),
    serverEndpoint: provider.serverEndpoint,
    catalogRevision: provider.catalogRevision,
    labels: provider.labels,
  });
}

function jsonResponse(body: unknown): Response {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('checksum' in body) ||
    typeof body.checksum !== 'string' ||
    !('revision' in body) ||
    typeof body.revision !== 'number'
  )
    throw new Error('TEST_PROJECTION_RESPONSE_INVALID');
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: projectionHeaders(body.checksum, body.revision),
  });
}

function projectionHeaders(checksum: string, nativeRevision: number): Headers {
  return new Headers({
    'content-type': 'application/json',
    etag: `"${checksum}"`,
    'x-smpp-native-revision': String(nativeRevision),
    'x-smpp-native-checksum': NATIVE_CHECKSUM,
    'x-smpp-projection-contract': 'sdar-registry-v1',
  });
}

function stubFetch(response: Response): Readonly<{
  fetch: typeof fetch;
  calls: Readonly<{ input: string | URL | Request; init?: RequestInit }>[];
}> {
  const calls: Readonly<{ input: string | URL | Request; init?: RequestInit }>[] = [];
  const implementation: typeof fetch = (input, init) => {
    calls.push(Object.freeze({ input, ...(init === undefined ? {} : { init }) }));
    return Promise.resolve(response);
  };
  return Object.freeze({ fetch: implementation, calls });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof Request ? input.url : input.href;
}

function without(value: ContractProvider, key: keyof ContractProvider): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  Reflect.deleteProperty(result, key);
  return result;
}
