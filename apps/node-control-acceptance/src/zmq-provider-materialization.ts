import { z } from 'zod';
import catalog from '../../../packages/ugv-profile/src/zmq-catalog-contract.json' with { type: 'json' };
import {
  assertZmqCatalogContract,
  buildZmqConsumerCandidate,
  type ZmqConsumerAuthority,
} from '../../../packages/ugv-profile/src/zmq-provider-profile.js';
import {
  materializeSmppProviders,
  type SmppCatalogAdmission,
  type SmppExpectedTool,
  type SmppProviderMaterializationConfiguration,
} from './smpp-provider-materializer.js';

export interface ZmqProviderMaterializationConfiguration extends Omit<
  SmppProviderMaterializationConfiguration,
  'providers' | 'developmentComposeNetwork'
> {
  readonly qualification: 'isolated_simulator';
  readonly providerId: string;
  readonly externalServerId: string;
  readonly localServerId: string;
  readonly bindingId: string;
  readonly resourceId: string;
  readonly simulationId: string;
}

/** No remote device access, semantics overrides, Skill publication or physical dispatch. */
export async function materializeZmqProvider(
  configuration: ZmqProviderMaterializationConfiguration,
  dependencies: Readonly<{ fetch?: typeof fetch; now?: () => string }> = {},
) {
  const c = configuration;
  if (
    !z
      .object({
        qualification: z.literal('isolated_simulator'),
        simulationId: z.string().trim().min(1),
        resourceId: z.string().trim().min(1),
      })
      .safeParse(c).success
  )
    throw Error('ZMQ_ISOLATED_QUALIFICATION_REQUIRED');
  for (const address of [c.nodeControlBaseUrl, c.runtimeManagementBaseUrl])
    assertIsolatedZmqEndpoint(address);
  const tools: Record<string, SmppExpectedTool> = {};
  for (const t of catalog.tools)
    tools[t.name] = {
      taskBehavior: z
        .enum(['task_required', 'synchronous_only'])
        .parse(t._meta['io.sdar/taskExecution'].taskBehavior),
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
  let observed: SmppCatalogAdmission | undefined;
  const report = await materializeSmppProviders(
    {
      nodeControlBaseUrl: c.nodeControlBaseUrl,
      nodeControlBearerToken: c.nodeControlBearerToken,
      runtimeManagementBaseUrl: c.runtimeManagementBaseUrl,
      smppSourceId: c.smppSourceId,
      runId: c.runId,
      providers: [
        {
          providerKey: 'zmq-native',
          name: 'Isolated native ZMQ Provider',
          externalProviderId: c.providerId,
          externalServerId: c.externalServerId,
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
      assertSourceEndpoint: assertIsolatedZmqEndpoint,
      assertCatalog: (current) => {
        if (
          current.serverId !== c.localServerId ||
          current.discovery.protocolVersion !== '2026-07-28' ||
          current.discovery.providerCatalog?.providerId !== c.providerId ||
          current.discovery.providerCatalog.providerType !== 'isr.vehicle.ugv.zmq' ||
          current.tools.some((t) => t.serverId !== c.localServerId)
        )
          throw Error('ZMQ_PROVIDER_AUTHORITY_MISMATCH');
        assertZmqCatalogContract(current.tools, c.resourceId);
        observed = current;
      },
    },
  );
  const binding = report.providers[0];
  if (!binding || !observed) throw Error('ZMQ_BINDING_AUTHORITY_MISSING');
  const authority: ZmqConsumerAuthority = {
    bindingId: binding.bindingId,
    providerId: binding.externalProviderId,
    resourceId: c.resourceId,
    localServerId: c.localServerId,
    bindingRevision: binding.bindingRevision,
    registryRevision: binding.registryRevision,
    registryChecksum: binding.registryChecksum,
    catalogRevision: binding.catalogRevision,
    catalogChecksum: binding.catalogChecksum,
    simulationId: c.simulationId,
    validUntil: new Date(
      Math.min(Date.parse(binding.availabilityValidUntil), Date.parse(binding.runtimeValidUntil)),
    ).toISOString(),
  };
  const discovery = {
    ...observed.discovery,
    protocolVersion: '2026-07-28' as const,
    serverInfo: z
      .object({ name: z.string().min(1), version: z.string().min(1) })
      .loose()
      .parse(observed.discovery.serverInfo),
  };
  return {
    schemaVersion: 'sdar.zmq-provider-materialization/1',
    status: 'passed',
    qualification: 'isolated_simulator_only',
    report,
    candidate: buildZmqConsumerCandidate(
      authority,
      discovery,
      observed.tools,
      dependencies.now?.() ?? new Date().toISOString(),
    ),
    tools: observed.tools,
    physicalToolInvocationCount: 0,
    fieldDispatchAuthorized: false,
  } as const;
}

export function assertIsolatedZmqEndpoint(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    ['19100', '19101'].includes(url.port)
  )
    throw Error('ZMQ_OWNED_LOOPBACK_ENDPOINT_REQUIRED');
}
