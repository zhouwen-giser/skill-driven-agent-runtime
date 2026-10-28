import { reviewedZmqCatalog, type ZmqCatalogProfile } from './zmq-catalogs.js';
import { createHash } from 'node:crypto';
import type { JsonSchemaValidator } from '../../application/src/ports.js';
import catalog from './zmq-catalog-contract.json' with { type: 'json' };
import { nativeZmqTaskExecution } from '../../domain/src/zmq-capability.js';
import { deriveFrozenMcpCatalogAuthority } from '../../domain/src/mcp-catalog-authority.js';
import { normalizeTaskTimestamp } from '../../domain/src/mcp-task-availability.js';
import type { McpTool } from '../../domain/src/mcp.js';
import type { McpProtocolDiscoverySnapshot } from '../../domain/src/mcp-frozen-protocol.js';

export const ZMQ_CATALOG_PROFILE = 'zmq_v1_0_1_12';
export const ZMQ_REVIEWED_TOOL_NAMES = Object.freeze(catalog.tools.map((t) => t.name).sort());
const controls = new Set(
  catalog.tools
    .filter((t) => t._meta['io.sdar/taskExecution'].taskBehavior === 'task_required')
    .map((t) => t.name),
);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : record(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
function fail(code: string): never {
  throw new Error(code);
}
export const ZMQ_CONTRACT_SHA256 = hash(catalog);
export const zmqContractChecksum = hash;
export interface ZmqConsumerAuthority {
  readonly bindingId: string;
  readonly providerId: string;
  readonly resourceId: string;
  readonly localServerId: string;
  readonly bindingRevision: number;
  readonly registryRevision: number;
  readonly registryChecksum: string;
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
  readonly simulationId: string;
  readonly validUntil: string;
}
function requireAuthority(a: ZmqConsumerAuthority, now: string) {
  if (
    Object.keys(a).sort().join(',') !==
    [
      'bindingId',
      'providerId',
      'resourceId',
      'localServerId',
      'bindingRevision',
      'registryRevision',
      'registryChecksum',
      'catalogRevision',
      'catalogChecksum',
      'simulationId',
      'validUntil',
    ]
      .sort()
      .join(',')
  )
    fail('ZMQ_AUTHORITY_FIELDS_INVALID');
  for (const key of [
    'bindingId',
    'providerId',
    'resourceId',
    'localServerId',
    'catalogRevision',
    'simulationId',
  ] as const)
    if (typeof a[key] !== 'string' || !a[key].trim()) fail('ZMQ_AUTHORITY_IDENTITY_REQUIRED');
  if (
    ![a.bindingRevision, a.registryRevision].every((v) => Number.isSafeInteger(v) && v > 0) ||
    ![a.registryChecksum, a.catalogChecksum].every((v) => /^[a-f0-9]{64}$/.test(v))
  )
    fail('ZMQ_AUTHORITY_LINEAGE_INVALID');
  if (Date.parse(normalizeTaskTimestamp(a.validUntil)) <= Date.parse(normalizeTaskTimestamp(now)))
    fail('ZMQ_AUTHORITY_EXPIRED');
}
export function assertZmqCatalogContract(
  tools: readonly McpTool[],
  resourceId: string,
  profile: ZmqCatalogProfile = 'zmq_v1_0_1_12',
) {
  const reviewed = reviewedZmqCatalog(profile);
  if (
    canonical(tools.map((t) => t.toolName).sort()) !==
    canonical(reviewed.tools.map((t) => t.name).sort())
  )
    fail('ZMQ_CATALOG_TOOL_SET_MISMATCH');
  for (const tool of tools) {
    const expected = reviewed.tools.find((t) => t.name === tool.toolName);
    if (!expected) fail('ZMQ_TOOL_UNREVIEWED');
    const { source, ...semantics } = tool.executionSemantics;
    if (
      source !== 'mcp_declared' ||
      canonical(semantics) !== canonical(expected._meta['io.sdar/tool-execution-semantics'])
    )
      fail('ZMQ_EXECUTION_SEMANTICS_MISMATCH');
    const input = structuredClone(tool.inputSchema);
    if (
      !record(input) ||
      !record(input['properties']) ||
      !record(input['properties']['resourceId']) ||
      input['properties']['resourceId']['const'] !== resourceId
    )
      fail('ZMQ_RESOURCE_BINDING_MISMATCH');
    input['properties']['resourceId']['const'] = '__RESOURCE_ID__';
    if (
      canonical(input) !== canonical(expected.inputSchema) ||
      canonical(tool.outputSchema) !== canonical(expected.outputSchema) ||
      canonical(tool.taskExecutionProfile) !== canonical(expected._meta['io.sdar/taskExecution']) ||
      tool.protocolMode !== 'frozen_v1'
    )
      fail('ZMQ_TOOL_CONTRACT_MISMATCH');
  }
}
/** Pure preparation. Existing CAS governance, G0 acceptance and confirmation still own publication/dispatch. */
export function buildZmqConsumerCandidate(
  authority: ZmqConsumerAuthority,
  discovery: Pick<
    McpProtocolDiscoverySnapshot,
    'protocolVersion' | 'serverInfo' | 'providerCatalog'
  >,
  tools: readonly McpTool[],
  now: string,
) {
  requireAuthority(authority, now);
  if (
    discovery.protocolVersion !== '2026-07-28' ||
    discovery.providerCatalog?.providerType !== 'isr.vehicle.ugv.zmq' ||
    tools.some((tool) => tool.serverId !== authority.localServerId)
  )
    fail('ZMQ_PROVIDER_AUTHORITY_MISMATCH');
  assertZmqCatalogContract(tools, authority.resourceId);
  const current = deriveFrozenMcpCatalogAuthority(discovery, tools, authority.bindingRevision);
  if (
    current.catalogChecksum !== authority.catalogChecksum ||
    current.catalogRevision !== authority.catalogRevision ||
    discovery.providerCatalog.providerId !== authority.providerId
  )
    fail('ZMQ_CATALOG_AUTHORITY_MISMATCH');
  return {
    schemaVersion: 'sdar.ugv-zmq-consumer-candidate/1',
    catalogProfile: ZMQ_CATALOG_PROFILE,
    contractSha256: ZMQ_CONTRACT_SHA256,
    authority: structuredClone(authority),
    candidateHash: hash({ authority, contract: ZMQ_CONTRACT_SHA256 }),
    dispatchAuthorized: false,
    publicationState: 'candidate_qualification_pending',
    executionMode: 'simulation',
    capabilities: tools.map((tool) => ({
      capabilityId: `vehicle.ugv.zmq.${tool.toolName}`,
      skillId: `ugv.zmq.${tool.toolName}`,
      toolName: tool.toolName,
      resourceId: authority.resourceId,
      providerId: authority.providerId,
      taskProfile: tool.taskExecutionProfile,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      confirmation: controls.has(tool.toolName) ? 'explicit_plan_required' : 'none',
      automaticReplay: 'forbidden',
      parentBoundMaxElapsedMs: controls.has(tool.toolName) ? 300000 : null,
      resultPolicy:
        tool.toolName === 'simulation_apply_effect'
          ? 'terminal_and_supplemental_versions_independent'
          : 'evidence_required',
      binding: { ...authority },
    })),
    patrolComposition: {
      state: 'blocked',
      legacyCapability: 'embodied.area_patrol',
      requiredSuccessor: 'explicit_zmq_patrol_contract',
      reasons: [
        'COVERAGE_FOOTPRINTS_UNAVAILABLE',
        'TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE',
        'SOURCE_STREAM_COMPLETENESS_UNVERIFIED',
      ],
      legacyInspectionSubstitution: 'forbidden',
    },
    publicationGates: [
      'G0_SOURCE_QUALIFICATION',
      'CURRENT_CAS_GOVERNANCE',
      'SINGLE_WRITER_HANDOFF',
      'EXACT_SKILL_VERSION_PUBLICATION',
    ],
  } as const;
}
/** Parent deadline is anchored; confirmation, preparation and pause consume the same budget. */
export function zmqTaskExecution(timeWindow: unknown, now: string) {
  return nativeZmqTaskExecution(timeWindow, now);
}
export function zmqToolArguments(
  toolName: string,
  input: unknown,
  resourceId: string,
  schemas: Pick<JsonSchemaValidator, 'validate'>,
  profile: ZmqCatalogProfile = 'zmq_v1_0_1_12',
) {
  const expected = reviewedZmqCatalog(profile).tools.find((t) => t.name === toolName);
  if (!expected || !record(input)) fail('ZMQ_TOOL_INPUT_INVALID');
  const { timeWindow, ...args } = input;
  void timeWindow;
  const schema = structuredClone(expected.inputSchema);
  const properties = schema['properties'];
  if (!record(properties) || !record(properties['resourceId'])) fail('ZMQ_TOOL_INPUT_INVALID');
  properties['resourceId']['const'] = resourceId;
  if (!schemas.validate(schema, args).valid) fail('ZMQ_TOOL_INPUT_INVALID');
  if (toolName === 'vehicle_zmq_inspect_area' || toolName === 'vehicle_zmq_area_recon') {
    const area = args['area'];
    if (!record(area) || !Array.isArray(area['vertices'])) fail('ZMQ_AREA_INVALID');
    const points = area['vertices'].map((p) => {
      if (!record(p) || typeof p['longitude'] !== 'number' || typeof p['latitude'] !== 'number')
        fail('ZMQ_AREA_INVALID');
      return { x: p['longitude'], y: p['latitude'] };
    });
    const point = (i: number) => points[i % 4] ?? fail('ZMQ_AREA_INVALID');
    const signs = points.map((p, i) => {
      const b = point(i + 1),
        c = point(i + 2);
      if (Math.abs(b.x - p.x) > 180) fail('ZMQ_AREA_INVALID');
      return Math.sign((b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x));
    });
    if (!signs.every((s) => s === 1) && !signs.every((s) => s === -1)) fail('ZMQ_AREA_INVALID');
  }
  return args;
}
/** No received-frame empty report can establish complete area patrol. */
export function projectZmqInspection(value: unknown) {
  if (
    !record(value) ||
    value['schemaVersion'] !== 'ugv.zmq-inspection-result/1' ||
    !record(value['inspectionReport']) ||
    !Array.isArray(value['anomalies']) ||
    !Array.isArray(value['missingEvidence'])
  )
    fail('ZMQ_INSPECTION_REPORT_INVALID');
  const missing = new Set(value['missingEvidence']);
  for (const e of [
    'COVERAGE_FOOTPRINTS_UNAVAILABLE',
    'TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE',
    'SOURCE_STREAM_COMPLETENESS_UNVERIFIED',
  ])
    missing.add(e);
  return {
    ...structuredClone(value),
    status: 'degraded',
    completeSpatialEvidence: false,
    missingEvidence: [...missing],
  };
}
