import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DRIVER_SCRIPT = resolve(REPOSITORY_ROOT, 'scripts/sdar-ugv-smpp/driver-command.mjs');
const DEPLOY_DIRECTORY = resolve(REPOSITORY_ROOT, 'deploy/ugv-smpp-integration');
const BOOTSTRAP_WRAPPER = resolve(DEPLOY_DIRECTORY, 'bootstrap.sh');

describe('UGV SMPP package-driver orchestration', () => {
  it('maps every deployment wrapper to an existing intentionally bounded package command', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8'),
    ) as { scripts?: Readonly<Record<string, string>> };
    const expected = {
      'preflight.sh': [['ugv:driver:preflight', 'node scripts/sdar-ugv-smpp/preflight.mjs']],
      'bootstrap.sh': [
        ['ugv:driver:bootstrap', 'node scripts/sdar-ugv-smpp/driver-command.mjs bootstrap'],
      ],
      'smoke-readonly.sh': [
        [
          'ugv:driver:smoke-readonly',
          'tsx apps/node-control-acceptance/src/ugv-smpp-deterministic-read-only-driver.ts',
          './node_modules/.bin/tsx apps/node-control-acceptance/src/ugv-smpp-deterministic-read-only-driver.ts',
        ],
      ],
      'qualify-a2a-readonly.sh': [
        [
          'ugv:driver:qualify-a2a-readonly',
          'tsx apps/node-control-acceptance/src/ugv-smpp-a2a-read-only-driver.ts',
          './node_modules/.bin/tsx apps/node-control-acceptance/src/ugv-smpp-a2a-read-only-driver.ts',
        ],
      ],
      'qualify-control.sh': [
        ['ugv:driver:control-gate', 'node scripts/sdar-ugv-smpp/control-gate.mjs'],
        [
          'ugv:driver:qualify-control',
          'node scripts/sdar-ugv-smpp/driver-command.mjs qualify-control',
        ],
      ],
    } as const;

    for (const [wrapper, mappings] of Object.entries(expected)) {
      const contents = await readFile(resolve(DEPLOY_DIRECTORY, wrapper), 'utf8');
      for (const [command, invocation, wrapperInvocation] of mappings) {
        expect(contents).toContain(wrapperInvocation ?? invocation);
        expect(packageJson.scripts?.[command]).toBe(invocation);
      }
    }
    expect(packageJson.scripts?.['ugv:driver:bootstrap-source']).toContain(
      'ugv-smpp-source-bootstrap-driver.ts',
    );
    expect(packageJson.scripts?.['ugv:driver:bootstrap-provider']).toContain(
      'ugv-smpp-provider-materialization-driver.ts',
    );
    expect(packageJson.scripts?.['ugv:driver:govern-capabilities']).toContain(
      'ugv-smpp-capability-governance-driver.ts',
    );
    expect(packageJson.scripts?.['ugv:driver:remediate-control-authority']).toContain(
      'ugv-smpp-control-authority-remediation-driver.ts',
    );
  });

  it('runs the non-mutating bootstrap wrapper without package-manager installation side effects', async () => {
    const result = await runScript('bash', [BOOTSTRAP_WRAPPER], integrationEnvironment());

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'blocked',
      phase: 'bootstrap',
      code: 'UGV_BOOTSTRAP_PIPELINE_PENDING',
      productionEligible: false,
      fireExecution: 'forbidden',
      externalOperationPerformed: false,
    });
    expect(result.stdout).toBe('');
  });

  it('pins the current unauthenticated PMS proxy, Runtime and dual unsafe test gate inventory', async () => {
    const environmentTemplate = await readFile(resolve(DEPLOY_DIRECTORY, '.env.example'), 'utf8');
    expect(environmentTemplate).toContain('NODE_ENV=test');
    expect(environmentTemplate).toContain('SDAR_CONTROL_ENVIRONMENT=integration');
    expect(environmentTemplate).toContain('SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY=unsafe_test_open');
    expect(environmentTemplate).toContain('SDAR_NODE_CONTROL_BASE_URL=http://127.0.0.1:10081');
    expect(environmentTemplate).toContain('SDAR_CONTROL_API_PORT=10081');
    expect(environmentTemplate).toContain('SDAR_CONTROL_PUBLIC_URL=http://127.0.0.1:10081');
    expect(environmentTemplate).toContain(
      'SDAR_CONTROL_NODE_EVENTS_URL=http://127.0.0.1:10081/api/v1/events',
    );
    expect(environmentTemplate).not.toContain('http://127.0.0.1:10080');
    expect(environmentTemplate).toContain(
      'SMPP_SDAR_REGISTRY_ENDPOINT=http://192.168.1.7:18088/api/v1/registry/production/consumers/sdar/v1/sources/ugv-smpp/latest',
    );
    expect(environmentTemplate).toContain('SMPP_REGISTRY_CREDENTIAL_REF=unauthenticated://none');
    expect(environmentTemplate).toContain('SMPP_SDAR_SYNC_MODE=poll');
    expect(environmentTemplate).toContain('SMPP_UGV_RUNTIME_BASE_URL=http://192.168.1.7:19100/');
    expect(environmentTemplate).toContain('SDAR_UGV_LOCAL_SERVER_ID=ugv-smpp-runtime');
    expect(environmentTemplate).toContain('SDAR_UGV_BINDING_ID=mcp-binding-ugv-smpp');
    expect(environmentTemplate).not.toMatch(/^ALLOW_REAL_UGV_FIRE=/mu);
  });

  it.each([
    ['bootstrap', 'UGV_BOOTSTRAP_PIPELINE_PENDING'],
    ['smoke-readonly', 'UGV_DETERMINISTIC_READ_ONLY_DRIVER_PENDING'],
  ])('blocks incomplete %s without performing an external operation', async (phase, code) => {
    const result = await runDriver(phase, integrationEnvironment());

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'blocked',
      phase,
      code,
      productionEligible: false,
      fireExecution: 'forbidden',
      externalOperationPerformed: false,
    });
    expect(result.stdout).toBe('');
  });

  it('reports A2A qualification pending when the real model is disabled', async () => {
    const result = await runDriver('qualify-a2a-readonly', integrationEnvironment());

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'pending',
      phase: 'qualify-a2a-readonly',
      code: 'UGV_REAL_MODEL_REQUIRED',
      externalOperationPerformed: false,
    });
  });

  it('distinguishes incomplete real-model configuration from the missing A2A driver', async () => {
    const incomplete = await runDriver(
      'qualify-a2a-readonly',
      integrationEnvironment({ SDAR_UGV_REAL_MODEL_ENABLED: 'YES' }),
    );
    expect(incomplete.exitCode).toBe(1);
    expect(JSON.parse(incomplete.stderr)).toMatchObject({
      status: 'blocked',
      code: 'UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE',
    });

    const secret = 'model-secret-never-report';
    const configured = await runDriver(
      'qualify-a2a-readonly',
      integrationEnvironment({
        SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
        SDAR_UGV_MODEL_PROVIDER_ID: 'real-provider',
        SDAR_UGV_MODEL_BASE_URL: 'http://192.168.1.8:11434/v1',
        SDAR_UGV_MODEL_NAME: 'structured-model',
        SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
        SDAR_UGV_MODEL_API_KEY: secret,
      }),
    );
    expect(configured.exitCode).toBe(1);
    expect(JSON.parse(configured.stderr)).toMatchObject({
      status: 'blocked',
      code: 'UGV_A2A_READ_ONLY_DRIVER_PENDING',
    });
    expect(configured.stderr).not.toContain(secret);
    expect(configured.stderr).not.toContain('192.168.1.8');
  });

  it('never treats the environment control gate as live execution authority', async () => {
    const closed = await runDriver('qualify-control', integrationEnvironment());
    expect(JSON.parse(closed.stderr)).toMatchObject({
      status: 'blocked',
      code: 'REAL_SIDE_EFFECT_GATE_CLOSED',
      externalOperationPerformed: false,
    });

    const open = await runDriver(
      'qualify-control',
      integrationEnvironment({
        ALLOW_REAL_UGV_SIDE_EFFECTS: 'YES',
        REAL_UGV_TEST_RUN_ID: '20260812T120000Z-command-test',
        UGV_TEST_RESOURCE_ID: 'ugv.public.vehicle-01',
        UGV_TEST_DISTANCE_M: '1',
        UGV_SITE_DISTANCE_LIMIT_M: '1.5',
        UGV_CONTROL_REQUEST_KIND: 'bounded_movement',
      }),
    );
    expect(open.exitCode).toBe(1);
    expect(JSON.parse(open.stderr)).toMatchObject({
      status: 'blocked',
      code: 'UGV_LIVE_CONTROL_DRIVER_PENDING',
      fireExecution: 'forbidden',
      externalOperationPerformed: false,
    });
  });

  it.each([
    [{ ALLOW_REAL_UGV_FIRE: 'NO' }, 'FIRE_GATE_FORBIDDEN'],
    [{ UGV_CONTROL_REQUEST_TEXT: 'fire weapon' }, 'WEAPON_REQUEST_FORBIDDEN'],
  ])('rejects every fire path before phase dispatch', async (override, code) => {
    const result = await runDriver('bootstrap', integrationEnvironment(override));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'blocked',
      code,
      fireExecution: 'forbidden',
      externalOperationPerformed: false,
    });
  });

  it.each([
    [{ NODE_ENV: undefined }, 'UNSAFE_OUTBOUND_POLICY_FORBIDDEN'],
    [{ NODE_ENV: 'production' }, 'UNSAFE_OUTBOUND_POLICY_FORBIDDEN'],
    [{ SDAR_CONTROL_ENVIRONMENT: 'production' }, 'UNSAFE_OUTBOUND_POLICY_FORBIDDEN'],
    [{ SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'safe' }, 'UGV_INTEGRATION_UNSAFE_POLICY_REQUIRED'],
  ])('requires the explicit dual non-production unsafe policy', async (override, code) => {
    const result = await runDriver('bootstrap', integrationEnvironment(override));
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ status: 'blocked', code });
  });
});

function integrationEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment))
    if (
      name.startsWith('SDAR_UGV_') ||
      name.startsWith('ALLOW_REAL_UGV') ||
      name.startsWith('ALLOW_UGV_') ||
      name.startsWith('REAL_UGV_') ||
      name.startsWith('UGV_') ||
      name === 'NODE_ENV' ||
      name === 'SDAR_CONTROL_ENVIRONMENT' ||
      name === 'SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY'
    )
      Reflect.deleteProperty(environment, name);
  Object.assign(environment, {
    NODE_ENV: 'test',
    SDAR_CONTROL_ENVIRONMENT: 'integration',
    SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
    SDAR_UGV_REAL_MODEL_ENABLED: 'NO',
    ALLOW_REAL_UGV_SIDE_EFFECTS: 'NO',
    ALLOW_UGV_COORDINATE_NAVIGATION: 'NO',
    ALLOW_REAL_UGV_RECON: 'NO',
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) Reflect.deleteProperty(environment, name);
    else environment[name] = value;
  }
  return environment;
}

interface ScriptResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runDriver(phase: string, environment: NodeJS.ProcessEnv): Promise<ScriptResult> {
  return runScript(process.execPath, [DRIVER_SCRIPT, phase], environment);
}

function runScript(
  executable: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<ScriptResult> {
  return new Promise((resolveResult) => {
    execFile(
      executable,
      arguments_,
      { cwd: REPOSITORY_ROOT, env: environment, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolveResult({
          exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}
