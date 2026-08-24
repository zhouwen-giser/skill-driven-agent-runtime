#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { initializeState, readExistingState } from './initialize-state.mjs';
import {
  sha256CanonicalJson,
  writeCanonicalFirstPassIndex,
  writeImmutableAttemptJson,
} from './evidence-files.mjs';

const PMS_BASE_URL = new URL('http://127.0.0.1:18092/');
const RUNTIME_BASE_URL = new URL('http://127.0.0.1:19131/');
const EXPECTED_ENDPOINT = new URL('/mcp', RUNTIME_BASE_URL).toString();
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SMPP_ROOT = resolve(REPOSITORY_ROOT, '../sdar-mcp-provider-platform');
const DEPLOY_ROOT = resolve(REPOSITORY_ROOT, 'deploy/ugv-agent-profile-simulation');
const PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const DEPLOYMENT_ID = 'uap-p3-b01-runtime';
const INSTANCE_ID = 'uap-p3-b01-runtime-1';
const SDAR_SOURCE_ID = 'smpp-source-ugv1-uap-p3-b01';
const SDAR_PROJECTION_PATH = `/api/v1/registry/simulation/consumers/sdar/v1/sources/${SDAR_SOURCE_ID}/latest`;
const READ_OPERATION = 'vehicle_get_state';
const EXPECTED_TOOLS = Object.freeze([
  // Exact reviewed live Catalog; reject optional additions until their authority is reviewed.
  'vehicle_area_recon',
  'vehicle_control_gimbal',
  'vehicle_emergency_stop',
  'vehicle_fire_weapon',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_state',
  'vehicle_get_targets',
  'vehicle_navigate',
  'vehicle_track_target',
]);
const QUIESCENT_MISSION_STATES = new Set([-1, 0, 3, 4, 5]);
const EXPECTED_SERVICES = Object.freeze([
  'ugv-agent-profile-adapter',
  'ugv-agent-profile-adapter-postgres',
  'ugv-agent-profile-pms-api',
  'ugv-agent-profile-pms-postgres',
  'ugv-agent-profile-pms-worker',
  'ugv-agent-profile-runtime',
  'ugv-agent-profile-runtime-postgres',
]);

export async function qualifySmppReadOnly({
  psFile,
  outputFile,
  fetchImplementation = globalThis.fetch,
  readAdapterAuditImplementation = readAdapterAudit,
  existingStateOnly = false,
}) {
  const state = existingStateOnly ? await readExistingState() : await initializeState();
  const services = await validateComposePs(psFile);
  let auditBefore;
  try {
    auditBefore = readAdapterAuditImplementation();
    assertAdapterAuditPrecondition(auditBefore);
    const deployment = await pms(
      `/api/v1/runtime-deployments/${DEPLOYMENT_ID}?providerId=${encodeURIComponent(PROVIDER_ID)}`,
      fetchImplementation,
    );
    if (
      deployment?.deploymentId !== DEPLOYMENT_ID ||
      deployment?.providerId !== PROVIDER_ID ||
      deployment?.environment !== 'simulation' ||
      deployment?.status !== 'ACTIVE' ||
      deployment?.runtimeAuthority !== 'direct_container' ||
      deployment?.directContainer?.instanceId !== INSTANCE_ID ||
      deployment?.directContainer?.advertisedEndpoint !== RUNTIME_BASE_URL.toString()
    )
      throw new Error('UAP_SMPP_DEPLOYMENT_AUTHORITY_INVALID');
    const runtimeProcess = await pms(
      `/api/v1/runtime-processes/${INSTANCE_ID}?providerId=${encodeURIComponent(PROVIDER_ID)}`,
      fetchImplementation,
    );
    const heartbeatAgeMs =
      typeof runtimeProcess?.lastHeartbeatAt === 'string'
        ? Date.now() - Date.parse(runtimeProcess.lastHeartbeatAt)
        : Number.NaN;
    if (
      runtimeProcess?.instanceId !== INSTANCE_ID ||
      runtimeProcess?.deploymentId !== DEPLOYMENT_ID ||
      runtimeProcess?.observedHealth !== 'READY' ||
      runtimeProcess?.readyForActive !== true ||
      runtimeProcess?.registrationState !== 'registered' ||
      runtimeProcess?.registrationFreshness !== 'registered' ||
      !Number.isFinite(heartbeatAgeMs) ||
      heartbeatAgeMs < -1_000 ||
      heartbeatAgeMs >= 45_000
    )
      throw new Error('UAP_SMPP_RUNTIME_REGISTRATION_NOT_FRESH');
    const projectionResponse = await fetchImplementation(
      new URL(SDAR_PROJECTION_PATH, PMS_BASE_URL),
      { headers: { accept: 'application/json' }, signal: globalThis.AbortSignal.timeout(10_000) },
    );
    const projection = await boundedJson(projectionResponse, 'UAP_SMPP_REGISTRY_PROJECTION');
    const providers = Array.isArray(projection?.providers) ? projection.providers : [];
    const provider = providers.find((candidate) => candidate?.externalProviderId === PROVIDER_ID);
    if (
      projectionResponse.headers.get('x-smpp-projection-contract') !== 'sdar-registry-v1' ||
      !Number.isSafeInteger(projection?.revision) ||
      projection.revision < 1 ||
      typeof projection?.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(projection.checksum) ||
      providers.length !== 1 ||
      provider?.externalServerId !== INSTANCE_ID ||
      provider?.serverEndpoint !== EXPECTED_ENDPOINT ||
      provider?.labels?.environment !== 'simulation' ||
      provider?.labels?.protocolMode !== 'frozen_v1'
    )
      throw new Error('UAP_SMPP_REGISTRY_AUTHORITY_INVALID');
    const etag = projectionResponse.headers.get('etag');
    if (etag !== `"${projection.checksum}"`) throw new Error('UAP_SMPP_REGISTRY_ETAG_INVALID');
    const conditional = await fetchImplementation(new URL(SDAR_PROJECTION_PATH, PMS_BASE_URL), {
      headers: { accept: 'application/json', 'if-none-match': etag },
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    if (
      conditional.status !== 304 ||
      conditional.headers.get('etag') !== etag ||
      (await conditional.text()) !== ''
    )
      throw new Error('UAP_SMPP_REGISTRY_CONDITIONAL_READ_INVALID');
    const ready = await fetchImplementation(new URL('/health/ready', RUNTIME_BASE_URL), {
      signal: globalThis.AbortSignal.timeout(5_000),
    });
    if (!ready.ok) throw new Error('UAP_SMPP_RUNTIME_NOT_READY');
    let requestId = 1;
    const rpc = async (method, params = {}, operation = undefined) => {
      if (operation !== undefined && operation !== READ_OPERATION)
        throw new Error('UAP_SMPP_MUTATING_OPERATION_FORBIDDEN');
      const response = await fetchImplementation(EXPECTED_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': method,
          'x-correlation-id': `${state.bootstrapRunId}-readonly-${String(requestId)}`,
          'x-sdar-subject': 'uap-provider-qualification',
          'x-sdar-tenant': 'ugv-external-simulation',
          'x-sdar-execution-mode': 'simulation',
          'x-sdar-simulation-id': `${state.bootstrapRunId}-readonly`,
          ...(operation === undefined ? {} : { 'mcp-name': operation }),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId++,
          method,
          params: {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': {
                name: 'sdar-uap-p3-b01-read-only-qualifier',
                version: '1.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {
                extensions: { 'io.modelcontextprotocol/tasks': {} },
              },
            },
          },
        }),
        signal: globalThis.AbortSignal.timeout(15_000),
      });
      const payload = await boundedJson(response, `UAP_SMPP_RPC_${method}`);
      if (payload?.error !== undefined || payload?.result === undefined)
        throw new Error('UAP_SMPP_RPC_FAILED');
      return payload.result;
    };
    const discovery = await rpc('server/discover');
    if (
      discovery?.resultType !== 'complete' ||
      !Array.isArray(discovery?.supportedVersions) ||
      !discovery.supportedVersions.includes('2026-07-28') ||
      discovery?.cacheScope !== 'public'
    )
      throw new Error('UAP_SMPP_DISCOVERY_CONTRACT_INVALID');
    const providerCatalog = discovery?.capabilities?.extensions?.['io.sdar/providerCatalog'];
    if (
      !record(providerCatalog) ||
      Object.keys(providerCatalog).sort().join(',') !==
        'manifestHash,providerId,providerType,providerVersion' ||
      providerCatalog.providerId !== PROVIDER_ID ||
      providerCatalog.providerType !== 'isr.vehicle.ugv' ||
      providerCatalog.providerVersion !== '1.0.0' ||
      typeof providerCatalog.manifestHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(providerCatalog.manifestHash)
    )
      throw new Error('UAP_SMPP_PROVIDER_CATALOG_AUTHORITY_INVALID');
    const catalog = await rpc('tools/list');
    const toolNames = Array.isArray(catalog?.tools)
      ? catalog.tools.flatMap((tool) => (typeof tool?.name === 'string' ? [tool.name] : []))
      : [];
    if (
      toolNames.length !== EXPECTED_TOOLS.length ||
      [...toolNames].sort().some((name, index) => name !== [...EXPECTED_TOOLS].sort()[index])
    )
      throw new Error('UAP_SMPP_CATALOG_INCOMPLETE');
    const getStateResult = await rpc(
      'tools/call',
      { name: READ_OPERATION, arguments: { resourceId: 'vehicle:ugv1' } },
      READ_OPERATION,
    );
    if (
      getStateResult?.resultType !== 'complete' ||
      typeof getStateResult?.structuredContent !== 'object' ||
      getStateResult.structuredContent === null ||
      Array.isArray(getStateResult.structuredContent)
    )
      throw new Error('UAP_SMPP_READ_OPERATION_INCOMPLETE');
    const providerTaskId = synchronousTaskId(getStateResult);
    const vehicleState = validateVehicleState(getStateResult.structuredContent, Date.now());
    const availabilityArguments = {
      resourceId: 'vehicle:ugv1',
      mission: {
        type: 'point',
        target: {
          latitude: vehicleState.latitude,
          longitude: vehicleState.longitude,
          ...(vehicleState.altitude === undefined ? {} : { altitude: vehicleState.altitude }),
        },
      },
      stopOnObstacle: true,
    };
    const availabilityRequestId = `point-${state.bootstrapRunId}`;
    const availabilityRequestedAt = new Date().toISOString();
    const availability = await rpc('io.sdar/taskExecution/checkAvailability', {
      profileVersion: '1.0',
      checks: [
        {
          requestId: availabilityRequestId,
          operationName: 'vehicle_navigate',
          arguments: { state: 'complete', value: availabilityArguments },
        },
      ],
    });
    const availabilityRespondedAt = new Date().toISOString();
    const availabilitySummary = validatePointAvailability(
      availability,
      availabilityRequestId,
      availabilityArguments,
      availabilityRequestedAt,
      availabilityRespondedAt,
    );
    const auditAfter = readAdapterAuditImplementation();
    const audit = compareAdapterAudit(auditBefore, auditAfter, providerTaskId);
    const report = Object.freeze({
      schemaVersion: 'sdar.ugv-agent-profile.smpp-readonly-qualification/v1',
      status: 'passed',
      task: 'UAP-P3-B01',
      generatedAt: new Date().toISOString(),
      command: 'deploy/ugv-agent-profile-simulation/qualify-smpp.sh',
      exitCode: 0,
      bootstrapRunId: state.bootstrapRunId,
      evidenceClass: 'external_simulation',
      productionEligible: false,
      physicalVehicleQualified: false,
      authorizationGranted: false,
      composeProjectVerified: true,
      composeFileCount: 3,
      composeServiceCount: services.length,
      pmsPublicAuthorityVerified: true,
      registryProjectionContract: 'sdar-registry-v1',
      registryRevision: projection.revision,
      registryChecksum: projection.checksum,
      registryConditionalNotModified: true,
      registrySourcePathVerified: true,
      runtimeRegistrationFresh: true,
      providerCatalog: {
        providerId: PROVIDER_ID,
        providerType: 'isr.vehicle.ugv',
        providerVersion: '1.0.0',
        manifestHash: providerCatalog.manifestHash,
        authoritySha256: sha256(canonical(providerCatalog)),
      },
      catalogToolCount: toolNames.length,
      readOperationCount: 1,
      availabilityCheckCount: 1,
      vehicleState: {
        identityVerified: true,
        connectivityVerified: true,
        freshnessVerified: true,
        idleVerified: true,
        coordinateReferenceSystem: 'WGS84',
        positionSha256: sha256(
          canonical({
            latitude: vehicleState.latitude,
            longitude: vehicleState.longitude,
            ...(vehicleState.altitude === undefined ? {} : { altitude: vehicleState.altitude }),
          }),
        ),
        observationSha256: sha256(vehicleState.observedAt),
      },
      pointAvailability: availabilitySummary,
      southboundAudit: audit,
      navigationCallCount: audit.navigationDispatchCount,
      mutatingOperationCount: audit.mutatingToolCallCount,
      forbiddenOperationCount: audit.forbiddenOperationCallCount,
      externalSimulationObserved: true,
      secretsIncluded: false,
      endpointsIncluded: false,
      modelConfigurationIncluded: false,
    });
    await writeReport(outputFile, report);
    return report;
  } catch (error) {
    await recordFailedQualification(
      outputFile,
      state,
      auditBefore,
      error,
      readAdapterAuditImplementation,
    );
    throw error;
  }
}

async function validateComposePs(path) {
  const source = await readFile(resolve(path), 'utf8');
  if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024)
    throw new Error('UAP_SMPP_COMPOSE_PS_TOO_LARGE');
  let entries;
  try {
    const parsed = JSON.parse(source);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = source
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
  }
  const services = entries.map((entry) => entry.Service).sort();
  if (
    services.length !== EXPECTED_SERVICES.length ||
    services.some((service, index) => service !== EXPECTED_SERVICES[index]) ||
    entries.some(
      (entry) =>
        entry.Project !== 'sdar-uap-p3-b01-smpp' ||
        entry.State !== 'running' ||
        (typeof entry.Health === 'string' && entry.Health !== '' && entry.Health !== 'healthy'),
    )
  )
    throw new Error('UAP_SMPP_COMPOSE_RUNTIME_CLOSURE_INVALID');
  return services;
}

function readAdapterAudit() {
  const query = String.raw`SELECT json_build_object(
    'deviceToolCalls', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
      'callId', t.call_id, 'taskId', t.task_id, 'toolName', t.tool_name,
      'outcome', t.outcome, 'occurredAt', t.occurred_at) ORDER BY t.occurred_at, t.call_id)
      FROM ugv_device_tool_call t), '[]'::json),
    'executions', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
      'taskId', t.task_id, 'operationName', t.operation_name, 'state', t.state)
      ORDER BY t.task_id) FROM ugv_execution t), '[]'::json),
    'mutationJournal', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
      'rowId', t.task_id || ':' || t.step_id, 'toolName', t.tool_name, 'state', t.state)
      ORDER BY t.task_id, t.step_id) FROM ugv_mutation_journal t), '[]'::json),
    'commandAcks', coalesce((SELECT json_agg(to_jsonb(t) || jsonb_build_object(
      'rowId', t.task_id || ':' || t.command || ':' || t.command_sequence::text,
      'command', t.command) ORDER BY t.task_id, t.command, t.command_sequence)
      FROM ugv_execution_command_ack t), '[]'::json)
  )::text`;
  let output;
  try {
    output = execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '/dev/null',
        '--project-directory',
        SMPP_ROOT,
        '--project-name',
        'sdar-uap-p3-b01-smpp',
        '-f',
        resolve(SMPP_ROOT, 'compose.yaml'),
        '-f',
        resolve(SMPP_ROOT, 'compose.ugv-agent-profile-simulation.yaml'),
        '-f',
        resolve(DEPLOY_ROOT, 'compose.smpp-pms.yaml'),
        '--profile',
        'ugv-agent-profile-simulation',
        'exec',
        '-T',
        'ugv-agent-profile-adapter-postgres',
        'psql',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'ugv_profile_adapter',
        '-d',
        'ugv_profile_adapter',
        '-A',
        '-t',
        '-c',
        query,
      ],
      {
        cwd: REPOSITORY_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 16 * 1024 * 1024,
        env: composeEnvironment(),
      },
    ).trim();
  } catch {
    throw new Error('UAP_SMPP_ADAPTER_AUDIT_FAILED');
  }
  try {
    return normalizeAudit(JSON.parse(output));
  } catch {
    throw new Error('UAP_SMPP_ADAPTER_AUDIT_INVALID');
  }
}

function assertAdapterAuditPrecondition(audit) {
  const forbidden = /navigate|fire|recon|track|gimbal|emergency_stop|mission_control|path_follow/iu;
  if (
    audit.deviceToolCalls.some((row) => row.toolName !== 'get_status') ||
    audit.executions.length !== 0 ||
    [
      ...audit.deviceToolCalls,
      ...audit.executions,
      ...audit.mutationJournal,
      ...audit.commandAcks,
    ].some((row) => forbidden.test(canonical(row))) ||
    audit.mutationJournal.length !== 0 ||
    audit.commandAcks.length !== 0
  )
    throw new Error('UAP_SMPP_ADAPTER_NOT_CLEAN_READ_ONLY');
}

function compareAdapterAudit(before, after, expectedTaskId) {
  const calls = addedRows(before.deviceToolCalls, after.deviceToolCalls, 'callId');
  const executions = addedRows(before.executions, after.executions, 'taskId');
  const mutations = addedRows(before.mutationJournal, after.mutationJournal, 'rowId');
  const acknowledgements = addedRows(before.commandAcks, after.commandAcks, 'rowId');
  const all = [...calls, ...executions, ...mutations, ...acknowledgements];
  const forbidden = all.filter((row) =>
    /navigate|fire|recon|track|gimbal|emergency_stop|mission_control|path_follow/iu.test(
      canonical(row),
    ),
  );
  const navigation = all.filter((row) =>
    /navigate|mission_control|path_follow/iu.test(canonical(row)),
  );
  if (
    calls.length !== 1 ||
    calls[0]?.toolName !== 'get_status' ||
    calls[0]?.outcome !== 'accepted' ||
    calls[0]?.taskId !== expectedTaskId ||
    executions.length !== 0 ||
    mutations.length !== 0 ||
    acknowledgements.length !== 0 ||
    forbidden.length !== 0
  )
    throw new Error('UAP_SMPP_SOUTHBOUND_READ_ONLY_AUDIT_MISMATCH');
  return Object.freeze({
    comparison: 'row_identity_set_difference',
    beforeSha256: sha256(canonical(before)),
    afterSha256: sha256(canonical(after)),
    taskIdCorrelationSha256: sha256(expectedTaskId),
    correlationMatched: true,
    addedDeviceToolCallCount: 1,
    addedExecutionCount: 0,
    addedMutationJournalCount: 0,
    addedCommandAckCount: 0,
    navigationDispatchCount: navigation.length,
    mutatingToolCallCount: 0,
    forbiddenOperationCallCount: forbidden.length,
  });
}

function normalizeAudit(value) {
  if (!record(value)) throw new Error('UAP_SMPP_ADAPTER_AUDIT_INVALID');
  return Object.freeze({
    deviceToolCalls: records(value.deviceToolCalls),
    executions: records(value.executions),
    mutationJournal: records(value.mutationJournal),
    commandAcks: records(value.commandAcks),
  });
}

export function addedRows(before, after, key) {
  const beforeMap = new Map();
  const afterMap = new Map();
  for (const row of before) {
    if (typeof row[key] !== 'string' || beforeMap.has(row[key]))
      throw new Error('UAP_SMPP_ADAPTER_AUDIT_IDENTITY_INVALID');
    beforeMap.set(row[key], row);
  }
  for (const row of after) {
    if (typeof row[key] !== 'string' || afterMap.has(row[key]))
      throw new Error('UAP_SMPP_ADAPTER_AUDIT_IDENTITY_INVALID');
    afterMap.set(row[key], row);
  }
  for (const [id, row] of beforeMap) {
    const current = afterMap.get(id);
    if (current === undefined || canonical(current) !== canonical(row))
      throw new Error('UAP_SMPP_ADAPTER_AUDIT_NON_MONOTONIC');
  }
  if (after.length < before.length) throw new Error('UAP_SMPP_ADAPTER_AUDIT_NON_MONOTONIC');
  return after.filter((row) => !beforeMap.has(row[key]));
}

function synchronousTaskId(result) {
  const evidence = result?._meta?.['io.sdar/evidence'];
  const items = Array.isArray(evidence?.items) ? evidence.items : [];
  const stateItems = items.filter((item) => item?.evidenceType === 'vehicle.state.observation');
  const subjectRef = stateItems[0]?.subjectRef;
  const match =
    typeof subjectRef === 'string'
      ? /^execution:vehicle:ugv1:sync:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(
          subjectRef,
        )
      : null;
  if (evidence?.profileVersion !== '1.0' || stateItems.length !== 1 || match?.[1] === undefined)
    throw new Error('UAP_SMPP_SYNCHRONOUS_EVIDENCE_INVALID');
  return match[1];
}

function validateVehicleState(value, now) {
  if (!record(value)) throw new Error('UAP_SMPP_VEHICLE_STATE_INVALID');
  if (
    value.identity?.providerId !== PROVIDER_ID ||
    value.identity?.resourceId !== 'vehicle:ugv1' ||
    value.identity?.vehicleType !== 'ugv' ||
    value.identity?.executionMode !== 'simulation' ||
    value.connectivity?.mqttConnected !== true ||
    value.connectivity?.deviceMcpConnected !== true ||
    value.connectivity?.deviceAvailable !== true
  )
    throw new Error('UAP_SMPP_VEHICLE_AUTHORITY_INVALID');
  for (const [timestamp, maximumAge] of [
    [value.freshness?.chassisObservedAt, 3_000],
    [value.freshness?.healthObservedAt, 5_000],
    [value.freshness?.missionObservedAt, 3_000],
    [value.observedAt, 3_000],
  ])
    assertFreshTimestamp(timestamp, maximumAge, now);
  const position = value.chassis?.position;
  const latitude = finiteRange(position?.latitude, -90, 90);
  const longitude = finiteRange(position?.longitude, -180, 180);
  const altitude =
    position?.altitude === undefined ? undefined : finiteRange(position.altitude, -20_000, 100_000);
  const mission = value.chassis?.mission;
  if (
    !record(mission) ||
    !QUIESCENT_MISSION_STATES.has(mission.state) ||
    mission.state === 1 ||
    mission.state === 2 ||
    (mission.state === 0 && typeof mission.id === 'string' && mission.id !== '') ||
    finiteRange(value.chassis?.speedKmh, 0, 0.1) > 0.1 ||
    typeof value.revision !== 'string' ||
    value.revision === '' ||
    !Number.isSafeInteger(value.mqttIngressSequence) ||
    value.mqttIngressSequence < 1
  )
    throw new Error('UAP_SMPP_VEHICLE_STATE_NOT_QUIESCENT');
  return Object.freeze({ latitude, longitude, altitude, observedAt: value.observedAt });
}

export function validatePointAvailability(
  result,
  requestId,
  argumentsValue,
  requestedAt,
  respondedAt,
) {
  const checks = Array.isArray(result?.results) ? result.results : [];
  const check = checks[0];
  const responseTime = Date.parse(respondedAt);
  const validUntil = typeof check?.validUntil === 'string' ? Date.parse(check.validUntil) : NaN;
  if (
    result?.resultType !== 'complete' ||
    result?.profileVersion !== '1.0' ||
    checks.length !== 1 ||
    check?.requestId !== requestId ||
    check?.operationName !== 'vehicle_navigate' ||
    check?.availability !== 'available' ||
    check?.riskLevel !== 'medium' ||
    check?.reservationMode !== 'none' ||
    check?.reservationRef !== undefined ||
    !Number.isFinite(responseTime) ||
    !Number.isFinite(validUntil) ||
    validUntil < responseTime ||
    validUntil - responseTime > 60_000
  )
    throw new Error('UAP_SMPP_POINT_AVAILABILITY_INVALID');
  return Object.freeze({
    availability: 'available',
    riskLevel: 'medium',
    reservationMode: 'none',
    requestedAt,
    respondedAt,
    validUntil: check.validUntil,
    argumentSha256: sha256(canonical(argumentsValue)),
    navigationDispatched: false,
  });
}

export function assertFreshTimestamp(value, maximumAge, now) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  const age = now - parsed;
  if (!Number.isFinite(age) || age < -1_000 || age > maximumAge)
    throw new Error('UAP_SMPP_VEHICLE_STATE_STALE');
}

function finiteRange(value, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error('UAP_SMPP_VEHICLE_COORDINATE_INVALID');
  return value;
}

function records(value) {
  if (!Array.isArray(value) || value.some((item) => !record(item)))
    throw new Error('UAP_SMPP_ADAPTER_AUDIT_INVALID');
  return value;
}

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function composeEnvironment() {
  const allowed = Object.fromEntries(
    ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'].flatMap(
      (name) => (process.env[name] === undefined ? [] : [[name, process.env[name]]]),
    ),
  );
  return {
    ...allowed,
    UAP_PMS_STATE_ROOT: `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}/pms`,
    UGV_AGENT_PROFILE_ADAPTER_PORT: '17031',
    UGV_AGENT_PROFILE_RUNTIME_PORT: '19131',
    UGV_AGENT_PROFILE_IMAGE_TAG: 'uap-p3-b01',
  };
}

async function pms(path, fetchImplementation) {
  const response = await fetchImplementation(new URL(path, PMS_BASE_URL), {
    headers: { accept: 'application/json' },
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  return boundedJson(response, 'UAP_SMPP_PMS_API');
}

async function boundedJson(response, code) {
  const source = await response.text();
  if (!response.ok || Buffer.byteLength(source, 'utf8') > 1024 * 1024) throw new Error(code);
  try {
    return source === '' ? null : JSON.parse(source);
  } catch {
    throw new Error(code);
  }
}

async function writeReport(path, report) {
  const attempt = await writeImmutableAttemptJson(
    resolve(dirname(path), 'attempts'),
    `smpp-readonly-qualification-${report.bootstrapRunId}`,
    report,
  );
  await writeCanonicalFirstPassIndex(
    resolve(path),
    {
      schemaVersion: 'sdar.ugv-agent-profile.smpp-readonly-qualification-index/v1',
      status: 'passed',
      task: report.task,
      bootstrapRunId: report.bootstrapRunId,
      evidenceClass: report.evidenceClass,
      canonicalSemantics: 'immutable_first_pass',
      firstPassAttemptFile: attempt.slice(REPOSITORY_ROOT.length + 1),
      firstPassAttemptSha256: sha256CanonicalJson(report),
      productionEligible: false,
      physicalVehicleQualified: false,
      secretsIncluded: false,
      endpointsIncluded: false,
      modelConfigurationIncluded: false,
    },
    REPOSITORY_ROOT,
  );
}

async function recordFailedQualification(
  path,
  state,
  auditBefore,
  error,
  readAdapterAuditImplementation,
) {
  let auditAfter;
  try {
    auditAfter = readAdapterAuditImplementation();
  } catch {
    auditAfter = undefined;
  }
  const mutationAssessment = assessQualificationFailure(auditBefore, auditAfter, error);
  const failure = Object.freeze({
    schemaVersion: 'sdar.ugv-agent-profile.smpp-readonly-qualification-attempt/v1',
    status: 'failed',
    task: 'UAP-P3-B01',
    generatedAt: new Date().toISOString(),
    command: 'deploy/ugv-agent-profile-simulation/qualify-smpp.sh',
    exitCode: 2,
    bootstrapRunId: state.bootstrapRunId,
    evidenceClass: 'external_simulation',
    productionEligible: false,
    physicalVehicleQualified: false,
    errorCode:
      error instanceof Error && /^UAP_[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'UAP_SMPP_QUALIFICATION_FAILED',
    southboundAuditAfterCaptured: auditAfter !== undefined,
    southboundMutationAssessment: mutationAssessment.status,
    southboundMutationAssessmentCode: mutationAssessment.code,
    ...(auditBefore === undefined ? {} : { auditBeforeSha256: sha256(canonical(auditBefore)) }),
    ...(auditAfter === undefined
      ? {}
      : {
          auditAfterSha256: sha256(canonical(auditAfter)),
          auditUnchanged: canonical(auditBefore) === canonical(auditAfter),
        }),
    simulationSideEffectsEnabled: false,
    externalMutationPerformed: mutationAssessment.externalMutationPerformed,
    preexistingExternalMutationObserved: mutationAssessment.preexistingExternalMutationObserved,
    mutationAttribution: mutationAssessment.mutationAttribution,
    secretsIncluded: false,
    endpointsIncluded: false,
    modelConfigurationIncluded: false,
  });
  await writeImmutableAttemptJson(
    resolve(dirname(path), 'attempts'),
    `smpp-readonly-qualification-failed-${state.bootstrapRunId}`,
    failure,
  );
}

export function assessQualificationFailure(before, after, error) {
  if (before === undefined)
    return Object.freeze({
      status: 'unknown',
      code: 'UAP_SMPP_FAILURE_AUDIT_BEFORE_UNAVAILABLE',
      externalMutationPerformed: 'unknown',
      preexistingExternalMutationObserved: 'unknown',
      mutationAttribution: 'unknown',
    });
  if (error instanceof Error && error.message === 'UAP_SMPP_ADAPTER_NOT_CLEAN_READ_ONLY')
    return Object.freeze({
      status: 'preexisting_mutation_observed',
      code: 'UAP_SMPP_FAILURE_AUDIT_PREEXISTING_MUTATION',
      externalMutationPerformed: false,
      preexistingExternalMutationObserved: true,
      mutationAttribution: 'preexisting_before_qualification',
    });
  const assessment = assessFailureAudit(before, after);
  return Object.freeze({
    ...assessment,
    preexistingExternalMutationObserved: false,
    mutationAttribution:
      assessment.externalMutationPerformed === true
        ? 'observed_during_qualification'
        : assessment.externalMutationPerformed === false
          ? 'none_observed_during_qualification'
          : 'unknown',
  });
}

export function assessFailureAudit(before, after) {
  if (after === undefined)
    return Object.freeze({
      status: 'unknown',
      code: 'UAP_SMPP_FAILURE_AUDIT_UNAVAILABLE',
      externalMutationPerformed: 'unknown',
    });
  let calls;
  let executions;
  let mutations;
  let acknowledgements;
  try {
    calls = addedRows(before.deviceToolCalls, after.deviceToolCalls, 'callId');
    executions = addedRows(before.executions, after.executions, 'taskId');
    mutations = addedRows(before.mutationJournal, after.mutationJournal, 'rowId');
    acknowledgements = addedRows(before.commandAcks, after.commandAcks, 'rowId');
  } catch {
    return Object.freeze({
      status: 'unknown',
      code: 'UAP_SMPP_FAILURE_AUDIT_NON_MONOTONIC',
      externalMutationPerformed: 'unknown',
    });
  }
  const added = [...calls, ...executions, ...mutations, ...acknowledgements];
  const mutating =
    executions.length > 0 ||
    mutations.length > 0 ||
    acknowledgements.length > 0 ||
    calls.some((row) => row.toolName !== 'get_status') ||
    added.some((row) =>
      /navigate|fire|recon|track|gimbal|emergency_stop|mission_control|path_follow/iu.test(
        canonical(row),
      ),
    );
  return Object.freeze({
    status: mutating ? 'mutation_observed' : 'no_mutation_observed',
    code: mutating
      ? 'UAP_SMPP_FAILURE_AUDIT_MUTATION_OBSERVED'
      : 'UAP_SMPP_FAILURE_AUDIT_NO_MUTATION',
    externalMutationPerformed: mutating,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const existingStateOnly = process.argv.includes('--existing-state-only');
    if (
      ![4, 5].includes(process.argv.length) ||
      process.argv[2] !== '--ps-json' ||
      (process.argv.length === 5 && process.argv[4] !== '--existing-state-only')
    )
      throw new Error('UAP_ARGUMENT_INVALID');
    const state = existingStateOnly ? await readExistingState() : await initializeState();
    const report = await qualifySmppReadOnly({
      psFile: process.argv[3],
      outputFile: resolve(
        fileURLToPath(new URL('../..', import.meta.url)),
        'reports/ugv-agent-profile-simulation/smpp-readonly-qualification.redacted.json',
      ),
      existingStateOnly,
    });
    process.stdout.write(
      `${JSON.stringify({ status: report.status, bootstrapRunId: state.bootstrapRunId, secretsIncluded: false })}\n`,
    );
  } catch (error) {
    const code =
      error instanceof Error && /^UAP_[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'UAP_SMPP_QUALIFICATION_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code, secretsIncluded: false })}\n`);
    process.exitCode = 2;
  }
}
