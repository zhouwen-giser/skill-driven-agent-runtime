import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { parseNodeControlWorkerEnvironment } from '../src/environment.js';

describe('Node Control Worker environment', () => {
  it('keeps the scheduled worker timer referenced for process liveness', async () => {
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('const timer = setInterval(');
    expect(main).not.toContain('timer.unref()');
  });

  it('keeps safe outbound policy as the default', () => {
    expect(parseNodeControlWorkerEnvironment({})).toMatchObject({
      NODE_ENV: 'development',
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'safe',
      SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: '127.0.0.1,localhost',
    });
  });

  it('allows unsafe_test_open under the default development marker', () => {
    const unsafe = {
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
    };
    expect(parseNodeControlWorkerEnvironment({ ...unsafe, NODE_ENV: 'test' })).toMatchObject(
      unsafe,
    );
    expect(parseNodeControlWorkerEnvironment(unsafe)).toMatchObject({
      ...unsafe,
      NODE_ENV: 'development',
    });
    expect(() => parseNodeControlWorkerEnvironment({ ...unsafe, NODE_ENV: 'production' })).toThrow(
      'forbidden outside',
    );
    expect(() =>
      parseNodeControlWorkerEnvironment({
        ...unsafe,
        NODE_ENV: 'development',
        SDAR_CONTROL_ENVIRONMENT: 'production',
      }),
    ).toThrow('forbidden outside');
  });
});
