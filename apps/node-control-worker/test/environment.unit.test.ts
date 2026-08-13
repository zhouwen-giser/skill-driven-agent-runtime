import { describe, expect, it } from 'vitest';

import { parseNodeControlWorkerEnvironment } from '../src/environment.js';

describe('Node Control Worker environment', () => {
  it('keeps safe outbound policy as the default', () => {
    expect(parseNodeControlWorkerEnvironment({})).toMatchObject({
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'safe',
      SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: '127.0.0.1,localhost',
    });
  });

  it('allows unsafe_test_open only with both explicit non-production gates', () => {
    const unsafe = {
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
    };
    expect(parseNodeControlWorkerEnvironment({ ...unsafe, NODE_ENV: 'test' })).toMatchObject(
      unsafe,
    );
    expect(() => parseNodeControlWorkerEnvironment(unsafe)).toThrow('forbidden outside');
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
