#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { parseEnv } from 'node:util';
import { fileURLToPath, URL } from 'node:url';

import { readValidatedFirstPassIndex } from './evidence-files.mjs';
import { initializeState } from './initialize-state.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SMPP_ROOT = resolve(REPOSITORY_ROOT, '../sdar-mcp-provider-platform');
const REPORT_ROOT = resolve(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation');
const STATE_ROOT = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}`;
const SMPP_HEAD = 'b5f3ba2076468695c781bea1e5e6d3045e60f70e';
const SMPP_REMOTE_BRANCH = 'codex/goal-ugv-runtime-telemetry-joint-integration';
const EXTERNAL_DEVICE_ENDPOINT = 'http://192.168.2.63:19000/mcp';
const EXTERNAL_MQTT_ENDPOINT = 'mqtt://192.168.2.63:1883';
const SENSITIVE_KEY =
  /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|MASTER|DATABASE_URL|\bDSN\b|AUTHORIZATION|PRIVATE|CERT)/iu;
const TASK_SENSITIVE_KEYS = Object.freeze([
  'SDAR_CONTROL_API_TOKEN',
  'SDAR_CONTROL_API_TOKEN_FILE',
  'SDAR_CONTROL_OPERATOR_API_TOKEN',
  'SDAR_CONTROL_VIEWER_API_TOKEN',
  'SDAR_CONTROL_SECURITY_API_TOKEN',
  'SDAR_CONTROL_ORGANIZATION_API_TOKEN',
  'SDAR_CONTROL_RUNTIME_SERVICE_TOKEN',
  'SDAR_RUNTIME_CONTROL_SERVICE_TOKEN',
  'SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN',
  'SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN',
  'SDAR_GOVERNED_CONTROL_BEARER_TOKEN',
  'SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN',
  'PMS_RUNTIME_REGISTRATION_TOKEN',
  'PMS_DATABASE_URL',
  'SDAR_POSTGRES_URL',
  'SDAR_CONTROL_DATABASE_URL',
  'SDAR_CONTROL_RUNTIME_DATABASE_URL',
]);
const TASK_CREDENTIAL_FILES = Object.freeze([
  'control-api.token',
  'control-operator-api.token',
  'control-viewer-api.token',
  'control-security-api.token',
  'control-organization-api.token',
  'runtime-control-service.token',
  'cognitive-management.token',
  'governed-control.token',
  'artifact-management.token',
  'pms/runtime-registration.token',
  'pms/pms-database-url',
]);
const PUBLIC_LLM_CONFIGURATION_KEYS = Object.freeze([
  'SDAR_UGV_MODEL_PROVIDER_ID',
  'SDAR_UGV_MODEL_BASE_URL',
  'SDAR_UGV_MODEL_NAME',
  'SDAR_UGV_MODEL_EMBEDDING_NAME',
  'SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID',
  'SDAR_UGV_MODEL_EMBEDDING_BASE_URL',
]);

const SMPP_SERVICES = Object.freeze([
  'ugv-agent-profile-adapter',
  'ugv-agent-profile-adapter-postgres',
  'ugv-agent-profile-pms-api',
  'ugv-agent-profile-pms-postgres',
  'ugv-agent-profile-pms-worker',
  'ugv-agent-profile-runtime',
  'ugv-agent-profile-runtime-postgres',
]);
const SDAR_SERVICES = Object.freeze(['uap-control-postgres', 'uap-redis', 'uap-sdar-postgres']);
const CANONICAL_INDEX_SCHEMA_BY_FILE = Object.freeze({
  'pms-seed.redacted.json': 'sdar.ugv-agent-profile.pms-seed-index/v1',
  'smpp-readonly-qualification.redacted.json':
    'sdar.ugv-agent-profile.smpp-readonly-qualification-index/v1',
  'authority-bootstrap.redacted.json': 'sdar.ugv-agent-profile.authority-bootstrap-index/v1',
  'authority-readiness.redacted.json': 'sdar.ugv-agent-profile.authority-readiness-index/v1',
  'authority-verify.redacted.json': 'sdar.ugv-agent-profile.authority-verify-index/v1',
  'model-invocation-baseline.redacted.json':
    'sdar.ugv-agent-profile.model-invocation-baseline-index/v1',
  'model-invocation-final.redacted.json': 'sdar.ugv-agent-profile.model-invocation-final-index/v1',
});

export class UapValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UapValidationError';
    this.code = code;
  }
}

export async function validateDotEnv(path = resolve(REPOSITORY_ROOT, '.env')) {
  const target = resolve(path);
  const status = await lstat(target).catch((error) => {
    throw isNodeError(error) && error.code === 'ENOENT'
      ? new UapValidationError('UAP_DOTENV_REQUIRED')
      : error;
  });
  if (status.isSymbolicLink() || !status.isFile())
    throw new UapValidationError('UAP_DOTENV_NOT_REGULAR');
  if ((status.mode & 0o777) !== 0o600) throw new UapValidationError('UAP_DOTENV_MODE_INVALID');
  if (process.getuid !== undefined && status.uid !== process.getuid())
    throw new UapValidationError('UAP_DOTENV_OWNER_INVALID');
  if ((await realpath(target)) !== target) throw new UapValidationError('UAP_DOTENV_PATH_INVALID');
  if (status.size < 1 || status.size > 262_144)
    throw new UapValidationError('UAP_DOTENV_SIZE_INVALID');
  let values;
  try {
    values = parseEnv(await readFile(target, 'utf8'));
  } catch {
    throw new UapValidationError('UAP_DOTENV_PARSE_INVALID');
  }
  const required = [
    'SDAR_MASTER_KEY_BASE64',
    'SDAR_UGV_MODEL_PROVIDER_ID',
    'SDAR_UGV_MODEL_BASE_URL',
    'SDAR_UGV_MODEL_NAME',
    'SDAR_UGV_MODEL_EMBEDDING_NAME',
    'SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID',
    'SDAR_UGV_MODEL_EMBEDDING_BASE_URL',
    'SDAR_UGV_MODEL_API_STYLE',
    'SDAR_UGV_MODEL_TIMEOUT_MS',
  ];
  if (required.some((name) => typeof values[name] !== 'string' || values[name].trim() === ''))
    throw new UapValidationError('UAP_DOTENV_REQUIRED_CONFIGURATION_MISSING');
  if (values.SDAR_UGV_REAL_MODEL_ENABLED !== 'YES')
    throw new UapValidationError('UAP_REAL_MODEL_NOT_ENABLED');
  const masterKey = values.SDAR_MASTER_KEY_BASE64;
  const decodedMasterKey = Buffer.from(masterKey, 'base64');
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(masterKey) ||
    masterKey.length % 4 !== 0 ||
    decodedMasterKey.byteLength !== 32 ||
    decodedMasterKey.toString('base64') !== masterKey
  )
    throw new UapValidationError('UAP_MASTER_KEY_INVALID');
  if (values.SDAR_UGV_MODEL_API_STYLE !== 'openai_chat_completions')
    throw new UapValidationError('UAP_MODEL_API_STYLE_INVALID');
  const keySources = ['SDAR_UGV_MODEL_API_KEY', 'SDAR_UGV_MODEL_API_KEY_FILE'].filter(
    (name) => typeof values[name] === 'string' && values[name].trim() !== '',
  );
  if (keySources.length !== 1) throw new UapValidationError('UAP_MODEL_CREDENTIAL_SOURCE_INVALID');
  const secretValues = [];
  if (keySources[0] === 'SDAR_UGV_MODEL_API_KEY') {
    if (
      values.SDAR_UGV_MODEL_API_KEY.length < 8 ||
      values.SDAR_UGV_MODEL_API_KEY.length > 4_096 ||
      /\s/u.test(values.SDAR_UGV_MODEL_API_KEY)
    )
      throw new UapValidationError('UAP_MODEL_CREDENTIAL_INVALID');
    secretValues.push(values.SDAR_UGV_MODEL_API_KEY);
  } else {
    secretValues.push(
      await readPrivateModelCredential(
        resolve(dirname(target), values.SDAR_UGV_MODEL_API_KEY_FILE),
      ),
    );
  }
  for (const name of ['SDAR_UGV_MODEL_BASE_URL', 'SDAR_UGV_MODEL_EMBEDDING_BASE_URL']) {
    let endpoint;
    try {
      endpoint = new URL(values[name]);
    } catch {
      throw new UapValidationError('UAP_MODEL_BASE_URL_INVALID');
    }
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      (endpoint.protocol !== 'https:' && !isLoopbackHostname(endpoint.hostname))
    )
      throw new UapValidationError('UAP_MODEL_BASE_URL_INVALID');
  }
  if (values.SDAR_UGV_MODEL_PROVIDER_ID === values.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID)
    throw new UapValidationError('UAP_MODEL_EMBEDDING_CONFIGURATION_INVALID');
  const timeout = Number(values.SDAR_UGV_MODEL_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300_000)
    throw new UapValidationError('UAP_MODEL_TIMEOUT_INVALID');
  return Object.freeze({
    path: target,
    values: Object.freeze({ ...values }),
    secretValues: Object.freeze(secretValues),
  });
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(normalized)
  );
}

export function validateSmppCompose(
  document,
  secretValues = [],
  dotEnvKeys = [],
  expectedPmsRoot = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}/pms`,
) {
  if (document.name !== 'sdar-uap-p3-b01-smpp')
    throw new UapValidationError('UAP_SMPP_PROJECT_SCOPE_INVALID');
  const services = record(document.services, 'UAP_SMPP_COMPOSE_SERVICES_INVALID');
  exactStrings(Object.keys(services).sort(), SMPP_SERVICES, 'UAP_SMPP_SERVICE_CLOSURE_INVALID');
  const profileServices = Object.entries(services)
    .filter(([, value]) =>
      array(record(value, 'UAP_SMPP_COMPOSE_SERVICE_INVALID').profiles).includes(
        'ugv-agent-profile-simulation',
      ),
    )
    .map(([name]) => name)
    .sort();
  exactStrings(profileServices, SMPP_SERVICES, 'UAP_SMPP_SERVICE_CLOSURE_INVALID');
  exactStrings(
    [...dependencyClosure(services, SMPP_SERVICES)].sort(),
    SMPP_SERVICES,
    'UAP_SMPP_DEPENDENCY_CLOSURE_INVALID',
  );
  const expectedServiceNetworks = Object.freeze({
    'ugv-agent-profile-adapter-postgres': ['ugv-agent-profile-simulation'],
    'ugv-agent-profile-runtime-postgres': ['ugv-agent-profile-simulation'],
    'ugv-agent-profile-pms-postgres': ['ugv-agent-profile-simulation'],
    'ugv-agent-profile-pms-api': ['ugv-agent-profile-northbound', 'ugv-agent-profile-simulation'],
    'ugv-agent-profile-adapter': ['ugv-agent-profile-simulation', 'ugv-agent-profile-southbound'],
    'ugv-agent-profile-runtime': ['ugv-agent-profile-northbound', 'ugv-agent-profile-simulation'],
    'ugv-agent-profile-pms-worker': ['ugv-agent-profile-simulation'],
  });
  for (const serviceName of SMPP_SERVICES) {
    const service = record(services[serviceName], 'UAP_SMPP_SERVICE_MISSING');
    exactStrings(
      Object.keys(record(service.networks, 'UAP_SMPP_CONTROL_NETWORK_MISSING')).sort(),
      expectedServiceNetworks[serviceName],
      'UAP_SMPP_SERVICE_NETWORK_CLOSURE_INVALID',
    );
    rejectEnvFileAndDotEnvMounts(service);
  }
  const networks = record(document.networks, 'UAP_SMPP_NETWORKS_INVALID');
  exactStrings(
    Object.keys(networks).sort(),
    [
      'ugv-agent-profile-northbound',
      'ugv-agent-profile-simulation',
      'ugv-agent-profile-southbound',
    ],
    'UAP_SMPP_NETWORK_CLOSURE_INVALID',
  );
  const controlNetwork = record(
    networks['ugv-agent-profile-simulation'],
    'UAP_SMPP_CONTROL_NETWORK_MISSING',
  );
  if (
    controlNetwork.internal !== true ||
    controlNetwork.driver !== 'bridge' ||
    controlNetwork.name !== 'sdar-uap-p3-b01-smpp-control'
  )
    throw new UapValidationError('UAP_SMPP_CONTROL_NETWORK_NOT_INTERNAL');
  const southboundNetwork = record(
    networks['ugv-agent-profile-southbound'],
    'UAP_SMPP_SOUTHBOUND_NETWORK_MISSING',
  );
  if (
    southboundNetwork.internal === true ||
    southboundNetwork.driver !== 'bridge' ||
    southboundNetwork.name !== 'sdar-uap-p3-b01-smpp-southbound'
  )
    throw new UapValidationError('UAP_SMPP_SOUTHBOUND_NETWORK_INVALID');
  const northboundNetwork = record(
    networks['ugv-agent-profile-northbound'],
    'UAP_SMPP_NORTHBOUND_NETWORK_MISSING',
  );
  if (
    northboundNetwork.internal === true ||
    northboundNetwork.driver !== 'bridge' ||
    northboundNetwork.name !== 'sdar-uap-p3-b01-smpp-northbound'
  )
    throw new UapValidationError('UAP_SMPP_NORTHBOUND_NETWORK_INVALID');
  const southboundOwners = Object.entries(services)
    .filter(([, value]) =>
      Object.keys(
        record(
          record(value, 'UAP_SMPP_SERVICE_INVALID').networks,
          'UAP_SMPP_SERVICE_NETWORKS_INVALID',
        ),
      ).includes('ugv-agent-profile-southbound'),
    )
    .map(([name]) => name);
  exactStrings(
    southboundOwners,
    ['ugv-agent-profile-adapter'],
    'UAP_SMPP_SOUTHBOUND_OWNER_INVALID',
  );
  const northboundOwners = Object.entries(services)
    .filter(([, value]) =>
      Object.keys(
        record(
          record(value, 'UAP_SMPP_SERVICE_INVALID').networks,
          'UAP_SMPP_SERVICE_NETWORKS_INVALID',
        ),
      ).includes('ugv-agent-profile-northbound'),
    )
    .map(([name]) => name)
    .sort();
  exactStrings(
    northboundOwners,
    ['ugv-agent-profile-pms-api', 'ugv-agent-profile-runtime'],
    'UAP_SMPP_NORTHBOUND_OWNER_INVALID',
  );
  const adapter = record(services['ugv-agent-profile-adapter'], 'UAP_SMPP_ADAPTER_MISSING');
  const adapterEnvironment = record(adapter.environment, 'UAP_SMPP_ADAPTER_ENVIRONMENT_INVALID');
  if (
    adapterEnvironment.UGV_DEVICE_MCP_URL !== EXTERNAL_DEVICE_ENDPOINT ||
    adapterEnvironment.UGV_MQTT_URL !== EXTERNAL_MQTT_ENDPOINT ||
    adapterEnvironment.UGV_MQTT_CLIENT_ID !== 'sdar-uap-p3-b01-ugv1' ||
    adapterEnvironment.UGV_FIRE_ENABLED !== 'false' ||
    adapterEnvironment.UGV_ALLOW_NAVIGATION_WITH_RECON !== 'false'
  )
    throw new UapValidationError('UAP_SMPP_ADAPTER_SAFETY_CONFIGURATION_INVALID');
  for (const [name, serviceValue] of Object.entries(services)) {
    if (name === 'ugv-agent-profile-adapter') continue;
    const serialized = JSON.stringify(serviceValue);
    if (
      serialized.includes('192.168.2.63') ||
      serialized.includes('19000') ||
      serialized.includes('1883')
    )
      throw new UapValidationError('UAP_SOUTHBOUND_ENDPOINT_OWNER_INVALID');
  }
  const runtime = record(services['ugv-agent-profile-runtime'], 'UAP_SMPP_RUNTIME_MISSING');
  const runtimeEnvironment = record(runtime.environment, 'UAP_SMPP_RUNTIME_ENVIRONMENT_INVALID');
  if (
    runtimeEnvironment.PMS_RUNTIME_REGISTRATION_URL !== 'http://ugv-agent-profile-pms-api:8090' ||
    runtimeEnvironment.PMS_DEPLOYMENT_ID !== 'uap-p3-b01-runtime' ||
    runtimeEnvironment.PMS_INSTANCE_ID !== 'uap-p3-b01-runtime-1'
  )
    throw new UapValidationError('UAP_SMPP_RUNTIME_REGISTRATION_INVALID');
  const pmsWorker = record(services['ugv-agent-profile-pms-worker'], 'UAP_PMS_WORKER_MISSING');
  const workerEnvironment = record(pmsWorker.environment, 'UAP_PMS_WORKER_ENVIRONMENT_INVALID');
  if (
    workerEnvironment.PMS_RUNTIME_CONTROL_PLANE_URL !== 'http://ugv-agent-profile-pms-api:8090' ||
    workerEnvironment.PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE !== 'anonymous_intranet'
  )
    throw new UapValidationError('UAP_PMS_WORKER_CONTROL_PATH_INVALID');
  expectPrivateBindMounts(services['ugv-agent-profile-pms-api'], expectedPmsRoot, [
    'pms-database-url',
    'runtime-credentials.json',
    'runtime-registration.token',
  ]);
  expectPrivateBindMounts(services['ugv-agent-profile-pms-worker'], expectedPmsRoot, [
    'pms-database-url',
    'postgres-provisioning.json',
  ]);
  expectPrivateBindMounts(runtime, expectedPmsRoot, ['runtime-registration.token']);
  expectLoopbackPort(services['ugv-agent-profile-adapter'], 7010, 17031);
  expectLoopbackPort(runtime, 8080, 19131);
  expectLoopbackPort(services['ugv-agent-profile-pms-api'], 8090, 18092);
  const volumes = record(document.volumes, 'UAP_SMPP_VOLUMES_INVALID');
  const expectedVolumes = {
    'ugv-agent-profile-adapter-postgres-data': 'sdar-uap-p3-b01-smpp-adapter-postgres-data',
    'ugv-agent-profile-runtime-postgres-data': 'sdar-uap-p3-b01-smpp-runtime-postgres-data',
    'ugv-agent-profile-adapter-state': 'sdar-uap-p3-b01-smpp-adapter-state',
    'ugv-agent-profile-pms-postgres-data': 'sdar-uap-p3-b01-smpp-pms-postgres-data',
    'ugv-agent-profile-pms-worker-state': 'sdar-uap-p3-b01-smpp-pms-worker-state',
  };
  exactStrings(
    Object.keys(volumes).sort(),
    Object.keys(expectedVolumes).sort(),
    'UAP_SMPP_VOLUME_CLOSURE_INVALID',
  );
  for (const [key, expectedName] of Object.entries(expectedVolumes))
    if (record(volumes[key], 'UAP_SMPP_VOLUME_INVALID').name !== expectedName)
      throw new UapValidationError('UAP_SMPP_VOLUME_SCOPE_INVALID');
  assertPortClosure(services, {
    'ugv-agent-profile-adapter': [7010, 17031],
    'ugv-agent-profile-runtime': [8080, 19131],
    'ugv-agent-profile-pms-api': [8090, 18092],
  });
  assertNoDotEnvMaterial(document, secretValues, dotEnvKeys);
}

export function validateSdarCompose(document, secretValues = [], dotEnvKeys = []) {
  if (document.name !== 'sdar-uap-p3-b01-sdar')
    throw new UapValidationError('UAP_SDAR_PROJECT_SCOPE_INVALID');
  const services = record(document.services, 'UAP_SDAR_COMPOSE_SERVICES_INVALID');
  exactStrings(Object.keys(services).sort(), SDAR_SERVICES, 'UAP_SDAR_SERVICE_CLOSURE_INVALID');
  for (const service of Object.values(services)) {
    const value = record(service, 'UAP_SDAR_SERVICE_INVALID');
    rejectEnvFileAndDotEnvMounts(value);
    exactStrings(
      Object.keys(record(value.networks, 'UAP_SDAR_SERVICE_NETWORK_INVALID')).sort(),
      ['uap-sdar', 'uap-sdar-northbound'],
      'UAP_SDAR_SERVICE_NETWORK_INVALID',
    );
  }
  const expectedDockerfile = 'infra/postgres/Dockerfile.pgvector-hardened';
  for (const serviceName of ['uap-sdar-postgres', 'uap-control-postgres']) {
    const service = record(services[serviceName], 'UAP_SDAR_SERVICE_INVALID');
    const build = record(service.build, 'UAP_SDAR_BUILD_CONTEXT_INVALID');
    if (
      build.context !== REPOSITORY_ROOT ||
      build.dockerfile !== expectedDockerfile ||
      resolve(build.context, build.dockerfile) !== resolve(REPOSITORY_ROOT, expectedDockerfile)
    )
      throw new UapValidationError('UAP_SDAR_BUILD_CONTEXT_INVALID');
  }
  if (record(services['uap-redis'], 'UAP_SDAR_SERVICE_INVALID').build !== undefined)
    throw new UapValidationError('UAP_SDAR_BUILD_CONTEXT_INVALID');
  expectLoopbackPort(services['uap-sdar-postgres'], 5432, 55462);
  expectLoopbackPort(services['uap-control-postgres'], 5432, 55463);
  expectLoopbackPort(services['uap-redis'], 6379, 56391);
  assertPortClosure(services, {
    'uap-sdar-postgres': [5432, 55462],
    'uap-control-postgres': [5432, 55463],
    'uap-redis': [6379, 56391],
  });
  const networks = record(document.networks, 'UAP_SDAR_NETWORKS_INVALID');
  exactStrings(
    Object.keys(networks).sort(),
    ['uap-sdar', 'uap-sdar-northbound'],
    'UAP_SDAR_NETWORK_CLOSURE_INVALID',
  );
  const network = record(networks['uap-sdar'], 'UAP_SDAR_NETWORK_INVALID');
  if (
    network.name !== 'sdar-uap-p3-b01-sdar-control' ||
    network.driver !== 'bridge' ||
    network.internal !== true
  )
    throw new UapValidationError('UAP_SDAR_NETWORK_INVALID');
  const northboundNetwork = record(
    networks['uap-sdar-northbound'],
    'UAP_SDAR_NORTHBOUND_NETWORK_INVALID',
  );
  if (
    northboundNetwork.name !== 'sdar-uap-p3-b01-sdar-northbound' ||
    northboundNetwork.driver !== 'bridge' ||
    northboundNetwork.internal === true
  )
    throw new UapValidationError('UAP_SDAR_NORTHBOUND_NETWORK_INVALID');
  const volumes = record(document.volumes, 'UAP_SDAR_VOLUMES_INVALID');
  const expectedVolumes = {
    'uap-sdar-postgres-data': 'sdar-uap-p3-b01-runtime-postgres-data',
    'uap-control-postgres-data': 'sdar-uap-p3-b01-control-postgres-data',
    'uap-redis-data': 'sdar-uap-p3-b01-redis-data',
  };
  exactStrings(
    Object.keys(volumes).sort(),
    Object.keys(expectedVolumes).sort(),
    'UAP_SDAR_VOLUME_CLOSURE_INVALID',
  );
  for (const [key, name] of Object.entries(expectedVolumes))
    if (record(volumes[key], 'UAP_SDAR_VOLUME_INVALID').name !== name)
      throw new UapValidationError('UAP_SDAR_VOLUME_SCOPE_INVALID');
  const serialized = JSON.stringify(document);
  if (
    serialized.includes('192.168.2.63') ||
    serialized.includes('19000') ||
    serialized.includes('1883')
  )
    throw new UapValidationError('UAP_SDAR_SOUTHBOUND_ENDPOINT_FORBIDDEN');
  assertNoDotEnvMaterial(document, secretValues, dotEnvKeys);
}

export function assertNoDotEnvMaterial(value, secretValues = [], dotEnvKeys = []) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (/(?:^|[\\/])\.env(?:$|[\\/:])/u.test(serialized))
    throw new UapValidationError('UAP_DOTENV_MATERIAL_EXPOSED');
  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length > 0 && serialized.includes(secret))
      throw new UapValidationError('UAP_DOTENV_VALUE_EXPOSED');
  }
  for (const key of dotEnvKeys) {
    if (containsExactKeyMaterial(serialized, key))
      throw new UapValidationError('UAP_DOTENV_KEY_EXPOSED');
  }
}

function containsExactKeyMaterial(value, key) {
  if (typeof key !== 'string' || key.length === 0) return false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, 'u').test(value);
}

export function assertPrivateProcessLogSafe(value, dotenvValues, additionalSecrets = []) {
  const credentials = [...credentialMaterial(dotenvValues), ...additionalSecrets];
  const credentialKeys = [
    ...Object.keys(dotenvValues).filter((key) => SENSITIVE_KEY.test(key)),
    ...TASK_SENSITIVE_KEYS,
  ];
  assertNoDotEnvMaterial(value, credentials, credentialKeys);
}

export async function taskOwnedCredentialMaterial(stateRoot = STATE_ROOT) {
  const values = [];
  for (const relativePath of TASK_CREDENTIAL_FILES)
    values.push((await readPrivateBounded(resolve(stateRoot, relativePath), 65_536)).trim());
  let provisioning;
  try {
    provisioning = JSON.parse(
      await readPrivateBounded(resolve(stateRoot, 'pms/postgres-provisioning.json'), 65_536),
    );
  } catch {
    throw new UapValidationError('UAP_TASK_CREDENTIAL_MATERIAL_INVALID');
  }
  for (const key of ['adminDatabaseUrl', 'runtimePassword']) {
    const value = provisioning?.[key];
    if (typeof value !== 'string' || value.length < 8)
      throw new UapValidationError('UAP_TASK_CREDENTIAL_MATERIAL_INVALID');
    values.push(value);
  }
  values.push(
    'postgresql://sdar_uap@127.0.0.1:55462/sdar_uap',
    'postgresql://sdar_uap_control@127.0.0.1:55463/sdar_uap_control',
  );
  return Object.freeze(values.filter((value) => value.length >= 8));
}

export function validatePmsRuntimeCredentialDescriptor(document) {
  const descriptor = record(document, 'UAP_PMS_RUNTIME_CREDENTIAL_INVALID');
  if (!Array.isArray(descriptor.runtimeConfig) || descriptor.runtimeConfig.length !== 0)
    throw new UapValidationError('UAP_PMS_RUNTIME_CREDENTIAL_INVALID');
  if (!Array.isArray(descriptor.runtimeRegistration) || descriptor.runtimeRegistration.length !== 1)
    throw new UapValidationError('UAP_PMS_RUNTIME_CREDENTIAL_INVALID');
  const principal = record(descriptor.runtimeRegistration[0], 'UAP_PMS_RUNTIME_CREDENTIAL_INVALID');
  const expected = {
    subjectId: 'uap-p3-b01-runtime-registration',
    providerId: 'isr.vehicle.ugv.ugv1',
    deploymentId: 'uap-p3-b01-runtime',
    instanceId: 'uap-p3-b01-runtime-1',
    runtimeVersion: '2.0.0-rc.1',
    tokenFile: '/run/uap-pms/runtime-registration.token',
    protocolVersion: '2026-07-28',
  };
  if (
    Object.entries(expected).some(([key, value]) => principal[key] !== value) ||
    Object.keys(principal).length !== Object.keys(expected).length + 1
  )
    throw new UapValidationError('UAP_PMS_RUNTIME_CREDENTIAL_INVALID');
  exactStrings(
    array(principal.scopes),
    ['runtime:register', 'runtime:heartbeat'],
    'UAP_PMS_RUNTIME_CREDENTIAL_INVALID',
  );
}

export async function validateBaseline() {
  const local = await validateLocalBaseline();
  const remote = await validateRemoteBaseline();
  return Object.freeze({ ...local, ...remote });
}

export async function validateLocalBaseline() {
  if (resolve(SMPP_ROOT) !== SMPP_ROOT) throw new UapValidationError('UAP_SMPP_ROOT_INVALID');
  const head = git(['rev-parse', 'HEAD'], SMPP_ROOT);
  if (head !== SMPP_HEAD) throw new UapValidationError('UAP_SMPP_BASELINE_MISMATCH');
  if (git(['status', '--porcelain=v1', '--untracked-files=all'], SMPP_ROOT) !== '')
    throw new UapValidationError('UAP_SMPP_WORKTREE_NOT_CLEAN');
  return Object.freeze({ head: SMPP_HEAD, headVerified: true, worktreeClean: true });
}

export async function validateRemoteBaseline() {
  const branchRef = `refs/heads/${SMPP_REMOTE_BRANCH}`;
  let remote;
  try {
    remote = execFileSync('git', ['ls-remote', 'origin', branchRef], {
      cwd: SMPP_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    }).trim();
  } catch {
    throw new UapValidationError('UAP_SMPP_REMOTE_BASELINE_UNREACHABLE');
  }
  if (remote !== `${SMPP_HEAD}\t${branchRef}`)
    throw new UapValidationError('UAP_SMPP_REMOTE_BASELINE_MISMATCH');
  return Object.freeze({
    branch: SMPP_REMOTE_BRANCH,
    remoteHeadVerified: true,
  });
}

function dependencyClosure(services, roots) {
  const result = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (result.has(name)) continue;
    const service = record(services[name], 'UAP_COMPOSE_DEPENDENCY_MISSING');
    result.add(name);
    for (const dependency of Object.keys(
      record(service.depends_on ?? {}, 'UAP_COMPOSE_DEPENDENCY_INVALID'),
    ))
      pending.push(dependency);
  }
  return result;
}

function rejectEnvFileAndDotEnvMounts(service) {
  if (service.env_file !== undefined)
    throw new UapValidationError('UAP_COMPOSE_ENV_FILE_FORBIDDEN');
  for (const volume of array(service.volumes)) {
    const source =
      typeof volume === 'string'
        ? volume.split(':')[0]
        : record(volume, 'UAP_COMPOSE_VOLUME_INVALID').source;
    const target =
      typeof volume === 'string'
        ? volume.split(':')[1]
        : record(volume, 'UAP_COMPOSE_VOLUME_INVALID').target;
    if (
      (typeof source === 'string' && /(?:^|[\\/])\.env$/u.test(source)) ||
      (typeof target === 'string' && /(?:^|[\\/])\.env$/u.test(target))
    )
      throw new UapValidationError('UAP_COMPOSE_DOTENV_MOUNT_FORBIDDEN');
  }
}

function expectLoopbackPort(serviceValue, target, published) {
  const service = record(serviceValue, 'UAP_COMPOSE_PORT_SERVICE_INVALID');
  const matches = array(service.ports).filter((value) => {
    const port = record(value, 'UAP_COMPOSE_PORT_INVALID');
    return (
      Number(port.target) === target &&
      Number(port.published) === published &&
      port.host_ip === '127.0.0.1'
    );
  });
  if (matches.length !== 1 || array(service.ports).length !== 1)
    throw new UapValidationError('UAP_COMPOSE_FIXED_PORT_INVALID');
}

function assertPortClosure(services, exposed) {
  for (const [name, serviceValue] of Object.entries(services)) {
    const ports = array(record(serviceValue, 'UAP_COMPOSE_PORT_SERVICE_INVALID').ports);
    if (Object.hasOwn(exposed, name)) {
      const [target, published] = exposed[name];
      expectLoopbackPort(serviceValue, target, published);
    } else if (ports.length !== 0) {
      throw new UapValidationError('UAP_COMPOSE_PORT_CLOSURE_INVALID');
    }
  }
}

async function readPrivateModelCredential(path) {
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT')
      throw new UapValidationError('UAP_MODEL_CREDENTIAL_FILE_REQUIRED');
    throw error;
  }
  if (status.isSymbolicLink() || !status.isFile())
    throw new UapValidationError('UAP_MODEL_CREDENTIAL_FILE_NOT_REGULAR');
  if ((status.mode & 0o777) !== 0o600)
    throw new UapValidationError('UAP_MODEL_CREDENTIAL_FILE_MODE_INVALID');
  if (process.getuid !== undefined && status.uid !== process.getuid())
    throw new UapValidationError('UAP_MODEL_CREDENTIAL_FILE_OWNER_INVALID');
  if ((await realpath(path)) !== path)
    throw new UapValidationError('UAP_MODEL_CREDENTIAL_FILE_PATH_INVALID');
  if (status.size < 1 || status.size > 65_536)
    throw new UapValidationError('UAP_MODEL_CREDENTIAL_FILE_SIZE_INVALID');
  const value = (await readFile(path, 'utf8')).trim();
  if (value.length < 8 || value.length > 65_536 || /\s/u.test(value))
    throw new UapValidationError('UAP_MODEL_CREDENTIAL_INVALID');
  return value;
}

async function readPrivateBounded(path, maximumBytes, allowEmpty = false) {
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT')
      throw new UapValidationError('UAP_PRIVATE_CREDENTIAL_FILE_REQUIRED');
    throw error;
  }
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    (!allowEmpty && status.size < 1) ||
    status.size > maximumBytes ||
    (process.getuid !== undefined && status.uid !== process.getuid())
  )
    throw new UapValidationError('UAP_PRIVATE_CREDENTIAL_FILE_INVALID');
  return readFile(path, 'utf8');
}

async function readPublicArtifactWithFirstPass(path) {
  const target = resolve(path);
  if (target !== REPORT_ROOT && !target.startsWith(`${REPORT_ROOT}/`))
    throw new UapValidationError('UAP_ARTIFACT_PATH_INVALID');
  const source = await readPrivateBounded(target, 8 * 1024 * 1024);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return Object.freeze([{ path: target, source }]);
  }
  if (parsed?.canonicalSemantics !== 'immutable_first_pass')
    return Object.freeze([{ path: target, source }]);
  const schemaVersion = CANONICAL_INDEX_SCHEMA_BY_FILE[basename(target)];
  if (schemaVersion === undefined) throw new UapValidationError('UAP_CANONICAL_ATTEMPT_INVALID');
  const state = await initializeState();
  let validated;
  try {
    validated = await readValidatedFirstPassIndex(target, REPOSITORY_ROOT, {
      schemaVersion,
      task: 'UAP-P3-B01',
      bootstrapRunId: state.bootstrapRunId,
      evidenceClass: 'external_simulation',
    });
  } catch {
    throw new UapValidationError('UAP_CANONICAL_ATTEMPT_INVALID');
  }
  return Object.freeze([
    { path: validated.indexPath, source: validated.indexSource },
    { path: validated.attemptPath, source: validated.attemptSource },
  ]);
}

function expectPrivateBindMounts(serviceValue, expectedRoot, expectedNames) {
  const service = record(serviceValue, 'UAP_COMPOSE_BIND_SERVICE_INVALID');
  const bindings = array(service.volumes)
    .map((value) => record(value, 'UAP_COMPOSE_VOLUME_INVALID'))
    .filter((value) => value.type === 'bind');
  const actualTargets = bindings.map((value) => value.target).sort();
  const expectedTargets = expectedNames.map((name) => `/run/uap-pms/${name}`).sort();
  exactStrings(actualTargets, expectedTargets, 'UAP_PMS_BIND_MOUNT_CLOSURE_INVALID');
  for (const binding of bindings) {
    const name = expectedNames.find((candidate) => binding.target === `/run/uap-pms/${candidate}`);
    if (
      name === undefined ||
      binding.source !== join(expectedRoot, name) ||
      binding.read_only !== true
    )
      throw new UapValidationError('UAP_PMS_BIND_MOUNT_INVALID');
  }
}

function credentialMaterial(values) {
  return Object.entries(values)
    .filter(
      ([key, value]) =>
        value.length >= 8 && (SENSITIVE_KEY.test(key) || urlContainsCredentials(value)),
    )
    .map(([, value]) => value);
}

export function publicConfigurationMaterial(values, additionalSecrets = []) {
  return Object.freeze(
    [
      ...credentialMaterial(values),
      ...PUBLIC_LLM_CONFIGURATION_KEYS.flatMap((key) =>
        typeof values[key] === 'string' ? [values[key]] : [],
      ),
      ...additionalSecrets,
    ].filter(
      (value, index, materials) =>
        typeof value === 'string' && value.length > 0 && materials.indexOf(value) === index,
    ),
  );
}

function urlContainsCredentials(value) {
  try {
    const parsed = new URL(value);
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
}

function git(arguments_, cwd) {
  try {
    return execFileSync('git', arguments_, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new UapValidationError('UAP_GIT_INSPECTION_FAILED');
  }
}

function exactStrings(actual, expected, code) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
    throw new UapValidationError(code);
}

function record(value, code) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new UapValidationError(code);
  return value;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length)
    throw new UapValidationError('UAP_ARGUMENT_INVALID');
  return process.argv[index + 1];
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw new UapValidationError('UAP_JSON_ARTIFACT_INVALID');
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'baseline') {
    const result = await validateBaseline();
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'baseline-local') {
    const result = await validateLocalBaseline();
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'baseline-remote') {
    const result = await validateRemoteBaseline();
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'environment') {
    await validateDotEnv();
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', privateDotEnv: true, realModelConfigured: true, secretsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'compose') {
    const dotEnv = await validateDotEnv();
    const taskSecrets = await taskOwnedCredentialMaterial();
    const keys = [...Object.keys(dotEnv.values), ...TASK_SENSITIVE_KEYS];
    validateSmppCompose(
      await readJson(argument('--smpp-json')),
      publicConfigurationMaterial(dotEnv.values, [...dotEnv.secretValues, ...taskSecrets]),
      keys,
    );
    validateSdarCompose(
      await readJson(argument('--sdar-json')),
      publicConfigurationMaterial(dotEnv.values, [...dotEnv.secretValues, ...taskSecrets]),
      keys,
    );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', smppServices: 7, sdarServices: 3, southboundOwners: 1, secretsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'artifacts') {
    const dotEnv = await validateDotEnv();
    const taskSecrets = await taskOwnedCredentialMaterial();
    const fileArguments = process.argv.filter(
      (value, index) => process.argv[index - 1] === '--file',
    );
    if (fileArguments.length < 1) throw new UapValidationError('UAP_ARTIFACT_FILE_REQUIRED');
    let artifactCount = 0;
    for (const path of fileArguments)
      for (const artifact of await readPublicArtifactWithFirstPass(path)) {
        assertNoDotEnvMaterial(
          artifact.source,
          publicConfigurationMaterial(dotEnv.values, [...dotEnv.secretValues, ...taskSecrets]),
          [...Object.keys(dotEnv.values), ...TASK_SENSITIVE_KEYS],
        );
        artifactCount += 1;
      }
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', artifactCount, secretsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'private-log') {
    const dotEnv = await validateDotEnv();
    const taskSecrets = await taskOwnedCredentialMaterial();
    const fileArguments = process.argv.filter(
      (value, index) => process.argv[index - 1] === '--file',
    );
    if (fileArguments.length < 1) throw new UapValidationError('UAP_ARTIFACT_FILE_REQUIRED');
    for (const path of fileArguments)
      assertPrivateProcessLogSafe(
        await readPrivateBounded(resolve(path), 8 * 1024 * 1024, true),
        dotEnv.values,
        [...dotEnv.secretValues, ...taskSecrets],
      );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', privateLogCount: fileArguments.length, credentialsIncluded: false })}\n`,
    );
    return;
  }
  if (mode === 'runtime-material') {
    const dotEnv = await validateDotEnv();
    const taskSecrets = await taskOwnedCredentialMaterial();
    const fileArguments = process.argv.filter(
      (value, index) => process.argv[index - 1] === '--file',
    );
    if (fileArguments.length < 1) throw new UapValidationError('UAP_ARTIFACT_FILE_REQUIRED');
    for (const path of fileArguments)
      assertNoDotEnvMaterial(
        await readPrivateBounded(resolve(path), 8 * 1024 * 1024),
        publicConfigurationMaterial(dotEnv.values, [...dotEnv.secretValues, ...taskSecrets]),
        [...Object.keys(dotEnv.values), ...TASK_SENSITIVE_KEYS],
      );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', runtimeMaterialCount: fileArguments.length, credentialsIncluded: false })}\n`,
    );
    return;
  }
  throw new UapValidationError('UAP_MODE_INVALID');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof UapValidationError ? error.code : 'UAP_PROFILE_VALIDATION_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
