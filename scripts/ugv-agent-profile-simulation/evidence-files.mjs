import { createHash, randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
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
  const { attemptPath } = validateFirstPassIndexEnvelope(
    winner,
    expected,
    repositoryRoot,
    indexPath,
  );
  let attemptSource;
  let attempt;
  try {
    attemptSource = await readPrivateText(attemptPath);
    attempt = JSON.parse(attemptSource);
  } catch {
    throw new Error('UAP_CANONICAL_ATTEMPT_INVALID');
  }
  return validateFirstPassPairDocuments(winner, attempt, expected, repositoryRoot, indexPath, {
    indexSource,
    attemptSource,
  });
}

function validateFirstPassIndexEnvelope(winner, expected, repositoryRoot, indexPath) {
  const b02Move = winner?.schemaVersion === 'sdar.ugv-agent-profile.a2a-move-index/v1';
  const commonKeys = [
    'bootstrapRunId',
    'canonicalSemantics',
    'endpointsIncluded',
    'evidenceClass',
    'firstPassAttemptFile',
    'firstPassAttemptSha256',
    'physicalVehicleQualified',
    'productionEligible',
    'schemaVersion',
    'secretsIncluded',
    'status',
    'task',
  ];
  const keys = b02Move
    ? [
        ...commonKeys,
        'downstreamDeviceIdsIncluded',
        'modelCredentialsIncluded',
        'modelEndpointsIncluded',
        'modelRouteIdentityHashesIncluded',
        'modelValuesIncluded',
      ]
    : [...commonKeys, 'modelConfigurationIncluded'];
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
    (!b02Move && winner.modelConfigurationIncluded !== false) ||
    (b02Move &&
      (winner.downstreamDeviceIdsIncluded !== true ||
        winner.modelRouteIdentityHashesIncluded !== true ||
        winner.modelValuesIncluded !== false ||
        winner.modelEndpointsIncluded !== false ||
        winner.modelCredentialsIncluded !== false)) ||
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
  return Object.freeze({ b02Move, attemptPath });
}

export function validateFirstPassPairDocuments(
  winner,
  attempt,
  expected,
  repositoryRoot,
  indexPath,
  sources = {},
) {
  const b02Move = winner?.schemaVersion === 'sdar.ugv-agent-profile.a2a-move-index/v1';
  const commonKeys = [
    'bootstrapRunId',
    'canonicalSemantics',
    'endpointsIncluded',
    'evidenceClass',
    'firstPassAttemptFile',
    'firstPassAttemptSha256',
    'physicalVehicleQualified',
    'productionEligible',
    'schemaVersion',
    'secretsIncluded',
    'status',
    'task',
  ];
  const keys = b02Move
    ? [
        ...commonKeys,
        'downstreamDeviceIdsIncluded',
        'modelCredentialsIncluded',
        'modelEndpointsIncluded',
        'modelRouteIdentityHashesIncluded',
        'modelValuesIncluded',
      ]
    : [...commonKeys, 'modelConfigurationIncluded'];
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
    (!b02Move && winner.modelConfigurationIncluded !== false) ||
    (b02Move &&
      (winner.downstreamDeviceIdsIncluded !== true ||
        winner.modelRouteIdentityHashesIncluded !== true ||
        winner.modelValuesIncluded !== false ||
        winner.modelEndpointsIncluded !== false ||
        winner.modelCredentialsIncluded !== false)) ||
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
    (!b02Move && attempt?.modelConfigurationIncluded !== false) ||
    (b02Move &&
      (attempt?.downstreamDeviceIdsIncluded !== true ||
        attempt?.modelRouteIdentityHashesIncluded !== true ||
        attempt?.modelValuesIncluded !== false ||
        attempt?.modelEndpointsIncluded !== false ||
        attempt?.modelCredentialsIncluded !== false)) ||
    sha256CanonicalJson(attempt) !== winner.firstPassAttemptSha256
  )
    throw new Error('UAP_CANONICAL_ATTEMPT_INVALID');
  return Object.freeze({
    index: Object.freeze(winner),
    attempt: Object.freeze(attempt),
    indexPath: resolve(indexPath),
    attemptPath,
    indexSource: sources.indexSource,
    attemptSource: sources.attemptSource,
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

export async function writeFirstPassPairTransactional(
  { attemptDirectory, prefix, document, indexPath, createIndex, repositoryRoot },
  dependencies = {},
) {
  const operations = {
    mkdir: dependencies.mkdir ?? mkdir,
    chmod: dependencies.chmod ?? chmod,
    link: dependencies.link ?? link,
    unlink: dependencies.unlink ?? unlink,
    writeSyncedCandidate: dependencies.writeSyncedCandidate ?? writeSyncedCandidate,
    syncDirectory: dependencies.syncDirectory ?? syncDirectory,
    validatePair: dependencies.validatePair ?? validateFirstPassPairDocuments,
  };
  const attemptsRoot = resolve(attemptDirectory);
  const canonicalIndexPath = resolve(indexPath);
  await operations.mkdir(attemptsRoot, { recursive: true, mode: 0o700 });
  await operations.chmod(attemptsRoot, 0o700);
  await operations.mkdir(dirname(canonicalIndexPath), { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, '');
  const attemptPath = join(
    attemptsRoot,
    `${prefix}-${timestamp}-${randomBytes(8).toString('hex')}.redacted.json`,
  );
  const index = createIndex(attemptPath);
  const attemptContent = `${JSON.stringify(document, null, 2)}\n`;
  const indexContent = `${JSON.stringify(index, null, 2)}\n`;
  const attemptCandidate = `${attemptPath}.${String(process.pid)}.${randomBytes(8).toString('hex')}.candidate`;
  const indexCandidate = `${canonicalIndexPath}.${String(process.pid)}.${randomBytes(8).toString('hex')}.candidate`;
  let attemptPublished = false;
  let indexPublished = false;
  try {
    await operations.writeSyncedCandidate(attemptCandidate, attemptContent);
    await operations.writeSyncedCandidate(indexCandidate, indexContent);
    await operations.validatePair(
      index,
      document,
      {
        schemaVersion: index.schemaVersion,
        task: index.task,
        bootstrapRunId: index.bootstrapRunId,
        evidenceClass: index.evidenceClass,
      },
      repositoryRoot,
      canonicalIndexPath,
    );
    await operations.link(attemptCandidate, attemptPath);
    attemptPublished = true;
    await operations.syncDirectory(attemptsRoot);
    await operations.link(indexCandidate, canonicalIndexPath);
    indexPublished = true;
    await operations.syncDirectory(attemptsRoot);
    if (dirname(canonicalIndexPath) !== attemptsRoot)
      await operations.syncDirectory(dirname(canonicalIndexPath));
    return Object.freeze({
      attemptPath,
      indexPath: canonicalIndexPath,
      index: Object.freeze(index),
    });
  } catch (error) {
    const rollbackErrors = [];
    if (indexPublished) {
      try {
        await operations.unlink(canonicalIndexPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (attemptPublished) {
      try {
        await operations.unlink(attemptPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (indexPublished || attemptPublished) {
      const directories = new Set([attemptsRoot, dirname(canonicalIndexPath)]);
      for (const directory of directories) {
        try {
          await operations.syncDirectory(directory);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
    }
    if (rollbackErrors.length > 0)
      throw new AggregateError(rollbackErrors, 'UAP_FIRST_PASS_PAIR_ROLLBACK_FAILED', {
        cause: error,
      });
    throw error;
  } finally {
    await Promise.all([
      operations.unlink(attemptCandidate).catch(() => undefined),
      operations.unlink(indexCandidate).catch(() => undefined),
    ]);
  }
}

async function writeSyncedCandidate(path, content) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
