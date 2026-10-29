import { deriveFrozenMcpCatalogAuthority, type McpTool } from '../../domain/src/index.js';
import { reviewedZmqCatalog, type ZmqSiteCatalogProfile } from '../src/zmq-catalogs.js';
import type { ZmqSiteAuthority } from '../src/zmq-site-profile.js';
export const siteNow = '2026-10-28T00:00:00.000Z';
export function siteFixture(profile: ZmqSiteCatalogProfile = 'zmq_v1_2_0_site_control_13') {
  const resourceId = 'vehicle:SITE-TEST';
  const tools = reviewedZmqCatalog(profile).tools.map((t) => {
    const inputSchema = structuredClone(t.inputSchema) as {
      properties: { resourceId: { const: string } };
    };
    inputSchema.properties.resourceId.const = resourceId;
    return {
      serverId: 'site-test',
      toolName: t.name,
      ...('title' in t && typeof t.title === 'string' ? { title: t.title } : {}),
      ...('description' in t && typeof t.description === 'string'
        ? { description: t.description }
        : {}),
      inputSchema,
      outputSchema: t.outputSchema,
      protocolMode: 'frozen_v1',
      taskExecutionProfile: t._meta['io.sdar/taskExecution'],
      executionSemantics: {
        ...(t._meta['io.sdar/tool-execution-semantics'] as Record<string, unknown>),
        source: 'mcp_declared',
      },
      discoveredAt: siteNow,
    } as McpTool;
  });
  const discovery = {
    protocolVersion: '2026-07-28' as const,
    serverInfo: { name: 'site-fixture', version: '2.0.0-rc.1' },
    providerCatalog: {
      providerId: 'site-provider',
      providerType: 'isr.vehicle.ugv.zmq',
      providerVersion:
        profile === 'zmq_v1_1_0_readonly_13'
          ? '1.1.0'
          : profile === 'zmq_v1_3_0_site_control_13'
            ? '1.3.0'
            : '1.2.0',
      manifestHash: 'a'.repeat(64),
    },
  };
  const authority: ZmqSiteAuthority = {
    catalogProfile: profile,
    bindingId: 'site-direct-binding',
    providerId: 'site-provider',
    resourceId,
    localServerId: 'site-test',
    bindingRevision: 1,
    ...deriveFrozenMcpCatalogAuthority(discovery, tools, 1),
    executionMode: 'live',
    simulationId: null,
    originType: 'direct',
    validUntil: '2026-10-28T00:05:00.000Z',
  };
  // Catalog operation count is observation data, not an authority field.
  const { operationCount: _count, ...a } = authority as ZmqSiteAuthority & {
    operationCount: number;
  };
  void _count;
  return { authority: a, tools, discovery };
}
