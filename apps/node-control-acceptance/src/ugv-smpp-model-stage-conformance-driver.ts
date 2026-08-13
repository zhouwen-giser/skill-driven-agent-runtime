import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';
import { z } from 'zod';

import { ModelRuntimeService } from '../../../packages/application/src/index.js';
import { Aes256GcmSecretCipher } from '../../../packages/crypto-adapter/src/index.js';
import type {
  ModelProviderConfiguration,
  ModelStage,
  StageModelRoute,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { CompositeModelTransportAdapter } from '../../../packages/model-provider-adapter/src/index.js';
import { PostgresModelRuntimeRepository } from '../../../packages/persistence-postgres/src/index.js';
import { assertSafeRedactedJson, writeRedactedUgvReport } from './ugv-smpp-read-only-authority.js';
import {
  UGV_EMBEDDING_MODEL_STAGES,
  UGV_STRUCTURED_MODEL_STAGES,
  UgvModelStageConformanceSchema,
  type UgvModelStageConformanceReport,
} from './ugv-smpp-model-stage-conformance-contract.js';

type ModelApiStyle = 'openai_chat_completions' | 'anthropic_messages';

export interface UgvModelStageConformanceConfiguration {
  readonly structuredProviderId: string;
  readonly structuredModel: string;
  readonly structuredApiStyle: ModelApiStyle;
  readonly embeddingProviderId: string;
  readonly embeddingModel: string;
  readonly runId: string;
}

interface UgvModelStageConformanceDependencies {
  readonly models: Pick<
    ModelRuntimeService,
    'embed' | 'generateStructured' | 'listProviders' | 'listStageRoutes'
  >;
  readonly now?: () => string;
  readonly schemas?: AjvJsonSchemaValidator;
}

const ConfigurationSchema: z.ZodType<UgvModelStageConformanceConfiguration> = z
  .object({
    structuredProviderId: z.string().min(1),
    structuredModel: z.string().min(1),
    structuredApiStyle: z.enum(['openai_chat_completions', 'anthropic_messages']),
    embeddingProviderId: z.string().min(1),
    embeddingModel: z.string().min(1),
    runId: z.string().min(8).max(128),
  })
  .strict();

const REJECTED_WORKFLOW_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    stage: { const: 'workflow_planning' },
    evidence: { const: 'requires_application_correction' },
    summary: { type: 'string', minLength: 1 },
  },
  required: ['stage', 'evidence', 'summary'],
});

export class UgvModelStageConformanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvModelStageConformanceError';
    this.code = code;
  }
}

export async function executeUgvModelStageConformance(
  input: UgvModelStageConformanceConfiguration,
  dependencies: UgvModelStageConformanceDependencies,
): Promise<UgvModelStageConformanceReport> {
  const configuration = ConfigurationSchema.parse(input);
  const schemas = dependencies.schemas ?? new AjvJsonSchemaValidator({ strict: false });
  const observedAt = parseTimestamp(dependencies.now?.() ?? new Date().toISOString());
  const [providers, routes] = await Promise.all([
    dependencies.models.listProviders(),
    dependencies.models.listStageRoutes(),
  ]);
  const structuredProvider = exactProvider(
    providers,
    configuration.structuredProviderId,
    configuration.structuredModel,
    configuration.structuredApiStyle,
  );
  const embeddingProvider = exactProvider(
    providers,
    configuration.embeddingProviderId,
    configuration.embeddingModel,
  );
  assertRoutes(
    routes,
    UGV_STRUCTURED_MODEL_STAGES,
    'structured_generation',
    structuredProvider.providerId,
  );
  assertRoutes(routes, UGV_EMBEDDING_MODEL_STAGES, 'embedding', embeddingProvider.providerId);

  const stages = [];
  let correctionExercised = false;
  for (const stage of UGV_STRUCTURED_MODEL_STAGES) {
    if (stage === 'workflow_planning') {
      await exerciseWorkflowPlanningCorrection(dependencies.models, schemas, configuration.runId);
      correctionExercised = true;
    } else {
      await invokeAndValidateStage(dependencies.models, schemas, stage, configuration.runId);
    }
    stages.push(
      Object.freeze({
        stage,
        status: 'passed' as const,
        structuredOutputValidated: true as const,
        boundedTimeout: true as const,
        promptPublished: true as const,
      }),
    );
  }
  if (!correctionExercised)
    fail(
      'UGV_MODEL_CORRECTION_PATH_NOT_EXERCISED',
      'Workflow-planning correction path was not exercised.',
    );

  const embeddingStages = [];
  for (const stage of UGV_EMBEDDING_MODEL_STAGES) {
    const result = await dependencies.models.embed(
      stage,
      `UGV real-model embedding conformance for ${stage}; run ${configuration.runId}.`,
      { conformanceRunId: configuration.runId, evidenceClass: 'real_model_provider' },
    );
    if (
      result.providerId !== embeddingProvider.providerId ||
      result.vector.length === 0 ||
      result.vector.some((value) => !Number.isFinite(value))
    )
      fail(
        'UGV_MODEL_EMBEDDING_INVALID',
        'Embedding result does not prove the configured finite-vector authority.',
      );
    embeddingStages.push(
      Object.freeze({
        stage,
        status: 'passed' as const,
        finiteVectorValidated: true as const,
        dimensions: result.vector.length,
        boundedTimeout: true as const,
      }),
    );
  }

  const report = UgvModelStageConformanceSchema.parse({
    schemaVersion: 'sdar.ugv-smpp-model-stage-conformance/v1',
    status: 'passed',
    evidenceClass: 'real_model_provider',
    observedAt,
    provider: providerEvidence(structuredProvider),
    embeddingPrerequisite: {
      status: 'passed',
      provider: providerEvidence(embeddingProvider),
      stages: embeddingStages,
    },
    correctionPath: {
      exercised: true,
      invalidFirstResponseRejected: true,
      rejectionKind: 'application_schema_validation',
      correctedStructuredResponseValidated: true,
    },
    stages,
  });
  assertSafeRedactedJson(report);
  return Object.freeze(report);
}

async function invokeAndValidateStage(
  models: UgvModelStageConformanceDependencies['models'],
  schemas: AjvJsonSchemaValidator,
  stage: (typeof UGV_STRUCTURED_MODEL_STAGES)[number],
  runId: string,
): Promise<void> {
  const responseSchema = acceptedStageSchema(stage);
  const result = await models.generateStructured({
    stage,
    instruction: `Return a concise real-provider conformance object for stage ${stage} and run ${runId}.`,
    responseSchema,
    correctionErrors: [],
    context: { conformanceRunId: runId, evidenceClass: 'real_model_provider' },
  });
  if (!schemas.validate(responseSchema, result).valid)
    fail(
      'UGV_MODEL_STRUCTURED_OUTPUT_INVALID',
      `Application validation rejected the corrected output for stage ${stage}.`,
    );
}

async function exerciseWorkflowPlanningCorrection(
  models: UgvModelStageConformanceDependencies['models'],
  schemas: AjvJsonSchemaValidator,
  runId: string,
): Promise<void> {
  const stage = 'workflow_planning' as const;
  const applicationSchema = acceptedStageSchema(stage);
  const invalid = await models.generateStructured({
    stage,
    instruction:
      'Produce the first conformance candidate with stage="workflow_planning", evidence="requires_application_correction", and a non-empty summary.',
    responseSchema: REJECTED_WORKFLOW_RESPONSE_SCHEMA,
    correctionErrors: [],
    context: { conformanceRunId: runId, correctionRound: 1 },
  });
  const firstValidation = schemas.validate(applicationSchema, invalid);
  if (firstValidation.valid || firstValidation.errors.length === 0)
    fail(
      'UGV_MODEL_INVALID_FIRST_RESPONSE_NOT_REJECTED',
      'The first workflow-planning candidate did not exercise application-schema rejection.',
    );
  const corrected = await models.generateStructured({
    stage,
    instruction:
      'Correct the rejected workflow-planning candidate and return the accepted real-provider conformance object.',
    responseSchema: applicationSchema,
    correctionErrors: firstValidation.errors,
    context: { conformanceRunId: runId, correctionRound: 2 },
  });
  if (!schemas.validate(applicationSchema, corrected).valid)
    fail(
      'UGV_MODEL_CORRECTED_RESPONSE_INVALID',
      'Application validation rejected the corrected workflow-planning response.',
    );
}

function acceptedStageSchema(stage: ModelStage) {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      stage: { const: stage },
      evidence: { const: 'real_model_provider' },
      summary: { type: 'string', minLength: 1 },
    },
    required: ['stage', 'evidence', 'summary'],
  });
}

function exactProvider(
  providers: readonly ModelProviderConfiguration[],
  providerId: string,
  model: string,
  apiStyle?: ModelApiStyle,
): ModelProviderConfiguration {
  const matches = providers.filter((provider) => provider.providerId === providerId);
  const provider = matches[0];
  if (
    matches.length !== 1 ||
    provider?.enabled !== true ||
    provider.model !== model ||
    (apiStyle !== undefined && provider.apiStyle !== apiStyle) ||
    /home[.-]?lab|fixture|mock/iu.test(`${provider.providerId} ${provider.model}`)
  )
    fail(
      'UGV_MODEL_PROVIDER_AUTHORITY_INVALID',
      'The exact enabled non-fixture Model Provider is unavailable.',
    );
  return provider;
}

function assertRoutes(
  routes: readonly StageModelRoute[],
  stages: readonly ModelStage[],
  operation: StageModelRoute['operation'],
  providerId: string,
): void {
  for (const stage of stages)
    if (
      routes.filter(
        (route) =>
          route.stage === stage && route.operation === operation && route.providerId === providerId,
      ).length !== 1
    )
      fail(
        'UGV_MODEL_ROUTE_INCOMPLETE',
        `Model operation route is missing for ${stage}/${operation}.`,
      );
}

function providerEvidence(provider: ModelProviderConfiguration) {
  return Object.freeze({
    providerId: provider.providerId,
    model: provider.model,
    apiStyle: provider.apiStyle,
    connectivity: 'passed' as const,
    credentialsRedacted: true as const,
  });
}

function parseTimestamp(value: string): string {
  return z.iso.datetime({ offset: true }).parse(value);
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    fail('UGV_MODEL_CONFORMANCE_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

function optionalEnvironment(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value === '' ? undefined : value;
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail(
      'UGV_MODEL_CONFORMANCE_CONFIGURATION_INVALID',
      `Set exactly one of ${name} or ${name}_FILE.`,
    );
  const value = (inline ?? (file === undefined ? '' : await readFile(file, 'utf8'))).trim();
  if (value === '') fail('UGV_MODEL_CONFORMANCE_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

export async function runUgvModelStageConformanceFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const reportFile =
    environment['SDAR_UGV_MODEL_CONFORMANCE_REPORT_FILE'] ??
    'reports/sdar-ugv-smpp-integration/model-stage-conformance.json';
  const pool = new Pool({
    connectionString: requiredEnvironment(environment, 'SDAR_POSTGRES_URL'),
  });
  try {
    const masterKey = await secretFromEnvironment(environment, 'SDAR_MASTER_KEY_BASE64');
    const structuredProviderId = requiredEnvironment(environment, 'SDAR_UGV_MODEL_PROVIDER_ID');
    const models = new ModelRuntimeService({
      repository: new PostgresModelRuntimeRepository(pool),
      transport: new CompositeModelTransportAdapter({
        allowedAuthorities: (environment['SDAR_CONTROL_PROVIDER_ENDPOINT_ALLOWLIST'] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== ''),
        unsafeTestOpen: environment['SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY'] === 'unsafe_test_open',
      }),
      cipher: new Aes256GcmSecretCipher(masterKey),
      clock: { now: () => new Date().toISOString() },
      ids: { nextInvocationId: () => `model-conformance-${randomUUID()}` },
    });
    const report = await executeUgvModelStageConformance(
      {
        structuredProviderId,
        structuredModel: requiredEnvironment(environment, 'SDAR_UGV_MODEL_NAME'),
        structuredApiStyle: z
          .enum(['openai_chat_completions', 'anthropic_messages'])
          .parse(requiredEnvironment(environment, 'SDAR_UGV_MODEL_API_STYLE')),
        embeddingProviderId:
          optionalEnvironment(environment, 'SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID') ??
          `${structuredProviderId}-embedding`,
        embeddingModel: requiredEnvironment(environment, 'SDAR_UGV_MODEL_EMBEDDING_NAME'),
        runId: requiredEnvironment(environment, 'SDAR_UGV_MODEL_CONFORMANCE_RUN_ID'),
      },
      { models },
    );
    await writeRedactedUgvReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const code =
      error instanceof UgvModelStageConformanceError
        ? error.code
        : 'UGV_MODEL_STAGE_CONFORMANCE_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function fail(code: string, message: string): never {
  throw new UgvModelStageConformanceError(code, message);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  await runUgvModelStageConformanceFromEnvironment();
