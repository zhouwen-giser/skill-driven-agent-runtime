import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const deliveryRelative = 'reports/sdar-ugv-smpp-integration/delivery';
const deliveryDirectory = resolve(repositoryRoot, deliveryRelative);
const patchPath = resolve(deliveryDirectory, 'sdar-ugv-smpp-integration.patch');
const zipPath = resolve(deliveryDirectory, 'sdar-ugv-smpp-integration-delivery.zip');
const checksumPath = `${zipPath}.sha256`;

mkdirSync(deliveryDirectory, { recursive: true });

const tracked = nulList(git(['diff', '--name-only', '-z', '--diff-filter=ACMRTUXB', 'HEAD']));
const untracked = nulList(git(['ls-files', '--others', '--exclude-standard', '-z']));
const trackedSet = new Set(tracked);
const files = [...new Set([...tracked, ...untracked])]
  .filter(isDeliverablePath)
  .sort((left, right) => left.localeCompare(right));

if (files.length === 0) throw new Error('No deliverable worktree changes were found.');

for (const file of files) {
  const metadata = lstatSync(resolve(repositoryRoot, file));
  if (!metadata.isFile()) throw new Error(`Delivery input is not a regular file: ${file}`);
}

assertNoSecrets(files);

const trackedFiles = files.filter((file) => trackedSet.has(file));
const patchParts = [];
if (trackedFiles.length > 0)
  patchParts.push(
    git(['diff', '--binary', 'HEAD', '--', ...trackedFiles], {
      maxBuffer: 128 * 1024 * 1024,
    }),
  );
for (const file of files.filter((candidate) => !trackedSet.has(candidate))) {
  const result = spawnSync('git', ['diff', '--no-index', '--binary', '--', '/dev/null', file], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 1 || result.error !== undefined)
    throw result.error ?? new Error(`Unable to render untracked delivery patch: ${file}`);
  patchParts.push(result.stdout);
}
writeFileSync(patchPath, Buffer.concat(patchParts));

for (const generatedPath of [zipPath, checksumPath]) {
  try {
    unlinkSync(generatedPath);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

const zip = spawnSync('zip', ['-q', '-X', zipPath, ...files], {
  cwd: repositoryRoot,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (zip.status !== 0 || zip.error !== undefined)
  throw zip.error ?? new Error(zip.stderr || 'zip failed without diagnostic output.');

const zipBytes = readFileSync(zipPath);
const checksum = createHash('sha256').update(zipBytes).digest('hex');
writeFileSync(checksumPath, `${checksum}  sdar-ugv-smpp-integration-delivery.zip\n`, 'utf8');

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'built',
      baseSha: git(['rev-parse', 'HEAD']).toString('utf8').trim(),
      fileCount: files.length,
      patchBytes: readFileSync(patchPath).byteLength,
      zipBytes: zipBytes.byteLength,
      sha256: checksum,
      exclusions: [
        '.gitignore',
        '.codex/**',
        'actual secret files',
        'checkpoint/raw/log/tmp files',
        `${deliveryRelative}/**`,
      ],
    },
    null,
    2,
  )}\n`,
);

function git(arguments_, options = {}) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
  });
}

function nulList(buffer) {
  return buffer
    .toString('utf8')
    .split('\0')
    .filter((item) => item.length > 0);
}

function isDeliverablePath(path) {
  if (path === '.gitignore' || path.startsWith('.codex/')) return false;
  if (path.startsWith(`${deliveryRelative}/`)) return false;
  if (/\.(?:checkpoint\.json|log|raw|tmp)$/u.test(path)) return false;
  if (/(?:^|\/)\.env(?:\.|$)/u.test(path) && !path.endsWith('.env.example')) return false;
  if (
    path.startsWith('deploy/ugv-smpp-integration/secrets/') &&
    path !== 'deploy/ugv-smpp-integration/secrets/README.md'
  )
    return false;
  return true;
}

function assertNoSecrets(paths) {
  const inspectedPaths = paths.filter(
    (path) =>
      path.startsWith('deploy/ugv-smpp-integration/') ||
      path.startsWith('reports/sdar-ugv-smpp-integration/'),
  );
  const forbidden = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /postgres(?:ql)?:\/\/[^:\s/]+:[^@<\s]+@/iu,
    /(?:authorization|api[_-]?key|password)[ \t]*[:=][ \t]*["']?[A-Za-z0-9/+_.=-]{16,}/iu,
  ];
  for (const path of inspectedPaths) {
    const contents = readFileSync(resolve(repositoryRoot, path), 'utf8');
    if (forbidden.some((pattern) => pattern.test(contents)))
      throw new Error(`Potential secret material detected in delivery input: ${path}`);
  }
}
