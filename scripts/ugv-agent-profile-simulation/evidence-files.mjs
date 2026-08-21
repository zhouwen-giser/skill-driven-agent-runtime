import { createHash, randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

export async function writeCanonicalJsonFirstWriter(path, document) {
  const target = resolve(path);
  const content = `${JSON.stringify(document, null, 2)}\n`;
  await publishCompleteFile(target, content);
  const winner = await readPrivateText(target);
  if (winner !== content) throw new Error('UAP_CANONICAL_EVIDENCE_DRIFT');
  return target;
}

export async function writeCanonicalFirstPassIndex(path, index, repositoryRoot) {
  const target = resolve(path);
  const content = `${JSON.stringify(index, null, 2)}\n`;
  await publishCompleteFile(target, content);
  await readValidatedFirstPassIndex(target, repositoryRoot, {
    schemaVersion: index.schemaVersion,
    task: index.task,
    bootstrapRunId: index.bootstrapRunId,
    evidenceClass: index.evidenceClass,
  });
  return target;
}

export async function readValidatedFirstPassIndex(path, repositoryRoot, expected = {}) {
  const target = resolve(path);
  let indexSource;
  let winner;
  try {
    indexSource = await readPrivateText(target);
    winner = JSON.parse(indexSource);
  } catch (error) {
    if (error instanceof Error && /^UAP_/u.test(error.message)) throw error;
    throw new Error('UAP_CANONICAL_EVIDENCE_DRIFT', { cause: error });
  }
  return validateFirstPassIndex(winner, expected, repositoryRoot, target, indexSource);
}

async function validateFirstPassIndex(winner, expected, repositoryRoot, indexPath, indexSource) {
  const keys = [
    'bootstrapRunId',
    'canonicalSemantics',
    'endpointsIncluded',
    'evidenceClass',
    'firstPassAttemptFile',
    'firstPassAttemptSha256',
    'modelConfigurationIncluded',
    'physicalVehicleQualified',
    'productionEligible',
    'schemaVersion',
    'secretsIncluded',
    'status',
    'task',
  ];
  if (
    typeof winner !== 'object' ||
    winner === null ||
    Array.isArray(winner) ||
    Object.keys(winner).sort().join(',') !== keys.sort().join(',') ||
    typeof winner.schemaVersion !== 'string' ||
    !/^sdar\.ugv-agent-profile\.[a-z0-9.-]+-index\/v1$/u.test(winner.schemaVersion) ||
    (expected.schemaVersion !== undefined && winner.schemaVersion !== expected.schemaVersion) ||
    winner.status !== 'passed' ||
    (expected.task !== undefined && winner.task !== expected.task) ||
    (expected.bootstrapRunId !== undefined && winner.bootstrapRunId !== expected.bootstrapRunId) ||
    (expected.evidenceClass !== undefined && winner.evidenceClass !== expected.evidenceClass) ||
    typeof winner.task !== 'string' ||
    winner.task === '' ||
    typeof winner.bootstrapRunId !== 'string' ||
    winner.bootstrapRunId === '' ||
    typeof winner.evidenceClass !== 'string' ||
    winner.evidenceClass === '' ||
    winner.canonicalSemantics !== 'immutable_first_pass' ||
    winner.productionEligible !== false ||
    winner.physicalVehicleQualified !== false ||
    winner.secretsIncluded !== false ||
    winner.endpointsIncluded !== false ||
    winner.modelConfigurationIncluded !== false ||
    typeof winner.firstPassAttemptFile !== 'string' ||
    typeof winner.firstPassAttemptSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(winner.firstPassAttemptSha256)
  )
    throw new Error('UAP_CANONICAL_EVIDENCE_DRIFT');
  const root = resolve(repositoryRoot);
  const attemptsRoot = resolve(root, 'reports/ugv-agent-profile-simulation/attempts');
  const attemptPath = resolve(root, winner.firstPassAttemptFile);
  if (
    !attemptPath.startsWith(`${attemptsRoot}/`) ||
    !attemptPath.endsWith('.redacted.json') ||
    attemptPath === resolve(indexPath)
  )
    throw new Error('UAP_CANONICAL_ATTEMPT_PATH_INVALID');
  let attemptSource;
  let attempt;
  try {
    attemptSource = await readPrivateText(attemptPath);
    attempt = JSON.parse(attemptSource);
  } catch {
    throw new Error('UAP_CANONICAL_ATTEMPT_INVALID');
  }
  const attemptSchemaVersion = winner.schemaVersion.replace(/-index\/v1$/u, '/v1');
  if (
    attempt?.schemaVersion !== attemptSchemaVersion ||
    attempt?.status !== 'passed' ||
    attempt?.task !== winner.task ||
    attempt?.bootstrapRunId !== winner.bootstrapRunId ||
    attempt?.evidenceClass !== winner.evidenceClass ||
    attempt?.productionEligible !== false ||
    attempt?.physicalVehicleQualified !== false ||
    attempt?.secretsIncluded !== false ||
    attempt?.endpointsIncluded !== false ||
    attempt?.modelConfigurationIncluded !== false ||
    sha256CanonicalJson(attempt) !== winner.firstPassAttemptSha256
  )
    throw new Error('UAP_CANONICAL_ATTEMPT_INVALID');
  return Object.freeze({
    index: Object.freeze(winner),
    attempt: Object.freeze(attempt),
    indexPath: resolve(indexPath),
    attemptPath,
    indexSource,
    attemptSource,
  });
}

export function sha256CanonicalJson(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export async function writeImmutableAttemptJson(directory, prefix, document) {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, '');
  const target = join(
    root,
    `${prefix}-${timestamp}-${randomBytes(8).toString('hex')}.redacted.json`,
  );
  const content = `${JSON.stringify(document, null, 2)}\n`;
  await publishCompleteFile(target, content);
  if ((await readPrivateText(target)) !== content) throw new Error('UAP_ATTEMPT_EVIDENCE_DRIFT');
  return target;
}

async function publishCompleteFile(target, content) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${String(process.pid)}.${randomBytes(8).toString('hex')}.candidate`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temporary, 0o600);
    try {
      await link(temporary, target);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  } finally {
    await unlink(temporary).catch((error) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
  }
}

async function readPrivateText(path) {
  const status = await lstat(path);
  if (status.isSymbolicLink() || !status.isFile() || (status.mode & 0o777) !== 0o600)
    throw new Error('UAP_EVIDENCE_FILE_PERMISSIONS_INVALID');
  if (process.getuid !== undefined && status.uid !== process.getuid())
    throw new Error('UAP_EVIDENCE_FILE_OWNER_INVALID');
  if (status.size > 8 * 1024 * 1024) throw new Error('UAP_EVIDENCE_FILE_TOO_LARGE');
  return readFile(path, 'utf8');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}
