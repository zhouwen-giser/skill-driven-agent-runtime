import { describe, it, expect } from 'vitest';
import { siteFixture, siteNow } from '../test-support/zmq-site.js';
import { renewZmqSiteBinding } from '../../../apps/node-control-acceptance/src/zmq-site-renewal.js';
import type { ZmqSiteMaterializationConfiguration } from '../../../apps/node-control-acceptance/src/zmq-site-materialization.js';
describe('renewal of exact approved site authority', () => {
  it.each([false, true])(
    'retains full catalog metadata and refuses drift=%s before extending authority',
    async (drift) => {
      const f = siteFixture();
      const c: ZmqSiteMaterializationConfiguration = {
        nodeControlBaseUrl: 'http://127.0.0.1:10191',
        nodeControlBearerToken: 'unit-test-private-service-token',
        runtimeManagementBaseUrl: 'http://127.0.0.1:11098',
        runId: 'unit-renewal',
        catalogProfile: f.authority.catalogProfile,
        providerId: f.authority.providerId,
        resourceId: f.authority.resourceId,
        localServerId: f.authority.localServerId,
        bindingId: f.authority.bindingId,
        endpointAllowlist: ['http://127.0.0.1:10191', 'http://127.0.0.1:11098'],
        source: { originType: 'direct', endpoint: 'http://127.0.0.1:19110/mcp' },
      };
      const requests: { path: string; method: string }[] = [];
      const request: typeof fetch = (url, init) => {
        const path = new URL(
            typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
          ).pathname,
          method = init?.method ?? 'GET';
        requests.push({ path, method });
        if (path.endsWith('/mcp/servers/' + c.localServerId + '/refresh')) {
          const tools = f.tools.map((t, i) =>
            i === 0 && drift ? { ...t, description: 'unreviewed description drift' } : t,
          );
          return Promise.resolve(
            Response.json({
              server: {
                serverId: c.localServerId,
                name: 'native',
                endpoint: c.source.originType === 'direct' ? c.source.endpoint : '',
                protocolMode: 'frozen_v1',
                toolRevision: 1,
                status: 'enabled',
              },
              tools,
              snapshot: {
                ...f.discovery,
                discoveredAt: siteNow,
                validUntil: '2026-10-28T00:10:00.000Z',
                toolRevision: 1,
              },
            }),
          );
        }
        if (method === 'POST') return Promise.resolve(Response.json({ status: 'succeeded' }));
        return Promise.resolve(
          Response.json({
            bindingId: c.bindingId,
            localServerId: c.localServerId,
            originType: 'direct',
            revision: 1,
            catalogRevision: f.authority.catalogRevision,
            catalogChecksum: f.authority.catalogChecksum,
            availabilityValidUntil: '2026-10-28T00:10:00.000Z',
            status: 'active',
            availabilityStatus: 'available',
            operationCount: 13,
          }),
        );
      };
      const result = renewZmqSiteBinding(c, f.authority, { fetch: request, now: () => siteNow });
      if (drift) await expect(result).rejects.toThrow('CATALOG_AUTHORITY_MISMATCH');
      else
        expect(await result).toMatchObject({
          status: 'renewed',
          approvalCount: 0,
          physicalToolInvocationCount: 0,
          authority: {
            bindingRevision: 1,
            catalogChecksum: f.authority.catalogChecksum,
            validUntil: '2026-10-28T00:10:00.000Z',
          },
        });
      expect(
        requests.filter((r) => r.method === 'POST' && r.path.includes('mcp-provider-bindings')),
      ).toHaveLength(drift ? 0 : 1);
      expect(requests.every((r) => !/approve|tools\/call|publish|\/import/.test(r.path))).toBe(
        true,
      );
    },
  );
});
