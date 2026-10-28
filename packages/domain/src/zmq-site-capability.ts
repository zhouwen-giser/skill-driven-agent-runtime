import { ZMQ_NATIVE_CONTROLS, type ZmqNativeTool } from './zmq-capability.js';
export type ZmqSiteProfile = 'zmq_v1_1_0_readonly_13' | 'zmq_v1_2_0_site_control_13';
const record = (v: unknown): v is Readonly<Record<string, unknown>> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
export function nativeZmqCatalogProfile(constraints: readonly Readonly<Record<string, unknown>>[]) {
  const adapters = constraints.filter((c) => c['type'] === 'zmq_input_adapter');
  const a = adapters[0];
  if (adapters.length !== 1 || !a) throw Error('ZMQ_INPUT_ADAPTER_AUTHORITY_INVALID');
  if (a['version'] === 1 && a['catalogProfile'] === undefined) return 'zmq_v1_0_1_12' as const;
  if (
    a['version'] === 2 &&
    (a['catalogProfile'] === 'zmq_v1_1_0_readonly_13' ||
      a['catalogProfile'] === 'zmq_v1_2_0_site_control_13')
  )
    return a['catalogProfile'];
  throw Error('ZMQ_CATALOG_PROFILE_UNREVIEWED');
}
export function assertNativeZmqExecutionContext(
  constraints: readonly Readonly<Record<string, unknown>>[],
  context: Readonly<{ mode: string; simulationId?: string | null }> | undefined,
  name: ZmqNativeTool,
) {
  const profile = nativeZmqCatalogProfile(constraints);
  if (profile === 'zmq_v1_0_1_12') {
    if (
      name === 'vehicle_zmq_plan_route' ||
      context?.mode !== 'simulation' ||
      !context.simulationId
    )
      throw Error('ZMQ_SIMULATION_CONTEXT_REQUIRED');
  } else {
    if (context?.mode !== 'live' || context.simulationId != null)
      throw Error('ZMQ_SITE_EXECUTION_CONTEXT_REQUIRED');
    if (profile === 'zmq_v1_1_0_readonly_13' && ZMQ_NATIVE_CONTROLS.has(name))
      throw Error('ZMQ_SITE_READONLY_CONTROL_FORBIDDEN');
  }
  return profile;
}
/** Versioned site report. Raw results retain their own provenance, including old isolated history. */
export function projectSiteZmqResult(
  name: ZmqNativeTool,
  value: unknown,
  resourceId: string,
  profile: ZmqSiteProfile,
) {
  if (!record(value) || !resourceId.trim()) throw Error('ZMQ_PROVIDER_RESULT_INVALID');
  if (typeof value['resourceId'] === 'string' && value['resourceId'] !== resourceId)
    throw Error('ZMQ_RESULT_RESOURCE_MISMATCH');
  const missing = new Set<string>();
  if (value['missingEvidence'] !== undefined) {
    if (
      !Array.isArray(value['missingEvidence']) ||
      !value['missingEvidence'].every((v) => typeof v === 'string')
    )
      throw Error('ZMQ_PROVIDER_RESULT_INVALID');
    for (const item of value['missingEvidence']) missing.add(item);
  }
  const businessFailure =
    typeof value['reasonCode'] === 'string' && typeof value['retryable'] === 'boolean';
  const rawState = value['nativeOutcome'] ?? value['executionState'];
  const state = typeof rawState === 'string' ? rawState : 'unknown';
  const canceled = ['canceled', 'cancelled'].includes(state);
  const failed = businessFailure || ['failed', 'rejected', 'timeout'].includes(state);
  if (
    !businessFailure &&
    ['vehicle_zmq_inspect_area', 'vehicle_get_inspection_result'].includes(name)
  ) {
    if (
      !['ugv.zmq-inspection-result/1', 'ugv.zmq-inspection-result/2'].includes(
        String(value['schemaVersion']),
      ) ||
      !record(value['inspectionReport']) ||
      !Array.isArray(value['anomalies'])
    )
      throw Error('ZMQ_INSPECTION_REPORT_INVALID');
    for (const item of [
      'COVERAGE_FOOTPRINTS_UNAVAILABLE',
      'TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE',
      'SOURCE_STREAM_COMPLETENESS_UNVERIFIED',
    ])
      missing.add(item);
  }
  if (ZMQ_NATIVE_CONTROLS.has(name)) {
    if (profile !== 'zmq_v1_2_0_site_control_13')
      throw Error('ZMQ_SITE_READONLY_CONTROL_FORBIDDEN');
    if (!failed && !canceled && !['completed', 'succeeded'].includes(state))
      missing.add('NATIVE_TERMINAL_SUCCESS_UNCONFIRMED');
    if (name === 'simulation_apply_effect') {
      if (value['executionFinished'] !== true) missing.add('SIMULATION_EXECUTION_NOT_CONFIRMED');
      if (
        !businessFailure &&
        (!record(value['targetProvenance']) ||
          !['manual', 'observation'].includes(String(value['targetProvenance']['kind'])))
      )
        throw Error('ZMQ_TARGET_PROVENANCE_REQUIRED');
    } else if (value['stopConfirmed'] !== true) missing.add('PHYSICAL_STOP_UNCONFIRMED');
  }
  if (
    name === 'vehicle_zmq_plan_route' &&
    !businessFailure &&
    (value['schemaVersion'] !== 'ugv.zmq-route-preview/1' || value['adoption'] !== 'preview_only')
  )
    throw Error('ZMQ_ROUTE_PREVIEW_REQUIRED');
  return {
    schemaVersion: 'sdar.zmq-skill-report/2',
    qualification: profile === 'zmq_v1_1_0_readonly_13' ? 'site_readonly' : 'site_control',
    catalogProfile: profile,
    resourceId,
    toolName: name,
    status: canceled ? 'cancelled' : failed ? 'failed' : missing.size ? 'degraded' : 'completed',
    providerResult: structuredClone(value),
    missingEvidence: [...missing],
  } as const;
}
