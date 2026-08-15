import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
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
import {
  HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT,
  HOME_LAB_GOVERNED_LIGHT_SKILLS,
  assertHomeLabGovernedLightWorkflowContract,
} from '../../server/src/home-lab-governed-light-workflow-contract.js';
import {
  HOME_LAB_GOVERNED_LIGHT_BINDING_ID,
  HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID,
  HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID,
  HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
  HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
} from '../../server/src/home-lab-task-understanding.js';

const CHECKSUM = /^[a-f0-9]{64}$/u;
const SHA256_REF = /^sha256:[a-f0-9]{64}$/u;
const TERMINAL_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);
const USER_ID = 'home-lab-g09-governed-light';

export const HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS = Object.freeze({
  read: Object.freeze({
    kind: 'read' as const,
    requestText: '读取主灯基线',
    exposureId: 'home-lab-a2a-main-light-read-g09-v3',
    agentSkillId: 'home-lab.main-light.read-g09-v3',
    capabilityId: HOME_LAB_GOVERNED_LIGHT_READ_CAPABILITY_ID,
    capabilityBindingId: 'capability-binding-home.light.read-state-v3',
    skill: HOME_LAB_GOVERNED_LIGHT_SKILLS.read,
    taskTypeId: 'task-type.home-lab-main-light-read-state',
    toolName: 'light_get_state',
  }),
  control: Object.freeze({
    kind: 'control' as const,
    exposureId: 'home-lab-a2a-main-light-control-g09-v3',
    agentSkillId: 'home-lab.main-light.control-g09-v3',
    capabilityId: HOME_LAB_GOVERNED_LIGHT_CONTROL_CAPABILITY_ID,
    capabilityBindingId: 'capability-binding-home.light.set-power-v3',
    skill: HOME_LAB_GOVERNED_LIGHT_SKILLS.control,
    taskTypeId: 'task-type.home-lab-main-light-set-power',
    toolName: 'light_set_power',
  }),
});

type LightPower = 'on' | 'off';
type Scenario =
  | typeof HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.read
  | (typeof HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control &
      Readonly<{ purpose: 'set' | 'restore'; power: LightPower; requestText: string }>);
type A2AClient = Pick<Client, 'sendMessage' | 'getTask' | 'cancelTask'>;

export interface HomeLabG09GovernedLightConfiguration {
  readonly mode: 'dry-run' | 'execute';
  readonly a2aBaseUrl: string;
  readonly runtimeManagementBaseUrl: string;
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly governedControlBearerToken?: string;
  readonly runId: string;
  readonly dryRunPower?: LightPower;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export interface HomeLabG09GovernedLightReport {
  readonly schemaVersion: 'sdar.home-lab-g09-governed-light/v1';
  readonly status: 'dry_run_passed' | 'passed';
  readonly mode: 'dry-run' | 'execute';
  readonly observedAt: string;
  readonly runIdHash: string;
  readonly authority: Readonly<{
    sourceId: 'home-lab-smpp-g09-019fca75';
    bindingId: typeof HOME_LAB_GOVERNED_LIGHT_BINDING_ID;
    serverId: typeof HOME_LAB_GOVERNED_LIGHT_SERVER_ID;
    capabilityVersions: readonly [3, 3];
    skillVersions: readonly [3, 3];
  }>;
  readonly writeGate: 'closed' | 'open_for_exact_run';
  readonly dryRun?: Readonly<{
    taskId: string;
    contextId: string;
    planId: string;
    desiredPower: LightPower;
    preCleanupPhase: 'awaiting_plan_confirmation';
    cleanupTaskState: 'canceled';
    cleanup: 'a2a_cancel_terminal';
    mcpInvocationCount: 0;
    remoteTaskCount: 0;
    continuationCount: 0;
    governedConfirmationIssued: false;
    deviceWriteDispatched: false;
    restoration: 'not_required_no_dispatch';
  }>;
  readonly execution?: Readonly<{
    baselinePower: LightPower;
    desiredPower: LightPower;
    baselineReadTaskId: string;
    set: GovernedTaskEvidence;
    restore: GovernedTaskEvidence;
    finalPower: LightPower;
    restoration: 'completed_in_finally';
  }>;
}

export interface GovernedTaskEvidence {
  readonly taskId: string;
  readonly contextId: string;
  readonly planId: string;
  readonly workflowInstanceId: string;
  readonly confirmationId: string;
  readonly mcpInvocationId: string;
  readonly remoteTaskId: string;
  readonly continuationCount: number;
  readonly evidenceCount: number;
  readonly power: LightPower;
  readonly purpose: 'set' | 'restore';
  readonly idempotencyReplay: 'same_instance_resume_rejected_no_redispatch';
}

interface DriverDependencies {
  readonly fetch?: typeof fetch;
  readonly createA2AClient?: (baseUrl: string) => Promise<A2AClient>;
  readonly now?: () => string;
  readonly randomId?: () => string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly delay?: (milliseconds: number) => Promise<void>;
}

interface ValidatedConfiguration {
  readonly mode: HomeLabG09GovernedLightConfiguration['mode'];
  readonly a2aBaseUrl: string;
  readonly runtimeManagementBaseUrl: string;
  readonly nodeControlBaseUrl: string;
  readonly nodeControlBearerToken: string;
  readonly governedControlBearerToken?: string;
  readonly runId: string;
  readonly dryRunPower: LightPower;
  readonly pollIntervalMs: number;
  readonly maxPolls: number;
}

interface PlannedTask {
  readonly task: Task;
  readonly runtimeTask: z.infer<typeof RuntimeTaskSchema>;
  readonly plan: Readonly<Record<string, unknown>>;
}

interface BarrierReleaseResult {
  readonly task: Task;
  readonly workflowInstanceId: string;
  readonly confirmationId: string;
}

const CapabilitySchema = z
  .object({
    capabilityId: z.string().min(1),
    version: z.literal(3),
    name: z.string().min(1),
    description: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    constraints: z.array(z.record(z.string(), z.unknown())),
    supportedModes: z.array(z.string()),
    status: z.literal('published'),
    definitionHash: z.string().regex(CHECKSUM),
  })
  .loose();
const ReadinessSchema = z
  .object({
    capabilityId: z.string().min(1),
    capabilityVersion: z.literal(3),
    status: z.literal('available'),
    validUntil: z.iso.datetime(),
    availableImplementations: z.array(z.string()),
    unavailableImplementations: z.array(z.string()),
  })
  .loose();
const SkillSchema = z
  .object({
    skillId: z.string().min(1),
    version: z.literal(3),
    status: z.literal('enabled'),
    capabilities: z.array(z.string()),
    toolPolicy: z.object({
      required: z.array(z.record(z.string(), z.unknown())),
      optional: z.array(z.unknown()),
      forbidden: z.array(z.record(z.string(), z.unknown())),
    }),
    runtimePolicy: z.record(z.string(), z.unknown()),
    outcomeSpecification: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
const ProviderBindingSchema = z
  .object({
    bindingId: z.literal(HOME_LAB_GOVERNED_LIGHT_BINDING_ID),
    localServerId: z.literal(HOME_LAB_GOVERNED_LIGHT_SERVER_ID),
    status: z.literal('active'),
    availabilityStatus: z.literal('available'),
    availabilityValidUntil: z.iso.datetime(),
  })
  .loose();
const ToolSchema = z
  .object({
    serverId: z.literal(HOME_LAB_GOVERNED_LIGHT_SERVER_ID),
    toolName: z.string().min(1),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    executionSemantics: z.record(z.string(), z.unknown()),
    taskExecutionProfile: z.record(z.string(), z.unknown()),
  })
  .loose();
const RuntimeTaskSchema = z
  .object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    phase: z.string().min(1),
    goalId: z.string().min(1).optional(),
    goalVersion: z.number().int().positive().optional(),
    planId: z.string().min(1).optional(),
    selectedSkillId: z.string().min(1).optional(),
    selectedSkillVersion: z.number().int().positive().optional(),
    output: z.object({ text: z.string(), structured: z.unknown() }).optional(),
    errorCode: z.string().optional(),
  })
  .loose();
const CollectionSchema = z.object({ items: z.array(z.unknown()) });
const ExposureSchema = z
  .object({
    exposureId: z.string().min(1),
    version: z.literal(1),
    status: z.enum(['draft', 'published', 'suspended', 'retired']),
    exposureHash: z.string().regex(CHECKSUM),
  })
  .loose();
const OperationSchema = z
  .object({ status: z.literal('succeeded'), result: z.unknown().optional() })
  .loose();

export async function runHomeLabG09GovernedLight(
  input: HomeLabG09GovernedLightConfiguration,
  dependencies: DriverDependencies = {},
): Promise<HomeLabG09GovernedLightReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const environment = dependencies.environment ?? process.env;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const observedAt = validTimestamp(now());
  const writeGate = assertWriteGate(configuration, environment);

  await runtimeGet(configuration, '/api/v1/health', request);
  const authorities = await preflightAuthority(configuration, observedAt, request);
  await ensureExposures(configuration, authorities, request);
  await rebuildAgentCard(configuration, request);
  const client = await createClient(configuration.a2aBaseUrl, dependencies.createA2AClient);
  const randomId = dependencies.randomId ?? randomUUID;
  const pause = dependencies.delay ?? delay;

  if (configuration.mode === 'dry-run') {
    const scenario = controlScenario('set', configuration.dryRunPower);
    const planned = await planTask(configuration, scenario, client, request, randomId, pause);
    let gateError: unknown;
    try {
      await assertZeroDispatch(configuration, planned.task.id, request);
    } catch (error: unknown) {
      gateError = error;
    }
    const canceled = await client.cancelTask({ tenant: '', id: planned.task.id, metadata: {} });
    if (canceled.status?.state !== TaskState.TASK_STATE_CANCELED)
      fail('G09_DRY_RUN_CLEANUP_FAILED', 'The dry-run Task did not cancel terminally.');
    const canceledRuntimeTask = RuntimeTaskSchema.parse(
      await runtimeGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(planned.task.id)}`,
        request,
      ),
    );
    if (canceledRuntimeTask.phase !== 'canceled')
      fail('G09_DRY_RUN_CLEANUP_FAILED', 'Runtime did not persist terminal dry-run cleanup.');
    await assertZeroDispatch(configuration, planned.task.id, request);
    if (gateError !== undefined) throw gateError;
    return reportBase(configuration, observedAt, writeGate, {
      dryRun: Object.freeze({
        taskId: planned.task.id,
        contextId: planned.task.contextId,
        planId: requiredText(planned.runtimeTask.planId, 'G09_PLAN_ID_MISSING'),
        desiredPower: configuration.dryRunPower,
        preCleanupPhase: 'awaiting_plan_confirmation' as const,
        cleanupTaskState: 'canceled' as const,
        cleanup: 'a2a_cancel_terminal' as const,
        mcpInvocationCount: 0 as const,
        remoteTaskCount: 0 as const,
        continuationCount: 0 as const,
        governedConfirmationIssued: false as const,
        deviceWriteDispatched: false as const,
        restoration: 'not_required_no_dispatch' as const,
      }),
    });
  }

  const baseline = await executeReadTask(configuration, client, request, randomId, pause);
  const desiredPower: LightPower = baseline.power === 'on' ? 'off' : 'on';
  let setEvidence: GovernedTaskEvidence | undefined;
  let restoreEvidence: GovernedTaskEvidence | undefined;
  let dispatchReleased = false;
  let primaryError: unknown;
  try {
    setEvidence = await executeGovernedTask(
      configuration,
      controlScenario('set', desiredPower),
      client,
      request,
      randomId,
      pause,
      () => {
        dispatchReleased = true;
      },
    );
  } catch (error: unknown) {
    primaryError = error;
  } finally {
    if (dispatchReleased) {
      try {
        restoreEvidence = await executeGovernedTask(
          configuration,
          controlScenario('restore', baseline.power),
          client,
          request,
          randomId,
          pause,
          () => undefined,
        );
      } catch (error: unknown) {
        throw new HomeLabG09GovernedLightError(
          'G09_RESTORATION_FAILED',
          primaryError === undefined
            ? 'The primary write completed but the finally restoration Task failed.'
            : 'The primary write failed after dispatch release and the finally restoration Task also failed.',
          { cause: error },
        );
      }
    }
  }
  if (primaryError !== undefined) throw primaryError;
  if (setEvidence === undefined || restoreEvidence === undefined)
    fail('G09_EXECUTION_EVIDENCE_INCOMPLETE', 'Set and restoration evidence are both required.');
  if (restoreEvidence.power !== baseline.power)
    fail('G09_RESTORATION_STATE_MISMATCH', 'The restoration Task did not return baseline power.');

  return reportBase(configuration, observedAt, writeGate, {
    execution: Object.freeze({
      baselinePower: baseline.power,
      desiredPower,
      baselineReadTaskId: baseline.taskId,
      set: setEvidence,
      restore: restoreEvidence,
      finalPower: restoreEvidence.power,
      restoration: 'completed_in_finally' as const,
    }),
  });
}

export async function releaseGovernedControlAtPausedBarrier<TTask>(
  input: Readonly<{
    taskId: string;
    planId: string;
    expectedPower: LightPower;
    confirmPlan(): Promise<TTask>;
    waitForBarrier(): Promise<unknown>;
    assertZeroMcpInvocations(): Promise<void>;
    issueConfirmation(): Promise<unknown>;
    resume(instanceId: string): Promise<unknown>;
  }>,
): Promise<Readonly<{ task: TTask; instanceId: string; confirmationId: string }>> {
  await input.assertZeroMcpInvocations();
  const confirming = input.confirmPlan();
  const trace = record(await input.waitForBarrier(), 'G09_WORKFLOW_TRACE_INVALID');
  const instance = record(trace['instance'], 'G09_WORKFLOW_TRACE_INVALID');
  const pending = record(instance['pendingConfirmation'], 'G09_WORKFLOW_BARRIER_MISSING');
  const instanceId = requiredText(instance['instanceId'], 'G09_WORKFLOW_INSTANCE_ID_MISSING');
  if (
    instance['planId'] !== input.planId ||
    instance['status'] !== 'paused' ||
    pending['nodeId'] !== 'confirmControl' ||
    pending['kind'] !== 'human_confirmation' ||
    pending['prompt'] !== HOME_LAB_GOVERNED_LIGHT_CONTROL_PROMPT
  )
    fail('G09_WORKFLOW_BARRIER_INVALID', 'The exact governed-control barrier is not paused.');
  await input.assertZeroMcpInvocations();
  const issuance = record(await input.issueConfirmation(), 'G09_CONFIRMATION_RESPONSE_INVALID');
  const confirmation = record(issuance['confirmation'], 'G09_CONFIRMATION_RESPONSE_INVALID');
  const authority = record(issuance['authority'], 'G09_CONFIRMATION_AUTHORITY_INVALID');
  const confirmationId = requiredText(
    confirmation['confirmationId'],
    'G09_CONFIRMATION_ID_MISSING',
  );
  if (
    authority['taskId'] !== input.taskId ||
    authority['planId'] !== input.planId ||
    authority['capabilityBindingId'] !== `binding-${input.taskId}` ||
    authority['capabilityId'] !== HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control.capabilityId ||
    authority['capabilityVersion'] !== 3 ||
    authority['skillId'] !== HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control.skill.skillId ||
    authority['skillVersion'] !== 3 ||
    authority['providerBindingId'] !== HOME_LAB_GOVERNED_LIGHT_BINDING_ID ||
    authority['serverId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    authority['toolName'] !== HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control.toolName ||
    canonical(authority['arguments']) !==
      canonical({ resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID, power: input.expectedPower })
  )
    fail(
      'G09_CONFIRMATION_AUTHORITY_INVALID',
      'The server-derived confirmation authority differs from the exact Task and Tool call.',
    );
  await input.resume(instanceId);
  return Object.freeze({ task: await confirming, instanceId, confirmationId });
}

export async function executeWithFinallyRestoration<TSet, TRestore>(
  input: Readonly<{
    executeSet(release: () => void): Promise<TSet>;
    executeRestore(): Promise<TRestore>;
  }>,
): Promise<Readonly<{ set: TSet; restore: TRestore }>> {
  let released = false;
  let set: TSet | undefined;
  let restore: TRestore | undefined;
  let primaryError: unknown;
  try {
    set = await input.executeSet(() => {
      released = true;
    });
  } catch (error: unknown) {
    primaryError = error;
  } finally {
    if (released) restore = await input.executeRestore();
  }
  if (primaryError !== undefined) throw primaryError;
  if (set === undefined || restore === undefined)
    fail('G09_RESTORATION_NOT_EXECUTED', 'A released write requires finally restoration.');
  return Object.freeze({ set, restore });
}

async function preflightAuthority(
  configuration: ValidatedConfiguration,
  observedAt: string,
  request: typeof fetch,
): Promise<Readonly<{ read: A2aExposureVersion; control: A2aExposureVersion }>> {
  const binding = ProviderBindingSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/mcp-provider-bindings/${encodeURIComponent(HOME_LAB_GOVERNED_LIGHT_BINDING_ID)}`,
      request,
    ),
  );
  if (Date.parse(binding.availabilityValidUntil) <= Date.parse(observedAt))
    fail('G09_PROVIDER_BINDING_STALE', 'The exact G09 light Binding has expired.');
  const toolCollection = CollectionSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/mcp/servers/${encodeURIComponent(HOME_LAB_GOVERNED_LIGHT_SERVER_ID)}/tools`,
      request,
    ),
  );
  const tools = toolCollection.items.map((item) => ToolSchema.parse(item));
  const readTool = exactlyOneTool(tools, 'light_get_state');
  const controlTool = exactlyOneTool(tools, 'light_set_power');
  if (
    controlTool.executionSemantics['effect'] !== 'side_effecting' ||
    controlTool.executionSemantics['execution'] !== 'task_required' ||
    controlTool.taskExecutionProfile['taskBehavior'] !== 'task_required' ||
    readTool.executionSemantics['effect'] !== 'read_only' ||
    readTool.executionSemantics['execution'] !== 'synchronous' ||
    readTool.taskExecutionProfile['taskBehavior'] !== 'synchronous_only'
  )
    fail('G09_TOOL_AUTHORITY_INVALID', 'The exact read/control Tool semantics are unavailable.');

  const read = await loadCapabilityAndSkill(
    configuration,
    HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.read,
    observedAt,
    request,
  );
  const control = await loadCapabilityAndSkill(
    configuration,
    HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control,
    observedAt,
    request,
  );
  assertControlAuthority(control.capability, control.skill, controlTool);
  return Object.freeze({
    read: exposure(HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.read, read.capability),
    control: exposure(HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control, control.capability),
  });
}

async function loadCapabilityAndSkill(
  configuration: ValidatedConfiguration,
  scenario:
    | typeof HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.read
    | typeof HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control,
  observedAt: string,
  request: typeof fetch,
) {
  const capability = CapabilitySchema.parse(
    await controlGet(
      configuration,
      `/api/v1/node-capabilities/${encodeURIComponent(scenario.capabilityId)}/versions/3`,
      request,
    ),
  );
  const readiness = ReadinessSchema.parse(
    await controlGet(
      configuration,
      `/api/v1/capability-readiness/${encodeURIComponent(scenario.capabilityId)}/3`,
      request,
    ),
  );
  const skill = SkillSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/skills/${encodeURIComponent(scenario.skill.skillId)}/versions/3`,
      request,
    ),
  );
  if (
    capability.capabilityId !== scenario.capabilityId ||
    readiness.capabilityId !== scenario.capabilityId ||
    Date.parse(readiness.validUntil) <= Date.parse(observedAt) ||
    canonical(readiness.availableImplementations) !== canonical([scenario.capabilityBindingId]) ||
    readiness.unavailableImplementations.length !== 0 ||
    skill.skillId !== scenario.skill.skillId ||
    canonical(skill.capabilities) !== canonical([scenario.capabilityId]) ||
    skill.toolPolicy.required.length !== 1 ||
    record(skill.toolPolicy.required[0], 'G09_SKILL_TOOL_POLICY_INVALID')['serverId'] !==
      HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    record(skill.toolPolicy.required[0], 'G09_SKILL_TOOL_POLICY_INVALID')['toolName'] !==
      scenario.toolName ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.runtimePolicy['autoConfirmPlan'] !== false ||
    skill.runtimePolicy['maxMcpCalls'] !== 1 ||
    skill.runtimePolicy['maxLlmCalls'] !== 0
  )
    fail('G09_CAPABILITY_SKILL_AUTHORITY_INVALID', 'The exact G09 v3 authority is unavailable.');
  return Object.freeze({ capability, skill });
}

function assertControlAuthority(
  capability: z.infer<typeof CapabilitySchema>,
  skill: z.infer<typeof SkillSchema>,
  tool: z.infer<typeof ToolSchema>,
): void {
  const constraints = capability.constraints;
  const confirmation = exactlyOneConstraint(constraints, 'confirmation_policy');
  const sideEffect = exactlyOneConstraint(constraints, 'physical_side_effect_policy');
  const provider = exactlyOneConstraint(constraints, 'provider_binding_policy');
  const resource = exactlyOneConstraint(constraints, 'resource_policy');
  const sideEffectPolicy = record(
    skill.outcomeSpecification?.['sideEffectPolicy'],
    'G09_SKILL_SIDE_EFFECT_POLICY_INVALID',
  );
  if (
    confirmation['required'] !== true ||
    confirmation['stage'] !== 'before_execution' ||
    confirmation['autoConfirmPlan'] !== false ||
    sideEffect['sideEffecting'] !== true ||
    sideEffect['dispatchMaximum'] !== 1 ||
    sideEffect['uncertainDispatchPolicy'] !== 'reconcile_never_redispatch' ||
    sideEffect['remoteTaskTerminalEvidenceRequired'] !== true ||
    provider['mcpProviderBindingId'] !== HOME_LAB_GOVERNED_LIGHT_BINDING_ID ||
    provider['localServerId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    provider['mcpToolName'] !== 'light_set_power' ||
    canonical(provider['executionSemantics']) !== canonical(tool.executionSemantics) ||
    canonical(provider['allowedResourceIds']) !==
      canonical([HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID]) ||
    resource['identifierAuthority'] !== 'public_smpp_tool_schema' ||
    resource['selection'] !== 'exact_value' ||
    resource['downstreamResourceBinding'] !== 'forbidden' ||
    canonical(resource['allowedResourceIds']) !==
      canonical([HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID]) ||
    !capability.supportedModes.includes('plan_confirmed') ||
    !capability.supportedModes.includes('remote_task') ||
    sideEffectPolicy['sideEffecting'] !== true ||
    sideEffectPolicy['confirmation'] !== 'required_before_execution' ||
    sideEffectPolicy['autoConfirmPlan'] !== false ||
    sideEffectPolicy['exactResourceRequired'] !== true ||
    sideEffectPolicy['remoteTaskIdentityRequired'] !== true ||
    sideEffectPolicy['terminalObservationRequired'] !== true ||
    sideEffectPolicy['redispatchAfterUncertain'] !== false ||
    !skill.toolPolicy.forbidden.some(
      (candidate) =>
        candidate['serverId'] === HOME_LAB_GOVERNED_LIGHT_SERVER_ID &&
        candidate['toolName'] === 'vehicle_fire_weapon',
    )
  )
    fail(
      'G09_CONTROL_AUTHORITY_INVALID',
      'The G09 control authority does not satisfy the Runtime governed-control authorizer.',
    );
}

function exposure(
  scenario:
    | typeof HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.read
    | typeof HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control,
  capability: z.infer<typeof CapabilitySchema>,
): A2aExposureVersion {
  return createA2aExposureVersion({
    exposureId: scenario.exposureId,
    version: 1,
    capabilityId: scenario.capabilityId,
    capabilityVersion: 3,
    agentSkillId: scenario.agentSkillId,
    name: capability.name,
    description: capability.description,
    tags: ['home-lab', 'g09', 'main-light', scenario.kind],
    examples: [
      scenario.kind === 'read' ? scenario.requestText : '设置主灯电源为 off',
      ...(scenario.kind === 'control' ? ['恢复主灯电源为 on'] : []),
    ],
    inputModes: ['text/plain', 'application/json'],
    outputModes: ['application/json'],
    requestSchema: jsonObject(capability.inputSchema, 'G09_CAPABILITY_INPUT_SCHEMA_INVALID'),
    resultSchema: jsonObject(capability.outputSchema, 'G09_CAPABILITY_OUTPUT_SCHEMA_INVALID'),
    visibility: 'public',
    requesterPolicy: { allowAnonymous: false, allowedRequesterIds: [USER_ID] },
    readinessPublicationPolicy: 'publish_when_available',
    status: 'draft',
  });
}

async function ensureExposures(
  configuration: ValidatedConfiguration,
  exposures: Readonly<{ read: A2aExposureVersion; control: A2aExposureVersion }>,
  request: typeof fetch,
): Promise<void> {
  for (const draft of [exposures.read, exposures.control]) {
    const path = `/api/v1/a2a-exposures/${encodeURIComponent(draft.exposureId)}/versions/1`;
    const response = await controlResponse(configuration, path, { method: 'GET' }, request);
    let current: z.infer<typeof ExposureSchema>;
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
      );
    else current = ExposureSchema.parse(await responseJson(response, 200));
    if (current.exposureHash !== draft.exposureHash)
      fail('G09_EXPOSURE_DRIFT', 'An existing G09 Exposure differs from the exact v3 contract.');
    if (current.status === 'retired')
      fail('G09_EXPOSURE_RETIRED', 'A retired exact-version Exposure cannot be reused.');
    if (current.status !== 'published')
      await controlMutation(
        configuration,
        `${path}/publish`,
        stableKey(configuration.runId, `exposure-publish:${draft.exposureId}`),
        { reason: `Publish exact G09 Exposure ${draft.exposureId}@1.` },
        request,
        202,
        a2aExposureEtag({ ...draft, status: current.status, exposureHash: current.exposureHash }),
      );
  }
}

async function rebuildAgentCard(
  configuration: ValidatedConfiguration,
  request: typeof fetch,
): Promise<void> {
  const operation = OperationSchema.parse(
    await controlMutation(
      configuration,
      '/api/v1/a2a-agent-card-revisions/rebuild',
      stableKey(configuration.runId, 'agent-card-rebuild'),
      { reason: 'Publish the exact G09 governed main-light v3 Exposures.' },
      request,
    ),
  );
  if (!isRecord(operation.result) || operation.result['status'] !== 'active')
    fail('G09_AGENT_CARD_NOT_ACTIVE', 'Node Control did not activate the rebuilt Agent Card.');
}

async function planTask(
  configuration: ValidatedConfiguration,
  scenario: Scenario,
  client: A2AClient,
  request: typeof fetch,
  randomId: () => string,
  pause: (milliseconds: number) => Promise<void>,
): Promise<PlannedTask> {
  let task = await submitTask(configuration, scenario, client, randomId);
  let preparationRetries = 0;
  for (let interruption = 0; interruption < 6; interruption += 1) {
    if (task.status?.state === TaskState.TASK_STATE_FAILED && preparationRetries < 2) {
      await assertZeroDispatch(configuration, task.id, request);
      preparationRetries += 1;
      await pause(5_000);
      task = await submitTask(configuration, scenario, client, randomId);
      continue;
    }
    if (task.status?.state !== TaskState.TASK_STATE_INPUT_REQUIRED)
      fail('G09_PLAN_CONFIRMATION_NOT_REACHED', 'The A2A Task left the explicit review boundary.');
    const runtimeTask = RuntimeTaskSchema.parse(
      await runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(task.id)}`, request),
    );
    if (runtimeTask.phase === 'awaiting_user_input') {
      assertTaskUnderstanding(
        await runtimeGet(
          configuration,
          `/api/v1/tasks/${encodeURIComponent(task.id)}/understanding`,
          request,
        ),
        task.id,
        scenario,
      );
      task = await submitReviewAcceptance(configuration, client, task, randomId, pause);
      continue;
    }
    if (
      runtimeTask.phase !== 'awaiting_plan_confirmation' ||
      runtimeTask.planId === undefined ||
      runtimeTask.goalId === undefined ||
      runtimeTask.goalVersion === undefined ||
      runtimeTask.selectedSkillId !== scenario.skill.skillId ||
      runtimeTask.selectedSkillVersion !== 3
    )
      fail('G09_PLAN_AUTHORITY_INVALID', 'The Task does not expose the exact confirmable v3 plan.');
    const plan = record(
      await runtimeGet(
        configuration,
        `/api/v1/workflows/plans/${encodeURIComponent(runtimeTask.planId)}`,
        request,
      ),
      'G09_PLAN_AUTHORITY_INVALID',
    );
    const definition = record(plan['definition'], 'G09_PLAN_DEFINITION_INVALID');
    assertHomeLabGovernedLightWorkflowContract(definition, scenario.skill);
    assertScenarioToolArguments(definition, scenario);
    const binding = record(
      await controlGet(
        configuration,
        `/api/v1/tasks/${encodeURIComponent(task.id)}/capability-binding`,
        request,
      ),
      'G09_TASK_CAPABILITY_BINDING_INVALID',
    );
    if (
      binding['taskId'] !== task.id ||
      binding['requestedCapabilityId'] !== scenario.capabilityId ||
      binding['capabilityVersion'] !== 3 ||
      binding['exposureId'] !== scenario.exposureId ||
      binding['exposureVersion'] !== 1 ||
      canonical(binding['initialImplementationRefs']) !==
        canonical([`skill:${scenario.skill.skillId}:3`])
    )
      fail(
        'G09_TASK_CAPABILITY_BINDING_INVALID',
        'The immutable Task Capability binding is not the exact G09 v3 authority.',
      );
    return Object.freeze({ task, runtimeTask, plan });
  }
  fail('G09_INPUT_LOOP_EXCEEDED', 'The bounded G09 cognitive review loop was exceeded.');
}

function assertScenarioToolArguments(
  definition: Readonly<Record<string, unknown>>,
  scenario: Scenario,
): void {
  const expectedNodeId = scenario.kind === 'control' ? 'setPower' : 'readLight';
  const node = records(definition['nodes']).find(
    (candidate) => candidate['nodeId'] === expectedNodeId,
  );
  const argumentsValue = record(node?.['arguments'], 'G09_PLAN_TOOL_ARGUMENTS_INVALID');
  const expected = {
    resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
    ...(scenario.kind === 'control' ? { power: scenario.power } : {}),
  };
  if (canonical(argumentsValue) !== canonical(expected))
    fail(
      'G09_PLAN_TOOL_ARGUMENTS_INVALID',
      'The confirmable G09 plan does not freeze the exact requested public resource and power.',
    );
}

async function submitTask(
  configuration: ValidatedConfiguration,
  scenario: Scenario,
  client: A2AClient,
  randomId: () => string,
): Promise<Task> {
  const structuredInput = Object.freeze({
    resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID,
    ...(scenario.kind === 'control' ? { power: scenario.power } : {}),
  });
  const submitted = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `home-lab-g09-${randomId()}`,
        role: 'ROLE_USER',
        parts: [
          { text: scenario.requestText, mediaType: 'text/plain' },
          {
            data: structuredInput,
            mediaType: 'application/json',
          },
        ],
        metadata: {
          user_id: USER_ID,
          structured_input: structuredInput,
          'io.sdar/requestedCapability': {
            exposureId: scenario.exposureId,
            versionConstraint: '1',
            requestId: `${configuration.runId}:${scenario.kind === 'read' ? 'baseline' : scenario.purpose}`,
          },
        },
      },
      configuration: { returnImmediately: false },
    }),
  );
  if (!('id' in submitted)) fail('G09_A2A_TASK_EXPECTED', 'A2A returned a Message, not a Task.');
  return submitted;
}

async function submitReviewAcceptance(
  configuration: ValidatedConfiguration,
  client: A2AClient,
  task: Task,
  randomId: () => string,
  pause: (milliseconds: number) => Promise<void>,
): Promise<Task> {
  const response = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `home-lab-g09-review-${randomId()}`,
        taskId: task.id,
        contextId: task.contextId,
        role: 'ROLE_USER',
        parts: [
          { text: 'accept', mediaType: 'text/plain' },
          { data: { action: 'accept', payload: {} }, mediaType: 'application/json' },
        ],
        metadata: { user_id: USER_ID, sdar_action: 'provide_input' },
      },
      configuration: { returnImmediately: true },
    }),
  );
  if (!('id' in response)) fail('G09_A2A_TASK_EXPECTED', 'A2A review returned a Message.');
  return pollResponseBoundary(configuration, client, response.id, pause);
}

async function confirmPlan(client: A2AClient, task: Task, randomId: () => string): Promise<Task> {
  const response = await client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `home-lab-g09-plan-confirm-${randomId()}`,
        taskId: task.id,
        contextId: task.contextId,
        role: 'ROLE_USER',
        parts: [{ text: '确认执行该精确受治理计划。', mediaType: 'text/plain' }],
        metadata: { user_id: USER_ID, sdar_action: 'confirm_plan' },
      },
      configuration: { returnImmediately: true },
    }),
  );
  if (!('id' in response)) fail('G09_A2A_TASK_EXPECTED', 'Plan confirmation returned a Message.');
  return response;
}

async function executeReadTask(
  configuration: ValidatedConfiguration,
  client: A2AClient,
  request: typeof fetch,
  randomId: () => string,
  pause: (milliseconds: number) => Promise<void>,
): Promise<Readonly<{ taskId: string; power: LightPower }>> {
  const planned = await planTask(
    configuration,
    HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.read,
    client,
    request,
    randomId,
    pause,
  );
  await assertZeroDispatch(configuration, planned.task.id, request);
  await confirmPlan(client, planned.task, randomId);
  const terminal = await pollTerminalTask(configuration, client, planned.task.id, pause);
  if (terminal.status?.state !== TaskState.TASK_STATE_COMPLETED)
    fail('G09_BASELINE_READ_FAILED', 'The governed baseline read did not complete.');
  const state = structuredLightOutput(terminal);
  const invocations = records(
    CollectionSchema.parse(
      await runtimeGet(
        configuration,
        `/api/v1/mcp/invocations?taskId=${encodeURIComponent(terminal.id)}`,
        request,
      ),
    ).items,
  );
  if (
    invocations.length !== 1 ||
    invocations[0]?.['serverId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    invocations[0]['toolName'] !== 'light_get_state' ||
    invocations[0]['status'] !== 'succeeded'
  )
    fail('G09_BASELINE_READ_EVIDENCE_INVALID', 'The baseline lacks one exact governed read.');
  return Object.freeze({ taskId: terminal.id, power: state.power });
}

async function executeGovernedTask(
  configuration: ValidatedConfiguration,
  scenario: Extract<Scenario, { kind: 'control' }>,
  client: A2AClient,
  request: typeof fetch,
  randomId: () => string,
  pause: (milliseconds: number) => Promise<void>,
  onDispatchRelease: () => void,
): Promise<GovernedTaskEvidence> {
  const planned = await planTask(configuration, scenario, client, request, randomId, pause);
  const planId = requiredText(planned.runtimeTask.planId, 'G09_PLAN_ID_MISSING');
  const released = await releaseGovernedControlAtPausedBarrier({
    taskId: planned.task.id,
    planId,
    expectedPower: scenario.power,
    confirmPlan: () => confirmPlan(client, planned.task, randomId),
    waitForBarrier: () => pollHumanConfirmationBarrier(configuration, planId, request, pause),
    assertZeroMcpInvocations: () =>
      assertZeroMcpInvocations(configuration, planned.task.id, request),
    issueConfirmation: () => issueGovernedConfirmation(configuration, planned.task.id, request),
    resume: async (instanceId) => {
      onDispatchRelease();
      await runtimeMutation(
        configuration,
        `/api/v1/workflows/instances/${encodeURIComponent(instanceId)}/human-confirmation`,
        { confirmed: true },
        request,
      );
      await assertSameInstanceResumeRejectedWithoutRedispatch(
        configuration,
        instanceId,
        planned.task.id,
        request,
      );
    },
  });
  const terminal =
    released.task.status?.state !== undefined && TERMINAL_STATES.has(released.task.status.state)
      ? released.task
      : await pollTerminalTask(configuration, client, planned.task.id, pause);
  if (terminal.status?.state !== TaskState.TASK_STATE_COMPLETED)
    fail('G09_CONTROL_TASK_FAILED', 'The governed control Task did not complete.');
  const state = structuredLightOutput(terminal);
  if (state.power !== scenario.power || state['confirmed'] === false)
    fail(
      'G09_CONTROL_RESULT_INVALID',
      'The control result does not confirm exact requested power.',
    );
  return collectGovernedTaskEvidence(
    configuration,
    scenario,
    terminal,
    planId,
    released.instanceId,
    released.confirmationId,
    request,
  );
}

async function collectGovernedTaskEvidence(
  configuration: ValidatedConfiguration,
  scenario: Extract<Scenario, { kind: 'control' }>,
  task: Task,
  planId: string,
  workflowInstanceId: string,
  confirmationId: string,
  request: typeof fetch,
): Promise<GovernedTaskEvidence> {
  const invocations = records(
    CollectionSchema.parse(
      await runtimeGet(
        configuration,
        `/api/v1/mcp/invocations?taskId=${encodeURIComponent(task.id)}`,
        request,
      ),
    ).items,
  );
  const invocation = invocations[0];
  if (
    invocations.length !== 1 ||
    invocation?.['serverId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    invocation['toolName'] !== 'light_set_power' ||
    invocation['status'] !== 'succeeded' ||
    invocation['executionMode'] !== 'live' ||
    canonical(invocation['arguments']) !==
      canonical({ resourceId: HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID, power: scenario.power }) ||
    invocation['controlConfirmationId'] !== confirmationId ||
    invocation['controlProviderBindingId'] !== HOME_LAB_GOVERNED_LIGHT_BINDING_ID ||
    typeof invocation['controlArgumentsHash'] !== 'string' ||
    !CHECKSUM.test(invocation['controlArgumentsHash']) ||
    typeof invocation['controlDispatchHash'] !== 'string' ||
    !SHA256_REF.test(invocation['controlDispatchHash'])
  )
    fail('G09_MCP_INVOCATION_INVALID', 'Expected one exact successful live light_set_power.');
  const invocationId = requiredText(invocation['invocationId'], 'G09_MCP_INVOCATION_ID_MISSING');
  const lifecycle = record(
    await runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(task.id)}/remote-task-lifecycle`,
      request,
    ),
    'G09_REMOTE_TASK_LIFECYCLE_INVALID',
  );
  const items = records(lifecycle['items'] ?? []);
  const item = items[0];
  const binding = record(item?.['binding'], 'G09_REMOTE_TASK_BINDING_INVALID');
  const finalOutcome = record(item?.['finalOutcome'], 'G09_REMOTE_TASK_OUTCOME_INVALID');
  const continuations = records(item?.['continuations'] ?? []);
  const observations = records(item?.['observations'] ?? []);
  const result = record(finalOutcome['result'], 'G09_REMOTE_TASK_OUTCOME_INVALID');
  const evidence = records(result['evidence'] ?? []);
  if (
    items.length !== 1 ||
    binding['agentTaskId'] !== task.id ||
    binding['workflowPlanId'] !== planId ||
    binding['workflowInstanceId'] !== workflowInstanceId ||
    binding['serverId'] !== HOME_LAB_GOVERNED_LIGHT_SERVER_ID ||
    binding['operationName'] !== 'light_set_power' ||
    binding['mcpInvocationId'] !== invocationId ||
    binding['protocolStatus'] !== 'completed' ||
    finalOutcome['providerStatus'] !== 'completed' ||
    finalOutcome['authoritative'] !== true ||
    continuations.length === 0 ||
    observations.length === 0 ||
    evidence.length === 0 ||
    !evidence.some((candidate) => candidate['evidenceType'] === 'light.state.observation')
  )
    fail(
      'G09_REMOTE_TASK_EVIDENCE_INVALID',
      'RemoteTask, Continuation and terminal Provider Evidence are not all exact and durable.',
    );
  return Object.freeze({
    taskId: task.id,
    contextId: task.contextId,
    planId,
    workflowInstanceId,
    confirmationId,
    mcpInvocationId: invocationId,
    remoteTaskId: requiredText(binding['remoteTaskId'], 'G09_REMOTE_TASK_ID_MISSING'),
    continuationCount: continuations.length,
    evidenceCount: evidence.length,
    power: structuredLightOutput(task).power,
    purpose: scenario.purpose,
    idempotencyReplay: 'same_instance_resume_rejected_no_redispatch',
  });
}

async function assertSameInstanceResumeRejectedWithoutRedispatch(
  configuration: ValidatedConfiguration,
  instanceId: string,
  taskId: string,
  request: typeof fetch,
): Promise<void> {
  const replay = await request(
    `${configuration.runtimeManagementBaseUrl}/api/v1/workflows/instances/${encodeURIComponent(instanceId)}/human-confirmation`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
      redirect: 'manual',
    },
  );
  if (replay.ok) {
    await replay.body?.cancel();
    fail(
      'G09_IDEMPOTENCY_REPLAY_ACCEPTED',
      'The same Workflow confirmation resume was accepted after dispatch release.',
    );
  }
  await replay.body?.cancel();
  const invocations = CollectionSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
      request,
    ),
  ).items;
  if (invocations.length > 1)
    fail('G09_IDEMPOTENCY_REDISPATCHED', 'Same-instance replay created a second MCP dispatch.');
}

async function pollHumanConfirmationBarrier(
  configuration: ValidatedConfiguration,
  planId: string,
  request: typeof fetch,
  pause: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    const response = await request(
      `${configuration.runtimeManagementBaseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/trace`,
      { redirect: 'manual' },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      await pause(configuration.pollIntervalMs);
      continue;
    }
    const trace = await responseJson(response, 200);
    const view = record(trace, 'G09_WORKFLOW_TRACE_INVALID');
    const instance = isRecord(view['instance']) ? view['instance'] : undefined;
    if (
      instance?.['status'] === 'paused' &&
      isRecord(instance['pendingConfirmation']) &&
      instance['pendingConfirmation']['nodeId'] === 'confirmControl'
    )
      return trace;
    if (instance?.['status'] === 'failed')
      fail('G09_WORKFLOW_FAILED_BEFORE_BARRIER', 'The Workflow failed before the control barrier.');
    await pause(configuration.pollIntervalMs);
  }
  fail('G09_WORKFLOW_BARRIER_TIMEOUT', 'The exact governed-control barrier was not observed.');
}

async function issueGovernedConfirmation(
  configuration: ValidatedConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<unknown> {
  if (configuration.governedControlBearerToken === undefined)
    fail(
      'G09_GOVERNED_CONTROL_TOKEN_REQUIRED',
      'Execute mode requires human confirmation identity.',
    );
  return responseJson(
    await request(
      `${configuration.runtimeManagementBaseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/governed-control-confirmations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${configuration.governedControlBearerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reason: `G09 exact task-scoped physical-control confirmation for ${configuration.runId}.`,
          ttlMs: 300_000,
        }),
        redirect: 'manual',
      },
    ),
    201,
  );
}

async function assertZeroDispatch(
  configuration: ValidatedConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<void> {
  await assertZeroMcpInvocations(configuration, taskId, request);
  const lifecycle = record(
    await runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/remote-task-lifecycle`,
      request,
    ),
    'G09_REMOTE_TASK_LIFECYCLE_INVALID',
  );
  if (records(lifecycle['items'] ?? []).length !== 0)
    fail('G09_REMOTE_TASK_BEFORE_CONFIRMATION', 'A RemoteTask exists before confirmation.');
}

async function assertZeroMcpInvocations(
  configuration: ValidatedConfiguration,
  taskId: string,
  request: typeof fetch,
): Promise<void> {
  const collection = CollectionSchema.parse(
    await runtimeGet(
      configuration,
      `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
      request,
    ),
  );
  if (collection.items.length !== 0)
    fail('G09_MCP_BEFORE_CONFIRMATION', 'MCP execution occurred before exact confirmations.');
}

function assertTaskUnderstanding(value: unknown, taskId: string, scenario: Scenario): void {
  const understanding = record(value, 'G09_TASK_UNDERSTANDING_INVALID');
  const requirements = records(understanding['capabilityRequirements'] ?? []);
  const candidates = records(understanding['taskTypeCandidates'] ?? []);
  const blocking = records(understanding['missingDimensions'] ?? []).filter(
    (candidate) => candidate['severity'] === 'blocking',
  );
  if (
    understanding['taskId'] !== taskId ||
    understanding['originalRequest'] !== scenario.requestText ||
    understanding['disposition'] !== 'contract_candidate' ||
    requirements.length !== 1 ||
    requirements[0]?.['capabilityId'] !== scenario.capabilityId ||
    requirements[0]['required'] !== true ||
    requirements[0]['available'] !== true ||
    candidates.length !== 1 ||
    candidates[0]?.['taskTypeId'] !== scenario.taskTypeId ||
    candidates[0]['version'] !== 3 ||
    blocking.length !== 0
  )
    fail('G09_TASK_UNDERSTANDING_INVALID', 'The exact v3 Task Understanding was not preserved.');
}

function structuredLightOutput(task: Task): Readonly<Record<string, unknown>> & {
  readonly power: LightPower;
} {
  const values: unknown[] = [];
  for (const artifact of task.artifacts)
    for (const part of artifact.parts)
      if (part.content?.$case === 'data') values.push(part.content.value as unknown);
  if (values.length !== 1)
    fail('G09_STRUCTURED_OUTCOME_MISSING', 'The terminal Task requires one data Artifact.');
  const value = record(values[0], 'G09_STRUCTURED_OUTCOME_INVALID');
  const power = lightPower(value['power']);
  if (
    value['resourceId'] !== HOME_LAB_GOVERNED_LIGHT_RESOURCE_ID ||
    value['reachable'] === false ||
    (value['observedAt'] !== undefined &&
      (typeof value['observedAt'] !== 'string' ||
        !Number.isFinite(Date.parse(value['observedAt']))))
  )
    fail('G09_STRUCTURED_OUTCOME_INVALID', 'The exact public main-light state is invalid.');
  return Object.freeze({ ...value, power });
}

function controlScenario(
  purpose: 'set' | 'restore',
  power: LightPower,
): Extract<Scenario, { kind: 'control' }> {
  return Object.freeze({
    ...HOME_LAB_G09_GOVERNED_LIGHT_SCENARIOS.control,
    purpose,
    power,
    requestText: `${purpose === 'set' ? '设置' : '恢复'}主灯电源为 ${power}`,
  });
}

function reportBase(
  configuration: ValidatedConfiguration,
  observedAt: string,
  writeGate: HomeLabG09GovernedLightReport['writeGate'],
  branch:
    | Pick<HomeLabG09GovernedLightReport, 'dryRun'>
    | Pick<HomeLabG09GovernedLightReport, 'execution'>,
): HomeLabG09GovernedLightReport {
  return Object.freeze({
    schemaVersion: 'sdar.home-lab-g09-governed-light/v1',
    status: configuration.mode === 'dry-run' ? 'dry_run_passed' : 'passed',
    mode: configuration.mode,
    observedAt,
    runIdHash: sha256(configuration.runId),
    authority: Object.freeze({
      sourceId: 'home-lab-smpp-g09-019fca75',
      bindingId: HOME_LAB_GOVERNED_LIGHT_BINDING_ID,
      serverId: HOME_LAB_GOVERNED_LIGHT_SERVER_ID,
      capabilityVersions: Object.freeze([3, 3] as const),
      skillVersions: Object.freeze([3, 3] as const),
    }),
    writeGate,
    ...branch,
  });
}

function assertWriteGate(
  configuration: ValidatedConfiguration,
  environment: NodeJS.ProcessEnv,
): HomeLabG09GovernedLightReport['writeGate'] {
  if (configuration.mode === 'dry-run') {
    if (
      environment['ALLOW_REAL_DEVICE_SIDE_EFFECTS'] === 'YES' ||
      nonEmpty(environment['REAL_DEVICE_TEST_RUN_ID'])
    )
      fail('G09_DRY_RUN_WRITE_GATE_OPEN', 'Dry-run requires both real-device write gates closed.');
    return 'closed';
  }
  if (
    environment['ALLOW_REAL_DEVICE_SIDE_EFFECTS'] !== 'YES' ||
    environment['REAL_DEVICE_TEST_RUN_ID'] !== configuration.runId
  )
    fail(
      'G09_REAL_DEVICE_WRITE_GATE_CLOSED',
      'Execute mode requires YES plus the exact unique REAL_DEVICE_TEST_RUN_ID.',
    );
  if (!nonEmpty(configuration.governedControlBearerToken))
    fail(
      'G09_GOVERNED_CONTROL_TOKEN_REQUIRED',
      'Execute mode requires human confirmation identity.',
    );
  return 'open_for_exact_run';
}

function validateConfiguration(
  input: HomeLabG09GovernedLightConfiguration,
): ValidatedConfiguration {
  const a2aBaseUrl = loopbackUrl(input.a2aBaseUrl, 'G09_A2A_URL_INVALID');
  const runtimeManagementBaseUrl = loopbackUrl(
    input.runtimeManagementBaseUrl,
    'G09_MANAGEMENT_URL_INVALID',
  );
  const nodeControlBaseUrl = loopbackUrl(input.nodeControlBaseUrl, 'G09_NODE_CONTROL_URL_INVALID');
  if (!nonEmpty(input.nodeControlBearerToken))
    fail('G09_NODE_CONTROL_TOKEN_REQUIRED', 'Node Control bearer identity is required.');
  if (!/^[A-Za-z0-9._:-]{8,256}$/u.test(input.runId))
    fail('G09_RUN_ID_INVALID', 'A unique bounded G09 runId is required.');
  if (input.dryRunPower !== undefined && input.dryRunPower !== 'on' && input.dryRunPower !== 'off')
    fail('G09_POWER_INVALID', 'Dry-run power must be on or off.');
  const pollIntervalMs = input.pollIntervalMs ?? 100;
  const maxPolls = input.maxPolls ?? 1_200;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10)
    fail('G09_POLL_CONFIGURATION_INVALID', 'Poll interval must be at least 10 ms.');
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 10_000)
    fail('G09_POLL_CONFIGURATION_INVALID', 'Poll count is outside the bounded range.');
  return Object.freeze({
    mode: input.mode,
    a2aBaseUrl,
    runtimeManagementBaseUrl,
    nodeControlBaseUrl,
    nodeControlBearerToken: input.nodeControlBearerToken,
    ...(input.governedControlBearerToken === undefined
      ? {}
      : { governedControlBearerToken: input.governedControlBearerToken }),
    runId: input.runId,
    dryRunPower: input.dryRunPower ?? 'off',
    pollIntervalMs,
    maxPolls,
  });
}

async function pollTerminalTask(
  configuration: ValidatedConfiguration,
  client: A2AClient,
  taskId: string,
  pause: (milliseconds: number) => Promise<void>,
): Promise<Task> {
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    const task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state;
    if (state !== undefined && TERMINAL_STATES.has(state)) return task;
    await pause(configuration.pollIntervalMs);
  }
  fail('G09_TASK_TIMEOUT', 'The G09 Task did not reach a terminal boundary.');
}

async function pollResponseBoundary(
  configuration: ValidatedConfiguration,
  client: A2AClient,
  taskId: string,
  pause: (milliseconds: number) => Promise<void>,
): Promise<Task> {
  for (let attempt = 0; attempt < configuration.maxPolls; attempt += 1) {
    const task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state;
    if (
      state === TaskState.TASK_STATE_INPUT_REQUIRED ||
      (state !== undefined && TERMINAL_STATES.has(state))
    )
      return task;
    await pause(configuration.pollIntervalMs);
  }
  fail('G09_TASK_TIMEOUT', 'The G09 Task did not reach the next A2A response boundary.');
}

async function createClient(
  baseUrl: string,
  factory: DriverDependencies['createA2AClient'],
): Promise<A2AClient> {
  return factory === undefined ? new ClientFactory().createFromUrl(baseUrl) : factory(baseUrl);
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

async function runtimeMutation(
  configuration: ValidatedConfiguration,
  path: string,
  body: unknown,
  request: typeof fetch,
): Promise<unknown> {
  return responseJson(
    await request(`${configuration.runtimeManagementBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
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
      const value = record(await response.json(), 'G09_HTTP_ERROR_BODY_INVALID');
      if (typeof value['code'] === 'string') code = value['code'];
      else if (isRecord(value['error']) && typeof value['error']['code'] === 'string')
        code = value['error']['code'];
    } catch {
      // Never reflect response bodies because they can contain endpoints or credentials.
    }
    fail(
      'G09_HTTP_REQUEST_REJECTED',
      `A required API request failed with ${code} and status ${String(response.status)}.`,
    );
  }
  return response.json();
}

function exactlyOneTool(
  tools: readonly z.infer<typeof ToolSchema>[],
  toolName: string,
): z.infer<typeof ToolSchema> {
  const matches = tools.filter((tool) => tool.toolName === toolName);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    fail('G09_TOOL_AUTHORITY_INVALID', `Expected exactly one ${toolName} Tool.`);
  return match;
}

function exactlyOneConstraint(
  constraints: readonly Readonly<Record<string, unknown>>[],
  type: string,
): Readonly<Record<string, unknown>> {
  const matches = constraints.filter((constraint) => constraint['type'] === type);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    fail('G09_CONTROL_AUTHORITY_INVALID', `Expected exactly one ${type} constraint.`);
  return match;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value)) fail('G09_ARRAY_REQUIRED', 'Expected an array response.');
  return value.map((item) => record(item, 'G09_RECORD_REQUIRED'));
}

function record(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(code, 'Expected a JSON object.');
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(code, 'Expected non-empty text.');
  return value;
}

function lightPower(value: unknown): LightPower {
  if (value !== 'on' && value !== 'off')
    fail('G09_POWER_INVALID', 'Main-light power must be on or off.');
  return value;
}

function validTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) fail('G09_CLOCK_INVALID', 'Timestamp is invalid.');
  return value;
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableKey(runId: string, operation: string): string {
  return `g09-${sha256(`${runId}:${operation}`).slice(0, 40)}`;
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
    fail(code, 'The G09 driver accepts only credential-free loopback HTTP URLs.');
  return url.origin;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function fail(code: string, message: string): never {
  throw new HomeLabG09GovernedLightError(code, message);
}

export class HomeLabG09GovernedLightError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'HomeLabG09GovernedLightError';
  }
}

export function configurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): HomeLabG09GovernedLightConfiguration {
  const mode = environment['SDAR_G09_MODE'] ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'execute')
    fail('G09_MODE_INVALID', 'SDAR_G09_MODE must be dry-run or execute.');
  const dryRunPower = environment['SDAR_G09_DRY_RUN_POWER'];
  if (dryRunPower !== undefined && dryRunPower !== 'on' && dryRunPower !== 'off')
    fail('G09_POWER_INVALID', 'SDAR_G09_DRY_RUN_POWER must be on or off.');
  return {
    mode,
    a2aBaseUrl: environment['SDAR_A2A_URL'] ?? 'http://127.0.0.1:29999',
    runtimeManagementBaseUrl: environment['SDAR_MANAGEMENT_URL'] ?? 'http://127.0.0.1:29998',
    nodeControlBaseUrl: environment['SDAR_NODE_CONTROL_URL'] ?? 'http://127.0.0.1:20080',
    nodeControlBearerToken: environment['SDAR_NODE_CONTROL_BEARER_TOKEN'] ?? '',
    ...(environment['SDAR_GOVERNED_CONTROL_BEARER_TOKEN'] === undefined
      ? {}
      : { governedControlBearerToken: environment['SDAR_GOVERNED_CONTROL_BEARER_TOKEN'] }),
    runId: environment['SDAR_G09_RUN_ID'] ?? '',
    ...(dryRunPower === undefined ? {} : { dryRunPower }),
  };
}

async function main(): Promise<void> {
  try {
    const report = await runHomeLabG09GovernedLight(configurationFromEnvironment());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error: unknown) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'failed',
        code:
          error instanceof HomeLabG09GovernedLightError
            ? error.code
            : 'G09_GOVERNED_LIGHT_DRIVER_FAILED',
        ...(error instanceof HomeLabG09GovernedLightError ? { reason: error.message } : {}),
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
