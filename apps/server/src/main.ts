import process from 'node:process';

import { ConfiguredOperatorIdentityPort } from '../../../packages/application/src/index.js';
import { HttpNodeControlCapabilityEvidenceReader } from '../../../packages/runtime-control-http-client/src/index.js';
import { ConfiguredBearerArtifactManagementIdentity } from './artifact-management-identity.js';
import { loadServerEnvironment } from './environment.js';
import { homeLabReadOnlyTaskUnderstandingConfiguration } from './home-lab-task-understanding.js';
import { managedCapabilityTaskUnderstandingConfiguration } from './managed-capability-task-understanding.js';
import { modelRuntimeBootstrapConfiguration } from './model-runtime-bootstrap-configuration.js';
import { startServerRuntime } from './runtime.js';

const environment = loadServerEnvironment();
const modelBootstrap = await modelRuntimeBootstrapConfiguration(environment);
const artifactManagementIdentity = createArtifactManagementIdentity();
const runtimeControlArtifactIdentity = createArtifactManagementIdentity(
  environment.SDAR_RUNTIME_CONTROL_SERVICE_TOKEN,
);
const nodeControlAuthorityReader =
  environment.SDAR_NODE_CONTROL_BASE_URL === undefined ||
  environment.SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN === undefined
    ? undefined
    : new HttpNodeControlCapabilityEvidenceReader({
        baseUrl: environment.SDAR_NODE_CONTROL_BASE_URL,
        serviceToken: environment.SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN,
        unsafeTestOpen: environment.SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY === 'unsafe_test_open',
      });
const runtime = await startServerRuntime({
  postgresUrl: environment.SDAR_POSTGRES_URL,
  redis: { host: environment.SDAR_REDIS_HOST, port: environment.SDAR_REDIS_PORT },
  masterKeyBase64: environment.SDAR_MASTER_KEY_BASE64,
  applyMigrations: true,
  ...(modelBootstrap === undefined ? {} : { modelBootstrap }),
  outboundEndpointPolicy: {
    unsafeTestOpen: environment.SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY === 'unsafe_test_open',
    mcpAllowedAuthorities: splitAllowlist(environment.SDAR_CONTROL_MCP_ENDPOINT_ALLOWLIST),
    providerAllowedAuthorities: splitAllowlist(
      environment.SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST,
    ),
  },
  ...(nodeControlAuthorityReader === undefined
    ? {}
    : {
        capabilityAuthorityReader: nodeControlAuthorityReader,
        currentMcpProviderBindingAuthorityReader: nodeControlAuthorityReader,
      }),
  a2aHost: environment.SDAR_A2A_HOST,
  a2aPort: environment.SDAR_A2A_PORT,
  managementHost: environment.SDAR_MANAGEMENT_HOST,
  managementPort: environment.SDAR_MANAGEMENT_PORT,
  ...(environment.SDAR_RUNTIME_CONTROL_SERVICE_TOKEN === undefined
    ? {}
    : {
        runtimeControlServiceToken: environment.SDAR_RUNTIME_CONTROL_SERVICE_TOKEN,
        ...(runtimeControlArtifactIdentity === undefined
          ? {}
          : {
              runtimeControlArtifactPrincipalResolver:
                runtimeControlArtifactIdentity.managementPrincipalResolver,
            }),
      }),
  ...(environment.SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN === undefined
    ? {}
    : { cognitiveManagementBearerToken: environment.SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN }),
  ...(artifactManagementIdentity === undefined
    ? {}
    : {
        artifactOperatorIdentity: new ConfiguredOperatorIdentityPort({
          environment: 'production',
          provider: artifactManagementIdentity.externalOperatorIdentityProvider,
        }),
        artifactManagementPrincipalResolver: artifactManagementIdentity.managementPrincipalResolver,
      }),
  ...(environment.BUSINESS_EVENTS_ENABLED === 'true' ||
  environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'managed_capability'
    ? {
        frozenMcpTasks: { isolationAcknowledged: true as const },
        ...(environment.BUSINESS_EVENTS_ENABLED !== 'true'
          ? {}
          : {
              businessEvents: {
                enabled: true as const,
                requiredForRuntimeReady:
                  environment.BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY === 'true',
                processingIntervalMs: environment.BUSINESS_EVENTS_POLL_INTERVAL_MS,
                maxSubscriptions: environment.BUSINESS_EVENTS_MAX_SUBSCRIPTIONS,
              },
            }),
      }
    : {}),
  ...(environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'home_lab_read_only'
    ? { taskUnderstanding: homeLabReadOnlyTaskUnderstandingConfiguration() }
    : environment.SDAR_TASK_UNDERSTANDING_PROFILE === 'managed_capability'
      ? {
          taskUnderstanding: {
            ...managedCapabilityTaskUnderstandingConfiguration(),
            modelTimeoutMs: environment.SDAR_UGV_MODEL_TIMEOUT_MS,
          },
        }
      : {}),
});

process.stdout.write(
  `${JSON.stringify({ event: 'server.ready', a2aUrl: runtime.a2a.baseUrl, managementUrl: runtime.management.baseUrl })}\n`,
);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await runtime.close();
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

function createArtifactManagementIdentity(
  tokenOverride?: string,
): ConfiguredBearerArtifactManagementIdentity | undefined {
  const token = tokenOverride ?? environment.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN;
  if (token === undefined) return undefined;
  const actorId = environment.SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID;
  const roles = environment.SDAR_ARTIFACT_MANAGEMENT_ROLES;
  if (actorId === undefined || roles === undefined) {
    throw new Error('ARTIFACT_MANAGEMENT_IDENTITY_CONFIG_INVALID');
  }
  return new ConfiguredBearerArtifactManagementIdentity({
    token,
    actorId,
    ...(environment.SDAR_ARTIFACT_MANAGEMENT_TENANT_ID === undefined
      ? {}
      : { tenantId: environment.SDAR_ARTIFACT_MANAGEMENT_TENANT_ID }),
    kind: environment.SDAR_ARTIFACT_MANAGEMENT_KIND,
    roles,
  });
}

function splitAllowlist(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== ''),
  );
}
