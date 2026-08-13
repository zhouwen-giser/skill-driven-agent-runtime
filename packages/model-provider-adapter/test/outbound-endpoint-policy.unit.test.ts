import { describe, expect, it } from 'vitest';

import { assertModelOutboundEndpoint } from '../src/index.js';

describe('model outbound endpoint policy', () => {
  it('keeps the deployment allowlist and TLS requirement closed in safe mode', () => {
    expect(() =>
      assertModelOutboundEndpoint('https://models.example.test/v1', {
        allowedAuthorities: ['models.example.test'],
      }),
    ).not.toThrow();
    expect(() =>
      assertModelOutboundEndpoint('https://metadata.example.test/v1', {
        allowedAuthorities: ['models.example.test'],
      }),
    ).toThrow('SSRF/TLS policy');
    expect(() =>
      assertModelOutboundEndpoint('http://192.168.1.7:11434/v1', {
        allowedAuthorities: ['192.168.1.7:11434'],
      }),
    ).toThrow('SSRF/TLS policy');
  });

  it('admits credential-free HTTP(S) globally only when the caller supplies unsafe_test_open', () => {
    expect(() =>
      assertModelOutboundEndpoint('http://192.168.1.7:11434/v1', { unsafeTestOpen: true }),
    ).not.toThrow();
    expect(() =>
      assertModelOutboundEndpoint('http://169.254.169.254/latest', { unsafeTestOpen: true }),
    ).not.toThrow();
    for (const endpoint of ['file:///tmp/model.sock', 'http://user:secret@192.168.1.7/v1'])
      expect(() => assertModelOutboundEndpoint(endpoint, { unsafeTestOpen: true })).toThrow(
        'SSRF/TLS policy',
      );
  });
});
