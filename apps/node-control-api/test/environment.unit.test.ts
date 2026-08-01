import { describe, expect, it } from 'vitest';

import { parseNodeControlApiEnvironment } from '../src/environment.js';

describe('Node Control API environment', () => {
  it('requires a deployment bearer token and stable Node identity', () => {
    expect(() => parseNodeControlApiEnvironment({})).toThrow();
  });

  it('parses the bounded API environment without exposing runtime secrets', () => {
    expect(
      parseNodeControlApiEnvironment({
        SDAR_CONTROL_API_TOKEN: 'a'.repeat(32),
        SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
        SDAR_CONTROL_NODE_ID: 'node-p01',
        SDAR_CONTROL_NODE_DISPLAY_NAME: 'P01 Node',
      }),
    ).toMatchObject({
      SDAR_CONTROL_NODE_ID: 'node-p01',
      SDAR_CONTROL_API_HOST: '127.0.0.1',
      SDAR_CONTROL_API_PORT: 10_080,
    });
  });
});
