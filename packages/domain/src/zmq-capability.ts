import {
  nativeZmqCatalogProfile,
  projectSiteZmqResult,
  type ZmqSiteProfile,
} from './zmq-site-capability.js';
import { normalizeTaskTimestamp, type ResolvedMcpTaskExecution } from './mcp-task-availability.js';

export const ZMQ_NATIVE_TOOLS = Object.freeze([
  'vehicle_get_state',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_targets',
  'vehicle_zmq_navigate',
  'vehicle_zmq_area_recon',
  'vehicle_zmq_circular_recon',
  'vehicle_zmq_camera',
  'vehicle_zmq_inspect_area',
  'simulation_apply_effect',
  'vehicle_get_inspection_result',
  'simulation_get_effect_result',
] as const);
export const ZMQ_SITE_TOOLS = Object.freeze([
  ...ZMQ_NATIVE_TOOLS,
  'vehicle_zmq_plan_route',
] as const);
export type ZmqNativeTool = (typeof ZMQ_SITE_TOOLS)[number];
export const ZMQ_NATIVE_CONTROLS: ReadonlySet<string> = new Set([
  'vehicle_zmq_navigate',
  'vehicle_zmq_area_recon',
  'vehicle_zmq_circular_recon',
  'vehicle_zmq_camera',
  'vehicle_zmq_inspect_area',
  'simulation_apply_effect',
]);
export const zmqSkillId = (name: ZmqNativeTool) => `ugv.zmq.${name}`;
export const zmqCapabilityId = (name: ZmqNativeTool) => `vehicle.ugv.zmq.${name}`;
export function zmqToolForSkill(skillId: string): ZmqNativeTool | undefined {
  return ZMQ_SITE_TOOLS.find((name) => zmqSkillId(name) === skillId);
}
export function zmqToolForCapability(capabilityId: string): ZmqNativeTool | undefined {
  return ZMQ_SITE_TOOLS.find((name) => zmqCapabilityId(name) === capabilityId);
}
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
function fail(code: string): never {
  throw Error(code);
}

/** Parent deadlines are immutable; preparation and human confirmation consume the same budget. */
export function nativeZmqTaskExecution(timeWindow: unknown, now: string, startToleranceMs = 30000) {
  if (
    !record(timeWindow) ||
    Object.keys(timeWindow).sort().join(',') !== 'deadline,earliestStart' ||
    typeof timeWindow['earliestStart'] !== 'string' ||
    typeof timeWindow['deadline'] !== 'string'
  )
    fail('ZMQ_TIME_WINDOW_INVALID');
  const earliest = Date.parse(normalizeTaskTimestamp(timeWindow['earliestStart'])),
    end = Date.parse(normalizeTaskTimestamp(timeWindow['deadline'])),
    start = Math.max(earliest, Date.parse(normalizeTaskTimestamp(now))),
    remaining = end - start;
  if (end <= earliest || !Number.isSafeInteger(remaining) || remaining <= 0)
    fail('ZMQ_DEADLINE_EXPIRED');
  return {
    protocolMode: 'frozen_v1',
    availabilityCheck: 'required',
    timing: {
      start: {
        mode: 'scheduled',
        scheduledAt: new Date(start).toISOString(),
        startToleranceMs: Math.min(startToleranceMs, 60000, remaining - 1),
      },
      maxElapsedMs: Math.min(300000, remaining),
    },
  } as const satisfies ResolvedMcpTaskExecution;
}

/** The admitted Capability schema validates arguments; only the reviewed timing field is removed. */
export function nativeZmqDispatchInput(
  binding: Readonly<{
    requestedCapabilityId?: string;
    capabilityId?: string;
    inputSnapshot: unknown;
    constraintSnapshot: readonly Readonly<Record<string, unknown>>[];
  }>,
): Readonly<Record<string, unknown>> {
  const name = zmqToolForCapability(binding.requestedCapabilityId ?? binding.capabilityId ?? '');
  const adapters = binding.constraintSnapshot.filter((c) => c['type'] === 'zmq_input_adapter');
  const adapter = adapters[0],
    input = binding.inputSnapshot;
  if (
    !name ||
    adapters.length !== 1 ||
    !adapter ||
    ![1, 2].includes(Number(adapter['version'])) ||
    adapter['toolName'] !== name ||
    adapter['maxElapsedMs'] !== 300000 ||
    !record(input) ||
    typeof input['resourceId'] !== 'string' ||
    !input['resourceId'].trim()
  )
    fail('ZMQ_INPUT_ADAPTER_AUTHORITY_INVALID');
  const profile = nativeZmqCatalogProfile(binding.constraintSnapshot);
  if (profile === 'zmq_v1_0_1_12' && name === 'vehicle_zmq_plan_route')
    fail('ZMQ_TOOL_INPUT_INVALID');
  if (profile === 'zmq_v1_1_0_readonly_13' && ZMQ_NATIVE_CONTROLS.has(name))
    fail('ZMQ_SITE_READONLY_CONTROL_FORBIDDEN');
  if (!ZMQ_NATIVE_CONTROLS.has(name)) {
    if (Object.hasOwn(input, 'timeWindow')) fail('ZMQ_TOOL_INPUT_INVALID');
    return structuredClone(input);
  }
  const { timeWindow, ...args } = input;
  // Validate shape and ordering without choosing a new wall-clock anchor.
  if (!record(timeWindow) || typeof timeWindow['earliestStart'] !== 'string')
    fail('ZMQ_TIME_WINDOW_INVALID');
  nativeZmqTaskExecution(timeWindow, timeWindow['earliestStart']);
  return structuredClone(args);
}

/** Public reporting wrapper: preserve the original Provider result and never infer spatial completeness. */
export function projectNativeZmqResult(
  name: ZmqNativeTool,
  value: unknown,
  resourceId: string,
  profile: 'zmq_v1_0_1_12' | ZmqSiteProfile = 'zmq_v1_0_1_12',
) {
  if (profile !== 'zmq_v1_0_1_12') return projectSiteZmqResult(name, value, resourceId, profile);
  if (!record(value) || !resourceId.trim()) fail('ZMQ_PROVIDER_RESULT_INVALID');
  const missing = new Set<string>();
  if (value['missingEvidence'] !== undefined) {
    if (
      !Array.isArray(value['missingEvidence']) ||
      !value['missingEvidence'].every((v) => typeof v === 'string')
    )
      fail('ZMQ_PROVIDER_RESULT_INVALID');
    for (const item of value['missingEvidence']) missing.add(item);
  }
  if (name === 'vehicle_zmq_inspect_area' || name === 'vehicle_get_inspection_result') {
    if (
      value['schemaVersion'] !== 'ugv.zmq-inspection-result/1' ||
      !record(value['inspectionReport']) ||
      !Array.isArray(value['anomalies'])
    )
      fail('ZMQ_INSPECTION_REPORT_INVALID');
    for (const item of [
      'COVERAGE_FOOTPRINTS_UNAVAILABLE',
      'TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE',
      'SOURCE_STREAM_COMPLETENESS_UNVERIFIED',
    ])
      missing.add(item);
  }
  const businessFailure =
    typeof value['reasonCode'] === 'string' && value['retryable'] !== undefined;
  const nativeFailure =
    ['failed', 'rejected', 'cancelled', 'timeout'].includes(String(value['nativeOutcome'])) ||
    ['failed', 'rejected', 'cancelled', 'timeout'].includes(String(value['executionState']));
  if (name === 'simulation_apply_effect' && value['executionFinished'] !== true)
    missing.add('SIMULATION_EXECUTION_NOT_CONFIRMED');
  return {
    schemaVersion: 'sdar.zmq-skill-report/1',
    qualification: 'isolated_simulator_only',
    resourceId,
    toolName: name,
    status: businessFailure || nativeFailure ? 'failed' : missing.size ? 'degraded' : 'completed',
    providerResult: structuredClone(value),
    missingEvidence: [...missing],
  } as const;
}
