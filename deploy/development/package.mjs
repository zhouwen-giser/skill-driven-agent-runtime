import console from 'node:console';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, basename, relative, isAbsolute } from 'node:path';
import { root } from './config.mjs';
import process from 'node:process';
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!['--output', '--exclude-dir'].includes(key) || !args[i + 1] || options.has(key))
    throw new Error('PACKAGE_ARGUMENTS_INVALID');
  options.set(key, args[i + 1]);
}
const excludedPath = options.has('--exclude-dir')
  ? relative(root, resolve(options.get('--exclude-dir')))
  : undefined;
if (excludedPath === '') throw new Error('PACKAGE_EXCLUSION_ROOT_REFUSED');
const excludedDirectory =
  excludedPath &&
  excludedPath !== '..' &&
  !excludedPath.startsWith('../') &&
  !isAbsolute(excludedPath)
    ? excludedPath
    : undefined;

// Export explicit repository source inputs, not a recursive copy of the workspace.
const tracked = execFileSync(
  'git',
  [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    '.',
    ':!:reports',
    ':!:artifacts',
    ':!:source',
    ':!:third_party/reference-checkouts',
    ...(excludedDirectory ? [`:(exclude,literal)${excludedDirectory}`] : []),
  ],
  { cwd: root, maxBuffer: 64 * 1024 * 1024 },
)
  .toString()
  .split('\0')
  .filter(Boolean);
const files = [...new Set(tracked)]
  .filter((path) => {
    if (
      excludedDirectory &&
      (path === excludedDirectory || path.startsWith(excludedDirectory + '/'))
    )
      return false;
    if (
      /(^|\/)(\.env(?:\..*)?|\.state|node_modules|dist|\.git|\.codex)(\/|$)/u.test(path) &&
      path !== '.env.example'
    )
      return false;
    if (/^(reports|artifacts|source|third_party\/reference-checkouts)\//u.test(path)) return false;
    if (/\.(zip|tar|gz|log|tsbuildinfo|pem|key|p12|pfx|dump|sqlite|db|pyc|env)$/u.test(path))
      return false;
    if (/(^|\/)(__pycache__|secrets|coverage)(\/|$)/u.test(path)) return false;
    return lstatSync(resolve(root, path), { throwIfNoEntry: false })?.isFile() ?? false;
  })
  .sort();
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
for (const path of files) {
  if (
    /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u.test(
      readFileSync(resolve(root, path), 'utf8'),
    )
  )
    throw new Error('PACKAGE_PRIVATE_KEY_REFUSED');
}
const inputs = files.map((path) => ({
  path,
  sha256: createHash('sha256')
    .update(readFileSync(resolve(root, path)))
    .digest('hex'),
}));
const sourceHash = createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
const directory = options.has('--output')
  ? resolve(options.get('--output'))
  : resolve(root, 'artifacts/development');
mkdirSync(directory, { recursive: true });
const archive = resolve(
  directory,
  `sdar-development-${sourceRevision.slice(0, 12)}-${sourceHash.slice(0, 12)}.tar.gz`,
);
const metadataDirectory = mkdtempSync(resolve(tmpdir(), 'sdar-package-'));
try {
  writeFileSync(
    resolve(metadataDirectory, 'sdar-deployment-source.json'),
    JSON.stringify({ sourceRevision, sourceHash }),
  );
  const tar = spawnSync(
    'tar',
    [
      '--format=posix',
      '--pax-option=delete=atime,delete=ctime',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '--mode=u+rw,go+r,go-w,a-s',
      '--null',
      '-czf',
      archive,
      '-T',
      '-',
      '-C',
      metadataDirectory,
      'sdar-deployment-source.json',
    ],
    { cwd: root, input: files.join('\0') + '\0', encoding: 'utf8' },
  );
  if (tar.status !== 0) throw new Error('DEVELOPMENT_PACKAGE_FAILED');
} finally {
  rmSync(metadataDirectory, { recursive: true, force: true });
}
const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
writeFileSync(
  `${archive}.manifest.json`,
  JSON.stringify(
    { sourceRevision, sourceHash, archiveSha256: checksum, files: inputs, secretsIncluded: false },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    archive,
    sha256: checksum,
    sourceRevision,
    sourceHash,
    fileCount: files.length,
    secretsIncluded: false,
  }),
);
