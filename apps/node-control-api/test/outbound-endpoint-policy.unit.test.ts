import { describe, expect, it } from 'vitest';

import {
  assertOutboundEndpoint,
  assertPrivateHttpDeploymentAcknowledgement,
} from '../src/outbound-endpoint-policy.js';

describe('Node Control outbound endpoint policy', () => {
  it('keeps non-loopback plaintext and metadata endpoints closed by default', () => {
    for (const endpoint of [
      'http://192.168.1.7:19100/mcp',
      'http://169.254.169.254/latest/meta-data',
      'http://127.0.0.1.evil.example/mcp',
    ])
      expect(() => {
        assertOutboundEndpoint(endpoint, {
          allowedAuthorities: ['192.168.1.7:19100', '169.254.169.254', '127.0.0.1.evil.example'],
        });
      }).toThrow('allowlist/TLS policy');
  });

  it('admits only an acknowledged exact RFC1918 host and port in safe mode', () => {
    assertPrivateHttpDeploymentAcknowledgement({
      acknowledgement: 'YES',
      authorities: '192.168.1.7:18088,192.168.1.7:19100',
      providerAuthorities: '192.168.1.7:18088',
      mcpAuthorities: '192.168.1.7:19100',
    });
    expect(() => {
      assertOutboundEndpoint('http://192.168.1.7:19100/mcp', {
        allowedAuthorities: ['192.168.1.7:19100'],
        privateHttpAuthorities: ['192.168.1.7:19100'],
      });
    }).not.toThrow();
    for (const authority of ['192.168.1.7', '192.168.0.0/16', '169.254.169.254:80'])
      expect(() => {
        assertPrivateHttpDeploymentAcknowledgement({
          acknowledgement: 'YES',
          authorities: authority,
          providerAuthorities: authority,
          mcpAuthorities: authority,
        });
      }).toThrow();
  });

  it('opens HTTP/HTTPS authorities only under the explicit unsafe test switch', () => {
    for (const endpoint of [
      'http://192.168.1.7:19100/mcp',
      'http://169.254.169.254/latest/meta-data',
      'https://provider.example.test/mcp',
    ])
      expect(() => {
        assertOutboundEndpoint(endpoint, { unsafeTestOpen: true });
      }).not.toThrow();
    for (const endpoint of ['file:///etc/passwd', 'http://user:password@192.168.1.7/'])
      expect(() => {
        assertOutboundEndpoint(endpoint, { unsafeTestOpen: true });
      }).toThrow();
  });
});
