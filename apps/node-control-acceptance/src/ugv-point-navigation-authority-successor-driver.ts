import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  a2aExposureEtag,
  createA2aExposureVersion,
  createNodeCapabilityDefinition,
  nodeCapabilityEtag,
  type CapabilityImplementationBinding,
  type JsonObject,
  type NodeCapabilityDefinitionVersion,
} from '../../../packages/node-control-domain/src/index.js';

const CAPABILITY_ID = 'embodied.move';
const SKILL_ID = 'embodied.move_to';
const EXPOSURE_ID = 'a2a.embodied.move';
const TOOL_NAME = 'vehicle_navigate';
const RESOURCE_ID = 'vehicle:ugv1';

export interface PointAuthoritySuccessorConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly runtimeManagementBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly bindingId: string;
  readonly runId: string;
  readonly reportFile: string;
}

interface BindingAuthority {
  readonly bindingId: string;
  readonly localServerId: string;
  readonly revision: number;
  readonly registryRevision: number;
  readonly registryChecksum: string;
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
  readonly operationCount: number;
  readonly status: string;
  readonly availabilityStatus: string;
  readonly availabilityValidUntil: string;
}

interface ToolAuthority {
  readonly serverId: string;
  readonly toolName: string;
  readonly taskExecutionProfile: Readonly<{ taskBehavior: string }>;
  readonly executionSemantics: Readonly<{
    effect: string;
    execution: string;
    cancellation: string;
    idempotency: string;
    replay: string;
    source: string;
  }>;
}

interface ExposureAuthority {
  readonly exposureId: string;
  readonly version: number;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly agentSkillId: string;
  readonly name: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly examples?: readonly string[];
  readonly inputModes?: readonly string[];
  readonly outputModes?: readonly string[];
  readonly requestSchema: JsonObject;
  readonly resultSchema: JsonObject;
  readonly visibility: 'organization' | 'public';
  readonly requesterPolicy?: JsonObject;
  readonly readinessPublicationPolicy?:
    'publish_when_available' | 'publish_degraded' | 'always_publish_with_status';
  readonly status: 'draft' | 'published' | 'suspended' | 'retired';
  readonly exposureHash: string;
}

export interface PointAuthoritySuccessorReport {
  readonly schemaVersion: 'sdar.ugv-point-authority-successor/v1';
  readonly status: 'passed';
  readonly observedAt: string;
  readonly binding: Readonly<{
    bindingId: string;
    revision: number;
    catalogRevision: string;
    catalogChecksum: string;
  }>;
  readonly capability: Readonly<{
    capabilityId: typeof CAPABILITY_ID;
    version: number;
    previousVersion: number;
    definitionHash: string;
    status: 'published';
    action: 'reused' | 'successor_created' | 'successor_completed';
  }>;
  readonly implementation: Readonly<{
    bindingId: string;
    providerBindingId: string;
    serverId: string;
    toolName: typeof TOOL_NAME;
  }>;
  readonly exposure: Readonly<{
    exposureId: typeof EXPOSURE_ID;
    version: number;
    exposureHash: string;
    capabilityVersion: number;
    status: 'published';
  }>;
  readonly agentCard: Readonly<{ rebuilt: true }>;
  readonly externalOperations: Readonly<{ toolsCall: 0; deviceActions: 0 }>;
  readonly redaction: Readonly<{
    endpointsIncluded: false;
    credentialsIncluded: false;
    secretsIncluded: false;
  }>;
}

export function buildPointCapabilitySuccessor(
  prior: NodeCapabilityDefinitionVersion,
  version: number,
  binding: BindingAuthority,
  tool: ToolAuthority,
): NodeCapabilityDefinitionVersion {
  if (version !== prior.version && version !== prior.version + 1)
    throw new PointAuthoritySuccessorError(
      'POINT_AUTHORITY_VERSION_INVALID',
      'A point-navigation Capability may only be compared at its current version or advanced once.',
    );
  const providerPolicy = Object.freeze({
    type: 'provider_binding_policy',
    mcpProviderBindingId: binding.bindingId,
    localServerId: binding.localServerId,
    mcpToolName: tool.toolName,
    allowedResourceIds: Object.freeze([RESOURCE_ID]),
    bindingRevision: binding.revision,
    registryRevision: binding.registryRevision,
    registryChecksum: binding.registryChecksum,
    catalogRevision: binding.catalogRevision,
    catalogChecksum: binding.catalogChecksum,
    taskBehavior: tool.taskExecutionProfile.taskBehavior,
    executionSemantics: Object.freeze({ ...tool.executionSemantics }),
    requiredStatus: 'active',
    requiredAvailabilityStatus: 'available',
    requiredFreshness: 'unexpired',
    fallback: 'deny',
  });
  const constraints = (prior.constraints ?? []).map((constraint) =>
    constraint['type'] === 'provider_binding_policy'
      ? providerPolicy
      : Object.freeze(structuredClone(constraint)),
  );
  if (!constraints.some((constraint) => constraint.type === 'provider_binding_policy'))
    throw new PointAuthoritySuccessorError(
      'POINT_AUTHORITY_PROVIDER_POLICY_MISSING',
      'The published point-navigation Capability lacks its frozen Provider policy.',
    );
  return createNodeCapabilityDefinition({
    capabilityId: prior.capabilityId,
    version,
    ...(version === 1 ? {} : { previousVersion: version - 1 }),
    domain: prior.domain,
    name: prior.name,
    description: prior.description,
    inputSchema: prior.inputSchema,
    outputSchema: prior.outputSchema,
    successCriteria: prior.successCriteria,
    requiredEvidence: prior.requiredEvidence,
    effects: prior.effects ?? [],
    artifacts: prior.artifacts ?? [],
    constraints,
    supportedModes: prior.supportedModes ?? [],
    riskLevel: prior.riskLevel,
    status: 'draft',
    createdBy:
      version === prior.version
        ? (prior.createdBy ?? 'ugv-point-navigation-authority-successor-driver')
        : 'ugv-point-navigation-authority-successor-driver',
    createdAt:
      version === prior.version
        ? (prior.createdAt ?? '2026-09-01T00:00:00.000Z')
        : '2026-09-01T00:00:00.000Z',
  });
}

export function isPointProviderAuthorityCurrent(
  capability: NodeCapabilityDefinitionVersion,
  binding: BindingAuthority,
  tool: ToolAuthority,
): boolean {
  const current = capability.constraints?.find(
    (constraint) => constraint['type'] === 'provider_binding_policy',
  );
  const expected = buildPointCapabilitySuccessor(
    capability,
    capability.version,
    binding,
    tool,
  ).constraints?.find((constraint) => constraint['type'] === 'provider_binding_policy');
  return current !== undefined && expected !== undefined && stable(current) === stable(expected);
}

export async function reconcilePointAuthoritySuccessor(
  rawConfiguration: PointAuthoritySuccessorConfiguration,
  dependencies: Readonly<{
    request?: typeof fetch;
    now?: () => string;
    delay?: (ms: number) => Promise<void>;
  }> = {},
): Promise<PointAuthoritySuccessorReport> {
  const configuration = validateConfiguration(rawConfiguration);
  const request = dependencies.request ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const pause =
    dependencies.delay ??
    ((ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)));
  const observedAt = now();

  const binding = asBinding(
    await getControl(
      configuration,
      `/api/v1/mcp-provider-bindings/${encodeURIComponent(configuration.bindingId)}`,
      request,
    ),
  );
  assertBindingCurrent(binding, observedAt);
  const servers = arrayItems(await getRuntime(configuration, '/api/v1/mcp/servers', request));
  const serverMatches = servers.filter(
    (item) => string(item, 'serverId') === binding.localServerId,
  );
  const server = serverMatches[0];
  if (server === undefined || serverMatches.length !== 1)
    fail(
      'POINT_AUTHORITY_RUNTIME_SERVER_NOT_EXACT',
      'The current Binding must resolve to one Runtime Server.',
    );
  if (number(server, 'toolRevision') !== binding.revision)
    fail('POINT_AUTHORITY_RUNTIME_REVISION_STALE', 'Runtime and Binding revisions are not exact.');
  const tools = arrayItems(
    await getRuntime(
      configuration,
      `/api/v1/mcp/servers/${encodeURIComponent(binding.localServerId)}/tools`,
      request,
    ),
  );
  if (tools.length !== binding.operationCount)
    fail('POINT_AUTHORITY_OPERATION_COUNT_DRIFT', 'Runtime and Binding operation counts differ.');
  const toolRows = tools.filter((item) => string(item, 'toolName') === TOOL_NAME);
  if (toolRows.length !== 1)
    fail(
      'POINT_AUTHORITY_TOOL_NOT_EXACT',
      'The current Runtime Catalog must contain vehicle_navigate exactly once.',
    );
  const tool = asTool(toolRows[0]);

  const capabilities = arrayItems(
    await getControl(configuration, '/api/v1/node-capabilities?pageSize=200', request),
  )
    .filter((item) => string(item, 'capabilityId') === CAPABILITY_ID)
    .map(asCapability)
    .sort((left, right) => right.version - left.version);
  const latest = capabilities[0];
  const latestPublished = capabilities.find(({ status }) => status === 'published');
  if (latest === undefined || latestPublished === undefined)
    fail(
      'POINT_AUTHORITY_CAPABILITY_MISSING',
      'A published historical embodied.move Capability is required.',
    );

  let capability: NodeCapabilityDefinitionVersion;
  let action: PointAuthoritySuccessorReport['capability']['action'];
  if (isPointProviderAuthorityCurrent(latestPublished, binding, tool)) {
    capability = latestPublished;
    action = 'reused';
  } else {
    const successorVersion = latestPublished.version + 1;
    const proposed = buildPointCapabilitySuccessor(
      latestPublished,
      successorVersion,
      binding,
      tool,
    );
    if (latest.version > successorVersion)
      fail(
        'POINT_AUTHORITY_UNRELATED_SUCCESSOR_EXISTS',
        'A later immutable Capability version already exists.',
      );
    if (latest.version === successorVersion) {
      if (
        latest.definitionHash !== proposed.definitionHash ||
        latest.status === 'suspended' ||
        latest.status === 'retired'
      )
        fail(
          'POINT_AUTHORITY_SUCCESSOR_DRIFT',
          'The existing point-navigation successor is not exact.',
        );
      capability = latest;
      action = latest.status === 'published' ? 'reused' : 'successor_completed';
    } else {
      capability = asCapability(
        await createControl(
          configuration,
          '/api/v1/node-capabilities',
          key(configuration, 'capability-create'),
          proposed,
          request,
        ),
      );
      action = 'successor_created';
    }
  }

  const implementation = pointImplementation(capability.version, binding);
  const implementations = arrayItems(
    await getControl(
      configuration,
      `/api/v1/node-capabilities/${CAPABILITY_ID}/versions/${String(capability.version)}/implementations?pageSize=100`,
      request,
    ),
  );
  const existingImplementation = implementations.find(
    (item) => string(item, 'bindingId') === implementation.bindingId,
  );
  if (existingImplementation === undefined)
    await createControl(
      configuration,
      `/api/v1/node-capabilities/${CAPABILITY_ID}/versions/${String(capability.version)}/implementations`,
      key(configuration, 'implementation-create'),
      implementation,
      request,
    );
  else if (stable(existingImplementation) !== stable(implementation))
    fail(
      'POINT_AUTHORITY_IMPLEMENTATION_DRIFT',
      'The immutable implementation successor is not exact.',
    );

  if (capability.status === 'draft')
    capability = asCapability(
      await mutateControl(
        configuration,
        `/api/v1/node-capabilities/${CAPABILITY_ID}/versions/${String(capability.version)}/validate`,
        key(configuration, 'capability-validate'),
        { reason: 'Validate the append-only current point-navigation authority successor.' },
        nodeCapabilityEtag(capability),
        200,
        request,
      ),
    );
  if (capability.status === 'validating') {
    const operation = asRecord(
      await mutateControl(
        configuration,
        `/api/v1/node-capabilities/${CAPABILITY_ID}/versions/${String(capability.version)}/publish`,
        key(configuration, 'capability-publish'),
        { reason: 'Publish the append-only current point-navigation authority successor.' },
        nodeCapabilityEtag(capability),
        202,
        request,
      ),
    );
    if (operation['status'] !== 'succeeded')
      fail('POINT_AUTHORITY_PUBLISH_FAILED', 'Capability publish operation did not succeed.');
    capability = asCapability(
      await getControl(
        configuration,
        `/api/v1/node-capabilities/${CAPABILITY_ID}/versions/${String(capability.version)}`,
        request,
      ),
    );
  }
  if (capability.status !== 'published')
    fail(
      'POINT_AUTHORITY_CAPABILITY_NOT_PUBLISHED',
      'Point-navigation successor is not published.',
    );

  await evaluateReadiness(
    configuration,
    capability.version,
    implementation.bindingId,
    request,
    pause,
  );
  const exposure = await reconcileExposure(configuration, capability, request);
  const rebuild = asRecord(
    await commandControl(
      configuration,
      '/api/v1/a2a-agent-card-revisions/rebuild',
      key(configuration, 'agent-card-rebuild'),
      { reason: 'Activate the append-only point-navigation Exposure successor.' },
      request,
    ),
  );
  if (rebuild['status'] !== 'succeeded')
    fail('POINT_AUTHORITY_AGENT_CARD_REBUILD_FAILED', 'Agent Card rebuild did not succeed.');

  const report: PointAuthoritySuccessorReport = Object.freeze({
    schemaVersion: 'sdar.ugv-point-authority-successor/v1',
    status: 'passed',
    observedAt,
    binding: Object.freeze({
      bindingId: binding.bindingId,
      revision: binding.revision,
      catalogRevision: binding.catalogRevision,
      catalogChecksum: binding.catalogChecksum,
    }),
    capability: Object.freeze({
      capabilityId: CAPABILITY_ID,
      version: capability.version,
      previousVersion: capability.previousVersion ?? capability.version - 1,
      definitionHash: capability.definitionHash,
      status: 'published',
      action,
    }),
    implementation: Object.freeze({
      bindingId: implementation.bindingId,
      providerBindingId: binding.bindingId,
      serverId: binding.localServerId,
      toolName: TOOL_NAME,
    }),
    exposure: Object.freeze({
      exposureId: EXPOSURE_ID,
      version: exposure.version,
      exposureHash: exposure.exposureHash,
      capabilityVersion: capability.version,
      status: 'published',
    }),
    agentCard: Object.freeze({ rebuilt: true }),
    externalOperations: Object.freeze({ toolsCall: 0, deviceActions: 0 }),
    redaction: Object.freeze({
      endpointsIncluded: false,
      credentialsIncluded: false,
      secretsIncluded: false,
    }),
  });
  await writeReport(configuration.reportFile, report);
  return report;
}

function pointImplementation(
  version: number,
  binding: BindingAuthority,
): CapabilityImplementationBinding {
  return Object.freeze({
    bindingId: `capability-binding-embodied.move-v${String(version)}`,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: version,
    implementationType: 'skill',
    implementationId: SKILL_ID,
    implementationVersion: '1',
    role: 'primary',
    priority: 0,
    providerPolicyOverride: Object.freeze({
      selection: 'required',
      mcpProviderBindingId: binding.bindingId,
      localServerId: binding.localServerId,
      mcpToolName: TOOL_NAME,
      allowedResourceIds: Object.freeze([RESOURCE_ID]),
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    }),
    status: 'active',
    revision: 1,
  });
}

async function reconcileExposure(
  configuration: PointAuthoritySuccessorConfiguration,
  capability: NodeCapabilityDefinitionVersion,
  request: typeof fetch,
): Promise<ExposureAuthority> {
  const listed = arrayItems(
    await getControl(configuration, '/api/v1/a2a-exposures?pageSize=1000', request),
  )
    .filter((item) => string(item, 'exposureId') === EXPOSURE_ID)
    .map(asExposure)
    .sort((left, right) => right.version - left.version);
  const latest = listed[0];
  const draftFor = (version: number) =>
    createA2aExposureVersion({
      exposureId: EXPOSURE_ID,
      version,
      capabilityId: CAPABILITY_ID,
      capabilityVersion: capability.version,
      agentSkillId: SKILL_ID,
      name: capability.name,
      description: capability.description,
      tags: Object.freeze(['ugv', 'vehicle', 'physical-control', 'point-navigation']),
      examples: Object.freeze(['Move vehicle:ugv1 to one explicit WGS84 point.']),
      inputModes: Object.freeze(['text/plain', 'application/json']),
      outputModes: Object.freeze(['application/json']),
      requestSchema: capability.inputSchema,
      resultSchema: capability.outputSchema,
      visibility: 'public',
      requesterPolicy: Object.freeze({
        allowAnonymous: true,
        requiredAuthorities: Object.freeze(['plan_confirmation', 'physical_control.confirm']),
      }),
      readinessPublicationPolicy: 'publish_when_available',
      status: 'draft',
    });
  const exactAtLatest = latest === undefined ? undefined : draftFor(latest.version);
  const same = latest !== undefined && latest.exposureHash === exactAtLatest?.exposureHash;
  const version = same ? latest.version : (latest?.version ?? 0) + 1;
  let current = same
    ? latest
    : asExposure(
        await createControl(
          configuration,
          '/api/v1/a2a-exposures',
          key(configuration, `exposure-create-${String(version)}`),
          draftFor(version),
          request,
        ),
      );
  if (current.status !== 'published') {
    const operation = asRecord(
      await mutateControl(
        configuration,
        `/api/v1/a2a-exposures/${EXPOSURE_ID}/versions/${String(version)}/publish`,
        key(configuration, `exposure-publish-${String(version)}`),
        { reason: 'Publish the append-only point-navigation Exposure successor.' },
        a2aExposureEtag(current),
        202,
        request,
      ),
    );
    current = asExposure(operation['result']);
  }
  for (const prior of listed.filter(
    ({ version: priorVersion, status }) => priorVersion !== version && status === 'published',
  ))
    await mutateControl(
      configuration,
      `/api/v1/a2a-exposures/${EXPOSURE_ID}/versions/${String(prior.version)}/suspend`,
      key(configuration, `exposure-suspend-${String(prior.version)}`),
      { reason: `Supersede immutable point-navigation Exposure @${String(prior.version)}.` },
      a2aExposureEtag(prior),
      202,
      request,
    );
  return current;
}

async function evaluateReadiness(
  configuration: PointAuthoritySuccessorConfiguration,
  version: number,
  implementationBindingId: string,
  request: typeof fetch,
  pause: (ms: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const operation = asRecord(
      await commandControl(
        configuration,
        `/api/v1/capability-readiness/${CAPABILITY_ID}/${String(version)}/evaluate`,
        key(configuration, `readiness-${String(attempt)}`),
        { reason: 'Evaluate the exact point-navigation authority successor.' },
        request,
      ),
    );
    const snapshot = asRecord(operation['result']);
    const available = strings(snapshot['availableImplementations']);
    const unavailable = strings(snapshot['unavailableImplementations']);
    if (
      snapshot['status'] === 'available' &&
      stable(available) === stable([implementationBindingId]) &&
      unavailable.length === 0
    )
      return;
    const reasons = Array.isArray(snapshot['reasons']) ? snapshot['reasons'].map(asRecord) : [];
    if (
      attempt === 1 &&
      reasons.some((reason) => reason['code'] === 'READINESS_STABILITY_WINDOW')
    ) {
      await pause(10_250);
      continue;
    }
    fail(
      'POINT_AUTHORITY_READINESS_UNAVAILABLE',
      'Point-navigation successor readiness is unavailable.',
    );
  }
}

function assertBindingCurrent(binding: BindingAuthority, observedAt: string): void {
  if (binding.status !== 'active' || binding.availabilityStatus !== 'available')
    fail(
      'POINT_AUTHORITY_BINDING_UNAVAILABLE',
      'The exact Provider Binding is not active and available.',
    );
  if (Date.parse(binding.availabilityValidUntil) <= Date.parse(observedAt))
    fail('POINT_AUTHORITY_BINDING_EXPIRED', 'The exact Provider Binding freshness is expired.');
  if (
    binding.revision < 1 ||
    binding.operationCount < 1 ||
    !/^[a-f0-9]{64}$/u.test(binding.catalogChecksum)
  )
    fail('POINT_AUTHORITY_BINDING_INVALID', 'The exact Provider Binding authority is invalid.');
}

function asBinding(value: unknown): BindingAuthority {
  const row = asRecord(value);
  return Object.freeze({
    bindingId: string(row, 'bindingId'),
    localServerId: string(row, 'localServerId'),
    revision: number(row, 'revision'),
    registryRevision: number(row, 'registryRevision'),
    registryChecksum: string(row, 'registryChecksum'),
    catalogRevision: string(row, 'catalogRevision'),
    catalogChecksum: string(row, 'catalogChecksum'),
    operationCount: number(row, 'operationCount'),
    status: string(row, 'status'),
    availabilityStatus: string(row, 'availabilityStatus'),
    availabilityValidUntil: string(row, 'availabilityValidUntil'),
  });
}

function asTool(value: unknown): ToolAuthority {
  const row = asRecord(value);
  const profile = asRecord(row['taskExecutionProfile']);
  const semantics = asRecord(row['executionSemantics']);
  return Object.freeze({
    serverId: string(row, 'serverId'),
    toolName: string(row, 'toolName'),
    taskExecutionProfile: Object.freeze({ taskBehavior: string(profile, 'taskBehavior') }),
    executionSemantics: Object.freeze({
      effect: string(semantics, 'effect'),
      execution: string(semantics, 'execution'),
      cancellation: string(semantics, 'cancellation'),
      idempotency: string(semantics, 'idempotency'),
      replay: string(semantics, 'replay'),
      source: string(semantics, 'source'),
    }),
  });
}

function asCapability(value: unknown): NodeCapabilityDefinitionVersion {
  const row = asRecord(value);
  if (
    string(row, 'capabilityId') !== CAPABILITY_ID ||
    !Number.isSafeInteger(number(row, 'version'))
  )
    fail('POINT_AUTHORITY_CAPABILITY_INVALID', 'Node Control returned an invalid Capability.');
  return row as unknown as NodeCapabilityDefinitionVersion;
}

function asExposure(value: unknown): ExposureAuthority {
  const row = asRecord(value);
  return row as unknown as ExposureAuthority;
}

function arrayItems(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const items = asRecord(value)['items'];
  if (!Array.isArray(items))
    fail('POINT_AUTHORITY_RESPONSE_INVALID', 'Expected a bounded items response.');
  return Object.freeze(items.map(asRecord));
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('POINT_AUTHORITY_RESPONSE_INVALID', 'Expected a JSON object response.');
  return value as Readonly<Record<string, unknown>>;
}

function string(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.trim() === '')
    fail('POINT_AUTHORITY_RESPONSE_INVALID', `Expected non-empty ${key}.`);
  return value;
}

function number(row: Readonly<Record<string, unknown>>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail('POINT_AUTHORITY_RESPONSE_INVALID', `Expected non-negative integer ${key}.`);
  return value;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    fail('POINT_AUTHORITY_RESPONSE_INVALID', 'Expected a string array.');
  return Object.freeze(value as string[]);
}

async function getControl(
  configuration: PointAuthoritySuccessorConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${configuration.nodeControlBearerToken}` },
      redirect: 'manual',
    }),
    200,
  );
}

async function getRuntime(
  configuration: PointAuthoritySuccessorConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.runtimeManagementBaseUrl}${path}`, { redirect: 'manual' }),
    200,
  );
}

async function createControl(
  configuration: PointAuthoritySuccessorConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      method: 'POST',
      headers: controlHeaders(configuration, idempotencyKey),
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
    201,
  );
}

async function commandControl(
  configuration: PointAuthoritySuccessorConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      method: 'POST',
      headers: controlHeaders(configuration, idempotencyKey),
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
    202,
  );
}

async function mutateControl(
  configuration: PointAuthoritySuccessorConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  ifMatch: string,
  status: number,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.nodeControlBaseUrl}${path}`, {
      method: 'POST',
      headers: { ...controlHeaders(configuration, idempotencyKey), 'if-match': ifMatch },
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
    status,
  );
}

function controlHeaders(
  configuration: PointAuthoritySuccessorConfiguration,
  idempotencyKey: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    authorization: `Bearer ${configuration.nodeControlBearerToken}`,
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey,
  });
}

async function responseJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    let code = `HTTP_${String(response.status)}`;
    try {
      const body = asRecord(await response.json());
      if (typeof body['code'] === 'string') code = body['code'];
    } catch {
      // External error bodies are deliberately not echoed into logs or reports.
    }
    fail(code, `Authority request was rejected with HTTP ${String(response.status)}.`);
  }
  return response.json();
}

function key(configuration: PointAuthoritySuccessorConfiguration, operation: string): string {
  return `${configuration.runId}:${operation}`.slice(0, 256);
}

function validateConfiguration(
  input: PointAuthoritySuccessorConfiguration,
): PointAuthoritySuccessorConfiguration {
  const requiredValues = Object.freeze({
    nodeControlBaseUrl: input.nodeControlBaseUrl,
    runtimeManagementBaseUrl: input.runtimeManagementBaseUrl,
    nodeControlBearerToken: input.nodeControlBearerToken,
    bindingId: input.bindingId,
    runId: input.runId,
    reportFile: input.reportFile,
  });
  for (const [keyName, value] of Object.entries(requiredValues))
    if (value.trim() === '')
      fail('POINT_AUTHORITY_CONFIGURATION_INVALID', `${keyName} is required.`);
  if (input.runId.length < 8 || input.runId.length > 128)
    fail('POINT_AUTHORITY_CONFIGURATION_INVALID', 'runId must contain 8-128 characters.');
  return Object.freeze({
    ...input,
    nodeControlBaseUrl: managementUrl(input.nodeControlBaseUrl),
    runtimeManagementBaseUrl: managementUrl(input.runtimeManagementBaseUrl),
    reportFile: resolve(input.reportFile),
  });
}

function managementUrl(value: string): string {
  const parsed = new URL(value);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== ''
  )
    fail(
      'POINT_AUTHORITY_CONFIGURATION_INVALID',
      'Management URL must be credential-free HTTP(S).',
    );
  return parsed.toString().replace(/\/$/u, '');
}

async function writeReport(path: string, report: PointAuthoritySuccessorReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid.toString()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([keyName, item]) => `${JSON.stringify(keyName)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export class PointAuthoritySuccessorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PointAuthoritySuccessorError';
  }
}

function fail(code: string, message: string): never {
  throw new PointAuthoritySuccessorError(code, message);
}

async function configurationFromEnvironment(): Promise<PointAuthoritySuccessorConfiguration> {
  const inlineToken = process.env['SDAR_CONTROL_API_TOKEN']?.trim();
  const tokenFile = process.env['SDAR_CONTROL_API_TOKEN_FILE']?.trim();
  if ((inlineToken === undefined) === (tokenFile === undefined))
    fail(
      'POINT_AUTHORITY_CONFIGURATION_INVALID',
      'Exactly one Node Control token source is required.',
    );
  let token: string;
  if (inlineToken !== undefined) token = inlineToken;
  else if (tokenFile !== undefined) token = (await readFile(tokenFile, 'utf8')).trim();
  else return fail('POINT_AUTHORITY_CONFIGURATION_INVALID', 'Node Control token is required.');
  return Object.freeze({
    nodeControlBaseUrl: process.env['SDAR_NODE_CONTROL_BASE_URL'] ?? '',
    runtimeManagementBaseUrl: process.env['SDAR_RUNTIME_MANAGEMENT_BASE_URL'] ?? '',
    nodeControlBearerToken: token,
    bindingId: process.env['SMPP_UGV_RUNTIME_BINDING_ID'] ?? 'ugv-smpp-real-integration-r2-binding',
    runId: process.env['SDAR_UGV_POINT_SUCCESSOR_RUN_ID'] ?? '',
    reportFile:
      process.env['SDAR_UGV_POINT_SUCCESSOR_REPORT_FILE'] ??
      'reports/sdar-ugv-smpp-integration/point-navigation-successor.redacted.json',
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void configurationFromEnvironment()
    .then((configuration) => reconcilePointAuthoritySuccessor(configuration))
    .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
    .catch((error: unknown) => {
      const code =
        error instanceof PointAuthoritySuccessorError
          ? error.code
          : 'POINT_AUTHORITY_UNEXPECTED_FAILURE';
      process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
      process.exitCode = 1;
    });
}
