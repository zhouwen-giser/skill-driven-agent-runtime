import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const PUBLIC_RESOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/u;
const WEAPON_REQUEST =
  /\b(?:fire|weapon|shoot|missile|munition|armament|effector)\b|开火|武器|射击|发射|弹药/iu;
const CONTROL_KINDS = new Set([
  'bounded_movement',
  'coordinate_navigation',
  'reconnaissance',
  'pause_resume_cancel',
  'emergency_stop',
]);

export class UgvControlGateError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'UgvControlGateError';
    this.code = code;
  }
}

/**
 * This validates only deployment/operator inputs. It is not execution authority. The control
 * driver must still prove every listed live authority immediately before every side effect.
 *
 * @param {NodeJS.ProcessEnv} environment
 * @param {{ kind?: string, text?: string }} request
 */
export function evaluateUgvControlGate(environment = process.env, request = {}) {
  if (Object.hasOwn(environment, 'ALLOW_REAL_UGV_FIRE')) fail('FIRE_GATE_FORBIDDEN');

  const requestKind = (
    request.kind ??
    environment['UGV_CONTROL_REQUEST_KIND'] ??
    'bounded_movement'
  ).trim();
  const requestText = (request.text ?? environment['UGV_CONTROL_REQUEST_TEXT'] ?? '').trim();
  if (WEAPON_REQUEST.test(requestKind) || WEAPON_REQUEST.test(requestText))
    fail('WEAPON_REQUEST_FORBIDDEN');
  if (!CONTROL_KINDS.has(requestKind)) fail('CONTROL_REQUEST_KIND_INVALID');

  if (environment['ALLOW_REAL_UGV_SIDE_EFFECTS']?.trim() !== 'YES')
    fail('REAL_SIDE_EFFECT_GATE_CLOSED');
  const runId = required(environment, 'REAL_UGV_TEST_RUN_ID', 128);
  if (!RUN_ID.test(runId)) fail('REAL_UGV_TEST_RUN_ID_INVALID');
  const resourceId = required(environment, 'UGV_TEST_RESOURCE_ID', 256);
  if (!PUBLIC_RESOURCE.test(resourceId) || /[*?]/u.test(resourceId))
    fail('UGV_TEST_RESOURCE_ID_INVALID');

  const configuredSiteLimit = optionalPositiveDecimal(environment, 'UGV_SITE_DISTANCE_LIMIT_M', 2);
  const maximumDistanceM = Math.min(2, configuredSiteLimit);
  const distanceM =
    requestKind === 'bounded_movement'
      ? positiveDecimal(environment, 'UGV_TEST_DISTANCE_M')
      : undefined;
  if (distanceM !== undefined && distanceM > maximumDistanceM)
    fail('UGV_TEST_DISTANCE_EXCEEDS_LIMIT');

  const coordinateTargetConfigured =
    requestKind === 'coordinate_navigation' ? assertCoordinateGate(environment) : false;
  if (requestKind === 'reconnaissance') assertReconGate(environment);

  return Object.freeze({
    status: 'environment_gate_passed',
    requestKind,
    targetResourceId: resourceId,
    ...(distanceM === undefined ? {} : { requestedDistanceM: distanceM }),
    maximumDistanceM,
    coordinateTargetConfigured,
    fireExecution: 'forbidden',
    authorityGate: 'pending_live_driver_verification',
    requiredBeforeEverySideEffect: Object.freeze([
      'real_test_run_id_unused',
      'sdar_active_tasks_zero',
      'sdar_uncertain_tasks_zero',
      'smpp_task_authority_available',
      'smpp_active_tasks_zero',
      'smpp_uncertain_tasks_zero',
      'ugv_state_fresh',
      'ugv_connected_and_available',
      'ugv_has_no_unowned_task',
      'ugv_stationary_within_safe_speed_threshold',
      'provider_binding_current_and_available',
      'catalog_checksum_matches_approved_authority',
      'side_effect_semantics_match_approved_catalog',
      'plan_is_awaiting_confirmation',
      'explicit_plan_confirmation_recorded',
      'no_prior_or_uncertain_remote_dispatch_for_attempt',
    ]),
  });
}

/** @param {NodeJS.ProcessEnv} environment */
function assertCoordinateGate(environment) {
  if (environment['ALLOW_UGV_COORDINATE_NAVIGATION']?.trim() !== 'YES')
    fail('COORDINATE_GATE_CLOSED');
  const point = boundedJson(required(environment, 'UGV_TEST_SAFE_POINT_JSON', 16_384));
  if (
    !isRecord(point) ||
    !sameKeys(point, ['altitude', 'latitude', 'longitude']) ||
    !boundedCoordinate(point.latitude, -90, 90) ||
    !boundedCoordinate(point.longitude, -180, 180) ||
    typeof point.altitude !== 'number' ||
    !Number.isFinite(point.altitude)
  )
    fail('SAFE_POINT_FIXTURE_INVALID');
  return true;
}

/** @param {NodeJS.ProcessEnv} environment */
function assertReconGate(environment) {
  if (environment['ALLOW_REAL_UGV_RECON']?.trim() !== 'YES') fail('RECON_GATE_CLOSED');
  const region = boundedJson(required(environment, 'UGV_TEST_RECON_REGION_JSON', 65_536));
  if (!isRecord(region)) fail('RECON_REGION_FIXTURE_INVALID');
}

/** @param {string} value */
function boundedJson(value) {
  if (WEAPON_REQUEST.test(value)) fail('WEAPON_REQUEST_FORBIDDEN');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fail('OPERATOR_FIXTURE_JSON_INVALID');
  }
  assertJsonDepth(parsed, 0);
  return parsed;
}

/** @param {unknown} value @param {number} depth */
function assertJsonDepth(value, depth) {
  if (depth > 12) fail('OPERATOR_FIXTURE_JSON_INVALID');
  if (Array.isArray(value)) {
    for (const item of value) assertJsonDepth(item, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertJsonDepth(item, depth + 1);
  }
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} value @param {readonly string[]} expected */
function sameKeys(value, expected) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** @param {unknown} value @param {number} minimum @param {number} maximum */
function boundedCoordinate(value, minimum, maximum) {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name @param {number} maximum */
function required(environment, name, maximum) {
  const value = environment[name]?.trim();
  if (
    value === undefined ||
    value === '' ||
    value.length > maximum ||
    containsControlCharacter(value)
  )
    fail('CONTROL_CONFIGURATION_INVALID');
  return value;
}

/** @param {string} value */
function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/** @param {NodeJS.ProcessEnv} environment @param {string} name */
function positiveDecimal(environment, name) {
  return parsePositiveDecimal(required(environment, name, 32));
}

/**
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} name
 * @param {number} fallback
 */
function optionalPositiveDecimal(environment, name, fallback) {
  const raw = environment[name]?.trim();
  return raw === undefined || raw === '' ? fallback : parsePositiveDecimal(raw);
}

/** @param {string} raw */
function parsePositiveDecimal(raw) {
  if (!DECIMAL.test(raw)) fail('UGV_DISTANCE_INVALID');
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail('UGV_DISTANCE_INVALID');
  return value;
}

/** @param {readonly string[]} arguments_ */
function requestFromArguments(arguments_) {
  /** @type {{ kind?: string, text?: string }} */
  const request = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === '--request-kind' && value !== undefined) {
      request.kind = value;
      index += 1;
    } else if (argument === '--request-text' && value !== undefined) {
      request.text = value;
      index += 1;
    } else {
      fail('CONTROL_ARGUMENT_INVALID');
    }
  }
  return request;
}

/** @param {string} code */
function fail(code) {
  throw new UgvControlGateError(code);
}

function main() {
  try {
    const report = evaluateUgvControlGate(process.env, requestFromArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const code = error instanceof UgvControlGateError ? error.code : 'UGV_CONTROL_GATE_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
