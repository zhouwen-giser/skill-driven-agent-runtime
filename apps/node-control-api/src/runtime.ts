import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Pool } from 'pg';

import {
  NodeControlConfigurationService,
  NodeControlFoundationService,
  NodeControlLlmGovernanceService,
  NodeControlMcpProviderBindingService,
  NodeControlSmppRegistryService,
} from '../../../packages/node-control-application/src/index.js';
import {
  PostgresNodeControlConfigurationRepository,
  PostgresNodeControlFoundationRepository,
  PostgresNodeControlLlmGovernanceRepository,
  PostgresNodeControlMcpProviderBindingRepository,
  PostgresNodeControlSmppRegistryRepository,
} from '../../../packages/node-control-persistence-postgres/src/index.js';
import {
  EnvironmentSmppCredentialResolver,
  HttpSmppRegistryClient,
} from '../../../packages/smpp-registry-adapter/src/index.js';
import { NodeControlFrozenMcpCatalogClient } from '../../../packages/mcp-adapter/src/index.js';
import type { NodeControlApiEnvironment } from './environment.js';
import { createNodeControlHttpApp } from './http-endpoint.js';

export interface NodeControlApiRuntime {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startNodeControlApi(
  environment: NodeControlApiEnvironment,
): Promise<NodeControlApiRuntime> {
  const pool = new Pool({ connectionString: environment.SDAR_CONTROL_DATABASE_URL, max: 10 });
  const repository = new PostgresNodeControlFoundationRepository(pool);
  const configurations = new PostgresNodeControlConfigurationRepository(pool);
  const service = new NodeControlFoundationService({
    repository,
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  const configurationService = new NodeControlConfigurationService({
    configurations,
    foundation: repository,
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  const llmGovernanceService = new NodeControlLlmGovernanceService({
    repository: new PostgresNodeControlLlmGovernanceRepository(pool),
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  const smppRegistryService = new NodeControlSmppRegistryService({
    repository: new PostgresNodeControlSmppRegistryRepository(pool),
    client: new HttpSmppRegistryClient(new EnvironmentSmppCredentialResolver()),
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  const mcpBindingService = new NodeControlMcpProviderBindingService({
    repository: new PostgresNodeControlMcpProviderBindingRepository(pool),
    catalog: new NodeControlFrozenMcpCatalogClient(
      (environment.SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST ?? '127.0.0.1,localhost').split(','),
    ),
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  try {
    await service.migrate();
    await service.bootstrapNodeProfile({
      nodeId: environment.SDAR_CONTROL_NODE_ID,
      nodeType: environment.SDAR_CONTROL_NODE_TYPE,
      displayName: environment.SDAR_CONTROL_NODE_DISPLAY_NAME,
      environment: environment.SDAR_CONTROL_ENVIRONMENT,
      runtimeEndpointRef: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
    });
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: environment.SDAR_CONTROL_API_TOKEN,
      runtimeServiceToken: environment.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
      nodeControlApiUrl: environment.SDAR_CONTROL_PUBLIC_URL,
      nodeEventsUrl: environment.SDAR_CONTROL_NODE_EVENTS_URL,
      a2aAgentCardUrl: environment.SDAR_CONTROL_A2A_AGENT_CARD_URL,
      llmGovernance: llmGovernanceService,
      smppRegistry: smppRegistryService,
      mcpBindings: mcpBindingService,
    });
    const server = await listen(
      app,
      environment.SDAR_CONTROL_API_HOST,
      environment.SDAR_CONTROL_API_PORT,
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('NODE_CONTROL_ADDRESS_INVALID');
    const baseUrl = `http://${normalizeHost(environment.SDAR_CONTROL_API_HOST)}:${String(address.port)}`;
    return {
      baseUrl,
      async close() {
        await closeServer(server);
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

function listen(
  app: ReturnType<typeof createNodeControlHttpApp>,
  host: string,
  port: number,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
    server.once('error', reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

function normalizeHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
