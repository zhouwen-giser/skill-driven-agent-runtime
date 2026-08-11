import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SendMessageRequest, TaskState, type Task } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import { z } from 'zod';

import {
  HomeLabReadOnlyWorkflowContractError,
  assertHomeLabReadOnlyWorkflowContract,
} from '../../../packages/application/src/home-lab-read-only-workflow-contract.js';

import {
  a2aExposureEtag,
  createA2aExposureVersion,
  type A2aExposureVersion,
  type JsonObject,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';
import {
  HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES,
  HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY,
  HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
  HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  HOME_LAB_A2A_MODEL_STAGES,
} from './home-lab-a2a-model-contract.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const TERMINAL_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
const REQUIRED_MODEL_STAGES = HOME_LAB_A2A_MODEL_STAGES;

export const HOME_LAB_A2A_READ_ONLY_SCENARIO = Object.freeze({
  requestText: '查询客厅主灯和空调当前状态',
  exposureId: 'home-lab-a2a-living-room-read-state',
  capabilityId: 'home.living-room.read-state',
  capabilityImplementationBindingId: 'capability-binding-home.living-room.read-state-v1',
  agentSkillId: 'home-lab.living-room.read-state',
  skillId: 'home.living-room.get-state',
  taskTypeId: 'task-type.home-lab-living-room-read-state',
  taskType: 'living_room_read_state',
  operations: Object.freeze([
    Object.freeze({
      kind: 'light' as const,
      providerBindingId: 'mcp-binding-ha-light-lab',
      serverId: 'home-lab-light-mcp',
      toolName: 'light_get_state',
      inputField: 'mainLightResourceId',
      outputField: 'mainLight',
      resourceId: 'living-room-main-light',
      evidenceType: 'light.state.observation',
    }),
    Object.freeze({
      kind: 'climate' as const,
      providerBindingId: 'mcp-binding-ha-climate-lab',
      serverId: 'home-lab-climate-mcp',
      toolName: 'climate_get_state',
      inputField: 'climateResourceId',
      outputField: 'climate',
      resourceId: 'living-room-air-conditioner',
      evidenceType: 'climate.state.observation',
    }),
  ]),
});

export type HomeLabA2AReadOnlyScenario = typeof HOME_LAB_A2A_READ_ONLY_SCENARIO;
type HomeLabOperation = HomeLabA2AReadOnlyScenario['operations'][number];

function requiredOperation(scenario: HomeLabA2AReadOnlyScenario, index: number): HomeLabOperation {
  const operation = scenario.operations[index];
  if (operation === undefined)
    fail('A2A_SCENARIO_OPERATION_MISSING', 'The frozen exact-two operation is absent.');
  return operation;
}

export interface HomeLabA2AReadOnlyConfiguration {
  readonly mode: 'execute' | 'verify-restart';
  readonly a2aBaseUrl: string;
  readonly runtimeManagementBaseUrl: string;
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly runId: string;
  readonly checkpointFile?: string;
  readonly restartEvidenceId?: string;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly scenario?: HomeLabA2AReadOnlyScenario;
}

export interface HomeLabA2AReadOnlyTaskReport {
  readonly taskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly userGoalPlanId: string;
  readonly workflowPlanId: string;
  readonly terminalOutcomeId: string;
  readonly capabilityId: typeof HOME_LAB_A2A_READ_ONLY_SCENARIO.capabilityId;
  readonly capabilityVersion: 1;
  readonly exposureId: typeof HOME_LAB_A2A_READ_ONLY_SCENARIO.exposureId;
  readonly exposureVersion: 1;
  readonly skillId: typeof HOME_LAB_A2A_READ_ONLY_SCENARIO.skillId;
  readonly skillVersion: 1;
  readonly states: Readonly<{
    mainLight: Readonly<Record<string, unknown>>;
    climate: Readonly<Record<string, unknown>>;
  }>;
  readonly operations: readonly Readonly<{
    serverId: string;
    operationName: string;
    resourceId: string;
    evidenceType: string;
  }>[];
  readonly a2aTaskHash: string;
  readonly structuredOutcomeHash: string;
  readonly capabilityBindingHash: string;
  readonly eventCount: number;
  readonly modelStages: readonly string[];
  readonly evidenceQueries: readonly string[];
}

export interface HomeLabA2AReadOnlyReport {
  readonly schemaVersion: 'sdar.home-lab-a2a-read-only/v2';
  readonly status: 'passed';
  readonly mode: 'execute' | 'verify-restart';
  readonly observedAt: string;
  readonly a2aReadOnlyReady: true;
  readonly restartRecoveryVerified: boolean;
  readonly contextId: string;
  readonly task: HomeLabA2AReadOnlyTaskReport;
  readonly modelAuthority: Readonly<{
    requiredStages: readonly string[];
    configuredRouteStages: readonly string[];
    providerId: typeof HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID;
    model: typeof HOME_LAB_A2A_MODEL_FIXTURE_MODEL;
    configuredProviderCount: number;
    failedInvocationCount: 0;
    evidenceClass: 'real_a2a_runtime_mcp_ha_with_simulated_local_model_semantics';
    modelBoundary: typeof HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY;
  }>;
  readonly safety: Readonly<{
    allowedCapabilities: readonly [typeof HOME_LAB_A2A_READ_ONLY_SCENARIO.capabilityId];
    allowedOperations: readonly ['light_get_state', 'climate_get_state'];
    writeOperationsInvoked: 0;
    physicalWritesInvoked: 0;
    realDeviceWriteGateObserved: 'closed' | 'open_but_unused';
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    entityIdsIncluded: false;
  }>;
}

interface HomeLabA2ACheckpoint {
  readonly schemaVersion: 'sdar.home-lab-a2a-checkpoint/v2';
  readonly runId: string;
  readonly createdAt: string;
  readonly contextId: string;
  readonly task: Readonly<{
    taskId: string;
    contextId: string;
    goalId: string;
    goalVersion: number;
    userGoalPlanId: string;
    workflowPlanId: string;
    terminalOutcomeId: string;
    capabilityId: string;
    exposureId: string;
    skillId: string;
    a2aTaskHash: string;
    structuredOutcomeHash: string;
    capabilityBindingHash: string;
  }>;
}

type A2AClient = Pick<Client, 'sendMessage' | 'getTask'>;

interface DriverDependencies {
  readonly fetch?: typeof fetch;
  readonly createA2AClient?: (baseUrl: string) => Promise<A2AClient>;
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
}

export async function confirmCompositeReadOnlyPlanAfterZeroInvocationGate<T>(
  input: Readonly<{
    assertNoMcpInvocations(): Promise<void>;
    confirm(): Promise<T>;
  }>,
): Promise<T> {
  await input.assertNoMcpInvocations();
  return input.confirm();
}

const ProviderCollectionSchema = z.object({
  items: z.array(
    z
      .object({
        providerId: z.string().min(1),
        kind: z.string().min(1),
        apiStyle: z.string().min(1),
        baseUrl: z.url(),
        model: z.string().min(1),
        enabled: z.boolean(),
      })
      .loose(),
  ),
});
const RouteCollectionSchema = z.object({
  items: z.array(z.object({ stage: z.string().min(1), providerId: z.string().min(1) }).loose()),
});
const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    constraints: z.array(z.record(z.string(), z.unknown())).optional(),
    status: z.literal('published'),
    riskLevel: z.literal('low'),
    definitionHash: z.string().regex(CHECKSUM),
  })
  .loose();
const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    status: z.literal('available'),
    validUntil: z.iso.datetime(),
    availableImplementations: z.array(z.string()),
    unavailableImplementations: z.array(z.string()),
  })
  .loose();
const ToolReferenceSchema = z
  .object({ serverId: z.string().min(1), toolName: z.string().min(1) })
  .strict();
const SkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    status: z.literal('enabled'),
    capabilities: z.array(z.string()),
    toolPolicy: z
      .object({
        required: z.array(ToolReferenceSchema),
        optional: z.array(z.unknown()),
        forbidden: z.array(z.unknown()),
      })
      .loose(),
    runtimePolicy: z.record(z.string(), z.unknown()),
  })
  .loose();
const ProviderBindingSchema = z
  .object({
    bindingId: z.string().min(1),
    localServerId: z.string().min(1),
    status: z.literal('active'),
    availabilityStatus: z.literal('available'),
    availabilityValidUntil: z.iso.datetime(),
  })
  .loose();
const ExposureSchema = z
  .object({
    exposureId: z.string().min(1),
    version: z.number().int().positive(),
    capabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    agentSkillId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    requestSchema: z.record(z.string(), z.unknown()),
    resultSchema: z.record(z.string(), z.unknown()),
    visibility: z.literal('public'),
    status: z.enum(['draft', 'published', 'suspended', 'retired']),
    exposureHash: z.string().regex(CHECKSUM),
  })
  .loose();
const OperationSchema = z
  .object({ status: z.literal('succeeded'), errorCode: z.string().optional(), result: z.unknown() })
  .loose();
const RuntimeTaskSchema = z
  .object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    phase: z.string().min(1),
    goalId: z.string().min(1),
    goalVersion: z.number().int().positive(),
    planId: z.string().min(1),
    selectedSkillId: z.string().min(1),
    selectedSkillVersion: z.number().int().positive(),
    output: z.object({ text: z.string(), structured: z.unknown() }).optional(),
    errorCode: z.string().optional(),
  })
  .loose();
const TaskCapabilityBindingSchema = z
  .object({
    taskId: z.string().min(1),
    requestedCapabilityId: z.string().min(1),
    capabilityVersion: z.number().int().positive(),
    exposureId: z.string().min(1),
    exposureVersion: z.number().int().positive(),
    initialImplementationRefs: z.array(z.string()),
    providerPolicySnapshot: z.record(z.string(), z.unknown()),
    bindingHash: z.string().regex(CHECKSUM),
  })
  .loose();
const CollectionSchema = z.object({ items: z.array(z.unknown()) });
const CheckpointSchema = z
  .object({
    schemaVersion: z.literal('sdar.home-lab-a2a-checkpoint/v2'),
    runId: z.string().min(1),
    createdAt: z.iso.datetime(),
    contextId: z.string().min(1),
    task: z
      .object({
        taskId: z.string().min(1),
        contextId: z.string().min(1),
        goalId: z.string().min(1),
        goalVersion: z.number().int().positive(),
        userGoalPlanId: z.string().min(1),
        workflowPlanId: z.string().min(1),
        terminalOutcomeId: z.string().min(1),
        capabilityId: z.string().min(1),
        exposureId: z.string().min(1),
        skillId: z.string().min(1),
        a2aTaskHash: z.string().regex(CHECKSUM),
        structuredOutcomeHash: z.string().regex(CHECKSUM),
        capabilityBindingHash: z.string().regex(CHECKSUM),
      })
      .strict(),
  })
  .strict();

export async function runHomeLabA2AReadOnly(
  input: HomeLabA2AReadOnlyConfiguration,
  dependencies: DriverDependencies = {},
): Promise<HomeLabA2AReadOnlyReport> {
  const configuration = validateConfiguration(input);
  const scenario = validateScenario(input.scenario ?? HOME_LAB_A2A_READ_ONLY_SCENARIO);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observedAt = validTimestamp(now(), 'A2A_DRIVER_CLOCK_INVALID');
  const environment = dependencies.environment ?? process.env;
  const writeGateObserved =
    environment['ALLOW_REAL_DEVICE_SIDE_EFFECTS'] === 'YES' &&
    nonEmpty(environment['REAL_DEVICE_TEST_RUN_ID'])
      ? 'open_but_unused'
      : 'closed';

  await runtimeGet(configuration, '/api/v1/health', request);
  const providers = ProviderCollectionSchema.parse(
    await runtimeGet(configuration, '/api/v1/models/providers', request),
  );
  const routes = RouteCollectionSchema.parse(
    await runtimeGet(configuration, '/api/v1/models/routes', request),
  );
  const modelAuthority = assertModelRuntimeReady(providers.items, routes.items);

  if (configuration.mode === 'verify-restart')
    return verifyRestartRecovery(
      configuration,
      scenario,
      request,
      dependencies.createA2AClient,
      observedAt,
      writeGateObserved,
      modelAuthority.configuredProviderCount,
    );

  const exposure = await preflightAuthority(configuration, scenario, observedAt, request);
  await ensureExposure(configuration, exposure, request);
  const rebuilt = OperationSchema.parse(
    await controlMutation(
      configuration,
      '/api/v1/a2a-agent-card-revisions/rebuild',
      stableKey(configuration.runId, 'agent-card-rebuild'),
      { reason: 'Publish the exact composite read-only home-lab A2A Capability exposure.' },
      request,
    ),
  );
  if (!isRecord(rebuilt.result) || rebuilt.result['status'] !== 'active')
    fail('A2A_AGENT_CARD_NOT_ACTIVE', 'Node Control did not activate the rebuilt Agent Card.');
  assertAgentCard(
    await publicGet(configuration.a2aBaseUrl, '/.well-known/agent-card.json', request),
    scenario,
  );

  const client = await createClient(configuration.a2aBaseUrl, dependencies.createA2AClient);
  const task = await executeScenario(configuration, scenario, client, request, dependencies);
  const report = buildReport({
    mode: 'execute',
    observedAt,
    task,
    configuredProviderCount: modelAuthority.configuredProviderCount,
    restartRecoveryVerified: false,
    writeGateObserved,
  });
  if (configuration.checkpointFile !== undefined)
    await writeCheckpoint(
      configuration.checkpointFile,
      checkpoint(configuration.runId, observedAt, task),
    );
  return report;
}

export function assertModelRuntimeReady(
  providers: readonly Readonly<{
    providerId: string;
    kind: string;
    apiStyle: string;
    baseUrl: string;
    model: string;
    enabled: boolean;
  }>[],
  routes: readonly Readonly<{ stage: string; providerId: string }>[],
): Readonly<{ configuredProviderCount: number }> {
  const enabled = providers.filter((provider) => provider.enabled);
  const fixture = providers.find(
    (provider) => provider.providerId === HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  );
  const routed = new Map(routes.map((route) => [route.stage, route.providerId]));
  const missing = HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES.filter(
    (stage) => routed.get(stage) !== HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  );
  if (
    fixture?.enabled !== true ||
    fixture.kind !== 'local' ||
    fixture.apiStyle !== 'openai_chat_completions' ||
    fixture.model !== HOME_LAB_A2A_MODEL_FIXTURE_MODEL ||
    !isLoopbackModelV1BaseUrl(fixture.baseUrl) ||
    missing.length > 0
  )
    fail(
      'A2A_MODEL_RUNTIME_NOT_CONFIGURED',
      `A2A requires the exact simulated local fixture and routes for: ${missing.join(', ') || 'all configured stages'}.`,
    );
  return Object.freeze({ configuredProviderCount: enabled.length });
}

export function validateScenario(value: HomeLabA2AReadOnlyScenario): HomeLabA2AReadOnlyScenario {
  if (canonical(value) !== canonical(HOME_LAB_A2A_READ_ONLY_SCENARIO))
    fail(
      'A2A_WRITE_INTENT_FORBIDDEN',
      'G08 accepts only the frozen single-Task, exact-two read-only scenario.',
    );
  assertNoWriteOperations(value);
  return HOME_LAB_A2A_READ_ONLY_SCENARIO;
}

export function assertCompositeReadOnlyPlan(
  plan: unknown,
  scenario: HomeLabA2AReadOnlyScenario = HOME_LAB_A2A_READ_ONLY_SCENARIO,
): void {
  const recordValue = record(plan, 'A2A_PLAN_INVALID');
  const definition = record(recordValue['definition'], 'A2A_PLAN_DEFINITION_INVALID');
  try {
    assertHomeLabReadOnlyWorkflowContract(definition);
  } catch (error: unknown) {
    if (error instanceof HomeLabReadOnlyWorkflowContractError) {
      const code = error.code.endsWith('RESULT_MAPPING_INVALID')
        ? 'A2A_PLAN_RESULT_MAPPING_INVALID'
        : error.code.endsWith('EVIDENCE_GATE_INVALID')
          ? 'A2A_PLAN_EVIDENCE_GATE_INVALID'
          : 'A2A_PLAN_UNQUALIFIED_OPERATION';
      fail(code, error.message);
    }
    throw error;
  }
  const semantics = records(recordValue['toolExecutionSemantics'] ?? []);
  if (
    scenario.operations.some((operation) => {
      const exact = semantics.filter((item) => {
        const reference = isRecord(item['reference']) ? item['reference'] : undefined;
        return (
          reference?.['serverId'] === operation.serverId &&
          reference['toolName'] === operation.toolName
        );
      });
      const execution = isRecord(exact[0]?.['executionSemantics'])
        ? exact[0]['executionSemantics']
        : undefined;
      return (
        exact.length !== 1 ||
        execution?.['effect'] !== 'read_only' ||
        (execution['source'] !== 'mcp_declared' && execution['source'] !== 'admin_override')
      );
    })
  )
    fail(
      'A2A_PLAN_EXECUTION_SEMANTICS_INVALID',
      'Both planned MCP nodes require frozen read-only execution semantics.',
    );
  // The persisted semantics snapshot also contains forbidden policy Tools for audit. Only the
  // executable Workflow definition is subject to the zero-write operation gate.
  assertNoWriteOperations(definition);
}

export function structuredOutcome(
  task: Task,
  scenario: HomeLabA2AReadOnlyScenario = HOME_LAB_A2A_READ_ONLY_SCENARIO,
): Readonly<{
  mainLight: Readonly<Record<string, unknown>>;
  climate: Readonly<Record<string, unknown>>;
}> {
  const dataParts: unknown[] = [];
  for (const artifact of task.artifacts)
    for (const part of artifact.parts)
      if (part.content?.$case === 'data') dataParts.push(part.content.value as unknown);
  if (dataParts.length !== 1)
    fail('A2A_STRUCTURED_OUTCOME_MISSING', 'The terminal Task must expose one data Artifact.');
  const value = record(dataParts[0], 'A2A_STRUCTURED_OUTCOME_INVALID');
  const mainLight = record(value['mainLight'], 'A2A_LIGHT_STATE_INVALID');
  const climate = record(value['climate'], 'A2A_CLIMATE_STATE_INVALID');
  assertResourceState(mainLight, requiredOperation(scenario, 0));
  assertResourceState(climate, requiredOperation(scenario, 1));
  assertSafeJson(value);
  return Object.freeze({
    mainLight: Object.freeze({ ...mainLight }),
    climate: Object.freeze({ ...climate }),
  });
}

export function assertNoWriteOperations(value: unknown): void {
  visit(value, (key, item) => {
    if (
      (key === 'toolName' || key === 'operationName' || key === 'mcpToolName') &&
      typeof item === 'string' &&
      /(?:^|_)(?:set|write|toggle|turn_on|turn_off|power_on|power_off)(?:_|$)/iu.test(item)
    )
      fail('A2A_WRITE_OPERATION_FORBIDDEN', 'G08 forbids every device write operation.');
  });
}

async function preflightAuthority(
  configuration: ValidatedConfiguration,
  scenario: HomeLabA2AReadOnlyScenario,
  observedAt: string,
  request: typeof fetch,
): Promise<A2aExposureVersion> {
  const capability = CapabilitySchema.parse(
    await controlGet(
      configuration,
      `/api/v1/node-capabilities/${encodeURIComponent(scenario.capabilityId)}/versions/1`,
      request,
    ),
  );
  if (capability.capabilityId !== scenario.capabilityId || capability.version !== 1)
    fail('A2A_CAPABILITY_IDENTITY_MISMATCH', 'The exact composite Capability is unavailable.');
  assertCompositeCapabilityConstraints(capability.constraints ?? [], scenario);

  const readiness = ReadinessSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/capability-readiness/${encodeURIComponent(scenario.capabilityId)}/1`,
      request,
    ),
  );
  if (
    readiness.capabilityId !== scenario.capabilityId ||
    readiness.capabilityVersion !== 1 ||
    canonical(readiness.availableImplementations) !==
      canonical([scenario.capabilityImplementationBindingId]) ||
    readiness.unavailableImplementations.length !== 0 ||
    Date.parse(readiness.validUntil) <= Date.parse(observedAt)
  )
    fail(
      'A2A_CAPABILITY_READINESS_INVALID',
      'Composite Capability readiness is stale, partial or not exact.',
    );

  const skill = SkillSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/skills/${encodeURIComponent(scenario.skillId)}/versions/1`,
      request,
    ),
  );
  const required = skill.toolPolicy.required.map(toolKey).sort();
  const expected = scenario.operations.map((operation) => toolKey(operation)).sort();
  if (
    skill.skillId !== scenario.skillId ||
    skill.version !== 1 ||
    canonical(skill.capabilities) !== canonical([scenario.capabilityId]) ||
    canonical(required) !== canonical(expected) ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.runtimePolicy['autoConfirmPlan'] !== false ||
    skill.runtimePolicy['maxMcpCalls'] !== 2 ||
    skill.runtimePolicy['maxLlmCalls'] !== 0
  )
    fail(
      'A2A_SKILL_AUTHORITY_INVALID',
      'The composite Skill must allow exactly two reads, zero LLM calls and no optional Tool.',
    );
  assertNoWriteOperations(skill.toolPolicy.required);

  for (const operation of scenario.operations) {
    const provider = ProviderBindingSchema.parse(
      await controlGet(
        configuration,
        `/api/v1/mcp-provider-bindings/${encodeURIComponent(operation.providerBindingId)}`,
        request,
      ),
    );
    if (
      provider.bindingId !== operation.providerBindingId ||
      provider.localServerId !== operation.serverId ||
      Date.parse(provider.availabilityValidUntil) <= Date.parse(observedAt)
    )
      fail(
        'A2A_PROVIDER_BINDING_INVALID',
        'Both exact Provider Bindings must be active, available and unexpired.',
      );
  }

  const exposure = createA2aExposureVersion({
    exposureId: scenario.exposureId,
    version: 1,
    capabilityId: scenario.capabilityId,
    capabilityVersion: 1,
    agentSkillId: scenario.agentSkillId,
    name: capability.name,
    description: capability.description,
    tags: ['home-lab', 'read-only', 'composite', 'light', 'climate'],
    examples: [scenario.requestText],
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['application/json'],
    requestSchema: jsonObject(capability.inputSchema, 'A2A_CAPABILITY_INPUT_SCHEMA_INVALID'),
    resultSchema: jsonObject(capability.outputSchema, 'A2A_CAPABILITY_OUTPUT_SCHEMA_INVALID'),
    visibility: 'public',
    requesterPolicy: { allowAnonymous: false, allowedRequesterIds: ['home-lab-a2a-read-only'] },
    readinessPublicationPolicy: 'publish_when_available',
    status: 'draft',
  });
  assertSafeJson(exposure);
  return exposure;
}

function assertCompositeCapabilityConstraints(
  constraints: readonly Readonly<Record<string, unknown>>[],
  scenario: HomeLabA2AReadOnlyScenario,
): void {
  const policies = constraints.filter(
    (constraint) => constraint['type'] === 'provider_binding_policy',
  );
  if (
    policies.length !== 2 ||
    scenario.operations.some(
      (operation) =>
        !policies.some(
          (policy) =>
            policy['mcpProviderBindingId'] === operation.providerBindingId &&
            policy['localServerId'] === operation.serverId &&
            policy['mcpToolName'] === operation.toolName &&
            policy['requiredStatus'] === 'active' &&
            policy['requiredAvailabilityStatus'] === 'available' &&
            policy['requiredFreshness'] === 'unexpired' &&
            policy['fallback'] === 'deny',
        ),
    ) ||
    constraints.some(
      (constraint) =>
        constraint['type'] === 'confirmation_policy' && constraint['required'] !== false,
    )
  )
    fail(
      'A2A_CAPABILITY_POLICY_INVALID',
      'The composite Capability must require both exact Binding policies and zero confirmation.',
    );
}

async function ensureExposure(
  configuration: ValidatedConfiguration,
  draft: A2aExposureVersion,
  request: typeof fetch,
): Promise<void> {
  const path = `/api/v1/a2a-exposures/${encodeURIComponent(draft.exposureId)}/versions/1`;
  const response = await controlResponse(configuration, path, { method: 'GET' }, request);
  let current: A2aExposureVersion;
  if (response.status === 404)
    current = ExposureSchema.parse(
      await controlMutation(
        configuration,
        '/api/v1/a2a-exposures',
        stableKey(configuration.runId, `exposure-create:${draft.exposureId}`),
        draft,
        request,
        201,
      ),
    ) as A2aExposureVersion;
  else current = ExposureSchema.parse(await responseJson(response, 200)) as A2aExposureVersion;
  if (current.exposureHash !== draft.exposureHash)
    fail('A2A_EXPOSURE_DRIFT', 'The existing Exposure differs from the exact composite contract.');
  if (current.status === 'retired')
    fail('A2A_EXPOSURE_RETIRED', 'A retired exact-version Exposure cannot be reused.');
  if (current.status === 'published') return;
  const operation = OperationSchema.parse(
    await controlMutation(
      configuration,
      `${path}/publish`,
      stableKey(configuration.runId, `exposure-publish:${draft.exposureId}`),
      { reason: `Publish exact composite read-only Exposure ${draft.exposureId}@1.` },
      request,
      202,
      a2aExposureEtag(current),
    ),
  );
  if (!isRecord(operation.result) || operation.result['status'] !== 'published')
    fail('A2A_EXPOSURE_NOT_PUBLISHED', 'The exact composite Exposure was not published.');
}

async function executeScenario(
  configuration: ValidatedConfiguration,
  scenario: HomeLabA2AReadOnlyScenario,
  client: A2AClient,
  request: typeof fetch,
  dependencies: DriverDependencies,
): Promise<HomeLabA2AReadOnlyTaskReport> {
  const randomId = dependencies.randomId ?? randomUUID;
  const submitted = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `home-lab-a2a-${randomId()}`,
        role: 'ROLE_USER',
        parts: [
          { text: scenario.requestText, mediaType: 'text/plain' },
          {
            data: Object.fromEntries(
              scenario.operations.map((operation) => [operation.inputField, operation.resourceId]),
            ),
            mediaType: 'application/json',
          },
        ],
        metadata: {
          user_id: 'home-lab-a2a-read-only',
          'io.sdar/requestedCapability': {
            exposureId: scenario.exposureId,
            versionConstraint: '1',
            requestId: `${configuration.runId}:composite-read`,
          },
        },
      },
      configuration: { returnImmediately: false },
    }),
  );
  if (!('id' in submitted))
    fail('A2A_TASK_EXPECTED', 'The A2A endpoint returned a Message instead of a Task.');
  let task = submitted;
  let understandingValidated = false;
  let userGoalPlanValidated = false;
  let planConfirmed = false;
  for (
    let interruption = 0;
    task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED;
    interruption += 1
  ) {
    if (interruption >= 4)
      fail('A2A_INPUT_LOOP_EXCEEDED', 'The fixed flow exceeded bounded cognitive confirmations.');
    const runtimeTask = RuntimeTaskSchema.partial().parse(
      await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
    );
    if (runtimeTask.phase === 'awaiting_user_input') {
      const understanding = await runtimeGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(task.id)}/understanding`,
        request,
      );
      assertTaskUnderstanding(understanding, task.id, scenario);
      understandingValidated = true;
      const review = assertAcceptableCognitiveReview(task);
      if (review === 'interactive_planning') {
        if (runtimeTask.goalId === undefined || runtimeTask.goalVersion === undefined)
          fail('A2A_GOAL_LINK_INVALID', 'Interactive planning lacks an attached Goal identity.');
        assertCompositeUserGoalPlan(
          interactiveCandidateUserGoalPlan(
            await runtimeGet(
              configuration,
              `/api/v1/tasks/${encodeURIComponent(task.id)}/planning-session`,
              request,
            ),
            task.id,
            runtimeTask.goalId,
            runtimeTask.goalVersion,
          ),
          runtimeTask.goalId,
          runtimeTask.goalVersion,
          scenario,
        );
        userGoalPlanValidated = true;
      }
      task = await submitContinuation(
        client,
        task,
        randomId,
        'review',
        'accept',
        { action: 'accept', payload: {} },
        'provide_input',
        configuration,
      );
      continue;
    }
    if (runtimeTask.phase !== 'awaiting_plan_confirmation' || runtimeTask.planId === undefined)
      fail(
        'A2A_UNEXPECTED_INPUT_REQUIRED',
        'The fixed query requested unsupported supplementary input.',
      );
    const understanding = await runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/understanding`,
      request,
    );
    assertTaskUnderstanding(understanding, task.id, scenario);
    understandingValidated = true;
    if (runtimeTask.goalId === undefined || runtimeTask.goalVersion === undefined)
      fail('A2A_GOAL_LINK_INVALID', 'Workflow confirmation lacks an attached Goal identity.');
    assertCompositeUserGoalPlan(
      await loadUserGoalPlan(configuration, runtimeTask.goalId, runtimeTask.goalVersion, request),
      runtimeTask.goalId,
      runtimeTask.goalVersion,
      scenario,
    );
    userGoalPlanValidated = true;
    await preflightAuthority(
      configuration,
      scenario,
      validTimestamp(
        (dependencies.now ?? (() => new Date().toISOString()))(),
        'A2A_DRIVER_CLOCK_INVALID',
      ),
      request,
    );
    assertCompositeReadOnlyPlan(
      await runtimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(runtimeTask.planId)}`,
        request,
      ),
      scenario,
    );
    task = await confirmCompositeReadOnlyPlanAfterZeroInvocationGate({
      assertNoMcpInvocations: () =>
        assertNoMcpInvocationsBeforeConfirmation(configuration, task.id, request),
      confirm: () =>
        submitContinuation(
          client,
          task,
          randomId,
          'confirm',
          '确认执行只读计划。',
          undefined,
          'confirm_plan',
          configuration,
        ),
    });
    planConfirmed = true;
  }
  if (task.status?.state === undefined || !TERMINAL_STATES.has(task.status.state))
    task = await pollTerminalTask(
      client,
      task.id,
      configuration.pollIntervalMs,
      configuration.maxPolls,
    );
  if (
    task.status?.state !== TaskState.TASK_STATE_COMPLETED ||
    !understandingValidated ||
    !userGoalPlanValidated ||
    !planConfirmed
  ) {
    if (!planConfirmed)
      await assertNoMcpInvocationsBeforeConfirmation(configuration, task.id, request);
    const runtimeTask = RuntimeTaskSchema.partial().parse(
      await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
    );
    fail(
      'A2A_TASK_NOT_COMPLETED',
      `The single Task terminated fail-closed with ${runtimeTask.errorCode ?? runtimeTask.phase ?? 'unknown'}.`,
    );
  }
  const first = await client.getTask({ tenant: '', id: task.id });
  const second = await client.getTask({ tenant: '', id: task.id });
  if (canonical(taskSnapshot(first, scenario)) !== canonical(taskSnapshot(second, scenario)))
    fail('A2A_GET_TASK_INCONSISTENT', 'Repeated getTask calls returned different terminal facts.');
  return collectCompletedEvidence(configuration, scenario, second, request, dependencies.now);
}

async function submitContinuation(
  client: A2AClient,
  task: Task,
  randomId: () => string,
  scope: string,
  textValue: string,
  data: unknown,
  action: 'provide_input' | 'confirm_plan',
  configuration: ValidatedConfiguration,
): Promise<Task> {
  const response = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `home-lab-a2a-${scope}-${randomId()}`,
        taskId: task.id,
        contextId: task.contextId,
        role: 'ROLE_USER',
        parts: [
          { text: textValue, mediaType: 'text/plain' },
          ...(data === undefined ? [] : [{ data, mediaType: 'application/json' }]),
        ],
        metadata: { user_id: 'home-lab-a2a-read-only', sdar_action: action },
      },
      configuration: { returnImmediately: true },
    }),
  );
  if (!('id' in response))
    fail('A2A_CONTINUATION_TASK_EXPECTED', 'The A2A continuation did not return the Task.');
  return pollResponseBoundary(
    client,
    response.id,
    configuration.pollIntervalMs,
    configuration.maxPolls,
  );
}

async function collectCompletedEvidence(
  configuration: ValidatedConfiguration,
  scenario: HomeLabA2AReadOnlyScenario,
  task: Task,
  request: typeof fetch,
  now?: () => string,
): Promise<HomeLabA2AReadOnlyTaskReport> {
  if (task.status?.state !== TaskState.TASK_STATE_COMPLETED)
    fail('A2A_TASK_NOT_COMPLETED', 'Evidence collection requires a completed A2A Task.');
  const output = structuredOutcome(task, scenario);
  const runtimeTask = RuntimeTaskSchema.parse(
    await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
  );
  if (
    runtimeTask.contextId !== task.contextId ||
    runtimeTask.phase !== 'completed' ||
    runtimeTask.selectedSkillId !== scenario.skillId ||
    runtimeTask.selectedSkillVersion !== 1 ||
    canonical(runtimeTask.output?.structured) !== canonical(output)
  )
    fail('A2A_RUNTIME_TASK_MISMATCH', 'A2A and Runtime Task authority do not match exactly.');

  await preflightAuthority(
    configuration,
    scenario,
    validTimestamp((now ?? (() => new Date().toISOString()))(), 'A2A_DRIVER_CLOCK_INVALID'),
    request,
  );
  const userGoalPlanPromise = loadUserGoalPlan(
    configuration,
    runtimeTask.goalId,
    runtimeTask.goalVersion,
    request,
  );
  const terminalOutcomeId = `terminal-outcome-task-${task.id}`;
  const [
    understanding,
    goal,
    userGoalPlan,
    plan,
    trace,
    events,
    bindingValue,
    taskProjection,
    invocations,
    models,
    terminalOutcome,
  ] = await Promise.all([
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/understanding`,
      request,
    ),
    runtimeGet(configuration, `/api/v1/goals/${encodeURIComponent(runtimeTask.goalId)}`, request),
    userGoalPlanPromise,
    runtimeGet(
      configuration,
      `/api/v1/workflows/plans/${encodeURIComponent(runtimeTask.planId)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/workflows/plans/${encodeURIComponent(runtimeTask.planId)}/trace`,
      request,
    ),
    runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}/events`, request),
    controlGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/capability-binding`,
      request,
    ),
    controlGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
    runtimeGet(
      configuration,
      `/api/v1/mcp/invocations?taskId=${encodeURIComponent(task.id)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/models/invocations?taskId=${encodeURIComponent(task.id)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/runtime-terminal-outcomes/${encodeURIComponent(terminalOutcomeId)}`,
      request,
    ),
  ]);
  assertTaskUnderstanding(understanding, task.id, scenario);
  assertGoal(goal, runtimeTask);
  const userGoalPlanId = assertCompositeUserGoalPlan(
    userGoalPlan,
    runtimeTask.goalId,
    runtimeTask.goalVersion,
    scenario,
  );
  assertCompositeReadOnlyPlan(plan, scenario);
  assertTraceIdentity(trace, runtimeTask.planId);
  const capabilityAttemptId = assertTerminalOutcome(
    terminalOutcome,
    terminalOutcomeId,
    runtimeTask,
  );
  const eventCount = CollectionSchema.parse(events).items.length;
  if (eventCount === 0) fail('A2A_TASK_EVENTS_MISSING', 'The Task has no observable events.');
  const binding = TaskCapabilityBindingSchema.parse(bindingValue);
  if (
    binding.taskId !== task.id ||
    binding.requestedCapabilityId !== scenario.capabilityId ||
    binding.capabilityVersion !== 1 ||
    binding.exposureId !== scenario.exposureId ||
    binding.exposureVersion !== 1 ||
    canonical(binding.initialImplementationRefs) !== canonical([`skill:${scenario.skillId}:1`])
  )
    fail('A2A_CAPABILITY_BINDING_MISMATCH', 'The immutable Task Capability binding is not exact.');
  assertFrozenProviderBindingRequirements(binding.providerPolicySnapshot, scenario);
  if (record(taskProjection, 'A2A_TASK_PROJECTION_INVALID')['taskId'] !== task.id)
    fail('A2A_TASK_PROJECTION_MISMATCH', 'Node Control cannot query the A2A Task ID.');
  assertCompositeMcpInvocations(invocations, scenario, output, capabilityAttemptId);
  const modelStages = assertModelInvocations(models);
  assertNoWriteOperations(trace);
  const snapshot = taskSnapshot(task, scenario);
  return Object.freeze({
    taskId: task.id,
    contextId: task.contextId,
    goalId: runtimeTask.goalId,
    goalVersion: runtimeTask.goalVersion,
    userGoalPlanId,
    workflowPlanId: runtimeTask.planId,
    terminalOutcomeId,
    capabilityId: scenario.capabilityId,
    capabilityVersion: 1,
    exposureId: scenario.exposureId,
    exposureVersion: 1,
    skillId: scenario.skillId,
    skillVersion: 1,
    states: Object.freeze({
      mainLight: sanitizeState(output.mainLight, requiredOperation(scenario, 0)),
      climate: sanitizeState(output.climate, requiredOperation(scenario, 1)),
    }),
    operations: Object.freeze(
      scenario.operations.map((operation) =>
        Object.freeze({
          serverId: operation.serverId,
          operationName: operation.toolName,
          resourceId: operation.resourceId,
          evidenceType: operation.evidenceType,
        }),
      ),
    ),
    a2aTaskHash: sha256(canonical(snapshot)),
    structuredOutcomeHash: sha256(canonical(output)),
    capabilityBindingHash: binding.bindingHash,
    eventCount,
    modelStages,
    evidenceQueries: Object.freeze([
      'a2a.getTask',
      'runtime.task',
      'runtime.task-understanding',
      'runtime.goal',
      'runtime.user-goal-plan',
      'runtime.workflow-plan',
      'runtime.workflow-trace',
      'runtime.events',
      'runtime.mcp-invocations',
      'runtime.model-invocations',
      'runtime.terminal-outcome',
      'node-control.task',
      'node-control.capability-binding',
      'node-control.provider-bindings',
    ]),
  });
}

export function assertFrozenProviderBindingRequirements(
  value: Readonly<Record<string, unknown>>,
  scenario: HomeLabA2AReadOnlyScenario,
): void {
  const resolution = record(value['resolution'], 'A2A_FROZEN_PROVIDER_BINDINGS_INVALID');
  const implementations = records(resolution['implementations'] ?? []);
  const implementation = implementations[0];
  const requirements = records(implementation?.['providerBindingRequirements'] ?? []);
  const expectedRequirements = [...scenario.operations]
    .map((operation) => ({
      bindingId: operation.providerBindingId,
      localServerId: operation.serverId,
    }))
    .sort((left, right) => left.bindingId.localeCompare(right.bindingId));
  const actualRequirements = requirements
    .map((requirement) => ({
      bindingId: requirement['bindingId'],
      localServerId: requirement['localServerId'],
    }))
    .sort((left, right) => String(left.bindingId).localeCompare(String(right.bindingId)));
  if (
    implementations.length !== 1 ||
    implementation?.['implementationRef'] !== `skill:${scenario.skillId}:1` ||
    requirements.length !== 2 ||
    canonical(actualRequirements) !== canonical(expectedRequirements)
  )
    fail(
      'A2A_FROZEN_PROVIDER_BINDINGS_INVALID',
      'The selected implementation must freeze both exact Provider Binding requirements.',
    );

  const current = records(value['currentProviderBindings'] ?? []);
  if (current.length !== 2)
    fail(
      'A2A_FROZEN_PROVIDER_BINDINGS_INVALID',
      'The Task admission snapshot must contain exactly two current Provider authorities.',
    );
  const observedAuthorities = current.map((authority) => {
    const binding = record(authority['binding'], 'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID');
    const lineage = record(
      authority['sourceCandidateLineage'],
      'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID',
    );
    const observedAt = text(
      authority['observedAt'],
      'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID',
    );
    const availabilityValidUntil = text(
      binding['availabilityValidUntil'],
      'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID',
    );
    const catalogObservedAt = text(
      binding['catalogObservedAt'],
      'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID',
    );
    const endpointRef = safeHttpEndpoint(binding['endpointRef']);
    const candidateEndpoint = safeHttpEndpoint(lineage['candidateEndpoint']);
    if (
      !Number.isFinite(Date.parse(observedAt)) ||
      !Number.isFinite(Date.parse(availabilityValidUntil)) ||
      !Number.isFinite(Date.parse(catalogObservedAt)) ||
      Date.parse(availabilityValidUntil) <= Date.parse(observedAt) ||
      Date.parse(catalogObservedAt) > Date.parse(observedAt) ||
      binding['originType'] !== 'smpp_registry' ||
      !nonEmpty(typeof binding['bindingId'] === 'string' ? binding['bindingId'] : undefined) ||
      !nonEmpty(
        typeof binding['localServerId'] === 'string' ? binding['localServerId'] : undefined,
      ) ||
      !nonEmpty(typeof binding['providerId'] === 'string' ? binding['providerId'] : undefined) ||
      !nonEmpty(
        typeof binding['externalProviderId'] === 'string'
          ? binding['externalProviderId']
          : undefined,
      ) ||
      !nonEmpty(
        typeof binding['externalServerId'] === 'string' ? binding['externalServerId'] : undefined,
      ) ||
      !Number.isSafeInteger(binding['revision']) ||
      Number(binding['revision']) < 1 ||
      !Number.isSafeInteger(binding['registryRevision']) ||
      Number(binding['registryRevision']) < 1 ||
      !nonEmpty(
        typeof binding['catalogRevision'] === 'string' ? binding['catalogRevision'] : undefined,
      ) ||
      typeof binding['catalogChecksum'] !== 'string' ||
      !CHECKSUM.test(binding['catalogChecksum']) ||
      typeof binding['registryChecksum'] !== 'string' ||
      !CHECKSUM.test(binding['registryChecksum']) ||
      !Number.isSafeInteger(binding['operationCount']) ||
      Number(binding['operationCount']) < 1 ||
      Number(binding['operationCount']) > 1024 ||
      !nonEmpty(
        typeof lineage['smppSourceId'] === 'string' ? lineage['smppSourceId'] : undefined,
      ) ||
      lineage['externalProviderId'] !== binding['externalProviderId'] ||
      lineage['externalServerId'] !== binding['externalServerId'] ||
      lineage['registryRevision'] !== binding['registryRevision'] ||
      lineage['registryChecksum'] !== binding['registryChecksum'] ||
      !Number.isSafeInteger(lineage['nativeRevision']) ||
      Number(lineage['nativeRevision']) < 1 ||
      typeof lineage['nativeChecksum'] !== 'string' ||
      !CHECKSUM.test(lineage['nativeChecksum']) ||
      lineage['projectionContract'] !== 'sdar-registry-v1' ||
      endpointRef !== candidateEndpoint ||
      binding['providerId'] !== binding['externalProviderId']
    )
      fail(
        'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID',
        'A current Provider Binding lacks fresh catalog or complete native SMPP lineage authority.',
      );
    return Object.freeze({
      bindingId: binding['bindingId'],
      localServerId: binding['localServerId'],
    });
  });
  const sortedAuthorities = [...observedAuthorities].sort((left, right) =>
    String(left.bindingId).localeCompare(String(right.bindingId)),
  );
  if (canonical(sortedAuthorities) !== canonical(expectedRequirements))
    fail(
      'A2A_FROZEN_PROVIDER_BINDINGS_INVALID',
      'Current Provider Binding authorities must match the selected implementation one-to-one.',
    );
}

export function assertTaskUnderstanding(
  understanding: unknown,
  taskId: string,
  scenario: HomeLabA2AReadOnlyScenario = HOME_LAB_A2A_READ_ONLY_SCENARIO,
): void {
  const value = record(understanding, 'A2A_TASK_UNDERSTANDING_INVALID');
  const requirements = records(value['capabilityRequirements'] ?? []);
  const candidates = records(value['taskTypeCandidates'] ?? []);
  const missingDimensions = records(value['missingDimensions'] ?? []);
  const requirement = requirements[0];
  const candidate = candidates[0];
  if (
    value['taskId'] !== taskId ||
    value['originalRequest'] !== scenario.requestText ||
    value['disposition'] !== 'contract_candidate' ||
    typeof value['modelInvocationId'] !== 'string' ||
    requirements.length !== 1 ||
    requirement?.['capabilityId'] !== scenario.capabilityId ||
    requirement['required'] !== true ||
    requirement['available'] !== true ||
    candidates.length !== 1 ||
    candidate?.['taskTypeId'] !== scenario.taskTypeId ||
    candidate['version'] !== 1 ||
    missingDimensions.some((dimension) => dimension['severity'] === 'blocking')
  )
    fail(
      'A2A_TASK_UNDERSTANDING_MISMATCH',
      'Task Understanding must preserve the exact request and sole composite Capability.',
    );
  assertNoWriteOperations(value);
}

function assertCompositeUserGoalPlan(
  value: unknown,
  goalId: string,
  goalVersion: number,
  scenario: HomeLabA2AReadOnlyScenario,
): string {
  const plan = record(value, 'A2A_USER_GOAL_PLAN_INVALID');
  const skillGoals = records(plan['skillGoals'] ?? []);
  const dependencies = records(plan['dependencies'] ?? []);
  const skillGoal = skillGoals[0];
  if (
    plan['goalId'] !== goalId ||
    plan['goalVersion'] !== goalVersion ||
    typeof plan['planId'] !== 'string' ||
    skillGoals.length !== 1 ||
    dependencies.length !== 0 ||
    skillGoal === undefined ||
    canonical(skillGoal['capabilityNeeds']) !== canonical([scenario.capabilityId]) ||
    typeof skillGoal['requiredResult'] !== 'string'
  )
    fail(
      'A2A_USER_GOAL_PLAN_NOT_COMPOSITE',
      'The User Goal plan must contain one SkillGoal requiring only the composite Capability.',
    );
  assertNoWriteOperations(plan);
  return plan['planId'];
}

export function interactiveCandidateUserGoalPlan(
  value: unknown,
  taskId: string,
  goalId: string,
  goalVersion: number,
): unknown {
  const view = record(value, 'A2A_USER_GOAL_PLAN_INVALID');
  const session = record(view['session'], 'A2A_USER_GOAL_PLAN_INVALID');
  const candidate = record(view['candidate'], 'A2A_USER_GOAL_PLAN_INVALID');
  if (
    session['taskId'] !== taskId ||
    session['goalId'] !== goalId ||
    session['goalVersion'] !== goalVersion ||
    session['state'] !== 'plan_review' ||
    candidate['sessionId'] !== session['sessionId'] ||
    candidate['candidateId'] !== session['currentCandidateId'] ||
    candidate['revision'] !== session['currentCandidateRevision'] ||
    candidate['status'] !== 'candidate'
  )
    fail(
      'A2A_USER_GOAL_PLAN_INVALID',
      'The interactive planning review does not expose the exact current candidate.',
    );
  return candidate['plan'];
}

function assertGoal(goal: unknown, task: z.infer<typeof RuntimeTaskSchema>): void {
  const value = record(goal, 'A2A_GOAL_INVALID');
  if (
    value['goalId'] !== task.goalId ||
    value['contextId'] !== task.contextId ||
    value['version'] !== task.goalVersion ||
    (value['status'] !== 'active' && value['status'] !== 'achieved')
  )
    fail('A2A_GOAL_LINK_INVALID', 'The Task and Goal linkage is not queryable or exact.');
  assertNoWriteOperations(value);
}

function assertTerminalOutcome(
  value: unknown,
  outcomeId: string,
  task: z.infer<typeof RuntimeTaskSchema>,
): string {
  const outcome = record(value, 'A2A_TERMINAL_OUTCOME_INVALID');
  const capabilityAttemptId = outcome['capabilityAttemptId'];
  if (
    outcome['outcomeId'] !== outcomeId ||
    outcome['taskId'] !== task.taskId ||
    outcome['goalId'] !== task.goalId ||
    outcome['goalVersion'] !== task.goalVersion ||
    outcome['kind'] !== 'achieved' ||
    outcome['controlStatus'] !== 'achieved' ||
    outcome['authority'] !== 'user_goal_plan_controller' ||
    !nonEmpty(typeof capabilityAttemptId === 'string' ? capabilityAttemptId : undefined) ||
    typeof outcome['summary'] !== 'string' ||
    typeof outcome['committedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(outcome['committedAt']))
  )
    fail(
      'A2A_STRUCTURED_GOAL_OUTCOME_INVALID',
      'The queryable terminal Goal Outcome is absent or not authoritatively achieved.',
    );
  assertNoWriteOperations(outcome);
  return capabilityAttemptId as string;
}

export function assertCompositeMcpInvocations(
  value: unknown,
  scenario: HomeLabA2AReadOnlyScenario,
  output: Readonly<{ mainLight: unknown; climate: unknown }>,
  capabilityAttemptId: string,
): void {
  const items = records(CollectionSchema.parse(value).items);
  if (items.length !== 2)
    fail('A2A_MCP_INVOCATION_INVALID', 'Expected exactly two successful live MCP reads.');
  for (const operation of scenario.operations) {
    const exact = items.filter(
      (item) => item['serverId'] === operation.serverId && item['toolName'] === operation.toolName,
    );
    const invocation = exact[0];
    if (
      exact.length !== 1 ||
      invocation?.['capabilityAttemptId'] !== capabilityAttemptId ||
      invocation['status'] !== 'succeeded' ||
      invocation['executionMode'] !== 'live'
    )
      fail('A2A_MCP_INVOCATION_INVALID', 'Each exact read operation must execute once and live.');
    const semantics = record(
      invocation['executionSemantics'],
      'A2A_MCP_EXECUTION_SEMANTICS_MISSING',
    );
    const argumentsValue = record(invocation['arguments'], 'A2A_MCP_ARGUMENTS_INVALID');
    const result = record(invocation['result'], 'A2A_MCP_RESULT_INVALID');
    const evidence = records(result['evidence'] ?? []);
    if (
      semantics['effect'] !== 'read_only' ||
      canonical(argumentsValue) !== canonical({ resourceId: operation.resourceId }) ||
      result['isError'] !== false ||
      canonical(result['structuredContent']) !== canonical(output[operation.outputField]) ||
      evidence.length === 0 ||
      !evidence.some(
        (item) => item['evidenceType'] === operation.evidenceType && validProviderEvidence(item),
      ) ||
      evidence.some((item) => !validProviderEvidence(item))
    )
      fail(
        'A2A_MCP_EVIDENCE_INVALID',
        'An MCP read lacks exact arguments, structured result or Provider evidence lineage.',
      );
  }
  assertNoWriteOperations(items);
  assertSafeJson(items);
}

function validProviderEvidence(item: Readonly<Record<string, unknown>>): boolean {
  if (
    !nonEmpty(typeof item['evidenceId'] === 'string' ? item['evidenceId'] : undefined) ||
    !nonEmpty(typeof item['evidenceType'] === 'string' ? item['evidenceType'] : undefined) ||
    typeof item['observedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(item['observedAt'])) ||
    !isRecord(item['payloadRef'])
  )
    return false;
  const payload = item['payloadRef'];
  if (payload['kind'] === 'structured_content') return typeof payload['jsonPointer'] === 'string';
  return (
    payload['kind'] === 'uri' &&
    nonEmpty(typeof payload['uri'] === 'string' ? payload['uri'] : undefined)
  );
}

export function assertModelInvocations(value: unknown): readonly string[] {
  const items = records(CollectionSchema.parse(value).items);
  if (items.length === 0)
    fail('A2A_MODEL_EVIDENCE_MISSING', 'The Task has no observable Model invocation evidence.');
  if (items.some((item) => item['status'] !== 'succeeded'))
    fail('A2A_MODEL_INVOCATION_FAILED', 'The Task contains a failed Model invocation.');
  if (
    items.some(
      (item) =>
        item['providerId'] !== HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID ||
        item['model'] !== HOME_LAB_A2A_MODEL_FIXTURE_MODEL ||
        !validModelInvocationOperation(item),
    )
  )
    fail(
      'A2A_MODEL_AUTHORITY_MISMATCH',
      'Task-linked Model evidence crossed the exact simulated local fixture authority.',
    );
  const stages = [
    ...new Set(items.map((item) => text(item['stage'], 'A2A_MODEL_STAGE_INVALID'))),
  ].sort();
  if (
    REQUIRED_MODEL_STAGES.some(
      (stage) => items.filter((item) => item['stage'] === stage).length !== 1,
    )
  )
    fail(
      'A2A_MODEL_EVIDENCE_INCOMPLETE',
      'Observable Model evidence must contain exactly one invocation for every required stage.',
    );
  return Object.freeze(stages);
}

function validModelInvocationOperation(item: Readonly<Record<string, unknown>>): boolean {
  const stage = item['stage'];
  const operation = item['operation'];
  if (stage === 'goal')
    return (
      operation === 'embedding' &&
      item['promptId'] === undefined &&
      item['promptVersion'] === undefined
    );
  return (
    operation === 'structured_generation' &&
    item['promptId'] === `prompt.home-lab-a2a-fixture.${String(stage)}` &&
    Number.isSafeInteger(item['promptVersion']) &&
    Number(item['promptVersion']) > 0
  );
}

function assertAcceptableCognitiveReview(task: Task): 'interactive_goal' | 'interactive_planning' {
  const metadata = record(task.metadata ?? {}, 'A2A_TASK_METADATA_INVALID');
  const interaction = record(
    metadata['io.sdar/interaction'],
    'A2A_COGNITIVE_REVIEW_METADATA_MISSING',
  );
  const allowedActions = interaction['allowedActions'];
  if (
    (interaction['kind'] !== 'interactive_goal' &&
      interaction['kind'] !== 'interactive_planning') ||
    (interaction['state'] !== 'goal_review' && interaction['state'] !== 'plan_review') ||
    !Array.isArray(allowedActions) ||
    !allowedActions.includes('accept')
  )
    fail(
      'A2A_COGNITIVE_REVIEW_NOT_ACCEPTABLE',
      'The fixed query may accept only a complete Goal or plan review.',
    );
  return interaction['kind'];
}

function assertTraceIdentity(trace: unknown, planId: string): void {
  const value = record(trace, 'A2A_TRACE_INVALID');
  const instance = record(value['instance'], 'A2A_TRACE_INSTANCE_INVALID');
  const events = value['events'];
  if (
    instance['planId'] !== planId ||
    instance['status'] !== 'succeeded' ||
    !Array.isArray(events) ||
    events.length === 0
  )
    fail('A2A_TRACE_PLAN_MISMATCH', 'Workflow trace identity differs from the Task plan.');
  assertSafeJson(trace);
}

function assertAgentCard(value: unknown, scenario: HomeLabA2AReadOnlyScenario): void {
  const skills = records(record(value, 'A2A_AGENT_CARD_INVALID')['skills'] ?? []);
  const matches = skills.filter((skill) => skill['id'] === scenario.agentSkillId);
  if (matches.length !== 1)
    fail('A2A_AGENT_CARD_EXPOSURE_MISSING', 'The Agent Card lacks the exact composite Exposure.');
  const match = matches[0];
  if (
    !isRecord(match) ||
    !Array.isArray(match['examples']) ||
    !match['examples'].includes(scenario.requestText)
  )
    fail('A2A_AGENT_CARD_EXPOSURE_INVALID', 'The Agent Card does not preserve the frozen request.');
  assertNoWriteOperations(match);
  assertSafeJson(match);
}

async function assertNoMcpInvocationsBeforeConfirmation(
  configuration: ValidatedConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<void> {
  const value = await runtimeGet(
    configuration,
    `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
    request,
  );
  if (CollectionSchema.parse(value).items.length !== 0)
    fail(
      'A2A_MCP_BEFORE_VALIDATED_CONFIRMATION',
      'An invalid or unconfirmed model plan reached MCP execution.',
    );
}

async function loadUserGoalPlan(
  configuration: ValidatedConfiguration,
  goalId: string,
  goalVersion: number,
  request: typeof fetch,
): Promise<unknown> {
  return managementUserGoalPlan(
    await runtimeGet(
      configuration,
      `/api/v1/goals/${encodeURIComponent(goalId)}/user-goal-plan?goalVersion=${String(goalVersion)}`,
      request,
    ),
  );
}

export function managementUserGoalPlan(value: unknown): unknown {
  const view = record(value, 'A2A_USER_GOAL_PLAN_INVALID');
  return record(view['plan'], 'A2A_USER_GOAL_PLAN_INVALID');
}

async function verifyRestartRecovery(
  configuration: ValidatedConfiguration,
  scenario: HomeLabA2AReadOnlyScenario,
  request: typeof fetch,
  clientFactory: DriverDependencies['createA2AClient'],
  observedAt: string,
  writeGateObserved: 'closed' | 'open_but_unused',
  configuredProviderCount: number,
): Promise<HomeLabA2AReadOnlyReport> {
  if (configuration.checkpointFile === undefined)
    fail('A2A_CHECKPOINT_REQUIRED', 'Restart verification requires a checkpoint file.');
  if (!nonEmpty(configuration.restartEvidenceId))
    fail(
      'A2A_RESTART_EVIDENCE_REQUIRED',
      'Restart verification requires an external restart evidence reference.',
    );
  const saved = CheckpointSchema.parse(
    JSON.parse(await readFile(configuration.checkpointFile, 'utf8')),
  ) as HomeLabA2ACheckpoint;
  if (
    saved.runId !== configuration.runId ||
    saved.task.contextId !== saved.contextId ||
    saved.task.capabilityId !== scenario.capabilityId ||
    saved.task.exposureId !== scenario.exposureId ||
    saved.task.skillId !== scenario.skillId
  )
    fail('A2A_CHECKPOINT_AUTHORITY_MISMATCH', 'The checkpoint differs from the frozen scenario.');
  await preflightAuthority(configuration, scenario, observedAt, request);
  const client = await createClient(configuration.a2aBaseUrl, clientFactory);
  const first = await client.getTask({ tenant: '', id: saved.task.taskId });
  const second = await client.getTask({ tenant: '', id: saved.task.taskId });
  if (
    first.status?.state !== TaskState.TASK_STATE_COMPLETED ||
    canonical(taskSnapshot(first, scenario)) !== canonical(taskSnapshot(second, scenario)) ||
    sha256(canonical(taskSnapshot(second, scenario))) !== saved.task.a2aTaskHash ||
    sha256(canonical(structuredOutcome(second, scenario))) !== saved.task.structuredOutcomeHash
  )
    fail('A2A_RESTART_GET_TASK_DRIFT', 'Recovered getTask evidence differs from the checkpoint.');
  const task = await collectCompletedEvidence(
    configuration,
    scenario,
    second,
    request,
    () => observedAt,
  );
  if (
    task.goalId !== saved.task.goalId ||
    task.goalVersion !== saved.task.goalVersion ||
    task.userGoalPlanId !== saved.task.userGoalPlanId ||
    task.workflowPlanId !== saved.task.workflowPlanId ||
    task.terminalOutcomeId !== saved.task.terminalOutcomeId ||
    task.capabilityBindingHash !== saved.task.capabilityBindingHash
  )
    fail(
      'A2A_RESTART_RUNTIME_AUTHORITY_DRIFT',
      'Recovered Runtime authority differs from checkpoint.',
    );
  return buildReport({
    mode: 'verify-restart',
    observedAt,
    task,
    configuredProviderCount,
    restartRecoveryVerified: true,
    writeGateObserved,
  });
}

function buildReport(
  input: Readonly<{
    mode: HomeLabA2AReadOnlyReport['mode'];
    observedAt: string;
    task: HomeLabA2AReadOnlyTaskReport;
    configuredProviderCount: number;
    restartRecoveryVerified: boolean;
    writeGateObserved: 'closed' | 'open_but_unused';
  }>,
): HomeLabA2AReadOnlyReport {
  const allowedCapabilities: HomeLabA2AReadOnlyReport['safety']['allowedCapabilities'] =
    Object.freeze([HOME_LAB_A2A_READ_ONLY_SCENARIO.capabilityId]);
  const allowedOperations: HomeLabA2AReadOnlyReport['safety']['allowedOperations'] = Object.freeze([
    'light_get_state',
    'climate_get_state',
  ]);
  const report: HomeLabA2AReadOnlyReport = Object.freeze({
    schemaVersion: 'sdar.home-lab-a2a-read-only/v2',
    status: 'passed',
    mode: input.mode,
    observedAt: input.observedAt,
    a2aReadOnlyReady: true,
    restartRecoveryVerified: input.restartRecoveryVerified,
    contextId: input.task.contextId,
    task: input.task,
    modelAuthority: Object.freeze({
      requiredStages: REQUIRED_MODEL_STAGES,
      configuredRouteStages: HOME_LAB_A2A_MODEL_CONFIGURED_ROUTES,
      providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
      model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
      configuredProviderCount: input.configuredProviderCount,
      failedInvocationCount: 0,
      evidenceClass: 'real_a2a_runtime_mcp_ha_with_simulated_local_model_semantics',
      modelBoundary: HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY,
    }),
    safety: Object.freeze({
      allowedCapabilities,
      allowedOperations,
      writeOperationsInvoked: 0,
      physicalWritesInvoked: 0,
      realDeviceWriteGateObserved: input.writeGateObserved,
    }),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      entityIdsIncluded: false,
    }),
  });
  assertSafeJson(report);
  return report;
}

function checkpoint(
  runId: string,
  createdAt: string,
  task: HomeLabA2AReadOnlyTaskReport,
): HomeLabA2ACheckpoint {
  return Object.freeze({
    schemaVersion: 'sdar.home-lab-a2a-checkpoint/v2',
    runId,
    createdAt,
    contextId: task.contextId,
    task: Object.freeze({
      taskId: task.taskId,
      contextId: task.contextId,
      goalId: task.goalId,
      goalVersion: task.goalVersion,
      userGoalPlanId: task.userGoalPlanId,
      workflowPlanId: task.workflowPlanId,
      terminalOutcomeId: task.terminalOutcomeId,
      capabilityId: task.capabilityId,
      exposureId: task.exposureId,
      skillId: task.skillId,
      a2aTaskHash: task.a2aTaskHash,
      structuredOutcomeHash: task.structuredOutcomeHash,
      capabilityBindingHash: task.capabilityBindingHash,
    }),
  });
}

async function writeCheckpoint(file: string, value: HomeLabA2ACheckpoint): Promise<void> {
  assertSafeJson(value);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, file);
}

function assertResourceState(
  value: Readonly<Record<string, unknown>>,
  operation: HomeLabOperation,
) {
  if (
    value['resourceId'] !== operation.resourceId ||
    typeof value['power'] !== 'string' ||
    typeof value['reachable'] !== 'boolean' ||
    typeof value['observedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(value['observedAt']))
  )
    fail('A2A_STRUCTURED_STATE_INVALID', 'A structured state does not match its public resource.');
  if (
    operation.kind === 'climate' &&
    (!Object.hasOwn(value, 'hvacMode') ||
      !Object.hasOwn(value, 'currentTemperature') ||
      !Object.hasOwn(value, 'targetTemperature') ||
      typeof value['temperatureUnit'] !== 'string')
  )
    fail('A2A_STRUCTURED_STATE_INVALID', 'The climate state is incomplete.');
}

function sanitizeState(value: unknown, operation: HomeLabOperation) {
  const output = record(value, 'A2A_STRUCTURED_STATE_INVALID');
  const state: Record<string, unknown> = {
    resourceId: output['resourceId'],
    power: output['power'],
    reachable: output['reachable'],
    observedAt: output['observedAt'],
  };
  if (operation.kind === 'light') state['brightnessPercent'] = output['brightnessPercent'];
  else {
    state['hvacMode'] = output['hvacMode'];
    state['currentTemperature'] = output['currentTemperature'];
    state['targetTemperature'] = output['targetTemperature'];
    state['temperatureUnit'] = output['temperatureUnit'];
  }
  return Object.freeze(state);
}

function taskSnapshot(task: Task, scenario: HomeLabA2AReadOnlyScenario) {
  const metadata: unknown = task.metadata;
  return Object.freeze({
    id: task.id,
    contextId: task.contextId,
    state: task.status?.state,
    internalPhase: isRecord(metadata) ? metadata['internalPhase'] : undefined,
    outputHash: sha256(canonical(structuredOutcome(task, scenario))),
  });
}

async function pollTerminalTask(
  client: A2AClient,
  taskId: string,
  pollIntervalMs: number,
  maxPolls: number,
): Promise<Task> {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state;
    if (state !== undefined && TERMINAL_STATES.has(state)) return task;
    await delay(pollIntervalMs);
  }
  fail('A2A_TASK_TIMEOUT', 'The single read-only Task did not reach a terminal state in time.');
}

async function pollResponseBoundary(
  client: A2AClient,
  taskId: string,
  pollIntervalMs: number,
  maxPolls: number,
): Promise<Task> {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state;
    if (
      state === TaskState.TASK_STATE_INPUT_REQUIRED ||
      (state !== undefined && TERMINAL_STATES.has(state))
    )
      return task;
    await delay(pollIntervalMs);
  }
  fail('A2A_TASK_TIMEOUT', 'The single read-only Task did not reach a response boundary in time.');
}

type ValidatedConfiguration = Readonly<{
  mode: HomeLabA2AReadOnlyConfiguration['mode'];
  a2aBaseUrl: string;
  runtimeManagementBaseUrl: string;
  nodeControlBaseUrl: string;
  nodeControlBearerToken: string;
  runId: string;
  checkpointFile?: string;
  restartEvidenceId?: string;
  pollIntervalMs: number;
  maxPolls: number;
}>;

function validateConfiguration(input: HomeLabA2AReadOnlyConfiguration): ValidatedConfiguration {
  const a2aBaseUrl = loopbackUrl(input.a2aBaseUrl, 'A2A_BASE_URL_INVALID');
  const runtimeManagementBaseUrl = loopbackUrl(
    input.runtimeManagementBaseUrl,
    'A2A_RUNTIME_MANAGEMENT_URL_INVALID',
  );
  const nodeControlBaseUrl = loopbackUrl(input.nodeControlBaseUrl, 'A2A_NODE_CONTROL_URL_INVALID');
  if (!nonEmpty(input.nodeControlBearerToken))
    fail('A2A_NODE_CONTROL_TOKEN_REQUIRED', 'Node Control bearer identity is required.');
  if (!nonEmpty(input.runId) || !/^[A-Za-z0-9._:-]{8,256}$/u.test(input.runId))
    fail('A2A_RUN_ID_INVALID', 'A bounded unique Goal run ID is required.');
  if (
    input.pollIntervalMs !== undefined &&
    (!Number.isSafeInteger(input.pollIntervalMs) || input.pollIntervalMs < 10)
  )
    fail('A2A_POLL_CONFIGURATION_INVALID', 'Poll interval must be at least 10 ms.');
  if (
    input.maxPolls !== undefined &&
    (!Number.isSafeInteger(input.maxPolls) || input.maxPolls < 1 || input.maxPolls > 10_000)
  )
    fail('A2A_POLL_CONFIGURATION_INVALID', 'Poll count is outside the bounded range.');
  return Object.freeze({
    mode: input.mode,
    a2aBaseUrl,
    runtimeManagementBaseUrl,
    nodeControlBaseUrl,
    nodeControlBearerToken: input.nodeControlBearerToken,
    runId: input.runId,
    ...(input.checkpointFile === undefined
      ? {}
      : { checkpointFile: resolve(input.checkpointFile) }),
    ...(input.restartEvidenceId === undefined
      ? {}
      : { restartEvidenceId: input.restartEvidenceId }),
    pollIntervalMs: input.pollIntervalMs ?? 100,
    maxPolls: input.maxPolls ?? 600,
  });
}

function loopbackUrl(value: string, code: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(code, 'The service URL is invalid.');
  }
  if (
    url.protocol !== 'http:' ||
    url.username !== '' ||
    url.password !== '' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    fail(code, 'The integration driver accepts only credential-free loopback HTTP URLs.');
  return url.origin;
}

function isLoopbackModelV1BaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    url.username === '' &&
    url.password === '' &&
    ['127.0.0.1', '[::1]'].includes(url.hostname) &&
    url.pathname.replace(/\/$/u, '') === '/v1' &&
    url.search === '' &&
    url.hash === ''
  );
}

function safeHttpEndpoint(value: unknown): string {
  if (typeof value !== 'string')
    fail('A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID', 'Binding endpoint is missing.');
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    fail('A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID', 'Binding endpoint is invalid.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.hash !== ''
  )
    fail(
      'A2A_FROZEN_PROVIDER_BINDING_AUTHORITY_INVALID',
      'Binding endpoint must be credential-free HTTP(S).',
    );
  return endpoint.toString();
}

async function createClient(
  baseUrl: string,
  factory: DriverDependencies['createA2AClient'],
): Promise<A2AClient> {
  return factory === undefined ? new ClientFactory().createFromUrl(baseUrl) : factory(baseUrl);
}

async function publicGet(baseUrl: string, path: string, request: typeof fetch): Promise<unknown> {
  return responseJson(await request(`${baseUrl}${path}`, { redirect: 'manual' }), 200);
}

async function runtimeGet(
  configuration: ValidatedConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.runtimeManagementBaseUrl}${path}`, { redirect: 'manual' }),
    200,
  );
}

async function controlGet(
  configuration: ValidatedConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(await controlResponse(configuration, path, { method: 'GET' }, request), 200);
}

async function controlMutation(
  configuration: ValidatedConfiguration,
  path: string,
  idempotencyKey: string,
  body: unknown,
  request: typeof fetch,
  expectedStatus = 202,
  ifMatch?: string,
): Promise<unknown> {
  return responseJson(
    await controlResponse(
      configuration,
      path,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }),
        },
        body: JSON.stringify(body),
      },
      request,
    ),
    expectedStatus,
  );
}

async function controlResponse(
  configuration: ValidatedConfiguration,
  path: string,
  init: RequestInit,
  request: typeof fetch,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${configuration.nodeControlBearerToken}`);
  return request(`${configuration.nodeControlBaseUrl}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
  });
}

async function responseJson(response: Response, expectedStatus: number): Promise<unknown> {
  if (response.status !== expectedStatus) {
    let code = `HTTP_${String(response.status)}`;
    try {
      const body = z
        .object({ code: z.string().optional() })
        .loose()
        .parse(await response.json());
      code = body.code ?? code;
    } catch {
      // Error bodies are not reflected because they may contain endpoints or credentials.
    }
    fail(
      'A2A_HTTP_REQUEST_REJECTED',
      `A required API request failed with ${code} and status ${String(response.status)}.`,
    );
  }
  return response.json();
}

function toolKey(value: Readonly<{ serverId: string; toolName: string }>): string {
  return `${value.serverId}\u0000${value.toolName}`;
}

function stableKey(runId: string, operation: string): string {
  return `g08-${sha256(`${runId}:${operation}`).slice(0, 40)}`;
}

function assertSafeJson(value: unknown): void {
  visit(value, (key, item) => {
    if (
      /(?:entity.?id|token|secret|password|credential|authorization|cookie|endpoint|base.?url)/iu.test(
        key,
      ) &&
      !(key.endsWith('Included') && item === false)
    )
      fail('A2A_SENSITIVE_EVIDENCE_FORBIDDEN', 'A2A evidence contains a forbidden field.');
    if (
      typeof item === 'string' &&
      /(?:^|[^A-Za-z0-9_.-])(?:light|climate|sensor|switch|input_boolean)\.[a-z0-9_]+(?:$|[^A-Za-z0-9_.-])/iu.test(
        item,
      )
    )
      fail('A2A_ENTITY_ID_FORBIDDEN', 'A2A evidence contains a Home Assistant entity ID.');
  });
}

function visit(value: unknown, callback: (key: string, value: unknown) => void, key = ''): void {
  callback(key, value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, callback, key);
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, child] of Object.entries(value)) visit(child, callback, childKey);
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) fail('A2A_ARRAY_REQUIRED', 'Expected an array response.');
  return value.map((item) => record(item, 'A2A_RECORD_REQUIRED'));
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(code, 'Expected a JSON object.');
  return value;
}

function jsonObject(value: unknown, code: string): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) fail(code, 'Expected a finite JSON object.');
  return value;
}

function isJsonValue(value: unknown, seen = new WeakSet()): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, seen));
  return Object.values(value).every((item) => isJsonValue(item, seen));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(code, 'Expected a non-empty string.');
  return value;
}

function validTimestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) fail(code, 'Timestamp is invalid.');
  return value;
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function fail(code: string, message: string): never {
  throw new HomeLabA2AReadOnlyError(code, message);
}

export class HomeLabA2AReadOnlyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HomeLabA2AReadOnlyError';
  }
}

export function configurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): HomeLabA2AReadOnlyConfiguration {
  const mode = environment['SDAR_A2A_HOME_LAB_MODE'] ?? 'execute';
  if (mode !== 'execute' && mode !== 'verify-restart')
    fail('A2A_MODE_INVALID', 'SDAR_A2A_HOME_LAB_MODE must be execute or verify-restart.');
  const checkpointFile = environment['SDAR_A2A_HOME_LAB_CHECKPOINT_FILE'];
  return {
    mode,
    a2aBaseUrl: environment['SDAR_A2A_URL'] ?? 'http://127.0.0.1:29999',
    runtimeManagementBaseUrl: environment['SDAR_MANAGEMENT_URL'] ?? 'http://127.0.0.1:29998',
    nodeControlBaseUrl: environment['SDAR_NODE_CONTROL_URL'] ?? 'http://127.0.0.1:20080',
    nodeControlBearerToken: environment['SDAR_NODE_CONTROL_BEARER_TOKEN'] ?? '',
    runId: environment['SDAR_SMPP_GOAL_RUN_ID'] ?? '',
    ...(checkpointFile === undefined ? {} : { checkpointFile }),
    ...(environment['SDAR_A2A_RESTART_EVIDENCE_ID'] === undefined
      ? {}
      : { restartEvidenceId: environment['SDAR_A2A_RESTART_EVIDENCE_ID'] }),
  };
}

async function main(): Promise<void> {
  try {
    const report = await runHomeLabA2AReadOnly(configurationFromEnvironment());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'failed',
        code: error instanceof HomeLabA2AReadOnlyError ? error.code : 'A2A_DRIVER_FAILED',
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
