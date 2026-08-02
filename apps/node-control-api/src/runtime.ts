import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Pool } from 'pg';

import {
  NodeControlA2aExposureService,
  NodeControlConfigurationService,
  NodeControlFoundationService,
  NodeControlLlmGovernanceService,
  NodeControlMcpProviderBindingService,
  NodeControlCapabilityService,
  NodeControlSmppRegistryService,
  NodeControlRuntimeGovernanceService,
  NodeControlTelemetryExportService,
} from '../../../packages/node-control-application/src/index.js';
import {
  HttpRuntimeGovernanceClient,
  HttpRuntimeTelemetryExportClient,
} from '../../../packages/runtime-control-http-client/src/index.js';
import {
  PostgresNodeControlA2aExposureRepository,
  PostgresNodeControlConfigurationRepository,
  PostgresNodeControlFoundationRepository,
  PostgresNodeControlLlmGovernanceRepository,
  PostgresNodeControlMcpProviderBindingRepository,
  PostgresNodeControlCapabilityRepository,
  PostgresRuntimeCapabilityImplementationCatalog,
  PostgresNodeControlSmppRegistryRepository,
} from '../../../packages/node-control-persistence-postgres/src/index.js';
import {
  EnvironmentSmppCredentialResolver,
  HttpSmppRegistryClient,
} from '../../../packages/smpp-registry-adapter/src/index.js';
import { NodeControlFrozenMcpCatalogClient } from '../../../packages/mcp-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { OfficialA2aAgentCardValidator } from '../../../packages/a2a-adapter/src/node-control-agent-card.js';
import { RuntimeCapabilityReadinessService } from '../../../packages/runtime-control-application/src/index.js';
import {
  PostgresRuntimeAgentCardRepository,
  PostgresRuntimeTaskCapabilityBindingQuery,
  PostgresRuntimeCapabilityReadinessRepository,
} from '../../../packages/runtime-control-persistence-postgres/src/index.js';
import { NodeControlCapabilityReadinessCoordinator } from './capability-readiness-coordinator.js';
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
  const runtimePool = new Pool({
    connectionString:
      environment.SDAR_CONTROL_RUNTIME_DATABASE_URL ??
      'postgresql://sdar:sdar_local_only@127.0.0.1:5432/sdar',
    max: 3,
  });
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
  const runtimeGovernance = new NodeControlRuntimeGovernanceService({
    runtime: new HttpRuntimeGovernanceClient({
      baseUrl: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
      serviceToken: environment.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
    }),
    operations: repository,
    clock: { now: () => new Date().toISOString() },
    actorId: `node-control:${environment.SDAR_CONTROL_NODE_ID}`,
  });
  const telemetryExport = new NodeControlTelemetryExportService({
    configurations: configurationService,
    runtime: new HttpRuntimeTelemetryExportClient({
      baseUrl: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
      serviceToken: environment.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
    }),
    clock: { now: () => new Date().toISOString() },
    nodeId: environment.SDAR_CONTROL_NODE_ID,
    operations: repository,
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
  const capabilityService = new NodeControlCapabilityService({
    repository: new PostgresNodeControlCapabilityRepository(pool),
    catalog: new PostgresRuntimeCapabilityImplementationCatalog(runtimePool),
    schemas: new AjvJsonSchemaValidator(),
    clock: { now: () => new Date().toISOString() },
    ids: { next: randomUUID },
  });
  const runtimeReadiness = new RuntimeCapabilityReadinessService({
    repository: new PostgresRuntimeCapabilityReadinessRepository(runtimePool),
    clock: { now: () => new Date().toISOString() },
  });
  const capabilityReadiness = new NodeControlCapabilityReadinessCoordinator({
    capabilities: capabilityService,
    runtime: runtimeReadiness,
    foundation: service,
  });
  const runtimeAgentCards = new PostgresRuntimeAgentCardRepository(runtimePool);
  const agentCardValidator = new OfficialA2aAgentCardValidator();
  const a2aExposure = new NodeControlA2aExposureService({
    repository: new PostgresNodeControlA2aExposureRepository(pool),
    capabilities: capabilityService,
    readiness: runtimeReadiness,
    runtime: runtimeAgentCards,
    validator: agentCardValidator,
    clock: { now: () => new Date().toISOString() },
    nodeId: environment.SDAR_CONTROL_NODE_ID,
    a2aUrl: new URL('/a2a', environment.SDAR_CONTROL_A2A_AGENT_CARD_URL).toString(),
  });
  const readinessTimer = setInterval(() => {
    void runtimeReadiness.evaluateExpired().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'capability_readiness.expiry_recalculation_failed', error: error instanceof Error ? error.message : 'UNKNOWN' })}\n`,
      );
    });
  }, 5_000);
  readinessTimer.unref();
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
      capabilities: capabilityService,
      capabilityReadiness,
      runtimeCapabilityReadiness: runtimeReadiness,
      a2aExposure,
      runtimeAgentCards,
      agentCardValidator,
      taskCapabilities: new PostgresRuntimeTaskCapabilityBindingQuery(runtimePool),
      runtimeGovernance,
      telemetryExport,
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
        clearInterval(readinessTimer);
        await closeServer(server);
        await pool.end();
        await runtimePool.end();
      },
    };
  } catch (error) {
    clearInterval(readinessTimer);
    await pool.end().catch(() => undefined);
    await runtimePool.end().catch(() => undefined);
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
