import { z } from 'zod';
import type { McpTool } from '../../../packages/domain/src/index.js';
import {
  buildZmqSiteConsumerCandidate,
  type ZmqSiteAuthority,
} from '../../../packages/ugv-profile/src/zmq-site-profile.js';
import { assertZmqCatalogContract } from '../../../packages/ugv-profile/src/zmq-provider-profile.js';
import {
  reviewedZmqCatalog,
  type ZmqSiteCatalogProfile,
} from '../../../packages/ugv-profile/src/zmq-catalogs.js';
import {
  materializeSmppProviders,
  RuntimeRefreshSchema,
  type SmppCatalogAdmission,
  type SmppExpectedTool,
} from './smpp-provider-materializer.js';
export interface ZmqSiteMaterializationConfiguration {
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runtimeManagementBaseUrl: string;
  readonly runId: string;
  readonly catalogProfile: ZmqSiteCatalogProfile;
  readonly providerId: string;
  readonly resourceId: string;
  readonly localServerId: string;
  readonly bindingId: string;
  readonly endpointAllowlist: readonly string[];
  readonly source:
    | Readonly<{ originType: 'direct'; endpoint: string }>
    | Readonly<{ originType: 'smpp_registry'; smppSourceId: string; externalServerId: string }>;
}
const bindingSchema = z
  .object({
    bindingId: z.string(),
    localServerId: z.string(),
    originType: z.enum(['direct', 'smpp_registry']),
    endpointRef: z.string(),
    revision: z.number().int().positive(),
    catalogRevision: z.string(),
    catalogChecksum: z.string(),
    availabilityValidUntil: z.string(),
    status: z.string(),
    availabilityStatus: z.string(),
    operationCount: z.number(),
  })
  .loose();
export function assertZmqSiteEndpoint(endpoint: string, allowlist: readonly string[]) {
  const url = new URL(endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowlist.includes(url.origin)
  )
    throw Error('ZMQ_SITE_ENDPOINT_NOT_ALLOWED');
}
export async function materializeZmqSiteProvider(
  c: ZmqSiteMaterializationConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
) {
  reviewedZmqCatalog(c.catalogProfile);
  for (const url of [c.nodeControlBaseUrl, c.runtimeManagementBaseUrl])
    assertZmqSiteEndpoint(url, c.endpointAllowlist);
  const request = dependencies.fetch ?? fetch,
    now = dependencies.now ?? (() => new Date().toISOString());
  const assertCatalog = (v: SmppCatalogAdmission) => {
    if (
      v.serverId !== c.localServerId ||
      v.discovery.protocolVersion !== '2026-07-28' ||
      v.discovery.providerCatalog?.providerId !== c.providerId ||
      v.discovery.providerCatalog.providerType !== 'isr.vehicle.ugv.zmq' ||
      v.discovery.providerCatalog.providerVersion !==
        (c.catalogProfile === 'zmq_v1_1_0_readonly_13' ? '1.1.0' : '1.2.0')
    )
      throw Error('ZMQ_PROVIDER_AUTHORITY_MISMATCH');
    assertZmqCatalogContract(v.tools, c.resourceId, c.catalogProfile);
  };
  let observed: SmppCatalogAdmission | undefined, authority: ZmqSiteAuthority;
  if (c.source.originType === 'smpp_registry') {
    const tools: Record<string, SmppExpectedTool> = {};
    for (const t of reviewedZmqCatalog(c.catalogProfile).tools)
      tools[t.name] = {
        taskBehavior: z
          .object({ taskBehavior: z.enum(['task_required', 'synchronous_only']) })
          .parse(t._meta['io.sdar/taskExecution']).taskBehavior,
        executionSemantics: z
          .object({
            effect: z.enum(['read_only', 'side_effecting']),
            execution: z.enum(['synchronous', 'task_required']),
            cancellation: z.enum(['unsupported', 'task_cancel']),
            idempotency: z.literal('server_managed'),
            replay: z.enum(['allowed', 'forbidden']),
          })
          .strict()
          .parse(t._meta['io.sdar/tool-execution-semantics']),
      };
    const report = await materializeSmppProviders(
      {
        ...c,
        smppSourceId: c.source.smppSourceId,
        providers: [
          {
            providerKey: 'zmq-site',
            name: 'Native site ZMQ Provider',
            externalProviderId: c.providerId,
            externalServerId: c.source.externalServerId,
            bindingId: c.bindingId,
            localServerId: c.localServerId,
            credentialRef: 'unauthenticated://none',
            credential: { mode: 'none' },
            tools,
          },
        ],
      },
      {
        ...dependencies,
        assertSourceEndpoint: (endpoint) => {
          assertZmqSiteEndpoint(endpoint, c.endpointAllowlist);
        },
        assertCatalog: (v) => {
          assertCatalog(v);
          observed = v;
        },
      },
    );
    const b = report.providers[0];
    if (!b) throw Error('ZMQ_BINDING_AUTHORITY_MISSING');
    authority = {
      catalogProfile: c.catalogProfile,
      bindingId: c.bindingId,
      providerId: c.providerId,
      resourceId: c.resourceId,
      localServerId: c.localServerId,
      bindingRevision: b.bindingRevision,
      catalogRevision: b.catalogRevision,
      catalogChecksum: b.catalogChecksum,
      executionMode: 'live',
      simulationId: null,
      validUntil: new Date(
        Math.min(Date.parse(b.availabilityValidUntil), Date.parse(b.runtimeValidUntil)),
      ).toISOString(),
      originType: 'smpp_registry',
      smppSourceId: c.source.smppSourceId,
      externalServerId: c.source.externalServerId,
      registryRevision: b.registryRevision,
      registryChecksum: b.registryChecksum,
    };
  } else {
    const endpoint = c.source.endpoint;
    assertZmqSiteEndpoint(endpoint, c.endpointAllowlist);
    const http = async (
      base: string,
      path: string,
      method = 'GET',
      body?: unknown,
      control = false,
      missing = false,
    ): Promise<unknown> => {
      const response = await request(base + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
        headers: {
          ...(control ? { authorization: `Bearer ${c.nodeControlBearerToken}` } : {}),
          ...(['POST', 'PUT'].includes(method)
            ? { 'content-type': 'application/json', 'idempotency-key': `${c.runId}:${path}` }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (missing && response.status === 404) return undefined;
      if (!response.ok) throw Error(`ZMQ_SITE_MATERIALIZATION_HTTP_${String(response.status)}`);
      if (response.status === 204) return undefined;
      return response.json();
    };
    const serverPath = '/api/v1/mcp/servers/' + encodeURIComponent(c.localServerId);
    const servers = z
      .object({ items: z.array(z.object({ serverId: z.string(), endpoint: z.string() }).loose()) })
      .loose()
      .parse(await http(c.runtimeManagementBaseUrl, '/api/v1/mcp/servers'));
    const existing = servers.items.find((s) => s.serverId === c.localServerId);
    if (existing && existing.endpoint !== endpoint) throw Error('ZMQ_SITE_ENDPOINT_DRIFT');
    if (existing)
      await http(c.runtimeManagementBaseUrl, serverPath + '/credentials', 'PUT', {
        credentialHeaders: {},
      });
    const refreshed = RuntimeRefreshSchema.parse(
      await http(
        c.runtimeManagementBaseUrl,
        existing ? serverPath + '/refresh' : '/api/v1/mcp/servers',
        'POST',
        existing
          ? undefined
          : {
              serverId: c.localServerId,
              name: 'Native site ZMQ direct candidate',
              endpoint,
              credentialHeaders: {},
            },
      ),
    );
    const nativeTools: McpTool[] = refreshed.tools.map((t) => {
      const { supportsPauseResume, ...taskProfile } = t.taskExecutionProfile;
      return {
        serverId: t.serverId,
        toolName: t.toolName,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        protocolMode: t.protocolMode,
        executionSemantics: t.executionSemantics,
        ...(t.title === undefined ? {} : { title: t.title }),
        ...(t.description === undefined ? {} : { description: t.description }),
        taskExecutionProfile: {
          ...taskProfile,
          ...(supportsPauseResume === undefined ? {} : { supportsPauseResume }),
        },
        discoveredAt: refreshed.snapshot.discoveredAt,
      };
    });
    observed = {
      providerKey: 'zmq-site',
      serverId: c.localServerId,
      endpoint,
      discovery: {
        protocolVersion: refreshed.snapshot.protocolVersion,
        serverInfo: refreshed.snapshot.serverInfo,
        ...(refreshed.snapshot.providerCatalog === undefined
          ? {}
          : { providerCatalog: refreshed.snapshot.providerCatalog }),
      },
      tools: nativeTools,
    };
    assertCatalog(observed);
    const bindingPath = '/api/v1/mcp-provider-bindings/' + encodeURIComponent(c.bindingId);
    const prior = await http(c.nodeControlBaseUrl, bindingPath, 'GET', undefined, true, true);
    if (prior !== undefined) {
      const b = bindingSchema.parse(prior);
      if (
        b.originType !== 'direct' ||
        b.endpointRef !== endpoint ||
        b.localServerId !== c.localServerId
      )
        throw Error('ZMQ_SITE_DIRECT_BINDING_CONFLICT');
    }
    const op = z
      .object({ status: z.literal('succeeded') })
      .loose()
      .parse(
        await http(
          c.nodeControlBaseUrl,
          prior === undefined ? '/api/v1/mcp-provider-bindings' : bindingPath + '/refresh',
          'POST',
          prior === undefined
            ? {
                reason:
                  'Import the exact anonymous direct site candidate; no registry lineage asserted.',
                payload: {
                  bindingId: c.bindingId,
                  localServerId: c.localServerId,
                  originType: 'direct',
                  endpointRef: endpoint,
                  credentialRef: 'unauthenticated://none',
                },
              }
            : { reason: 'Recheck direct site authority without approving catalog drift.' },
          true,
        ),
      );
    void op;
    const b = bindingSchema.parse(
      await http(c.nodeControlBaseUrl, bindingPath, 'GET', undefined, true),
    );
    if (
      b.status !== 'active' ||
      b.availabilityStatus !== 'available' ||
      b.operationCount !== 13 ||
      b.revision !== refreshed.server.toolRevision
    )
      throw Error('ZMQ_SITE_BINDING_NOT_SELECTABLE');
    authority = {
      catalogProfile: c.catalogProfile,
      bindingId: c.bindingId,
      providerId: c.providerId,
      resourceId: c.resourceId,
      localServerId: c.localServerId,
      bindingRevision: b.revision,
      catalogRevision: b.catalogRevision,
      catalogChecksum: b.catalogChecksum,
      executionMode: 'live',
      simulationId: null,
      validUntil: new Date(
        Math.min(Date.parse(b.availabilityValidUntil), Date.parse(refreshed.snapshot.validUntil)),
      ).toISOString(),
      originType: 'direct',
    };
  }
  if (!observed) throw Error('ZMQ_BINDING_AUTHORITY_MISSING');
  const discovery = {
    ...observed.discovery,
    protocolVersion: '2026-07-28' as const,
    serverInfo: z
      .object({ name: z.string(), version: z.string() })
      .loose()
      .parse(observed.discovery.serverInfo),
  };
  return {
    candidate: buildZmqSiteConsumerCandidate(authority, discovery, observed.tools, now()),
    tools: observed.tools,
    physicalToolInvocationCount: 0,
    fieldDispatchAuthorized: false,
  } as const;
}
