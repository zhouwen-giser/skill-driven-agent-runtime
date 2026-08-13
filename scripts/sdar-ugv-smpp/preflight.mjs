import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { TextDecoder } from 'node:util';

import { z } from 'zod';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const NATIVE_REVISION = /^[1-9][0-9]*$/u;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,62}$/u;
const CATALOG_REVISION = /^[1-9][0-9]*$/u;
const SECRET_ENVIRONMENT_REFERENCE = /^secret:\/\/env\/([A-Z][A-Z0-9_]*)$/u;
const UNAUTHENTICATED_CREDENTIAL_REF = 'unauthenticated://none';
const SENSITIVE_QUERY_KEY =
  /(?:authorization|auth|token|secret|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key)/iu;
const PROJECTION_CONTRACT = 'sdar-registry-v1';
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_RUNTIME_MCP_PATH = '/mcp';
const DEFAULT_RUNTIME_HEALTH_PATH = '/health/ready';

const ProviderSchema = z
  .object({
    externalProviderId: z.string().trim().min(1).max(256),
    externalServerId: z.string().trim().min(1).max(256),
    serverEndpoint: z
      .string()
      .regex(/^https?:\/\//u)
      .refine(isCredentialFreeHttpUrl),
    catalogRevision: z.string().regex(CATALOG_REVISION),
    labels: z
      .object({
        environment: z.string().regex(ENVIRONMENT),
        protocolMode: z.literal('frozen_v1'),
      })
      .strict(),
  })
  .strict();

const SnapshotSchema = z
  .object({
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    checksum: z.string().regex(CHECKSUM),
    generatedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    providers: z.array(ProviderSchema).max(100_000),
  })
  .strict();

export class UgvSmppPreflightError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'UgvSmppPreflightError';
    this.code = code;
  }
}

/**
 * Performs only read-only external checks. The returned report deliberately contains no
 * environment values, endpoints, candidate identities, credential paths, or secret material.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @param {{ fetch?: typeof globalThis.fetch, now?: () => number }} dependencies
 */
export async function runUgvSmppPreflight(environment = process.env, dependencies = {}) {
  const configuration = await configurationFromEnvironment(environment);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now?.() ?? Date.now();
  const registry = await verifyRegistryProjection(configuration, fetchImplementation, now);

  return Object.freeze({
    status: 'guard_checks_passed',
    evidenceClass: 'real',
    overallPreflightAuthority: 'pending_driver_checks',
    outboundPolicy: Object.freeze({
      mode: configuration.outboundPolicy.unsafeTestOpen ? 'unsafe_test_open' : 'safe',
      productionEligible: !configuration.outboundPolicy.unsafeTestOpen,
    }),
    checks: Object.freeze([
      'required_configuration',
      'secret_loading',
      'closed_write_gates',
      configuration.outboundPolicy.unsafeTestOpen
        ? 'explicit_non_production_unsafe_outbound_policy'
        : 'exact_endpoint_allowlists',
      'full_registry_projection_url',
      'registry_http_200',
      'registry_projection_contract',
      'registry_native_lineage',
      'registry_checksum',
      'registry_conditional_304',
      'exact_candidate_tuple',
      'registry_runtime_endpoint_alignment',
      'runtime_endpoint_authority',
      'runtime_health_http_200',
      ...(configuration.model.enabled ? ['real_model_configuration'] : []),
    ]),
    registry: Object.freeze({
      initialSnapshotAccepted: true,
      conditionalRevalidationAccepted: registry.notModified,
      exactCandidateSelected: true,
      authenticationMode: configuration.registryCredential.mode,
    }),
    runtime: Object.freeze({
      registryEndpointAligned: true,
      healthReachable: registry.runtimeHealthReachable,
      directMcpCallPerformed: false,
      authenticationMode: configuration.runtimeCredential.mode,
    }),
    realModel: Object.freeze({
      enabled: configuration.model.enabled,
      connectivityAuthority: configuration.model.enabled
        ? 'pending_driver_connectivity'
        : 'not_enabled',
    }),
    writeGates: 'closed',
    requiredDriverChecks: Object.freeze([
      'sdar_postgres_reachable',
      'sdar_redis_reachable',
      'node_control_reachable',
      'runtime_catalog_reachable_through_existing_adapter',
      ...(configuration.model.enabled ? ['real_model_structured_output_conformance'] : []),
    ]),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      candidateIdentitiesIncluded: false,
      secretFilePathsIncluded: false,
    }),
  });
}

/** @param {NodeJS.ProcessEnv} environment */
async function configurationFromEnvironment(environment) {
  assertClosedWriteGates(environment);

  const outboundPolicy = outboundPolicyFromEnvironment(environment);

  const smppSourceId = requiredText(environment, 'SMPP_SDAR_SOURCE_ID', 256);
  const smppEnvironment = requiredText(environment, 'SMPP_ENVIRONMENT', 63);
  if (!ENVIRONMENT.test(smppEnvironment)) fail('SMPP_ENVIRONMENT_INVALID');
  const externalProviderId = requiredText(environment, 'SMPP_UGV_EXTERNAL_PROVIDER_ID', 256);
  const externalServerId = requiredText(environment, 'SMPP_UGV_EXTERNAL_SERVER_ID', 256);

  const providerAllowlist = outboundPolicy.unsafeTestOpen
    ? []
    : exactAuthorityAllowlist(environment, 'SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST');
  const mcpAllowlist = outboundPolicy.unsafeTestOpen
    ? []
    : exactAuthorityAllowlist(environment, 'SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST');

  const registryEndpoint = requiredHttpUrl(environment, 'SMPP_SDAR_REGISTRY_ENDPOINT');
  assertRegistryProjectionUrl(registryEndpoint, smppEnvironment, smppSourceId);
  assertEndpointAllowed(
    registryEndpoint,
    providerAllowlist,
    'REGISTRY_ENDPOINT_NOT_ALLOWED',
    outboundPolicy,
  );

  const runtimeBaseUrl = requiredHttpUrl(environment, 'SMPP_UGV_RUNTIME_BASE_URL');
  if (runtimeBaseUrl.pathname !== '/' || runtimeBaseUrl.search !== '' || runtimeBaseUrl.hash !== '')
    fail('RUNTIME_BASE_URL_INVALID');
  const runtimeMcpPath = runtimePath(
    environment,
    'SMPP_UGV_RUNTIME_MCP_PATH',
    DEFAULT_RUNTIME_MCP_PATH,
  );
  const runtimeHealthPath = runtimePath(
    environment,
    'SMPP_UGV_RUNTIME_HEALTH_PATH',
    DEFAULT_RUNTIME_HEALTH_PATH,
  );
  if (runtimeMcpPath === runtimeHealthPath) fail('RUNTIME_PATHS_NOT_SEPARATE');
  const expectedRuntimeMcpEndpoint = new URL(runtimeMcpPath, runtimeBaseUrl);
  const runtimeHealthEndpoint = new URL(runtimeHealthPath, runtimeBaseUrl);
  assertEndpointAllowed(
    expectedRuntimeMcpEndpoint,
    mcpAllowlist,
    'RUNTIME_ENDPOINT_NOT_ALLOWED',
    outboundPolicy,
  );
  if (!outboundPolicy.unsafeTestOpen)
    assertExactAllowlistScope(
      mcpAllowlist,
      [expectedRuntimeMcpEndpoint.host],
      'MCP_ENDPOINT_ALLOWLIST_SCOPE_INVALID',
    );

  const registryCredential = await externalCredentialFromEnvironment(
    environment,
    'SMPP_REGISTRY_CREDENTIAL_REF',
    'SMPP_REGISTRY_TOKEN',
    'REGISTRY_CREDENTIAL_REF_INVALID',
  );
  const runtimeCredential = await externalCredentialFromEnvironment(
    environment,
    'SMPP_UGV_RUNTIME_CREDENTIAL_REF',
    'SMPP_UGV_RUNTIME_TOKEN',
    'RUNTIME_CREDENTIAL_REF_INVALID',
  );

  const model = await modelConfiguration(environment, providerAllowlist, outboundPolicy);
  if (!outboundPolicy.unsafeTestOpen)
    assertExactAllowlistScope(
      providerAllowlist,
      [registryEndpoint.host, ...(model.enabled ? [model.baseUrl.host] : [])],
      'PROVIDER_ENDPOINT_ALLOWLIST_SCOPE_INVALID',
    );

  const timeoutMs = optionalPositiveInteger(
    environment,
    'SDAR_UGV_PREFLIGHT_TIMEOUT_MS',
    15_000,
    1_000,
    60_000,
  );

  return Object.freeze({
    smppSourceId,
    smppEnvironment,
    externalProviderId,
    externalServerId,
    registryEndpoint: registryEndpoint.toString(),
    registryCredential,
    runtimeCredential,
    expectedRuntimeMcpEndpoint: expectedRuntimeMcpEndpoint.toString(),
    runtimeHealthEndpoint: runtimeHealthEndpoint.toString(),
    outboundPolicy,
    model,
    timeoutMs,
  });
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {readonly string[]} providerAllowlist
 * @param {{ unsafeTestOpen: boolean }} outboundPolicy
 */
async function modelConfiguration(environment, providerAllowlist, outboundPolicy) {
  const enabled = yesNo(environment, 'SDAR_UGV_REAL_MODEL_ENABLED', false);
  if (!enabled) {
    for (const name of [
      'SDAR_UGV_MODEL_PROVIDER_ID',
      'SDAR_UGV_MODEL_BASE_URL',
      'SDAR_UGV_MODEL_NAME',
      'SDAR_UGV_MODEL_API_STYLE',
      'SDAR_UGV_MODEL_API_KEY',
      'SDAR_UGV_MODEL_API_KEY_FILE',
    ]) {
      if ((environment[name]?.trim() ?? '') !== '') fail('MODEL_CONFIGURATION_DISABLED');
    }
    return Object.freeze({ enabled: false });
  }

  const providerId = requiredText(environment, 'SDAR_UGV_MODEL_PROVIDER_ID', 256);
  const name = requiredText(environment, 'SDAR_UGV_MODEL_NAME', 256);
  const apiStyle = requiredText(environment, 'SDAR_UGV_MODEL_API_STYLE', 64);
  if (!['openai_chat_completions', 'anthropic_messages'].includes(apiStyle))
    fail('MODEL_API_STYLE_UNSUPPORTED');
  const baseUrl = requiredHttpUrl(environment, 'SDAR_UGV_MODEL_BASE_URL');
  assertEndpointAllowed(baseUrl, providerAllowlist, 'MODEL_ENDPOINT_NOT_ALLOWED', outboundPolicy);
  await secretFromEnvironment(environment, 'SDAR_UGV_MODEL_API_KEY');
  return Object.freeze({ enabled: true, providerId, name, apiStyle, baseUrl });
}

/**
 * @param {Awaited<ReturnType<typeof configurationFromEnvironment>>} configuration
 * @param {typeof globalThis.fetch} fetchImplementation
 * @param {number} now
 */
async function verifyRegistryProjection(configuration, fetchImplementation, now) {
  const initial = await fetchRegistry(
    fetchImplementation,
    configuration.registryEndpoint,
    configuration.registryCredential,
    configuration.timeoutMs,
  );
  if (initial.status !== 200) fail('REGISTRY_HTTP_200_REQUIRED');
  if (!isJsonContentType(initial.headers.get('content-type')))
    fail('REGISTRY_CONTENT_TYPE_INVALID');

  const payload = SnapshotSchema.safeParse(await responseJson(initial, 'REGISTRY'));
  if (!payload.success) fail('REGISTRY_PROJECTION_SCHEMA_INVALID');
  const snapshot = payload.data;
  if (Date.parse(snapshot.generatedAt) >= Date.parse(snapshot.expiresAt))
    fail('REGISTRY_PROJECTION_TIME_RANGE_INVALID');
  if (Date.parse(snapshot.expiresAt) <= now) fail('REGISTRY_PROJECTION_EXPIRED');
  if (projectionChecksum(configuration.smppSourceId, snapshot) !== snapshot.checksum)
    fail('REGISTRY_PROJECTION_CHECKSUM_MISMATCH');

  const etag = initial.headers.get('etag');
  if (etag !== `"${snapshot.checksum}"`) fail('REGISTRY_ETAG_INVALID');
  const lineage = responseLineage(initial, snapshot.revision);

  const identities = snapshot.providers.map(
    (provider) => `${provider.externalProviderId}\u0000${provider.externalServerId}`,
  );
  if (new Set(identities).size !== identities.length) fail('REGISTRY_CANDIDATE_IDENTITY_DUPLICATE');
  const selected = snapshot.providers.filter(
    (provider) =>
      provider.externalProviderId === configuration.externalProviderId &&
      provider.externalServerId === configuration.externalServerId,
  );
  if (selected.length !== 1) fail('REGISTRY_EXACT_CANDIDATE_REQUIRED');
  const candidate = selected[0];
  if (candidate === undefined) fail('REGISTRY_EXACT_CANDIDATE_REQUIRED');
  if (candidate.labels.environment !== configuration.smppEnvironment)
    fail('REGISTRY_CANDIDATE_ENVIRONMENT_MISMATCH');
  const runtimeEndpoint = validatedHttpUrl(candidate.serverEndpoint, 'RUNTIME_ENDPOINT_INVALID');
  if (runtimeEndpoint.toString() !== configuration.expectedRuntimeMcpEndpoint)
    fail('RUNTIME_ENDPOINT_PROJECTION_MISMATCH');

  const conditional = await fetchRegistry(
    fetchImplementation,
    configuration.registryEndpoint,
    configuration.registryCredential,
    configuration.timeoutMs,
    etag,
  );
  if (conditional.status !== 304) fail('REGISTRY_CONDITIONAL_304_REQUIRED');
  if (conditional.headers.get('etag') !== etag) fail('REGISTRY_304_ETAG_INVALID');
  const conditionalLineage = responseLineage(conditional, snapshot.revision);
  if (
    conditionalLineage.nativeRevision !== lineage.nativeRevision ||
    conditionalLineage.nativeChecksum !== lineage.nativeChecksum
  )
    fail('REGISTRY_304_LINEAGE_MISMATCH');

  await verifyRuntimeHealth(
    fetchImplementation,
    configuration.runtimeHealthEndpoint,
    configuration.timeoutMs,
  );

  return Object.freeze({ notModified: true, runtimeHealthReachable: true });
}

/**
 * This is a read-only readiness request, not an MCP request. Catalog discovery is deliberately
 * reserved for the existing SDAR MCP adapter and materialization driver.
 *
 * @param {typeof globalThis.fetch} fetchImplementation
 * @param {string} endpoint
 * @param {number} timeoutMs
 */
async function verifyRuntimeHealth(fetchImplementation, endpoint, timeoutMs) {
  let response;
  try {
    response = await fetchImplementation(endpoint, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return fail('RUNTIME_HEALTH_UNREACHABLE');
  }
  if (response.status !== 200) fail('RUNTIME_HEALTH_HTTP_200_REQUIRED');
  if (!isJsonContentType(response.headers.get('content-type')))
    fail('RUNTIME_HEALTH_CONTENT_TYPE_INVALID');
  const payload = await responseJson(response, 'RUNTIME_HEALTH');
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    fail('RUNTIME_HEALTH_PAYLOAD_INVALID');
}

/**
 * @param {typeof globalThis.fetch} fetchImplementation
 * @param {string} endpoint
 * @param {{ mode: 'none' } | { mode: 'bearer', token: string }} credential
 * @param {number} timeoutMs
 * @param {string | undefined} etag
 */
async function fetchRegistry(fetchImplementation, endpoint, credential, timeoutMs, etag) {
  try {
    return await fetchImplementation(endpoint, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(credential.mode === 'bearer' ? { authorization: `Bearer ${credential.token}` } : {}),
        ...(etag === undefined ? {} : { 'if-none-match': etag }),
      },
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return fail('REGISTRY_UNREACHABLE');
  }
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} referenceName
 * @param {string} legacySecretName
 * @param {string} invalidCode
 */
async function externalCredentialFromEnvironment(
  environment,
  referenceName,
  legacySecretName,
  invalidCode,
) {
  const credentialRef = requiredText(environment, referenceName, 512);
  if (credentialRef === UNAUTHENTICATED_CREDENTIAL_REF) {
    if (
      (environment[legacySecretName]?.trim() ?? '') !== '' ||
      (environment[`${legacySecretName}_FILE`]?.trim() ?? '') !== ''
    )
      fail('UNAUTHENTICATED_CREDENTIAL_CONFLICT');
    return Object.freeze({ mode: 'none' });
  }
  const secretName = SECRET_ENVIRONMENT_REFERENCE.exec(credentialRef)?.[1];
  if (secretName === undefined) fail(invalidCode);
  return Object.freeze({
    mode: 'bearer',
    token: await secretFromEnvironment(environment, secretName),
  });
}

/** @param {Response} response @param {number} expectedRevision */
function responseLineage(response, expectedRevision) {
  const revisionText = response.headers.get('x-smpp-native-revision');
  const nativeChecksum = response.headers.get('x-smpp-native-checksum');
  const projectionContract = response.headers.get('x-smpp-projection-contract');
  if (
    revisionText === null ||
    !NATIVE_REVISION.test(revisionText) ||
    nativeChecksum === null ||
    !CHECKSUM.test(nativeChecksum) ||
    projectionContract !== PROJECTION_CONTRACT
  )
    fail('REGISTRY_NATIVE_LINEAGE_INVALID');
  const nativeRevision = Number(revisionText);
  if (!Number.isSafeInteger(nativeRevision) || nativeRevision !== expectedRevision)
    fail('REGISTRY_NATIVE_REVISION_MISMATCH');
  return Object.freeze({ nativeRevision, nativeChecksum });
}

/** @param {Response} response @param {'REGISTRY' | 'RUNTIME_HEALTH'} errorPrefix */
async function responseJson(response, errorPrefix) {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
  )
    fail(`${errorPrefix}_RESPONSE_TOO_LARGE`);
  const body = response.body;
  if (body === null) fail(`${errorPrefix}_RESPONSE_BODY_MISSING`);
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      fail(`${errorPrefix}_RESPONSE_TOO_LARGE`);
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail(`${errorPrefix}_RESPONSE_JSON_INVALID`);
  }
}

/**
 * @param {string} smppSourceId
 * @param {z.infer<typeof SnapshotSchema>} snapshot
 */
function projectionChecksum(smppSourceId, snapshot) {
  const candidates = snapshot.providers
    .map((provider) => ({
      externalProviderId: provider.externalProviderId,
      externalServerId: provider.externalServerId,
      serverEndpoint: normalizedProviderEndpoint(provider.serverEndpoint),
      catalogRevision: provider.catalogRevision,
      labels: provider.labels,
    }))
    .sort((left, right) =>
      `${smppSourceId}::${left.externalProviderId}::${left.externalServerId}`.localeCompare(
        `${smppSourceId}::${right.externalProviderId}::${right.externalServerId}`,
      ),
    );
  return createHash('sha256')
    .update(
      canonicalJson({
        smppSourceId,
        revision: snapshot.revision,
        generatedAt: snapshot.generatedAt,
        expiresAt: snapshot.expiresAt,
        candidates,
      }),
    )
    .digest('hex');
}

/** @param {unknown} value */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

/** @param {string} value */
function normalizedProviderEndpoint(value) {
  const endpoint = validatedHttpUrl(value, 'RUNTIME_ENDPOINT_INVALID');
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/u, '');
}

/** @param {NodeJS.ProcessEnv} environment */
function assertClosedWriteGates(environment) {
  for (const name of [
    'ALLOW_REAL_UGV_SIDE_EFFECTS',
    'ALLOW_UGV_COORDINATE_NAVIGATION',
    'ALLOW_REAL_UGV_RECON',
  ]) {
    const value = environment[name]?.trim();
    if (value !== undefined && value !== '' && value !== 'NO') fail('WRITE_GATE_NOT_CLOSED');
  }
  if (Object.hasOwn(environment, 'ALLOW_REAL_UGV_FIRE')) fail('FIRE_GATE_FORBIDDEN');
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name */
async function secretFromEnvironment(environment, name) {
  const inline = environment[name]?.trim() ?? '';
  const file = environment[`${name}_FILE`]?.trim() ?? '';
  if ((inline === '') === (file === '')) fail('SECRET_SOURCE_INVALID');
  if (inline !== '') return inline;
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 65_536) fail('SECRET_FILE_INVALID');
    const value = (await readFile(file, 'utf8')).trim();
    if (value === '') fail('SECRET_FILE_INVALID');
    return value;
  } catch (error) {
    if (error instanceof UgvSmppPreflightError) throw error;
    return fail('SECRET_FILE_INVALID');
  }
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name */
function exactAuthorityAllowlist(environment, name) {
  const raw = requiredText(environment, name, 16_384);
  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry === '')) fail('ENDPOINT_ALLOWLIST_INVALID');
  const normalized = entries.map(normalizedAuthority);
  if (new Set(normalized).size !== normalized.length) fail('ENDPOINT_ALLOWLIST_INVALID');
  return Object.freeze(normalized);
}

/** @param {string} value */
function normalizedAuthority(value) {
  if (value.includes('/') || /[*?#@\s]/u.test(value)) fail('ENDPOINT_ALLOWLIST_NOT_EXACT');
  let endpoint;
  try {
    endpoint = new URL(`https://${value}`);
  } catch {
    return fail('ENDPOINT_ALLOWLIST_INVALID');
  }
  if (
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.pathname !== '/' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    endpoint.host === ''
  )
    fail('ENDPOINT_ALLOWLIST_NOT_EXACT');
  return endpoint.host.toLowerCase();
}

/**
 * @param {URL} endpoint
 * @param {readonly string[]} allowlist
 * @param {string} code
 * @param {{ unsafeTestOpen: boolean }} [policy]
 */
export function assertUgvPreflightEndpointAllowed(endpoint, allowlist, code, policy) {
  if (policy?.unsafeTestOpen === true) {
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username !== '' ||
      endpoint.password !== ''
    )
      fail(code);
    return;
  }
  const authority = endpoint.host.toLowerCase();
  if (!allowlist.includes(authority)) fail(code);
  const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLoopback(hostname)))
    fail('ENDPOINT_TLS_POLICY_INVALID');
}

const assertEndpointAllowed = assertUgvPreflightEndpointAllowed;

/** @param {NodeJS.ProcessEnv} environment */
function outboundPolicyFromEnvironment(environment) {
  const mode = environment.SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY?.trim() || 'safe';
  if (mode === 'safe') return Object.freeze({ unsafeTestOpen: false });
  if (mode !== 'unsafe_test_open') fail('OUTBOUND_ENDPOINT_POLICY_INVALID');
  const nodeEnvironment = environment.NODE_ENV?.trim();
  const controlEnvironment = environment.SDAR_CONTROL_ENVIRONMENT?.trim();
  if (
    !['development', 'test'].includes(nodeEnvironment ?? '') ||
    !['development', 'test', 'integration'].includes(controlEnvironment ?? '')
  )
    fail('UNSAFE_OUTBOUND_POLICY_FORBIDDEN');
  return Object.freeze({ unsafeTestOpen: true });
}

/**
 * @param {readonly string[]} actual
 * @param {readonly string[]} expected
 * @param {string} code
 */
function assertExactAllowlistScope(actual, expected, code) {
  const expectedAuthorities = [...new Set(expected.map((entry) => entry.toLowerCase()))].sort();
  const actualAuthorities = [...actual].sort();
  if (
    actualAuthorities.length !== expectedAuthorities.length ||
    actualAuthorities.some((entry, index) => entry !== expectedAuthorities[index])
  )
    fail(code);
}

/** @param {URL} endpoint @param {string} environment @param {string} sourceId */
function assertRegistryProjectionUrl(endpoint, environment, sourceId) {
  const expectedPath = `/api/v1/registry/${encodeURIComponent(
    environment,
  )}/consumers/sdar/v1/sources/${encodeURIComponent(sourceId)}/latest`;
  if (endpoint.pathname !== expectedPath || endpoint.search !== '' || endpoint.hash !== '')
    fail('REGISTRY_PROJECTION_URL_INVALID');
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} name
 * @param {string} fallback
 */
function runtimePath(environment, name, fallback) {
  const value = environment[name]?.trim() || fallback;
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    containsControlCharacter(value)
  )
    fail('RUNTIME_PATH_INVALID');
  const parsed = new URL(value, 'https://runtime-path.invalid');
  if (parsed.origin !== 'https://runtime-path.invalid' || parsed.pathname !== value)
    fail('RUNTIME_PATH_INVALID');
  return value;
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name */
function requiredHttpUrl(environment, name) {
  return validatedHttpUrl(requiredText(environment, name, 4_096), `${name}_INVALID`);
}

/** @param {string} value @param {string} code */
function validatedHttpUrl(value, code) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    return fail(code);
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    [...endpoint.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))
  )
    fail(code);
  return endpoint;
}

/** @param {string} value */
function isCredentialFreeHttpUrl(value) {
  try {
    const endpoint = new URL(value);
    return (
      ['http:', 'https:'].includes(endpoint.protocol) &&
      endpoint.username === '' &&
      endpoint.password === '' &&
      [...endpoint.searchParams.keys()].every((key) => !SENSITIVE_QUERY_KEY.test(key))
    );
  } catch {
    return false;
  }
}

/** @param {string} hostname */
function isLoopback(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.'))
  );
}

/** @param {string | null} value */
function isJsonContentType(value) {
  return value !== null && /^application\/json(?:\s*;|$)/iu.test(value);
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} name
 * @param {number} maximum
 */
function requiredText(environment, name, maximum) {
  const value = environment[name]?.trim();
  if (
    value === undefined ||
    value === '' ||
    value.length > maximum ||
    containsControlCharacter(value)
  )
    fail('REQUIRED_CONFIGURATION_INVALID');
  return value;
}

/** @param {string} value */
function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} name
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 */
function optionalPositiveInteger(environment, name, fallback, minimum, maximum) {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw)) fail('PREFLIGHT_TIMEOUT_INVALID');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail('PREFLIGHT_TIMEOUT_INVALID');
  return value;
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name @param {boolean} fallback */
function yesNo(environment, name, fallback) {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'YES') return true;
  if (raw === 'NO') return false;
  return fail('YES_NO_CONFIGURATION_INVALID');
}

/** @param {string} code */
function fail(code) {
  throw new UgvSmppPreflightError(code);
}

async function main() {
  try {
    const report = await runUgvSmppPreflight(process.env);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code = error instanceof UgvSmppPreflightError ? error.code : 'UGV_SMPP_PREFLIGHT_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
