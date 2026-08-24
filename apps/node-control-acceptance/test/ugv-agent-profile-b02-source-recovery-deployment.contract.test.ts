import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..');
const DRIVER = resolve(
  REPOSITORY_ROOT,
  'apps/node-control-acceptance/src/ugv-agent-profile-b02-source-recovery-driver.ts',
);
const RUNNER = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/recover-b02-source-authority.mjs',
);
const ATTEMPT_IDENTITY = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/b02-attempt-identity.mjs',
);
const SUPERVISOR_CAPTURE = resolve(
  REPOSITORY_ROOT,
  'scripts/ugv-agent-profile-simulation/b02-supervisor-state.mjs',
);

describe('UAP-P3-B02 Source recovery deployment contract', () => {
  it('composes only the frozen issued-identity and formal supervisor capture APIs', async () => {
    const [runner, identity, supervisorCapture] = await Promise.all([
      readFile(RUNNER, 'utf8'),
      readFile(ATTEMPT_IDENTITY, 'utf8'),
      readFile(SUPERVISOR_CAPTURE, 'utf8'),
    ]);

    expect(identity).toContain('export async function validateIssuedB02AttemptIdentity(');
    expect(runner).toContain(
      "import { validateIssuedB02AttemptIdentity } from './b02-attempt-identity.mjs';",
    );
    expect(runner).toContain('captureB02SupervisorState,');
    expect(runner).toContain('validateB02SupervisorState }');
    expect(runner).toContain("from './b02-supervisor-state.mjs';");
    expect(runner).not.toContain('authorizeB02SimulationId');
    expect(runner).not.toContain('UGV_B02_SUPERVISOR_SIDE_EFFECTS');
    expect(runner).toContain("captureSupervisor('NO', capturePath");
    expect(supervisorCapture).toContain("'sdar.ugv-agent-profile.host-process-status/v2'");
    for (const key of [
      'schemaVersion',
      'status',
      'processCount',
      'sideEffects',
      'bootstrapRunId',
      'manifestRevision',
      'activeSimulationRunId',
      'processIdentitySha256',
    ])
      expect(supervisorCapture).toContain(`'${key}'`);
    for (const processName of ['server', 'nodeControlApi', 'nodeControlWorker'])
      expect(supervisorCapture).toContain(`'${processName}'`);
    expect(supervisorCapture).toContain('dependencies.expectedSimulationRunId');
    expect(runner).toContain('authorization.bootstrapRunId,');
    expect(runner).toContain('capture.bootstrapRunId !== expectedBootstrapRunId');
  });

  it('orders issued authorization, NO capture, authority freeze, and optional bootstrap', async () => {
    const driver = await readFile(DRIVER, 'utf8');
    const body = sliceBetween(
      driver,
      'export async function recoverUgvB02SourceAuthority(',
      '\nasync function validateAttemptAuthorization(',
    );

    expectOrdered(body, [
      'validateAttemptAuthorization(configuration, dependencies)',
      'requireSupervisorNoCapture(dependencies, authorization.bootstrapRunId)',
      'readAuthority(configuration, request)',
      'freezeAuthority(configuration, preReads',
      'assertDurableAuthorityRunway(pre)',
      'remainingTtlMs >= SOURCE_RECOVERY_REFRESH_RUNWAY_MS',
      'dependencies.bootstrapSource ?? bootstrapUgvSmppSource',
    ]);
    expect(driver).not.toMatch(/\b(controlPost|materializeProvider|rebindProvider)\s*\(/u);
    expect(driver).toContain("readonly action: 'not_required' | 'refreshed';");
    expect(driver).toContain('snapshotTtlSeconds !== EXPECTED_SOURCE_SNAPSHOT_TTL_SECONDS');
  });

  it('requires side-effect authorization isolation and owns private first-writer evidence', async () => {
    const runner = await readFile(RUNNER, 'utf8');
    const isolation = runner.indexOf('environment.ALLOW_UGV_SIMULATION_SIDE_EFFECTS !== undefined');
    const configuration = runner.indexOf(
      'const configuration = await ugvB02SourceRecoveryConfigurationFromEnvironment',
    );
    expect(isolation).toBeGreaterThan(-1);
    expect(configuration).toBeGreaterThan(isolation);
    expect(runner).toContain("'source-recovery-supervisor'");
    expect(runner).toContain("'source-recovery-reports'");
    expect(runner).toContain('dependencies.writePrivateReport ?? writePrivateLedger');
    expect(runner).toContain("status: 'passed',");
    expect(runner).toContain('action: result.report.action');
    expect(runner).not.toContain('process.stdout.write(`${JSON.stringify(result.report)');
    expect(runner).toContain('const existingEnvelope = await readPrivateJsonIfExists(reportPath)');
    expect(runner).toContain('return verifyExistingReplay(');
    expect(runner).toContain('verifyUgvB02SourceRecoveryReplayAuthority');
    expect(runner).toMatch(/if \(!isNodeError\(error, 'EEXIST'\)\)/u);
    expect(runner).not.toMatch(/\b(unlink|rm|rename|truncate)\s*\(/u);
  });
});

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function expectOrdered(source: string, values: readonly string[]): void {
  let prior = -1;
  for (const value of values) {
    const index = source.indexOf(value);
    expect(index, `missing or unordered Source recovery step: ${value}`).toBeGreaterThan(prior);
    prior = index;
  }
}
