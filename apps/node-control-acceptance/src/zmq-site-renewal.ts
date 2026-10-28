import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { RuntimeRefreshSchema } from './smpp-provider-materializer.js';
import {
  assertZmqSiteEndpoint,
  type ZmqSiteMaterializationConfiguration,
} from './zmq-site-materialization.js';
import {
  ZmqSiteAuthoritySchema,
  buildZmqSiteConsumerCandidate,
  type ZmqSiteAuthority,
} from '../../../packages/ugv-profile/src/zmq-site-profile.js';
import type { McpTool } from '../../../packages/domain/src/index.js';
import { zmqContractChecksum } from '../../../packages/ugv-profile/src/zmq-provider-profile.js';
const bindingSchema = z
  .object({
    bindingId: z.string(),
    localServerId: z.string(),
    originType: z.string(),
    revision: z.number().int().positive(),
    catalogRevision: z.string(),
    catalogChecksum: z.string(),
    availabilityValidUntil: z.iso.datetime({ offset: true }),
    status: z.string(),
    availabilityStatus: z.string(),
    operationCount: z.number(),
    smppSourceId: z.string().optional(),
    externalServerId: z.string().optional(),
    registryRevision: z.number().int().optional(),
    registryChecksum: z.string().optional(),
  })
  .loose();
/** Refreshes existing approved authority only. There is deliberately no import, approval or publication path. */
export async function renewZmqSiteBinding(
  c: ZmqSiteMaterializationConfiguration,
  value: ZmqSiteAuthority,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
) {
  const expected = ZmqSiteAuthoritySchema.parse(value),
    request = dependencies.fetch ?? fetch;
  for (const endpoint of [c.nodeControlBaseUrl, c.runtimeManagementBaseUrl])
    assertZmqSiteEndpoint(endpoint, c.endpointAllowlist);
  if (
    expected.bindingId !== c.bindingId ||
    expected.localServerId !== c.localServerId ||
    expected.resourceId !== c.resourceId ||
    expected.providerId !== c.providerId ||
    expected.catalogProfile !== c.catalogProfile
  )
    throw Error('ZMQ_RENEWAL_CONFIGURATION_CONFLICT');
  const now = dependencies.now ?? (() => new Date().toISOString());
  const http = async (
    base: string,
    path: string,
    control: boolean,
    method = 'GET',
    body?: unknown,
  ) => {
    const response = await request(base + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        ...(control ? { authorization: `Bearer ${c.nodeControlBearerToken}` } : {}),
        ...(method === 'POST'
          ? {
              'content-type': 'application/json',
              'idempotency-key': `${c.runId}:renew:${randomUUID()}`,
            }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw Error(`ZMQ_RENEWAL_HTTP_${String(response.status)}`);
    return response.json();
  };
  const path = '/api/v1/mcp-provider-bindings/' + encodeURIComponent(c.bindingId);
  const assertBinding = (raw: unknown) => {
    const b = bindingSchema.parse(raw);
    if (
      b.bindingId !== expected.bindingId ||
      b.localServerId !== expected.localServerId ||
      b.originType !== expected.originType ||
      b.revision !== expected.bindingRevision ||
      b.catalogRevision !== expected.catalogRevision ||
      b.catalogChecksum !== expected.catalogChecksum ||
      b.status !== 'active' ||
      b.operationCount !== 13 ||
      (expected.originType === 'smpp_registry' &&
        (b.smppSourceId !== expected.smppSourceId ||
          b.externalServerId !== expected.externalServerId ||
          b.registryRevision !== expected.registryRevision ||
          b.registryChecksum !== expected.registryChecksum))
    )
      throw Error('ZMQ_RENEWAL_BINDING_DRIFT');
    return b;
  };
  assertBinding(await http(c.nodeControlBaseUrl, path, true));
  const fresh = RuntimeRefreshSchema.parse(
    await http(
      c.runtimeManagementBaseUrl,
      '/api/v1/mcp/servers/' + encodeURIComponent(c.localServerId) + '/refresh',
      false,
      'POST',
    ),
  );
  if (
    fresh.server.serverId !== expected.localServerId ||
    fresh.server.toolRevision !== expected.bindingRevision
  )
    throw Error('ZMQ_RENEWAL_RUNTIME_REVISION_DRIFT');
  const tools: McpTool[] = fresh.tools.map((t) => ({
    serverId: t.serverId,
    toolName: t.toolName,
    ...(t.title === undefined ? {} : { title: t.title }),
    ...(t.description === undefined ? {} : { description: t.description }),
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    protocolMode: t.protocolMode,
    executionSemantics: t.executionSemantics,
    taskExecutionProfile: t.taskExecutionProfile,
    discoveredAt: fresh.snapshot.discoveredAt,
  }));
  // Validate the complete current catalog before extending the Binding TTL.
  const candidate = buildZmqSiteConsumerCandidate(
    { ...expected, validUntil: fresh.snapshot.validUntil },
    {
      protocolVersion: fresh.snapshot.protocolVersion,
      serverInfo: fresh.snapshot.serverInfo,
      ...(fresh.snapshot.providerCatalog
        ? { providerCatalog: fresh.snapshot.providerCatalog }
        : {}),
    },
    tools,
    now(),
  );
  const operation = z
    .object({ status: z.literal('succeeded') })
    .loose()
    .parse(
      await http(c.nodeControlBaseUrl, path + '/refresh', true, 'POST', {
        reason:
          'Renew the existing exact anonymous native authority; catalog drift requires separate governance.',
      }),
    );
  void operation;
  const b = assertBinding(await http(c.nodeControlBaseUrl, path, true));
  if (
    b.availabilityStatus !== 'available' ||
    Date.parse(b.availabilityValidUntil) <= Date.parse(now())
  )
    throw Error('ZMQ_RENEWAL_NOT_AVAILABLE');
  const authority = {
    ...expected,
    validUntil: new Date(
      Math.min(Date.parse(b.availabilityValidUntil), Date.parse(fresh.snapshot.validUntil)),
    ).toISOString(),
  };
  const { validUntil: _old, ...oldIdentity } = expected;
  const { validUntil: _new, ...newIdentity } = authority;
  void _old;
  void _new;
  if (zmqContractChecksum(oldIdentity) !== zmqContractChecksum(newIdentity))
    throw Error('ZMQ_RENEWAL_AUTHORITY_DRIFT');
  return {
    schemaVersion: 'sdar.zmq-site-renewal/1',
    status: 'renewed',
    authority,
    contractSha256: candidate.contractSha256,
    approvalCount: 0,
    physicalToolInvocationCount: 0,
  } as const;
}
