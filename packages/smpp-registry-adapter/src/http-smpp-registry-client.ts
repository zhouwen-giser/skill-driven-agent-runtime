import process from 'node:process';

import { z } from 'zod';

import type {
  SmppRegistryClient,
  SmppRegistryFetchResult,
} from '../../node-control-application/src/index.js';
import {
  SMPP_UNAUTHENTICATED_CREDENTIAL_REF,
  smppCandidateIdentity,
  type SmppRegistrySource,
} from '../../node-control-domain/src/index.js';

export interface SmppCredentialResolver {
  resolve(credentialRef: string): Promise<string | undefined>;
}

export class EnvironmentSmppCredentialResolver implements SmppCredentialResolver {
  resolve(credentialRef: string): Promise<string | undefined> {
    const variable = /^secret:\/\/env\/([A-Z][A-Z0-9_]*)$/u.exec(credentialRef)?.[1];
    return Promise.resolve(variable === undefined ? undefined : process.env[variable]);
  }
}

export class HttpSmppRegistryClient implements SmppRegistryClient {
  readonly #credentials: SmppCredentialResolver;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(
    credentials: SmppCredentialResolver,
    options: Readonly<{ fetch?: typeof fetch; timeoutMs?: number }> = {},
  ) {
    this.#credentials = credentials;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  async fetchLatest(
    source: SmppRegistrySource,
    ifNoneMatch?: string,
  ): Promise<SmppRegistryFetchResult> {
    const unauthenticated = source.credentialRef === SMPP_UNAUTHENTICATED_CREDENTIAL_REF;
    const credential = unauthenticated
      ? undefined
      : await this.#credentials.resolve(source.credentialRef);
    if (!unauthenticated && credential === undefined) throw unavailable();
    let response: Response;
    try {
      response = await this.#fetch(source.registryEndpoint, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'application/json',
          ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
          ...(ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch }),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 304) {
      const etag = response.headers.get('etag');
      if (
        etag === null ||
        ifNoneMatch === undefined ||
        !QUOTED_CHECKSUM.test(ifNoneMatch) ||
        etag !== ifNoneMatch
      )
        throw unavailable();
      return Object.freeze({
        status: 'not_modified',
        etag,
        nativeLineage: responseLineage(response),
      });
    }
    if (response.status >= 300 && response.status < 400) throw unavailable();
    if (!response.ok) throw unavailable();
    let payload: z.infer<typeof SnapshotSchema>;
    try {
      payload = SnapshotSchema.parse(await response.json());
    } catch {
      throw unavailable();
    }
    const etag = response.headers.get('etag');
    if (etag !== `"${payload.checksum}"`) throw unavailable();
    const nativeLineage = responseLineage(response, payload.revision);
    return Object.freeze({
      status: 'snapshot',
      nativeLineage,
      snapshot: Object.freeze({
        smppSourceId: source.smppSourceId,
        revision: payload.revision,
        checksum: payload.checksum,
        etag,
        generatedAt: payload.generatedAt,
        expiresAt: payload.expiresAt,
        candidates: Object.freeze(
          payload.providers.map((provider) =>
            Object.freeze({
              smppSourceId: source.smppSourceId,
              externalProviderId: provider.externalProviderId,
              externalServerId: provider.externalServerId,
              compositeIdentity: smppCandidateIdentity(
                source.smppSourceId,
                provider.externalProviderId,
                provider.externalServerId,
              ),
              serverEndpoint: provider.serverEndpoint,
              catalogRevision: provider.catalogRevision,
              labels: Object.freeze(provider.labels),
            }),
          ),
        ),
      }),
    });
  }
}

const ProviderSchema = z
  .object({
    externalProviderId: z.string().trim().min(1).max(256),
    externalServerId: z.string().trim().min(1).max(256),
    serverEndpoint: z
      .string()
      .regex(/^https?:\/\//u)
      .refine(safeHttpEndpoint, 'serverEndpoint must be HTTP(S) without credentials.'),
    catalogRevision: z.string().regex(/^[1-9][0-9]*$/u),
    labels: z
      .object({
        environment: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u),
        protocolMode: z.literal('frozen_v1'),
      })
      .strict(),
  })
  .strict();

const SnapshotSchema = z
  .object({
    revision: z.number().int().positive(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    generatedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    providers: z.array(ProviderSchema).max(100_000),
  })
  .strict();

const QUOTED_CHECKSUM = /^"[a-f0-9]{64}"$/u;
const CHECKSUM = /^[a-f0-9]{64}$/u;
const NATIVE_REVISION = /^[1-9][0-9]*$/u;
const PROJECTION_CONTRACT = 'sdar-registry-v1';

function responseLineage(response: Response, projectionRevision?: number) {
  const revisionHeader = response.headers.get('x-smpp-native-revision');
  const checksum = response.headers.get('x-smpp-native-checksum');
  const contract = response.headers.get('x-smpp-projection-contract');
  if (
    revisionHeader === null ||
    !NATIVE_REVISION.test(revisionHeader) ||
    checksum === null ||
    !CHECKSUM.test(checksum) ||
    contract !== PROJECTION_CONTRACT
  )
    throw unavailable();
  const nativeRevision = Number(revisionHeader);
  if (
    !Number.isSafeInteger(nativeRevision) ||
    (projectionRevision !== undefined && nativeRevision !== projectionRevision)
  )
    throw unavailable();
  return Object.freeze({
    nativeRevision,
    nativeChecksum: checksum,
    projectionContract: PROJECTION_CONTRACT,
  });
}

function unavailable(): Error & { code: 'SMPP_SOURCE_UNAVAILABLE' } {
  return Object.assign(new Error('SMPP Registry source is unavailable.'), {
    code: 'SMPP_SOURCE_UNAVAILABLE' as const,
  });
}

function safeHttpEndpoint(value: string): boolean {
  try {
    const endpoint = new URL(value);
    return (
      (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') &&
      endpoint.username === '' &&
      endpoint.password === ''
    );
  } catch {
    return false;
  }
}
