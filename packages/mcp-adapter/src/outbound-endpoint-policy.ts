import { isIP } from 'node:net';

export interface McpOutboundEndpointPolicy {
  readonly allowedAuthorities?: readonly string[] | undefined;
  readonly unsafeTestOpen?: boolean | undefined;
}

export type McpOutboundFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Applies the deployment-owned endpoint decision at the final MCP transport boundary.
 * Redirects are always manual so a credential-bearing request cannot cross the admitted authority.
 */
export function createMcpOutboundFetch(
  policy: McpOutboundEndpointPolicy,
  fetchImplementation: McpOutboundFetch = globalThis.fetch,
): McpOutboundFetch {
  return (input, init) => {
    assertMcpOutboundEndpoint(input instanceof Request ? input.url : input.toString(), policy);
    return fetchImplementation(input, { ...init, redirect: 'manual' });
  };
}

export function assertMcpOutboundEndpoint(
  value: string | URL,
  policy: McpOutboundEndpointPolicy,
): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw endpointNotAllowed();
  }
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const authority = endpoint.host.toLowerCase();
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  )
    throw endpointNotAllowed();
  if (policy.unsafeTestOpen === true) return endpoint;
  const allowed = policy.allowedAuthorities ?? ['127.0.0.1', 'localhost'];
  const authorityAllowed = allowed.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    return (
      normalized === hostname ||
      normalized === authority ||
      (isIP(hostname) === 4 && ipv4CidrContains(normalized, hostname))
    );
  });
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.'));
  if (!authorityAllowed || (endpoint.protocol !== 'https:' && !loopback))
    throw endpointNotAllowed();
  return endpoint;
}

function ipv4CidrContains(cidr: string, address: string): boolean {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d|[12]\d|3[0-2])$/u.exec(cidr);
  if (match === null) return false;
  const base = ipv4Number(match[1] ?? '');
  const candidate = ipv4Number(address);
  if (base === undefined || candidate === undefined) return false;
  const bits = Number(match[2]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (base & mask) === (candidate & mask);
}

function ipv4Number(value: string): number | undefined {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined;
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

function endpointNotAllowed(): Error & { code: 'MCP_ENDPOINT_NOT_ALLOWED' } {
  return Object.assign(new Error('MCP endpoint violates the configured SSRF/TLS policy.'), {
    code: 'MCP_ENDPOINT_NOT_ALLOWED' as const,
  });
}
