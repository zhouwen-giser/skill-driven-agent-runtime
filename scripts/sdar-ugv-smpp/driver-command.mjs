import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { evaluateUgvControlGate, UgvControlGateError } from './control-gate.mjs';

const PHASES = new Set(['bootstrap', 'smoke-readonly', 'qualify-a2a-readonly', 'qualify-control']);
const WEAPON_REQUEST =
  /\b(?:fire|weapon|shoot|missile|munition|armament|effector)\b|开火|武器|射击|发射|弹药/iu;
const MODEL_FIELDS = [
  'SDAR_UGV_MODEL_PROVIDER_ID',
  'SDAR_UGV_MODEL_BASE_URL',
  'SDAR_UGV_MODEL_NAME',
  'SDAR_UGV_MODEL_API_STYLE',
];

export class UgvDriverCommandError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'UgvDriverCommandError';
    this.code = code;
  }
}

/**
 * Returns a redacted non-success state for phases whose complete governed driver is not yet wired.
 * This status router intentionally performs no network, database, subprocess or device operation.
 *
 * @param {string} phase
 * @param {NodeJS.ProcessEnv} environment
 */
export function evaluateUgvDriverCommand(phase, environment = process.env) {
  if (!PHASES.has(phase)) fail('UGV_DRIVER_PHASE_INVALID');
  assertFireForbidden(environment);
  assertCurrentIntegrationPolicy(environment);

  if (phase === 'bootstrap') {
    assertWriteGatesClosed(environment);
    const modelEnabled = environment['SDAR_UGV_REAL_MODEL_ENABLED']?.trim() === 'YES';
    if (modelEnabled) assertCompleteModelConfiguration(environment);
    return blocked(phase, 'UGV_BOOTSTRAP_PIPELINE_PENDING', [
      ...(modelEnabled ? ['governed_model_bootstrap'] : []),
      'atomic_bootstrap_orchestrator',
    ]);
  }
  if (phase === 'smoke-readonly') {
    assertWriteGatesClosed(environment);
    return blocked(phase, 'UGV_DETERMINISTIC_READ_ONLY_DRIVER_PENDING', [
      'deterministic_read_only_driver',
      'terminal_provider_observation',
    ]);
  }
  if (phase === 'qualify-a2a-readonly') {
    assertWriteGatesClosed(environment);
    if (environment['SDAR_UGV_REAL_MODEL_ENABLED']?.trim() !== 'YES')
      return pending(phase, 'UGV_REAL_MODEL_REQUIRED', ['real_model_configuration']);
    assertCompleteModelConfiguration(environment);
    return blocked(phase, 'UGV_A2A_READ_ONLY_DRIVER_PENDING', [
      'real_model_connectivity_evidence',
      'a2a_read_only_driver',
      'terminal_provider_observation',
    ]);
  }

  try {
    evaluateUgvControlGate(environment);
  } catch (error) {
    const code = error instanceof UgvControlGateError ? error.code : 'UGV_CONTROL_GATE_FAILED';
    return blocked(phase, code, ['operator_environment_gate']);
  }
  return blocked(phase, 'UGV_LIVE_CONTROL_DRIVER_PENDING', [
    'live_sdar_and_smpp_safety_authority',
    'durable_plan_confirmation',
    'single_dispatch_control_driver',
    'terminal_provider_observation',
  ]);
}

/** @param {NodeJS.ProcessEnv} environment */
function assertCurrentIntegrationPolicy(environment) {
  if (environment['SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY']?.trim() !== 'unsafe_test_open')
    fail('UGV_INTEGRATION_UNSAFE_POLICY_REQUIRED');
  if (
    !['development', 'test'].includes(environment['NODE_ENV']?.trim() ?? '') ||
    !['development', 'test', 'integration'].includes(
      environment['SDAR_CONTROL_ENVIRONMENT']?.trim() ?? '',
    )
  )
    fail('UNSAFE_OUTBOUND_POLICY_FORBIDDEN');
}

/** @param {NodeJS.ProcessEnv} environment */
function assertWriteGatesClosed(environment) {
  for (const name of [
    'ALLOW_REAL_UGV_SIDE_EFFECTS',
    'ALLOW_UGV_COORDINATE_NAVIGATION',
    'ALLOW_REAL_UGV_RECON',
  ]) {
    const value = environment[name]?.trim();
    if (value !== undefined && value !== '' && value !== 'NO') fail('WRITE_GATE_NOT_CLOSED');
  }
}

/** @param {NodeJS.ProcessEnv} environment */
function assertFireForbidden(environment) {
  if (Object.hasOwn(environment, 'ALLOW_REAL_UGV_FIRE')) fail('FIRE_GATE_FORBIDDEN');
  for (const name of ['UGV_CONTROL_REQUEST_KIND', 'UGV_CONTROL_REQUEST_TEXT'])
    if (WEAPON_REQUEST.test(environment[name]?.trim() ?? '')) fail('WEAPON_REQUEST_FORBIDDEN');
}

/** @param {NodeJS.ProcessEnv} environment */
function assertCompleteModelConfiguration(environment) {
  if (MODEL_FIELDS.some((name) => (environment[name]?.trim() ?? '') === ''))
    fail('UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE');
  const apiStyle = environment['SDAR_UGV_MODEL_API_STYLE']?.trim();
  if (!['openai_chat_completions', 'anthropic_messages'].includes(apiStyle ?? ''))
    fail('UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE');
  const inline = environment['SDAR_UGV_MODEL_API_KEY']?.trim() ?? '';
  const file = environment['SDAR_UGV_MODEL_API_KEY_FILE']?.trim() ?? '';
  if ((inline === '') === (file === '')) fail('UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE');
  let endpoint;
  try {
    endpoint = new URL(environment['SDAR_UGV_MODEL_BASE_URL'] ?? '');
  } catch {
    return fail('UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== ''
  )
    fail('UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE');
}

/** @param {string} phase @param {string} code @param {readonly string[]} pendingComponents */
function blocked(phase, code, pendingComponents) {
  return status('blocked', phase, code, pendingComponents);
}

/** @param {string} phase @param {string} code @param {readonly string[]} pendingComponents */
function pending(phase, code, pendingComponents) {
  return status('pending', phase, code, pendingComponents);
}

/**
 * @param {'blocked' | 'pending'} state
 * @param {string} phase
 * @param {string} code
 * @param {readonly string[]} pendingComponents
 */
function status(state, phase, code, pendingComponents) {
  return Object.freeze({
    status: state,
    phase,
    code,
    productionEligible: false,
    fireExecution: 'forbidden',
    externalOperationPerformed: false,
    pendingComponents: Object.freeze([...pendingComponents]),
  });
}

/** @param {string} code */
function fail(code) {
  throw new UgvDriverCommandError(code);
}

function main() {
  try {
    if (process.argv.length !== 3) fail('UGV_DRIVER_ARGUMENT_INVALID');
    const result = evaluateUgvDriverCommand(process.argv[2] ?? '');
    process.stderr.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'pending' ? 2 : 1;
  } catch (error) {
    const code = error instanceof UgvDriverCommandError ? error.code : 'UGV_DRIVER_COMMAND_FAILED';
    process.stderr.write(
      `${JSON.stringify({
        status: 'blocked',
        code,
        productionEligible: false,
        fireExecution: 'forbidden',
        externalOperationPerformed: false,
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
