import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { Pool } from 'pg';

import {
  NodeControlA2aExposureService,
  NodeControlConfigurationService,
  NodeControlFoundationService,
  NodeControlEventService,
  NodeControlLlmGovernanceService,
  NodeControlMcpProviderBindingService,
  NodeControlCapabilityService,
  NodeControlSmppRegistryService,
  NodeControlRuntimeGovernanceService,
  NodeControlEvidenceExportService,
  NodeControlEvidenceOperationsService,
} from '../../../packages/node-control-application/src/index.js';
import {
  HttpRuntimeGovernanceClient,
  HttpRuntimeEvidenceExportClient,
  HttpRuntimeEvidenceOperationsClient,
} from '../../../packages/runtime-control-http-client/src/index.js';
import {
  PostgresNodeControlA2aExposureRepository,
  PostgresNodeControlConfigurationRepository,
  PostgresNodeControlFoundationRepository,
  PostgresNodeControlEventRepository,
  PostgresNodeControlLlmGovernanceRepository,
  PostgresNodeControlMcpProviderBindingRepository,
  PostgresNodeControlCapabilityRepository,
  PostgresNodeControlEvidenceSource,
  PostgresRuntimeCapabilityImplementationCatalog,
  PostgresNodeHealthObservationProducer,
  PostgresNodeControlSmppRegistryRepository,
} from '../../../packages/node-control-persistence-postgres/src/index.js';
import {
  EnvironmentSmppCredentialResolver,
  HttpSmppRegistryClient,
} from '../../../packages/smpp-registry-adapter/src/index.js';
import { NodeControlFrozenMcpCatalogClient } from '../../../packages/mcp-adapter/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { OfficialA2aAgentCardValidator } from '../../../packages/a2a-adapter/src/node-control-agent-card.js';
import {
  CatalogValidatingEvidenceWriter,
  NodeControlEvidenceProjectionPipeline,
  NodeControlEvidenceProjector,
  RuntimeCapabilityReadinessService,
} from '../../../packages/runtime-control-application/src/index.js';
import {
  PostgresEvidenceStore,
  PostgresNodeControlTelemetryEvidenceSource,
  PostgresRuntimeAgentCardRepository,
  PostgresRuntimeTaskCapabilityBindingQuery,
  PostgresRuntimeTaskSummaryQuery,
  PostgresRuntimeCapabilityReadinessRepository,
  PostgresRuntimeMcpCatalogAuthorityReader,
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
    runtimeControlConfigured: true,
  });
  const nodeEvents = new NodeControlEventService(
    new PostgresNodeControlEventRepository(pool, runtimePool),
  );
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
  const evidenceExport = new NodeControlEvidenceExportService({
    configurations: configurationService,
    runtime: new HttpRuntimeEvidenceExportClient({
      baseUrl: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
      serviceToken: environment.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
    }),
    clock: { now: () => new Date().toISOString() },
    nodeId: environment.SDAR_CONTROL_NODE_ID,
    operations: repository,
  });
  const evidenceOperations = new NodeControlEvidenceOperationsService({
    runtime: new HttpRuntimeEvidenceOperationsClient({
      baseUrl: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
      serviceToken: environment.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
    }),
    operations: repository,
    clock: { now: () => new Date().toISOString() },
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
  const mcpBindingRepository = new PostgresNodeControlMcpProviderBindingRepository(pool);
  const runtimeMcpCatalogAuthority = new PostgresRuntimeMcpCatalogAuthorityReader(runtimePool);
  const mcpBindingService = new NodeControlMcpProviderBindingService({
    repository: mcpBindingRepository,
    catalog: new NodeControlFrozenMcpCatalogClient(
      (environment.SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST ?? '127.0.0.1,localhost').split(','),
      undefined,
      runtimeMcpCatalogAuthority,
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
    repository: new PostgresRuntimeCapabilityReadinessRepository(
      runtimePool,
      mcpBindingRepository,
      runtimeMcpCatalogAuthority,
    ),
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
  let controlEvidenceTimer: ReturnType<typeof setInterval> | undefined;
  let healthObservationTimer: ReturnType<typeof setInterval> | undefined;
  let controlEvidenceInFlight: Promise<void> | undefined;
  let telemetryEvidenceInFlight: Promise<void> | undefined;
  let healthObservationInFlight: Promise<void> | undefined;
  try {
    await service.migrate();
    await service.bootstrapNodeProfile({
      nodeId: environment.SDAR_CONTROL_NODE_ID,
      nodeType: environment.SDAR_CONTROL_NODE_TYPE,
      displayName: environment.SDAR_CONTROL_NODE_DISPLAY_NAME,
      environment: environment.SDAR_CONTROL_ENVIRONMENT,
      runtimeEndpointRef: environment.SDAR_CONTROL_RUNTIME_ENDPOINT_REF,
      status: 'active',
    });
    const evidenceStore = new PostgresEvidenceStore(runtimePool);
    const catalogValidatingEvidenceWriter = new CatalogValidatingEvidenceWriter({
      delegate: evidenceStore,
      validator: new AjvJsonSchemaValidator({ strict: false }),
    });
    const evidenceProjectorWriter = Object.assign(catalogValidatingEvidenceWriter, {
      hasRecord: evidenceStore.hasRecord.bind(evidenceStore),
      saveCheckpoint: evidenceStore.saveCheckpoint.bind(evidenceStore),
    });
    const controlEvidenceSource = new PostgresNodeControlEvidenceSource(pool, runtimePool, {
      principalType: 'service',
      actorId: `service:node-control-evidence-projector:${environment.SDAR_CONTROL_NODE_ID}`,
      role: 'node_control_evidence_projector',
      permission: 'node_control.evidence.read',
      authorityScope: 'global_authority',
      organizationScope: 'node_local',
      nodeId: environment.SDAR_CONTROL_NODE_ID,
      allowedDataClassifications: ['public', 'internal', 'restricted'],
    });
    const controlEvidenceProjector = new NodeControlEvidenceProjector({
      source: controlEvidenceSource,
      writer: evidenceProjectorWriter,
      environment: environment.SDAR_CONTROL_ENVIRONMENT,
    });
    const controlEvidencePipeline = new NodeControlEvidenceProjectionPipeline({
      source: controlEvidenceSource,
      projector: controlEvidenceProjector,
      writer: evidenceStore,
    });
    const telemetryEvidenceSource = new PostgresNodeControlTelemetryEvidenceSource(runtimePool);
    const telemetryEvidenceProjector = new NodeControlEvidenceProjector({
      source: telemetryEvidenceSource,
      writer: evidenceProjectorWriter,
      environment: environment.SDAR_CONTROL_ENVIRONMENT,
    });
    const telemetryEvidencePipeline = new NodeControlEvidenceProjectionPipeline({
      source: telemetryEvidenceSource,
      projector: telemetryEvidenceProjector,
      writer: evidenceStore,
    });
    const healthObservations = new PostgresNodeHealthObservationProducer(pool);
    const observeHealth = async () => {
      await healthObservations.recordNext(`health-${randomUUID()}`, await service.getNodeHealth(), {
        actorId: `node-control:${environment.SDAR_CONTROL_NODE_ID}`,
      });
    };
    await observeHealth();
    const drainControlEvidence = () => {
      if (controlEvidenceInFlight !== undefined) return;
      controlEvidenceInFlight = controlEvidencePipeline
        .drain(50)
        .then(() => undefined)
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ event: 'node_control.evidence_projection_failed', errorCode: safeErrorCode(error, 'NODE_CONTROL_EVIDENCE_PROJECTION_FAILED') })}\n`,
          );
        })
        .finally(() => {
          controlEvidenceInFlight = undefined;
        });
    };
    const drainTelemetryEvidence = () => {
      if (telemetryEvidenceInFlight !== undefined) return;
      telemetryEvidenceInFlight = telemetryEvidencePipeline
        .drain(50)
        .then(() => undefined)
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ event: 'node_control.telemetry_evidence_projection_failed', errorCode: safeErrorCode(error, 'NODE_CONTROL_TELEMETRY_EVIDENCE_PROJECTION_FAILED') })}\n`,
          );
        })
        .finally(() => {
          telemetryEvidenceInFlight = undefined;
        });
    };
    const observeCurrentHealth = () => {
      if (healthObservationInFlight !== undefined) return;
      healthObservationInFlight = observeHealth()
        .catch((error: unknown) => {
          process.stderr.write(
            `${JSON.stringify({ event: 'node_control.health_observation_failed', errorCode: safeErrorCode(error, 'NODE_HEALTH_OBSERVATION_FAILED') })}\n`,
          );
        })
        .finally(() => {
          healthObservationInFlight = undefined;
        });
    };
    controlEvidenceTimer = setInterval(() => {
      drainControlEvidence();
      drainTelemetryEvidence();
    }, 1_000);
    controlEvidenceTimer.unref();
    healthObservationTimer = setInterval(observeCurrentHealth, 30_000);
    healthObservationTimer.unref();
    drainControlEvidence();
    drainTelemetryEvidence();
    const app = createNodeControlHttpApp(service, configurationService, {
      bearerToken: environment.SDAR_CONTROL_API_TOKEN,
      ...(environment.SDAR_CONTROL_OPERATOR_API_TOKEN === undefined
        ? {}
        : { operatorBearerToken: environment.SDAR_CONTROL_OPERATOR_API_TOKEN }),
      ...(environment.SDAR_CONTROL_VIEWER_API_TOKEN === undefined
        ? {}
        : { viewerBearerToken: environment.SDAR_CONTROL_VIEWER_API_TOKEN }),
      ...(environment.SDAR_CONTROL_SECURITY_API_TOKEN === undefined
        ? {}
        : { securityBearerToken: environment.SDAR_CONTROL_SECURITY_API_TOKEN }),
      ...(environment.SDAR_CONTROL_ORGANIZATION_API_TOKEN === undefined
        ? {}
        : { organizationBearerToken: environment.SDAR_CONTROL_ORGANIZATION_API_TOKEN }),
      ...(environment.SDAR_CONTROL_ORGANIZATION_TENANT_ID === undefined
        ? {}
        : { organizationTenantId: environment.SDAR_CONTROL_ORGANIZATION_TENANT_ID }),
      rateLimitPerMinute: environment.SDAR_CONTROL_RATE_LIMIT_PER_MINUTE ?? 1_200,
      requestBodyLimitKb: environment.SDAR_CONTROL_REQUEST_BODY_LIMIT_KB ?? 64,
      providerEndpointAllowlist: splitAllowlist(
        environment.SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST ?? '127.0.0.1,localhost',
      ),
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
      taskSummaries: new PostgresRuntimeTaskSummaryQuery(runtimePool),
      runtimeGovernance,
      evidenceExport,
      evidenceOperations,
      nodeEvents,
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
        if (controlEvidenceTimer !== undefined) clearInterval(controlEvidenceTimer);
        if (healthObservationTimer !== undefined) clearInterval(healthObservationTimer);
        await Promise.allSettled(
          [controlEvidenceInFlight, telemetryEvidenceInFlight, healthObservationInFlight].filter(
            (item): item is Promise<void> => item !== undefined,
          ),
        );
        await closeServer(server);
        await pool.end();
        await runtimePool.end();
      },
    };
  } catch (error) {
    clearInterval(readinessTimer);
    if (controlEvidenceTimer !== undefined) clearInterval(controlEvidenceTimer);
    if (healthObservationTimer !== undefined) clearInterval(healthObservationTimer);
    await Promise.allSettled(
      [controlEvidenceInFlight, telemetryEvidenceInFlight, healthObservationInFlight].filter(
        (item): item is Promise<void> => item !== undefined,
      ),
    );
    await pool.end().catch(() => undefined);
    await runtimePool.end().catch(() => undefined);
    throw error;
  }
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)
  ) {
    return error.code;
  }
  return fallback;
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
    server.closeAllConnections();
  });
}

function normalizeHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function splitAllowlist(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ''),
  );
}
