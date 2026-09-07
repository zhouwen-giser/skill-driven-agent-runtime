import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import test from 'node:test';
import {
  waitForChildReady,
  localChildEndpoint,
  stopVerificationChild,
} from './lib/child-readiness.mjs';

test('endpoint readiness comes from the started child, including split stdout records', async () => {
  const child = spawn(
    process.execPath,
    [
      '--eval',
      `process.stdout.write('{"event":"test.ready",'); process.stdout.write('"a2aUrl":"http://127.0.0.1:12345"}\\n');`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ready = await waitForChildReady(child, 'test.ready');
  assert.equal(localChildEndpoint(ready.a2aUrl), 'http://127.0.0.1:12345');
});

test('a child that exits before readiness cannot authorize an HTTP probe', async () => {
  const child = spawn(process.execPath, ['--eval', 'process.exitCode = 1;'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await assert.rejects(waitForChildReady(child, 'test.ready'), /CHILD_EXITED_BEFORE_READY/u);
  assert.throws(
    () => localChildEndpoint('http://remote.example:9999'),
    /CHILD_ENDPOINT_NOT_LOCAL/u,
  );
});

test('service shutdown waits for delayed cleanup before allowing database teardown', async () => {
  const child = spawn(
    process.execPath,
    [
      '--eval',
      `
    process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),80));
    process.stdout.write(JSON.stringify({event:'shutdown.ready'})+'\\n');
    setInterval(()=>{},1000);
  `,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForChildReady(child, 'shutdown.ready');
  const started = Date.now();
  await stopVerificationChild(child);
  assert.ok(Date.now() - started >= 70);
  assert.equal(child.exitCode, 0);
});

test('service shutdown rejects nonzero exits and kills timed-out children', async () => {
  for (const [handler, timeoutMs, expected] of [
    ['process.exit(7)', 1000, /CHILD_SHUTDOWN_FAILED:7/u],
    ['', 50, /CHILD_SHUTDOWN_TIMEOUT/u],
  ]) {
    const child = spawn(
      process.execPath,
      [
        '--eval',
        `
      process.on('SIGTERM',()=>{${handler}});
      process.stdout.write(JSON.stringify({event:'shutdown.ready'})+'\\n');
      setInterval(()=>{},1000);
    `,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    await waitForChildReady(child, 'shutdown.ready');
    await assert.rejects(stopVerificationChild(child, timeoutMs), expected);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  }
});

test('isolated build/config/cleanup always name the owned project and ignore local dotenv', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sdar-isolation-contract-'));
  try {
    writeFileSync(
      join(directory, '.env'),
      'SDAR_REUSE_EXISTING_INFRA=true\nSDAR_VERIFY_COMPOSE_PROJECT=sdar\n',
    );
    writeFileSync(
      join(directory, 'docker'),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.TEST_DOCKER_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      const infra = await import(process.env.TEST_INFRA_HELPER);
      infra.buildInfrastructureImages();
      infra.validateComposeWithDocker();
      infra.stopInfrastructure();
    `,
      ],
      {
        cwd: directory,
        env: {
          PATH: directory,
          SDAR_VERIFY_ISOLATED: 'true',
          SDAR_VERIFY_COMPOSE_PROJECT: 'sdar-verify-contract',
          TEST_DOCKER_LOG: join(directory, 'docker.jsonl'),
          TEST_INFRA_HELPER: new URL('./lib/infrastructure.mjs', import.meta.url).href,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(join(directory, 'docker.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, 3);
    for (const args of calls)
      assert.deepEqual(args.slice(0, 3), ['compose', '--project-name', 'sdar-verify-contract']);
    assert.ok(calls[0].includes('build'));
    assert.ok(calls[1].includes('config'));
    assert.ok(calls[2].includes('down'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('isolated verification refuses the shared project before calling Docker', () => {
  const result = spawnSync(process.execPath, ['scripts/lib/infrastructure.mjs'], {
    env: { SDAR_VERIFY_ISOLATED: 'true', SDAR_VERIFY_COMPOSE_PROJECT: 'sdar' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /INFRASTRUCTURE_ISOLATION_PROJECT_REQUIRED/u);
});

test('a failed Docker cleanup is recorded and fails the stage while later cleanup can run', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sdar-cleanup-failure-'));
  try {
    writeFileSync(join(directory, 'docker'), `#!${process.execPath}\nprocess.exitCode = 23;\n`, {
      mode: 0o755,
    });
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      const infra = await import(process.env.TEST_INFRA_HELPER);
      infra.stopInfrastructure();
      process.stdout.write('subsequent-cleanup-reached');
    `,
      ],
      {
        cwd: directory,
        env: {
          PATH: directory,
          SDAR_VERIFY_ISOLATED: 'true',
          SDAR_VERIFY_COMPOSE_PROJECT: 'sdar-verify-cleanup-test',
          TEST_INFRA_HELPER: new URL('./lib/infrastructure.mjs', import.meta.url).href,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verification.cleanup_failed/u);
    assert.match(result.stderr, /exit=23/u);
    assert.equal(result.stdout, 'subsequent-cleanup-reached');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
