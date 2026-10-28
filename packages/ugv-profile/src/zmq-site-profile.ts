import { z } from 'zod';
import {
  ZMQ_NATIVE_CONTROLS,
  deriveFrozenMcpCatalogAuthority,
  type McpTool,
  type McpProtocolDiscoverySnapshot,
} from '../../domain/src/index.js';
import { assertZmqCatalogContract, zmqContractChecksum } from './zmq-provider-profile.js';
import { reviewedZmqCatalog } from './zmq-catalogs.js';
const id = z.string().trim().min(1),
  checksum = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  catalogProfile: z.enum(['zmq_v1_1_0_readonly_13', 'zmq_v1_2_0_site_control_13']),
  bindingId: id,
  providerId: id,
  resourceId: id,
  localServerId: id,
  bindingRevision: z.number().int().positive(),
  catalogRevision: id,
  catalogChecksum: checksum,
  executionMode: z.literal('live'),
  simulationId: z.null(),
  validUntil: z.iso.datetime({ offset: true }),
};
export const ZmqSiteAuthoritySchema = z.discriminatedUnion('originType', [
  z.object({ ...common, originType: z.literal('direct') }).strict(),
  z
    .object({
      ...common,
      originType: z.literal('smpp_registry'),
      smppSourceId: id,
      externalServerId: id,
      registryRevision: z.number().int().positive(),
      registryChecksum: checksum,
    })
    .strict(),
]);
export type ZmqSiteAuthority = z.infer<typeof ZmqSiteAuthoritySchema>;
export const ZmqSiteStaticAuthoritySchema = z.discriminatedUnion('originType', [
  ZmqSiteAuthoritySchema.options[0].omit({ validUntil: true }),
  ZmqSiteAuthoritySchema.options[1].omit({ validUntil: true }),
]);
export type ZmqSiteStaticAuthority = z.infer<typeof ZmqSiteStaticAuthoritySchema>;

export function buildZmqSiteConsumerCandidate(
  authority: ZmqSiteAuthority,
  discovery: Pick<
    McpProtocolDiscoverySnapshot,
    'protocolVersion' | 'serverInfo' | 'providerCatalog'
  >,
  tools: readonly McpTool[],
  now: string,
) {
  const a = ZmqSiteAuthoritySchema.parse(authority);
  if (!Number.isFinite(Date.parse(now)) || Date.parse(a.validUntil) <= Date.parse(now))
    throw Error('ZMQ_AUTHORITY_EXPIRED');
  const version = a.catalogProfile === 'zmq_v1_1_0_readonly_13' ? '1.1.0' : '1.2.0';
  if (
    discovery.protocolVersion !== '2026-07-28' ||
    discovery.providerCatalog?.providerType !== 'isr.vehicle.ugv.zmq' ||
    discovery.providerCatalog.providerVersion !== version ||
    discovery.providerCatalog.providerId !== a.providerId ||
    tools.some((t) => t.serverId !== a.localServerId)
  )
    throw Error('ZMQ_PROVIDER_AUTHORITY_MISMATCH');
  assertZmqCatalogContract(tools, a.resourceId, a.catalogProfile);
  const actual = deriveFrozenMcpCatalogAuthority(discovery, tools, a.bindingRevision);
  if (actual.catalogRevision !== a.catalogRevision || actual.catalogChecksum !== a.catalogChecksum)
    throw Error('ZMQ_CATALOG_AUTHORITY_MISMATCH');
  const contractSha256 = zmqContractChecksum(reviewedZmqCatalog(a.catalogProfile));
  const executableTools = tools
    .filter((t) => version === '1.2.0' || !ZMQ_NATIVE_CONTROLS.has(t.toolName))
    .map((t) => t.toolName);
  return {
    schemaVersion: 'sdar.ugv-zmq-site-consumer-candidate/1',
    catalogProfile: a.catalogProfile,
    contractSha256,
    authority: a,
    candidateHash: zmqContractChecksum({ authority: a, contractSha256 }),
    dispatchAuthorized: false,
    credentialRef: 'unauthenticated://none',
    executableTools,
    publicationState: 'candidate_governance_pending',
  } as const;
}
