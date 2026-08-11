import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ARTIFACT_FEATURE_FLAG_NAMES,
  ARTIFACT_OPERATIONAL_FLAG_NAMES,
  ConfiguredOperatorIdentityPort,
  hashValidationSummary,
  type ArtifactRetrievalResult,
} from '../../../packages/application/src/index.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../../packages/domain/src/index.js';
import {
  PostgresArtifactRepository,
  PostgresArtifactValidationRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../test-support/postgres.js';
import { ConfiguredBearerArtifactManagementIdentity } from '../src/artifact-management-identity.js';
import {
  startServerRuntime,
  type ServerRuntimeHandle,
  type ServerRuntimeOptions,
} from '../src/runtime.js';

const postgresAdminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseName = 'sdar_v13_p13_operational_flags_e2e';
const postgresUrl = isolatedDatabaseUrl(postgresAdminUrl, databaseName);
const bearerToken = 'p13-artifact-management-bearer-token-0001';
const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-30T06:00:00.000Z';
const artifactFlagNames = [
  ...ARTIFACT_FEATURE_FLAG_NAMES,
  ...ARTIFACT_OPERATIONAL_FLAG_NAMES,
] as const;
const previousEnvironment = new Map<string, string | undefined>();
let runtime: ServerRuntimeHandle | undefined;
let artifactFixture: Readonly<{
  artifacts: readonly CompiledArtifact[];
  lineage: ArtifactLineage;
  runtimeBinding: ArtifactRuntimeBinding;
}>;

beforeAll(async () => {
  for (const name of artifactFlagNames) {
    previousEnvironment.set(name, process.env[name]);
    Reflect.deleteProperty(process.env, name);
  }
  artifactFixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as typeof artifactFixture;
  await createIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
});

afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
  for (const name of artifactFlagNames) Reflect.deleteProperty(process.env, name);
});

afterAll(async () => {
  await dropIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

describe('P13 Artifact operational flag composition', () => {
  it('rejects malformed operational flags before opening runtime infrastructure', async () => {
    process.env['SDAR_V13_COMPILER_ENABLED'] = '1';

    await expect(startServerRuntime(runtimeOptions())).rejects.toMatchObject({
      code: 'ARTIFACT_FEATURE_FLAG_INVALID',
    });
  });

  it('starts every additive Artifact path off by default', async () => {
    runtime = await startServerRuntime(runtimeOptions());

    expect(runtime.artifactRegistry).toBeUndefined();
    expect(runtime.fastGateway).toBeUndefined();
    await expect(runtime.enrollArtifactShadow(shadowEnrollment())).resolves.toBeUndefined();

    const promotion = await fetch(
      `${runtime.management.baseUrl}/api/v1/artifacts/promotion/approvals`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    );
    expect(promotion.status).toBe(422);
    await expect(promotion.json()).resolves.toMatchObject({
      error: { code: 'ARTIFACT_PROMOTION_UNAVAILABLE' },
    });
  });

  it('enables the registry independently while retrieval remains off', async () => {
    process.env['SDAR_V13_REGISTRY_ENABLED'] = 'true';
    process.env['SDAR_V13_ARTIFACT_MODE'] = 'active';
    process.env['SDAR_V13_FAST_GATEWAY_ENABLED'] = 'true';

    runtime = await startServerRuntime(runtimeOptions());

    expect(runtime.artifactRegistry).toBeDefined();
    expect(runtime.fastGateway).toBeUndefined();
  });

  it('requires the retrieval and gateway switches together for the compiled gateway', async () => {
    process.env['SDAR_V13_ARTIFACT_MODE'] = 'active';
    process.env['SDAR_V13_RETRIEVAL_ENABLED'] = 'true';
    process.env['SDAR_V13_FAST_GATEWAY_ENABLED'] = 'true';

    runtime = await startServerRuntime(runtimeOptions());

    expect(runtime.artifactRegistry).toBeUndefined();
    expect(runtime.fastGateway).toBeDefined();
  });

  it('gates bearer-backed approval and activation while preserving the explicitly enabled path', async () => {
    const pool = new Pool({ connectionString: postgresUrl });
    try {
      await seedArtifact(pool);
      runtime = await startServerRuntime(bearerRuntimeOptions());

      const disabled = await artifactCommand('approve', {
        approvalId: 'approval-p13-disabled',
        validationSummaryHash: HASH,
        idempotencyKey: 'approval-p13-disabled',
      });
      expect(disabled.status).toBe(503);
      await expect(disabled.json()).resolves.toMatchObject({
        error: { code: 'ARTIFACT_OPERATION_DISABLED' },
      });
      await expect(
        pool.query(`SELECT count(*)::integer AS count FROM artifact_approval`),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      for (const validationType of ['shadow', 'revalidation'] as const) {
        const disabledAlias = await artifactCommand('validate', {
          validationRunId: `validation-p13-disabled-${validationType}`,
          validationType,
          datasetRef: `dataset-p13-disabled-${validationType}`,
          idempotencyKey: `validation-p13-disabled-${validationType}`,
        });
        expect(disabledAlias.status).toBe(503);
        await expect(disabledAlias.json()).resolves.toMatchObject({
          error: { code: 'ARTIFACT_OPERATION_DISABLED' },
        });
      }
      await expect(
        pool.query(
          `SELECT
             (SELECT count(*)::integer FROM artifact_validation_run) AS validations,
             (SELECT count(*)::integer
                FROM cognitive_runtime_outbox
                WHERE event_type='artifact.validation_started') AS validation_events`,
        ),
      ).resolves.toMatchObject({
        rows: [{ validations: 0, validation_events: 0 }],
      });

      await runtime.close();
      runtime = undefined;
      process.env['SDAR_V13_PROMOTION_ENABLED'] = 'true';
      runtime = await startServerRuntime(bearerRuntimeOptions());

      const validation = await artifactCommand('validate', {
        validationRunId: 'validation-p13-enabled',
        validationType: 'static',
        datasetRef: 'dataset-p13-enabled',
        idempotencyKey: 'validation-p13-enabled',
      });
      expect(validation.status).toBe(202);

      const validationRepository = new PostgresArtifactValidationRepository(pool);
      await validationRepository.appendResult({
        validationRunId: 'validation-p13-enabled',
        status: 'passed',
        result: 'P13 promotion control enabled-path evidence.',
        metrics: { precision: 1 },
        counterexampleRefs: [],
        completedAt: NOW,
      });
      const summary = await validationRepository.findPromotionSummary({
        artifactId: 'artifact-p13-promotion',
        version: 1,
      });
      if (summary === undefined) throw new Error('P13_PROMOTION_VALIDATION_SUMMARY_MISSING');
      const validationSummaryHash = hashValidationSummary(summary);

      const approved = await artifactCommand('approve', {
        approvalId: 'approval-p13-enabled',
        validationSummaryHash,
        idempotencyKey: 'approval-p13-enabled',
      });
      expect(approved.status).toBe(202);
      const activated = await artifactCommand('activate', {
        artifactKey: 'key-artifact-p13-promotion',
        expectedLockVersion: 0,
        validationSummaryHash,
        idempotencyKey: 'activation-p13-enabled',
      });
      const activationBody = await activated.json();
      expect(activated.status, JSON.stringify(activationBody)).toBe(202);
      await expect(
        pool.query(
          `SELECT artifact_id,artifact_version
           FROM artifact_active_pointer
           WHERE artifact_key='key-artifact-p13-promotion'`,
        ),
      ).resolves.toMatchObject({
        rows: [{ artifact_id: 'artifact-p13-promotion', artifact_version: 1 }],
      });
    } finally {
      await pool.end();
    }
  }, 30_000);
});

function runtimeOptions(): ServerRuntimeOptions {
  return {
    postgresUrl,
    redis: {
      host: '127.0.0.1',
      port: Number(process.env['SDAR_REDIS_PORT'] ?? '56379'),
    },
    masterKeyBase64: randomBytes(32).toString('base64'),
    queueName: `p13-operational-flags-${randomUUID()}`,
    applyMigrations: true,
    a2aPort: 0,
    managementPort: 0,
    artifactOperatorIdentity: new ConfiguredOperatorIdentityPort({ environment: 'test' }),
    fastGateway: fastGatewayOptions(),
  };
}

function bearerRuntimeOptions(): ServerRuntimeOptions {
  const identity = new ConfiguredBearerArtifactManagementIdentity({
    token: bearerToken,
    actorId: 'p13-release-operator',
    tenantId: 'tenant-p13',
    kind: 'human',
    roles: ['approver', 'administrator'],
  });
  return {
    ...runtimeOptions(),
    artifactOperatorIdentity: new ConfiguredOperatorIdentityPort({
      environment: 'production',
      provider: identity.externalOperatorIdentityProvider,
    }),
    artifactManagementPrincipalResolver: identity.managementPrincipalResolver,
  };
}

function artifactCommand(
  operation: 'validate' | 'approve' | 'activate',
  fields: Readonly<Record<string, unknown>>,
): Promise<Response> {
  if (runtime === undefined) throw new Error('P13_OPERATIONAL_RUNTIME_MISSING');
  return fetch(
    `${runtime.management.baseUrl}/api/v1/artifacts/artifact-p13-promotion/commands/${operation}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        'content-type': 'application/json',
        'x-request-id': `p13-${operation}`,
      },
      body: JSON.stringify({
        version: 1,
        expectedVersion: 1,
        reason: 'P13 operational promotion control evidence.',
        ...fields,
      }),
    },
  );
}

async function seedArtifact(pool: Pool): Promise<void> {
  const source = artifactFixture.artifacts.find(
    (candidate) => candidate.artifactType === 'plan_template',
  );
  if (source === undefined) throw new Error('P13_PLAN_TEMPLATE_FIXTURE_MISSING');
  const { validationSummaryRef: priorValidationSummaryRef, ...candidateSource } =
    structuredClone(source);
  void priorValidationSummaryRef;
  const artifact: CompiledArtifact = {
    ...candidateSource,
    artifactId: 'artifact-p13-promotion',
    artifactKey: 'key-artifact-p13-promotion',
    scope: { ...source.scope, tenantId: 'tenant-p13', domain: 'test' },
    status: 'candidate',
    lineageRef: 'lineage-artifact-p13-promotion',
    contentHash: HASH,
    createdAt: NOW,
  };

  await new PostgresArtifactRepository(pool).saveCandidate({
    artifact,
    lineage: {
      ...structuredClone(artifactFixture.lineage),
      lineageId: artifact.lineageRef,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      validationRunRefs: [],
    },
    runtimeBinding: {
      ...structuredClone(artifactFixture.runtimeBinding),
      bindingId: 'binding-artifact-p13-promotion',
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      compiledAt: NOW,
    },
  });
}

function fastGatewayOptions(): NonNullable<ServerRuntimeOptions['fastGateway']> {
  return {
    contexts: {
      create: () => Promise.reject(new Error('P13_GATEWAY_CONTEXT_UNUSED')),
    },
    precheck: {
      authenticate: () => Promise.resolve(true),
      authorizeTenant: () => Promise.resolve(true),
      authorizeRequest: () => Promise.resolve(true),
      readRuntimeState: () =>
        Promise.resolve({
          featureEnabled: true,
          killSwitchActive: false,
          policyDecision: 'allow',
          runtimeSnapshotHash: `sha256:${'a'.repeat(64)}`,
        }),
    },
    retrieval: { retrieve: () => Promise.resolve(noMatch()) },
    rule: {
      evaluate: () => Promise.resolve({ disposition: 'fallback', resultRef: 'unused' }),
    },
    template: {
      instantiate: () => Promise.resolve({ disposition: 'fallback', resultRef: 'unused' }),
    },
    fallback: {
      start: (input) => Promise.resolve({ fallbackRef: `cognitive:${input.taskId}` }),
    },
    cancellation: { isCancelled: () => Promise.resolve(false) },
    drift: { signal: () => Promise.resolve() },
  };
}

function noMatch(): ArtifactRetrievalResult {
  return {
    index: [],
    matches: [],
    decision: {
      decisionId: 'p13-no-match',
      requestId: 'p13-no-match',
      path: 'cognitive_runtime',
      parameterBindings: {},
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: ['ARTIFACT_NO_MATCH', 'DECISION_FALLBACK'],
      matcherSnapshotHash: `sha256:${'b'.repeat(64)}`,
      policySnapshotHash: `sha256:${'c'.repeat(64)}`,
      createdAt: '2026-07-30T00:00:00.000Z',
    },
  };
}

function shadowEnrollment() {
  return {
    shadowRunId: 'p13-shadow-disabled',
    artifactId: 'artifact.p13.disabled',
    artifactVersion: 1,
    artifactRef: 'artifact.p13.disabled:1',
    artifactHash: `sha256:${'d'.repeat(64)}`,
    formalRequestRef: 'formal-request-p13-disabled',
    shadowMode: 'decision_only' as const,
    policySnapshotHash: `sha256:${'e'.repeat(64)}`,
    capabilityCatalogHash: `sha256:${'f'.repeat(64)}`,
    idempotencyKey: 'p13-shadow-disabled',
    expiresAt: '2026-07-30T00:05:00.000Z',
    createdAt: '2026-07-30T00:00:00.000Z',
  };
}
