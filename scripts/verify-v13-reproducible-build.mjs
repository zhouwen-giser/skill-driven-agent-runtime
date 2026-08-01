import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined || pnpmCli === '') {
  throw new Error('PNPM_EXECUTABLE_UNAVAILABLE: run through pnpm verify:v13-reproducibility');
}
const statusEntries = capture('git', ['status', '--short', '--untracked-files=all'])
  .split(/\r?\n/u)
  .filter((entry) => entry !== '');
const permittedEvidenceChanges = new Set([
  ' M reports/verification/summary.json',
  ' M reports/verification/summary.md',
]);
const nonEvidenceChanges = statusEntries.filter((entry) => !permittedEvidenceChanges.has(entry));
if (nonEvidenceChanges.length > 0) {
  throw new Error(`P13_REPRODUCIBILITY_REQUIRES_CLEAN_SOURCE:${nonEvidenceChanges.join(',')}`);
}

const candidateSha = capture('git', ['rev-parse', 'HEAD']).trim();
const temporaryRoot = await mkdtemp(join(tmpdir(), 'sdar-v13-reproducibility-'));
const runs = [];

try {
  for (const name of ['build-a', 'build-b']) {
    const worktree = resolve(temporaryRoot, name);
    run('git', ['worktree', 'add', '--detach', worktree, candidateSha], root, 120_000);
    const installStartedAt = Date.now();
    runPnpm(['install', '--frozen-lockfile'], worktree, 300_000);
    const installDurationMs = Date.now() - installStartedAt;
    const buildStartedAt = Date.now();
    runPnpm(['build'], worktree, 300_000);
    const buildDurationMs = Date.now() - buildStartedAt;
    const files = await buildManifest(worktree);
    runs.push({
      name,
      worktreeClassification: 'temporary detached exact-commit worktree',
      installCommand: 'pnpm install --frozen-lockfile',
      installDurationMs,
      buildCommand: 'pnpm build',
      buildDurationMs,
      fileCount: files.length,
      aggregateSha256: aggregateHash(files),
      files,
    });
    run('git', ['worktree', 'remove', '--force', worktree], root, 120_000);
  }
} finally {
  for (const name of ['build-a', 'build-b']) {
    const worktree = resolve(temporaryRoot, name);
    runOptional('git', ['worktree', 'remove', '--force', worktree], root, 120_000);
  }
  runOptional('git', ['worktree', 'prune'], root, 30_000);
  await rm(temporaryRoot, { recursive: true, force: true });
}

const first = runs[0];
const second = runs[1];
if (
  first === undefined ||
  second === undefined ||
  first.aggregateSha256 !== second.aggregateSha256 ||
  JSON.stringify(first.files) !== JSON.stringify(second.files)
) {
  throw new Error('P13_BUILD_NOT_REPRODUCIBLE');
}

const report = {
  schemaVersion: '1.0',
  packageId: 'SDAR-V1.3-P13',
  status: 'passed',
  classification: 'real clean-install exact-commit reproducibility evidence',
  candidateSha,
  sourceWorktreeClean: nonEvidenceChanges.length === 0,
  permittedGeneratedEvidenceChanges: statusEntries,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  lockfileSha256: await fileHash(resolve(root, 'pnpm-lock.yaml')),
  equivalent: true,
  aggregateSha256: first.aggregateSha256,
  runs,
};
const reportDirectory = resolve(root, 'reports', 'goal');
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  resolve(reportDirectory, 'v1.3-final-reproducibility-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(
  `P13 reproducible build passed at ${candidateSha}: ${String(first.fileCount)} files, ${first.aggregateSha256}.\n`,
);

async function buildManifest(worktree) {
  const roots = [resolve(worktree, 'dist'), resolve(worktree, 'apps', 'console', 'dist')];
  const entries = [];
  for (const outputRoot of roots) {
    for (const file of await filesRecursively(outputRoot)) {
      entries.push({
        path: relative(worktree, file).replaceAll('\\', '/'),
        sha256: await fileHash(file),
      });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function fileHash(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function aggregateHash(files) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.sha256}\n`);
  return hash.digest('hex');
}

function runPnpm(args, cwd, timeout) {
  run(process.execPath, [pnpmCli, ...args], cwd, timeout);
}

function run(command, args, cwd, timeout) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`P13_REPRODUCIBILITY_COMMAND_FAILED:${command} ${args.join(' ')}`);
  }
}

function runOptional(command, args, cwd, timeout) {
  spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'ignore',
    timeout,
  });
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`P13_REPRODUCIBILITY_CAPTURE_FAILED:${command} ${args.join(' ')}`);
  }
  return result.stdout;
}
