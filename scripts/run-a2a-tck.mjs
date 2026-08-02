import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';

const TCK_COMMIT = '5996b79f9cefa6fc390980e383e358a66fb9e49e';
const UV_VERSION = '0.11.28';
const workspace = process.cwd();
const tooling = join(tmpdir(), 'sdar-a2a-tck-tooling');
const toolVenv = join(tooling, 'uv-venv');
const tck = join(tooling, 'a2a-tck');
const python = process.platform === 'win32' ? 'python.exe' : 'python3';
const toolPython = join(
  toolVenv,
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const uv = join(toolVenv, process.platform === 'win32' ? 'Scripts/uv.exe' : 'bin/uv');
const tckPython = join(
  tck,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

await mkdir(tooling, { recursive: true });
if (!succeeds(toolPython, ['--version'])) run(python, ['-m', 'venv', toolVenv]);
const installedUvVersion = succeeds(uv, ['--version'])
  ? capture(uv, ['--version']).trim()
  : undefined;
if (
  installedUvVersion !== `uv ${UV_VERSION}` &&
  !installedUvVersion?.startsWith(`uv ${UV_VERSION} `)
) {
  if (!succeeds(toolPython, ['-m', 'pip', '--version'])) {
    run(toolPython, ['-m', 'ensurepip', '--upgrade']);
  }
  run(toolPython, ['-m', 'pip', 'install', '--disable-pip-version-check', `uv==${UV_VERSION}`]);
}
if (!succeeds('git', ['-C', tck, 'rev-parse', '--git-dir'])) {
  run('git', ['clone', 'https://github.com/a2aproject/a2a-tck.git', tck]);
}
run('git', ['-C', tck, 'checkout', '--detach', TCK_COMMIT]);
const actualCommit = capture('git', ['-C', tck, 'rev-parse', 'HEAD']).trim();
if (actualCommit !== TCK_COMMIT) throw new Error(`A2A_TCK_COMMIT_MISMATCH: ${actualCommit}`);
run(uv, ['sync', '--frozen'], tck);
if (!succeeds(tckPython, ['-m', 'pytest', '--version'])) {
  run(uv, ['venv', '--clear', join(tck, '.venv')], tck);
  run(uv, ['sync', '--frozen', '--reinstall'], tck);
}
run(process.execPath, [
  resolve(workspace, 'node_modules/typescript/bin/tsc'),
  '-p',
  'tsconfig.build.json',
]);

const server = spawn(process.execPath, [resolve(workspace, 'dist/apps/a2a-tck-sut/src/main.js')], {
  cwd: workspace,
  stdio: 'inherit',
});
try {
  await waitForAgentCard('http://127.0.0.1:9999/.well-known/agent-card.json');
  run(
    tckPython,
    [
      join(tck, 'run_tck.py'),
      '--sut-host',
      'http://127.0.0.1:9999',
      '--transport',
      'http_json',
      '--level',
      'must',
    ],
    tck,
  );
  const target = resolve(
    workspace,
    'reports/EP-01-protocol-domain-skeleton/a2a-tck-http-json-must-protocol-harness',
  );
  await mkdir(target, { recursive: true });
  for (const name of [
    'compatibility.json',
    'compatibility.html',
    'tck_report.html',
    'junitreport.xml',
  ]) {
    await cp(join(tck, 'reports', name), join(target, name));
  }
} finally {
  server.kill();
}

function run(command, args, cwd = workspace) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', timeout: 300_000 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`COMMAND_FAILED: ${command} ${args.join(' ')}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`COMMAND_FAILED: ${command} ${args.join(' ')}`);
  return result.stdout;
}

function succeeds(command, args) {
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 10_000 });
  return result.status === 0;
}

async function waitForAgentCard(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if (await isReachable(url)) return;
    } catch {
      // The server is still starting.
    }
    await setTimeout(250);
  }
  throw new Error('A2A_TCK_SUT_NOT_READY');
}

async function isReachable(url) {
  return new Promise((resolvePromise) => {
    const request = get(url, (response) => {
      response.resume();
      resolvePromise(
        response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 300,
      );
    });
    request.once('error', () => resolvePromise(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolvePromise(false);
    });
  });
}
