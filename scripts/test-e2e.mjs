import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';
import { startIsolatedPerformanceInfrastructure } from './lib/performance-infrastructure.mjs';
import { recordVerificationCleanupFailure } from './lib/verification-cleanup.mjs';

const { Pool } = pg;
const databaseName = 'sdar_v122_e2e_gate';
const requestedTests = process.argv.slice(2).filter((argument) => argument !== '--');
const performanceTestFile = 'packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts';
const performanceTestName =
  'keeps critical Runtime P95 within ten percent and Evidence append P95 below twenty milliseconds';
const adminUrl =
  process.env.SDAR_TEST_POSTGRES_URL ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';

const isolatedPerformanceOnly =
  process.env.SDAR_VERIFY_ISOLATED === 'true' &&
  requestedTests.includes(performanceTestFile) &&
  requestedTests.includes(performanceTestName);
let functionalInfrastructureStarted = false;
try {
  if (isolatedPerformanceOnly) {
    await runPerformance(requestedTests);
  } else {
    functionalInfrastructureStarted = true;
    startInfrastructure();
    await recreateDatabase();
    const environment = {
      ...process.env,
      SDAR_TEST_POSTGRES_URL: databaseUrl(databaseName),
    };
    if (requestedTests.length > 0) {
      run(
        process.execPath,
        ['node_modules/vitest/vitest.mjs', 'run', '--project', 'e2e', ...requestedTests],
        300_000,
        environment,
      );
    } else {
      run(
        process.execPath,
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          '--project',
          'e2e',
          '--testNamePattern',
          `^(?!.*${escapeRegExp(performanceTestName)}).*$`,
        ],
        300_000,
        environment,
      );
      if (process.env.SDAR_VERIFY_ISOLATED === 'true') {
        await runPerformance([performanceTestFile, '--testNamePattern', performanceTestName]);
      } else {
        await recreateDatabase();
        run(
          process.execPath,
          [
            'node_modules/vitest/vitest.mjs',
            'run',
            '--project',
            'e2e',
            performanceTestFile,
            '--testNamePattern',
            performanceTestName,
          ],
          300_000,
          environment,
        );
      }
    }
  }
} finally {
  if (functionalInfrastructureStarted) {
    await dropDatabase().catch((error) => recordVerificationCleanupFailure('e2e-database', error));
    stopInfrastructure();
  }
}

async function runPerformance(tests) {
  const fixture = await startIsolatedPerformanceInfrastructure();
  try {
    await recreateDatabase(fixture.postgresUrl);
    run(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--project', 'e2e', ...tests],
      300_000,
      {
        ...process.env,
        SDAR_TEST_POSTGRES_URL: databaseUrl(databaseName, fixture.postgresUrl),
        SDAR_POSTGRES_URL: fixture.postgresUrl,
        SDAR_REDIS_HOST: '127.0.0.1',
        SDAR_REDIS_PORT: String(fixture.redisPort),
      },
    );
  } finally {
    await dropDatabase(fixture.postgresUrl).catch((error) =>
      recordVerificationCleanupFailure('performance-e2e-database', error),
    );
    await fixture.close();
  }
}

function run(command, args, timeout, environment) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: environment,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`E2E_COMMAND_FAILED: ${command} ${args.join(' ')}`);
}

function databaseUrl(database, connection = adminUrl) {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function recreateDatabase(connection = adminUrl) {
  const admin = new Pool({ connectionString: connection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(connection = adminUrl) {
  const admin = new Pool({ connectionString: connection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await admin.end();
  }
}
