#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  readlink,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

import { authorizeB02SimulationId } from './b02-attempt-identity.mjs';
import { initializeState } from './initialize-state.mjs';
import {
  assertPrivateProcessLogSafe,
  taskOwnedCredentialMaterial,
  validateDotEnv,
} from './validate-profile.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATE_ROOT = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}`;
const REPORT_ROOT = resolve(REPOSITORY_ROOT, 'reports/ugv-agent-profile-simulation');
const MANIFEST_PATH = join(STATE_ROOT, 'processes.json');
const LOCK_PATH = join(STATE_ROOT, 'host-process.lock');
const TSX_CLI = resolve(REPOSITORY_ROOT, 'node_modules/tsx/dist/cli.mjs');
const B02_SIMULATION_RUN_ID = /^uap-p3-b02-[a-z0-9][a-z0-9._-]{7,127}$/u;
const OFFLINE_FIXTURE_SIMULATION_RUN_ID = /^uap-p3-b02-offline-fixture-[a-f0-9]{24}$/u;
const OFFLINE_FIXTURE_ACKNOWLEDGEMENT =
  'I_ACKNOWLEDGE_INTERNAL_OFFLINE_HOST_PROCESS_SUPERVISOR_TEST_FIXTURE';
const OFFLINE_FIXTURE_ENTRYPOINT = resolve(
  REPOSITORY_ROOT,
  'apps/node-control-acceptance/test/fixtures/ugv-host-process-supervisor.fixture.mjs',
);
const OFFLINE_FIXTURE_ROOT_PREFIX = resolve(tmpdir(), 'sdar-uap-supervisor-fixture-');
const OFFLINE_FIXTURE_SESSION_FILE = '.offline-host-process-supervisor-fixture.json';
const PROCESS_SPECS = Object.freeze([
  Object.freeze({
    name: 'server',
    entrypoint: resolve(REPOSITORY_ROOT, 'apps/server/src/main.ts'),
    cwd: REPOSITORY_ROOT,
  }),
  Object.freeze({
    name: 'node-control-api',
    entrypoint: resolve(REPOSITORY_ROOT, 'apps/node-control-api/src/main.ts'),
    cwd: join(STATE_ROOT, 'host-work'),
  }),
  Object.freeze({
    name: 'node-control-worker',
    entrypoint: resolve(REPOSITORY_ROOT, 'apps/node-control-worker/src/main.ts'),
    cwd: join(STATE_ROOT, 'host-work'),
  }),
]);
export const UAP_HOST_PROCESS_SPECS = PROCESS_SPECS;
const SAFE_SYSTEM_ENVIRONMENT = Object.freeze([
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'TERM',
  'TMPDIR',
  'TZ',
]);
const ARTIFACT_FLAGS = Object.freeze({
  SDAR_V13_ARTIFACT_MODE: 'off',
  SDAR_V13_COMPILER_ENABLED: 'false',
  SDAR_V13_REGISTRY_ENABLED: 'false',
  SDAR_V13_SHADOW_ENABLED: 'false',
  SDAR_V13_PROMOTION_ENABLED: 'false',
  SDAR_V13_RETRIEVAL_ENABLED: 'false',
  SDAR_V13_MODEL_ROUTE_ENABLED: 'false',
  SDAR_V13_TEMPLATE_ENABLED: 'false',
  SDAR_V13_RULE_ENABLED: 'false',
  SDAR_V13_FAST_GATEWAY_ENABLED: 'false',
  SDAR_V13_CASE_ENABLED: 'false',
  SDAR_V13_MODEL_CASCADE_ENABLED: 'false',
  SDAR_V13_TENANT_ALLOWLIST: '',
  SDAR_V13_ARTIFACT_ALLOWLIST: '',
});

const PRODUCTION_SUPERVISOR_CONFIGURATION = Object.freeze({
  kind: 'production',
  stateRoot: STATE_ROOT,
  reportRoot: REPORT_ROOT,
  manifestPath: MANIFEST_PATH,
  lockPath: LOCK_PATH,
  processSpecs: PROCESS_SPECS,
  executableInputs: Object.freeze([TSX_CLI, ...PROCESS_SPECS.map((entry) => entry.entrypoint)]),
  initializeState: () => initializeState(),
  authorizeSimulationId: (simulationRunId) =>
    authorizeB02SimulationId(simulationRunId, {
      stateRoot: STATE_ROOT,
      reportRoot: REPORT_ROOT,
    }),
  processEnvironment: (name, sideEffects, simulationRunId) =>
    processEnvironment(
      name,
      sideEffects,
      STATE_ROOT,
      resolve(REPOSITORY_ROOT, '.env'),
      simulationRunId,
      REPORT_ROOT,
    ),
  spawnCommand: (specification) =>
    Object.freeze({
      executable: process.execPath,
      arguments: Object.freeze([TSX_CLI, specification.entrypoint]),
    }),
  readinessEvents: Object.freeze({
    server: 'server.ready',
    'node-control-api': 'node_control.api.ready',
    'node-control-worker': 'node_control.worker.ready',
  }),
  healthUrls: Object.freeze({
    server: 'http://127.0.0.1:10998/api/v1/health',
    'node-control-api': 'http://127.0.0.1:10091/health/ready',
  }),
  readinessTimeoutMs: 180_000,
  readinessPollMs: 250,
  assertProcessLogSafe: (logFile) => assertProcessLogSafe(logFile),
});

export class UapSupervisorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UapSupervisorError';
    this.code = code;
  }
}

export async function createOfflineHostProcessSupervisorTestFixture(options) {
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options) ||
    Object.keys(options).sort().join(',') !==
      ['acknowledgement', 'fixtureCapability', 'fixtureEntrypoint', 'fixtureRoot'].join(',') ||
    options.acknowledgement !== OFFLINE_FIXTURE_ACKNOWLEDGEMENT
  )
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  const fixtureEntrypoint = await validateOfflineFixtureEntrypoint(options.fixtureEntrypoint);
  const fixtureCapability = validateOfflineFixtureCapability(options.fixtureCapability);
  let fixtureSession;
  if (options.fixtureRoot === null)
    fixtureSession = await initializeOfflineFixtureSession(fixtureEntrypoint, fixtureCapability);
  else
    fixtureSession = await validateOfflineFixtureSession(
      options.fixtureRoot,
      fixtureEntrypoint,
      fixtureCapability,
    );
  const stateRoot = fixtureSession.root;
  const reportRoot = join(stateRoot, 'reports');
  const processSpecs = Object.freeze([
    Object.freeze({ name: 'server', entrypoint: fixtureEntrypoint, cwd: stateRoot }),
    Object.freeze({
      name: 'node-control-api',
      entrypoint: fixtureEntrypoint,
      cwd: join(stateRoot, 'host-work'),
    }),
    Object.freeze({
      name: 'node-control-worker',
      entrypoint: fixtureEntrypoint,
      cwd: join(stateRoot, 'host-work'),
    }),
  ]);
  const authorizeSimulationId = async (simulationRunId) => {
    const state = await initializeState(stateRoot);
    const issuedSimulationRunId = offlineFixtureIssuedSimulationRunId(state.bootstrapRunId);
    if (simulationRunId === state.simulationRunId)
      return Object.freeze({ simulationId: simulationRunId, kind: 'initial_reserved' });
    if (simulationRunId === issuedSimulationRunId)
      return Object.freeze({ simulationId: simulationRunId, kind: 'recovery_issued' });
    throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_NOT_AUTHORIZED');
  };
  let configuration;
  configuration = Object.freeze({
    kind: 'offline_test_fixture',
    stateRoot,
    reportRoot,
    manifestPath: join(stateRoot, 'processes.json'),
    lockPath: join(stateRoot, 'host-process.lock'),
    processSpecs,
    executableInputs: Object.freeze([fixtureEntrypoint]),
    initializeState: () => initializeState(stateRoot),
    authorizeSimulationId,
    processEnvironment: (name, sideEffects, simulationRunId) =>
      offlineFixtureProcessEnvironment(name, sideEffects, simulationRunId, configuration),
    spawnCommand: (specification) =>
      Object.freeze({
        executable: process.execPath,
        arguments: Object.freeze([specification.entrypoint]),
      }),
    readinessEvents: Object.freeze({
      server: 'offline_fixture.server.ready',
      'node-control-api': 'offline_fixture.node-control-api.ready',
      'node-control-worker': 'offline_fixture.node-control-worker.ready',
    }),
    healthUrls: Object.freeze({}),
    readinessTimeoutMs: 5_000,
    readinessPollMs: 25,
    assertProcessLogSafe: (logFile) => assertOfflineFixtureProcessLogSafe(logFile),
  });
  return Object.freeze({
    fixtureRoot: stateRoot,
    manifestPath: configuration.manifestPath,
    startProcesses: () => startProcessesWithConfiguration(configuration),
    processStatus: () => processStatusWithConfiguration(configuration),
    stopProcesses: () => stopProcessesWithConfiguration(configuration),
    restartServer: (sideEffects, acknowledgement, requestedSimulationRunId) =>
      restartServerWithConfiguration(
        sideEffects,
        acknowledgement,
        requestedSimulationRunId,
        configuration,
      ),
    processLogFiles: (allowMissingProcesses = false) =>
      processLogFilesWithConfiguration(allowMissingProcesses, configuration),
    issuedSimulationRunId: async () => {
      const state = await initializeState(stateRoot);
      return offlineFixtureIssuedSimulationRunId(state.bootstrapRunId);
    },
  });
}

async function validateOfflineFixtureEntrypoint(value) {
  if (value !== OFFLINE_FIXTURE_ENTRYPOINT)
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  const [status, canonical] = await Promise.all([lstat(value), realpath(value)]).catch(() => {
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  });
  if (status.isSymbolicLink() || !status.isFile() || canonical !== OFFLINE_FIXTURE_ENTRYPOINT)
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  return canonical;
}

function validateOfflineFixtureCapability(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  return value;
}

async function initializeOfflineFixtureSession(fixtureEntrypoint, fixtureCapability) {
  const root = await mkdtemp(OFFLINE_FIXTURE_ROOT_PREFIX);
  await chmod(root, 0o700);
  const document = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.offline-supervisor-fixture/v1',
    creationMethod: 'node.fs.mkdtemp',
    root,
    fixtureEntrypoint,
    capabilitySha256: createHash('sha256').update(fixtureCapability).digest('hex'),
  });
  await writeFile(join(root, OFFLINE_FIXTURE_SESSION_FILE), `${JSON.stringify(document)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(join(root, OFFLINE_FIXTURE_SESSION_FILE), 0o600);
  return validateOfflineFixtureSession(root, fixtureEntrypoint, fixtureCapability);
}

async function validateOfflineFixtureSession(rootValue, fixtureEntrypoint, fixtureCapability) {
  if (typeof rootValue !== 'string')
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  const root = resolve(rootValue);
  const suffix = root.slice(OFFLINE_FIXTURE_ROOT_PREFIX.length);
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(root), realpath(root)]);
  } catch {
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  }
  if (
    !root.startsWith(OFFLINE_FIXTURE_ROOT_PREFIX) ||
    !/^[A-Za-z0-9]{6}$/u.test(suffix) ||
    canonical !== root ||
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    (status.mode & 0o777) !== 0o700 ||
    (process.getuid !== undefined && status.uid !== process.getuid())
  )
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  let session;
  try {
    session = JSON.parse(await readPrivateFile(join(root, OFFLINE_FIXTURE_SESSION_FILE), 16_384));
  } catch {
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  }
  if (
    typeof session !== 'object' ||
    session === null ||
    Array.isArray(session) ||
    Object.keys(session).sort().join(',') !==
      ['capabilitySha256', 'creationMethod', 'fixtureEntrypoint', 'root', 'schemaVersion'].join(
        ',',
      ) ||
    session.schemaVersion !== 'sdar.ugv-agent-profile.offline-supervisor-fixture/v1' ||
    session.creationMethod !== 'node.fs.mkdtemp' ||
    session.root !== root ||
    session.fixtureEntrypoint !== fixtureEntrypoint ||
    typeof session.capabilitySha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(session.capabilitySha256) ||
    !timingSafeEqual(
      Buffer.from(session.capabilitySha256, 'hex'),
      Buffer.from(createHash('sha256').update(fixtureCapability).digest('hex'), 'hex'),
    )
  )
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  return Object.freeze({ root });
}

function offlineFixtureIssuedSimulationRunId(bootstrapRunId) {
  if (typeof bootstrapRunId !== 'string')
    throw new UapSupervisorError('UAP_OFFLINE_FIXTURE_CONFIGURATION_INVALID');
  return `uap-p3-b02-offline-fixture-${createHash('sha256')
    .update(bootstrapRunId)
    .digest('hex')
    .slice(0, 24)}`;
}

export function sanitizedBaseEnvironment(environment = process.env) {
  return Object.freeze(
    Object.fromEntries(
      SAFE_SYSTEM_ENVIRONMENT.flatMap((name) =>
        typeof environment[name] === 'string' ? [[name, environment[name]]] : [],
      ),
    ),
  );
}

export function exactProviderAuthorities(dotEnvValues) {
  const authorities = new Set();
  for (const key of ['SDAR_UGV_MODEL_BASE_URL', 'SDAR_UGV_MODEL_EMBEDDING_BASE_URL']) {
    const value = dotEnvValues?.[key];
    if (typeof value !== 'string')
      throw new UapSupervisorError('UAP_MODEL_PROVIDER_AUTHORITY_INVALID');
    let endpoint;
    try {
      endpoint = new URL(value);
    } catch {
      throw new UapSupervisorError('UAP_MODEL_PROVIDER_AUTHORITY_INVALID');
    }
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username !== '' ||
      endpoint.password !== '' ||
      endpoint.host === '' ||
      (endpoint.protocol !== 'https:' && !isLoopbackHostname(endpoint.hostname))
    )
      throw new UapSupervisorError('UAP_MODEL_PROVIDER_AUTHORITY_INVALID');
    authorities.add(endpoint.host.toLowerCase());
  }
  return Object.freeze([...authorities].sort());
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127(?:\.[0-9]{1,3}){3}$/u.test(normalized)
  );
}

export async function processEnvironment(
  name,
  sideEffects = 'NO',
  stateRoot = STATE_ROOT,
  dotEnvPath = resolve(REPOSITORY_ROOT, '.env'),
  sideEffectSimulationRunId,
  reportRoot = REPORT_ROOT,
) {
  if (!['NO', 'YES'].includes(sideEffects))
    throw new UapSupervisorError('UAP_SIDE_EFFECT_MODE_INVALID');
  await initializeState(stateRoot);
  const base = { ...sanitizedBaseEnvironment() };
  if (name === 'node-control-api')
    return Object.freeze({
      ...base,
      NODE_ENV: 'test',
      SDAR_CONTROL_DATABASE_URL: 'postgresql://sdar_uap_control@127.0.0.1:55463/sdar_uap_control',
      SDAR_CONTROL_RUNTIME_DATABASE_URL: 'postgresql://sdar_uap@127.0.0.1:55462/sdar_uap',
      SDAR_CONTROL_API_HOST: '127.0.0.1',
      SDAR_CONTROL_API_PORT: '10091',
      SDAR_CONTROL_API_TOKEN: await privateToken(stateRoot, 'control-api.token'),
      SDAR_CONTROL_OPERATOR_API_TOKEN: await privateToken(stateRoot, 'control-operator-api.token'),
      SDAR_CONTROL_VIEWER_API_TOKEN: await privateToken(stateRoot, 'control-viewer-api.token'),
      SDAR_CONTROL_SECURITY_API_TOKEN: await privateToken(stateRoot, 'control-security-api.token'),
      SDAR_CONTROL_ORGANIZATION_API_TOKEN: await privateToken(
        stateRoot,
        'control-organization-api.token',
      ),
      SDAR_CONTROL_ORGANIZATION_TENANT_ID: 'uap-p3-b01',
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: await privateToken(
        stateRoot,
        'runtime-control-service.token',
      ),
      SDAR_CONTROL_NODE_ID: 'uap-p3-b01-node',
      SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'UAP P3 B01 external simulation',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
      SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:10998',
      SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1:10091',
      SDAR_CONTROL_NODE_EVENTS_URL: 'http://127.0.0.1:10091/api/v1/events',
      SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:10999/.well-known/agent-card.json',
      SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: '127.0.0.1:19131',
      SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: '127.0.0.1:18092',
      SDAR_CONTROL_PRIVATE_HTTP_ENDPOINT_ALLOWLIST: '',
      SDAR_CONTROL_ACKNOWLEDGE_PRIVATE_HTTP_ENDPOINTS: 'NO',
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'safe',
      SDAR_CONTROL_RATE_LIMIT_PER_MINUTE: '1200',
      SDAR_CONTROL_REQUEST_BODY_LIMIT_KB: '64',
    });
  if (name === 'node-control-worker')
    return Object.freeze({
      ...base,
      NODE_ENV: 'test',
      SDAR_CONTROL_DATABASE_URL: 'postgresql://sdar_uap_control@127.0.0.1:55463/sdar_uap_control',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'safe',
      SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: '127.0.0.1:18092',
      SDAR_CONTROL_WORKER_POLL_MS: '60000',
      SDAR_CONTROL_WORKER_ONCE: 'false',
    });
  if (name !== 'server') throw new UapSupervisorError('UAP_PROCESS_NAME_INVALID');
  const resolvedSideEffectSimulationRunId = await resolveSideEffectSimulationRunId(
    sideEffects,
    sideEffectSimulationRunId,
    { stateRoot, reportRoot },
  );
  const dotEnv = await validateDotEnv(dotEnvPath);
  const providerAuthorities = exactProviderAuthorities(dotEnv.values);
  return Object.freeze({
    ...base,
    NODE_ENV: 'test',
    SDAR_POSTGRES_URL: 'postgresql://sdar_uap@127.0.0.1:55462/sdar_uap',
    SDAR_REDIS_HOST: '127.0.0.1',
    SDAR_REDIS_PORT: '56391',
    SDAR_A2A_HOST: '127.0.0.1',
    SDAR_A2A_PORT: '10999',
    SDAR_A2A_WAIT_TIMEOUT_MS: '30000',
    SDAR_MANAGEMENT_HOST: '127.0.0.1',
    SDAR_MANAGEMENT_PORT: '10998',
    SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: await privateToken(
      stateRoot,
      'runtime-control-service.token',
    ),
    SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:10091',
    SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: await privateToken(
      stateRoot,
      'runtime-control-service.token',
    ),
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'safe',
    SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: '127.0.0.1:19131',
    SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: providerAuthorities.join(','),
    SDAR_MCP_LIVE_EXECUTION_MODE_HEADER: 'emit',
    SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN: await privateToken(
      stateRoot,
      'cognitive-management.token',
    ),
    SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: await privateToken(
      stateRoot,
      'artifact-management.token',
    ),
    SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'uap-p3-b01-bootstrap',
    SDAR_ARTIFACT_MANAGEMENT_TENANT_ID: 'uap-p3-b01',
    SDAR_ARTIFACT_MANAGEMENT_KIND: 'service',
    SDAR_ARTIFACT_MANAGEMENT_ROLES: 'administrator',
    SDAR_GOVERNED_CONTROL_BEARER_TOKEN: await privateToken(stateRoot, 'governed-control.token'),
    SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE: 'trusted_intranet',
    SDAR_GOVERNED_CONTROL_ACTOR_ID: 'uap-p3-b01-human-operator',
    SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm,physical_control.revoke',
    SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: 'false',
    BUSINESS_EVENTS_ENABLED: 'false',
    BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY: 'false',
    BUSINESS_EVENTS_POLL_INTERVAL_MS: '500',
    BUSINESS_EVENTS_MAX_SUBSCRIPTIONS: '256',
    UGV_TEST_TOLERANCE_M: '2',
    UGV_TEST_MINIMUM_DISPLACEMENT_M: '0.5',
    UGV_TEST_MAX_FINAL_STATE_AGE_MS: '3000',
    SDAR_TASK_UNDERSTANDING_PROFILE: 'ugv-agent-profile',
    ALLOW_UGV_SIMULATION_SIDE_EFFECTS: sideEffects,
    ...(resolvedSideEffectSimulationRunId === null
      ? {}
      : { UGV_SIMULATION_RUN_ID: resolvedSideEffectSimulationRunId }),
    ...ARTIFACT_FLAGS,
  });
}

async function offlineFixtureProcessEnvironment(
  name,
  sideEffects,
  sideEffectSimulationRunId,
  configuration,
) {
  if (!configuration.processSpecs.some((entry) => entry.name === name))
    throw new UapSupervisorError('UAP_PROCESS_NAME_INVALID');
  await configuration.initializeState();
  const environment = {
    NODE_ENV: 'test',
    SDAR_UAP_OFFLINE_SUPERVISOR_FIXTURE_CHILD:
      'I_ACKNOWLEDGE_INTERNAL_OFFLINE_HOST_PROCESS_SUPERVISOR_TEST_CHILD',
    SDAR_UAP_OFFLINE_SUPERVISOR_FIXTURE_PROCESS_NAME: name,
  };
  if (name !== 'server') return Object.freeze(environment);
  const resolvedSimulationRunId = await resolveConfiguredSideEffectSimulationRunId(
    sideEffects,
    sideEffectSimulationRunId,
    configuration,
  );
  return Object.freeze({
    ...environment,
    ALLOW_UGV_SIMULATION_SIDE_EFFECTS: sideEffects,
    ...(resolvedSimulationRunId === null ? {} : { UGV_SIMULATION_RUN_ID: resolvedSimulationRunId }),
  });
}

export async function resolveSideEffectSimulationRunId(
  sideEffects,
  requestedSimulationRunId,
  options = {},
) {
  if (sideEffects === 'NO') {
    if (requestedSimulationRunId !== undefined && requestedSimulationRunId !== null)
      throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_FORBIDDEN');
    return null;
  }
  if (sideEffects !== 'YES') throw new UapSupervisorError('UAP_SIDE_EFFECT_MODE_INVALID');
  if (
    typeof requestedSimulationRunId !== 'string' ||
    !B02_SIMULATION_RUN_ID.test(requestedSimulationRunId)
  )
    throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_REQUIRED');
  if (OFFLINE_FIXTURE_SIMULATION_RUN_ID.test(requestedSimulationRunId))
    throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_NOT_AUTHORIZED');
  try {
    await (options.authorizeSimulationId ?? authorizeB02SimulationId)(requestedSimulationRunId, {
      stateRoot: resolve(options.stateRoot ?? STATE_ROOT),
      reportRoot: resolve(options.reportRoot ?? REPORT_ROOT),
    });
  } catch {
    throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_NOT_AUTHORIZED');
  }
  return requestedSimulationRunId;
}

export async function startProcesses() {
  return startProcessesWithConfiguration(PRODUCTION_SUPERVISOR_CONFIGURATION);
}

async function startProcessesWithConfiguration(configuration) {
  return withLock(async () => {
    const state = await configuration.initializeState();
    await ensurePrivateDirectory(join(configuration.stateRoot, 'host-work'));
    await assertExecutableInputs(configuration);
    const existing = await optionalManifest(configuration);
    if (existing !== undefined) {
      await validateManifest(existing, { allowMissingProcesses: false }, configuration);
      return Object.freeze({
        status: 'already_running',
        processCount: 3,
        sideEffects: existing.sideEffects,
      });
    }
    const processes = [];
    let publishedManifest;
    try {
      for (const spec of configuration.processSpecs)
        processes.push(
          await spawnProcess(
            spec,
            spec.name === 'server' ? 'NO' : undefined,
            undefined,
            configuration,
          ),
        );
      const manifest = Object.freeze({
        schemaVersion: 'sdar.ugv-agent-profile.host-processes/v1',
        bootstrapRunId: state.bootstrapRunId,
        simulationRunId: state.simulationRunId,
        sideEffectSimulationRunId: null,
        revision: 1,
        sideEffects: 'NO',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        processes: Object.freeze(processes),
      });
      await publishManifestFirstWriter(manifest, configuration);
      publishedManifest = manifest;
      await validateManifest(manifest, { allowMissingProcesses: false }, configuration);
      return Object.freeze({ status: 'started', processCount: 3, sideEffects: 'NO' });
    } catch (error) {
      await stopEntries([...processes].reverse(), configuration);
      if (publishedManifest !== undefined)
        await cleanupPublishedManifest(publishedManifest, {
          read: () => requireManifest(configuration),
          remove: () => unlinkPrivateManifest(configuration),
        });
      throw error;
    }
  }, configuration);
}

export async function processStatus() {
  return processStatusWithConfiguration(PRODUCTION_SUPERVISOR_CONFIGURATION);
}

async function processStatusWithConfiguration(configuration) {
  const manifest = await requireManifest(configuration);
  await validateManifest(manifest, { allowMissingProcesses: false }, configuration);
  const identities = processIdentityHashes(manifest.processes);
  return Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.host-process-status/v2',
    status: 'running',
    processCount: manifest.processes.length,
    sideEffects: manifest.sideEffects,
    bootstrapRunId: manifest.bootstrapRunId,
    manifestRevision: manifest.revision,
    activeSimulationRunId: manifest.sideEffectSimulationRunId ?? null,
    processIdentitySha256: identities,
  });
}

export async function stopProcesses() {
  return stopProcessesWithConfiguration(PRODUCTION_SUPERVISOR_CONFIGURATION);
}

async function stopProcessesWithConfiguration(configuration) {
  return withLock(async () => {
    const manifest = await optionalManifest(configuration);
    if (manifest === undefined)
      return Object.freeze({ status: 'already_stopped', processCount: 0 });
    await validateManifest(manifest, { allowMissingProcesses: true }, configuration);
    await stopEntries([...manifest.processes].reverse(), configuration);
    await unlinkPrivateManifest(configuration);
    return Object.freeze({ status: 'stopped', processCount: manifest.processes.length });
  }, configuration);
}

export async function restartServer(sideEffects, acknowledgement, requestedSimulationRunId) {
  return restartServerWithConfiguration(
    sideEffects,
    acknowledgement,
    requestedSimulationRunId,
    PRODUCTION_SUPERVISOR_CONFIGURATION,
  );
}

async function restartServerWithConfiguration(
  sideEffects,
  acknowledgement,
  requestedSimulationRunId,
  configuration,
) {
  if (sideEffects !== 'NO' && sideEffects !== 'YES')
    throw new UapSupervisorError('UAP_SIDE_EFFECT_MODE_INVALID');
  if (sideEffects === 'NO' && acknowledgement !== undefined)
    throw new UapSupervisorError('UAP_SIDE_EFFECT_ACKNOWLEDGEMENT_FORBIDDEN');
  if (
    sideEffects === 'YES' &&
    acknowledgement !== 'I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS'
  )
    throw new UapSupervisorError('UAP_SIDE_EFFECT_ACKNOWLEDGEMENT_REQUIRED');
  return withLock(async () => {
    const targetSimulationRunId = await resolveConfiguredSideEffectSimulationRunId(
      sideEffects,
      requestedSimulationRunId,
      configuration,
    );
    const manifest = await requireManifest(configuration);
    await validateManifest(manifest, { allowMissingProcesses: false }, configuration);
    const currentSimulationRunId = manifest.sideEffectSimulationRunId ?? null;
    if (manifest.sideEffects === sideEffects && currentSimulationRunId === targetSimulationRunId)
      return Object.freeze({ status: 'already_running', processCount: 3, sideEffects });
    if (manifest.sideEffects === 'YES' && sideEffects === 'YES')
      throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_CONFLICT');
    const serverSpec = configuration.processSpecs.find((entry) => entry.name === 'server');
    if (serverSpec === undefined) throw new UapSupervisorError('UAP_PROCESS_SPEC_INVALID');
    return transactionalRestartServer(manifest, sideEffects, targetSimulationRunId, {
      stop: (entries) => stopEntries(entries, configuration),
      spawn: (mode, simulationRunId) =>
        spawnProcess(serverSpec, mode, simulationRunId, configuration),
      readManifest: () => requireManifest(configuration),
      replaceManifest: (prior, next) => replaceManifest(prior, next, configuration),
      validate: (value) => validateManifest(value, { allowMissingProcesses: false }, configuration),
      now: () => new Date().toISOString(),
    });
  }, configuration);
}

async function resolveConfiguredSideEffectSimulationRunId(
  sideEffects,
  requestedSimulationRunId,
  configuration,
) {
  if (configuration.kind === 'production')
    return resolveSideEffectSimulationRunId(sideEffects, requestedSimulationRunId, {
      stateRoot: configuration.stateRoot,
      reportRoot: configuration.reportRoot,
      authorizeSimulationId: configuration.authorizeSimulationId,
    });
  if (sideEffects === 'NO') {
    if (requestedSimulationRunId !== undefined && requestedSimulationRunId !== null)
      throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_FORBIDDEN');
    return null;
  }
  if (
    sideEffects !== 'YES' ||
    typeof requestedSimulationRunId !== 'string' ||
    !OFFLINE_FIXTURE_SIMULATION_RUN_ID.test(requestedSimulationRunId)
  )
    throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_REQUIRED');
  try {
    await configuration.authorizeSimulationId(requestedSimulationRunId);
  } catch {
    throw new UapSupervisorError('UAP_SIDE_EFFECT_SIMULATION_ID_NOT_AUTHORIZED');
  }
  return requestedSimulationRunId;
}

export async function transactionalRestartServer(
  manifest,
  sideEffects,
  sideEffectSimulationRunId,
  dependencies,
) {
  const server = manifest.processes.find((entry) => entry.name === 'server');
  if (server === undefined) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  await dependencies.stop([server]);
  let replacement;
  let next;
  try {
    replacement = await dependencies.spawn(sideEffects, sideEffectSimulationRunId);
    next = Object.freeze({
      ...manifest,
      revision: manifest.revision + 1,
      sideEffects,
      sideEffectSimulationRunId,
      updatedAt: dependencies.now(),
      processes: Object.freeze(
        manifest.processes.map((entry) => (entry.name === 'server' ? replacement : entry)),
      ),
    });
    await dependencies.replaceManifest(manifest, next);
    await dependencies.validate(next);
    return Object.freeze({ status: 'restarted', processCount: 3, sideEffects });
  } catch (error) {
    if (replacement !== undefined) {
      try {
        await dependencies.stop([replacement]);
      } catch {
        throw new UapSupervisorError('UAP_SERVER_RESTART_ROLLBACK_FAILED');
      }
    }
    let restoredServer;
    const restoredSideEffects = sideEffects === 'NO' ? 'NO' : manifest.sideEffects;
    const restoredSimulationRunId =
      restoredSideEffects === 'YES' ? manifest.sideEffectSimulationRunId : null;
    try {
      restoredServer = await dependencies.spawn(restoredSideEffects, restoredSimulationRunId);
      const current = await dependencies.readManifest();
      if (
        JSON.stringify(current) !== JSON.stringify(manifest) &&
        (next === undefined || JSON.stringify(current) !== JSON.stringify(next))
      ) {
        await dependencies.stop([restoredServer]);
        throw new UapSupervisorError('UAP_PROCESS_MANIFEST_DRIFT');
      }
      const restored = Object.freeze({
        ...manifest,
        revision: current.revision + 1,
        sideEffects: restoredSideEffects,
        sideEffectSimulationRunId: restoredSimulationRunId,
        updatedAt: dependencies.now(),
        processes: Object.freeze(
          current.processes.map((entry) => (entry.name === 'server' ? restoredServer : entry)),
        ),
      });
      await dependencies.replaceManifest(current, restored);
      await dependencies.validate(restored);
    } catch (rollbackError) {
      if (restoredServer !== undefined)
        await dependencies.stop([restoredServer]).catch(() => undefined);
      void rollbackError;
      throw new UapSupervisorError('UAP_SERVER_RESTART_ROLLBACK_FAILED');
    }
    throw error;
  }
}

export async function processLogFiles(allowMissingProcesses = false) {
  return processLogFilesWithConfiguration(
    allowMissingProcesses,
    PRODUCTION_SUPERVISOR_CONFIGURATION,
  );
}

async function processLogFilesWithConfiguration(allowMissingProcesses, configuration) {
  if (allowMissingProcesses) return listPrivateLogFiles(join(configuration.stateRoot, 'logs'));
  const manifest = await requireManifest(configuration);
  await validateManifest(manifest, { allowMissingProcesses: false }, configuration);
  return Object.freeze(manifest.processes.map((entry) => entry.logFile));
}

export async function listPrivateLogFiles(logsRoot) {
  let entries;
  try {
    const status = await lstat(logsRoot);
    if (
      status.isSymbolicLink() ||
      !status.isDirectory() ||
      (status.mode & 0o777) !== 0o700 ||
      (process.getuid !== undefined && status.uid !== process.getuid())
    )
      throw new UapSupervisorError('UAP_HOST_LOG_CLOSURE_INVALID');
    entries = await readdir(logsRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return Object.freeze([]);
    if (error instanceof UapSupervisorError) throw error;
    throw new UapSupervisorError('UAP_HOST_LOG_CLOSURE_INVALID');
  }
  const paths = [];
  for (const name of entries.sort()) {
    if (
      name === '' ||
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      containsControlCharacter(name)
    )
      throw new UapSupervisorError('UAP_HOST_LOG_CLOSURE_INVALID');
    const path = join(logsRoot, name);
    const status = await lstat(path);
    if (
      status.isSymbolicLink() ||
      !status.isFile() ||
      (status.mode & 0o777) !== 0o600 ||
      status.size > 8 * 1024 * 1024 ||
      (process.getuid !== undefined && status.uid !== process.getuid())
    )
      throw new UapSupervisorError('UAP_HOST_LOG_CLOSURE_INVALID');
    paths.push(path);
  }
  return Object.freeze(paths);
}

function containsControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

async function spawnProcess(spec, sideEffects, sideEffectSimulationRunId, configuration) {
  if (spec === undefined) throw new UapSupervisorError('UAP_PROCESS_SPEC_INVALID');
  const logFile = join(
    configuration.stateRoot,
    'logs',
    `${spec.name}-${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomBytes(6).toString('hex')}.jsonl`,
  );
  const handle = await open(logFile, 'wx', 0o600);
  let child;
  let candidate;
  try {
    const environment = await configuration.processEnvironment(
      spec.name,
      sideEffects ?? 'NO',
      sideEffectSimulationRunId,
    );
    const command = configuration.spawnCommand(spec);
    child = spawn(command.executable, command.arguments, {
      cwd: spec.cwd,
      env: environment,
      detached: true,
      stdio: ['ignore', handle.fd, handle.fd],
    });
    if (child.pid === undefined) throw new UapSupervisorError('UAP_PROCESS_SPAWN_FAILED');
    child.unref();
  } finally {
    await handle.close();
  }
  const pid = child.pid;
  try {
    const observed = await waitForExactIdentity(pid, spec, configuration);
    candidate = Object.freeze({
      name: spec.name,
      pid,
      startTicks: observed.startTicks,
      uid: observed.uid,
      processGroupId: observed.processGroupId,
      sessionId: observed.sessionId,
      entrypoint: spec.entrypoint,
      cwd: spec.cwd,
      logFile,
    });
    await validateProcessEntry(candidate, false, false, configuration);
    const readyAt = await waitForReadiness(candidate, configuration);
    const entry = Object.freeze({ ...candidate, readyAt });
    await validateProcessEntry(entry, false, true, configuration);
    await configuration.assertProcessLogSafe(logFile);
    return entry;
  } catch (error) {
    let logFailure;
    try {
      await configuration.assertProcessLogSafe(logFile);
    } catch (scanError) {
      logFailure = scanError;
    }
    if (candidate === undefined) throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
    await rollbackSpawnedCandidate(candidate);
    if (logFailure !== undefined) throw logFailure;
    throw error;
  }
}

export async function rollbackSpawnedCandidate(
  candidate,
  dependencies = {
    inspect: inspectProcess,
    group: inspectOwnedProcessGroup,
    signal: signalProcessGroup,
    wait: waitForGroupExit,
  },
) {
  if (
    !Number.isSafeInteger(candidate?.pid) ||
    candidate.pid < 2 ||
    typeof candidate?.startTicks !== 'string' ||
    !/^[0-9]+$/u.test(candidate.startTicks) ||
    candidate.uid !== Number(process.getuid?.() ?? 0) ||
    candidate.processGroupId !== candidate.pid ||
    candidate.sessionId !== candidate.pid
  )
    throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
  const observed = await dependencies.inspect(candidate.pid);
  if (observed === undefined || !candidateIdentityAnchorMatches(candidate, observed))
    throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
  const members = await dependencies.group(candidate);
  if (members.length === 0) return;
  if (
    members.some(
      (member) =>
        member.uid !== candidate.uid ||
        member.processGroupId !== candidate.processGroupId ||
        member.sessionId !== candidate.sessionId,
    )
  )
    throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
  await dependencies.signal(candidate, 'SIGTERM');
  let exited = await dependencies.wait(candidate, 2_000);
  if (!exited) {
    const remainingMembers = await dependencies.group(candidate);
    if (remainingMembers.length === 0) return;
    const beforeKill = await dependencies.inspect(candidate.pid);
    if (beforeKill === undefined || !candidateIdentityAnchorMatches(candidate, beforeKill))
      throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
    await dependencies.signal(candidate, 'SIGKILL');
    exited = await dependencies.wait(candidate, 2_000);
  }
  if (!exited) throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
}

function candidateIdentityAnchorMatches(candidate, observed) {
  return (
    observed.startTicks === candidate.startTicks &&
    observed.uid === candidate.uid &&
    candidate.uid === Number(process.getuid?.() ?? 0) &&
    observed.processGroupId === candidate.pid &&
    observed.sessionId === candidate.pid &&
    candidate.processGroupId === candidate.pid &&
    candidate.sessionId === candidate.pid
  );
}

async function waitForExactIdentity(pid, spec, configuration) {
  const command = configuration.spawnCommand(spec);
  const expectedArguments = [command.executable, ...command.arguments];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const observed = await inspectProcess(pid);
    if (observed === undefined) {
      await delay(25);
      continue;
    }
    if (
      observed.uid === Number(process.getuid?.() ?? 0) &&
      observed.processGroupId === pid &&
      observed.sessionId === pid &&
      observed.cwd === spec.cwd &&
      observed.argv.length === expectedArguments.length &&
      observed.argv.every((value, index) => value === expectedArguments[index])
    )
      return observed;
    await delay(25);
  }
  throw new UapSupervisorError('UAP_PROCESS_IDENTITY_MISMATCH');
}

async function waitForReadiness(entry, configuration) {
  const deadline = Date.now() + configuration.readinessTimeoutMs;
  while (Date.now() <= deadline) {
    await validateProcessEntry(entry, false, false, configuration);
    const source = await readPrivateFile(entry.logFile, 8 * 1024 * 1024);
    const readyEventObserved = source.split(/\r?\n/u).some((line) => {
      try {
        return JSON.parse(line)?.event === configuration.readinessEvents[entry.name];
      } catch {
        return false;
      }
    });
    if (readyEventObserved) {
      const healthUrl = configuration.healthUrls[entry.name];
      if (healthUrl === undefined || (await healthReady(healthUrl)))
        return new Date().toISOString();
    }
    await delay(configuration.readinessPollMs);
  }
  throw new UapSupervisorError('UAP_PROCESS_READINESS_TIMEOUT');
}

async function healthReady(url) {
  try {
    const response = await globalThis.fetch(url, {
      headers: { accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(2_000),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function assertProcessLogSafe(logFile) {
  const [dotEnv, taskSecrets, source] = await Promise.all([
    validateDotEnv(),
    taskOwnedCredentialMaterial(),
    readPrivateFile(logFile, 8 * 1024 * 1024),
  ]);
  assertPrivateProcessLogSafe(source, dotEnv.values, [...dotEnv.secretValues, ...taskSecrets]);
}

async function assertOfflineFixtureProcessLogSafe(logFile) {
  const source = await readPrivateFile(logFile, 8 * 1024 * 1024);
  const lines = source.split(/\r?\n/u).filter((line) => line !== '');
  if (lines.length !== 1) throw new UapSupervisorError('UAP_PROCESS_LOG_SAFETY_INVALID');
  let event;
  try {
    event = JSON.parse(lines[0]);
  } catch {
    throw new UapSupervisorError('UAP_PROCESS_LOG_SAFETY_INVALID');
  }
  if (
    typeof event !== 'object' ||
    event === null ||
    Array.isArray(event) ||
    Object.keys(event).sort().join(',') !== ['event', 'processName', 'secretsIncluded'].join(',') ||
    !['server', 'node-control-api', 'node-control-worker'].includes(event.processName) ||
    event.event !== `offline_fixture.${String(event.processName)}.ready` ||
    event.secretsIncluded !== false ||
    source.includes('ALLOW_UGV_SIMULATION_SIDE_EFFECTS') ||
    source.includes('UGV_SIMULATION_RUN_ID')
  )
    throw new UapSupervisorError('UAP_PROCESS_LOG_SAFETY_INVALID');
}

async function validateManifest(manifest, { allowMissingProcesses }, configuration) {
  const state = await configuration.initializeState();
  if (
    manifest?.schemaVersion !== 'sdar.ugv-agent-profile.host-processes/v1' ||
    manifest.bootstrapRunId !== state.bootstrapRunId ||
    manifest.simulationRunId !== state.simulationRunId ||
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 1 ||
    !['NO', 'YES'].includes(manifest.sideEffects) ||
    !Array.isArray(manifest.processes) ||
    manifest.processes.length !== configuration.processSpecs.length ||
    manifest.processes.some(
      (entry, index) => entry?.name !== configuration.processSpecs[index]?.name,
    )
  )
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  const sideEffectSimulationRunId = await validateManifestSideEffectSimulationIdentity(
    manifest,
    state,
  );
  for (const entry of manifest.processes)
    await validateProcessEntry(entry, allowMissingProcesses, true, configuration);
  for (const entry of manifest.processes) {
    const dependencies = {
      validateEntry: (candidate) => validateProcessEntry(candidate, false, false, configuration),
      ...(entry.name === 'server' &&
      manifest.sideEffects === 'NO' &&
      !Object.hasOwn(manifest, 'sideEffectSimulationRunId')
        ? { legacyNoSimulationRunId: state.simulationRunId }
        : {}),
    };
    await validateProcessSafetyEnvironment(
      entry,
      entry.name === 'server' ? manifest.sideEffects : undefined,
      entry.name === 'server' ? sideEffectSimulationRunId : undefined,
      dependencies,
    );
  }
  return manifest;
}

export async function validateManifestSideEffectSimulationIdentity(manifest, state) {
  if (manifest.simulationRunId !== state.simulationRunId)
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  const hasProjection = Object.hasOwn(manifest, 'sideEffectSimulationRunId');
  if (!hasProjection) {
    if (manifest.sideEffects !== 'NO') throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
    return null;
  }
  const active = manifest.sideEffectSimulationRunId;
  if (manifest.sideEffects === 'NO') {
    if (active !== null) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
    return null;
  }
  if (
    manifest.sideEffects !== 'YES' ||
    typeof active !== 'string' ||
    !B02_SIMULATION_RUN_ID.test(active)
  )
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  return active;
}

export async function readProcessSafetyEnvironment(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2)
    throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
  let source;
  try {
    source = await readFile(`/proc/${String(pid)}/environ`);
  } catch {
    throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
  }
  return parseProcessSafetyEnvironment(source);
}

export function parseProcessSafetyEnvironment(source) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (bytes.byteLength > 1024 * 1024)
    throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
  const selected = {
    allowSideEffects: undefined,
    simulationRunId: undefined,
  };
  const observed = new Set();
  for (const entry of bytes.toString('utf8').split('\0')) {
    if (entry === '') continue;
    const separator = entry.indexOf('=');
    if (separator < 1) {
      if (entry === 'ALLOW_UGV_SIMULATION_SIDE_EFFECTS' || entry === 'UGV_SIMULATION_RUN_ID')
        throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
      continue;
    }
    const name = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (name !== 'ALLOW_UGV_SIMULATION_SIDE_EFFECTS' && name !== 'UGV_SIMULATION_RUN_ID') continue;
    if (observed.has(name)) throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
    observed.add(name);
    if (name === 'ALLOW_UGV_SIMULATION_SIDE_EFFECTS') selected.allowSideEffects = value;
    else selected.simulationRunId = value;
  }
  return Object.freeze(selected);
}

export async function validateProcessSafetyEnvironment(
  entry,
  expectedSideEffects,
  expectedSimulationRunId,
  dependencies = {},
) {
  const readSafetyEnvironment = dependencies.readSafetyEnvironment ?? readProcessSafetyEnvironment;
  const safetyEnvironment = await readSafetyEnvironment(entry.pid);
  if (entry.name === 'server') {
    const noSimulationRunIdAccepted =
      safetyEnvironment.simulationRunId === undefined ||
      (typeof dependencies.legacyNoSimulationRunId === 'string' &&
        safetyEnvironment.simulationRunId === dependencies.legacyNoSimulationRunId);
    if (
      !['NO', 'YES'].includes(expectedSideEffects) ||
      safetyEnvironment.allowSideEffects !== expectedSideEffects ||
      (expectedSideEffects === 'NO' && !noSimulationRunIdAccepted) ||
      (expectedSideEffects === 'YES' &&
        safetyEnvironment.simulationRunId !== expectedSimulationRunId)
    )
      throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
  } else if (
    safetyEnvironment.allowSideEffects !== undefined ||
    safetyEnvironment.simulationRunId !== undefined
  )
    throw new UapSupervisorError('UAP_PROCESS_ENVIRONMENT_INVALID');
  const validateEntry =
    dependencies.validateEntry ??
    ((candidate) =>
      validateProcessEntry(candidate, false, false, PRODUCTION_SUPERVISOR_CONFIGURATION));
  await validateEntry(entry);
  return true;
}

function processIdentityHashes(entries) {
  const identities = Object.fromEntries(
    entries.map((entry) => [entry.name, processIdentityHash(entry)]),
  );
  if (
    typeof identities.server !== 'string' ||
    typeof identities['node-control-api'] !== 'string' ||
    typeof identities['node-control-worker'] !== 'string'
  )
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  return Object.freeze({
    server: identities.server,
    nodeControlApi: identities['node-control-api'],
    nodeControlWorker: identities['node-control-worker'],
  });
}

function processIdentityHash(entry) {
  const identity = {
    name: entry.name,
    pid: entry.pid,
    startTicks: entry.startTicks,
    uid: entry.uid,
    processGroupId: entry.processGroupId,
    sessionId: entry.sessionId,
    entrypoint: entry.entrypoint,
    cwd: entry.cwd,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

async function validateProcessEntry(entry, allowMissing, requireReady, configuration) {
  const spec = configuration.processSpecs.find((candidate) => candidate.name === entry?.name);
  const command = spec === undefined ? undefined : configuration.spawnCommand(spec);
  const expectedArguments = command === undefined ? [] : [command.executable, ...command.arguments];
  if (
    spec === undefined ||
    !Number.isSafeInteger(entry.pid) ||
    entry.pid < 2 ||
    typeof entry.startTicks !== 'string' ||
    !/^[0-9]+$/u.test(entry.startTicks) ||
    entry.uid !== Number(process.getuid?.() ?? 0) ||
    entry.processGroupId !== entry.pid ||
    entry.sessionId !== entry.pid ||
    entry.entrypoint !== spec.entrypoint ||
    entry.cwd !== spec.cwd ||
    typeof entry.logFile !== 'string' ||
    !resolve(entry.logFile).startsWith(`${resolve(configuration.stateRoot, 'logs')}/`) ||
    (requireReady &&
      (typeof entry.readyAt !== 'string' || !Number.isFinite(Date.parse(entry.readyAt))))
  )
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  const observed = await inspectProcess(entry.pid);
  if (observed === undefined) {
    if (allowMissing) throw new UapSupervisorError('UAP_PROCESS_ORPHAN_RISK');
    throw new UapSupervisorError('UAP_PROCESS_NOT_RUNNING');
  }
  if (
    observed.startTicks !== entry.startTicks ||
    observed.uid !== entry.uid ||
    observed.processGroupId !== entry.processGroupId ||
    observed.sessionId !== entry.sessionId ||
    observed.cwd !== spec.cwd ||
    observed.argv.length !== expectedArguments.length ||
    observed.argv.some((value, index) => value !== expectedArguments[index])
  )
    throw new UapSupervisorError('UAP_PROCESS_IDENTITY_MISMATCH');
  return true;
}

async function inspectProcess(pid) {
  try {
    const [stat, cmdline, cwd, status] = await Promise.all([
      readFile(`/proc/${String(pid)}/stat`, 'utf8'),
      readFile(`/proc/${String(pid)}/cmdline`, 'utf8'),
      readlink(`/proc/${String(pid)}/cwd`),
      readFile(`/proc/${String(pid)}/status`, 'utf8'),
    ]);
    const close = stat.lastIndexOf(') ');
    const fields =
      close < 0
        ? []
        : stat
            .slice(close + 2)
            .trim()
            .split(/\s+/u);
    const startTicks = fields[19];
    const processGroupId = Number(fields[2]);
    const sessionId = Number(fields[3]);
    const uidMatch = /^Uid:\s+([0-9]+)\s/mu.exec(status);
    const uid = uidMatch?.[1] === undefined ? Number.NaN : Number(uidMatch[1]);
    if (
      startTicks === undefined ||
      !/^[0-9]+$/u.test(startTicks) ||
      !Number.isSafeInteger(processGroupId) ||
      !Number.isSafeInteger(sessionId) ||
      !Number.isSafeInteger(uid)
    )
      throw new UapSupervisorError('UAP_PROCESS_INSPECTION_FAILED');
    return Object.freeze({
      startTicks,
      uid,
      processGroupId,
      sessionId,
      argv: Object.freeze(cmdline.split('\0').filter((value) => value !== '')),
      cwd: resolve(cwd),
    });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    if (error instanceof UapSupervisorError) throw error;
    throw new UapSupervisorError('UAP_PROCESS_INSPECTION_FAILED');
  }
}

async function stopEntries(entries, configuration) {
  const live = [];
  for (const entry of entries)
    if (await validateProcessEntry(entry, true, true, configuration)) live.push(entry);
  for (const entry of live) await signalProcessGroup(entry, 'SIGTERM');
  const remaining = [];
  for (const entry of live) if (!(await waitForGroupExit(entry, 10_000))) remaining.push(entry);
  for (const entry of remaining) await signalProcessGroup(entry, 'SIGKILL');
  for (const entry of remaining)
    if (!(await waitForGroupExit(entry, 5_000)))
      throw new UapSupervisorError('UAP_PROCESS_STOP_TIMEOUT');
}

async function signalProcessGroup(entry, signal) {
  const members = await inspectOwnedProcessGroup(entry);
  if (members.length === 0) return;
  try {
    process.kill(-entry.processGroupId, signal);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ESRCH')
      throw new UapSupervisorError('UAP_PROCESS_SIGNAL_FAILED');
  }
}

async function waitForGroupExit(entry, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await inspectOwnedProcessGroup(entry)).length === 0) return true;
    await delay(100);
  }
  return (await inspectOwnedProcessGroup(entry)).length === 0;
}

async function inspectOwnedProcessGroup(entry) {
  let names;
  try {
    names = await readdir('/proc');
  } catch {
    throw new UapSupervisorError('UAP_PROCESS_INSPECTION_FAILED');
  }
  const members = [];
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    const observed = await inspectProcessMembership(Number(name), entry.processGroupId);
    if (observed === undefined) continue;
    if (observed.uid !== entry.uid || observed.sessionId !== entry.sessionId)
      throw new UapSupervisorError('UAP_PROCESS_IDENTITY_MISMATCH');
    members.push(Object.freeze({ pid: Number(name), ...observed }));
  }
  const leader = members.find((member) => member.pid === entry.pid);
  if (leader !== undefined && !candidateIdentityAnchorMatches(entry, leader))
    throw new UapSupervisorError('UAP_PROCESS_IDENTITY_MISMATCH');
  return Object.freeze(members);
}

async function inspectProcessMembership(pid, expectedProcessGroupId) {
  let stat;
  try {
    stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8');
  } catch (error) {
    if (isNodeError(error) && new Set(['ENOENT', 'EACCES', 'EPERM']).has(error.code))
      return undefined;
    throw new UapSupervisorError('UAP_PROCESS_INSPECTION_FAILED');
  }
  const close = stat.lastIndexOf(') ');
  const fields =
    close < 0
      ? []
      : stat
          .slice(close + 2)
          .trim()
          .split(/\s+/u);
  const processGroupId = Number(fields[2]);
  if (processGroupId !== expectedProcessGroupId) return undefined;
  const sessionId = Number(fields[3]);
  const startTicks = fields[19];
  let status;
  try {
    status = await readFile(`/proc/${String(pid)}/status`, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw new UapSupervisorError('UAP_PROCESS_INSPECTION_FAILED');
  }
  const uidMatch = /^Uid:\s+([0-9]+)\s/mu.exec(status);
  const uid = uidMatch?.[1] === undefined ? Number.NaN : Number(uidMatch[1]);
  if (
    startTicks === undefined ||
    !/^[0-9]+$/u.test(startTicks) ||
    !Number.isSafeInteger(sessionId) ||
    !Number.isSafeInteger(uid)
  )
    throw new UapSupervisorError('UAP_PROCESS_INSPECTION_FAILED');
  return Object.freeze({ startTicks, uid, processGroupId, sessionId });
}

async function privateToken(stateRoot, name) {
  const value = (await readPrivateFile(resolve(stateRoot, name), 8_192)).trim();
  if (!/^[A-Za-z0-9_-]{40,128}$/u.test(value))
    throw new UapSupervisorError('UAP_PRIVATE_TOKEN_INVALID');
  return value;
}

async function readPrivateFile(path, maximumBytes) {
  const status = await lstat(path);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    status.size > maximumBytes ||
    (process.getuid !== undefined && status.uid !== process.getuid())
  )
    throw new UapSupervisorError('UAP_PRIVATE_FILE_INVALID');
  return readFile(path, 'utf8');
}

async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const status = await lstat(path);
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    (process.getuid !== undefined && status.uid !== process.getuid())
  )
    throw new UapSupervisorError('UAP_PRIVATE_DIRECTORY_INVALID');
  await chmod(path, 0o700);
}

async function assertExecutableInputs(configuration) {
  for (const path of configuration.executableInputs) {
    const status = await lstat(path);
    if (status.isSymbolicLink() || !status.isFile())
      throw new UapSupervisorError('UAP_PROCESS_ENTRYPOINT_INVALID');
  }
}

async function requireManifest(configuration) {
  const value = await optionalManifest(configuration);
  if (value === undefined) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_REQUIRED');
  return value;
}

async function optionalManifest(configuration) {
  try {
    return JSON.parse(await readPrivateFile(configuration.manifestPath, 262_144));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
    throw error;
  }
}

async function publishManifestFirstWriter(manifest, configuration) {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const temporary = `${configuration.manifestPath}.${String(process.pid)}.${randomBytes(8).toString('hex')}.candidate`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    try {
      await link(temporary, configuration.manifestPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      throw new UapSupervisorError('UAP_PROCESS_MANIFEST_ALREADY_EXISTS');
    }
  } finally {
    await unlink(temporary).catch((error) => {
      if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
    });
  }
}

async function replaceManifest(prior, next, configuration) {
  const current = await requireManifest(configuration);
  if (JSON.stringify(current) !== JSON.stringify(prior))
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_DRIFT');
  const temporary = `${configuration.manifestPath}.${String(process.pid)}.${randomBytes(8).toString('hex')}.next`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(temporary, 0o600);
  await rename(temporary, configuration.manifestPath);
}

async function unlinkPrivateManifest(configuration) {
  await readPrivateFile(configuration.manifestPath, 262_144);
  await unlink(configuration.manifestPath);
}

export async function cleanupPublishedManifest(
  expected,
  dependencies = {
    read: () => requireManifest(PRODUCTION_SUPERVISOR_CONFIGURATION),
    remove: () => unlinkPrivateManifest(PRODUCTION_SUPERVISOR_CONFIGURATION),
  },
) {
  const current = await dependencies.read();
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_DRIFT');
  await dependencies.remove();
}

async function withLock(action, configuration) {
  await configuration.initializeState();
  const anchor = await acquireLock(configuration);
  try {
    return await action();
  } finally {
    await releaseAtomicLock(anchor);
  }
}

async function acquireLock(configuration) {
  const observed = await inspectProcess(process.pid);
  if (observed === undefined || observed.uid !== Number(process.getuid?.() ?? 0))
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  const prepared = await prepareAtomicLockCandidate(configuration.lockPath, {
    schemaVersion: 'sdar.ugv-agent-profile.supervisor-lock/v1',
    pid: process.pid,
    uid: observed.uid,
    startTicks: observed.startTicks,
  });
  try {
    return await publishAtomicLockCandidate(configuration.lockPath, prepared);
  } catch (error) {
    await unlink(prepared.candidatePath).catch((unlinkError) => {
      if (!isNodeError(unlinkError) || unlinkError.code !== 'ENOENT') throw unlinkError;
    });
    throw error;
  }
}

export async function prepareAtomicLockCandidate(lockPath, ownerBase) {
  if (!validLockOwnerBase(ownerBase)) throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  const nonce = randomBytes(16).toString('hex');
  const owner = Object.freeze({ ...ownerBase, nonce });
  const candidatePath = `${resolve(lockPath)}.${String(owner.pid)}.${nonce}.candidate`;
  await writeFile(candidatePath, `${JSON.stringify(owner)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(candidatePath, 0o600);
  await assertLockFile(candidatePath, owner, false);
  return Object.freeze({ owner, candidatePath });
}

export async function publishAtomicLockCandidate(
  lockPath,
  prepared,
  dependencies = { isOwnerLive: lockOwnerIsLive },
) {
  const target = resolve(lockPath);
  await assertLockFile(prepared?.candidatePath, prepared?.owner, false);
  try {
    await link(prepared.candidatePath, target);
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
    let existing;
    try {
      existing = await readLockFile(target, true);
    } catch (readError) {
      if (isNodeError(readError) && readError.code === 'ENOENT')
        throw new UapSupervisorError('UAP_SUPERVISOR_LOCKED');
      throw readError;
    }
    if (await dependencies.isOwnerLive(existing.owner))
      throw new UapSupervisorError('UAP_SUPERVISOR_LOCKED');
    throw new UapSupervisorError('UAP_SUPERVISOR_STALE_LOCK_MANUAL_RECOVERY_REQUIRED');
  }
  const candidateStatus = await assertLockFile(prepared.candidatePath, prepared.owner, true);
  const lockStatus = await assertLockFile(target, prepared.owner, true);
  if (
    candidateStatus.dev !== lockStatus.dev ||
    candidateStatus.ino !== lockStatus.ino ||
    candidateStatus.nlink < 2 ||
    lockStatus.nlink < 2
  )
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  return Object.freeze({
    owner: prepared.owner,
    candidatePath: prepared.candidatePath,
    lockPath: target,
    device: lockStatus.dev,
    inode: lockStatus.ino,
  });
}

export async function releaseAtomicLock(anchor) {
  const candidateStatus = await assertLockFile(anchor?.candidatePath, anchor?.owner, true);
  const lockStatus = await assertLockFile(anchor?.lockPath, anchor?.owner, true);
  if (
    candidateStatus.dev !== anchor?.device ||
    candidateStatus.ino !== anchor?.inode ||
    lockStatus.dev !== anchor?.device ||
    lockStatus.ino !== anchor?.inode ||
    candidateStatus.dev !== lockStatus.dev ||
    candidateStatus.ino !== lockStatus.ino
  )
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  await unlink(anchor.lockPath);
  await unlink(anchor.candidatePath);
}

async function lockOwnerIsLive(owner) {
  const observed = await inspectProcess(owner.pid);
  return (
    observed !== undefined && observed.uid === owner.uid && observed.startTicks === owner.startTicks
  );
}

function validLockOwnerBase(value) {
  return (
    value?.schemaVersion === 'sdar.ugv-agent-profile.supervisor-lock/v1' &&
    Object.keys(value).sort().join(',') ===
      ['pid', 'schemaVersion', 'startTicks', 'uid'].join(',') &&
    Number.isSafeInteger(value.pid) &&
    value.pid >= 2 &&
    value.uid === Number(process.getuid?.() ?? 0) &&
    typeof value.startTicks === 'string' &&
    /^[0-9]+$/u.test(value.startTicks)
  );
}

function validLockOwner(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      ['nonce', 'pid', 'schemaVersion', 'startTicks', 'uid'].join(',')
  )
    return false;
  const { nonce, ...base } = value;
  return validLockOwnerBase(base) && typeof nonce === 'string' && /^[a-f0-9]{32}$/u.test(nonce);
}

async function readLockFile(path, requireHardLink) {
  let status;
  let owner;
  try {
    status = await lstat(path);
    owner = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') throw error;
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  }
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    (status.mode & 0o777) !== 0o600 ||
    status.size < 1 ||
    status.size > 16_384 ||
    (process.getuid !== undefined && status.uid !== process.getuid()) ||
    (requireHardLink && status.nlink < 2) ||
    !validLockOwner(owner)
  )
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  return Object.freeze({ owner: Object.freeze(owner), status });
}

async function assertLockFile(path, expectedOwner, requireHardLink) {
  const value = await readLockFile(path, requireHardLink);
  if (JSON.stringify(value.owner) !== JSON.stringify(expectedOwner))
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  return value.status;
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}

export function parseRestartServerArguments(arguments_) {
  if (
    Array.isArray(arguments_) &&
    arguments_.length === 2 &&
    arguments_[0] === '--side-effects' &&
    arguments_[1] === 'NO'
  )
    return Object.freeze({ sideEffects: 'NO' });
  if (
    Array.isArray(arguments_) &&
    arguments_.length === 6 &&
    arguments_[0] === '--side-effects' &&
    arguments_[1] === 'YES' &&
    arguments_[2] === '--simulation-run-id' &&
    typeof arguments_[3] === 'string' &&
    arguments_[4] === '--acknowledge' &&
    typeof arguments_[5] === 'string'
  )
    return Object.freeze({
      sideEffects: 'YES',
      acknowledgement: arguments_[5],
      simulationRunId: arguments_[3],
    });
  throw new UapSupervisorError('UAP_ARGUMENT_INVALID');
}

async function main() {
  const command = process.argv[2];
  let result;
  if (command === 'start' && process.argv.length === 3) result = await startProcesses();
  else if (command === 'status' && process.argv.length === 3) result = await processStatus();
  else if (command === 'stop' && process.argv.length === 3) result = await stopProcesses();
  else if (
    (command === 'log-files' || command === 'stored-log-files') &&
    process.argv.length === 3
  ) {
    for (const path of await processLogFiles(command === 'stored-log-files'))
      process.stdout.write(`${path}\n`);
    return;
  } else if (command === 'restart-server') {
    const arguments_ = parseRestartServerArguments(process.argv.slice(3));
    result = await restartServer(
      arguments_.sideEffects,
      arguments_.acknowledgement,
      arguments_.simulationRunId,
    );
  } else throw new UapSupervisorError('UAP_ARGUMENT_INVALID');
  process.stdout.write(
    `${JSON.stringify(command === 'status' ? result : { ...result, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const stableCode =
      error instanceof UapSupervisorError ? error.code : 'UAP_PROCESS_SUPERVISOR_FAILED';
    writeFileSync(process.stderr.fd, `${stableCode}\n`, { encoding: 'utf8' });
    process.exitCode = 2;
  }
}
