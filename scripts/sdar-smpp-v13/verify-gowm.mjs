import assert from 'node:assert/strict';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { inputClass, inputDigest } from '../lib/verification-inputs.mjs';

// Owned loopback fixtures only. Do not load .env/.state or reuse a site's database.
const ownerCommit = JSON.parse(await readFile('contracts/gowm-shared-storage/current/source.json', 'utf8')).commit;
assert.match(ownerCommit, /^[a-f0-9]{40}$/u);
const ownerRepository = '/home/sz/code/geospatial-operational-world-model';
const runId = `sdar-smpp-gowm-${randomUUID()}`;
const databaseName = `sdar_smpp_gowm_test_${randomBytes(8).toString('hex')}`;
const reportDirectory = `reports/sdar-smpp-v13-upgrade/20261010-local/${runId}`;
await mkdir(reportDirectory, { recursive: true });
const environment = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' };
const temporary = await mkdtemp(resolve(tmpdir(), `${runId}-`));
const sourceDirectory = resolve(temporary, 'gowm');
const containers = [];
const results = [];
const secret = randomBytes(32).toString('hex');
const consumerSecret = randomBytes(32).toString('hex');
const peerSecret = randomBytes(32).toString('hex');
let admin;
let before;
let failure;
const report = {
  runId,
  ownerCommit,
  sourceDirectory,
  databaseName,
  reportDirectory,
  scope: 'owned_loopback_fixture',
  site: 'NOT_RUN',
  steps: results,
};
try {
  const inputs = await sourceInputs();
  report.inputSha256 = inputDigest(inputs, 'runtime');
  report.baselineSha256 = inputDigest(inputs, 'baseline');
  await writeFile(`${reportDirectory}/inputs.json`, JSON.stringify(inputs, null, 2) + '\n');
  assert.equal(output('git', ['rev-parse', ownerCommit], ownerRepository).trim(), ownerCommit);
  await mkdir(sourceDirectory);
  const archivePath = resolve(temporary, 'owner.tar');
  run(
    'owner-export',
    'git',
    ['archive', '--format=tar', `--output=${archivePath}`, ownerCommit],
    ownerRepository,
  );
  run('owner-extract', 'tar', ['-xf', archivePath, '-C', sourceDirectory]);
  await symlink(resolve('node_modules'), resolve(sourceDirectory, 'node_modules'), 'dir');
  const postgresImage = output('docker', [
    'image',
    'inspect',
    'gowm-plus-db:sdar-pgvector-0.8.5',
    '--format',
    '{{.Id}}',
  ]).trim();
  const redisImage = output('docker', [
    'image',
    'inspect',
    'redis@sha256:8096655e437712b07503796fb64d81359256cfcff0ab29d95a7da72863786efb',
    '--format',
    '{{.Id}}',
  ]).trim();
  assert.match(postgresImage, /^sha256:[a-f0-9]{64}$/u);
  assert.match(redisImage, /^sha256:[a-f0-9]{64}$/u);
  report.images = {
    postgresImage,
    redisImage,
    provenance: 'captured_local_immutable_ids; owner source independently pinned',
  };
  const postgres = createContainer(`${runId}-postgres`, postgresImage, [
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_USER=sdar',
    '--env',
    `POSTGRES_PASSWORD=${secret}`,
    '--env',
    `POSTGRES_DB=${databaseName}`,
  ]);
  const redis = createContainer(`${runId}-redis`, redisImage, ['--publish', '127.0.0.1::6379']);
  run('postgres-start', 'docker', ['start', postgres]);
  run('redis-start', 'docker', ['start', redis]);
  const postgresPort = Number(
    output('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      postgres,
    ]).trim(),
  );
  const redisPort = Number(
    output('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}',
      redis,
    ]).trim(),
  );
  assert.ok(postgresPort > 0 && redisPort > 0 && postgresPort !== redisPort);
  report.ports = { postgresPort, redisPort };
  const databaseUrl = (role, password) =>
    `postgresql://${role}:${password}@127.0.0.1:${String(postgresPort)}/${databaseName}`;
  const adminUrl = databaseUrl('sdar', secret);
  const consumerUrl = databaseUrl('sdar_gowm_consumer_test', consumerSecret);
  const peerUrl = databaseUrl('sdar_gowm_peer_test', peerSecret);
  admin = new Pool({ connectionString: adminUrl, max: 2, connectionTimeoutMillis: 1000 });
  for (let attempt = 0; ; attempt++) {
    try {
      assert.equal(
        (await admin.query('SELECT current_database() AS name')).rows[0]?.name,
        databaseName,
      );
      break;
    } catch (error) {
      if (attempt >= 60) throw error;
      await new Promise((done) => setTimeout(done, 1000));
    }
  }
  const ownerEnvironment = {
    ...environment,
    GOWM_DATABASE_URL: adminUrl,
    GOWM_BUSINESS_TEST_DATABASE_URL: adminUrl,
    GOWM_BUSINESS_SMOKE_ENABLE: 'true',
  };
  run(
    'owner-core-bootstrap',
    resolve('node_modules/.bin/tsx'),
    ['scripts/business-storage/bootstrap-test.ts'],
    sourceDirectory,
    ownerEnvironment,
  );
  run(
    'owner-domain-install',
    resolve('node_modules/.bin/tsx'),
    ['scripts/business-storage/cli.ts', 'install', '--domain', 'all'],
    sourceDirectory,
    ownerEnvironment,
  );
  report.extensions = (
    await admin.query('SELECT extname,extversion FROM pg_extension ORDER BY extname')
  ).rows;
  assert.equal(report.extensions.find((e) => e.extname === 'vector')?.extversion, '0.8.5');
  assert.ok(report.extensions.some((e) => e.extname === 'postgis'));
  // Admin provisions generated test roles once; the Server uses only the restricted consumer.
  await admin.query(`CREATE ROLE sdar_gowm_consumer_test LOGIN PASSWORD '${consumerSecret}'`);
  await admin.query(`CREATE ROLE sdar_gowm_peer_test LOGIN PASSWORD '${peerSecret}'`);
  await admin.query(
    `GRANT CONNECT ON DATABASE ${databaseName} TO sdar_gowm_consumer_test,sdar_gowm_peer_test`,
  );
  for (const grant of [
    'GRANT USAGE ON SCHEMA public,ugv_sdar,ugv_smpp,gowm_device,gowm_task,gowm_business_v1 TO sdar_gowm_consumer_test',
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ugv_sdar TO sdar_gowm_consumer_test',
    'GRANT SELECT ON ALL TABLES IN SCHEMA public,gowm_device,gowm_business_v1 TO sdar_gowm_consumer_test',
    'GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA gowm_task TO sdar_gowm_consumer_test',
    'GRANT SELECT ON ugv_smpp.provider_task TO sdar_gowm_consumer_test',
    'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ugv_sdar,gowm_task TO sdar_gowm_consumer_test',
    'GRANT USAGE ON SCHEMA public,ugv_smpp,gowm_device TO sdar_gowm_peer_test',
    'GRANT SELECT ON ALL TABLES IN SCHEMA gowm_device TO sdar_gowm_peer_test',
    'GRANT SELECT,INSERT ON ugv_smpp.operation_snapshot TO sdar_gowm_peer_test',
    'GRANT SELECT,INSERT,UPDATE ON ugv_smpp.provider_task TO sdar_gowm_peer_test',
  ])
    await admin.query(grant);
  report.consumerPrivileges = (
    await admin.query(
      "SELECT has_schema_privilege('sdar_gowm_consumer_test','ugv_sdar','CREATE') AS native_ddl,has_table_privilege('sdar_gowm_consumer_test','ugv_smpp.provider_task','UPDATE') AS private_write,has_table_privilege('sdar_gowm_consumer_test','ugv_sdar.remote_task_observation','INSERT') AS native_observation_write",
    )
  ).rows[0];
  assert.deepEqual(report.consumerPrivileges, {
    native_ddl: false,
    private_write: false,
    native_observation_write: true,
  });
  before = await catalogDigest();
  const testEnvironment = {
    ...environment,
    GOWM_BUSINESS_TEST_DATABASE_URL: adminUrl,
    GOWM_BUSINESS_CONSUMER_TEST_DATABASE_URL: consumerUrl,
    GOWM_BUSINESS_PEER_TEST_DATABASE_URL: peerUrl,
    GOWM_BUSINESS_SMOKE_ENABLE: 'true',
    SDAR_GOWM_TEST_REPORT_DIRECTORY: `${reportDirectory}/native-storage`,
    SDAR_SMPP_TEST_STORAGE_MODE: 'gowm_shared_business',
    SDAR_REDIS_HOST: '127.0.0.1',
    SDAR_REDIS_PORT: String(redisPort),
    SDAR_VERIFY_ISOLATED: 'true',
  };
  if (!process.argv.includes('--boundaries-only')) {
  report.schemaBeforeFormal = await catalogDigest();
  report.privateSmppBeforeFormal = (
    await admin.query('SELECT count(*)::integer AS rows FROM ugv_smpp.provider_task')
  ).rows[0];
  run(
    'formal-navigation-recon-shared-storage',
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--project',
      'e2e',
      'apps/server/test/smpp-task-business.e2e.test.ts',
    ],
    process.cwd(),
    testEnvironment,
  );
  report.schemaAfterFormal = await catalogDigest();
  report.privateSmppAfterFormal = (
    await admin.query('SELECT count(*)::integer AS rows FROM ugv_smpp.provider_task')
  ).rows[0];
  assert.equal(report.schemaBeforeFormal, report.schemaAfterFormal);
  assert.equal(before, report.schemaAfterFormal);
  assert.deepEqual(report.privateSmppBeforeFormal, report.privateSmppAfterFormal);
  } else report.formalRuntime = 'NOT_RUN: focused repository increment';
  // The repository boundary suite intentionally seeds partial legacy Skill rows.
  // Run the formal Server against the pristine owner-installed schema first.
  run(
    'native-storage-boundaries',
    resolve('node_modules/.bin/tsx'),
    ['scripts/gowm-storage-postgres.mts'],
    process.cwd(),
    testEnvironment,
  );
  report.schemaAfterBoundarySuite = await catalogDigest();
  assert.equal(before, report.schemaAfterBoundarySuite);
  const finalInputs = await sourceInputs();
  report.inputUnchanged = report.inputSha256 === inputDigest(finalInputs, 'runtime');
  report.baselineUnchanged = report.baselineSha256 === inputDigest(finalInputs, 'baseline');
  assert.equal(report.inputUnchanged, true, 'OWNED_GOWM_SOURCE_CHANGED');
  assert.equal(report.baselineUnchanged, true, 'OWNED_GOWM_BASELINE_CHANGED');
  report.status = 'PASS';
} catch (error) {
  failure = error;
  report.status = 'FAIL';
  report.error = sanitize(error instanceof Error ? error.message : String(error));
} finally {
  report.cleanup = [];
  report.cleanupErrors = [];
  try {
    await admin?.end();
  } catch (error) {
    report.cleanupErrors.push(sanitize(String(error)));
    report.status = 'FAIL';
    failure ??= error;
  }
  for (const id of containers.reverse()) {
    // Remove only IDs returned by this run's create, after checking its ownership label.
    try {
      assert.equal(
        output('docker', [
          'inspect',
          '--format',
          '{{index .Config.Labels "io.sdar.smpp.fixture"}}',
          id,
        ]).trim(),
        runId,
      );
      const result = spawnSync('docker', ['rm', '--force', '--volumes', id], {
        env: environment,
        encoding: 'utf8',
        timeout: 60_000,
      });
      report.cleanup.push({ id, ownershipChecked: true, exitCode: result.status });
      if (result.status !== 0) {
        report.status = 'FAIL';
        report.cleanupErrors.push('OWNED_CONTAINER_CLEANUP_FAILED');
        failure ??= new Error('OWNED_CONTAINER_CLEANUP_FAILED');
      }
    } catch (error) {
      report.status = 'FAIL';
      report.cleanupErrors.push(sanitize(String(error)));
      failure ??= error;
    }
  }
  await rm(temporary, { recursive: true, force: true });
  await writeFile(`${reportDirectory}/result.json`, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    `${JSON.stringify({ report: `${reportDirectory}/result.json`, status: report.status, cleanup: report.cleanup, site: 'NOT_RUN' })}\n`,
  );
}
if (failure !== undefined) {
  process.stderr.write(
    `${sanitize(failure instanceof Error ? failure.message : String(failure))}\n`,
  );
  process.exitCode = 1;
}

function sanitize(value) {
  return [secret, consumerSecret, peerSecret].reduce(
    (text, token) => text.replaceAll(token, '[redacted]'),
    value,
  );
}
async function sourceInputs() {
  const entries = [];
  const paths = output('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]).split('\0');
  for (const path of [...new Set(paths)].sort()) {
    if (
      !path ||
      inputClass(path) === 'status' ||
      path
        .split('/')
        .some(
          (part) =>
            ['.git', 'node_modules', 'dist', 'coverage', '.local', '.artifacts', '.codex'].includes(
              part,
            ) ||
            (part.startsWith('.env') && part !== '.env.example'),
        )
    )
      continue;
    let content;
    try {
      content = await readFile(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    entries.push({ path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return entries;
}
function output(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      sanitize(`${command}:${result.status}:${result.stderr ?? result.error?.message ?? ''}`),
    );
  return result.stdout;
}
function run(label, command, args, cwd = process.cwd(), env = environment) {
  process.stdout.write(`${JSON.stringify({ step: label, startedAt: new Date().toISOString() })}\n`);
  const start = Date.now();
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 600_000 });
  results.push({
    label,
    durationMs: Date.now() - start,
    exitCode: result.status,
    signal: result.signal,
  });
  if (result.status !== 0)
    throw new Error(`OWNED_GOWM_STEP_FAILED:${label}:${String(result.status)}`);
}
function createContainer(name, image, args) {
  const id = output('docker', [
    'create',
    '--name',
    name,
    '--label',
    `io.sdar.smpp.fixture=${runId}`,
    ...args,
    image,
  ]).trim();
  assert.match(id, /^[a-f0-9]{64}$/u);
  containers.push(id);
  return id;
}
async function catalogDigest() {
  const catalog = await admin.query(
    "SELECT n.nspname,c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ugv_sdar','ugv_smpp','gowm_device','gowm_task','gowm_business_v1') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,a.attnum",
  );
  const history = await admin.query(
    'SELECT family,file,checksum FROM ugv_sdar.gowm_install_history ORDER BY family,file',
  );
  return createHash('sha256')
    .update(JSON.stringify({ catalog: catalog.rows, history: history.rows }))
    .digest('hex');
}
