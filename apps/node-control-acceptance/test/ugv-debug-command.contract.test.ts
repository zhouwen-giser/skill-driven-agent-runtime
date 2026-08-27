import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const roots: string[] = [];
const scriptUrl = new URL('../../../deploy/ugv-agent-profile-simulation/debug.sh', import.meta.url);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sdar-ugv-debug-command-'));
  roots.push(root);
  await mkdir(join(root, 'logs'));
  await mkdir(join(root, 'debug/sdar-telemetry'), { recursive: true });
  await mkdir(join(root, 'debug/benchmark'), { recursive: true });
  await writeFile(join(root, 'debug/sdar-telemetry/compose.env'), 'test-only');
  await writeFile(join(root, 'debug/benchmark/reader.json'), '{}');
  await writeFile(join(root, 'debug.sh'), await readFile(scriptUrl));
  await writeFile(join(root, 'data-sentinel'), 'existing data');
  await writeFile(
    join(root, 'common.sh'),
    `
UAP_STATE_ROOT='${root}'
UAP_SDAR_SERVICES=(postgres redis)
UAP_SMPP_SERVICES=(adapter runtime pms)
event() { printf '%s\\n' "$*" >> '${root}/events'; }
fault() { [[ "\${uap_debug_stage:-}" != "\${FAIL_STAGE:-!}" ]] || return 24; }
uap_require_local_tools() { event tools; }
uap_initialize_state() { event initialize; }
uap_existing_simulation_run_id() { printf 'reserved-run-id\\n'; }
uap_debug_authorize() { event authorize; return "\${UAP_TEST_AUTHORIZE_EXIT:-0}"; }
uap_sdar_compose() { event "sdar:$*"; fault; }
`,
  );
  await writeFile(
    join(root, 'debug-common.sh'),
    `
UAP_DEBUG_TELEMETRY_SERVICES=(clickhouse processor collector query)
UGV_DEBUG_STATE_ROOT='${root}/debug'
UAP_DEBUG_SDAR_TELEMETRY_SERVICES=(control-postgres gateway worker query admin domain-worker)
UAP_DEBUG_BENCHMARK_SERVICES=(postgres api reconciler evaluation-worker benchmark-worker projector)
UAP_DEBUG_SMPP_APPS=(adapter runtime pms)
uap_debug_profile() {
  if [[ "$1" == public-host ]]; then printf '192.168.6.7\\n'; return; fi
  event "profile:$*"; fault
}
uap_debug_network() { event network; fault; }
uap_debug_telemetry() { event "telemetry:$*"; fault; }
uap_debug_sdar_telemetry() { event "sdar-telemetry:$*"; fault; }
uap_debug_sdar_telemetry_config() { event "sdar-telemetry-config:$*"; fault; }
uap_debug_benchmark_config() { event "benchmark-config:$*"; fault; }
uap_debug_benchmark() { event "benchmark:$*"; fault; }
uap_debug_smpp() { event "smpp:$*"; fault; }
uap_debug_seed() { event seed; fault; }
uap_debug_wait_provider() { event catalog; fault; }
uap_debug_authority() { event authority; fault; }
uap_debug_status() { event status; }
uap_debug_supervisor() {
  event "supervisor:$*"
  if [[ "$1" == stop ]]; then return "\${UAP_TEST_STOP_EXIT:-0}"; fi
  if [[ "$*" == 'restart-server --side-effects NO' ]]; then return 0; fi
  fault || return $?
  if [[ "$1" == start ]]; then
    printf '{"status":"%s","sideEffects":"%s"}\\n' "\${START_STATUS:-started}" "\${START_MODE:-NO}"
  fi
}
`,
  );
  return {
    root,
    script: join(root, 'debug.sh'),
    events: async () => {
      try {
        return (await readFile(join(root, 'events'), 'utf8')).trim().split('\n');
      } catch {
        return [];
      }
    },
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const yes =
  'supervisor:restart-server --side-effects YES --simulation-run-id reserved-run-id --acknowledge I_ACKNOWLEDGE_UAP_P3_B02_SIMULATION_SIDE_EFFECTS';
describe('complete UGV joint-debug command', () => {
  it('status is read-only and stop includes all owned services without deleting data', async () => {
    const f = await fixture();
    await execute('bash', [f.script, 'status']);
    expect(await f.events()).toEqual(['status']);
    await execute('bash', [f.script, 'stop']);
    expect((await f.events()).slice(-6)).toEqual([
      'supervisor:stop',
      'smpp:stop adapter runtime pms',
      'telemetry:stop clickhouse processor collector query',
      'sdar-telemetry:stop control-postgres gateway worker query admin domain-worker',
      'benchmark:stop postgres api reconciler evaluation-worker benchmark-worker projector',
      'sdar:stop postgres redis',
    ]);
    expect(await readFile(join(f.root, 'data-sentinel'), 'utf8')).toBe('existing data');
  });
  it('starts the complete stack in order and enables YES only after authority and public Card', async () => {
    const f = await fixture();
    await execute('bash', [f.script, 'start'], { env: { PATH: process.env['PATH'] } });
    const events = await f.events();
    expect(events).toEqual([
      'tools',
      'initialize',
      'authorize',
      'profile:configure',
      'sdar-telemetry-config:configure',
      'benchmark-config:',
      'network',
      'sdar:up -d --wait postgres redis',
      'smpp:up -d --wait ugv-agent-profile-adapter-postgres ugv-agent-profile-runtime-postgres ugv-agent-profile-pms-postgres',
      'telemetry:build telemetry-processor query-api',
      'telemetry:up -d --wait clickhouse',
      'telemetry:run --rm --no-deps telemetry-migrate',
      'sdar-telemetry:build control-migrate',
      'sdar-telemetry:up -d --wait control-postgres',
      'sdar-telemetry:run --rm --no-deps control-migrate',
      'sdar-telemetry:run --rm --no-deps warehouse-migrate',
      'sdar-telemetry:run --rm --no-deps provider-migrate',
      'sdar-telemetry:run --rm --no-deps warehouse-preflight',
      'sdar-telemetry:run --rm --no-deps provider-bootstrap',
      'benchmark:build bootstrap',
      'benchmark:up -d --wait postgres',
      'benchmark:run --rm --no-deps warehouse-provision',
      'benchmark:run --rm --no-deps bootstrap',
      'telemetry:up -d --no-deps --wait telemetry-processor otel-collector query-api',
      'sdar-telemetry:up -d --no-deps --wait ingestion-gateway telemetry-worker query-api admin-api domain-projection-worker',
      'sdar-telemetry:run --rm --no-deps debug-bootstrap',
      'smpp:build adapter runtime pms',
      'smpp:up -d --wait ugv-agent-profile-pms-api ugv-agent-profile-adapter',
      'catalog',
      'smpp:up -d --no-deps --wait ugv-agent-profile-runtime ugv-agent-profile-pms-worker',
      'seed',
      'supervisor:start',
      'supervisor:restart-server --side-effects NO',
      'authority',
      'profile:wait-card',
      'sdar-telemetry-config:evidence',
      'benchmark:up -d --no-deps --wait api reconciler evaluation-worker benchmark-worker projector',
      'benchmark:run --rm --no-deps recover-meta-scope',
      yes,
      'status',
    ]);
  });
  it('restart reloads applications, retains infrastructure and uses explicitly selected identity', async () => {
    const f = await fixture();
    await execute('bash', [f.script, 'restart'], {
      env: {
        ...process.env,
        UGV_SIMULATION_RUN_ID: 'selected-authorized-run',
        ALLOW_UGV_SIMULATION_SIDE_EFFECTS: 'NO',
      },
    });
    const events = await f.events();
    expect(events).toContain(
      'smpp:up -d --no-deps --wait --force-recreate ugv-agent-profile-runtime ugv-agent-profile-pms-worker',
    );
    expect(events.indexOf('catalog')).toBeLessThan(
      events.indexOf(
        'smpp:up -d --no-deps --wait --force-recreate ugv-agent-profile-runtime ugv-agent-profile-pms-worker',
      ),
    );
    expect(events.indexOf('supervisor:stop')).toBeLessThan(events.indexOf('supervisor:start'));
    expect(events).toContain(yes.replace('reserved-run-id', 'selected-authorized-run'));
    expect(events.join('\n')).not.toMatch(/down|volumes|qualification|navigate|sendMessage/u);
  });
  it.each(['start', 'restart'])(
    'explicit NO for %s never requests YES authorization',
    async (command) => {
      const f = await fixture();
      await execute('bash', [f.script, command, 'NO'], {
        env: { ...process.env, UAP_TEST_AUTHORIZE_EXIT: '17' },
      });
      expect(await f.events()).not.toContain('authorize');
      expect((await f.events()).join('\n')).not.toContain('--side-effects YES');
      expect(await f.events()).toContain('supervisor:restart-server --side-effects NO');
    },
  );
  it('rejects unapproved YES before service operations', async () => {
    const f = await fixture();
    await expect(
      execute('bash', [f.script, 'restart'], {
        env: { ...process.env, UAP_TEST_AUTHORIZE_EXIT: '17' },
      }),
    ).rejects.toMatchObject({ code: 17 });
    expect(await f.events()).toEqual(['tools', 'initialize', 'authorize']);
  });
  it('never starts replacement host processes after stop ownership failure', async () => {
    const f = await fixture();
    await expect(
      execute('bash', [f.script, 'restart'], {
        env: { ...process.env, UAP_TEST_STOP_EXIT: '23' },
      }),
    ).rejects.toMatchObject({ code: 23 });
    expect(await f.events()).not.toContain('supervisor:start');
    expect(await f.events()).not.toContain(yes);
  });
  it.each([
    'configuration',
    'sdar-telemetry-configuration',
    'benchmark-configuration',
    'sdar-telemetry-build',
    'sdar-telemetry-infrastructure',
    'sdar-telemetry-migrations',
    'external-warehouse-additive-migration',
    'provider-v2-migration',
    'external-warehouse-contract',
    'provider-v2-origin',
    'benchmark-build',
    'benchmark-infrastructure',
    'benchmark-warehouse-access',
    'benchmark-registration-origin',
    'benchmark-projection-scope-recovery',
    'sdar-telemetry-start',
    'domain-projection-activation',
    'shared-network',
    'telemetry-build',
    'telemetry-migrations',
    'telemetry-start',
    'smpp-adapter-start',
    'provider-catalog',
    'smpp-start',
    'pms-registration',
    'sdar-start',
    'missing-authority',
    'public-card',
    'incremental-evidence',
    'benchmark-start',
    'enable-requested-mode',
  ])('failure at %s preserves data and never leaves new YES', async (stage) => {
    const f = await fixture();
    await expect(
      execute('bash', [f.script, 'start'], {
        env: { PATH: process.env['PATH'], FAIL_STAGE: stage },
      }),
    ).rejects.toMatchObject({ code: 24, stderr: expect.stringContaining(`stage=${stage}`) });
    const events = await f.events();
    expect(events).not.toContain('status');
    if (events.includes('supervisor:start'))
      expect(events.at(-1)).toBe('supervisor:restart-server --side-effects NO');
    if (stage !== 'enable-requested-mode') expect(events).not.toContain(yes);
    expect(await readFile(join(f.root, 'data-sentinel'), 'utf8')).toBe('existing data');
  });
  it('repeated start in YES does not restart an existing host task process', async () => {
    const f = await fixture();
    await execute('bash', [f.script, 'start'], {
      env: { PATH: process.env['PATH'], START_STATUS: 'already_running', START_MODE: 'YES' },
    });
    expect((await f.events()).filter((e) => e.startsWith('supervisor:'))).toEqual([
      'supervisor:start',
    ]);
    expect(await f.events()).toContain('authority');
  });
  it.each([
    [],
    ['clean'],
    ['status', 'YES'],
    ['start', 'invalid'],
    ['restart', '--side-effects', 'YES'],
  ])('rejects invalid arguments %j before any mutation', async (...args) => {
    const f = await fixture();
    await expect(execute('bash', [f.script, ...args])).rejects.toMatchObject({
      code: 64,
      stdout: '',
      stderr: 'UAP_DEBUG_COMMAND_INVALID: expected start|restart [YES|NO] or status|stop\n',
    });
    expect(await f.events()).toEqual([]);
  });
  it('keeps the package entry and excludes destructive acceptance workflows', async () => {
    const pkg: unknown = JSON.parse(
      await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
    );
    expect(pkg).toMatchObject({
      scripts: { 'ugv:debug': 'bash deploy/ugv-agent-profile-simulation/debug.sh' },
    });
    const source = await readFile(scriptUrl, 'utf8');
    expect(source).not.toMatch(/\b(clean|qualify|readiness|up-smpp|up-sdar)\.sh|down --volumes/u);
  });
});
