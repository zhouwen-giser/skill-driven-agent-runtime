import { isIP } from 'node:net';

export interface OutboundEndpointPolicy {
  readonly allowedAuthorities?: readonly string[] | undefined;
  /** Explicitly unsafe escape hatch accepted only by the deployment parser for non-production. */
  readonly unsafeTestOpen?: boolean | undefined;
  /**
   * Exact `host:port` authorities that may use plaintext HTTP on an RFC1918 network.
   * This is a deployment acknowledgement, not a replacement for the ordinary SSRF allowlist.
   */
  readonly privateHttpAuthorities?: readonly string[] | undefined;
}

export function assertOutboundEndpoint(value: string, policy: OutboundEndpointPolicy = {}): void {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return denied();
  }
  const hostname = normalizedHostname(endpoint.hostname);
  const authority = endpoint.host.toLowerCase();
  if (policy.unsafeTestOpen === true) {
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username !== '' ||
      endpoint.password !== ''
    )
      return denied();
    return;
  }
  const allowed = policy.allowedAuthorities ?? ['127.0.0.1', 'localhost'];
  const authorityAllowed = allowed.some((entry) =>
    allowlistEntryMatches(entry, hostname, authority),
  );
  const loopback = isLoopback(hostname);
  const acknowledgedPrivateHttp =
    endpoint.protocol === 'http:' &&
    endpoint.port !== '' &&
    isPrivateIpv4(hostname) &&
    (policy.privateHttpAuthorities ?? []).some(
      (entry) => normalizedExactAuthority(entry) === authority,
    );
  if (
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    !authorityAllowed ||
    (endpoint.protocol !== 'https:' &&
      !(endpoint.protocol === 'http:' && (loopback || acknowledgedPrivateHttp)))
  )
    return denied();
}

export function assertPrivateHttpDeploymentAcknowledgement(
  input: Readonly<{
    acknowledgement: 'NO' | 'YES';
    authorities: string | undefined;
    providerAuthorities: string;
    mcpAuthorities: string;
  }>,
): void {
  const entries = split(input.authorities ?? '');
  if (entries.length === 0) {
    if (input.acknowledgement !== 'NO')
      throw new Error('Private HTTP acknowledgement requires an exact authority allowlist.');
    return;
  }
  if (input.acknowledgement !== 'YES')
    throw new Error('Private HTTP authorities require explicit deployment acknowledgement.');
  const ordinary = new Set([...split(input.providerAuthorities), ...split(input.mcpAuthorities)]);
  for (const entry of entries) {
    const authority = normalizedExactAuthority(entry);
    if (authority === undefined || !ordinary.has(authority))
      throw new Error(
        'Private HTTP authorities must be exact RFC1918 host:port entries in an outbound allowlist.',
      );
  }
  if (new Set(entries.map(normalizedExactAuthority)).size !== entries.length)
    throw new Error('Private HTTP authorities must be unique.');
}

function allowlistEntryMatches(entry: string, hostname: string, authority: string): boolean {
  const normalized = entry.trim().toLowerCase();
  return (
    normalized === hostname ||
    normalized === authority ||
    (isIP(hostname) === 4 && ipv4CidrContains(normalized, hostname))
  );
}

function normalizedExactAuthority(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized.includes('/') || /[*?#@\s]/u.test(normalized))
    return undefined;
  let endpoint: URL;
  try {
    endpoint = new URL(`http://${normalized}`);
  } catch {
    return undefined;
  }
  const hostname = normalizedHostname(endpoint.hostname);
  if (
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.pathname !== '/' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    endpoint.port === '' ||
    !isPrivateIpv4(hostname)
  )
    return undefined;
  return endpoint.host.toLowerCase();
}

function split(value: string): readonly string[] {
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/gu, '');
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.'))
  );
}

function isPrivateIpv4(hostname: string): boolean {
  const value = ipv4Number(hostname);
  if (value === undefined) return false;
  return (
    ipv4CidrContains('10.0.0.0/8', hostname) ||
    ipv4CidrContains('172.16.0.0/12', hostname) ||
    ipv4CidrContains('192.168.0.0/16', hostname)
  );
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

function denied(): never {
  throw Object.assign(
    new Error('Outbound endpoint violates the configured allowlist/TLS policy.'),
    {
      code: 'ENDPOINT_NOT_ALLOWED',
      status: 422,
    },
  );
}
