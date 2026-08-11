import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SendMessageRequest, TaskState, type Task } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import { z } from 'zod';

import {
  a2aExposureEtag,
  createA2aExposureVersion,
  type A2aExposureVersion,
  type JsonObject,
  type JsonValue,
} from '../../../packages/node-control-domain/src/index.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const TERMINAL_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
const REQUIRED_MODEL_STAGES = Object.freeze([
  'task_understanding',
  'goal_contract_generation',
  'goal_planning',
  'skill_input_resolution',
  'workflow_planning',
  'result_processing',
  'goal_evaluation',
] as const);

export type HomeLabA2ATurnKind = 'light' | 'climate';

export interface HomeLabA2AReadOnlyTurn {
  readonly kind: HomeLabA2ATurnKind;
  readonly requestText: string;
  readonly exposureId: string;
  readonly capabilityId: string;
  readonly agentSkillId: string;
  readonly skillId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly resourceId: string;
}

export const HOME_LAB_A2A_READ_ONLY_TURNS: readonly HomeLabA2AReadOnlyTurn[] = Object.freeze([
  Object.freeze({
    kind: 'light' as const,
    requestText: '查询客厅主灯当前状态',
    exposureId: 'home-lab-a2a-light-read-state',
    capabilityId: 'home.light.read-state',
    agentSkillId: 'home-lab.light.read-state',
    skillId: 'home.light.get-state',
    serverId: 'home-lab-light-mcp',
    toolName: 'light_get_state',
    resourceId: 'living-room-main-light',
  }),
  Object.freeze({
    kind: 'climate' as const,
    requestText: '再查询客厅空调当前状态',
    exposureId: 'home-lab-a2a-climate-read-state',
    capabilityId: 'home.climate.read-state',
    agentSkillId: 'home-lab.climate.read-state',
    skillId: 'home.climate.get-state',
    serverId: 'home-lab-climate-mcp',
    toolName: 'climate_get_state',
    resourceId: 'living-room-air-conditioner',
  }),
]);

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
  readonly turns?: readonly HomeLabA2AReadOnlyTurn[];
}

export interface HomeLabA2AReadOnlyReport {
  readonly schemaVersion: 'sdar.home-lab-a2a-read-only/v1';
  readonly status: 'passed';
  readonly mode: 'execute' | 'verify-restart';
  readonly observedAt: string;
  readonly a2aReadOnlyReady: true;
  readonly restartRecoveryVerified: boolean;
  readonly contextId: string;
  readonly turns: readonly HomeLabA2ATurnReport[];
  readonly modelAuthority: Readonly<{
    requiredStages: readonly string[];
    configuredProviderCount: number;
    failedInvocationCount: number;
  }>;
  readonly safety: Readonly<{
    allowedCapabilities: readonly string[];
    allowedOperations: readonly string[];
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

export interface HomeLabA2ATurnReport {
  readonly kind: HomeLabA2ATurnKind;
  readonly taskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly planId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: 1;
  readonly exposureId: string;
  readonly exposureVersion: 1;
  readonly skillId: string;
  readonly skillVersion: 1;
  readonly serverId: string;
  readonly operationName: string;
  readonly resourceId: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly a2aTaskHash: string;
  readonly structuredOutcomeHash: string;
  readonly capabilityBindingHash: string;
  readonly eventCount: number;
  readonly modelStages: readonly string[];
  readonly evidenceQueries: readonly string[];
}

interface HomeLabA2ACheckpoint {
  readonly schemaVersion: 'sdar.home-lab-a2a-checkpoint/v1';
  readonly runId: string;
  readonly createdAt: string;
  readonly contextId: string;
  readonly turns: readonly Readonly<{
    kind: HomeLabA2ATurnKind;
    taskId: string;
    contextId: string;
    goalId: string;
    goalVersion: number;
    planId: string;
    capabilityId: string;
    exposureId: string;
    skillId: string;
    serverId: string;
    operationName: string;
    resourceId: string;
    a2aTaskHash: string;
    structuredOutcomeHash: string;
    capabilityBindingHash: string;
  }>[];
}

type A2AClient = Pick<Client, 'sendMessage' | 'getTask'>;

interface DriverDependencies {
  readonly fetch?: typeof fetch;
  readonly createA2AClient?: (baseUrl: string) => Promise<A2AClient>;
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
}

const ProviderCollectionSchema = z.object({
  items: z.array(
    z
      .object({
        providerId: z.string().min(1),
        enabled: z.boolean(),
      })
      .loose(),
  ),
});
const RouteCollectionSchema = z.object({
  items: z.array(
    z
      .object({
        stage: z.string().min(1),
        providerId: z.string().min(1),
      })
      .loose(),
  ),
});
const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
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
    availableImplementations: z.array(z.string()).min(1),
    unavailableImplementations: z.array(z.string()),
  })
  .loose();
const SkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.number().int().positive(),
    status: z.literal('enabled'),
    capabilities: z.array(z.string()),
    toolPolicy: z
      .object({
        required: z.array(
          z.object({ serverId: z.string().min(1), toolName: z.string().min(1) }).strict(),
        ),
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
  .object({
    status: z.literal('succeeded'),
    errorCode: z.string().optional(),
    result: z.unknown().optional(),
  })
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
    initialImplementationRefs: z.array(z.string()).min(1),
    bindingHash: z.string().regex(CHECKSUM),
  })
  .loose();
const CollectionSchema = z.object({ items: z.array(z.unknown()) });
const CheckpointSchema = z
  .object({
    schemaVersion: z.literal('sdar.home-lab-a2a-checkpoint/v1'),
    runId: z.string().min(1),
    createdAt: z.iso.datetime(),
    contextId: z.string().min(1),
    turns: z.array(
      z.object({
        kind: z.enum(['light', 'climate']),
        taskId: z.string().min(1),
        contextId: z.string().min(1),
        goalId: z.string().min(1),
        goalVersion: z.number().int().positive(),
        planId: z.string().min(1),
        capabilityId: z.string().min(1),
        exposureId: z.string().min(1),
        skillId: z.string().min(1),
        serverId: z.string().min(1),
        operationName: z.string().min(1),
        resourceId: z.string().min(1),
        a2aTaskHash: z.string().regex(CHECKSUM),
        structuredOutcomeHash: z.string().regex(CHECKSUM),
        capabilityBindingHash: z.string().regex(CHECKSUM),
      }),
    ),
  })
  .strict();

export async function runHomeLabA2AReadOnly(
  input: HomeLabA2AReadOnlyConfiguration,
  dependencies: DriverDependencies = {},
): Promise<HomeLabA2AReadOnlyReport> {
  const configuration = validateConfiguration(input);
  const turns = validateTurns(input.turns ?? HOME_LAB_A2A_READ_ONLY_TURNS);
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observedAt = validTimestamp(now(), 'A2A_DRIVER_CLOCK_INVALID');
  const environment = dependencies.environment ?? process.env;
  const writeGateObserved =
    environment['ALLOW_REAL_DEVICE_SIDE_EFFECTS'] === 'YES' &&
    nonEmpty(environment['REAL_DEVICE_TEST_RUN_ID'])
      ? 'open_but_unused'
      : 'closed';

  if (configuration.mode === 'verify-restart') {
    return verifyRestartRecovery(
      configuration,
      turns,
      request,
      dependencies.createA2AClient,
      observedAt,
      writeGateObserved,
    );
  }

  // Every external dependency and authority fact is checked before the first
  // Node Control mutation. In particular, an absent LLM provider/route cannot
  // leave a partially published A2A Exposure behind.
  await runtimeGet(configuration, '/api/v1/health', request);
  const providers = ProviderCollectionSchema.parse(
    await runtimeGet(configuration, '/api/v1/models/providers', request),
  );
  const routes = RouteCollectionSchema.parse(
    await runtimeGet(configuration, '/api/v1/models/routes', request),
  );
  const modelAuthority = assertModelRuntimeReady(providers.items, routes.items);

  const prepared = await Promise.all(
    turns.map((turn) => preflightTurn(configuration, turn, observedAt, request)),
  );
  for (const item of prepared) await ensureExposure(configuration, item.exposure, request);
  const rebuilt = OperationSchema.parse(
    await controlMutation(
      configuration,
      '/api/v1/a2a-agent-card-revisions/rebuild',
      stableKey(configuration.runId, 'agent-card-rebuild'),
      { reason: 'Publish the exact two read-only home-lab A2A Capability exposures.' },
      request,
    ),
  );
  if (!isRecord(rebuilt.result) || rebuilt.result['status'] !== 'active')
    fail('A2A_AGENT_CARD_NOT_ACTIVE', 'Node Control did not activate the rebuilt Agent Card.');
  const agentCard = await publicGet(
    configuration.a2aBaseUrl,
    '/.well-known/agent-card.json',
    request,
  );
  assertAgentCard(agentCard, turns);

  const client = await createClient(configuration.a2aBaseUrl, dependencies.createA2AClient);
  const turnReports: HomeLabA2ATurnReport[] = [];
  let contextId: string | undefined;
  for (const turn of turns) {
    const completed = await executeTurn(
      configuration,
      turn,
      contextId,
      client,
      request,
      dependencies,
    );
    contextId ??= completed.contextId;
    if (completed.contextId !== contextId)
      fail('A2A_CONTEXT_CHAIN_BROKEN', 'The two read-only A2A turns did not share one context.');
    turnReports.push(completed);
  }
  if (contextId === undefined) fail('A2A_CONTEXT_MISSING', 'The A2A context was not created.');

  const report = buildReport({
    mode: 'execute',
    observedAt,
    contextId,
    turns: turnReports,
    configuredProviderCount: modelAuthority.configuredProviderCount,
    restartRecoveryVerified: false,
    writeGateObserved,
  });
  if (configuration.checkpointFile !== undefined) {
    await writeCheckpoint(configuration.checkpointFile, {
      schemaVersion: 'sdar.home-lab-a2a-checkpoint/v1',
      runId: configuration.runId,
      createdAt: observedAt,
      contextId,
      turns: turnReports.map((turn) => ({
        kind: turn.kind,
        taskId: turn.taskId,
        contextId: turn.contextId,
        goalId: turn.goalId,
        goalVersion: turn.goalVersion,
        planId: turn.planId,
        capabilityId: turn.capabilityId,
        exposureId: turn.exposureId,
        skillId: turn.skillId,
        serverId: turn.serverId,
        operationName: turn.operationName,
        resourceId: turn.resourceId,
        a2aTaskHash: turn.a2aTaskHash,
        structuredOutcomeHash: turn.structuredOutcomeHash,
        capabilityBindingHash: turn.capabilityBindingHash,
      })),
    });
  }
  return report;
}

export function assertModelRuntimeReady(
  providers: readonly Readonly<{ providerId: string; enabled: boolean }>[],
  routes: readonly Readonly<{ stage: string; providerId: string }>[],
): Readonly<{ configuredProviderCount: number }> {
  const enabled = new Set(
    providers.filter((provider) => provider.enabled).map((provider) => provider.providerId),
  );
  const routed = new Map(routes.map((route) => [route.stage, route.providerId]));
  const missingStages = REQUIRED_MODEL_STAGES.filter((stage) => {
    const providerId = routed.get(stage);
    return providerId === undefined || !enabled.has(providerId);
  });
  if (enabled.size === 0 || missingStages.length > 0) {
    fail(
      'A2A_MODEL_RUNTIME_NOT_CONFIGURED',
      `The real A2A path requires an enabled Model Provider and routes for: ${missingStages.join(', ') || 'all required stages'}.`,
    );
  }
  return Object.freeze({ configuredProviderCount: enabled.size });
}

export function assertReadOnlyPlan(
  plan: unknown,
  expected: Pick<HomeLabA2AReadOnlyTurn, 'serverId' | 'toolName'>,
): void {
  const definition = record(plan, 'A2A_PLAN_INVALID')['definition'];
  const nodes = records(record(definition, 'A2A_PLAN_DEFINITION_INVALID')['nodes'] ?? []);
  const allowedNodeTypes = new Set(['mcp_tool', 'condition', 'result', 'error_handler']);
  const tools = nodes
    .filter((node) => node['type'] === 'mcp_tool')
    .map((node) => record(node['tool'], 'A2A_PLAN_TOOL_INVALID'));
  const tool = tools.length === 1 ? tools[0] : undefined;
  if (nodes.some((node) => typeof node['type'] !== 'string' || !allowedNodeTypes.has(node['type'])))
    fail(
      'A2A_PLAN_UNQUALIFIED_OPERATION',
      'The read-only Skill plan contains an unqualified executable node.',
    );
  if (tool?.['serverId'] !== expected.serverId || tool['toolName'] !== expected.toolName) {
    fail(
      'A2A_PLAN_UNQUALIFIED_OPERATION',
      'The plan must invoke exactly the qualified read-only MCP operation.',
    );
  }
  assertNoWriteOperations(plan);
}

export function structuredOutcome(task: Task, turn: HomeLabA2AReadOnlyTurn): unknown {
  const dataParts: unknown[] = [];
  for (const artifact of task.artifacts)
    for (const part of artifact.parts)
      if (part.content?.$case === 'data') dataParts.push(part.content.value as unknown);
  if (dataParts.length !== 1)
    fail('A2A_STRUCTURED_OUTCOME_MISSING', 'The terminal A2A Task must expose one data Artifact.');
  const output = record(dataParts[0], 'A2A_STRUCTURED_OUTCOME_INVALID');
  if (output['resourceId'] !== turn.resourceId)
    fail(
      'A2A_RESOURCE_IDENTITY_MISMATCH',
      'The structured A2A outcome does not match the requested public resource ID.',
    );
  if (
    typeof output['power'] !== 'string' ||
    typeof output['reachable'] !== 'boolean' ||
    typeof output['observedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(output['observedAt']))
  ) {
    fail('A2A_STRUCTURED_STATE_INVALID', 'The A2A outcome is not a structured current state.');
  }
  if (
    turn.kind === 'climate' &&
    (!Object.hasOwn(output, 'hvacMode') ||
      !Object.hasOwn(output, 'currentTemperature') ||
      !Object.hasOwn(output, 'targetTemperature') ||
      typeof output['temperatureUnit'] !== 'string')
  ) {
    fail('A2A_STRUCTURED_STATE_INVALID', 'The climate outcome is missing structured state fields.');
  }
  assertSafeJson(output);
  return output;
}

export function assertNoWriteOperations(value: unknown): void {
  visit(value, (key, item) => {
    if (
      (key === 'toolName' || key === 'operationName' || key === 'mcpToolName') &&
      typeof item === 'string' &&
      /(?:^|_)(?:set|write|toggle|turn_on|turn_off|power_on|power_off)(?:_|$)/iu.test(item)
    ) {
      fail('A2A_WRITE_OPERATION_FORBIDDEN', 'G08 forbids every device write operation.');
    }
  });
}

async function preflightTurn(
  configuration: ValidatedConfiguration,
  turn: HomeLabA2AReadOnlyTurn,
  observedAt: string,
  request: typeof fetch,
): Promise<Readonly<{ exposure: A2aExposureVersion }>> {
  const capability = CapabilitySchema.parse(
    await controlGet(
      configuration,
      `/api/v1/node-capabilities/${encodeURIComponent(turn.capabilityId)}/versions/1`,
      request,
    ),
  );
  if (capability.capabilityId !== turn.capabilityId || capability.version !== 1)
    fail('A2A_CAPABILITY_IDENTITY_MISMATCH', 'The exact read-only Capability is unavailable.');
  const readiness = ReadinessSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/capability-readiness/${encodeURIComponent(turn.capabilityId)}/1`,
      request,
    ),
  );
  if (
    readiness.capabilityId !== turn.capabilityId ||
    readiness.capabilityVersion !== 1 ||
    readiness.unavailableImplementations.length !== 0 ||
    Date.parse(readiness.validUntil) <= Date.parse(observedAt)
  ) {
    fail('A2A_CAPABILITY_READINESS_INVALID', 'Capability readiness is stale or not exact.');
  }
  const skill = SkillSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/skills/${encodeURIComponent(turn.skillId)}/versions/1`,
      request,
    ),
  );
  const requiredTool =
    skill.toolPolicy.required.length === 1 ? skill.toolPolicy.required[0] : undefined;
  if (
    skill.skillId !== turn.skillId ||
    skill.version !== 1 ||
    !skill.capabilities.includes(turn.capabilityId) ||
    requiredTool?.serverId !== turn.serverId ||
    requiredTool.toolName !== turn.toolName ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.toolPolicy.forbidden.length !== 0 ||
    skill.runtimePolicy['autoConfirmPlan'] !== false ||
    skill.runtimePolicy['maxMcpCalls'] !== 1 ||
    skill.runtimePolicy['maxLlmCalls'] !== 0
  ) {
    fail('A2A_SKILL_AUTHORITY_INVALID', 'The exact read-only Skill authority is not executable.');
  }
  const providerBindingId = providerBindingFor(turn);
  const provider = ProviderBindingSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/mcp-provider-bindings/${encodeURIComponent(providerBindingId)}`,
      request,
    ),
  );
  if (
    provider.bindingId !== providerBindingId ||
    provider.localServerId !== turn.serverId ||
    Date.parse(provider.availabilityValidUntil) <= Date.parse(observedAt)
  ) {
    fail('A2A_PROVIDER_BINDING_INVALID', 'The exact Provider Binding is stale or unavailable.');
  }
  const exposure = createA2aExposureVersion({
    exposureId: turn.exposureId,
    version: 1,
    capabilityId: turn.capabilityId,
    capabilityVersion: 1,
    agentSkillId: turn.agentSkillId,
    name: capability.name,
    description: capability.description,
    tags: ['home-lab', 'read-only', turn.kind],
    examples: [turn.requestText],
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
  return Object.freeze({ exposure });
}

async function ensureExposure(
  configuration: ValidatedConfiguration,
  draft: A2aExposureVersion,
  request: typeof fetch,
): Promise<void> {
  const path = `/api/v1/a2a-exposures/${encodeURIComponent(draft.exposureId)}/versions/1`;
  const response = await controlResponse(configuration, path, { method: 'GET' }, request);
  let current: A2aExposureVersion;
  if (response.status === 404) {
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
  } else {
    current = ExposureSchema.parse(await responseJson(response, 200)) as A2aExposureVersion;
    if (current.exposureHash !== draft.exposureHash)
      fail(
        'A2A_EXPOSURE_DRIFT',
        'An existing A2A Exposure differs from the exact read-only contract.',
      );
  }
  if (current.status === 'retired')
    fail('A2A_EXPOSURE_RETIRED', 'A retired exact-version Exposure cannot be reused.');
  if (current.status === 'published') return;
  const operation = OperationSchema.parse(
    await controlMutation(
      configuration,
      `${path}/publish`,
      stableKey(configuration.runId, `exposure-publish:${draft.exposureId}`),
      { reason: `Publish exact read-only Exposure ${draft.exposureId}@1.` },
      request,
      202,
      a2aExposureEtag(current),
    ),
  );
  if (!isRecord(operation.result) || operation.result['status'] !== 'published')
    fail('A2A_EXPOSURE_NOT_PUBLISHED', 'The exact read-only Exposure was not published.');
}

async function executeTurn(
  configuration: ValidatedConfiguration,
  turn: HomeLabA2AReadOnlyTurn,
  contextId: string | undefined,
  client: A2AClient,
  request: typeof fetch,
  dependencies: DriverDependencies,
): Promise<HomeLabA2ATurnReport> {
  const randomId = dependencies.randomId ?? randomUUID;
  const submitted = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `home-lab-a2a-${randomId()}`,
        ...(contextId === undefined ? {} : { contextId }),
        role: 'ROLE_USER',
        parts: [
          { text: turn.requestText, mediaType: 'text/plain' },
          { data: { resourceId: turn.resourceId }, mediaType: 'application/json' },
        ],
        metadata: {
          user_id: 'home-lab-a2a-read-only',
          'io.sdar/requestedCapability': {
            exposureId: turn.exposureId,
            versionConstraint: '1',
            requestId: `${configuration.runId}:${turn.kind}`,
          },
        },
      },
      configuration: { returnImmediately: false },
    }),
  );
  if (!('id' in submitted))
    fail('A2A_TASK_EXPECTED', 'The A2A endpoint returned a Message instead of a Task.');
  let task = submitted;
  for (
    let interruption = 0;
    task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED;
    interruption += 1
  ) {
    if (interruption >= 4)
      fail('A2A_INPUT_LOOP_EXCEEDED', 'The fixed read-only flow exceeded bounded confirmations.');
    const runtimeTask = RuntimeTaskSchema.partial().parse(
      await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
    );
    if (runtimeTask.phase === 'awaiting_user_input') {
      assertAcceptableCognitiveReview(task);
      const accepted = await client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: `home-lab-a2a-review-${randomId()}`,
            taskId: task.id,
            contextId: task.contextId,
            role: 'ROLE_USER',
            parts: [
              { text: 'accept', mediaType: 'text/plain' },
              { data: { action: 'accept', payload: {} }, mediaType: 'application/json' },
            ],
            metadata: { user_id: 'home-lab-a2a-read-only', sdar_action: 'provide_input' },
          },
          configuration: { returnImmediately: true },
        }),
      );
      if (!('id' in accepted))
        fail('A2A_REVIEW_TASK_EXPECTED', 'Cognitive review did not return the Task.');
      task = await pollResponseBoundary(
        client,
        accepted.id,
        configuration.pollIntervalMs,
        configuration.maxPolls,
      );
      continue;
    }
    if (runtimeTask.phase !== 'awaiting_plan_confirmation' || runtimeTask.planId === undefined)
      fail(
        'A2A_UNEXPECTED_INPUT_REQUIRED',
        'The fixed read-only flow requested unsupported supplementary input.',
      );
    assertReadOnlyPlan(
      await runtimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(runtimeTask.planId)}`,
        request,
      ),
      turn,
    );
    const confirmation = await client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `home-lab-a2a-confirm-${randomId()}`,
          taskId: task.id,
          contextId: task.contextId,
          role: 'ROLE_USER',
          parts: [{ text: '确认执行只读计划。', mediaType: 'text/plain' }],
          metadata: { user_id: 'home-lab-a2a-read-only', sdar_action: 'confirm_plan' },
        },
        configuration: { returnImmediately: true },
      }),
    );
    if (!('id' in confirmation))
      fail('A2A_CONFIRMATION_TASK_EXPECTED', 'Plan confirmation did not return the Task.');
    task = await pollResponseBoundary(
      client,
      confirmation.id,
      configuration.pollIntervalMs,
      configuration.maxPolls,
    );
  }
  if (task.status?.state === undefined || !TERMINAL_STATES.has(task.status.state))
    task = await pollTerminalTask(
      client,
      task.id,
      configuration.pollIntervalMs,
      configuration.maxPolls,
    );
  if (task.status?.state !== TaskState.TASK_STATE_COMPLETED) {
    const runtimeTask = RuntimeTaskSchema.partial().parse(
      await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
    );
    fail(
      'A2A_TASK_NOT_COMPLETED',
      `The read-only A2A Task terminated fail-closed with ${runtimeTask.errorCode ?? runtimeTask.phase ?? 'unknown'}.`,
    );
  }
  const firstRead = await client.getTask({ tenant: '', id: task.id });
  const secondRead = await client.getTask({ tenant: '', id: task.id });
  const firstSnapshot = a2aTaskSnapshot(firstRead, turn);
  const secondSnapshot = a2aTaskSnapshot(secondRead, turn);
  if (canonical(firstSnapshot) !== canonical(secondSnapshot))
    fail('A2A_GET_TASK_INCONSISTENT', 'Repeated getTask calls returned different terminal facts.');

  const output = structuredOutcome(secondRead, turn);
  const runtimeTask = RuntimeTaskSchema.parse(
    await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
  );
  if (
    runtimeTask.contextId !== task.contextId ||
    runtimeTask.phase !== 'completed' ||
    runtimeTask.selectedSkillId !== turn.skillId ||
    runtimeTask.selectedSkillVersion !== 1 ||
    canonical(runtimeTask.output?.structured) !== canonical(output)
  ) {
    fail('A2A_RUNTIME_TASK_MISMATCH', 'A2A and Runtime Task authority do not match exactly.');
  }

  const [
    understanding,
    goal,
    plan,
    trace,
    events,
    capabilityBinding,
    taskProjection,
    invocations,
    models,
  ] = await Promise.all([
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/understanding`,
      request,
    ),
    runtimeGet(configuration, `/api/v1/goals/${encodeURIComponent(runtimeTask.goalId)}`, request),
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
  ]);
  assertTaskUnderstanding(understanding, runtimeTask, turn);
  assertGoal(goal, runtimeTask);
  assertReadOnlyPlan(plan, turn);
  assertTraceIdentity(trace, runtimeTask.planId);
  const eventCount = CollectionSchema.parse(events).items.length;
  if (eventCount === 0) fail('A2A_TASK_EVENTS_MISSING', 'The Task has no observable events.');
  const binding = TaskCapabilityBindingSchema.parse(capabilityBinding);
  if (
    binding.taskId !== task.id ||
    binding.requestedCapabilityId !== turn.capabilityId ||
    binding.capabilityVersion !== 1 ||
    binding.exposureId !== turn.exposureId ||
    binding.exposureVersion !== 1 ||
    canonical(binding.initialImplementationRefs) !== canonical([`skill:${turn.skillId}:1`])
  ) {
    fail('A2A_CAPABILITY_BINDING_MISMATCH', 'The immutable Task Capability binding is not exact.');
  }
  if (record(taskProjection, 'A2A_TASK_PROJECTION_INVALID')['taskId'] !== task.id)
    fail('A2A_TASK_PROJECTION_MISMATCH', 'Node Control cannot query the A2A Task ID.');
  assertMcpInvocations(invocations, turn, output);
  const modelStages = assertModelInvocations(models);
  assertNoWriteOperations({ plan, trace, invocations });

  return Object.freeze({
    kind: turn.kind,
    taskId: task.id,
    contextId: task.contextId,
    goalId: runtimeTask.goalId,
    goalVersion: runtimeTask.goalVersion,
    planId: runtimeTask.planId,
    capabilityId: turn.capabilityId,
    capabilityVersion: 1,
    exposureId: turn.exposureId,
    exposureVersion: 1,
    skillId: turn.skillId,
    skillVersion: 1,
    serverId: turn.serverId,
    operationName: turn.toolName,
    resourceId: turn.resourceId,
    state: sanitizeState(output, turn),
    a2aTaskHash: sha256(canonical(secondSnapshot)),
    structuredOutcomeHash: sha256(canonical(output)),
    capabilityBindingHash: binding.bindingHash,
    eventCount,
    modelStages,
    evidenceQueries: Object.freeze([
      'a2a.getTask',
      'runtime.task',
      'runtime.task-understanding',
      'runtime.goal',
      'runtime.plan',
      'runtime.trace',
      'runtime.events',
      'runtime.mcp-invocations',
      'runtime.model-invocations',
      'node-control.task',
      'node-control.capability-binding',
    ]),
  });
}

async function verifyRestartRecovery(
  configuration: ValidatedConfiguration,
  turns: readonly HomeLabA2AReadOnlyTurn[],
  request: typeof fetch,
  clientFactory: DriverDependencies['createA2AClient'],
  observedAt: string,
  writeGateObserved: 'closed' | 'open_but_unused',
): Promise<HomeLabA2AReadOnlyReport> {
  if (configuration.checkpointFile === undefined)
    fail('A2A_CHECKPOINT_REQUIRED', 'Restart verification requires a checkpoint file.');
  if (!nonEmpty(configuration.restartEvidenceId))
    fail(
      'A2A_RESTART_EVIDENCE_REQUIRED',
      'Restart verification requires an external restart evidence reference.',
    );
  await runtimeGet(configuration, '/api/v1/health', request);
  const providers = ProviderCollectionSchema.parse(
    await runtimeGet(configuration, '/api/v1/models/providers', request),
  );
  const routes = RouteCollectionSchema.parse(
    await runtimeGet(configuration, '/api/v1/models/routes', request),
  );
  const modelAuthority = assertModelRuntimeReady(providers.items, routes.items);
  const checkpoint = CheckpointSchema.parse(
    JSON.parse(await readFile(configuration.checkpointFile, 'utf8')),
  ) as HomeLabA2ACheckpoint;
  if (checkpoint.runId !== configuration.runId)
    fail('A2A_CHECKPOINT_RUN_MISMATCH', 'The restart checkpoint belongs to a different Goal run.');
  if (checkpoint.turns.length !== turns.length)
    fail('A2A_CHECKPOINT_INVALID', 'The restart checkpoint has an unexpected turn count.');
  const client = await createClient(configuration.a2aBaseUrl, clientFactory);
  const recovered: HomeLabA2ATurnReport[] = [];
  for (const [index, saved] of checkpoint.turns.entries()) {
    const turn = turns[index];
    if (turn === undefined)
      fail('A2A_CHECKPOINT_AUTHORITY_MISMATCH', 'Checkpoint turn has no fixed scenario match.');
    if (
      saved.kind !== turn.kind ||
      saved.capabilityId !== turn.capabilityId ||
      saved.exposureId !== turn.exposureId ||
      saved.skillId !== turn.skillId ||
      saved.serverId !== turn.serverId ||
      saved.operationName !== turn.toolName ||
      saved.resourceId !== turn.resourceId
    ) {
      fail(
        'A2A_CHECKPOINT_AUTHORITY_MISMATCH',
        'Checkpoint authority differs from the fixed scenario.',
      );
    }
    const first = await client.getTask({ tenant: '', id: saved.taskId });
    const second = await client.getTask({ tenant: '', id: saved.taskId });
    if (first.status?.state !== TaskState.TASK_STATE_COMPLETED)
      fail(
        'A2A_RESTART_TASK_NOT_RECOVERED',
        'A completed A2A Task was not recovered after restart.',
      );
    const snapshot = a2aTaskSnapshot(second, turn);
    const output = structuredOutcome(second, turn);
    if (
      first.id !== saved.taskId ||
      first.contextId !== saved.contextId ||
      canonical(a2aTaskSnapshot(first, turn)) !== canonical(snapshot) ||
      sha256(canonical(snapshot)) !== saved.a2aTaskHash ||
      sha256(canonical(output)) !== saved.structuredOutcomeHash
    ) {
      fail('A2A_RESTART_GET_TASK_DRIFT', 'Recovered getTask evidence differs from the checkpoint.');
    }
    const [
      runtimeTaskValue,
      understanding,
      goal,
      plan,
      trace,
      bindingValue,
      taskProjection,
      events,
      invocations,
      models,
    ] = await Promise.all([
      runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(saved.taskId)}`, request),
      runtimeGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(saved.taskId)}/understanding`,
        request,
      ),
      runtimeGet(configuration, `/api/v1/goals/${encodeURIComponent(saved.goalId)}`, request),
      runtimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(saved.planId)}`,
        request,
      ),
      runtimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(saved.planId)}/trace`,
        request,
      ),
      controlGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(saved.taskId)}/capability-binding`,
        request,
      ),
      controlGet(configuration, `/api/v1/tasks/${encodeURIComponent(saved.taskId)}`, request),
      runtimeGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(saved.taskId)}/events`,
        request,
      ),
      runtimeGet(
        configuration,
        `/api/v1/mcp/invocations?taskId=${encodeURIComponent(saved.taskId)}`,
        request,
      ),
      runtimeGet(
        configuration,
        `/api/v1/models/invocations?taskId=${encodeURIComponent(saved.taskId)}`,
        request,
      ),
    ]);
    const runtimeTask = RuntimeTaskSchema.parse(runtimeTaskValue);
    if (
      runtimeTask.taskId !== saved.taskId ||
      runtimeTask.contextId !== saved.contextId ||
      runtimeTask.goalId !== saved.goalId ||
      runtimeTask.goalVersion !== saved.goalVersion ||
      runtimeTask.planId !== saved.planId ||
      runtimeTask.selectedSkillId !== saved.skillId ||
      runtimeTask.selectedSkillVersion !== 1 ||
      runtimeTask.phase !== 'completed'
    ) {
      fail('A2A_RESTART_RUNTIME_TASK_DRIFT', 'Recovered Runtime Task IDs or authority drifted.');
    }
    assertTaskUnderstanding(understanding, runtimeTask, turn);
    assertGoal(goal, runtimeTask);
    assertReadOnlyPlan(plan, turn);
    assertTraceIdentity(trace, runtimeTask.planId);
    const binding = TaskCapabilityBindingSchema.parse(bindingValue);
    if (
      binding.bindingHash !== saved.capabilityBindingHash ||
      binding.taskId !== saved.taskId ||
      binding.requestedCapabilityId !== saved.capabilityId ||
      binding.exposureId !== saved.exposureId ||
      canonical(binding.initialImplementationRefs) !== canonical([`skill:${saved.skillId}:1`])
    )
      fail('A2A_RESTART_BINDING_NOT_RECOVERED', 'Capability binding was not recovered.');
    if (record(taskProjection, 'A2A_RESTART_TASK_PROJECTION_INVALID')['taskId'] !== saved.taskId)
      fail('A2A_RESTART_TASK_PROJECTION_DRIFT', 'Node Control Task projection was not recovered.');
    assertMcpInvocations(invocations, turn, output);
    const modelStages = assertModelInvocations(models);
    const eventCount = CollectionSchema.parse(events).items.length;
    if (eventCount === 0)
      fail('A2A_RESTART_TASK_EVENTS_MISSING', 'The recovered Task has no observable events.');
    assertNoWriteOperations({ plan, trace, invocations });
    recovered.push(
      Object.freeze({
        kind: turn.kind,
        taskId: saved.taskId,
        contextId: saved.contextId,
        goalId: saved.goalId,
        goalVersion: saved.goalVersion,
        planId: saved.planId,
        capabilityId: saved.capabilityId,
        capabilityVersion: 1,
        exposureId: saved.exposureId,
        exposureVersion: 1,
        skillId: saved.skillId,
        skillVersion: 1,
        serverId: saved.serverId,
        operationName: saved.operationName,
        resourceId: saved.resourceId,
        state: sanitizeState(output, turn),
        a2aTaskHash: saved.a2aTaskHash,
        structuredOutcomeHash: saved.structuredOutcomeHash,
        capabilityBindingHash: saved.capabilityBindingHash,
        eventCount,
        modelStages,
        evidenceQueries: Object.freeze([
          'a2a.getTask.after-restart',
          'runtime.task.after-restart',
          'runtime.task-understanding.after-restart',
          'runtime.goal.after-restart',
          'runtime.plan.after-restart',
          'runtime.trace.after-restart',
          'runtime.events.after-restart',
          'runtime.mcp-invocations.after-restart',
          'runtime.model-invocations.after-restart',
          'node-control.task.after-restart',
          'node-control.capability-binding.after-restart',
        ]),
      }),
    );
  }
  return buildReport({
    mode: 'verify-restart',
    observedAt,
    contextId: checkpoint.contextId,
    turns: recovered,
    configuredProviderCount: modelAuthority.configuredProviderCount,
    restartRecoveryVerified: true,
    writeGateObserved,
  });
}

function assertGoal(goal: unknown, task: z.infer<typeof RuntimeTaskSchema>): void {
  const value = record(goal, 'A2A_GOAL_INVALID');
  if (
    value['goalId'] !== task.goalId ||
    value['contextId'] !== task.contextId ||
    value['version'] !== task.goalVersion ||
    (value['status'] !== 'active' && value['status'] !== 'achieved')
  ) {
    fail('A2A_GOAL_LINK_INVALID', 'The A2A Task and Goal linkage is not queryable or exact.');
  }
}

function assertTaskUnderstanding(
  understanding: unknown,
  task: z.infer<typeof RuntimeTaskSchema>,
  turn: HomeLabA2AReadOnlyTurn,
): void {
  const value = record(understanding, 'A2A_TASK_UNDERSTANDING_INVALID');
  const requirements = records(value['capabilityRequirements'] ?? []);
  if (
    value['taskId'] !== task.taskId ||
    value['disposition'] !== 'contract_candidate' ||
    typeof value['modelInvocationId'] !== 'string' ||
    !requirements.some(
      (requirement) =>
        requirement['capabilityId'] === turn.capabilityId &&
        requirement['required'] === true &&
        requirement['available'] === true,
    )
  ) {
    fail(
      'A2A_TASK_UNDERSTANDING_MISMATCH',
      'Task Understanding does not identify the exact available read-only Capability.',
    );
  }
}

function assertAcceptableCognitiveReview(task: Task): void {
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
  ) {
    fail(
      'A2A_COGNITIVE_REVIEW_NOT_ACCEPTABLE',
      'The fixed query may accept only a complete Goal or plan review; it never invents missing input.',
    );
  }
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

export function assertMcpInvocations(
  value: unknown,
  turn: HomeLabA2AReadOnlyTurn,
  output: unknown,
): void {
  const items = records(CollectionSchema.parse(value).items);
  const exact = items.filter(
    (item) => item['serverId'] === turn.serverId && item['toolName'] === turn.toolName,
  );
  const invocation = exact[0];
  if (
    items.length !== 1 ||
    exact.length !== 1 ||
    invocation?.['status'] !== 'succeeded' ||
    invocation['executionMode'] !== 'live'
  ) {
    fail('A2A_MCP_INVOCATION_INVALID', 'Expected exactly one successful read-only MCP invocation.');
  }
  const semantics = record(invocation['executionSemantics'], 'A2A_MCP_EXECUTION_SEMANTICS_MISSING');
  const argumentsValue = record(invocation['arguments'], 'A2A_MCP_ARGUMENTS_INVALID');
  const result = record(invocation['result'], 'A2A_MCP_RESULT_INVALID');
  const evidence = records(result['evidence'] ?? []);
  if (
    semantics['effect'] !== 'read_only' ||
    canonical(argumentsValue) !== canonical({ resourceId: turn.resourceId }) ||
    result['isError'] !== false ||
    canonical(result['structuredContent']) !== canonical(output) ||
    evidence.length === 0 ||
    evidence.some((item) => !validProviderEvidence(item))
  ) {
    fail(
      'A2A_MCP_EVIDENCE_INVALID',
      'The MCP invocation lacks exact read-only Provider result and evidence lineage.',
    );
  }
  assertNoWriteOperations(invocation);
  assertSafeJson({ arguments: argumentsValue, result });
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

function assertModelInvocations(value: unknown): readonly string[] {
  const items = records(CollectionSchema.parse(value).items);
  if (items.length === 0)
    fail('A2A_MODEL_EVIDENCE_MISSING', 'The A2A Task has no observable Model invocation evidence.');
  if (items.some((item) => item['status'] !== 'succeeded'))
    fail('A2A_MODEL_INVOCATION_FAILED', 'The A2A Task contains a failed Model invocation.');
  const stages = [
    ...new Set(items.map((item) => text(item['stage'], 'A2A_MODEL_STAGE_INVALID'))),
  ].sort();
  if (REQUIRED_MODEL_STAGES.some((stage) => !stages.includes(stage)))
    fail(
      'A2A_MODEL_EVIDENCE_INCOMPLETE',
      'Observable Model evidence does not cover the full G08 cognitive path.',
    );
  return Object.freeze(stages);
}

function assertAgentCard(value: unknown, turns: readonly HomeLabA2AReadOnlyTurn[]): void {
  const skills = records(record(value, 'A2A_AGENT_CARD_INVALID')['skills'] ?? []);
  for (const turn of turns) {
    if (!skills.some((skill) => skill['id'] === turn.agentSkillId))
      fail(
        'A2A_AGENT_CARD_EXPOSURE_MISSING',
        'The Agent Card lacks a required read-only Exposure.',
      );
  }
  assertNoWriteOperations(skills);
  assertSafeJson(value);
}

function a2aTaskSnapshot(task: Task, turn: HomeLabA2AReadOnlyTurn) {
  const metadata: unknown = task.metadata;
  return Object.freeze({
    id: task.id,
    contextId: task.contextId,
    state: task.status?.state,
    internalPhase: isRecord(metadata) ? metadata['internalPhase'] : undefined,
    outputHash: sha256(canonical(structuredOutcome(task, turn))),
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
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, pollIntervalMs));
  }
  fail('A2A_TASK_TIMEOUT', 'The read-only A2A Task did not reach a terminal state in time.');
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
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, pollIntervalMs));
  }
  fail('A2A_TASK_TIMEOUT', 'The read-only A2A Task did not reach a response boundary in time.');
}

function buildReport(
  input: Readonly<{
    mode: HomeLabA2AReadOnlyReport['mode'];
    observedAt: string;
    contextId: string;
    turns: readonly HomeLabA2ATurnReport[];
    configuredProviderCount: number;
    restartRecoveryVerified: boolean;
    writeGateObserved: 'closed' | 'open_but_unused';
  }>,
): HomeLabA2AReadOnlyReport {
  const failedInvocationCount = input.turns.reduce(
    (total, turn) => total + (turn.modelStages.length === 0 ? 1 : 0),
    0,
  );
  const report: HomeLabA2AReadOnlyReport = Object.freeze({
    schemaVersion: 'sdar.home-lab-a2a-read-only/v1',
    status: 'passed',
    mode: input.mode,
    observedAt: input.observedAt,
    a2aReadOnlyReady: true,
    restartRecoveryVerified: input.restartRecoveryVerified,
    contextId: input.contextId,
    turns: Object.freeze([...input.turns]),
    modelAuthority: Object.freeze({
      requiredStages: REQUIRED_MODEL_STAGES,
      configuredProviderCount: input.configuredProviderCount,
      failedInvocationCount,
    }),
    safety: Object.freeze({
      allowedCapabilities: Object.freeze(input.turns.map((turn) => turn.capabilityId)),
      allowedOperations: Object.freeze(input.turns.map((turn) => turn.operationName)),
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

function sanitizeState(value: unknown, turn: HomeLabA2AReadOnlyTurn) {
  const output = record(value, 'A2A_STRUCTURED_STATE_INVALID');
  const base: Record<string, unknown> = {
    resourceId: output['resourceId'],
    power: output['power'],
    reachable: output['reachable'],
    observedAt: output['observedAt'],
  };
  if (turn.kind === 'light') base['brightnessPercent'] = output['brightnessPercent'];
  else {
    base['hvacMode'] = output['hvacMode'];
    base['currentTemperature'] = output['currentTemperature'];
    base['targetTemperature'] = output['targetTemperature'];
    base['temperatureUnit'] = output['temperatureUnit'];
  }
  return Object.freeze(base);
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

export function validateTurns(
  turns: readonly HomeLabA2AReadOnlyTurn[],
): readonly HomeLabA2AReadOnlyTurn[] {
  if (turns.length !== HOME_LAB_A2A_READ_ONLY_TURNS.length)
    fail('A2A_SCENARIO_NOT_EXACT', 'G08 requires exactly the light and climate read-only turns.');
  for (const [index, expected] of HOME_LAB_A2A_READ_ONLY_TURNS.entries()) {
    const actual = turns[index];
    if (actual === undefined || canonical(actual) !== canonical(expected))
      fail(
        'A2A_WRITE_INTENT_FORBIDDEN',
        'The G08 scenario cannot replace a fixed read-only Capability or operation.',
      );
  }
  assertNoWriteOperations(turns);
  return Object.freeze(turns.map((turn) => Object.freeze({ ...turn })));
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
  ) {
    fail(code, 'The integration driver accepts only credential-free loopback HTTP URLs.');
  }
  return url.origin;
}

async function createClient(
  baseUrl: string,
  factory: DriverDependencies['createA2AClient'],
): Promise<A2AClient> {
  return factory === undefined ? new ClientFactory().createFromUrl(baseUrl) : factory(baseUrl);
}

async function publicGet(baseUrl: string, path: string, request: typeof fetch): Promise<unknown> {
  const response = await request(`${baseUrl}${path}`, { redirect: 'manual' });
  return responseJson(response, 200);
}

async function runtimeGet(
  configuration: ValidatedConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  const response = await request(`${configuration.runtimeManagementBaseUrl}${path}`, {
    redirect: 'manual',
  });
  return responseJson(response, 200);
}

async function controlGet(
  configuration: ValidatedConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  const response = await controlResponse(configuration, path, { method: 'GET' }, request);
  return responseJson(response, 200);
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
  const response = await controlResponse(
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
  );
  return responseJson(response, expectedStatus);
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
      // Error payloads are deliberately not reflected to avoid leaking endpoints or credentials.
    }
    fail(
      'A2A_HTTP_REQUEST_REJECTED',
      `A required public API request failed with ${code} and status ${String(response.status)}.`,
    );
  }
  return response.json();
}

async function writeCheckpoint(file: string, checkpoint: HomeLabA2ACheckpoint): Promise<void> {
  assertSafeJson(checkpoint);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, file);
}

function providerBindingFor(turn: HomeLabA2AReadOnlyTurn): string {
  return turn.kind === 'light' ? 'mcp-binding-ha-light-lab' : 'mcp-binding-ha-climate-lab';
}

function stableKey(runId: string, operation: string): string {
  return `g08-${sha256(`${runId}:${operation}`).slice(0, 40)}`;
}

function sanitizeErrorCode(error: unknown): string {
  return error instanceof HomeLabA2AReadOnlyError ? error.code : 'A2A_DRIVER_FAILED';
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
      `${JSON.stringify({ status: 'failed', code: sanitizeErrorCode(error) })}\n`,
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
