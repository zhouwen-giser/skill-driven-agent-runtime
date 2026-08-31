/* global console, process */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PHASE12_EVIDENCE_DIMENSIONS,
  PHASE12_PROFILE_EVIDENCE,
  PHASE12_SCENARIOS,
  PHASE12_SHARED_EVIDENCE,
} from './v141-evidence-e2e-scenarios.mjs';
import {
  reuseExistingInfrastructure,
  startInfrastructure,
  stopInfrastructure,
} from './lib/infrastructure.mjs';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(join(root, 'schemas/evidence/v1/registry.json'), 'utf8'));
const matrix = JSON.parse(
  readFileSync(join(root, 'reports/v1.4.1-evidence/source-to-evidence-matrix.json'), 'utf8'),
);
const registryTypes = new Set(registry.records.map((record) => record.recordType));
const matrixByType = new Map(matrix.records.map((record) => [record.record_type, record]));

validatePlan();

const testRefs = collectTestRefs();
const suites = groupTestRefs(testRefs);
const planHash = 'sha256:' + createHash('sha256').update(JSON.stringify(suites)).digest('hex');
const progressPath = join(root, 'reports/.phase12-e2e-progress.json');
const output = join(root, 'reports/v1.4.1-evidence/phase-12-e2e.json');
const temp = mkdtempSync(join(tmpdir(), 'sdar-v141-evidence-e2e-'));
const reportOnly = process.argv.includes('--report-only');
const passedReport = reportOnly ? loadPassedReport(output, suites) : undefined;
const startedAt = passedReport?.startedAt ?? new Date().toISOString();
const suiteResults = passedReport?.suites ?? loadProgress(progressPath, planHash);
const postgresPort = process.env.SDAR_POSTGRES_PORT ?? '55432';
const phase12PostgresUrl =
  process.env.SDAR_TEST_POSTGRES_URL ??
  `postgresql://sdar:sdar_local_only@127.0.0.1:${postgresPort}/sdar`;
const phase12ControlPostgresUrl = process.env.SDAR_CONTROL_TEST_POSTGRES_URL ?? phase12PostgresUrl;
let selfManagedInfrastructureRunning = false;

try {
  for (const [index, suite] of suites.entries()) {
    if (reportOnly) continue;
    if (suiteResults.some((result) => sameSuite(result, suite))) {
      console.log(
        '[evidence-e2e] ' +
          String(index + 1) +
          '/' +
          String(suites.length) +
          ' resume ' +
          suite.project +
          ' ' +
          suite.file,
      );
      continue;
    }
    if (!reuseExistingInfrastructure && suite.project !== 'integration') {
      if (!selfManagedInfrastructureRunning) {
        startInfrastructure(root);
        selfManagedInfrastructureRunning = true;
      }
    } else if (!reuseExistingInfrastructure && selfManagedInfrastructureRunning) {
      stopInfrastructure(root);
      selfManagedInfrastructureRunning = false;
    }
    const outputFile = join(temp, 'suite-' + String(index + 1).padStart(2, '0') + '.json');
    const pattern = suite.testNames.map(escapeRegExp).join('|');
    console.log(
      '[evidence-e2e] ' +
        String(index + 1) +
        '/' +
        String(suites.length) +
        ' ' +
        suite.project +
        ' ' +
        suite.file +
        ' (' +
        String(suite.testNames.length) +
        ' direct tests)',
    );
    const suiteArguments =
      suite.project === 'integration'
        ? [
            join(root, 'scripts/test-integration.mjs'),
            suite.file,
            '--testNamePattern',
            pattern,
            '--reporter=json',
            '--outputFile=' + outputFile,
          ]
        : [
            join(root, 'node_modules/vitest/vitest.mjs'),
            'run',
            '--project',
            suite.project,
            suite.file,
            '--testNamePattern',
            pattern,
            '--reporter=json',
            '--outputFile=' + outputFile,
          ];
    const result = spawnSync(process.execPath, suiteArguments, {
      cwd: root,
      env: {
        ...process.env,
        SDAR_TEST_POSTGRES_URL: phase12PostgresUrl,
        SDAR_CONTROL_TEST_POSTGRES_URL: phase12ControlPostgresUrl,
        SDAR_REDIS_PORT: process.env.SDAR_REDIS_PORT ?? '56379',
      },
      encoding: 'utf8',
      timeout: 900_000,
    });
    if (result.status !== 0) {
      const failedDirectory = join(root, 'reports/v1.4.1-evidence/failed-attempts');
      mkdirSync(failedDirectory, { recursive: true });
      const failedOutput = join(
        failedDirectory,
        '12-' +
          suite.project +
          '-' +
          suite.file.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '') +
          '.json',
      );
      if (existsSync(outputFile)) {
        writeFileSync(failedOutput, readFileSync(outputFile));
      }
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      console.error('[evidence-e2e] failed report ' + failedOutput);
      throw new Error(
        'PHASE12_SUITE_FAILED:' +
          suite.project +
          ':' +
          suite.file +
          ':exit=' +
          String(result.status),
      );
    }
    const parsed = JSON.parse(readFileSync(outputFile, 'utf8'));
    const passedNames = passedTestNames(parsed);
    for (const testName of suite.testNames) {
      if (![...passedNames].some((name) => name.includes(testName))) {
        throw new Error('PHASE12_TEST_RESULT_MISSING:' + suite.file + ':' + testName);
      }
    }
    suiteResults.push({
      project: suite.project,
      file: suite.file,
      testNames: suite.testNames,
      status: 'passed',
    });
    writeFileSync(
      progressPath,
      JSON.stringify({ schemaVersion: 1, planHash, suites: suiteResults }, null, 2) + '\n',
      'utf8',
    );
  }

  const completedAt = passedReport?.completedAt ?? new Date().toISOString();
  const evidence = {
    schemaVersion: 1,
    contract: 'sdar.evidence/v1',
    registryHash: matrix.registryHash,
    command: 'pnpm.cmd demo:evidence-e2e',
    startedAt,
    completedAt,
    environment: {
      runtimePostgreSQL: sanitizeDatabaseUrl(
        process.env.SDAR_TEST_POSTGRES_URL ??
          'postgresql://sdar:***@127.0.0.1:55484/sdar_v122_integration_gate',
      ),
      controlPostgreSQL: sanitizeDatabaseUrl(
        process.env.SDAR_CONTROL_TEST_POSTGRES_URL ??
          'postgresql://sdar:***@127.0.0.1:55484/sdar_control_v14_integration_gate',
      ),
      redisPort: process.env.SDAR_REDIS_PORT ?? '56384',
      httpDelivery: 'real local Node Control API and programmable Evidence sink',
    },
    dimensions: PHASE12_EVIDENCE_DIMENSIONS,
    suites: suiteResults,
    scenarios: PHASE12_SCENARIOS.map((scenarioValue) => {
      const evidenceByDimension = scenarioEvidenceByDimension(scenarioValue);
      return {
        id: scenarioValue.id,
        group: scenarioValue.group,
        name: scenarioValue.name,
        status: 'passed',
        recordTypes: scenarioValue.recordTypes,
        canonicalProfile: scenarioValue.profile,
        evidenceByDimension,
        verifiedDimensions: Object.keys(evidenceByDimension),
      };
    }),
    summary: {
      scenarios: PHASE12_SCENARIOS.length,
      passed: PHASE12_SCENARIOS.length,
      failed: 0,
      uniqueDirectTests: testRefs.length,
      suiteProcesses: suites.length,
    },
  };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(
    '[evidence-e2e] PASS ' +
      String(evidence.summary.passed) +
      '/' +
      String(evidence.summary.scenarios) +
      ' scenarios; ' +
      String(evidence.summary.uniqueDirectTests) +
      ' direct tests in ' +
      String(evidence.summary.suiteProcesses) +
      ' shared suites',
  );
  console.log('[evidence-e2e] report ' + output);
  rmSync(progressPath, { force: true });
} finally {
  if (selfManagedInfrastructureRunning) stopInfrastructure(root);
  rmSync(temp, { recursive: true, force: true });
}

function loadPassedReport(path, expectedSuites) {
  if (!existsSync(path)) throw new Error('PHASE12_REPORT_ONLY_MISSING');
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed.suites) || parsed.suites.length !== expectedSuites.length) {
    throw new Error('PHASE12_REPORT_ONLY_SUITE_COUNT');
  }
  for (const suite of expectedSuites) {
    const existing = parsed.suites.find((candidate) => sameSuite(candidate, suite));
    if (existing?.status !== 'passed') {
      throw new Error('PHASE12_REPORT_ONLY_SUITE_MISSING:' + suite.file);
    }
  }
  return parsed;
}

function loadProgress(path, expectedPlanHash) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.planHash !== expectedPlanHash || !Array.isArray(parsed.suites)) return [];
  return parsed.suites.filter((suite) => suite.status === 'passed');
}

function sameSuite(left, right) {
  return (
    left.project === right.project &&
    left.file === right.file &&
    JSON.stringify(left.testNames) === JSON.stringify(right.testNames)
  );
}

function validatePlan() {
  if (PHASE12_SCENARIOS.length !== 44) {
    throw new Error('PHASE12_SCENARIO_COUNT:' + String(PHASE12_SCENARIOS.length));
  }
  const ids = PHASE12_SCENARIOS.map((scenarioValue) => scenarioValue.id);
  if (new Set(ids).size !== 44 || ids.some((id, index) => id !== index + 1)) {
    throw new Error('PHASE12_SCENARIO_IDS');
  }
  if (PHASE12_EVIDENCE_DIMENSIONS.length !== 10) throw new Error('PHASE12_DIMENSIONS');
  for (const scenarioValue of PHASE12_SCENARIOS) {
    if (!(scenarioValue.profile in PHASE12_PROFILE_EVIDENCE)) {
      throw new Error('PHASE12_PROFILE_UNKNOWN:' + scenarioValue.name);
    }
    if (scenarioValue.recordTypes.length === 0) {
      throw new Error('PHASE12_RECORD_TYPES_EMPTY:' + scenarioValue.name);
    }
    for (const recordType of scenarioValue.recordTypes) {
      if (!registryTypes.has(recordType)) throw new Error('PHASE12_REGISTRY_MISSING:' + recordType);
      const mapped = matrixByType.get(recordType);
      if (mapped?.status !== 'implemented_and_verified') {
        throw new Error('PHASE12_SOURCE_NOT_VERIFIED:' + recordType);
      }
    }
    const evidenceByDimension = scenarioEvidenceByDimension(scenarioValue);
    for (const dimension of PHASE12_EVIDENCE_DIMENSIONS) {
      if (
        !Array.isArray(evidenceByDimension[dimension]) ||
        evidenceByDimension[dimension].length === 0
      ) {
        throw new Error(
          'PHASE12_DIMENSION_EVIDENCE_MISSING:' + scenarioValue.name + ':' + dimension,
        );
      }
    }
  }
}

function scenarioEvidenceByDimension(scenarioValue) {
  const canonical = PHASE12_PROFILE_EVIDENCE[scenarioValue.profile];
  return Object.freeze({
    source_fact: Object.freeze([scenarioValue.behavior]),
    evidence_outbox: canonical,
    stable_id: canonical,
    payload_hash: canonical,
    sequence: canonical,
    references: canonical,
    http_delivery: PHASE12_SHARED_EVIDENCE.deliveryAck,
    postgresql_ack: PHASE12_SHARED_EVIDENCE.deliveryAck,
    manifest: PHASE12_SHARED_EVIDENCE.manifest,
    business_authority_unchanged: PHASE12_SHARED_EVIDENCE.businessAuthority,
  });
}

function collectTestRefs() {
  const refs = [
    ...PHASE12_SCENARIOS.map((scenarioValue) => scenarioValue.behavior),
    ...Object.values(PHASE12_PROFILE_EVIDENCE).flat(),
    ...Object.values(PHASE12_SHARED_EVIDENCE).flat(),
  ];
  const byIdentity = new Map();
  for (const value of refs) {
    const identity = value.project + '\u0000' + value.file + '\u0000' + value.testName;
    byIdentity.set(identity, value);
  }
  return [...byIdentity.values()];
}

function groupTestRefs(refs) {
  const grouped = new Map();
  for (const value of refs) {
    const identity = value.project + '\u0000' + value.file;
    const existing = grouped.get(identity) ?? {
      project: value.project,
      file: value.file,
      testNames: [],
    };
    existing.testNames.push(value.testName);
    grouped.set(identity, existing);
  }
  return [...grouped.values()]
    .map((value) => ({ ...value, testNames: [...new Set(value.testNames)].sort() }))
    .sort((left, right) =>
      (left.project + ':' + left.file).localeCompare(right.project + ':' + right.file),
    );
}

function passedTestNames(result) {
  const names = new Set();
  for (const file of result.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'passed') names.add(assertion.fullName ?? assertion.title ?? '');
    }
  }
  return names;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sanitizeDatabaseUrl(value) {
  return value.replace(/:\/\/([^:]+):[^@]+@/u, '://$1:***@');
}
