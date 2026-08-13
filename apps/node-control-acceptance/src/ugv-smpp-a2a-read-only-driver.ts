import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SendMessageRequest, TaskState, type Task } from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import { z } from 'zod';

import type { McpToolExecutionSemantics } from '../../../packages/domain/src/index.js';
import {
  a2aExposureEtag,
  createA2aExposureVersion,
  type A2aExposureVersion,
  type JsonObject,
} from '../../../packages/node-control-domain/src/index.js';
import {
  assertSafeRedactedJson,
  bearer,
  canonical,
  deriveUgvReadOnlyTargets,
  loadUgvReadOnlyAuthority,
  loadUgvReadOnlyGovernanceAuthority,
  object,
  objects,
  requestJson,
  safeManagementBaseUrl,
  sha256Json,
  stableIdentifier,
  strings,
  validTimestamp,
  writeRedactedUgvReport,
  type UgvReadOnlyAuthorityConfiguration,
  type UgvReadOnlyAuthoritySnapshot,
  type UgvReadOnlyGovernanceAuthority,
  type UgvReadOnlyTarget,
} from './ugv-smpp-read-only-authority.js';
import {
  UGV_EMBEDDING_MODEL_STAGES,
  UGV_REQUIRED_MODEL_ROUTES,
  UGV_STRUCTURED_MODEL_STAGES,
  UgvModelStageConformanceSchema,
  type UgvModelStageConformanceReport,
} from './ugv-smpp-model-stage-conformance-contract.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const TERMINAL_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
const A2A_OPERATION_SET = new Set(['vehicle_get_state', 'vehicle_get_capabilities']);
const REQUIRED_TASK_MODEL_STAGES = Object.freeze([
  'task_understanding',
  'goal_contract_generation',
  'goal_planning',
  'skill_input_resolution',
  'workflow_planning',
  'result_processing',
  'goal_evaluation',
] as const);
const FORBIDDEN_TOOL_NAME =
  /(?:^|_)(?:set|write|navigate|recon|track|control|stop|fire|weapon|shoot|move|turn)(?:_|$)/iu;

type ModelApiStyle = 'openai_chat_completions' | 'anthropic_messages';

export interface UgvA2AReadOnlyConfiguration extends UgvReadOnlyAuthorityConfiguration {
  readonly a2aBaseUrl: string;
  readonly governanceReportFile: string;
  readonly modelConformanceReportFile: string;
  readonly modelProviderId: string;
  readonly modelBaseUrl: string;
  readonly modelName: string;
  readonly modelApiStyle: ModelApiStyle;
  readonly runId: string;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export interface UgvA2APendingReport {
  readonly schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1';
  readonly status: 'pending';
  readonly evidenceClass: 'unverified';
  readonly observedAt: string;
  readonly reasonCode:
    | 'UGV_REAL_MODEL_REQUIRED'
    | 'UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE'
    | 'UGV_MODEL_STAGE_CONFORMANCE_REQUIRED';
  readonly missingConfiguration: readonly string[];
  readonly a2aReadOnlyReady: false;
  readonly externalOperations: Readonly<{
    a2aRequests: 0;
    mcpCalls: 0;
    physicalWrites: 0;
  }>;
  readonly redaction: Readonly<{ secretsIncluded: false; endpointsIncluded: false }>;
}

export interface UgvA2AReadOnlyReport {
  readonly schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1';
  readonly status: 'passed';
  readonly evidenceClass: 'real_a2a_real_model_real_sdar_live_external_smpp';
  readonly observedAt: string;
  readonly a2aReadOnlyReady: true;
  readonly modelAuthority: Readonly<{
    providerId: string;
    model: string;
    apiStyle: ModelApiStyle;
    embeddingProviderId: string;
    embeddingModel: string;
    routeStages: readonly string[];
    correctionPathVerified: true;
    fixtureAuthorityUsed: false;
  }>;
  readonly scenarios: readonly UgvA2AScenarioReport[];
  readonly safety: Readonly<{
    physicalWrites: 0;
    onlyExplicitReadOnlyTools: true;
    writeOrUnknownOperationsInvoked: 0;
    fireExecution: 'forbidden';
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    downstreamDeviceIdsIncluded: false;
  }>;
}

export interface UgvA2AFailedReport {
  readonly schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1';
  readonly status: 'failed';
  readonly evidenceClass: 'real_a2a_attempt_failed';
  readonly observedAt: string;
  readonly reasonCode: string;
  readonly a2aReadOnlyReady: false;
  readonly execution?: Readonly<{
    taskId: string;
    operationName: string;
    mcpCalls: number;
    physicalWrites: 0;
  }>;
  readonly redaction: Readonly<{ secretsIncluded: false; endpointsIncluded: false }>;
}

export interface UgvA2AScenarioReport {
  readonly operationName: 'vehicle_get_state' | 'vehicle_get_capabilities';
  readonly a2aTaskId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly userGoalPlanId: string;
  readonly workflowPlanId: string;
  readonly workflowInstanceId: string;
  readonly terminalOutcomeId: string;
  readonly capabilityAttemptId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly capabilityBindingId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly exposureId: string;
  readonly exposureVersion: number;
  readonly mcpInvocationId: string;
  readonly resourceId: string;
  readonly providerBinding: Readonly<{
    bindingId: string;
    revision: number;
    providerId: string;
    localServerId: string;
  }>;
  readonly smppLineage: Readonly<{
    smppSourceId: string;
    externalProviderId: string;
    externalServerId: string;
    registryRevision: number;
    registryChecksum: string;
    nativeRevision: number;
    nativeChecksum: string;
    projectionContract: 'sdar-registry-v1';
  }>;
  readonly catalog: Readonly<{
    revision: string;
    checksum: string;
    operationCount: number;
    schemaAlignment: true;
    semantics: 'explicit_read_only_synchronous';
  }>;
  readonly modelStages: readonly string[];
  readonly promptVersions: readonly Readonly<{
    stage: string;
    promptId: string;
    promptVersion: number;
  }>[];
  readonly structuredOutcomeSha256: string;
  readonly providerEvidenceCount: number;
  readonly a2aGetTaskReplayVerified: true;
  readonly planReviewedBeforeConfirmation: boolean;
  readonly remoteTaskCount: 0;
}

export type UgvA2AQualificationReport =
  UgvA2APendingReport | UgvA2AFailedReport | UgvA2AReadOnlyReport;

export class UgvA2AReadOnlyError extends Error {
  readonly code: string;
  readonly execution:
    | Readonly<{ taskId: string; operationName: string; mcpCalls: number; physicalWrites: 0 }>
    | undefined;

  constructor(
    code: string,
    message: string,
    execution?: Readonly<{
      taskId: string;
      operationName: string;
      mcpCalls: number;
      physicalWrites: 0;
    }>,
  ) {
    super(message);
    this.name = 'UgvA2AReadOnlyError';
    this.code = code;
    this.execution = execution;
  }
}

type A2AClient = Pick<Client, 'sendMessage' | 'getTask'>;

interface DriverDependencies {
  readonly fetch?: typeof fetch;
  readonly createA2AClient?: (baseUrl: string) => Promise<A2AClient>;
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly delay?: (milliseconds: number) => Promise<void>;
  /** Unit-fixture seams only; the CLI always loads persisted S5/S8 reports. */
  readonly governanceAuthority?: UgvReadOnlyGovernanceAuthority;
  readonly modelConformance?: UgvModelStageConformanceReport;
}

const ProviderSchema = z
  .object({
    providerId: z.string().min(1),
    kind: z.enum(['openai_compatible', 'local', 'other_vendor']),
    apiStyle: z.enum(['openai_chat_completions', 'anthropic_messages']),
    baseUrl: z.url(),
    model: z.string().min(1),
    enabled: z.boolean(),
    timeoutMs: z.number().int().positive(),
  })
  .loose();
const RouteSchema = z
  .object({
    stage: z.string().min(1),
    operation: z.enum(['structured_generation', 'embedding']),
    providerId: z.string().min(1),
  })
  .loose();
const PromptSchema = z
  .object({
    item: z
      .object({
        promptId: z.string().min(1),
        stage: z.string().min(1),
        version: z.number().int().positive(),
        status: z.literal('enabled'),
      })
      .loose(),
  })
  .strict();
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
    status: z.literal('published'),
    exposureHash: z.string().regex(CHECKSUM),
  })
  .loose();
const ExposureAnyStatusSchema = ExposureSchema.extend({
  status: z.enum(['draft', 'published', 'suspended', 'retired']),
});
const ExposureListSchema = z.object({ items: z.array(ExposureAnyStatusSchema) }).loose();
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
    output: z.object({ text: z.string(), structured: z.unknown() }),
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
    inputSnapshot: z.unknown(),
    successCriteriaSnapshot: z.array(z.record(z.string(), z.unknown())),
    evidenceRequirementSnapshot: z.array(z.record(z.string(), z.unknown())),
    constraintSnapshot: z.array(z.record(z.string(), z.unknown())),
    initialImplementationRefs: z.array(z.string()),
    providerPolicySnapshot: z.record(z.string(), z.unknown()),
    bindingHash: z.string().regex(CHECKSUM),
  })
  .loose();
const InvocationSchema = z
  .object({
    invocationId: z.string().min(1),
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    capabilityAttemptId: z.string().min(1),
    executionMode: z.literal('live'),
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    executionSemantics: z.record(z.string(), z.unknown()),
    arguments: z.record(z.string(), z.unknown()),
    result: z
      .object({
        structuredContent: z.unknown(),
        isError: z.literal(false),
        evidence: z.array(z.record(z.string(), z.unknown())),
      })
      .loose(),
    status: z.literal('succeeded'),
  })
  .loose();
const ModelInvocationSchema = z
  .object({
    invocationId: z.string().min(1),
    taskId: z.string().min(1),
    stage: z.string().min(1),
    providerId: z.string().min(1),
    model: z.string().min(1),
    operation: z.enum(['structured_generation', 'embedding']),
    promptId: z.string().optional(),
    promptVersion: z.number().int().positive().optional(),
    structuredResult: z.unknown().optional(),
    durationMs: z.number().nonnegative(),
    status: z.literal('succeeded'),
  })
  .loose();
export async function executeUgvA2AReadOnly(
  input: UgvA2AReadOnlyConfiguration,
  dependencies: DriverDependencies = {},
): Promise<UgvA2AReadOnlyReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const observedAt = validTimestamp(dependencies.now?.() ?? new Date().toISOString());
  const governance =
    dependencies.governanceAuthority ??
    (await loadUgvReadOnlyGovernanceAuthority(configuration.governanceReportFile));
  const conformance =
    dependencies.modelConformance ??
    (await loadModelConformance(configuration.modelConformanceReportFile));
  assertModelConformance(conformance, configuration);
  const targets = deriveUgvReadOnlyTargets(governance).filter((target) =>
    A2A_OPERATION_SET.has(target.toolName),
  );
  if (!targets.some((target) => target.toolName === 'vehicle_get_state'))
    fail('UGV_A2A_READ_STATE_REQUIRED', 'A2A qualification requires vehicle_get_state.');
  const authorities = await Promise.all(
    targets.map((target) =>
      loadUgvReadOnlyAuthority(configuration, governance, target, observedAt, request),
    ),
  );
  const model = await preflightModelAuthority(configuration, conformance, request);
  const exposures = [];
  for (const authority of authorities)
    exposures.push(await ensureExposure(configuration, authority, request));
  await rebuildAgentCard(configuration, request);
  const agentCard = await publicGet(
    configuration.a2aBaseUrl,
    '/.well-known/agent-card.json',
    request,
  );
  exposures.forEach((exposure) => {
    assertAgentCardExposure(agentCard, exposure.agentSkillId);
  });
  const client = await createClient(configuration.a2aBaseUrl, dependencies.createA2AClient);
  const scenarios: UgvA2AScenarioReport[] = [];
  for (let index = 0; index < authorities.length; index += 1) {
    const authority = authorities[index];
    const exposure = exposures[index];
    if (authority === undefined || exposure === undefined)
      fail('UGV_A2A_SCENARIO_AUTHORITY_MISSING', 'A2A scenario authority is incomplete.');
    scenarios.push(
      await executeScenario(configuration, authority, exposure, client, request, dependencies),
    );
  }
  const report: UgvA2AReadOnlyReport = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1',
    status: 'passed',
    evidenceClass: 'real_a2a_real_model_real_sdar_live_external_smpp',
    observedAt,
    a2aReadOnlyReady: true,
    modelAuthority: Object.freeze({
      providerId: model.providerId,
      model: model.model,
      apiStyle: model.apiStyle,
      embeddingProviderId: conformance.embeddingPrerequisite.provider.providerId,
      embeddingModel: conformance.embeddingPrerequisite.provider.model,
      routeStages: UGV_REQUIRED_MODEL_ROUTES,
      correctionPathVerified: true,
      fixtureAuthorityUsed: false,
    }),
    scenarios: Object.freeze(scenarios),
    safety: Object.freeze({
      physicalWrites: 0,
      onlyExplicitReadOnlyTools: true,
      writeOrUnknownOperationsInvoked: 0,
      fireExecution: 'forbidden',
    }),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: false,
    }),
  });
  assertSafeRedactedJson(report);
  return report;
}

export function pendingUgvA2AReport(
  reasonCode: UgvA2APendingReport['reasonCode'],
  missingConfiguration: readonly string[],
  observedAt: string,
): UgvA2APendingReport {
  const report: UgvA2APendingReport = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1',
    status: 'pending',
    evidenceClass: 'unverified',
    observedAt: validTimestamp(observedAt),
    reasonCode,
    missingConfiguration: Object.freeze([...new Set(missingConfiguration)].sort()),
    a2aReadOnlyReady: false,
    externalOperations: Object.freeze({ a2aRequests: 0, mcpCalls: 0, physicalWrites: 0 }),
    redaction: Object.freeze({ secretsIncluded: false, endpointsIncluded: false }),
  });
  assertSafeRedactedJson(report);
  return report;
}

export function ugvA2APendingFromEnvironment(
  environment: NodeJS.ProcessEnv,
  observedAt: string,
): UgvA2APendingReport | undefined {
  if (environment['SDAR_UGV_REAL_MODEL_ENABLED']?.trim() !== 'YES')
    return pendingUgvA2AReport(
      'UGV_REAL_MODEL_REQUIRED',
      ['SDAR_UGV_REAL_MODEL_ENABLED'],
      observedAt,
    );
  const required = [
    'SDAR_UGV_MODEL_PROVIDER_ID',
    'SDAR_UGV_MODEL_BASE_URL',
    'SDAR_UGV_MODEL_NAME',
    'SDAR_UGV_MODEL_API_STYLE',
  ];
  const missing = required.filter((name) => (environment[name]?.trim() ?? '') === '');
  const inlineKey = environment['SDAR_UGV_MODEL_API_KEY']?.trim() ?? '';
  const keyFile = environment['SDAR_UGV_MODEL_API_KEY_FILE']?.trim() ?? '';
  if ((inlineKey === '') === (keyFile === ''))
    missing.push('SDAR_UGV_MODEL_API_KEY|SDAR_UGV_MODEL_API_KEY_FILE');
  const apiStyle = environment['SDAR_UGV_MODEL_API_STYLE']?.trim();
  if (!['openai_chat_completions', 'anthropic_messages'].includes(apiStyle ?? ''))
    missing.push('SDAR_UGV_MODEL_API_STYLE:supported_value');
  if (missing.length > 0)
    return pendingUgvA2AReport('UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE', missing, observedAt);
  const conformanceFile = environment['SDAR_UGV_MODEL_CONFORMANCE_REPORT_FILE']?.trim() ?? '';
  if (conformanceFile === '')
    return pendingUgvA2AReport(
      'UGV_MODEL_STAGE_CONFORMANCE_REQUIRED',
      ['SDAR_UGV_MODEL_CONFORMANCE_REPORT_FILE'],
      observedAt,
    );
  return undefined;
}

async function executeScenario(
  configuration: UgvA2AReadOnlyConfiguration,
  authority: UgvReadOnlyAuthoritySnapshot,
  exposure: z.infer<typeof ExposureSchema>,
  client: A2AClient,
  request: typeof fetch,
  dependencies: DriverDependencies,
): Promise<UgvA2AScenarioReport> {
  const randomId = dependencies.randomId ?? randomUUID;
  const submitted = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `ugv-a2a-read-${randomId()}`,
        role: 'ROLE_USER',
        parts: [
          { text: authority.target.requestText, mediaType: 'text/plain' },
          { data: { resourceId: authority.target.resourceId }, mediaType: 'application/json' },
        ],
        metadata: {
          user_id: 'ugv-a2a-read-only',
          structured_input: { resourceId: authority.target.resourceId },
          'io.sdar/requestedCapability': {
            exposureId: exposure.exposureId,
            versionConstraint: String(exposure.version),
            requestId: `${configuration.runId}:${authority.target.toolName}`,
          },
        },
      },
      configuration: { returnImmediately: false },
    }),
  );
  if (!('id' in submitted)) fail('UGV_A2A_TASK_EXPECTED', 'A2A returned a Message, not a Task.');
  let task = submitted;
  if (
    task.status?.state === undefined ||
    (task.status.state !== TaskState.TASK_STATE_INPUT_REQUIRED &&
      !TERMINAL_STATES.has(task.status.state))
  )
    task = await pollBoundary(client, task.id, configuration, dependencies);
  let planReviewedBeforeConfirmation = false;
  for (
    let interruption = 0;
    task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED;
    interruption += 1
  ) {
    if (interruption >= 6)
      fail('UGV_A2A_INPUT_LOOP_EXCEEDED', 'A2A exceeded bounded cognitive review rounds.');
    const runtimeTask = await runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}`,
      request,
    );
    const phase = text(object(runtimeTask)?.['phase'], 'UGV_A2A_RUNTIME_TASK_INVALID');
    await assertNoMcpInvocations(configuration, task.id, request);
    if (phase === 'awaiting_plan_confirmation') {
      const planId = text(object(runtimeTask)?.['planId'], 'UGV_A2A_PLAN_ID_MISSING');
      const plan = await runtimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(planId)}`,
        request,
      );
      assertUgvSingleReadOnlyPlan(plan, authority);
      planReviewedBeforeConfirmation = true;
      task = await continueTask(
        client,
        task,
        randomId,
        'confirm_plan',
        '确认执行只读无人车查询计划。',
        undefined,
        configuration,
        dependencies,
      );
      continue;
    }
    if (phase !== 'awaiting_user_input')
      fail('UGV_A2A_UNEXPECTED_INPUT_REQUIRED', 'A2A requested unsupported supplementary input.');
    assertReviewAcceptable(task);
    task = await continueTask(
      client,
      task,
      randomId,
      'provide_input',
      '接受当前只读 Goal/Plan。',
      { action: 'accept', payload: {} },
      configuration,
      dependencies,
    );
  }
  if (task.status?.state === undefined || !TERMINAL_STATES.has(task.status.state))
    task = await pollTerminal(client, task.id, configuration, dependencies);
  if (task.status?.state !== TaskState.TASK_STATE_COMPLETED) {
    const mcpCalls = await assertNoWriteInvocation(configuration, task.id, request);
    throw new UgvA2AReadOnlyError(
      'UGV_A2A_TASK_NOT_COMPLETED',
      'A2A read-only Task did not complete successfully.',
      Object.freeze({
        taskId: task.id,
        operationName: authority.target.toolName,
        mcpCalls,
        physicalWrites: 0,
      }),
    );
  }
  const first = await client.getTask({ tenant: '', id: task.id });
  const second = await client.getTask({ tenant: '', id: task.id });
  if (canonical(a2aTaskSnapshot(first)) !== canonical(a2aTaskSnapshot(second)))
    fail('UGV_A2A_GET_TASK_REPLAY_DRIFT', 'Repeated A2A getTask returned different facts.');
  return collectScenarioEvidence(
    configuration,
    authority,
    exposure,
    second,
    request,
    planReviewedBeforeConfirmation,
    dependencies.now,
  );
}

async function collectScenarioEvidence(
  configuration: UgvA2AReadOnlyConfiguration,
  authority: UgvReadOnlyAuthoritySnapshot,
  exposure: z.infer<typeof ExposureSchema>,
  task: Task,
  request: typeof fetch,
  planReviewedBeforeConfirmation: boolean,
  now?: () => string,
): Promise<UgvA2AScenarioReport> {
  const outcome = structuredA2AOutcome(task, authority.target.resourceId);
  const runtimeTask = RuntimeTaskSchema.parse(
    await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
  );
  if (
    runtimeTask.contextId !== task.contextId ||
    runtimeTask.phase !== 'completed' ||
    runtimeTask.selectedSkillId !== authority.target.skillId ||
    runtimeTask.selectedSkillVersion !== authority.target.skillVersion ||
    canonical(runtimeTask.output.structured) !== canonical(outcome)
  )
    fail('UGV_A2A_RUNTIME_TASK_MISMATCH', 'A2A and Runtime Task authority differ.');
  await loadUgvReadOnlyAuthority(
    configuration,
    governanceForAuthority(authority),
    authority.target,
    validTimestamp(now?.() ?? new Date().toISOString()),
    request,
  );
  const terminalOutcomeId = `terminal-outcome-task-${task.id}`;
  const [
    understanding,
    goal,
    userGoalPlanValue,
    plan,
    trace,
    skillExecutionsValue,
    resolutionsValue,
    bindingValue,
    taskProjection,
    invocationsValue,
    modelsValue,
    terminalOutcomeValue,
    remoteValue,
  ] = await Promise.all([
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/understanding`,
      request,
    ),
    runtimeGet(configuration, `/api/v1/goals/${encodeURIComponent(runtimeTask.goalId)}`, request),
    runtimeGet(
      configuration,
      `/api/v1/goals/${encodeURIComponent(runtimeTask.goalId)}/user-goal-plan?goalVersion=${String(runtimeTask.goalVersion)}`,
      request,
    ),
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
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/skill-executions`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/skill-input-resolutions`,
      request,
    ),
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
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/remote-task-lifecycle`,
      request,
    ),
  ]);
  assertUnderstanding(understanding, task.id, authority.target);
  assertGoal(goal, runtimeTask);
  const userGoalPlanId = assertUserGoalPlan(userGoalPlanValue, runtimeTask, authority.target);
  assertUgvSingleReadOnlyPlan(plan, authority);
  const workflowInstanceId = assertTrace(trace, runtimeTask, outcome, authority.target);
  assertSkillExecution(skillExecutionsValue, runtimeTask, authority.target);
  assertInputResolution(resolutionsValue, runtimeTask, authority.target);
  const binding = TaskCapabilityBindingSchema.parse(bindingValue);
  const capabilityAttemptId = `capability-attempt-${task.id}-1`;
  assertTaskCapabilityBinding(binding, task.id, exposure.exposureId, exposure.version, authority);
  if (object(taskProjection)?.['taskId'] !== task.id)
    fail('UGV_A2A_NODE_CONTROL_TASK_MISSING', 'Node Control cannot query the A2A Task.');
  const invocation = assertMcpInvocation(
    invocationsValue,
    task,
    capabilityAttemptId,
    outcome,
    authority,
  );
  const modelEvidence = assertTaskModelInvocations(
    modelsValue,
    task.id,
    configuration.modelProviderId,
    configuration.modelName,
  );
  assertTerminalOutcome(terminalOutcomeValue, terminalOutcomeId, runtimeTask, capabilityAttemptId);
  if (
    z
      .object({ items: z.array(z.unknown()) })
      .loose()
      .parse(remoteValue).items.length !== 0
  )
    fail('UGV_A2A_REMOTE_TASK_UNEXPECTED', 'Synchronous read unexpectedly created a remote Task.');
  return Object.freeze({
    operationName: authority.target.toolName as 'vehicle_get_state' | 'vehicle_get_capabilities',
    a2aTaskId: task.id,
    contextId: task.contextId,
    goalId: runtimeTask.goalId,
    goalVersion: runtimeTask.goalVersion,
    userGoalPlanId,
    workflowPlanId: runtimeTask.planId,
    workflowInstanceId,
    terminalOutcomeId,
    capabilityAttemptId,
    capabilityId: authority.target.capabilityId,
    capabilityVersion: authority.target.capabilityVersion,
    capabilityBindingId: authority.target.capabilityBindingId,
    skillId: authority.target.skillId,
    skillVersion: authority.target.skillVersion,
    exposureId: exposure.exposureId,
    exposureVersion: exposure.version,
    mcpInvocationId: invocation.invocationId,
    resourceId: authority.target.resourceId,
    providerBinding: Object.freeze({
      bindingId: authority.binding.binding.bindingId,
      revision: authority.binding.binding.revision,
      providerId: authority.binding.binding.providerId,
      localServerId: authority.binding.binding.localServerId,
    }),
    smppLineage: Object.freeze({
      smppSourceId: authority.binding.sourceCandidateLineage.smppSourceId,
      externalProviderId: authority.binding.sourceCandidateLineage.externalProviderId,
      externalServerId: authority.binding.sourceCandidateLineage.externalServerId,
      registryRevision: authority.binding.sourceCandidateLineage.registryRevision,
      registryChecksum: authority.binding.sourceCandidateLineage.registryChecksum,
      nativeRevision: authority.binding.sourceCandidateLineage.nativeRevision,
      nativeChecksum: authority.binding.sourceCandidateLineage.nativeChecksum,
      projectionContract: 'sdar-registry-v1',
    }),
    catalog: Object.freeze({
      revision: authority.binding.binding.catalogRevision,
      checksum: authority.binding.binding.catalogChecksum,
      operationCount: authority.binding.binding.operationCount,
      schemaAlignment: true,
      semantics: 'explicit_read_only_synchronous',
    }),
    modelStages: modelEvidence.stages,
    promptVersions: modelEvidence.prompts,
    structuredOutcomeSha256: sha256Json(outcome),
    providerEvidenceCount: invocation.result.evidence.length,
    a2aGetTaskReplayVerified: true,
    planReviewedBeforeConfirmation,
    remoteTaskCount: 0,
  });
}

export function assertUgvSingleReadOnlyPlan(
  value: unknown,
  authority: Readonly<{
    target: Pick<UgvReadOnlyTarget, 'localServerId' | 'toolName'>;
    tool: Readonly<{ executionSemantics: McpToolExecutionSemantics }>;
  }>,
): void {
  const plan = requiredObject(value, 'UGV_A2A_PLAN_INVALID');
  const definition = requiredObject(plan['definition'], 'UGV_A2A_PLAN_DEFINITION_INVALID');
  const nodes = objects(definition['nodes']);
  const mcpNodes = nodes.filter((node) => node['type'] === 'mcp_tool');
  const node = mcpNodes[0];
  const tool = object(node?.['tool']);
  const semantics = objects(plan['toolExecutionSemantics']);
  const exactSemantics = semantics.filter((item) => {
    const reference = object(item['reference']);
    return (
      reference?.['serverId'] === authority.target.localServerId &&
      reference['toolName'] === authority.target.toolName
    );
  });
  const execution = object(exactSemantics[0]?.['executionSemantics']);
  if (
    mcpNodes.length !== 1 ||
    tool?.['serverId'] !== authority.target.localServerId ||
    tool['toolName'] !== authority.target.toolName ||
    exactSemantics.length !== 1 ||
    canonical(execution) !== canonical(authority.tool.executionSemantics) ||
    execution?.['effect'] !== 'read_only' ||
    execution['execution'] !== 'synchronous'
  )
    fail(
      'UGV_A2A_PLAN_NOT_EXACT_READ_ONLY',
      'Plan must contain exactly one MCP node with current explicit read-only semantics.',
    );
  assertNoWriteOrUnknownTool(definition);
}

export function assertTaskModelInvocations(
  value: unknown,
  taskId: string,
  providerId: string,
  model: string,
): Readonly<{
  stages: readonly string[];
  prompts: readonly Readonly<{ stage: string; promptId: string; promptVersion: number }>[];
}> {
  const items = z.object({ items: z.array(ModelInvocationSchema) }).parse(value).items;
  if (
    items.length === 0 ||
    items.some(
      (item) =>
        item.taskId !== taskId ||
        item.providerId !== providerId ||
        item.model !== model ||
        item.operation !== 'structured_generation' ||
        item.structuredResult === undefined ||
        item.promptId === undefined ||
        item.promptVersion === undefined ||
        /home[.-]?lab|fixture|mock/iu.test(`${item.providerId} ${item.model} ${item.promptId}`),
    )
  )
    fail(
      'UGV_A2A_MODEL_INVOCATION_AUTHORITY_INVALID',
      'Task-linked Model evidence is failed, simulated, unprompted, or crosses provider authority.',
    );
  const stages = [...new Set(items.map((item) => item.stage))].sort();
  if (REQUIRED_TASK_MODEL_STAGES.some((stage) => !stages.includes(stage)))
    fail(
      'UGV_A2A_MODEL_STAGE_EVIDENCE_INCOMPLETE',
      'Task-linked Model evidence lacks a required cognitive stage.',
    );
  const prompts = items
    .map((item) => {
      if (item.promptId === undefined || item.promptVersion === undefined)
        return fail(
          'UGV_A2A_MODEL_INVOCATION_AUTHORITY_INVALID',
          'Task-linked structured Model evidence requires a published Prompt version.',
        );
      return { stage: item.stage, promptId: item.promptId, promptVersion: item.promptVersion };
    })
    .sort((left, right) => left.stage.localeCompare(right.stage));
  return Object.freeze({ stages: Object.freeze(stages), prompts: Object.freeze(prompts) });
}

async function preflightModelAuthority(
  configuration: UgvA2AReadOnlyConfiguration,
  conformance: UgvModelStageConformanceReport,
  request: typeof fetch,
): Promise<z.infer<typeof ProviderSchema>> {
  const [providersValue, routesValue, ...promptValues] = await Promise.all([
    runtimeGet(configuration, '/api/v1/models/providers', request),
    runtimeGet(configuration, '/api/v1/models/routes', request),
    ...UGV_STRUCTURED_MODEL_STAGES.map((stage) =>
      runtimeGet(configuration, `/api/v1/prompts/current/${encodeURIComponent(stage)}`, request),
    ),
  ]);
  const providers = z.object({ items: z.array(ProviderSchema) }).parse(providersValue).items;
  const routes = z.object({ items: z.array(RouteSchema) }).parse(routesValue).items;
  const matches = providers.filter(
    (provider) => provider.providerId === configuration.modelProviderId,
  );
  const provider = matches[0];
  if (
    matches.length !== 1 ||
    provider === undefined ||
    !provider.enabled ||
    provider.kind === 'local' ||
    provider.apiStyle !== configuration.modelApiStyle ||
    provider.model !== configuration.modelName ||
    normalizeEndpoint(provider.baseUrl) !== normalizeEndpoint(configuration.modelBaseUrl) ||
    /home[.-]?lab|fixture|mock/iu.test(`${provider.providerId} ${provider.model}`)
  )
    fail(
      'UGV_REAL_MODEL_AUTHORITY_INVALID',
      'Runtime does not expose the exact enabled non-fixture real Model Provider.',
    );
  const embeddingEvidence = conformance.embeddingPrerequisite.provider;
  const embeddingMatches = providers.filter(
    (candidate) => candidate.providerId === embeddingEvidence.providerId,
  );
  const embeddingProvider = embeddingMatches[0];
  if (
    embeddingMatches.length !== 1 ||
    embeddingProvider === undefined ||
    !embeddingProvider.enabled ||
    embeddingProvider.kind === 'local' ||
    embeddingProvider.model !== embeddingEvidence.model ||
    embeddingProvider.apiStyle !== embeddingEvidence.apiStyle ||
    /home[.-]?lab|fixture|mock/iu.test(`${embeddingProvider.providerId} ${embeddingProvider.model}`)
  )
    fail(
      'UGV_REAL_MODEL_EMBEDDING_AUTHORITY_INVALID',
      'Runtime does not expose the embedding Provider proven by conformance.',
    );
  for (const stage of UGV_STRUCTURED_MODEL_STAGES)
    if (
      routes.filter(
        (route) =>
          route.stage === stage &&
          route.operation === 'structured_generation' &&
          route.providerId === provider.providerId,
      ).length !== 1
    )
      fail(
        'UGV_REAL_MODEL_ROUTE_INCOMPLETE',
        'A required structured-generation stage is not exactly routed.',
      );
  for (const stage of UGV_EMBEDDING_MODEL_STAGES)
    if (
      routes.filter(
        (route) =>
          route.stage === stage &&
          route.operation === 'embedding' &&
          route.providerId === embeddingProvider.providerId,
      ).length !== 1
    )
      fail(
        'UGV_REAL_MODEL_EMBEDDING_ROUTE_INCOMPLETE',
        'A required embedding stage is not exactly routed.',
      );
  promptValues.forEach((value, index) => {
    const stage = UGV_STRUCTURED_MODEL_STAGES[index];
    const prompt = PromptSchema.parse(value).item;
    if (
      stage === undefined ||
      prompt.stage !== stage ||
      /home[.-]?lab|fixture|mock/iu.test(prompt.promptId)
    )
      fail('UGV_REAL_MODEL_PROMPT_INVALID', 'A required published Prompt is missing or simulated.');
  });
  return provider;
}

async function ensureExposure(
  configuration: UgvA2AReadOnlyConfiguration,
  authority: UgvReadOnlyAuthoritySnapshot,
  request: typeof fetch,
): Promise<z.infer<typeof ExposureSchema>> {
  const exposureId = exposureIdFor(authority.target.capabilityId);
  const listed = ExposureListSchema.parse(
    await controlGet(configuration, '/api/v1/a2a-exposures?pageSize=1000', request),
  )
    .items.filter((item) => item.exposureId === exposureId)
    .sort((left, right) => right.version - left.version);
  const latest = listed[0];
  const draftFor = (version: number) =>
    createA2aExposureVersion({
      exposureId,
      version,
      capabilityId: authority.target.capabilityId,
      capabilityVersion: authority.target.capabilityVersion,
      agentSkillId: authority.target.capabilityId,
      name: authority.capability.name,
      description: authority.capability.description,
      tags: ['ugv', 'vehicle', 'read-only', authority.target.toolName],
      examples: [authority.target.requestText],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['application/json'],
      requestSchema: jsonObject(authority.capability.inputSchema),
      resultSchema: jsonObject(authority.capability.outputSchema),
      visibility: 'public',
      requesterPolicy: { allowAnonymous: false, allowedRequesterIds: ['ugv-a2a-read-only'] },
      readinessPublicationPolicy: 'publish_when_available',
      status: 'draft',
    });
  const sameCurrentAuthority =
    latest === undefined
      ? undefined
      : latest.exposureHash === draftFor(latest.version).exposureHash;
  const version =
    sameCurrentAuthority === true && latest !== undefined
      ? latest.version
      : (latest?.version ?? 0) + 1;
  const path = `/api/v1/a2a-exposures/${encodeURIComponent(exposureId)}/versions/${String(version)}`;
  const draft = draftFor(version);
  let current: A2aExposureVersion;
  if (sameCurrentAuthority !== true) {
    current = ExposureAnyStatusSchema.parse(
      await controlMutation(
        configuration,
        '/api/v1/a2a-exposures',
        stableKey(configuration.runId, `exposure-create:${exposureId}:${String(version)}`),
        draft,
        request,
        201,
      ),
    ) as A2aExposureVersion;
  } else {
    current = latest as A2aExposureVersion;
  }
  if (current.exposureHash !== draft.exposureHash)
    fail('UGV_A2A_EXPOSURE_DRIFT', 'Existing A2A Exposure differs from Capability authority.');
  if (current.status === 'retired')
    fail('UGV_A2A_EXPOSURE_RETIRED', 'Retired exact-version A2A Exposure cannot be reused.');
  if (current.status !== 'published') {
    const operation = OperationSchema.parse(
      await controlMutation(
        configuration,
        `${path}/publish`,
        stableKey(configuration.runId, `exposure-publish:${exposureId}:${String(version)}`),
        {
          reason: `Publish exact governed read-only UGV Exposure ${exposureId}@${String(version)}.`,
        },
        request,
        202,
        a2aExposureEtag(current),
      ),
    );
    current = ExposureAnyStatusSchema.parse(operation.result) as A2aExposureVersion;
  }
  for (const prior of listed.filter(
    (item) => item.version !== version && item.status === 'published',
  )) {
    await controlMutation(
      configuration,
      `/api/v1/a2a-exposures/${encodeURIComponent(exposureId)}/versions/${String(prior.version)}/suspend`,
      stableKey(configuration.runId, `exposure-suspend:${exposureId}:${String(prior.version)}`),
      {
        reason: `Supersede immutable UGV Exposure ${exposureId}@${String(prior.version)} with version ${String(version)}.`,
      },
      request,
      202,
      a2aExposureEtag(prior as A2aExposureVersion),
    );
  }
  const exposure = ExposureSchema.parse(current);
  if (
    exposure.exposureId !== exposureId ||
    exposure.capabilityId !== authority.target.capabilityId ||
    canonical(exposure.requestSchema) !== canonical(authority.capability.inputSchema) ||
    canonical(exposure.resultSchema) !== canonical(authority.capability.outputSchema)
  )
    fail('UGV_A2A_EXPOSURE_NOT_EXACT', 'Published A2A Exposure differs from Capability authority.');
  return exposure;
}

async function rebuildAgentCard(
  configuration: UgvA2AReadOnlyConfiguration,
  request: typeof fetch,
): Promise<void> {
  const operation = OperationSchema.parse(
    await controlMutation(
      configuration,
      '/api/v1/a2a-agent-card-revisions/rebuild',
      stableKey(configuration.runId, 'agent-card-rebuild'),
      { reason: 'Publish current exact governed UGV read-only Capability exposures.' },
      request,
    ),
  );
  if (object(operation.result)?.['status'] !== 'active')
    fail('UGV_A2A_AGENT_CARD_NOT_ACTIVE', 'Node Control did not activate the exact Agent Card.');
}

async function loadModelConformance(file: string): Promise<UgvModelStageConformanceReport> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
  } catch {
    return fail(
      'UGV_MODEL_STAGE_CONFORMANCE_REQUIRED',
      'The real model stage conformance report is unavailable or invalid.',
    );
  }
  const parsed = UgvModelStageConformanceSchema.safeParse(value);
  if (!parsed.success)
    return fail(
      'UGV_MODEL_STAGE_CONFORMANCE_INVALID',
      'The real model conformance report failed its boundary schema.',
    );
  assertSafeRedactedJson(parsed.data);
  return Object.freeze(parsed.data);
}

function assertModelConformance(
  report: UgvModelStageConformanceReport,
  configuration: UgvA2AReadOnlyConfiguration,
): void {
  if (
    report.provider.providerId !== configuration.modelProviderId ||
    report.provider.model !== configuration.modelName ||
    report.provider.apiStyle !== configuration.modelApiStyle ||
    /home[.-]?lab|fixture|mock/iu.test(`${report.provider.providerId} ${report.provider.model}`) ||
    /home[.-]?lab|fixture|mock/iu.test(
      `${report.embeddingPrerequisite.provider.providerId} ${report.embeddingPrerequisite.provider.model}`,
    ) ||
    UGV_STRUCTURED_MODEL_STAGES.some(
      (stage) => report.stages.filter((item) => item.stage === stage).length !== 1,
    ) ||
    UGV_EMBEDDING_MODEL_STAGES.some(
      (stage) =>
        report.embeddingPrerequisite.stages.filter((item) => item.stage === stage).length !== 1,
    )
  )
    fail(
      'UGV_MODEL_STAGE_CONFORMANCE_INVALID',
      'S8 conformance does not prove every exact real-model stage and correction path.',
    );
}

function assertTaskCapabilityBinding(
  binding: z.infer<typeof TaskCapabilityBindingSchema>,
  taskId: string,
  exposureId: string,
  exposureVersion: number,
  authority: UgvReadOnlyAuthoritySnapshot,
): void {
  if (
    binding.taskId !== taskId ||
    binding.requestedCapabilityId !== authority.target.capabilityId ||
    binding.capabilityVersion !== authority.target.capabilityVersion ||
    binding.exposureId !== exposureId ||
    binding.exposureVersion !== exposureVersion ||
    canonical(binding.inputSnapshot) !== canonical({ resourceId: authority.target.resourceId }) ||
    canonical(binding.successCriteriaSnapshot) !==
      canonical(authority.capability.successCriteria) ||
    canonical(binding.evidenceRequirementSnapshot) !==
      canonical(authority.capability.requiredEvidence) ||
    canonical(binding.constraintSnapshot) !== canonical(authority.capability.constraints) ||
    canonical(binding.initialImplementationRefs) !==
      canonical([`skill:${authority.target.skillId}:${String(authority.target.skillVersion)}`])
  )
    fail(
      'UGV_A2A_CAPABILITY_BINDING_INVALID',
      'Immutable Task Capability binding does not freeze the exact business promise.',
    );
  const current = objects(binding.providerPolicySnapshot['currentProviderBindings']);
  const exact = current.filter((item) => {
    const provider = object(item['binding']);
    const lineage = object(item['sourceCandidateLineage']);
    return (
      provider?.['bindingId'] === authority.binding.binding.bindingId &&
      provider['revision'] === authority.binding.binding.revision &&
      provider['catalogChecksum'] === authority.binding.binding.catalogChecksum &&
      lineage?.['nativeChecksum'] === authority.binding.sourceCandidateLineage.nativeChecksum &&
      lineage['projectionContract'] === 'sdar-registry-v1'
    );
  });
  if (current.length !== 1 || exact.length !== 1)
    fail(
      'UGV_A2A_FROZEN_PROVIDER_BINDING_INVALID',
      'Task admission did not freeze one exact current Binding and SMPP/native lineage.',
    );
}

function assertMcpInvocation(
  value: unknown,
  task: Task,
  capabilityAttemptId: string,
  outcome: unknown,
  authority: UgvReadOnlyAuthoritySnapshot,
): z.infer<typeof InvocationSchema> {
  const items = z.object({ items: z.array(InvocationSchema) }).parse(value).items;
  const invocation = items[0];
  if (
    items.length !== 1 ||
    invocation?.taskId !== task.id ||
    invocation.contextId !== task.contextId ||
    invocation.capabilityAttemptId !== capabilityAttemptId ||
    invocation.serverId !== authority.target.localServerId ||
    invocation.toolName !== authority.target.toolName ||
    FORBIDDEN_TOOL_NAME.test(invocation.toolName) ||
    canonical(invocation.executionSemantics) !== canonical(authority.tool.executionSemantics) ||
    canonical(invocation.arguments) !== canonical({ resourceId: authority.target.resourceId }) ||
    canonical(invocation.result.structuredContent) !== canonical(outcome) ||
    invocation.result.evidence.length === 0 ||
    authority.evidenceTypes.some(
      (type) =>
        invocation.result.evidence.filter(
          (item) =>
            item['evidenceType'] === type &&
            item['subjectRef'] === `resource:${authority.target.resourceId}`,
        ).length !== 1,
    )
  )
    fail(
      'UGV_A2A_MCP_INVOCATION_INVALID',
      'A2A Task lacks one exact live MCP-adapter invocation and Provider evidence.',
    );
  return invocation;
}

function assertUnderstanding(value: unknown, taskId: string, target: UgvReadOnlyTarget): void {
  const understanding = requiredObject(value, 'UGV_A2A_TASK_UNDERSTANDING_INVALID');
  const requirements = objects(understanding['capabilityRequirements']);
  const candidates = objects(understanding['taskTypeCandidates']);
  if (
    understanding['taskId'] !== taskId ||
    understanding['originalRequest'] !== target.requestText ||
    understanding['disposition'] !== 'contract_candidate' ||
    typeof understanding['modelInvocationId'] !== 'string' ||
    requirements.filter(
      (item) =>
        item['capabilityId'] === target.capabilityId &&
        item['required'] === true &&
        item['available'] === true,
    ).length !== 1 ||
    candidates.filter((item) => item['taskTypeId'] === target.taskTypeId && item['version'] === 1)
      .length !== 1
  )
    fail(
      'UGV_A2A_TASK_UNDERSTANDING_INVALID',
      'Managed Task Understanding did not select the exact known vehicle Task Type/Capability.',
    );
  assertNoWriteOrUnknownTool(understanding);
}

function assertGoal(value: unknown, task: z.infer<typeof RuntimeTaskSchema>): void {
  const goal = requiredObject(value, 'UGV_A2A_GOAL_INVALID');
  if (
    goal['goalId'] !== task.goalId ||
    goal['contextId'] !== task.contextId ||
    goal['version'] !== task.goalVersion ||
    !['active', 'achieved'].includes(String(goal['status']))
  )
    fail('UGV_A2A_GOAL_INVALID', 'Task and Goal linkage is not exact.');
  assertNoWriteOrUnknownTool(goal);
}

function assertUserGoalPlan(
  value: unknown,
  task: z.infer<typeof RuntimeTaskSchema>,
  target: UgvReadOnlyTarget,
): string {
  const wrapper = requiredObject(value, 'UGV_A2A_USER_GOAL_PLAN_INVALID');
  const plan = requiredObject(wrapper['plan'] ?? value, 'UGV_A2A_USER_GOAL_PLAN_INVALID');
  const skillGoals = objects(plan['skillGoals']);
  const skillGoal = skillGoals[0];
  if (
    plan['goalId'] !== task.goalId ||
    plan['goalVersion'] !== task.goalVersion ||
    typeof plan['planId'] !== 'string' ||
    skillGoals.length !== 1 ||
    skillGoal === undefined ||
    canonical(skillGoal['capabilityNeeds']) !== canonical([target.capabilityId]) ||
    objects(plan['dependencies']).length !== 0
  )
    fail('UGV_A2A_USER_GOAL_PLAN_INVALID', 'User Goal plan is not one exact read Capability.');
  assertNoWriteOrUnknownTool(plan);
  return plan['planId'];
}

function assertTrace(
  value: unknown,
  task: z.infer<typeof RuntimeTaskSchema>,
  outcome: unknown,
  target: UgvReadOnlyTarget,
): string {
  const trace = requiredObject(value, 'UGV_A2A_TRACE_INVALID');
  const instance = requiredObject(trace['instance'], 'UGV_A2A_TRACE_INVALID');
  const budget = requiredObject(instance['budgetUsage'], 'UGV_A2A_TRACE_INVALID');
  const skillVersions = objects(instance['skillVersions']);
  if (
    typeof instance['instanceId'] !== 'string' ||
    instance['planId'] !== task.planId ||
    instance['goalId'] !== task.goalId ||
    instance['status'] !== 'succeeded' ||
    budget['mcpCalls'] !== 1 ||
    canonical(instance['result']) !== canonical(outcome) ||
    skillVersions.length !== 1 ||
    skillVersions[0]?.['skillId'] !== target.skillId ||
    skillVersions[0]['version'] !== target.skillVersion ||
    !Array.isArray(trace['events']) ||
    trace['events'].length === 0
  )
    fail('UGV_A2A_TRACE_INVALID', 'LangGraph trace does not prove one exact Skill/MCP execution.');
  assertNoWriteOrUnknownTool(trace);
  return instance['instanceId'];
}

function assertSkillExecution(
  value: unknown,
  task: z.infer<typeof RuntimeTaskSchema>,
  target: UgvReadOnlyTarget,
): void {
  const items = objects(requiredObject(value, 'UGV_A2A_SKILL_EXECUTION_INVALID')['items']);
  const execution = items[0];
  if (
    items.length !== 1 ||
    execution?.['taskId'] !== task.taskId ||
    execution['goalId'] !== task.goalId ||
    execution['skillId'] !== target.skillId ||
    execution['skillVersion'] !== target.skillVersion ||
    execution['workflowPlanId'] !== task.planId ||
    execution['status'] !== 'completed'
  )
    fail('UGV_A2A_SKILL_EXECUTION_INVALID', 'Skill execution lineage is not exact.');
}

function assertInputResolution(
  value: unknown,
  task: z.infer<typeof RuntimeTaskSchema>,
  target: UgvReadOnlyTarget,
): void {
  const items = objects(requiredObject(value, 'UGV_A2A_INPUT_RESOLUTION_INVALID')['items']);
  const resolution = items.find((item) => item['skillId'] === target.skillId);
  if (
    resolution?.['taskId'] !== task.taskId ||
    resolution['status'] !== 'resolved' ||
    canonical(resolution['structuredInput']) !== canonical({ resourceId: target.resourceId }) ||
    strings(resolution['unresolvedFields']).length !== 0
  )
    fail(
      'UGV_A2A_INPUT_RESOLUTION_INVALID',
      'Skill input did not preserve the exact explicit public resource.',
    );
}

function assertTerminalOutcome(
  value: unknown,
  outcomeId: string,
  task: z.infer<typeof RuntimeTaskSchema>,
  capabilityAttemptId: string,
): void {
  const outcome = requiredObject(value, 'UGV_A2A_TERMINAL_OUTCOME_INVALID');
  if (
    outcome['outcomeId'] !== outcomeId ||
    outcome['taskId'] !== task.taskId ||
    outcome['goalId'] !== task.goalId ||
    outcome['goalVersion'] !== task.goalVersion ||
    outcome['capabilityAttemptId'] !== capabilityAttemptId ||
    outcome['kind'] !== 'achieved' ||
    outcome['controlStatus'] !== 'achieved' ||
    outcome['authority'] !== 'user_goal_plan_controller'
  )
    fail(
      'UGV_A2A_TERMINAL_OUTCOME_INVALID',
      'User Goal Plan Controller did not commit an achieved terminal outcome.',
    );
}

function structuredA2AOutcome(task: Task, resourceId: string): unknown {
  const dataParts: unknown[] = [];
  for (const artifact of task.artifacts)
    for (const part of artifact.parts)
      if (part.content?.$case === 'data') dataParts.push(part.content.value as unknown);
  if (dataParts.length !== 1)
    fail('UGV_A2A_STRUCTURED_OUTCOME_MISSING', 'Terminal A2A Task requires one data Artifact.');
  const result = requiredObject(dataParts[0], 'UGV_A2A_STRUCTURED_OUTCOME_INVALID');
  if (result['resourceId'] !== resourceId)
    fail(
      'UGV_A2A_RESOURCE_IDENTITY_INVALID',
      'Structured A2A result does not preserve the exact public resource.',
    );
  assertNoWriteOrUnknownTool(result);
  return Object.freeze(structuredClone(result));
}

function assertAgentCardExposure(value: unknown, agentSkillId: string): void {
  const skills = objects(requiredObject(value, 'UGV_A2A_AGENT_CARD_INVALID')['skills']);
  if (skills.filter((skill) => skill['id'] === agentSkillId).length !== 1)
    fail('UGV_A2A_AGENT_CARD_EXPOSURE_MISSING', 'Agent Card lacks the exact published Exposure.');
}

function assertReviewAcceptable(task: Task): void {
  const interaction = object(object(task.metadata)?.['io.sdar/interaction']);
  if (
    !['interactive_goal', 'interactive_planning'].includes(String(interaction?.['kind'])) ||
    !['goal_review', 'plan_review'].includes(String(interaction?.['state'])) ||
    !strings(interaction?.['allowedActions']).includes('accept')
  )
    fail(
      'UGV_A2A_REVIEW_NOT_ACCEPTABLE',
      'Only a bounded complete Goal/Plan review may be accepted.',
    );
}

async function assertNoMcpInvocations(
  configuration: UgvA2AReadOnlyConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<void> {
  const value = await runtimeGet(
    configuration,
    `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
    request,
  );
  if (z.object({ items: z.array(z.unknown()) }).parse(value).items.length !== 0)
    fail('UGV_A2A_MCP_BEFORE_REVIEW', 'MCP invocation occurred before bounded plan review.');
}

async function assertNoWriteInvocation(
  configuration: UgvA2AReadOnlyConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<number> {
  const value = await runtimeGet(
    configuration,
    `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
    request,
  );
  assertNoWriteOrUnknownTool(value);
  return z.object({ items: z.array(z.unknown()) }).parse(value).items.length;
}

function assertNoWriteOrUnknownTool(value: unknown): void {
  visit(value, (key, item) => {
    if (
      (key === 'toolName' || key === 'operationName' || key === 'mcpToolName') &&
      typeof item === 'string' &&
      FORBIDDEN_TOOL_NAME.test(item)
    )
      fail('UGV_A2A_WRITE_OPERATION_FORBIDDEN', 'A2A read-only evidence contains a write Tool.');
    if (
      key === 'effect' &&
      typeof item === 'string' &&
      (item === 'unknown' || item === 'side_effecting')
    )
      fail('UGV_A2A_UNKNOWN_EFFECT_FORBIDDEN', 'A2A read-only evidence contains an unsafe effect.');
  });
}

async function continueTask(
  client: A2AClient,
  task: Task,
  randomId: () => string,
  action: 'provide_input' | 'confirm_plan',
  textValue: string,
  data: unknown,
  configuration: UgvA2AReadOnlyConfiguration,
  dependencies: DriverDependencies,
): Promise<Task> {
  const response = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `ugv-a2a-${action}-${randomId()}`,
        taskId: task.id,
        contextId: task.contextId,
        role: 'ROLE_USER',
        parts: [
          { text: textValue, mediaType: 'text/plain' },
          ...(data === undefined ? [] : [{ data, mediaType: 'application/json' }]),
        ],
        metadata: { user_id: 'ugv-a2a-read-only', sdar_action: action },
      },
      configuration: { returnImmediately: true },
    }),
  );
  if (!('id' in response))
    fail('UGV_A2A_CONTINUATION_TASK_EXPECTED', 'A2A continuation returned a Message.');
  return pollBoundary(client, response.id, configuration, dependencies);
}

async function pollBoundary(
  client: A2AClient,
  taskId: string,
  configuration: UgvA2AReadOnlyConfiguration,
  dependencies: DriverDependencies,
): Promise<Task> {
  for (let attempt = 0; attempt < (configuration.maxPolls ?? 120); attempt += 1) {
    const task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state;
    if (
      state === TaskState.TASK_STATE_INPUT_REQUIRED ||
      (state !== undefined && TERMINAL_STATES.has(state))
    )
      return task;
    await (dependencies.delay ?? delay)(configuration.pollIntervalMs ?? 1_000);
  }
  return fail('UGV_A2A_TASK_TIMEOUT', 'A2A Task did not reach a response boundary.');
}

async function pollTerminal(
  client: A2AClient,
  taskId: string,
  configuration: UgvA2AReadOnlyConfiguration,
  dependencies: DriverDependencies,
): Promise<Task> {
  for (let attempt = 0; attempt < (configuration.maxPolls ?? 120); attempt += 1) {
    const task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state;
    if (state !== undefined && TERMINAL_STATES.has(state)) return task;
    await (dependencies.delay ?? delay)(configuration.pollIntervalMs ?? 1_000);
  }
  return fail('UGV_A2A_TASK_TIMEOUT', 'A2A Task did not reach a terminal state.');
}

function a2aTaskSnapshot(task: Task): unknown {
  return {
    id: task.id,
    contextId: task.contextId,
    state: task.status?.state,
    artifacts: task.artifacts,
  };
}

function governanceForAuthority(
  authority: UgvReadOnlyAuthoritySnapshot,
): UgvReadOnlyGovernanceAuthority {
  return Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-capability-governance/v1',
    status: 'passed',
    observedAt: authority.observedAt,
    binding: Object.freeze({
      bindingId: authority.binding.binding.bindingId,
      localServerId: authority.binding.binding.localServerId,
      revision: authority.binding.binding.revision,
      registryRevision: authority.binding.binding.registryRevision,
      registryChecksum: authority.binding.binding.registryChecksum,
      catalogRevision: authority.binding.binding.catalogRevision,
      catalogChecksum: authority.binding.binding.catalogChecksum,
      operationCount: authority.binding.binding.operationCount,
      availabilityValidUntil: authority.binding.binding.availabilityValidUntil,
    }),
    resourcePolicy: Object.freeze({
      identifierAuthority: 'public_smpp_tool_schema',
      resourceId: authority.target.resourceId,
      selection: 'explicit_configured_value',
    }),
    catalog: Object.freeze({
      discoveredToolCount: authority.binding.binding.operationCount,
      governedToolCount: 1,
      stagedControlToolCount: 0,
      unmappedToolNames: Object.freeze([]),
    }),
    firePolicy: Object.freeze({
      toolName: 'vehicle_fire_weapon',
      discovered: false,
      forbidden: true,
      capabilityCreated: false,
      skillCreated: false,
    }),
    skills: Object.freeze([
      Object.freeze({
        skillId: authority.target.skillId,
        skillVersion: authority.target.skillVersion,
        capabilityId: authority.target.capabilityId,
        toolName: authority.target.toolName,
        packageChecksum: sha256Json({
          skillId: authority.target.skillId,
          skillVersion: authority.target.skillVersion,
          capabilityDefinitionHash: authority.target.capabilityDefinitionHash,
        }),
        inputSchemaSha256: sha256Json(authority.skill.inputSchema),
        outputSchemaSha256: sha256Json(authority.skill.outputSchema),
        action: 'reconciled',
        status: 'published',
      }),
    ]),
    capabilities: Object.freeze([
      Object.freeze({
        capabilityId: authority.target.capabilityId,
        capabilityVersion: authority.target.capabilityVersion,
        definitionHash: authority.target.capabilityDefinitionHash,
        implementationBindingId: authority.target.capabilityBindingId,
        skillId: authority.target.skillId,
        skillVersion: authority.target.skillVersion,
        toolName: authority.target.toolName,
        riskLevel: 'low',
        confirmation: 'not_required',
        remoteTerminalEvidenceRequired: false,
        readiness: 'available',
        readinessValidUntil: authority.binding.binding.availabilityValidUntil,
      }),
    ]),
    stagedControls: Object.freeze([]),
    redaction: Object.freeze({
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: false,
      mqttTopicsIncluded: false,
    }),
  });
}

function validateConfiguration(input: UgvA2AReadOnlyConfiguration): UgvA2AReadOnlyConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  const a2aBaseUrl = safeManagementBaseUrl(input.a2aBaseUrl);
  const modelBaseUrl = normalizeEndpoint(input.modelBaseUrl);
  if (
    input.nodeControlBearerToken.trim() === '' ||
    input.nodeControlRuntimeServiceToken.trim() === '' ||
    input.modelProviderId.trim() === '' ||
    input.modelName.trim() === '' ||
    input.runId.trim().length < 8 ||
    input.runId.length > 128 ||
    (input.pollIntervalMs !== undefined &&
      (input.pollIntervalMs < 0 || input.pollIntervalMs > 60_000)) ||
    (input.maxPolls !== undefined &&
      (!Number.isInteger(input.maxPolls) || input.maxPolls < 1 || input.maxPolls > 3_600))
  )
    fail('UGV_A2A_CONFIGURATION_INVALID', 'A2A qualification configuration is incomplete.');
  return Object.freeze({
    ...input,
    nodeControlBaseUrl,
    runtimeManagementBaseUrl,
    a2aBaseUrl,
    modelBaseUrl,
  });
}

function normalizeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return fail('UGV_A2A_CONFIGURATION_INVALID', 'Model endpoint must be absolute HTTP(S).');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.hash !== ''
  )
    fail('UGV_A2A_CONFIGURATION_INVALID', 'Model endpoint must be credential-free HTTP(S).');
  endpoint.hash = '';
  return endpoint.toString().replace(/\/$/u, '');
}

function exposureIdFor(capabilityId: string): string {
  return `a2a.${capabilityId}`;
}

async function createClient(
  baseUrl: string,
  factory: DriverDependencies['createA2AClient'],
): Promise<A2AClient> {
  return factory === undefined ? new ClientFactory().createFromUrl(baseUrl) : factory(baseUrl);
}

async function publicGet(baseUrl: string, path: string, request: typeof fetch): Promise<unknown> {
  return requestJson(`${baseUrl}${path}`, { redirect: 'manual' }, request);
}

async function runtimeGet(
  configuration: UgvA2AReadOnlyConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    { redirect: 'manual' },
    request,
  );
}

async function controlGet(
  configuration: UgvA2AReadOnlyConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.nodeControlBaseUrl}${path}`,
    bearer(configuration.nodeControlBearerToken),
    request,
  );
}

async function controlMutation(
  configuration: UgvA2AReadOnlyConfiguration,
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

function controlResponse(
  configuration: UgvA2AReadOnlyConfiguration,
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
    let code = 'UGV_A2A_NODE_CONTROL_REJECTED';
    try {
      const value = object(await response.json());
      const error = object(value?.['error']);
      if (typeof value?.['code'] === 'string') code = value['code'];
      else if (typeof error?.['code'] === 'string') code = error['code'];
    } catch {
      // External response bodies are not copied into errors or reports.
    }
    return fail(code, `Node Control rejected the request with status ${String(response.status)}.`);
  }
  try {
    return await response.json();
  } catch {
    return fail('UGV_A2A_NODE_CONTROL_RESPONSE_INVALID', 'Node Control response was not JSON.');
  }
}

function stableKey(runId: string, scope: string): string {
  return stableIdentifier('ugv-a2a', runId, scope);
}

function jsonObject(value: unknown): JsonObject {
  const parsed = object(value);
  if (parsed === undefined)
    return fail('UGV_A2A_CAPABILITY_SCHEMA_INVALID', 'A2A Capability schema must be an object.');
  return structuredClone(parsed) as JsonObject;
}

function requiredObject(value: unknown, code: string): Readonly<Record<string, unknown>> {
  const parsed = object(value);
  if (parsed === undefined) return fail(code, 'Expected an object authority.');
  return parsed;
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    return fail(code, 'Expected text authority.');
  return value;
}

function visit(value: unknown, callback: (key: string, item: unknown) => void, key = ''): void {
  callback(key, value);
  if (Array.isArray(value)) {
    value.forEach((item) => {
      visit(item, callback);
    });
    return;
  }
  const record = object(value);
  if (record !== undefined)
    Object.entries(record).forEach(([nestedKey, item]) => {
      visit(item, callback, nestedKey);
    });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    return fail('UGV_A2A_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('UGV_A2A_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  const value = (inline ?? (file === undefined ? '' : await readFile(file, 'utf8'))).trim();
  if (value === '') fail('UGV_A2A_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

export async function ugvA2AConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{ configuration: UgvA2AReadOnlyConfiguration; reportFile: string }>> {
  return Object.freeze({
    configuration: Object.freeze({
      a2aBaseUrl: environment['SDAR_A2A_URL'] ?? 'http://127.0.0.1:9999',
      nodeControlBaseUrl: requiredEnvironment(environment, 'SDAR_NODE_CONTROL_BASE_URL'),
      nodeControlBearerToken: await secretFromEnvironment(environment, 'SDAR_CONTROL_API_TOKEN'),
      nodeControlRuntimeServiceToken: await secretFromEnvironment(
        environment,
        'SDAR_CONTROL_RUNTIME_SERVICE_TOKEN',
      ),
      runtimeManagementBaseUrl: requiredEnvironment(
        environment,
        'SDAR_UGV_RUNTIME_MANAGEMENT_BASE_URL',
      ),
      governanceReportFile:
        environment['SDAR_UGV_GOVERNANCE_REPORT_FILE'] ??
        'reports/sdar-ugv-smpp-integration/capability-skill-governance.redacted.json',
      modelConformanceReportFile: requiredEnvironment(
        environment,
        'SDAR_UGV_MODEL_CONFORMANCE_REPORT_FILE',
      ),
      modelProviderId: requiredEnvironment(environment, 'SDAR_UGV_MODEL_PROVIDER_ID'),
      modelBaseUrl: requiredEnvironment(environment, 'SDAR_UGV_MODEL_BASE_URL'),
      modelName: requiredEnvironment(environment, 'SDAR_UGV_MODEL_NAME'),
      modelApiStyle: z
        .enum(['openai_chat_completions', 'anthropic_messages'])
        .parse(requiredEnvironment(environment, 'SDAR_UGV_MODEL_API_STYLE')),
      runId: requiredEnvironment(environment, 'SDAR_UGV_A2A_RUN_ID'),
      pollIntervalMs: Number(environment['SDAR_UGV_A2A_POLL_INTERVAL_MS'] ?? '1000'),
      maxPolls: Number(environment['SDAR_UGV_A2A_MAX_POLLS'] ?? '120'),
    }),
    reportFile:
      environment['SDAR_UGV_A2A_REPORT_FILE'] ??
      'reports/sdar-ugv-smpp-integration/a2a-readonly.json',
  });
}

export async function runUgvA2AReadOnlyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const observedAt = new Date().toISOString();
  const reportFile =
    environment['SDAR_UGV_A2A_REPORT_FILE'] ??
    'reports/sdar-ugv-smpp-integration/a2a-readonly.json';
  try {
    const pending = ugvA2APendingFromEnvironment(environment, observedAt);
    if (pending !== undefined) {
      await writeRedactedUgvReport(reportFile, pending);
      process.stderr.write(
        `${JSON.stringify({ status: pending.status, code: pending.reasonCode, reportFile: resolve(reportFile) })}\n`,
      );
      process.exitCode = 2;
      return;
    }
    const resolved = await ugvA2AConfigurationFromEnvironment(environment);
    const report = await executeUgvA2AReadOnly(resolved.configuration);
    await writeRedactedUgvReport(resolved.reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(resolved.reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const record = object(error);
    const code =
      error instanceof UgvA2AReadOnlyError || typeof record?.['code'] === 'string'
        ? String(record?.['code'])
        : 'UGV_A2A_READ_ONLY_FAILED';
    const failed = failedUgvA2AReport(
      code,
      new Date().toISOString(),
      error instanceof UgvA2AReadOnlyError ? error.execution : undefined,
    );
    await writeRedactedUgvReport(reportFile, failed);
    process.stderr.write(
      `${JSON.stringify({ status: 'failed', code, reportFile: resolve(reportFile) })}\n`,
    );
    process.exitCode = 1;
  }
}

export function failedUgvA2AReport(
  reasonCode: string,
  observedAt: string,
  execution?: UgvA2AReadOnlyError['execution'],
): UgvA2AFailedReport {
  const report: UgvA2AFailedReport = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1',
    status: 'failed',
    evidenceClass: 'real_a2a_attempt_failed',
    observedAt: validTimestamp(observedAt),
    reasonCode,
    a2aReadOnlyReady: false,
    ...(execution === undefined ? {} : { execution: Object.freeze({ ...execution }) }),
    redaction: Object.freeze({ secretsIncluded: false, endpointsIncluded: false }),
  });
  assertSafeRedactedJson(report);
  return report;
}

function fail(code: string, message: string): never {
  throw new UgvA2AReadOnlyError(code, message);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  await runUgvA2AReadOnlyFromEnvironment();
