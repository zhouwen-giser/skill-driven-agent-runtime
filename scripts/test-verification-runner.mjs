import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import test from 'node:test';
import { inputDigest } from './lib/verification-inputs.mjs';
import { runVerificationProcess, verificationProcessPassed } from './lib/verification-process.mjs';
import { bootstrapSteps, fullSteps } from './lib/verification-steps.mjs';
import { bootstrapVerificationResult } from './lib/verification-summary.mjs';
import { verificationProjects } from './lib/verification-projects.mjs';
import {
  cleanupVerificationMigrations,
  migrationVerificationResources,
} from './lib/verification-cleanup.mjs';
import {
  copyExternalVerificationInputs,
  externalVerificationInputs,
} from './lib/verification-external-inputs.mjs';

async function fixture(body) {
  const directory = await mkdtemp(join(tmpdir(), 'sdar-verification-test-'));
  try {
    await body({
      command: process.execPath,
      cwd: directory,
      logPath: join(directory, 'log'),
      stdout: undefined,
      stderr: undefined,
      timeoutMs: 5_000,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('outer migration cleanup finds resources after a killed verifier and preserves removal errors', () =>
  fixture(async ({ cwd }) => {
    const runId = 'sdar-verify-migration-contract';
    const owned = migrationVerificationResources(runId);
    const calls = [];
    const run = async (options) => {
      calls.push(options.args);
      const [kind, action] = options.args;
      await writeFile(
        options.logPath,
        action === 'ls'
          ? `${kind === 'container' ? owned.sourceContainer : owned.sourceVolume}\n`
          : '',
      );
      return { exitCode: action === 'rm' && kind === 'container' ? 23 : 0, cleanupErrors: [] };
    };
    const results = await cleanupVerificationMigrations({ runId, cwd, env: {}, reports: cwd, run });
    assert.equal(results.length, 4);
    assert.equal(results.filter(verificationProcessPassed).length, 3);
    assert.deepEqual(calls[1], ['container', 'rm', '--force', owned.sourceContainer]);
    assert.deepEqual(calls[3], ['volume', 'rm', owned.sourceVolume]);
    for (const args of calls.filter((args) => args[1] === 'ls')) {
      assert.ok(args.includes(`label=io.sdar.run=${runId}`));
      assert.ok(args.includes('label=io.sdar.scope=p13-migration-verifier'));
    }
  }));

test('migration cleanup never removes a resource outside its exact ownership set', () =>
  fixture(async ({ cwd }) => {
    const calls = [];
    const results = await cleanupVerificationMigrations({
      runId: 'sdar-verify-migration-contract',
      cwd,
      env: {},
      reports: cwd,
      run: async (options) => {
        calls.push(options.args);
        await writeFile(options.logPath, 'shared-postgres\n');
        return { exitCode: 0, cleanupErrors: [] };
      },
    });
    assert.ok(calls.every((args) => args[1] === 'ls'));
    assert.equal(
      results.filter((result) => result.error === 'MIGRATION_CLEANUP_RESOURCE_NOT_OWNED').length,
      2,
    );
    await assert.rejects(
      cleanupVerificationMigrations({ runId: 'sdar', cwd, env: {}, reports: cwd }),
      /VERIFICATION_PROJECT_ROOT_INVALID/u,
    );
  }));

test('stage output is persisted before exit; nonzero exit cannot pass', () =>
  fixture(async (options) => {
    let sawOutput = false;
    const resultPromise = runVerificationProcess({
      ...options,
      args: [
        '--eval',
        "process.stdout.write('live-output'); setTimeout(() => { process.exitCode = 7; }, 400);",
      ],
      stdout: {
        write() {
          sawOutput = true;
        },
      },
    });
    for (let attempt = 0; attempt < 100 && !sawOutput; attempt += 1) await delay(10);
    assert.equal(sawOutput, true);
    assert.match(await readFile(options.logPath, 'utf8'), /live-output/u);
    const result = await resultPromise;
    assert.equal(result.exitCode, 7);
    assert.equal(verificationProcessPassed(result), false);
  }));

test('timeout kills a SIGTERM-resistant descendant, records reason and never passes', () =>
  fixture(async (options) => {
    const result = await runVerificationProcess({
      ...options,
      timeoutMs: 700,
      graceMs: 100,
      args: [
        '--eval',
        `
      const { spawn } = require('node:child_process');
      process.on('SIGTERM', () => {});
      spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); console.log('descendant=' + process.pid); setInterval(() => {}, 100);"], { stdio: 'inherit' });
      setInterval(() => {}, 100);
    `,
      ],
    });
    assert.equal(result.reason, 'timeout');
    assert.equal(verificationProcessPassed(result), false);
    assert.ok(result.durationMs < 4_000);
    const pid = (await readFile(options.logPath, 'utf8')).match(/descendant=(\d+)/u)?.[1];
    assert.ok(pid);
    const status = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
    assert.ok(status === undefined || status.slice(status.lastIndexOf(')') + 2).startsWith('Z '));
    assert.deepEqual(result.cleanupErrors, []);
  }));

test('successful leader cannot leak a background child or an inherited stdout pipe', () =>
  fixture(async (options) => {
    const result = await runVerificationProcess({
      ...options,
      args: [
        '--eval',
        `
    const child = require('node:child_process').spawn(process.execPath, ['--eval', 'setInterval(() => {}, 100);'], { stdio: 'inherit' });
    child.unref();
  `,
      ],
    });
    assert.equal(verificationProcessPassed(result), true);
    assert.ok(result.durationMs < 4_000);
  }));

test('caller cancellation is retained even when the child exits with zero', () =>
  fixture(async (options) => {
    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    try {
      const result = await runVerificationProcess({
        ...options,
        signal: controller.signal,
        args: [
          '--eval',
          "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 100);",
        ],
      });
      assert.equal(result.reason, 'canceled');
      assert.equal(verificationProcessPassed(result), false);
    } finally {
      clearTimeout(timer);
    }
  }));

test('missing executable produces a failed stage report', () =>
  fixture(async (options) => {
    const result = await runVerificationProcess({ ...options, command: '/not-an-sdar-executable' });
    assert.match(result.error, /ENOENT/u);
    assert.equal(verificationProcessPassed(result), false);
  }));

test('runtime identity ignores progress reports but binds code, tests, assets and lockfile', () => {
  const entry = (path, content) => ({
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
  const paths = [
    'apps/server/src/runtime.ts',
    'packages/domain/test/workflow.unit.test.ts',
    'infra/postgres/migrations/0178_example.up.sql',
    'prompts/planner.md',
    'skills/example.yaml',
    'pnpm-lock.yaml',
    'compose.yaml',
    'docs/01_REQUIREMENTS_BASELINE.md',
    'source/baseline.docx',
    'PROJECT_STATUS.md',
    'execplans/EP-RUNTIME-SEMANTIC-CLOSURE.md',
    'reports/verification/summary.json',
  ];
  const inputs = paths.map((path) => entry(path, 'original'));
  for (const path of [
    'reports/v1.4.1-evidence/source-to-evidence-matrix.json',
    'reports/v1.4.1-evidence/verification-proof-manifest.json',
    'reports/ugv-agent-profile-simulation/contract-freeze.json',
  ]) {
    assert.notEqual(
      inputDigest([entry(path, 'original')], 'runtime'),
      inputDigest([entry(path, 'changed')], 'runtime'),
      path,
    );
  }
  for (const path of paths.slice(0, 7)) {
    const changed = inputs.map((item) => (item.path === path ? entry(path, 'changed') : item));
    assert.notEqual(inputDigest(changed, 'runtime'), inputDigest(inputs, 'runtime'), path);
  }
  for (const path of paths.slice(7)) {
    const changed = inputs.map((item) => (item.path === path ? entry(path, 'changed') : item));
    assert.equal(inputDigest(changed, 'runtime'), inputDigest(inputs, 'runtime'), path);
    if (path.startsWith('docs/') || path.startsWith('source/'))
      assert.notEqual(inputDigest(changed, 'baseline'), inputDigest(inputs, 'baseline'), path);
  }
});

test('full gate includes every bootstrap stage with independent limits and no aggregate command', () => {
  assert.deepEqual(fullSteps.slice(0, bootstrapSteps.length), bootstrapSteps);
  const limits = Object.fromEntries(bootstrapSteps.map(([name, , timeout]) => [name, timeout]));
  assert.equal(limits.format, 300_000);
  for (const name of ['lint', 'typecheck', 'unit']) assert.equal(limits[name], 1_200_000);
  for (const name of ['contract', 'build']) assert.equal(limits[name], 600_000);
  assert.equal(
    fullSteps.some(([, args]) => args.includes('verify:bootstrap')),
    false,
  );
});

test('release reader aggregates split metrics and rejects missing/duplicate/failed current steps', () => {
  const summary = {
    schemaVersion: 2,
    scope: 'full',
    status: 'passed',
    pendingSteps: [],
    steps: fullSteps.map(([name]) => ({
      name,
      status: 'passed',
      exitCode: 0,
      metrics: { tests: 3, testFiles: 1, openapiOperations: 200 },
    })),
  };
  assert.deepEqual(bootstrapVerificationResult(summary), {
    status: 'passed',
    metrics: { tests: 6, testFiles: 2, openapiOperations: 200 },
  });
  assert.throws(
    () =>
      bootstrapVerificationResult({
        ...summary,
        steps: summary.steps.filter((step) => step.name !== 'build'),
      }),
    /STAGE_INVALID:build/u,
  );
  assert.throws(
    () => bootstrapVerificationResult({ ...summary, steps: [...summary.steps, summary.steps[0]] }),
    /STAGE_INVALID:format/u,
  );
  assert.throws(
    () =>
      bootstrapVerificationResult({
        ...summary,
        steps: summary.steps.map((step) =>
          step.name === 'unit' ? { ...step, reason: 'timeout' } : step,
        ),
      }),
    /STAGE_INVALID:unit/u,
  );
  assert.throws(
    () => bootstrapVerificationResult({ ...summary, pendingSteps: ['build'] }),
    /INCOMPLETE/u,
  );
  const legacy = {
    schemaVersion: 1,
    status: 'passed',
    steps: [{ name: 'static-unit-contract-build', status: 'passed', metrics: { tests: 10 } }],
  };
  assert.equal(bootstrapVerificationResult(legacy).metrics.tests, 10);
  assert.throws(() => bootstrapVerificationResult({ ...legacy, schemaVersion: 2 }), /INCOMPLETE/u);
});

test('sibling assets are frozen byte copies with runtime identity and exclude deployment secrets', () =>
  fixture(async ({ cwd }) => {
    const source = join(cwd, 'source');
    const snapshot = join(cwd, 'snapshot');
    for (const path of externalVerificationInputs) {
      await mkdir(dirname(join(source, path)), { recursive: true });
      await writeFile(join(source, path), `original:${path}`);
    }
    await writeFile(join(source, 'smpp-telemetry-platform/.env'), 'PRIVATE=must-not-copy');
    const entries = await copyExternalVerificationInputs(source, snapshot);
    assert.equal(entries.length, externalVerificationInputs.length);
    await assert.rejects(access(join(snapshot, 'smpp-telemetry-platform/.env')), {
      code: 'ENOENT',
    });
    const first = externalVerificationInputs[0];
    await writeFile(join(source, first), 'changed');
    assert.equal(await readFile(join(snapshot, first), 'utf8'), `original:${first}`);
    const next = await copyExternalVerificationInputs(source, join(cwd, 'next'));
    assert.notEqual(inputDigest(entries, 'runtime'), inputDigest(next, 'runtime'));
  }));

test('nested smoke projects belong to the outer run cleanup allowlist', () => {
  assert.deepEqual(verificationProjects('sdar-verify-contract'), [
    { name: 'sdar-verify-contract', file: 'compose.yaml' },
    { name: 'sdar-verify-contract-control-smoke', file: 'compose.node-control.yaml' },
    { name: 'sdar-verify-contract-runtime-smoke', file: 'compose.yaml' },
  ]);
  assert.throws(() => verificationProjects('sdar'), /PROJECT_ROOT_INVALID/u);
  assert.throws(() => verificationProjects('../sdar-verify-contract'), /PROJECT_ROOT_INVALID/u);
});
