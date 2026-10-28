import {
  reviewedZmqCatalog,
  type ZmqCatalogProfile,
} from '../../packages/ugv-profile/src/zmq-catalogs.js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { FrozenV1RegistryAdapter } from '../../packages/mcp-adapter/src/frozen-v1-registry.js';
import {
  assertZmqCatalogContract,
  ZMQ_CONTRACT_SHA256,
  zmqContractChecksum,
} from '../../packages/ugv-profile/src/zmq-provider-profile.js';
const endpoint = process.argv[2];
if (!endpoint || new URL(endpoint).hostname !== '127.0.0.1')
  throw Error('ISOLATED_LOOPBACK_SMPP_REQUIRED');
const profile = (process.argv[3] ?? 'zmq_v1_0_1_12') as ZmqCatalogProfile;
reviewedZmqCatalog(profile);
const stamp = new Date().toISOString();
const discovery = await new FrozenV1RegistryAdapter().discover({
  server: {
    serverId: 'zmq-contract-verify',
    name: 'ZMQ isolated contract verification',
    endpoint,
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    protocolMode: 'frozen_v1',
    createdAt: stamp,
    updatedAt: stamp,
  },
  headers: {},
  snapshotId: randomUUID(),
  baselineSha256: (
    JSON.parse(readFileSync('protocol/protocol-baseline.lock.json', 'utf8')) as {
      frozenDocumentSha256: string;
    }
  ).frozenDocumentSha256,
  discoveredAt: stamp,
});
const state = discovery.tools.find((t) => t.toolName === 'vehicle_get_state');
const resource = (state?.inputSchema as { properties: { resourceId: { const: string } } })
  .properties.resourceId.const;
assertZmqCatalogContract(discovery.tools, resource, profile);
process.stdout.write(
  JSON.stringify({
    schemaVersion: 'sdar.zmq-smpp-catalog-verification/1',
    classification:
      profile === 'zmq_v1_0_1_12'
        ? 'READ_ONLY_ISOLATED_FORMAL_SMPP'
        : 'READ_ONLY_SITE_CATALOG_VERIFICATION',
    catalogProfile: profile,
    authentication: 'anonymous_no_credential_headers',
    provider: discovery.snapshot.providerCatalog,
    resourceId: resource,
    toolCount: discovery.tools.length,
    contractSha256:
      profile === 'zmq_v1_0_1_12'
        ? ZMQ_CONTRACT_SHA256
        : zmqContractChecksum(reviewedZmqCatalog(profile)),
    physicalInvocationCount: 0,
    sdarGovernancePublication: false,
  }) + '\n',
);
