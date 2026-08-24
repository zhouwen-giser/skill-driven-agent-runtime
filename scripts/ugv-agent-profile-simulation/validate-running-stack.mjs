#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
const SMPP_LIVE_NETWORKS = Object.freeze({
  'ugv-agent-profile-adapter': ['sdar-uap-p3-b01-smpp-control', 'sdar-uap-p3-b01-smpp-southbound'],
  'ugv-agent-profile-adapter-postgres': ['sdar-uap-p3-b01-smpp-control'],
  'ugv-agent-profile-pms-api': ['sdar-uap-p3-b01-smpp-control', 'sdar-uap-p3-b01-smpp-northbound'],
  'ugv-agent-profile-pms-postgres': ['sdar-uap-p3-b01-smpp-control'],
  'ugv-agent-profile-pms-worker': ['sdar-uap-p3-b01-smpp-control'],
  'ugv-agent-profile-runtime': ['sdar-uap-p3-b01-smpp-control', 'sdar-uap-p3-b01-smpp-northbound'],
  'ugv-agent-profile-runtime-postgres': ['sdar-uap-p3-b01-smpp-control'],
});
const SMPP_LIVE_PORTS = Object.freeze({
  'ugv-agent-profile-adapter': Object.freeze({ containerPort: 7010, hostPort: 17031 }),
  'ugv-agent-profile-pms-api': Object.freeze({ containerPort: 8090, hostPort: 18092 }),
  'ugv-agent-profile-runtime': Object.freeze({ containerPort: 8080, hostPort: 19131 }),
});
const SDAR_LIVE_NETWORKS = Object.freeze({
  'uap-control-postgres': ['sdar-uap-p3-b01-sdar-control', 'sdar-uap-p3-b01-sdar-northbound'],
  'uap-redis': ['sdar-uap-p3-b01-sdar-control', 'sdar-uap-p3-b01-sdar-northbound'],
  'uap-sdar-postgres': ['sdar-uap-p3-b01-sdar-control', 'sdar-uap-p3-b01-sdar-northbound'],
});
const SDAR_LIVE_PORTS = Object.freeze({
  'uap-control-postgres': Object.freeze({ containerPort: 5432, hostPort: 55463 }),
  'uap-redis': Object.freeze({ containerPort: 6379, hostPort: 56391 }),
  'uap-sdar-postgres': Object.freeze({ containerPort: 5432, hostPort: 55462 }),
});

export async function validateRunningStack(smppPath, sdarPath) {
  const smpp = await composeEntries(smppPath);
  const sdar = await composeEntries(sdarPath);
  exactRunning(smpp, 'sdar-uap-p3-b01-smpp', SMPP_SERVICES);
  exactRunning(sdar, 'sdar-uap-p3-b01-sdar', SDAR_SERVICES);
  return Object.freeze({ smppServiceCount: smpp.length, sdarServiceCount: sdar.length });
}

export async function validateSmppRunning(smppPath) {
  const smpp = await composeEntries(smppPath);
  exactRunning(smpp, 'sdar-uap-p3-b01-smpp', SMPP_SERVICES);
  return Object.freeze({ smppServiceCount: smpp.length });
}

export function validateProjectInventory(document, options = {}) {
  const mode = options.mode ?? 'running';
  if (!['running', 'closure'].includes(mode)) throw new Error('UAP_ARGUMENT_INVALID');
  const entries = Array.isArray(document) ? document : [];
  const project = options.project;
  const expectedServices = options.expectedServices;
  if (
    typeof project !== 'string' ||
    !Array.isArray(expectedServices) ||
    expectedServices.some((value) => typeof value !== 'string')
  )
    throw new Error('UAP_ARGUMENT_INVALID');
  if (entries.length === 0 && mode === 'closure') return Object.freeze({ serviceCount: 0 });
  const observedServices = entries
    .map((entry) => entry?.Config?.Labels?.['com.docker.compose.service'])
    .sort();
  const expected = [...expectedServices].sort();
  if (
    observedServices.length !== expected.length ||
    observedServices.some((service, index) => service !== expected[index]) ||
    new Set(observedServices).size !== observedServices.length ||
    entries.some((entry) => {
      const labels = entry?.Config?.Labels;
      if (
        typeof labels !== 'object' ||
        labels === null ||
        Array.isArray(labels) ||
        labels['com.docker.compose.project'] !== project
      )
        return true;
      if (mode !== 'running') return false;
      return (
        entry?.State?.Status !== 'running' ||
        (entry?.State?.Health !== undefined && entry.State.Health?.Status !== 'healthy')
      );
    })
  )
    throw new Error('UAP_PROJECT_INVENTORY_INVALID');
  return Object.freeze({ serviceCount: entries.length });
}

export function validateSupervisorStatus(document) {
  const identities = document?.processIdentitySha256;
  if (
    typeof document !== 'object' ||
    document === null ||
    Array.isArray(document) ||
    Object.keys(document).sort().join(',') !==
      [
        'activeSimulationRunId',
        'bootstrapRunId',
        'manifestRevision',
        'processCount',
        'processIdentitySha256',
        'schemaVersion',
        'sideEffects',
        'status',
      ].join(',') ||
    document.schemaVersion !== 'sdar.ugv-agent-profile.host-process-status/v2' ||
    document.status !== 'running' ||
    document.processCount !== 3 ||
    document.sideEffects !== 'NO' ||
    typeof document.bootstrapRunId !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(document.bootstrapRunId) ||
    document.bootstrapRunId.includes('..') ||
    !Number.isSafeInteger(document.manifestRevision) ||
    document.manifestRevision < 1 ||
    document.activeSimulationRunId !== null ||
    typeof identities !== 'object' ||
    identities === null ||
    Array.isArray(identities) ||
    Object.keys(identities).sort().join(',') !==
      ['nodeControlApi', 'nodeControlWorker', 'server'].join(',') ||
    Object.values(identities).some(
      (value) => typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value),
    )
  )
    throw new Error('UAP_SUPERVISOR_STATUS_INVALID');
  return Object.freeze({ processCount: 3, sideEffects: 'NO' });
}

export function validateSmppRuntimeExposure(document) {
  validateProjectInventory(document, {
    mode: 'running',
    project: 'sdar-uap-p3-b01-smpp',
    expectedServices: SMPP_SERVICES,
  });
  const entries = document;
  for (const entry of entries) {
    const service = entry.Config.Labels['com.docker.compose.service'];
    assertLiveNetworks(entry, SMPP_LIVE_NETWORKS[service], 'UAP_SMPP_LIVE_NETWORK_INVALID');
    assertPublishedPorts(entry, SMPP_LIVE_PORTS[service], 'UAP_SMPP_LIVE_PORT_EXPOSURE_INVALID');
  }
  return Object.freeze({
    serviceCount: entries.length,
    publishedPortOwnerCount: Object.keys(SMPP_LIVE_PORTS).length,
    northboundOwnerCount: 2,
    southboundOwnerCount: 1,
  });
}

export function validateSdarRuntimeExposure(document) {
  validateProjectInventory(document, {
    mode: 'running',
    project: 'sdar-uap-p3-b01-sdar',
    expectedServices: SDAR_SERVICES,
  });
  const entries = document;
  for (const entry of entries) {
    const service = entry.Config.Labels['com.docker.compose.service'];
    assertLiveNetworks(entry, SDAR_LIVE_NETWORKS[service], 'UAP_SDAR_LIVE_NETWORK_INVALID');
    assertPublishedPorts(entry, SDAR_LIVE_PORTS[service], 'UAP_SDAR_LIVE_PORT_EXPOSURE_INVALID');
  }
  return Object.freeze({
    serviceCount: entries.length,
    publishedPortOwnerCount: Object.keys(SDAR_LIVE_PORTS).length,
    northboundOwnerCount: 3,
  });
}

function assertLiveNetworks(entry, expected, code) {
  const networks = object(entry?.NetworkSettings?.Networks, code);
  exactValues(Object.keys(networks).sort(), expected, code);
  for (const network of Object.values(networks)) {
    if (
      typeof network !== 'object' ||
      network === null ||
      Array.isArray(network) ||
      typeof network.NetworkID !== 'string' ||
      network.NetworkID.length === 0 ||
      typeof network.IPAddress !== 'string' ||
      network.IPAddress.length === 0
    )
      throw new Error(code);
  }
}

function assertPublishedPorts(entry, expected, code) {
  const hostBindings = publishedBindings(entry?.HostConfig?.PortBindings, code);
  const networkBindings = publishedBindings(entry?.NetworkSettings?.Ports, code);
  if (expected === undefined) {
    if (hostBindings.length !== 0 || networkBindings.length !== 0) throw new Error(code);
    return;
  }
  const key = `${String(expected.containerPort)}/tcp`;
  exactValues(
    hostBindings.map(([port]) => port),
    [key],
    code,
  );
  exactValues(
    networkBindings.map(([port]) => port),
    [key],
    code,
  );
  for (const [, bindings] of [...hostBindings, ...networkBindings]) {
    if (
      bindings.length !== 1 ||
      bindings[0]?.HostIp !== '127.0.0.1' ||
      bindings[0]?.HostPort !== String(expected.hostPort)
    )
      throw new Error(code);
  }
}

function publishedBindings(value, code) {
  const bindings = value === null || value === undefined ? {} : object(value, code);
  const published = [];
  for (const [port, candidates] of Object.entries(bindings)) {
    if (candidates === null || candidates === undefined) continue;
    if (!Array.isArray(candidates) || candidates.length === 0) throw new Error(code);
    published.push([port, candidates]);
  }
  return published.sort(([left], [right]) => left.localeCompare(right));
}

function object(value, code) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value;
}

function exactValues(actual, expected, code) {
  if (
    !Array.isArray(expected) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  )
    throw new Error(code);
}

function exactRunning(entries, project, expectedServices) {
  const services = entries.map((entry) => entry?.Service).sort();
  if (
    services.length !== expectedServices.length ||
    services.some((service, index) => service !== expectedServices[index]) ||
    entries.some(
      (entry) =>
        entry?.Project !== project ||
        entry?.State !== 'running' ||
        (typeof entry?.Health === 'string' && entry.Health !== '' && entry.Health !== 'healthy'),
    )
  )
    throw new Error('UAP_OWNED_STACK_NOT_READY');
}

async function composeEntries(path) {
  const source = await readFile(resolve(path), 'utf8');
  if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024)
    throw new Error('UAP_COMPOSE_PS_TOO_LARGE');
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      return source
        .split(/\r?\n/u)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line));
    } catch {
      throw new Error('UAP_COMPOSE_PS_INVALID');
    }
  }
}

async function jsonDocument(path, maximumBytes = 4 * 1024 * 1024) {
  const source = await readFile(resolve(path), 'utf8');
  if (Buffer.byteLength(source, 'utf8') > maximumBytes)
    throw new Error('UAP_PROJECT_INVENTORY_TOO_LARGE');
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('UAP_PROJECT_INVENTORY_INVALID');
  }
}

async function main() {
  const smppRuntimeInspectIndex = process.argv.indexOf('--smpp-runtime-inspect');
  if (smppRuntimeInspectIndex >= 0) {
    if (process.argv.length !== 4 || process.argv[smppRuntimeInspectIndex + 1] === undefined)
      throw new Error('UAP_ARGUMENT_INVALID');
    const result = validateSmppRuntimeExposure(
      await jsonDocument(process.argv[smppRuntimeInspectIndex + 1]),
    );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
    );
    return;
  }
  const sdarRuntimeInspectIndex = process.argv.indexOf('--sdar-runtime-inspect');
  if (sdarRuntimeInspectIndex >= 0) {
    if (process.argv.length !== 4 || process.argv[sdarRuntimeInspectIndex + 1] === undefined)
      throw new Error('UAP_ARGUMENT_INVALID');
    const result = validateSdarRuntimeExposure(
      await jsonDocument(process.argv[sdarRuntimeInspectIndex + 1]),
    );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
    );
    return;
  }
  const supervisorStatusIndex = process.argv.indexOf('--supervisor-status');
  if (supervisorStatusIndex >= 0) {
    if (process.argv.length !== 4 || process.argv[supervisorStatusIndex + 1] === undefined)
      throw new Error('UAP_ARGUMENT_INVALID');
    const result = validateSupervisorStatus(
      await jsonDocument(process.argv[supervisorStatusIndex + 1], 65_536),
    );
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
    );
    return;
  }
  const smppInspectIndex = process.argv.indexOf('--smpp-project-inspect');
  if (smppInspectIndex >= 0) {
    const sdarInspectIndex = process.argv.indexOf('--sdar-project-inspect');
    const modeIndex = process.argv.indexOf('--mode');
    const mode = process.argv[modeIndex + 1];
    if (
      !['running', 'closure'].includes(mode) ||
      process.argv[smppInspectIndex + 1] === undefined ||
      (sdarInspectIndex >= 0 && process.argv[sdarInspectIndex + 1] === undefined)
    )
      throw new Error('UAP_ARGUMENT_INVALID');
    const smpp = validateProjectInventory(await jsonDocument(process.argv[smppInspectIndex + 1]), {
      mode,
      project: 'sdar-uap-p3-b01-smpp',
      expectedServices: SMPP_SERVICES,
    });
    const sdar =
      sdarInspectIndex < 0
        ? undefined
        : validateProjectInventory(await jsonDocument(process.argv[sdarInspectIndex + 1]), {
            mode,
            project: 'sdar-uap-p3-b01-sdar',
            expectedServices: SDAR_SERVICES,
          });
    process.stdout.write(
      `${JSON.stringify({ status: 'passed', smppServiceCount: smpp.serviceCount, ...(sdar === undefined ? {} : { sdarServiceCount: sdar.serviceCount }), secretsIncluded: false })}\n`,
    );
    return;
  }
  const smppIndex = process.argv.indexOf('--smpp-ps');
  const sdarIndex = process.argv.indexOf('--sdar-ps');
  if (
    ![4, 6].includes(process.argv.length) ||
    smppIndex < 2 ||
    process.argv[smppIndex + 1] === undefined ||
    (process.argv.length === 6 && (sdarIndex < 2 || process.argv[sdarIndex + 1] === undefined))
  )
    throw new Error('UAP_ARGUMENT_INVALID');
  const result =
    process.argv.length === 4
      ? await validateSmppRunning(process.argv[smppIndex + 1])
      : await validateRunningStack(process.argv[smppIndex + 1], process.argv[sdarIndex + 1]);
  process.stdout.write(
    `${JSON.stringify({ status: 'passed', ...result, secretsIncluded: false })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error && /^UAP_/u.test(error.message) ? error.message : 'UAP_RUNNING_STACK_VALIDATION_FAILED'}\n`,
    );
    process.exitCode = 2;
  }
}
