import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const temporaryRoots: string[] = [];
const scriptUrl = new URL('../../../deploy/ugv-agent-profile-simulation/debug.sh', import.meta.url);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sdar-ugv-debug-command-'));
  temporaryRoots.push(root);
  const script = join(root, 'debug.sh');
  await writeFile(script, await readFile(scriptUrl), { mode: 0o600 });
  // Only the process supervisor is substituted. No Docker, database, Provider or
  // production process can be reached by this command-dispatch contract.
  await writeFile(
    join(root, 'common.sh'),
    [
      'uap_supervisor() {',
      '  printf \'supervisor:%s\\n\' "$*"',
      '  if [[ "$1" == "stop" ]]; then return "${UAP_TEST_STOP_EXIT:-0}"; fi',
      '  if [[ "$1" == "restart-server" ]]; then return "${UAP_TEST_RESTART_EXIT:-0}"; fi',
      '  return 0',
      '}',
      "uap_existing_simulation_run_id() { printf 'reserved-run-id\\n'; }",
      'uap_authorize_b02_simulation_run_id() { return "${UAP_TEST_AUTHORIZE_EXIT:-0}"; }',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  return script;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('existing-stack UGV debug command', () => {
  const yesRestart =
    'supervisor:restart-server --side-effects YES --simulation-run-id reserved-run-id --acknowledge I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS\n';

  it.each(['status', 'stop'])(
    'delegates %s without extra startup or side-effect commands',
    async (command) => {
      const result = await execute('bash', [await fixture(), command]);
      expect(result.stdout).toBe(`supervisor:${command}\n`);
      expect(result.stderr).toBe('');
    },
  );

  it('starts in YES by default using the existing reserved identity', async () => {
    const result = await execute('bash', [await fixture(), 'start'], {
      env: { PATH: process.env['PATH'] },
    });
    expect(result.stdout).toBe(`supervisor:start\n${yesRestart}`);
    expect(result.stderr).toBe('');
  });

  it('reloads all source processes then binds YES to the selected authorized identity', async () => {
    const result = await execute('bash', [await fixture(), 'restart'], {
      env: {
        ...process.env,
        ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'NO',
        UGV_SIMULATION_RUN_ID: 'selected-authorized-run',
      },
    });
    expect(result.stdout).toBe(
      `supervisor:stop\nsupervisor:start\n${yesRestart.replace('reserved-run-id', 'selected-authorized-run')}`,
    );
    expect(result.stderr).toBe('');
  });

  it.each(['start', 'restart'])(
    'supports explicit NO for %s without requiring an attempt identity',
    async (command) => {
      const result = await execute('bash', [await fixture(), command, 'NO'], {
        env: { ...process.env, UAP_TEST_AUTHORIZE_EXIT: '17' },
      });
      expect(result.stdout).toBe(
        `${command === 'restart' ? 'supervisor:stop\n' : ''}supervisor:start\nsupervisor:restart-server --side-effects NO\n`,
      );
    },
  );

  it('rejects unauthorized YES before any process is stopped or started', async () => {
    await expect(
      execute('bash', [await fixture(), 'restart'], {
        env: { ...process.env, UAP_TEST_AUTHORIZE_EXIT: '17' },
      }),
    ).rejects.toMatchObject({ code: 17, stdout: '' });
  });

  it('does not start a replacement after an ownership/stop failure', async () => {
    await expect(
      execute('bash', [await fixture(), 'restart'], {
        env: { ...process.env, UAP_TEST_STOP_EXIT: '23' },
      }),
    ).rejects.toMatchObject({ code: 23, stdout: 'supervisor:stop\n' });
  });

  it('propagates a failed YES transition instead of reporting successful startup', async () => {
    await expect(
      execute('bash', [await fixture(), 'start'], {
        env: { PATH: process.env['PATH'], UAP_TEST_RESTART_EXIT: '19' },
      }),
    ).rejects.toMatchObject({ code: 19, stdout: `supervisor:start\n${yesRestart}` });
  });

  it.each([
    { arguments_: [] },
    { arguments_: ['clean'] },
    { arguments_: ['status', 'YES'] },
    { arguments_: ['start', 'invalid'] },
    { arguments_: ['restart', '--side-effects', 'YES'] },
  ])(
    'rejects invalid arguments before calling the supervisor: $arguments_',
    async ({ arguments_ }) => {
      await expect(execute('bash', [await fixture(), ...arguments_])).rejects.toMatchObject({
        code: 64,
        stdout: '',
        stderr: 'UAP_DEBUG_COMMAND_INVALID: expected start|restart [YES|NO] or status|stop\n',
      });
    },
  );

  it('publishes the same command from package.json', async () => {
    const packageSource: unknown = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    expect(packageSource).toMatchObject({
      scripts: { 'ugv:debug': 'bash deploy/ugv-agent-profile-simulation/debug.sh' },
    });
  });
});
