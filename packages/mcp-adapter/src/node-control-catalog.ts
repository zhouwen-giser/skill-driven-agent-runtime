import process from 'node:process';

import type { NodeControlMcpCatalogClient } from '../../node-control-application/src/index.js';
import {
  hashConfigurationRequest,
  type JsonValue,
  validateMcpCredentialRef,
} from '../../node-control-domain/src/index.js';
import {
  createMcpServer,
  deriveFrozenMcpCatalogAuthority,
  frozenMcpCatalogDocument,
} from '../../domain/src/index.js';
import { FrozenV1RegistryAdapter } from './frozen-v1-registry.js';
import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

const FROZEN_BASELINE_SHA256 = '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708';

export class NodeControlFrozenMcpCatalogClient implements NodeControlMcpCatalogClient {
  readonly #registry: FrozenV1RegistryAdapter;
  readonly #allowedAuthorities: ReadonlySet<string>;

  constructor(allowedAuthorities: readonly string[], registry?: FrozenV1RegistryAdapter) {
    this.#allowedAuthorities = new Set(
      allowedAuthorities.map((value) => value.trim().toLowerCase()).filter((value) => value !== ''),
    );
    this.#registry =
      registry ??
      new FrozenV1RegistryAdapter(
        new FrozenV1McpClient((input, init) =>
          globalThis.fetch(allowedEndpoint(requestUrl(input), this.#allowedAuthorities), {
            ...init,
            redirect: 'manual',
          }),
        ),
      );
  }

  async discover(input: Parameters<NodeControlMcpCatalogClient['discover']>[0]) {
    const endpoint = allowedEndpoint(input.endpointRef, this.#allowedAuthorities);
    const credential = resolveCredential(input.credentialRef);
    const server = createMcpServer({
      serverId: input.localServerId,
      name: input.localServerId,
      endpoint,
      transport: 'streamable_http',
      status: 'enabled',
      toolRevision: input.bindingRevision,
      protocolMode: 'frozen_v1',
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
    });
    const discovered = await this.#registry.discover({
      server,
      headers: Object.freeze({ authorization: `Bearer ${credential}` }),
      snapshotId: input.snapshotId,
      baselineSha256: FROZEN_BASELINE_SHA256,
      discoveredAt: input.observedAt,
    });
    const catalogAuthority = deriveFrozenMcpCatalogAuthority(
      discovered.snapshot,
      discovered.tools,
      input.bindingRevision,
    );
    const validatedChecksum = hashConfigurationRequest(
      frozenMcpCatalogDocument(discovered.snapshot, discovered.tools) as JsonValue,
    );
    if (validatedChecksum !== catalogAuthority.catalogChecksum)
      throw new Error('MCP_CATALOG_CANONICAL_AUTHORITY_MISMATCH');
    return Object.freeze({
      catalogRevision: catalogAuthority.catalogRevision,
      catalogChecksum: catalogAuthority.catalogChecksum,
      availabilityStatus: 'available' as const,
      availabilityValidUntil:
        discovered.snapshot.validUntil ??
        new Date(Date.parse(input.observedAt) + 300_000).toISOString(),
      observedAt: input.observedAt,
      operationCount: catalogAuthority.operationCount,
    });
  }
}

function resolveCredential(reference: string): string {
  const normalized = validateMcpCredentialRef(reference);
  const variable = /^secret:\/\/env\/([A-Z][A-Z0-9_]*)$/u.exec(normalized)?.[1];
  const value = variable === undefined ? undefined : process.env[variable];
  if (value === undefined || value === '')
    throw Object.assign(new Error('MCP credential SecretRef is unavailable.'), {
      code: 'SECRET_REFERENCE_UNAVAILABLE',
    });
  return value;
}

function allowedEndpoint(value: string, allowed: ReadonlySet<string>): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return denied();
  }
  const authority = endpoint.host.toLowerCase();
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    (!allowed.has(authority) && !allowed.has(endpoint.hostname.toLowerCase()))
  )
    return denied();
  endpoint.hash = '';
  return endpoint.toString();
}

function denied(): never {
  throw Object.assign(new Error('MCP endpoint is outside the configured SSRF allowlist.'), {
    code: 'MCP_ENDPOINT_NOT_ALLOWED',
  });
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}
