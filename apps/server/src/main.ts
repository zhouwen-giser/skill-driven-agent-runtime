import process from 'node:process';

import { ConfiguredOperatorIdentityPort } from '../../../packages/application/src/index.js';
import { ConfiguredBearerArtifactManagementIdentity } from './artifact-management-identity.js';
import { loadServerEnvironment } from './environment.js';
import { startServerRuntime } from './runtime.js';

const environment = loadServerEnvironment();
const artifactManagementIdentity = createArtifactManagementIdentity();
const runtime = await startServerRuntime({
  postgresUrl: environment.SDAR_POSTGRES_URL,
  redis: { host: environment.SDAR_REDIS_HOST, port: environment.SDAR_REDIS_PORT },
  masterKeyBase64: environment.SDAR_MASTER_KEY_BASE64,
  applyMigrations: true,
  a2aHost: environment.SDAR_A2A_HOST,
  a2aPort: environment.SDAR_A2A_PORT,
  managementHost: environment.SDAR_MANAGEMENT_HOST,
  managementPort: environment.SDAR_MANAGEMENT_PORT,
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
  ...(environment.BUSINESS_EVENTS_ENABLED === 'true'
    ? {
        frozenMcpTasks: { isolationAcknowledged: true as const },
        businessEvents: {
          enabled: true as const,
          requiredForRuntimeReady:
            environment.BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY === 'true',
          processingIntervalMs: environment.BUSINESS_EVENTS_POLL_INTERVAL_MS,
          maxSubscriptions: environment.BUSINESS_EVENTS_MAX_SUBSCRIPTIONS,
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

function createArtifactManagementIdentity():
  ConfiguredBearerArtifactManagementIdentity | undefined {
  const token = environment.SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN;
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
