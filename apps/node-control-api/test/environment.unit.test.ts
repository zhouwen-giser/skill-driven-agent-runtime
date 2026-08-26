import { describe, expect, it } from 'vitest';

import { parseNodeControlApiEnvironment } from '../src/environment.js';

describe('Node Control API environment', () => {
  it('requires an explicit non-production environment for anonymous public management', () => {
    const base = {
      SDAR_CONTROL_API_TOKEN: 'a'.repeat(32),
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
      SDAR_CONTROL_NODE_ID: 'debug',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'debug',
    };
    expect(parseNodeControlApiEnvironment(base).SDAR_DEVELOPMENT_PUBLIC_ACCESS).toBe('off');
    expect(
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'development',
        SDAR_DEVELOPMENT_PUBLIC_ACCESS: 'open',
      }).SDAR_DEVELOPMENT_PUBLIC_ACCESS,
    ).toBe('open');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'production',
        SDAR_DEVELOPMENT_PUBLIC_ACCESS: 'open',
      }),
    ).toThrow();
    expect(() =>
      parseNodeControlApiEnvironment({ ...base, SDAR_DEVELOPMENT_PUBLIC_ACCESS: 'open' }),
    ).toThrow();
  });
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

  it('permits the global outbound relaxation only for an explicit non-production profile', () => {
    const base = {
      SDAR_CONTROL_API_TOKEN: 'a'.repeat(32),
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
      SDAR_CONTROL_NODE_ID: 'node-ugv-integration',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'UGV Integration Node',
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
    };
    expect(
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_CONTROL_ENVIRONMENT: 'integration',
        SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://192.168.1.7:9998',
        SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://192.168.1.7:9999/.well-known/agent-card.json',
      }),
    ).toMatchObject({ SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open' });
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        SDAR_CONTROL_ENVIRONMENT: 'integration',
      }),
    ).toThrow('forbidden outside');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'production',
        SDAR_CONTROL_ENVIRONMENT: 'integration',
      }),
    ).toThrow('forbidden outside');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_CONTROL_ENVIRONMENT: 'production',
      }),
    ).toThrow('forbidden outside');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_CONTROL_ENVIRONMENT: 'integration',
        SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://user:secret@192.168.1.7:9998',
      }),
    ).toThrow('credential-free HTTP(S)');
    expect(() =>
      parseNodeControlApiEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_CONTROL_ENVIRONMENT: 'integration',
        SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'file:///tmp/runtime.sock',
      }),
    ).toThrow('credential-free HTTP(S)');
  });

  it('requires exact dual allowlisting for the safer private HTTP acknowledgement', () => {
    const parsed = parseNodeControlApiEnvironment({
      SDAR_CONTROL_API_TOKEN: 'a'.repeat(32),
      SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
      SDAR_CONTROL_NODE_ID: 'node-ugv-private-http',
      SDAR_CONTROL_NODE_DISPLAY_NAME: 'UGV Private HTTP Node',
      SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST: '192.168.1.7:18088',
      SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST: '192.168.1.7:19100',
      SDAR_CONTROL_PRIVATE_HTTP_ENDPOINT_ALLOWLIST: '192.168.1.7:18088,192.168.1.7:19100',
      SDAR_CONTROL_ACKNOWLEDGE_PRIVATE_HTTP_ENDPOINTS: 'YES',
    });
    expect(parsed.SDAR_CONTROL_PRIVATE_HTTP_ENDPOINT_ALLOWLIST).toContain('192.168.1.7');
    expect(() =>
      parseNodeControlApiEnvironment({
        SDAR_CONTROL_API_TOKEN: 'a'.repeat(32),
        SDAR_CONTROL_RUNTIME_SERVICE_TOKEN: 'b'.repeat(32),
        SDAR_CONTROL_NODE_ID: 'node-ugv-private-http',
        SDAR_CONTROL_NODE_DISPLAY_NAME: 'UGV Private HTTP Node',
        SDAR_CONTROL_PRIVATE_HTTP_ENDPOINT_ALLOWLIST: '192.168.1.7:19100',
      }),
    ).toThrow('explicit deployment acknowledgement');
  });
});
