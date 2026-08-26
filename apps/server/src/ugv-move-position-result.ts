const EARTH_RADIUS_M = 6_371_008.8;
const FROZEN_CHASSIS_FRESHNESS_MS = 3_000;
const FROZEN_MAX_FUTURE_SKEW_MS = 1_000;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export interface UgvMovePositionPolicy {
  readonly toleranceM: number;
  readonly minimumDisplacementM: number;
  readonly maxFinalStateAgeMs: number;
}

/** Freezes the deployment-owned evidence thresholds before any external state is opened. */
export function snapshotUgvMovePositionPolicy(
  policy: UgvMovePositionPolicy | undefined,
): UgvMovePositionPolicy {
  return validatePolicy(policy);
}

export interface UgvMoveStateRead {
  readonly operationName: 'vehicle_get_state';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly result: unknown;
}

export interface UgvMoveProviderTerminal {
  readonly status: 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';
  readonly remoteTaskId: string;
  readonly runtimeRevision: string;
  readonly observedAt: string;
  readonly result?: unknown;
}

export interface UgvMoveOutcomeAssessmentInput {
  readonly resourceId: string;
  readonly expectedProviderId: string;
  readonly expectedExecutionMode?: 'live' | 'simulation';
  readonly correlationId: string;
  readonly dispatchedAt: string;
  readonly assessedAt: string;
  readonly target: Readonly<{ longitude: number; latitude: number }>;
  readonly policy?: UgvMovePositionPolicy;
  readonly initialState: UgvMoveStateRead;
  readonly providerTerminal: UgvMoveProviderTerminal;
  readonly finalState?: UgvMoveStateRead;
  readonly executionAudit: Readonly<{
    navigationDispatchCount: number;
    forbiddenOperationCount: number;
  }>;
}

export type UgvMoveOutcomeAssessment =
  | Readonly<{
      status: 'completed';
      reasonCode: 'UGV_MOVE_FINAL_POSITION_CONFIRMED';
      evidence: UgvMovePositionEvidence;
    }>
  | Readonly<{
      status: 'failed' | 'cancelled' | 'uncertain';
      reasonCode: UgvMoveOutcomeFailureCode;
    }>;

export interface UgvMovePositionEvidence {
  readonly evidenceType: 'position.observation';
  readonly resourceId: string;
  readonly correlationId: string;
  readonly remoteTaskId: string;
  readonly providerRuntimeRevision: string;
  readonly providerSnapshotRevision: string;
  readonly initialStateRevision: string;
  readonly finalStateRevision: string;
  readonly initialCursor: string;
  readonly providerCursor: string;
  readonly finalCursor: string;
  readonly observedAt: string;
  readonly coordinateReferenceSystem: 'WGS84';
  readonly coordinateOrder: 'longitude_latitude';
  readonly target: Readonly<{ longitude: number; latitude: number }>;
  readonly finalPosition: Readonly<{ longitude: number; latitude: number }>;
  readonly distanceToTargetM: number;
  readonly toleranceM: number;
  readonly displacementM: number;
  readonly minimumDisplacementM: number;
}

export type UgvMoveOutcomeFailureCode =
  | 'UGV_MOVE_POSITION_POLICY_REQUIRED'
  | 'UGV_MOVE_TARGET_INVALID'
  | 'UGV_MOVE_DISPATCH_CARDINALITY_INVALID'
  | 'UGV_MOVE_FORBIDDEN_OPERATION_OBSERVED'
  | 'UGV_MOVE_PROVIDER_TASK_NOT_TERMINAL'
  | 'UGV_MOVE_PROVIDER_TASK_FAILED'
  | 'UGV_MOVE_PROVIDER_TASK_CANCELLED'
  | 'UGV_MOVE_PROVIDER_RESULT_INVALID'
  | 'UGV_MOVE_FINAL_STATE_REQUIRED'
  | 'UGV_MOVE_FINAL_STATE_NOT_POST_TERMINAL'
  | 'UGV_MOVE_FINAL_POSITION_INVALID'
  | 'UGV_MOVE_EVIDENCE_RESOURCE_MISMATCH'
  | 'UGV_MOVE_EVIDENCE_CORRELATION_MISMATCH'
  | 'UGV_MOVE_EVIDENCE_STALE'
  | 'UGV_MOVE_EVIDENCE_REVISION_MISMATCH'
  | 'UGV_MOVE_EVIDENCE_CURSOR_MISMATCH'
  | 'UGV_MOVE_FINAL_POSITION_OUT_OF_TOLERANCE'
  | 'UGV_MOVE_DISPLACEMENT_NOT_DISCERNIBLE';

/** Provider completion is necessary but never sufficient for Skill completion. */
export function assessUgvMoveOutcome(
  input: UgvMoveOutcomeAssessmentInput,
): UgvMoveOutcomeAssessment {
  const policy = validatePolicy(input.policy);
  if (!validPosition(input.target)) return failed('UGV_MOVE_TARGET_INVALID');
  if (input.executionAudit.navigationDispatchCount !== 1)
    return failed('UGV_MOVE_DISPATCH_CARDINALITY_INVALID');
  if (input.executionAudit.forbiddenOperationCount !== 0)
    return failed('UGV_MOVE_FORBIDDEN_OPERATION_OBSERVED');
  if (input.providerTerminal.status === 'failed') return failed('UGV_MOVE_PROVIDER_TASK_FAILED');
  if (input.providerTerminal.status === 'cancelled')
    return Object.freeze({
      status: 'cancelled' as const,
      reasonCode: 'UGV_MOVE_PROVIDER_TASK_CANCELLED' as const,
    });
  if (input.providerTerminal.status !== 'completed')
    return uncertain('UGV_MOVE_PROVIDER_TASK_NOT_TERMINAL');

  const dispatchTime = time(input.dispatchedAt);
  const terminalTime = time(input.providerTerminal.observedAt);
  const assessedTime = time(input.assessedAt);
  if (
    !Number.isFinite(dispatchTime) ||
    !Number.isFinite(terminalTime) ||
    !Number.isFinite(assessedTime) ||
    terminalTime < dispatchTime ||
    assessedTime < terminalTime ||
    input.providerTerminal.remoteTaskId.trim() === '' ||
    input.providerTerminal.runtimeRevision.trim() === '' ||
    input.correlationId.trim() === ''
  )
    return failed('UGV_MOVE_PROVIDER_RESULT_INVALID');

  const provider = providerResult(input.providerTerminal.result);
  if (provider === undefined) return failed('UGV_MOVE_PROVIDER_RESULT_INVALID');
  if (
    provider.positionObservedAtMs <= dispatchTime ||
    provider.resultObservedAtMs <= dispatchTime ||
    !freshAuthority(terminalTime, provider.positionObservedAtMs) ||
    !freshAuthority(terminalTime, provider.resultObservedAtMs)
  )
    return failed('UGV_MOVE_PROVIDER_RESULT_INVALID');
  if (provider.resourceId !== input.resourceId)
    return failed('UGV_MOVE_EVIDENCE_RESOURCE_MISMATCH');
  if (provider.correlationStrength === 'MISMATCH')
    return failed('UGV_MOVE_EVIDENCE_CORRELATION_MISMATCH');

  const finalRead = input.finalState;
  if (finalRead === undefined) return failed('UGV_MOVE_FINAL_STATE_REQUIRED');
  const initialStartedAt = time(input.initialState.startedAt);
  const initialCompletedAt = time(input.initialState.completedAt);
  const finalStartedAt = time(finalRead.startedAt);
  const finalCompletedAt = time(finalRead.completedAt);
  if (
    !Number.isFinite(initialStartedAt) ||
    !Number.isFinite(initialCompletedAt) ||
    !Number.isFinite(finalStartedAt) ||
    !Number.isFinite(finalCompletedAt) ||
    initialCompletedAt < initialStartedAt ||
    initialCompletedAt > dispatchTime ||
    finalStartedAt < terminalTime ||
    finalCompletedAt < finalStartedAt ||
    finalCompletedAt > assessedTime
  )
    return failed('UGV_MOVE_FINAL_STATE_NOT_POST_TERMINAL');

  const initial = stateObservation(
    input.initialState.result,
    input.expectedProviderId,
    input.expectedExecutionMode ?? 'simulation',
  );
  const final = stateObservation(
    finalRead.result,
    input.expectedProviderId,
    input.expectedExecutionMode ?? 'simulation',
  );
  if (initial === undefined || final === undefined)
    return failed('UGV_MOVE_FINAL_POSITION_INVALID');
  if (initial.resourceId !== input.resourceId || final.resourceId !== input.resourceId)
    return failed('UGV_MOVE_EVIDENCE_RESOURCE_MISMATCH');
  if (
    final.chassisObservedAtMs <= dispatchTime ||
    !freshAuthority(dispatchTime, initial.chassisObservedAtMs, policy.maxFinalStateAgeMs) ||
    !freshAuthority(assessedTime, final.chassisObservedAtMs, policy.maxFinalStateAgeMs)
  )
    return failed('UGV_MOVE_EVIDENCE_STALE');
  if (initial.revision === final.revision || provider.snapshotRevision.trim() === '')
    return failed('UGV_MOVE_EVIDENCE_REVISION_MISMATCH');
  const initialCursor = cursor(initial.cursor);
  const providerCursor = providerCursorSequence(
    provider.cursor,
    provider.positionObservedAt,
    provider.positionTimeAuthority,
    provider.positionField,
    provider.positionTopic,
  );
  const finalCursor = cursor(final.cursor);
  if (
    initialCursor === undefined ||
    providerCursor === undefined ||
    finalCursor === undefined ||
    providerCursor <= initialCursor ||
    finalCursor <= initialCursor ||
    finalCursor < providerCursor
  )
    return failed('UGV_MOVE_EVIDENCE_CURSOR_MISMATCH');

  const distanceToTargetM = haversineDistanceM(final.position, input.target);
  if (!Number.isFinite(distanceToTargetM)) return failed('UGV_MOVE_FINAL_POSITION_INVALID');
  if (distanceToTargetM > policy.toleranceM)
    return failed('UGV_MOVE_FINAL_POSITION_OUT_OF_TOLERANCE');
  const displacementM = haversineDistanceM(initial.position, final.position);
  if (!Number.isFinite(displacementM)) return failed('UGV_MOVE_FINAL_POSITION_INVALID');
  if (displacementM < policy.minimumDisplacementM)
    return failed('UGV_MOVE_DISPLACEMENT_NOT_DISCERNIBLE');

  return Object.freeze({
    status: 'completed' as const,
    reasonCode: 'UGV_MOVE_FINAL_POSITION_CONFIRMED' as const,
    evidence: Object.freeze({
      evidenceType: 'position.observation' as const,
      resourceId: input.resourceId,
      correlationId: input.correlationId,
      remoteTaskId: input.providerTerminal.remoteTaskId,
      providerRuntimeRevision: input.providerTerminal.runtimeRevision,
      providerSnapshotRevision: provider.snapshotRevision,
      initialStateRevision: initial.revision,
      finalStateRevision: final.revision,
      initialCursor: initial.cursor,
      providerCursor: provider.cursor,
      finalCursor: final.cursor,
      observedAt: new Date(final.chassisObservedAtMs).toISOString(),
      coordinateReferenceSystem: 'WGS84' as const,
      coordinateOrder: 'longitude_latitude' as const,
      target: Object.freeze({ ...input.target }),
      finalPosition: Object.freeze({ ...final.position }),
      distanceToTargetM,
      toleranceM: policy.toleranceM,
      displacementM,
      minimumDisplacementM: policy.minimumDisplacementM,
    }),
  });
}

export function haversineDistanceM(
  left: Readonly<{ longitude: number; latitude: number }>,
  right: Readonly<{ longitude: number; latitude: number }>,
): number {
  const latitude1 = radians(left.latitude);
  const latitude2 = radians(right.latitude);
  const latitudeDelta = latitude2 - latitude1;
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  const clamped = Math.min(1, Math.max(0, a));
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

function validatePolicy(policy: UgvMovePositionPolicy | undefined): UgvMovePositionPolicy {
  if (
    policy === undefined ||
    !positive(policy.toleranceM) ||
    policy.toleranceM > 2 ||
    !positive(policy.minimumDisplacementM) ||
    !Number.isSafeInteger(policy.maxFinalStateAgeMs) ||
    policy.maxFinalStateAgeMs < 1 ||
    policy.maxFinalStateAgeMs > FROZEN_CHASSIS_FRESHNESS_MS
  )
    throw new UgvMoveOutcomeConfigurationError(
      'UGV_MOVE_POSITION_POLICY_REQUIRED',
      'UGV move requires explicit positive tolerance, displacement, and freshness limits.',
    );
  return Object.freeze({ ...policy });
}

function providerResult(value: unknown) {
  const record = object(value);
  const authority = object(record?.['positionAuthority']);
  const correlationStrength = record?.['correlationStrength'];
  const resultObservedAt =
    typeof record?.['observedAt'] === 'string' ? time(record['observedAt']) : NaN;
  const positionObservedAtText =
    typeof authority?.['observedAt'] === 'string' ? authority['observedAt'] : undefined;
  const positionObservedAt =
    positionObservedAtText === undefined ? NaN : time(positionObservedAtText);
  if (
    typeof record?.['resourceId'] !== 'string' ||
    record['status'] !== 'completed' ||
    typeof record['snapshotRevision'] !== 'string' ||
    !Number.isFinite(resultObservedAt) ||
    record['observationAuthority'] !== 'post_dispatch' ||
    (correlationStrength !== 'STRICT_CORRELATED' &&
      correlationStrength !== 'WEAK_UNCORRELATED' &&
      correlationStrength !== 'MISMATCH') ||
    (authority?.['field'] !== 'chassis.position.geodetic' &&
      authority?.['field'] !== 'chassis.position.local') ||
    typeof authority['topic'] !== 'string' ||
    authority['topic'].trim() === '' ||
    (authority['field'] === 'chassis.position.geodetic' && authority['topic'] !== '/ugv/gnss') ||
    (authority['field'] === 'chassis.position.local' && authority['topic'] !== '/ugv/nav_state') ||
    (authority['timeAuthority'] !== 'source' && authority['timeAuthority'] !== 'ingest') ||
    positionObservedAtText === undefined ||
    !Number.isFinite(positionObservedAt) ||
    typeof authority['cursor'] !== 'string'
  )
    return undefined;
  return {
    resourceId: record['resourceId'],
    snapshotRevision: record['snapshotRevision'],
    correlationStrength,
    cursor: authority['cursor'],
    positionField: authority['field'],
    positionTopic: authority['topic'],
    positionObservedAt: positionObservedAtText,
    positionTimeAuthority: authority['timeAuthority'],
    resultObservedAtMs: resultObservedAt,
    positionObservedAtMs: positionObservedAt,
  } as const;
}

function stateObservation(
  value: unknown,
  expectedProviderId: string,
  executionMode: 'live' | 'simulation',
) {
  const state = object(value);
  const identity = object(state?.['identity']);
  const connectivity = object(state?.['connectivity']);
  const chassis = object(state?.['chassis']);
  const position = object(chassis?.['position']);
  const freshness = object(state?.['freshness']);
  const snapshotObservedAt =
    typeof state?.['observedAt'] === 'string' ? time(state['observedAt']) : NaN;
  const chassisObservedAt =
    typeof freshness?.['chassisObservedAt'] === 'string'
      ? time(freshness['chassisObservedAt'])
      : NaN;
  if (
    expectedProviderId.trim() === '' ||
    identity?.['providerId'] !== expectedProviderId ||
    typeof identity['resourceId'] !== 'string' ||
    identity['vehicleType'] !== 'ugv' ||
    (identity['executionMode'] !== executionMode &&
      !(executionMode === 'live' && identity['executionMode'] === undefined)) ||
    typeof state?.['revision'] !== 'string' ||
    state['revision'].trim() === '' ||
    connectivity === undefined ||
    typeof connectivity['mqttConnected'] !== 'boolean' ||
    typeof connectivity['deviceMcpConnected'] !== 'boolean' ||
    typeof state['mqttIngressSequence'] !== 'number' ||
    !Number.isSafeInteger(state['mqttIngressSequence']) ||
    state['mqttIngressSequence'] < 0 ||
    !Number.isFinite(snapshotObservedAt) ||
    !Number.isFinite(chassisObservedAt) ||
    typeof position?.['longitude'] !== 'number' ||
    !Number.isFinite(position['longitude']) ||
    position['longitude'] < -180 ||
    position['longitude'] > 180 ||
    typeof position['latitude'] !== 'number' ||
    !Number.isFinite(position['latitude']) ||
    position['latitude'] < -90 ||
    position['latitude'] > 90
  )
    return undefined;
  return {
    resourceId: identity['resourceId'],
    revision: state['revision'],
    cursor: String(state['mqttIngressSequence']),
    chassisObservedAtMs: chassisObservedAt,
    position: Object.freeze({
      longitude: position['longitude'],
      latitude: position['latitude'],
    }),
  };
}

function cursor(value: string): bigint | undefined {
  return /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : undefined;
}

/**
 * Strict local projection of the SMPP ObservationCursorV1 wire contract for UGV evidence,
 * frozen from sdar-mcp-provider-platform@ce57d3d7/packages/vehicle-provider-core/src/observation-cursor.ts.
 */
function providerCursorSequence(
  value: string,
  expectedObservedAt: string,
  expectedTimeAuthority: 'source' | 'ingest',
  expectedField: 'chassis.position.geodetic' | 'chassis.position.local',
  expectedTopic: string,
): bigint | undefined {
  if (!value.startsWith('oc1.') || value.length > 4_096) return undefined;
  const encoded = value.slice(4);
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return undefined;
  let decoded: unknown;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return undefined;
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
  const record = object(decoded);
  if (
    record?.['version'] !== 1 ||
    record['kind'] !== 'field' ||
    record['field'] !== expectedField ||
    typeof record['topic'] !== 'string' ||
    record['topic'].trim() === '' ||
    record['topic'].length > 2_048 ||
    record['topic'] !== expectedTopic ||
    typeof record['observedAt'] !== 'string' ||
    record['observedAt'].length > 64 ||
    !RFC3339.test(record['observedAt']) ||
    !Number.isFinite(time(record['observedAt'])) ||
    record['observedAt'] !== expectedObservedAt ||
    (record['timeAuthority'] !== 'source' && record['timeAuthority'] !== 'ingest') ||
    record['timeAuthority'] !== expectedTimeAuthority ||
    !Number.isSafeInteger(record['ingestSequence']) ||
    (record['ingestSequence'] as number) < 0 ||
    typeof record['payloadHash'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(record['payloadHash'])
  )
    return undefined;
  const expectedKeys = new Set([
    'version',
    'kind',
    'field',
    'topic',
    'observedAt',
    'timeAuthority',
    ...(record['sourceSequence'] === undefined ? [] : ['sourceSequence']),
    'ingestSequence',
    'payloadHash',
  ]);
  if (
    Object.keys(record).some((key) => !expectedKeys.has(key)) ||
    Object.keys(record).length !== expectedKeys.size ||
    (record['sourceSequence'] !== undefined &&
      (typeof record['sourceSequence'] !== 'string' || record['sourceSequence'].length > 1_024))
  )
    return undefined;
  return BigInt(record['ingestSequence'] as number);
}

function object(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function time(value: string): number {
  return Date.parse(value);
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function freshAuthority(
  referenceTime: number,
  observedAt: number,
  maximumAgeMs = FROZEN_CHASSIS_FRESHNESS_MS,
): boolean {
  const age = referenceTime - observedAt;
  return age >= -FROZEN_MAX_FUTURE_SKEW_MS && age <= maximumAgeMs;
}

function validPosition(value: Readonly<{ longitude: number; latitude: number }>): boolean {
  return (
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90
  );
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function failed(reasonCode: UgvMoveOutcomeFailureCode): UgvMoveOutcomeAssessment {
  return Object.freeze({ status: 'failed' as const, reasonCode });
}

function uncertain(reasonCode: UgvMoveOutcomeFailureCode): UgvMoveOutcomeAssessment {
  return Object.freeze({ status: 'uncertain' as const, reasonCode });
}

export class UgvMoveOutcomeConfigurationError extends Error {
  constructor(
    readonly code: Extract<UgvMoveOutcomeFailureCode, 'UGV_MOVE_POSITION_POLICY_REQUIRED'>,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveOutcomeConfigurationError';
  }
}
