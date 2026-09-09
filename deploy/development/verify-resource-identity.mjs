import console from 'node:console';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  PostgresSkillRepository,
  PostgresMcpRegistryRepository,
  PostgresExactSkillPackageAuthorityReader,
} from '../../dist/packages/persistence-postgres/src/index.js';
import { McpRuntimeBindingAuthorityVerifier } from '../../dist/packages/application/src/index.js';
import { HttpNodeControlCapabilityEvidenceReader } from '../../dist/packages/runtime-control-http-client/src/index.js';
import { AjvJsonSchemaValidator } from '../../dist/packages/json-schema-adapter/src/index.js';
import { UgvMoveTaskBindingResolver } from '../../dist/apps/server/src/ugv-move-binding.js';
import {
  adaptUgvMoveInput,
  ugvResourceIdFromSchema,
} from '../../dist/apps/server/src/ugv-move-input-adapter.js';
import { UgvNaturalLanguageCapabilityAdmissionResolver } from '../../dist/apps/server/src/ugv-natural-language-capability-admission.js';

// Read-only deployment verification. No runtime startup, availability request or Device Tool call.
const c = JSON.parse(await readFile('/run/sdar/environment.json', 'utf8'));
const pool = new pg.Pool({
  connectionString:
    c.SDAR_STORAGE_MODE === 'gowm-shared' ? c.GOWM_DATABASE_URL : c.SDAR_POSTGRES_URL,
  options: `${c.SDAR_STORAGE_MODE === 'gowm-shared' ? '-c search_path=ugv_sdar,public,pg_catalog ' : ''}-c default_transaction_read_only=on`,
});
let phase = 'public-card';
try {
  const response = await globalThis.fetch('http://127.0.0.1:10999/.well-known/agent-card.json', {
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('PUBLIC_CARD_UNAVAILABLE');
  const card = await response.json();
  const entries = card.capabilities?.extensions?.find(
    (extension) => extension.uri === 'io.sdar/capabilityExposureCatalog',
  )?.params?.entries;
  const moves = entries?.filter((item) => item.capabilityId === 'embodied.move');
  if (moves?.length !== 1) throw new Error('PUBLIC_MOVE_EXPOSURE_AMBIGUOUS');
  const move = moves[0];
  const resourceId = ugvResourceIdFromSchema(move.requestSchema);
  if (resourceId !== c.SDAR_UGV_RESOURCE_ID)
    throw new Error('DEPLOYMENT_RESOURCE_IDENTITY_CONFLICT');
  phase = 'provider-binding';
  const clock = { now: () => new Date().toISOString() };
  const repository = new PostgresMcpRegistryRepository(pool);
  const resolver = new UgvMoveTaskBindingResolver({
    skills: new PostgresSkillRepository(pool),
    packages: new PostgresExactSkillPackageAuthorityReader(pool),
    operations: repository,
    availability: {
      checkTaskAvailability() {
        throw new Error('SELF_CHECK_DEVICE_CALL_FORBIDDEN');
      },
    },
    providerBindings: new HttpNodeControlCapabilityEvidenceReader({
      baseUrl: 'http://control-api:10091',
      serviceToken: c.SDAR_CONTROL_VIEWER_API_TOKEN,
      bindingServiceToken: c.SDAR_CONTROL_RUNTIME_SERVICE_TOKEN,
      unsafeTestOpen: true,
    }),
    runtimeBindings: new McpRuntimeBindingAuthorityVerifier({ repository, clock }),
    schemas: new AjvJsonSchemaValidator(),
    clock,
  });
  const authority = await resolver.resolveQualificationAuthority();
  if (
    authority.resourceId !== resourceId ||
    authority.providerId !== c.SDAR_UGV_EXTERNAL_PROVIDER_ID
  )
    throw new Error('PROVIDER_RESOURCE_IDENTITY_CONFLICT');
  phase = 'input-adaptation';
  const input = { resourceId, target: { x: 0, y: 0, frame: 'WGS84' } };
  const adapted = adaptUgvMoveInput(input, authority.resourceId);
  const bridge = new UgvNaturalLanguageCapabilityAdmissionResolver({
    exposures: { findCurrent: async () => move },
  });
  const candidate = await bridge.resolve({
    messageText: 'Move the UGV to longitude 0, latitude 0.',
    userId: 'deployment-read-only-check',
    clientRequestId: 'deployment-resource-identity-check',
    receivedAt: clock.now(),
  });
  if (
    candidate?.capabilityInput?.resourceId !== resourceId ||
    adapted.providerArguments.resourceId !== resourceId
  )
    throw new Error('ADAPTER_RESOURCE_IDENTITY_CONFLICT');
  console.log(
    JSON.stringify({
      status: 'PASS',
      resourceId,
      providerId: authority.providerId,
      serverId: authority.serverId,
      providerBindingId: authority.providerBindingId,
      exposureId: move.exposureId,
      exposureVersion: move.exposureVersion,
      capabilityVersion: move.capabilityVersion,
      deviceCalls: 0,
      persistedTasks: 0,
    }),
  );
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : error?.message;
  console.log(
    JSON.stringify({
      status: 'FAILED',
      phase,
      reasonCode:
        typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(code)
          ? code
          : 'RESOURCE_IDENTITY_VERIFICATION_FAILED',
      deviceCalls: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
