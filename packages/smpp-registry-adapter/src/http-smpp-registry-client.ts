import process from 'node:process';

import { z } from 'zod';

import type {
  SmppRegistryClient,
  SmppRegistryFetchResult,
} from '../../node-control-application/src/index.js';
import {
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
    const credential = await this.#credentials.resolve(source.credentialRef);
    if (credential === undefined) throw unavailable();
    let response: Response;
    try {
      response = await this.#fetch(source.registryEndpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${credential}`,
          ...(ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch }),
        },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw unavailable();
    }
    if (response.status === 304) {
      const etag = response.headers.get('etag') ?? ifNoneMatch;
      if (etag === undefined) throw unavailable();
      return Object.freeze({ status: 'not_modified', etag });
    }
    if (!response.ok) throw unavailable();
    const etag = response.headers.get('etag');
    if (etag === null || etag.trim() === '') throw unavailable();
    let payload: z.infer<typeof SnapshotSchema>;
    try {
      payload = SnapshotSchema.parse(await response.json());
    } catch {
      throw unavailable();
    }
    return Object.freeze({
      status: 'snapshot',
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
              ...(provider.displayName === undefined ? {} : { displayName: provider.displayName }),
              ...(provider.catalogRevision === undefined
                ? {}
                : { catalogRevision: provider.catalogRevision }),
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
    serverEndpoint: z.url(),
    displayName: z.string().trim().min(1).max(256).optional(),
    catalogRevision: z.string().trim().min(1).max(256).optional(),
    labels: z.record(z.string(), z.string()).default({}),
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

function unavailable(): Error & { code: 'SMPP_SOURCE_UNAVAILABLE' } {
  return Object.assign(new Error('SMPP Registry source is unavailable.'), {
    code: 'SMPP_SOURCE_UNAVAILABLE' as const,
  });
}
