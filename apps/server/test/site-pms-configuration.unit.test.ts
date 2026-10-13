import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ResultSchema = z.object({
  identity: z.object({
    controlEndpoint: z.string(),
    advertisedEndpoint: z.string(),
    instanceId: z.string(),
  }),
  deviceCalls: z.number(),
});
const ConfigurationSchema = z.object({
  networks: z.object({ existing0: z.object({ external: z.boolean(), name: z.string() }) }),
});

describe('site PMS configuration', () => {
  function fixture(name: string, service = 'runtime') {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-site-pms-test-'));
    const executable = join(directory, 'docker');
    const runtime = {
      Name: '/' + name,
      Config: {
        Env: [
          'PROVIDER_ID=fixture-provider',
          'RUNTIME_DEPLOYMENT_ID=fixture-deployment',
          'RUNTIME_INSTANCE_ID=fixture-instance',
          'ADAPTER_ENDPOINT=http://fixture-adapter:7010',
        ],
        Labels: { 'com.docker.compose.service': service },
      },
      NetworkSettings: { Networks: { 'fixture-network': {} } },
    };
    writeFileSync(
      executable,
      '#!/usr/bin/env python3\nimport json,sys\n' +
        `assert sys.argv[1:]==['inspect',${JSON.stringify(name)}]\n` +
        `print(${JSON.stringify(JSON.stringify([runtime]))})\n`,
    );
    chmodSync(executable, 0o755);
    const argv = [
      resolve('deploy/sz-gowm/pms-registry.py'),
      join(directory, 'site'),
      '--api-image',
      'fixture-api',
      '--worker-image',
      'fixture-worker',
      '--postgres-image',
      'fixture-postgres',
    ];
    const env = { ...process.env, PATH: directory + ':' + (process.env['PATH'] ?? '') };
    return { directory, argv, env };
  }

  for (const name of ['smpp-gowm-runtime-1', 'local-stack-smpp-runtime-1']) {
    it(`preserves the actual Runtime identity and DNS for ${name}`, () => {
      const f = fixture(name);
      try {
        const args = name === 'smpp-gowm-runtime-1' ? [] : ['--runtime-container', name];
        const first = ResultSchema.parse(
          JSON.parse(execFileSync('python3', [...f.argv, ...args], { env: f.env }).toString()),
        );
        expect(first.identity.controlEndpoint).toBe(`http://${name}:8080`);
        expect(first.identity.advertisedEndpoint).toBe(`http://${name}:8080`);
        expect(first.identity.instanceId).toBe('fixture-instance');
        expect(first.deviceCalls).toBe(0);
        const token = readFileSync(join(f.directory, 'site/registration-token'), 'utf8');
        const repeat = ResultSchema.parse(
          JSON.parse(execFileSync('python3', [...f.argv, ...args], { env: f.env }).toString()),
        );
        expect(repeat).toEqual(first);
        expect(readFileSync(join(f.directory, 'site/registration-token'), 'utf8')).toBe(token);
        const configuration = ConfigurationSchema.parse(
          JSON.parse(readFileSync(join(f.directory, 'site/compose.json'), 'utf8')),
        );
        expect(configuration.networks.existing0).toEqual({
          external: true,
          name: 'fixture-network',
        });
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    });
  }

  it('rejects attaching a non-Runtime container', () => {
    const f = fixture('wrong-api-1', 'pms-api');
    try {
      const result = spawnSync('python3', [...f.argv, '--runtime-container', 'wrong-api-1'], {
        env: f.env,
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('PMS_RUNTIME_CONTAINER_ROLE_MISMATCH');
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
