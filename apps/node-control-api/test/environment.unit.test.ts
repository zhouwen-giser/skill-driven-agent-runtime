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
        SDAR_CONTROL_OPERATOR_API_TOKEN: 'd'.repeat(32),
        SDAR_CONTROL_VIEWER_API_TOKEN: 'e'.repeat(32),
        SDAR_CONTROL_SECURITY_API_TOKEN: 'f'.repeat(32),
        SDAR_CONTROL_ORGANIZATION_API_TOKEN: 'c'.repeat(32),
        SDAR_CONTROL_ORGANIZATION_TENANT_ID: 'organization-test',
        SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
        SDAR_CONTROL_NODE_ID: 'node-p01',
        SDAR_CONTROL_NODE_DISPLAY_NAME: 'P01 Node',
      }),
    ).toMatchObject({
      SDAR_CONTROL_NODE_ID: 'node-p01',
      SDAR_CONTROL_API_HOST: '127.0.0.1',
      SDAR_CONTROL_API_PORT: 10_080,
      SDAR_CONTROL_ORGANIZATION_API_TOKEN: 'c'.repeat(32),
      SDAR_CONTROL_RATE_LIMIT_PER_MINUTE: 1_200,
      SDAR_CONTROL_REQUEST_BODY_LIMIT_KB: 64,
    });
  });

  it('fails closed for duplicate role credentials and non-loopback plaintext endpoints', () => {
    const base = {
      SDAR_CONTROL_API_TOKEN: 'a'.repeat(32),
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
      SDAR_CONTROL_NODE_ID: 'node-p13',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'P13 Node',
    };
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        SDAR_CONTROL_VIEWER_API_TOKEN: 'a'.repeat(32),
      }),
    ).toThrow('distinct service credential');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        SDAR_CONTROL_PUBLIC_URL: 'http://control.example.test',
      }),
    ).toThrow('must use HTTPS');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        SDAR_CONTROL_PUBLIC_URL: 'http://127.0.0.1.evil.example',
      }),
    ).toThrow('must use HTTPS');
  });
});
