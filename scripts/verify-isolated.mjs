import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { inputClass, inputDigest } from './lib/verification-inputs.mjs';
import { runVerificationProcess, verificationProcessPassed } from './lib/verification-process.mjs';
import { copyExternalVerificationInputs } from './lib/verification-external-inputs.mjs';
import { verificationProjects } from './lib/verification-projects.mjs';
import { cleanupVerificationMigrations } from './lib/verification-cleanup.mjs';

const root = process.cwd();
const dependencyMode = process.argv.includes('--frozen') ? 'frozen' : 'reuse';
const controller = new globalThis.AbortController();
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error('Run through pnpm verify:isolated.');
const runId = `sdar-verify-${randomUUID()}`;
const directory = await mkdtemp(join(tmpdir(), `${runId}-`));
const snapshot = join(directory, 'source');
const reports = join(root, 'reports', 'runtime-semantic-closure', runId);
await mkdir(snapshot);
await mkdir(reports, { recursive: true });
const files = capture(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0');
const inputs = [];
for (const file of [...new Set(files)].sort()) {
  if (!isSourceInput(file)) continue;
  const source = join(root, file);
  const stat = await lstat(source).catch((error) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (stat === undefined) continue;
  if (!stat.isFile()) throw new Error(`ISOLATED_SOURCE_NOT_REGULAR:${file}`);
  await mkdir(dirname(join(snapshot, file)), { recursive: true });
  const content = await readFile(source);
  await writeFile(join(snapshot, file), content, { mode: stat.mode });
  inputs.push({ path: file, sha256: createHash('sha256').update(content).digest('hex') });
}
if (dependencyMode === 'reuse') {
  await symlink(join(root, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
  await symlink(
    join(root, 'apps/console/node_modules'),
    join(snapshot, 'apps/console/node_modules'),
    'dir',
  );
}
const commit = capture(['rev-parse', 'HEAD']).trim();
inputs.push(...(await copyExternalVerificationInputs(dirname(root), directory)));
// Protocol checks inspect pinned historical blobs. Give them an independent object database,
// not a link to the developer's .git and not global GIT_DIR (which would corrupt TCK git reads).
const gitDirectory = join(directory, 'source-history.git');
const gitCopy = await runVerificationProcess({
  command: 'git',
  args: ['clone', '--bare', '--local', '--no-hardlinks', root, gitDirectory],
  cwd: root,
  timeoutMs: 60_000,
  signal: controller.signal,
  logPath: join(reports, 'git-snapshot.log'),
});
await writeFile(join(reports, 'git-snapshot.json'), JSON.stringify(gitCopy, null, 2));
if (!verificationProcessPassed(gitCopy)) throw new Error('ISOLATED_GIT_SNAPSHOT_FAILED');
for (const [key, value] of [
  ['core.bare', 'false'],
  ['core.worktree', snapshot],
]) {
  const configured = await runVerificationProcess({
    command: 'git',
    args: ['--git-dir', gitDirectory, 'config', key, value],
    cwd: root,
    timeoutMs: 60_000,
    signal: controller.signal,
    logPath: join(reports, `git-${key}.log`),
  });
  await writeFile(join(reports, `git-${key}.json`), JSON.stringify(configured, null, 2));
  if (!verificationProcessPassed(configured)) throw new Error('ISOLATED_GIT_CONFIGURATION_FAILED');
}
await writeFile(join(snapshot, '.git'), `gitdir: ${gitDirectory}\n`);
const inputSha256 = inputDigest(inputs, 'runtime');
const baselineSha256 = inputDigest(inputs, 'baseline');
await writeFile(
  join(reports, 'inputs.json'),
  JSON.stringify(
    {
      runId,
      commit,
      dependencyMode,
      inputSha256,
      baselineSha256,
      snapshot,
      inputs: inputs.map((entry) => ({ ...entry, classification: inputClass(entry.path) })),
    },
    null,
    2,
  ),
);
await copyFile(join(reports, 'inputs.json'), join(snapshot, 'verification-inputs.json'));
await rm(join(snapshot, 'reports/verification'), { recursive: true, force: true });
await rm(join(snapshot, 'reports/.phase12-e2e-progress.json'), { force: true });
const [postgresPort, redisPort, a2aPort, managementPort] = await availablePorts().catch(
  async (error) => {
    await writeFile(
      join(reports, 'run.json'),
      JSON.stringify(
        {
          runId,
          inputSha256,
          snapshot,
          phase: 'port-allocation',
          exitCode: 1,
          error: error.message,
        },
        null,
        2,
      ),
    );
    throw error;
  },
);
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  npm_execpath: pnpmCli,
  pnpm_config_verify_deps_before_run: 'false',
  SDAR_VERIFY_ISOLATED: 'true',
  SDAR_VERIFY_COMPOSE_PROJECT: runId,
  SDAR_VERIFY_SOURCE_COMMIT: commit,
  SDAR_VERIFY_INPUT_SHA256: inputSha256,
  SDAR_VERIFY_BASELINE_SHA256: baselineSha256,
  SDAR_VERIFY_DEPENDENCY_MODE: dependencyMode,
  SDAR_POSTGRES_PORT: String(postgresPort),
  SDAR_REDIS_PORT: String(redisPort),
  SDAR_REDIS_HOST: '127.0.0.1',
  SDAR_A2A_HOST: '127.0.0.1',
  SDAR_A2A_PORT: String(a2aPort),
  SDAR_MANAGEMENT_HOST: '127.0.0.1',
  SDAR_MANAGEMENT_PORT: String(managementPort),
  SDAR_POSTGRES_URL: `postgresql://sdar:sdar_local_only@127.0.0.1:${postgresPort}/sdar`,
  SDAR_TEST_POSTGRES_URL: `postgresql://sdar:sdar_local_only@127.0.0.1:${postgresPort}/sdar`,
};
process.stdout.write(`Isolated verification ${runId}\nSource: ${snapshot}\nEvidence: ${reports}\n`);
let exitCode = 1;
let runError;
try {
  if (dependencyMode === 'frozen') {
    const installation = await runVerificationProcess({
      command: process.execPath,
      args: [pnpmCli, 'install', '--frozen-lockfile', '--store-dir', join(directory, 'store')],
      cwd: snapshot,
      env: environment,
      logPath: join(reports, 'install.log'),
      timeoutMs: 1_200_000,
      signal: controller.signal,
    });
    await writeFile(join(reports, 'install.json'), JSON.stringify(installation, null, 2));
    if (!verificationProcessPassed(installation)) throw new Error('ISOLATED_FROZEN_INSTALL_FAILED');
  }
  if (controller.signal.aborted) throw new Error('ISOLATED_VERIFICATION_CANCELED');
  exitCode = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['scripts/verify-full.mjs'], {
      cwd: snapshot,
      env: environment,
      stdio: 'inherit',
    });
    const abortChild = () => child.kill('SIGTERM');
    controller.signal.addEventListener('abort', abortChild, { once: true });
    if (controller.signal.aborted) abortChild();
    child.once('error', reject);
    child.once('exit', (code) => {
      controller.signal.removeEventListener('abort', abortChild);
      accept(code ?? 1);
    });
  });
} catch (error) {
  runError = error.message;
} finally {
  // Restrict cleanup to this unique project's resources, even when a gate timed out.
  const cleanupResults = [];
  for (const project of verificationProjects(runId)) {
    const cleanup = await runVerificationProcess({
      command: 'docker',
      args: [
        'compose',
        '--project-name',
        project.name,
        '-f',
        project.file,
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      cwd: snapshot,
      env: environment,
      timeoutMs: 60_000,
      logPath: join(reports, `cleanup-${project.name}.log`),
    });
    cleanupResults.push({ ...project, ...cleanup });
    if (!verificationProcessPassed(cleanup)) exitCode = 1;
  }
  if (controller.signal.aborted) exitCode = 1;
  cleanupResults.push(
    ...(await cleanupVerificationMigrations({ runId, cwd: snapshot, env: environment, reports })),
  );
  if (cleanupResults.some((result) => !verificationProcessPassed(result))) exitCode = 1;
  await writeFile(join(reports, 'cleanup.json'), JSON.stringify(cleanupResults, null, 2));
  const finalInputs = [];
  for (const entry of inputs.filter((item) => inputClass(item.path) !== 'status')) {
    const content = await readFile(join(snapshot, entry.path)).catch(() => undefined);
    finalInputs.push({
      path: entry.path,
      sha256:
        content === undefined ? 'missing' : createHash('sha256').update(content).digest('hex'),
    });
  }
  const inputUnchanged = inputDigest(finalInputs, 'runtime') === inputSha256;
  const baselineUnchanged = inputDigest(finalInputs, 'baseline') === baselineSha256;
  if (!inputUnchanged || !baselineUnchanged) exitCode = 1;
  await cp(join(snapshot, 'reports'), join(reports, 'snapshot-reports'), { recursive: true });
  await writeFile(
    join(reports, 'run.json'),
    JSON.stringify(
      {
        runId,
        dependencyMode,
        inputSha256,
        baselineSha256,
        inputUnchanged,
        baselineUnchanged,
        snapshot,
        exitCode,
        runError,
        cleanupExitCode: cleanupResults.every(verificationProcessPassed) ? 0 : 1,
        cleanupResults,
      },
      null,
      2,
    ),
  );
}
process.removeListener('SIGINT', cancel);
process.removeListener('SIGTERM', cancel);
process.exitCode = exitCode;

function capture(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`ISOLATED_GIT_READ_FAILED:${args[0]}`);
  return result.stdout;
}

function isSourceInput(file) {
  return (
    file !== '' &&
    !file.startsWith('reports/runtime-semantic-closure/') &&
    !file
      .split('/')
      .some(
        (part) =>
          ['.git', 'node_modules', 'dist', 'coverage', '.local', '.artifacts', '.codex'].includes(
            part,
          ) ||
          (part.startsWith('.env') && part !== '.env.example'),
      )
  );
}

async function availablePorts() {
  const servers = Array.from({ length: 4 }, () => net.createServer());
  try {
    const results = await Promise.allSettled(
      servers.map(
        (server) =>
          new Promise((accept, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
              const address = server.address();
              if (address === null || typeof address === 'string')
                reject(new Error('ISOLATED_PORT_UNAVAILABLE'));
              else accept(address.port);
            });
          }),
      ),
    );
    const ports = [];
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      ports.push(result.value);
    }
    return ports;
  } finally {
    await Promise.all(
      servers
        .filter((server) => server.listening)
        .map(
          (server) =>
            new Promise((accept, reject) =>
              server.close((error) => (error ? reject(error) : accept())),
            ),
        ),
    );
  }
}
