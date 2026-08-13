import { describe, expect, it, vi } from 'vitest';

import { assertMcpOutboundEndpoint, createMcpOutboundFetch } from '../src/index.js';

describe('MCP outbound endpoint policy', () => {
  it('keeps exact allowlisting and TLS mandatory in safe mode', () => {
    expect(() =>
      assertMcpOutboundEndpoint('https://provider.example.test/mcp', {
        allowedAuthorities: ['provider.example.test'],
      }),
    ).not.toThrow();
    expect(() =>
      assertMcpOutboundEndpoint('http://192.168.1.7:19100/mcp', {
        allowedAuthorities: ['192.168.1.7:19100'],
      }),
    ).toThrow('SSRF/TLS policy');
    expect(() =>
      assertMcpOutboundEndpoint('https://metadata.example.test/mcp', {
        allowedAuthorities: ['provider.example.test'],
      }),
    ).toThrow('SSRF/TLS policy');
  });

  it('opens credential-free HTTP(S) in unsafe test mode and keeps redirects manual', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const governed = createMcpOutboundFetch({ unsafeTestOpen: true }, fetch);
    await expect(governed('http://192.168.1.7:19100/mcp')).resolves.toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledWith('http://192.168.1.7:19100/mcp', {
      redirect: 'manual',
    });
    for (const endpoint of ['file:///tmp/mcp.sock', 'http://user:secret@192.168.1.7/mcp'])
      expect(() => assertMcpOutboundEndpoint(endpoint, { unsafeTestOpen: true })).toThrow(
        'SSRF/TLS policy',
      );
  });
});
