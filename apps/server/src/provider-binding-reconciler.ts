import type {
  CurrentMcpProviderBindingAuthorityPort,
  McpRegistryRepository,
} from '../../../packages/application/src/ports.js';

type RegisteredAuthority = Awaited<
  ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
>;

/** Copies registered semantic contracts into Runtime; health observations never rotate anchors. */
export async function reconcileRegisteredProviderBindings(
  input: Readonly<{
    servers: Pick<McpRegistryRepository, 'listServers'>;
    authority: CurrentMcpProviderBindingAuthorityPort;
    synchronize: (authority: RegisteredAuthority) => Promise<unknown>;
    onFailure: (serverId: string, error: unknown) => void;
  }>,
): Promise<Readonly<{ checkedCount: number; failedCount: number }>> {
  const servers = await input.servers.listServers();
  let checkedCount = 0;
  let failedCount = 0;
  for (const server of servers) {
    if (server.status !== 'enabled' || server.protocolMode !== 'frozen_v1') continue;
    try {
      const authority = await input.authority.loadCurrentMcpProviderBinding({
        localServerId: server.serverId,
      });
      // Neither readiness nor its TTL owns this registered contract. Execution checks health.
      await input.synchronize(authority);
      checkedCount += 1;
    } catch (error: unknown) {
      failedCount += 1;
      input.onFailure(server.serverId, error);
    }
  }
  return Object.freeze({ checkedCount, failedCount });
}
