import process from 'node:process';

import type { NodeControlMcpCatalogClient } from '../../node-control-application/src/index.js';
import {
  MCP_UNAUTHENTICATED_CREDENTIAL_REF,
  hashConfigurationRequest,
  type JsonValue,
  validateMcpCredentialRef,
} from '../../node-control-domain/src/index.js';
import {
  createMcpServer,
  deriveFrozenMcpCatalogAuthority,
  frozenMcpCatalogDocument,
  withMcpToolAdminExecutionSemanticsOverride,
  type McpToolExecutionSemantics,
} from '../../domain/src/index.js';
import { FrozenV1RegistryAdapter } from './frozen-v1-registry.js';
import { FrozenV1McpClient } from './frozen-v1-mcp-client.js';

const FROZEN_BASELINE_SHA256 = '9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708';
const CHECKSUM = /^[a-f0-9]{64}$/u;

export interface NodeControlRuntimeMcpCatalogAuthorityReader {
  loadCurrentAuthority(serverId: string): Promise<
    | Readonly<{
        endpoint: string;
        status: string;
        serverUpdatedAt: string;
        toolRevision: number;
        protocolMode: string;
        snapshotToolRevision: number;
        catalogChecksum: string;
        discoveredCatalogChecksum: string;
        operationCount: number;
        toolNames: readonly string[];
        executionSemanticsOverrides?: Readonly<Record<string, McpToolExecutionSemantics>>;
      }>
    | undefined
  >;
}

export class NodeControlFrozenMcpCatalogClient implements NodeControlMcpCatalogClient {
  readonly #registry: FrozenV1RegistryAdapter;
  readonly #allowedAuthorities: ReadonlySet<string>;
  readonly #runtimeAuthority: NodeControlRuntimeMcpCatalogAuthorityReader | undefined;
  readonly #allowedPrivateHttpAuthorities: ReadonlySet<string>;
  readonly #unsafeTestOpen: boolean;

  constructor(
    allowedAuthorities: readonly string[],
    registry?: FrozenV1RegistryAdapter,
    runtimeAuthority?: NodeControlRuntimeMcpCatalogAuthorityReader,
    allowedPrivateHttpAuthorities: readonly string[] = [],
    unsafeTestOpen = false,
  ) {
    this.#allowedAuthorities = new Set(
      allowedAuthorities.map((value) => value.trim().toLowerCase()).filter((value) => value !== ''),
    );
    this.#allowedPrivateHttpAuthorities = new Set(
      allowedPrivateHttpAuthorities
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value !== ''),
    );
    this.#unsafeTestOpen = unsafeTestOpen;
    this.#registry =
      registry ??
      new FrozenV1RegistryAdapter(
        new FrozenV1McpClient((input, init) =>
          globalThis.fetch(
            allowedEndpoint(
              requestUrl(input),
              this.#allowedAuthorities,
              this.#allowedPrivateHttpAuthorities,
              this.#unsafeTestOpen,
            ),
            {
              ...init,
              redirect: 'manual',
            },
          ),
        ),
      );
    this.#runtimeAuthority = runtimeAuthority;
  }

  async discover(input: Parameters<NodeControlMcpCatalogClient['discover']>[0]) {
    const endpoint = allowedEndpoint(
      input.endpointRef,
      this.#allowedAuthorities,
      this.#allowedPrivateHttpAuthorities,
      this.#unsafeTestOpen,
    );
    const credentialHeaders = resolveCredentialHeaders(input.credentialRef);
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
      headers: credentialHeaders,
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
    const discovery = Object.freeze({
      catalogRevision: catalogAuthority.catalogRevision,
      catalogChecksum: catalogAuthority.catalogChecksum,
      availabilityStatus: 'available' as const,
      availabilityValidUntil:
        discovered.snapshot.validUntil ??
        new Date(Date.parse(input.observedAt) + 300_000).toISOString(),
      observedAt: input.observedAt,
      operationCount: catalogAuthority.operationCount,
    });
    const runtimeAuthority = await this.#runtimeAuthority?.loadCurrentAuthority(
      input.localServerId,
    );
    if (runtimeAuthority === undefined) return discovery;
    const runtimeEndpoint = allowedEndpoint(
      runtimeAuthority.endpoint,
      this.#allowedAuthorities,
      this.#allowedPrivateHttpAuthorities,
      this.#unsafeTestOpen,
    );
    if (
      runtimeEndpoint !== endpoint ||
      runtimeAuthority.status !== 'enabled' ||
      runtimeAuthority.protocolMode !== 'frozen_v1' ||
      runtimeAuthority.snapshotToolRevision !== runtimeAuthority.toolRevision ||
      !Number.isFinite(Date.parse(runtimeAuthority.serverUpdatedAt)) ||
      runtimeAuthority.toolNames.length !== runtimeAuthority.operationCount ||
      !CHECKSUM.test(runtimeAuthority.catalogChecksum) ||
      !CHECKSUM.test(runtimeAuthority.discoveredCatalogChecksum)
    )
      throw new Error('MCP_RUNTIME_CATALOG_AUTHORITY_MISMATCH');
    const overrides = runtimeAuthority.executionSemanticsOverrides;
    if (overrides !== undefined) {
      const effectiveTools = discovered.tools.map((tool) => {
        const override = Object.hasOwn(overrides, tool.toolName)
          ? overrides[tool.toolName]
          : undefined;
        if (override === undefined) return tool;
        if (override.source !== 'admin_override')
          throw new Error('MCP_RUNTIME_ADMIN_OVERRIDE_SOURCE_INVALID');
        return withMcpToolAdminExecutionSemanticsOverride(tool, override);
      });
      const effective = deriveFrozenMcpCatalogAuthority(
        discovered.snapshot,
        effectiveTools,
        input.bindingRevision,
      );
      // Applying exactly the Runtime's override-retention rule to fresh discovery avoids a
      // raw-Catalog revision followed by a second governance-only revision after reconciliation.
      if (
        runtimeAuthority.discoveredCatalogChecksum === catalogAuthority.catalogChecksum &&
        (runtimeAuthority.operationCount !== catalogAuthority.operationCount ||
          runtimeAuthority.catalogChecksum !== effective.catalogChecksum)
      )
        throw new Error('MCP_RUNTIME_CATALOG_AUTHORITY_MISMATCH');
      return Object.freeze({ ...discovery, catalogChecksum: effective.catalogChecksum });
    }
    // Compatibility for older readers: never substitute stale authority for real remote drift.
    if (runtimeAuthority.discoveredCatalogChecksum !== catalogAuthority.catalogChecksum)
      return discovery;
    if (runtimeAuthority.operationCount !== catalogAuthority.operationCount)
      throw new Error('MCP_RUNTIME_CATALOG_AUTHORITY_MISMATCH');
    return Object.freeze({ ...discovery, catalogChecksum: runtimeAuthority.catalogChecksum });
  }
}

function resolveCredentialHeaders(reference: string): Readonly<Record<string, string>> {
  const normalized = validateMcpCredentialRef(reference);
  if (normalized === MCP_UNAUTHENTICATED_CREDENTIAL_REF) return Object.freeze({});
  const variable = /^secret:\/\/env\/([A-Z][A-Z0-9_]*)$/u.exec(normalized)?.[1];
  const value = variable === undefined ? undefined : process.env[variable];
  if (value === undefined || value === '')
    throw Object.assign(new Error('MCP credential SecretRef is unavailable.'), {
      code: 'SECRET_REFERENCE_UNAVAILABLE',
    });
  return Object.freeze({ authorization: `Bearer ${value}` });
}

function allowedEndpoint(
  value: string,
  allowed: ReadonlySet<string>,
  allowedPrivateHttp: ReadonlySet<string>,
  unsafeTestOpen: boolean,
): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return denied();
  }
  const authority = endpoint.host.toLowerCase();
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (unsafeTestOpen) {
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username !== '' ||
      endpoint.password !== ''
    )
      return denied();
    endpoint.hash = '';
    return endpoint.toString();
  }
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    (hostname.startsWith('127.') && isIpv4(hostname));
  const privateHttp =
    endpoint.protocol === 'http:' &&
    endpoint.port !== '' &&
    isPrivateIpv4(hostname) &&
    allowedPrivateHttp.has(authority);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    (!allowed.has(authority) && !allowed.has(endpoint.hostname.toLowerCase())) ||
    (endpoint.protocol !== 'https:' &&
      !(endpoint.protocol === 'http:' && (loopback || privateHttp)))
  )
    return denied();
  endpoint.hash = '';
  return endpoint.toString();
}

function isPrivateIpv4(value: string): boolean {
  const parts = ipv4Parts(value);
  if (parts === undefined) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isIpv4(value: string): boolean {
  return ipv4Parts(value) !== undefined;
}

function ipv4Parts(value: string): readonly number[] | undefined {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined;
  return parts;
}

function denied(): never {
  throw Object.assign(new Error('MCP endpoint is outside the configured SSRF allowlist.'), {
    code: 'MCP_ENDPOINT_NOT_ALLOWED',
  });
}

function requestUrl(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}
