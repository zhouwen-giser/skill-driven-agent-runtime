#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

import { initializeState } from './initialize-state.mjs';
import {
  assertPrivateProcessLogSafe,
  taskOwnedCredentialMaterial,
  validateDotEnv,
} from './validate-profile.mjs';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const STATE_ROOT = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}`;
const MANIFEST_PATH = join(STATE_ROOT, 'processes.json');
const LOCK_PATH = join(STATE_ROOT, 'host-process.lock');
const TSX_CLI = resolve(REPOSITORY_ROOT, 'node_modules/tsx/dist/cli.mjs');
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

export class UapSupervisorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UapSupervisorError';
    this.code = code;
  }
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
) {
  if (!['NO', 'YES'].includes(sideEffects))
    throw new UapSupervisorError('UAP_SIDE_EFFECT_MODE_INVALID');
  const state = await initializeState(stateRoot);
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
      SDAR_CONTROL_WORKER_POLL_MS: '1000',
      SDAR_CONTROL_WORKER_ONCE: 'false',
    });
  if (name !== 'server') throw new UapSupervisorError('UAP_PROCESS_NAME_INVALID');
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
    UGV_SIMULATION_RUN_ID: state.simulationRunId,
    ...ARTIFACT_FLAGS,
  });
}

export async function startProcesses() {
  return withLock(async () => {
    const state = await initializeState();
    await ensurePrivateDirectory(join(STATE_ROOT, 'host-work'));
    await assertExecutableInputs();
    const existing = await optionalManifest();
    if (existing !== undefined) {
      await validateManifest(existing, { allowMissingProcesses: false });
      return Object.freeze({
        status: 'already_running',
        processCount: 3,
        sideEffects: existing.sideEffects,
      });
    }
    const processes = [];
    let publishedManifest;
    try {
      for (const spec of PROCESS_SPECS)
        processes.push(await spawnProcess(spec, spec.name === 'server' ? 'NO' : undefined));
      const manifest = Object.freeze({
        schemaVersion: 'sdar.ugv-agent-profile.host-processes/v1',
        bootstrapRunId: state.bootstrapRunId,
        simulationRunId: state.simulationRunId,
        revision: 1,
        sideEffects: 'NO',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        processes: Object.freeze(processes),
      });
      await publishManifestFirstWriter(manifest);
      publishedManifest = manifest;
      await validateManifest(manifest, { allowMissingProcesses: false });
      return Object.freeze({ status: 'started', processCount: 3, sideEffects: 'NO' });
    } catch (error) {
      await stopEntries([...processes].reverse());
      if (publishedManifest !== undefined) await cleanupPublishedManifest(publishedManifest);
      throw error;
    }
  });
}

export async function processStatus() {
  const manifest = await requireManifest();
  await validateManifest(manifest, { allowMissingProcesses: false });
  return Object.freeze({
    status: 'running',
    processCount: manifest.processes.length,
    sideEffects: manifest.sideEffects,
  });
}

export async function stopProcesses() {
  return withLock(async () => {
    const manifest = await optionalManifest();
    if (manifest === undefined)
      return Object.freeze({ status: 'already_stopped', processCount: 0 });
    await validateManifest(manifest, { allowMissingProcesses: true });
    await stopEntries([...manifest.processes].reverse());
    await unlinkPrivateManifest();
    return Object.freeze({ status: 'stopped', processCount: manifest.processes.length });
  });
}

export async function restartServer(sideEffects, acknowledgement) {
  return withLock(async () => {
    if (sideEffects !== 'NO' && sideEffects !== 'YES')
      throw new UapSupervisorError('UAP_SIDE_EFFECT_MODE_INVALID');
    if (
      sideEffects === 'YES' &&
      acknowledgement !== 'I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS'
    )
      throw new UapSupervisorError('UAP_SIDE_EFFECT_ACKNOWLEDGEMENT_REQUIRED');
    const manifest = await requireManifest();
    await validateManifest(manifest, { allowMissingProcesses: false });
    if (manifest.sideEffects === sideEffects)
      return Object.freeze({ status: 'already_running', processCount: 3, sideEffects });
    const serverSpec = PROCESS_SPECS.find((entry) => entry.name === 'server');
    if (serverSpec === undefined) throw new UapSupervisorError('UAP_PROCESS_SPEC_INVALID');
    return transactionalRestartServer(manifest, sideEffects, {
      stop: stopEntries,
      spawn: (mode) => spawnProcess(serverSpec, mode),
      readManifest: requireManifest,
      replaceManifest,
      validate: (value) => validateManifest(value, { allowMissingProcesses: false }),
      now: () => new Date().toISOString(),
    });
  });
}

export async function transactionalRestartServer(manifest, sideEffects, dependencies) {
  const server = manifest.processes.find((entry) => entry.name === 'server');
  if (server === undefined) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  await dependencies.stop([server]);
  let replacement;
  let next;
  try {
    replacement = await dependencies.spawn(sideEffects);
    next = Object.freeze({
      ...manifest,
      revision: manifest.revision + 1,
      sideEffects,
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
    try {
      restoredServer = await dependencies.spawn(manifest.sideEffects);
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
  if (allowMissingProcesses) return listPrivateLogFiles(join(STATE_ROOT, 'logs'));
  const manifest = await requireManifest();
  await validateManifest(manifest, { allowMissingProcesses: false });
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

async function spawnProcess(spec, sideEffects) {
  if (spec === undefined) throw new UapSupervisorError('UAP_PROCESS_SPEC_INVALID');
  const logFile = join(
    STATE_ROOT,
    'logs',
    `${spec.name}-${new Date().toISOString().replace(/[-:.TZ]/gu, '')}-${randomBytes(6).toString('hex')}.jsonl`,
  );
  const handle = await open(logFile, 'wx', 0o600);
  let child;
  let candidate;
  try {
    const environment = await processEnvironment(spec.name, sideEffects ?? 'NO');
    child = spawn(process.execPath, [TSX_CLI, spec.entrypoint], {
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
    const observed = await waitForExactIdentity(pid, spec);
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
    await validateProcessEntry(candidate, false, false);
    const readyAt = await waitForReadiness(candidate);
    const entry = Object.freeze({ ...candidate, readyAt });
    await validateProcessEntry(entry, false, true);
    await assertProcessLogSafe(logFile);
    return entry;
  } catch (error) {
    let logFailure;
    try {
      await assertProcessLogSafe(logFile);
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

async function waitForExactIdentity(pid, spec) {
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
      observed.argv.length === 3 &&
      observed.argv[0] === process.execPath &&
      observed.argv[1] === TSX_CLI &&
      observed.argv[2] === spec.entrypoint
    )
      return observed;
    await delay(25);
  }
  throw new UapSupervisorError('UAP_PROCESS_IDENTITY_MISMATCH');
}

async function waitForReadiness(entry) {
  const eventByProcess = {
    server: 'server.ready',
    'node-control-api': 'node_control.api.ready',
    'node-control-worker': 'node_control.worker.ready',
  };
  const healthByProcess = {
    server: 'http://127.0.0.1:10998/api/v1/health',
    'node-control-api': 'http://127.0.0.1:10091/health/ready',
  };
  const deadline = Date.now() + 180_000;
  while (Date.now() <= deadline) {
    await validateProcessEntry(entry, false, false);
    const source = await readPrivateFile(entry.logFile, 8 * 1024 * 1024);
    const readyEventObserved = source.split(/\r?\n/u).some((line) => {
      try {
        return JSON.parse(line)?.event === eventByProcess[entry.name];
      } catch {
        return false;
      }
    });
    if (readyEventObserved) {
      const healthUrl = healthByProcess[entry.name];
      if (healthUrl === undefined || (await healthReady(healthUrl)))
        return new Date().toISOString();
    }
    await delay(250);
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

async function validateManifest(manifest, { allowMissingProcesses }) {
  const state = await initializeState();
  if (
    manifest?.schemaVersion !== 'sdar.ugv-agent-profile.host-processes/v1' ||
    manifest.bootstrapRunId !== state.bootstrapRunId ||
    manifest.simulationRunId !== state.simulationRunId ||
    !Number.isSafeInteger(manifest.revision) ||
    manifest.revision < 1 ||
    !['NO', 'YES'].includes(manifest.sideEffects) ||
    !Array.isArray(manifest.processes) ||
    manifest.processes.length !== PROCESS_SPECS.length ||
    manifest.processes.some((entry, index) => entry?.name !== PROCESS_SPECS[index]?.name)
  )
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  for (const entry of manifest.processes) await validateProcessEntry(entry, allowMissingProcesses);
  const server = manifest.processes.find((entry) => entry.name === 'server');
  if (server === undefined) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
  return manifest;
}

async function validateProcessEntry(entry, allowMissing, requireReady = true) {
  const spec = PROCESS_SPECS.find((candidate) => candidate.name === entry?.name);
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
    !resolve(entry.logFile).startsWith(`${resolve(STATE_ROOT, 'logs')}/`) ||
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
    observed.argv.length !== 3 ||
    observed.argv[0] !== process.execPath ||
    observed.argv[1] !== TSX_CLI ||
    observed.argv[2] !== spec.entrypoint
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

async function stopEntries(entries) {
  const live = [];
  for (const entry of entries) if (await validateProcessEntry(entry, true)) live.push(entry);
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

async function assertExecutableInputs() {
  for (const path of [TSX_CLI, ...PROCESS_SPECS.map((entry) => entry.entrypoint)]) {
    const status = await lstat(path);
    if (status.isSymbolicLink() || !status.isFile())
      throw new UapSupervisorError('UAP_PROCESS_ENTRYPOINT_INVALID');
  }
}

async function requireManifest() {
  const value = await optionalManifest();
  if (value === undefined) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_REQUIRED');
  return value;
}

async function optionalManifest() {
  try {
    return JSON.parse(await readPrivateFile(MANIFEST_PATH, 262_144));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) throw new UapSupervisorError('UAP_PROCESS_MANIFEST_INVALID');
    throw error;
  }
}

async function publishManifestFirstWriter(manifest) {
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  const temporary = `${MANIFEST_PATH}.${String(process.pid)}.${randomBytes(8).toString('hex')}.candidate`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    try {
      await link(temporary, MANIFEST_PATH);
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

async function replaceManifest(prior, next) {
  const current = await requireManifest();
  if (JSON.stringify(current) !== JSON.stringify(prior))
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_DRIFT');
  const temporary = `${MANIFEST_PATH}.${String(process.pid)}.${randomBytes(8).toString('hex')}.next`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(temporary, 0o600);
  await rename(temporary, MANIFEST_PATH);
}

async function unlinkPrivateManifest() {
  await readPrivateFile(MANIFEST_PATH, 262_144);
  await unlink(MANIFEST_PATH);
}

export async function cleanupPublishedManifest(
  expected,
  dependencies = { read: requireManifest, remove: unlinkPrivateManifest },
) {
  const current = await dependencies.read();
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new UapSupervisorError('UAP_PROCESS_MANIFEST_DRIFT');
  await dependencies.remove();
}

async function withLock(action) {
  await initializeState();
  const anchor = await acquireLock();
  try {
    return await action();
  } finally {
    await releaseAtomicLock(anchor);
  }
}

async function acquireLock() {
  const observed = await inspectProcess(process.pid);
  if (observed === undefined || observed.uid !== Number(process.getuid?.() ?? 0))
    throw new UapSupervisorError('UAP_SUPERVISOR_LOCK_INVALID');
  const prepared = await prepareAtomicLockCandidate(LOCK_PATH, {
    schemaVersion: 'sdar.ugv-agent-profile.supervisor-lock/v1',
    pid: process.pid,
    uid: observed.uid,
    startTicks: observed.startTicks,
  });
  try {
    return await publishAtomicLockCandidate(LOCK_PATH, prepared);
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
    const modeIndex = process.argv.indexOf('--side-effects');
    const acknowledgementIndex = process.argv.indexOf('--acknowledge');
    const mode = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
    const acknowledgement =
      acknowledgementIndex < 0 ? undefined : process.argv[acknowledgementIndex + 1];
    if (mode === undefined) throw new UapSupervisorError('UAP_ARGUMENT_INVALID');
    result = await restartServer(mode, acknowledgement);
  } else throw new UapSupervisorError('UAP_ARGUMENT_INVALID');
  process.stdout.write(
    `${JSON.stringify(command === 'status' ? result : { ...result, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof UapSupervisorError ? error.code : 'UAP_PROCESS_SUPERVISOR_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
