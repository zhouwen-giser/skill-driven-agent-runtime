import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  createRuntimeExecutionContext,
  type RuntimeExecutionContext,
} from '../../../packages/domain/src/index.js';
import {
  assertSafeRedactedJson,
  canonical,
  deriveUgvReadOnlyTargets,
  loadUgvReadOnlyAuthority,
  loadUgvReadOnlyGovernanceAuthority,
  object,
  requestJson,
  safeManagementBaseUrl,
  sha256Json,
  stableIdentifier,
  validTimestamp,
  writeRedactedUgvReport,
  type UgvReadOnlyAuthorityConfiguration,
  type UgvReadOnlyAuthoritySnapshot,
  type UgvReadOnlyGovernanceAuthority,
  type UgvReadOnlyOperationName,
} from './ugv-smpp-read-only-authority.js';

const PROVIDER_TIMESTAMP = z.iso.datetime({ offset: true });
const ReadOnlyOperationSchema = z.enum([
  'vehicle_get_state',
  'vehicle_get_capabilities',
  'vehicle_get_payload_status',
  'vehicle_get_targets',
  'vehicle_laser_range',
]);

export interface UgvDeterministicReadOnlyConfiguration extends UgvReadOnlyAuthorityConfiguration {
  readonly mode?: 'execute' | 'verify-restart';
  readonly runtimeCognitiveBearerToken: string;
  readonly governanceReportFile: string;
  readonly runId: string;
  readonly executionMode?: 'live' | 'simulation';
  readonly simulationId?: string;
  readonly checkpointFile?: string;
  readonly restartEvidenceId?: string;
}

export interface UgvDeterministicReadOnlyReport {
  readonly schemaVersion: 'sdar.ugv-smpp-deterministic-read-only/v1';
  readonly status: 'passed';
  readonly evidenceClass:
    'real_live_sdar_and_external_smpp' | 'real_simulation_sdar_and_external_smpp';
  readonly observedAt: string;
  readonly mode: 'execute' | 'verify-restart';
  readonly executionMode: 'live' | 'simulation';
  readonly simulationId?: string;
  readonly deterministicReadOnlyReady: boolean;
  readonly restartRecoveryVerified: boolean;
  readonly restartEvidenceSha256?: string;
  readonly executions: readonly Readonly<{
    operationName: UgvReadOnlyOperationName;
    executionMode: 'live' | 'simulation';
    simulationId?: string;
    taskId: string;
    contextId: string;
    goalId: string;
    goalVersion: number;
    workflowPlanId: string;
    workflowInstanceId: string;
    skillExecutionId: string;
    capabilityId: string;
    capabilityVersion: number;
    capabilityDefinitionHash: string;
    capabilityBindingId: string;
    capabilityBindingVersion: number;
    skillId: string;
    skillVersion: number;
    mcpInvocationId: string;
    resourceId: string;
    providerBinding: Readonly<{
      bindingId: string;
      revision: number;
      providerId: string;
      localServerId: string;
    }>;
    smppLineage: Readonly<{
      smppSourceId: string;
      externalProviderId: string;
      externalServerId: string;
      registryRevision: number;
      registryChecksum: string;
      nativeRevision: number;
      nativeChecksum: string;
      projectionContract: 'sdar-registry-v1';
    }>;
    catalog: Readonly<{
      revision: string;
      checksum: string;
      operationCount: number;
      schemaAlignment: true;
      executionSemantics: 'explicit_read_only_synchronous';
      readinessAttributes: readonly string[];
    }>;
    evidence: readonly Readonly<{
      evidenceId: string;
      evidenceType: string;
      observedAt: string;
      subjectRef: string;
      payloadKind: string;
    }>[];
    structuredResultSha256: string;
    schemaValidated: true;
    idempotentReplayVerified: true;
    remoteTaskCount: 0;
  }>[];
  readonly safety: Readonly<{
    modelCalls: 0;
    physicalWrites: 0;
    mcpCalls: number;
    executionMode: 'live' | 'simulation';
    onlyExplicitReadOnlyTools: true;
    writeGateRequired: false;
  }>;
  readonly redaction: Readonly<{
    secretsIncluded: false;
    endpointsIncluded: false;
    downstreamDeviceIdsIncluded: false;
  }>;
}

interface UgvDeterministicReadOnlyCheckpoint {
  readonly schemaVersion: 'sdar.ugv-smpp-deterministic-read-only-checkpoint/v1';
  readonly runId: string;
  readonly executionMode: 'live' | 'simulation';
  readonly simulationId?: string | undefined;
  readonly createdAt: string;
  readonly executions: readonly Readonly<{
    operationName: UgvReadOnlyOperationName;
    taskId: string;
    contextId: string;
    workflowPlanId: string;
    workflowInstanceId: string;
    mcpInvocationId: string;
    executionHash: string;
    structuredResultSha256: string;
  }>[];
}

const CheckpointSchema: z.ZodType<UgvDeterministicReadOnlyCheckpoint> = z
  .object({
    schemaVersion: z.literal('sdar.ugv-smpp-deterministic-read-only-checkpoint/v1'),
    runId: z.string().min(8).max(128),
    executionMode: z.enum(['live', 'simulation']),
    simulationId: z.string().min(1).max(256).optional(),
    createdAt: PROVIDER_TIMESTAMP,
    executions: z.array(
      z
        .object({
          operationName: ReadOnlyOperationSchema,
          taskId: z.string().min(1),
          contextId: z.string().min(1),
          workflowPlanId: z.string().min(1),
          workflowInstanceId: z.string().min(1),
          mcpInvocationId: z.string().min(1),
          executionHash: z.string().regex(/^[a-f0-9]{64}$/u),
          structuredResultSha256: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .strict(),
    ),
  })
  .strict();

export class UgvDeterministicReadOnlyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UgvDeterministicReadOnlyError';
    this.code = code;
  }
}

const PayloadRefSchema = z
  .object({
    kind: z.string().min(1),
    jsonPointer: z.string().optional(),
    uri: z.string().optional(),
  })
  .loose();
const ProviderEvidenceSchema = z
  .object({
    evidenceId: z.string().min(1),
    evidenceType: z.string().min(1),
    observedAt: PROVIDER_TIMESTAMP,
    subjectRef: z.string().min(1),
    producer: z.array(z.string().min(1)).min(1),
    payloadRef: PayloadRefSchema,
  })
  .strict();
const ExecutionResponseSchema = z
  .object({
    schemaVersion: z.literal('sdar.deterministic-read-only-capability-execution/v1'),
    status: z.literal('succeeded'),
    execution: z
      .object({
        taskId: z.string().min(1),
        capabilityBindingId: z.string().min(1),
        capabilityBindingVersion: z.number().int().positive(),
        capabilityId: z.string().min(1),
        capabilityVersion: z.number().int().positive(),
        skillId: z.string().min(1),
        skillVersion: z.number().int().positive(),
        workflowPlanId: z.string().min(1),
        workflowInstanceId: z.string().min(1),
        mcpProviderBindingId: z.string().min(1),
        mcpInvocationId: z.string().min(1),
        providerId: z.string().min(1),
        serverId: z.string().min(1),
        toolName: z.string().min(1),
        resourceId: z.string().min(1),
      })
      .strict(),
    result: z.record(z.string(), z.unknown()),
    evidence: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          evidenceType: z.string().min(1),
          required: z.boolean(),
          hardGate: z.boolean(),
          satisfied: z.boolean(),
          evidenceId: z.string().optional(),
          observedAt: PROVIDER_TIMESTAMP.optional(),
          payloadRef: PayloadRefSchema.optional(),
        })
        .strict(),
    ),
    safety: z
      .object({
        executionMode: z.enum(['live', 'simulation']),
        simulationId: z.string().min(1).max(256).optional(),
        physicalWrites: z.literal(0),
        modelCalls: z.literal(0),
        mcpCalls: z.literal(1),
        identifierAuthority: z.literal('public_resource_id'),
      })
      .strict(),
  })
  .strict();
type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

const TaskSchema = z
  .object({
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    requestMetadata: z.record(z.string(), z.unknown()),
    phase: z.literal('completed'),
    goalId: z.string().min(1),
    goalVersion: z.number().int().positive(),
    planId: z.string().min(1),
    selectedSkillId: z.string().min(1),
    selectedSkillVersion: z.number().int().positive(),
    skillSelectionId: z.string().min(1),
    skillInputResolutionId: z.string().min(1),
    output: z.object({ text: z.string().min(1), structured: z.unknown() }).strict(),
  })
  .loose();
const SkillExecutionSchema = z
  .object({
    executionId: z.string().min(1),
    taskId: z.string().min(1),
    goalId: z.string().min(1),
    goalVersion: z.number().int().positive(),
    skillId: z.string().min(1),
    skillVersion: z.number().int().positive(),
    workflowPlanId: z.string().min(1),
    status: z.literal('completed'),
    references: z.array(z.record(z.string(), z.unknown())),
  })
  .loose();
const TraceSchema = z
  .object({
    instance: z
      .object({
        instanceId: z.string().min(1),
        planId: z.string().min(1),
        goalId: z.string().min(1),
        goalVersion: z.number().int().positive(),
        skillVersions: z.array(
          z.object({ skillId: z.string().min(1), version: z.number().int().positive() }),
        ),
        budgetUsage: z.object({ llmCalls: z.number().int(), mcpCalls: z.number().int() }).loose(),
        status: z.literal('succeeded'),
        input: z.unknown(),
        result: z.unknown(),
      })
      .loose(),
    events: z.array(z.unknown()),
  })
  .strict();
const InvocationSchema = z
  .object({
    invocationId: z.string().min(1),
    taskId: z.string().min(1),
    contextId: z.string().min(1),
    capabilityAttemptId: z.string().optional(),
    executionMode: z.enum(['live', 'simulation']),
    simulationId: z.string().min(1).max(256).optional(),
    serverId: z.string().min(1),
    toolName: z.string().min(1),
    executionSemantics: z.record(z.string(), z.unknown()),
    arguments: z.record(z.string(), z.unknown()),
    result: z
      .object({
        structuredContent: z.record(z.string(), z.unknown()),
        isError: z.literal(false),
        evidence: z.array(ProviderEvidenceSchema),
      })
      .loose(),
    status: z.literal('succeeded'),
  })
  .loose();

export async function executeUgvDeterministicReadOnly(
  input: UgvDeterministicReadOnlyConfiguration,
  dependencies: Readonly<{
    fetch?: typeof fetch;
    now?: () => string;
    /** Unit-fixture seam only; the CLI always loads the persisted S5 authority report. */
    governanceAuthority?: UgvReadOnlyGovernanceAuthority;
  }> = {},
): Promise<UgvDeterministicReadOnlyReport> {
  const configuration = validateConfiguration(input);
  const request = dependencies.fetch ?? fetch;
  const observedAt = validTimestamp(dependencies.now?.() ?? new Date().toISOString());
  const governance =
    dependencies.governanceAuthority ??
    (await loadUgvReadOnlyGovernanceAuthority(configuration.governanceReportFile));
  const targets = deriveUgvReadOnlyTargets(governance);
  // Resolve the entire execution set before any POST can reach the Runtime execution plane.
  const authorities = await Promise.all(
    targets.map((target) =>
      loadUgvReadOnlyAuthority(configuration, governance, target, observedAt, request),
    ),
  );
  if (configuration.mode === 'verify-restart')
    return verifyRestartRecovery(configuration, authorities, observedAt, request);
  const executions = [];
  for (const authority of authorities)
    executions.push(await executeOne(configuration, authority, request));
  const report = buildReport(configuration, 'execute', observedAt, executions);
  if (configuration.checkpointFile !== undefined)
    await writeRedactedUgvReport(
      configuration.checkpointFile,
      checkpoint(configuration.runId, observedAt, executions),
    );
  return report;
}

async function executeOne(
  configuration: UgvDeterministicReadOnlyConfiguration,
  authority: UgvReadOnlyAuthoritySnapshot,
  request: typeof fetch,
): Promise<UgvDeterministicReadOnlyReport['executions'][number]> {
  const { target, binding } = authority;
  const taskId = stableIdentifier('task-ugv-read', configuration.runId, target.toolName);
  const contextId = stableIdentifier('context-ugv-read', configuration.runId, target.toolName);
  const executionContext = deterministicExecutionContext(configuration);
  const body = Object.freeze({
    taskId,
    contextId,
    capabilityBindingId: target.capabilityBindingId,
    capabilityBindingVersion: target.capabilityBindingVersion,
    capabilityId: target.capabilityId,
    capabilityVersion: target.capabilityVersion,
    skillId: target.skillId,
    skillVersion: target.skillVersion,
    mcpProviderBindingId: target.mcpProviderBindingId,
    providerId: binding.binding.externalProviderId,
    serverId: target.localServerId,
    toolName: target.toolName,
    resourceId: target.resourceId,
    executionMode: executionContext.mode as 'live' | 'simulation',
    ...(executionContext.simulationId === undefined
      ? {}
      : { simulationId: executionContext.simulationId }),
  });
  const execute = () =>
    requestJson(
      `${configuration.runtimeManagementBaseUrl}/api/v1/capability-executions/deterministic`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${configuration.runtimeCognitiveBearerToken}`,
          'content-type': 'application/json',
          'idempotency-key': taskId,
        },
        body: JSON.stringify(body),
        redirect: 'manual',
      },
      request,
      201,
    );
  const response = parse(
    ExecutionResponseSchema,
    await execute(),
    'UGV_DETERMINISTIC_EXECUTION_RESPONSE_INVALID',
  );
  const replay = parse(
    ExecutionResponseSchema,
    await execute(),
    'UGV_DETERMINISTIC_REPLAY_RESPONSE_INVALID',
  );
  if (canonical(response) !== canonical(replay))
    fail('UGV_DETERMINISTIC_REPLAY_DRIFT', 'Idempotent replay returned different authority.');
  assertExecutionResponse(response, authority, taskId, executionContext);
  return collectPersistedExecution(configuration, authority, response, request);
}

async function collectPersistedExecution(
  configuration: UgvDeterministicReadOnlyConfiguration,
  authority: UgvReadOnlyAuthoritySnapshot,
  response: ExecutionResponse,
  request: typeof fetch,
): Promise<UgvDeterministicReadOnlyReport['executions'][number]> {
  const { target, binding } = authority;
  const { taskId } = response.execution;
  const contextId = stableIdentifier('context-ugv-read', configuration.runId, target.toolName);
  const [
    taskValue,
    goalValue,
    planValue,
    skillExecutionsValue,
    traceValue,
    invocationsValue,
    modelsValue,
    remoteValue,
  ] = await Promise.all([
    runtimeGet(configuration, `/api/v1/tasks/${encodeURIComponent(taskId)}`, request),
    runtimeGet(
      configuration,
      `/api/v1/goals/${encodeURIComponent(deterministicGoalId(taskId))}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/workflows/plans/${encodeURIComponent(response.execution.workflowPlanId)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/skill-executions`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/workflows/plans/${encodeURIComponent(response.execution.workflowPlanId)}/trace`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/mcp/invocations?taskId=${encodeURIComponent(taskId)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/models/invocations?taskId=${encodeURIComponent(taskId)}`,
      request,
    ),
    runtimeGet(
      configuration,
      `/api/v1/tasks/${encodeURIComponent(taskId)}/remote-task-lifecycle`,
      request,
    ),
  ]);
  const task = parse(TaskSchema, taskValue, 'UGV_DETERMINISTIC_TASK_INVALID');
  const goal = object(goalValue);
  const plan = object(planValue);
  const skillExecutions = parse(
    z.object({ items: z.array(SkillExecutionSchema) }).loose(),
    skillExecutionsValue,
    'UGV_DETERMINISTIC_SKILL_EXECUTION_INVALID',
  ).items;
  const trace = parse(TraceSchema, traceValue, 'UGV_DETERMINISTIC_TRACE_INVALID');
  const invocations = parse(
    z.object({ items: z.array(InvocationSchema) }).loose(),
    invocationsValue,
    'UGV_DETERMINISTIC_INVOCATION_INVALID',
  ).items;
  const models = parse(
    z.object({ items: z.array(z.unknown()) }),
    modelsValue,
    'UGV_MODEL_AUDIT_INVALID',
  );
  const remote = parse(
    z.object({ items: z.array(z.unknown()) }).loose(),
    remoteValue,
    'UGV_REMOTE_TASK_AUDIT_INVALID',
  );
  const skillExecution = skillExecutions[0];
  const invocation = invocations[0];
  if (
    goal === undefined ||
    plan === undefined ||
    skillExecutions.length !== 1 ||
    skillExecution === undefined ||
    invocations.length !== 1 ||
    invocation === undefined ||
    models.items.length !== 0 ||
    remote.items.length !== 0
  )
    fail(
      'UGV_DETERMINISTIC_LINEAGE_INCOMPLETE',
      'Task/Goal/Plan/Skill/LangGraph/MCP lineage is incomplete or not zero-model synchronous.',
    );
  assertTaskLineage(
    task,
    goal,
    plan,
    skillExecution,
    trace,
    response,
    authority,
    taskId,
    contextId,
  );
  const evidence = assertInvocation(invocation, response, authority, taskId, contextId);
  validateSchema(authority.capability.outputSchema, response.result, 'UGV_CAPABILITY_OUTPUT');
  validateSchema(authority.skill.outputSchema, response.result, 'UGV_SKILL_OUTPUT');
  validateSchema(authority.tool.outputSchema, response.result, 'UGV_TOOL_OUTPUT');
  return Object.freeze({
    operationName: target.toolName,
    executionMode: response.safety.executionMode,
    ...(response.safety.simulationId === undefined
      ? {}
      : { simulationId: response.safety.simulationId }),
    taskId,
    contextId,
    goalId: task.goalId,
    goalVersion: task.goalVersion,
    workflowPlanId: response.execution.workflowPlanId,
    workflowInstanceId: response.execution.workflowInstanceId,
    skillExecutionId: skillExecution.executionId,
    capabilityId: target.capabilityId,
    capabilityVersion: target.capabilityVersion,
    capabilityDefinitionHash: target.capabilityDefinitionHash,
    capabilityBindingId: target.capabilityBindingId,
    capabilityBindingVersion: target.capabilityBindingVersion,
    skillId: target.skillId,
    skillVersion: target.skillVersion,
    mcpInvocationId: invocation.invocationId,
    resourceId: target.resourceId,
    providerBinding: Object.freeze({
      bindingId: binding.binding.bindingId,
      revision: binding.binding.revision,
      providerId: binding.binding.providerId,
      localServerId: binding.binding.localServerId,
    }),
    smppLineage: Object.freeze({
      smppSourceId: binding.sourceCandidateLineage.smppSourceId,
      externalProviderId: binding.sourceCandidateLineage.externalProviderId,
      externalServerId: binding.sourceCandidateLineage.externalServerId,
      registryRevision: binding.sourceCandidateLineage.registryRevision,
      registryChecksum: binding.sourceCandidateLineage.registryChecksum,
      nativeRevision: binding.sourceCandidateLineage.nativeRevision,
      nativeChecksum: binding.sourceCandidateLineage.nativeChecksum,
      projectionContract: 'sdar-registry-v1',
    }),
    catalog: Object.freeze({
      revision: binding.binding.catalogRevision,
      checksum: binding.binding.catalogChecksum,
      operationCount: binding.binding.operationCount,
      schemaAlignment: true,
      executionSemantics: 'explicit_read_only_synchronous',
      readinessAttributes: authority.readinessAttributes,
    }),
    evidence: Object.freeze(
      evidence.map((item) =>
        Object.freeze({
          evidenceId: item.evidenceId,
          evidenceType: item.evidenceType,
          observedAt: item.observedAt,
          subjectRef: item.subjectRef,
          payloadKind: item.payloadRef.kind,
        }),
      ),
    ),
    structuredResultSha256: sha256Json(response.result),
    schemaValidated: true,
    idempotentReplayVerified: true,
    remoteTaskCount: 0,
  });
}

async function verifyRestartRecovery(
  configuration: UgvDeterministicReadOnlyConfiguration,
  authorities: readonly UgvReadOnlyAuthoritySnapshot[],
  observedAt: string,
  request: typeof fetch,
): Promise<UgvDeterministicReadOnlyReport> {
  if (configuration.checkpointFile === undefined)
    fail(
      'UGV_DETERMINISTIC_CHECKPOINT_REQUIRED',
      'Restart verification requires the prior execution checkpoint.',
    );
  if (configuration.restartEvidenceId === undefined)
    fail(
      'UGV_DETERMINISTIC_RESTART_EVIDENCE_REQUIRED',
      'Restart verification requires an external Runtime restart evidence reference.',
    );
  const saved = await loadCheckpoint(configuration.checkpointFile);
  const executionContext = deterministicExecutionContext(configuration);
  if (
    saved.runId !== configuration.runId ||
    saved.executionMode !== executionContext.mode ||
    saved.simulationId !== executionContext.simulationId ||
    saved.executions.length !== authorities.length
  )
    fail(
      'UGV_DETERMINISTIC_CHECKPOINT_AUTHORITY_MISMATCH',
      'Checkpoint does not cover the exact current read authority set.',
    );
  const executions: UgvDeterministicReadOnlyReport['executions'][number][] = [];
  for (const authority of authorities) {
    const matches = saved.executions.filter(
      (item) => item.operationName === authority.target.toolName,
    );
    const prior = matches[0];
    const expectedTaskId = stableIdentifier(
      'task-ugv-read',
      configuration.runId,
      authority.target.toolName,
    );
    const expectedContextId = stableIdentifier(
      'context-ugv-read',
      configuration.runId,
      authority.target.toolName,
    );
    if (matches.length !== 1 || prior === undefined)
      fail(
        'UGV_DETERMINISTIC_CHECKPOINT_AUTHORITY_MISMATCH',
        'Checkpoint does not contain one exact operation authority.',
      );
    if (prior.taskId !== expectedTaskId || prior.contextId !== expectedContextId)
      fail(
        'UGV_DETERMINISTIC_CHECKPOINT_AUTHORITY_MISMATCH',
        'Checkpoint Task identity differs from current deterministic authority.',
      );
    const response = await recoveredExecutionResponse(configuration, authority, prior, request);
    const execution = await collectPersistedExecution(configuration, authority, response, request);
    if (
      execution.workflowPlanId !== prior.workflowPlanId ||
      execution.workflowInstanceId !== prior.workflowInstanceId ||
      execution.mcpInvocationId !== prior.mcpInvocationId ||
      execution.structuredResultSha256 !== prior.structuredResultSha256 ||
      sha256Json(execution) !== prior.executionHash
    )
      fail(
        'UGV_DETERMINISTIC_RESTART_AUTHORITY_DRIFT',
        'Recovered persistent Task/Goal/Plan/Skill/LangGraph/MCP authority differs from checkpoint.',
      );
    executions.push(execution);
  }
  return buildReport(
    configuration,
    'verify-restart',
    observedAt,
    executions,
    sha256Json({ restartEvidenceId: configuration.restartEvidenceId }),
  );
}

async function recoveredExecutionResponse(
  configuration: UgvDeterministicReadOnlyConfiguration,
  authority: UgvReadOnlyAuthoritySnapshot,
  prior: UgvDeterministicReadOnlyCheckpoint['executions'][number],
  request: typeof fetch,
): Promise<ExecutionResponse> {
  const executionContext = deterministicExecutionContext(configuration);
  const values = await runtimeGet(
    configuration,
    `/api/v1/mcp/invocations?taskId=${encodeURIComponent(prior.taskId)}`,
    request,
  );
  const invocations = parse(
    z.object({ items: z.array(InvocationSchema) }).loose(),
    values,
    'UGV_DETERMINISTIC_INVOCATION_INVALID',
  ).items;
  const invocation = invocations[0];
  if (invocations.length !== 1 || invocation === undefined)
    fail(
      'UGV_DETERMINISTIC_RESTART_INVOCATION_MISSING',
      'Restart recovery requires exactly one persisted MCP invocation.',
    );
  const response = parse(
    ExecutionResponseSchema,
    {
      schemaVersion: 'sdar.deterministic-read-only-capability-execution/v1',
      status: 'succeeded',
      execution: Object.freeze({
        taskId: prior.taskId,
        capabilityBindingId: authority.target.capabilityBindingId,
        capabilityBindingVersion: authority.target.capabilityBindingVersion,
        capabilityId: authority.target.capabilityId,
        capabilityVersion: authority.target.capabilityVersion,
        skillId: authority.target.skillId,
        skillVersion: authority.target.skillVersion,
        workflowPlanId: prior.workflowPlanId,
        workflowInstanceId: prior.workflowInstanceId,
        mcpProviderBindingId: authority.target.mcpProviderBindingId,
        mcpInvocationId: prior.mcpInvocationId,
        providerId: authority.binding.binding.externalProviderId,
        serverId: authority.target.localServerId,
        toolName: authority.target.toolName,
        resourceId: authority.target.resourceId,
      }),
      result: invocation.result.structuredContent,
      evidence: invocation.result.evidence.map((item) => ({
        requirementId: item.evidenceType,
        evidenceType: item.evidenceType,
        required: true,
        hardGate: true,
        satisfied: true,
        evidenceId: item.evidenceId,
        observedAt: item.observedAt,
        payloadRef: item.payloadRef,
      })),
      safety: Object.freeze({
        executionMode: executionContext.mode,
        ...(executionContext.simulationId === undefined
          ? {}
          : { simulationId: executionContext.simulationId }),
        physicalWrites: 0,
        modelCalls: 0,
        mcpCalls: 1,
        identifierAuthority: 'public_resource_id',
      }),
    },
    'UGV_DETERMINISTIC_RECOVERED_RESPONSE_INVALID',
  );
  assertExecutionResponse(response, authority, prior.taskId, executionContext);
  return response;
}

function buildReport(
  configuration: UgvDeterministicReadOnlyConfiguration,
  mode: 'execute' | 'verify-restart',
  observedAt: string,
  executions: readonly UgvDeterministicReadOnlyReport['executions'][number][],
  restartEvidenceSha256?: string,
): UgvDeterministicReadOnlyReport {
  const executionContext = deterministicExecutionContext(configuration);
  const report: UgvDeterministicReadOnlyReport = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-deterministic-read-only/v1',
    status: 'passed',
    evidenceClass:
      executionContext.mode === 'live'
        ? 'real_live_sdar_and_external_smpp'
        : 'real_simulation_sdar_and_external_smpp',
    observedAt,
    mode,
    executionMode: executionContext.mode as 'live' | 'simulation',
    ...(executionContext.simulationId === undefined
      ? {}
      : { simulationId: executionContext.simulationId }),
    deterministicReadOnlyReady: mode === 'verify-restart',
    restartRecoveryVerified: mode === 'verify-restart',
    ...(restartEvidenceSha256 === undefined ? {} : { restartEvidenceSha256 }),
    executions: Object.freeze([...executions]),
    safety: Object.freeze({
      modelCalls: 0,
      physicalWrites: 0,
      mcpCalls: executions.length,
      executionMode: executionContext.mode as 'live' | 'simulation',
      onlyExplicitReadOnlyTools: true,
      writeGateRequired: false,
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

function checkpoint(
  runId: string,
  createdAt: string,
  executions: readonly UgvDeterministicReadOnlyReport['executions'][number][],
): UgvDeterministicReadOnlyCheckpoint {
  const execution = executions[0];
  const value: UgvDeterministicReadOnlyCheckpoint = Object.freeze({
    schemaVersion: 'sdar.ugv-smpp-deterministic-read-only-checkpoint/v1',
    runId,
    executionMode: execution?.executionMode ?? 'live',
    ...(execution?.simulationId === undefined ? {} : { simulationId: execution.simulationId }),
    createdAt,
    executions: Object.freeze(
      executions.map((execution) =>
        Object.freeze({
          operationName: execution.operationName,
          taskId: execution.taskId,
          contextId: execution.contextId,
          workflowPlanId: execution.workflowPlanId,
          workflowInstanceId: execution.workflowInstanceId,
          mcpInvocationId: execution.mcpInvocationId,
          executionHash: sha256Json(execution),
          structuredResultSha256: execution.structuredResultSha256,
        }),
      ),
    ),
  });
  assertSafeRedactedJson(value);
  return value;
}

async function loadCheckpoint(file: string): Promise<UgvDeterministicReadOnlyCheckpoint> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
  } catch {
    return fail(
      'UGV_DETERMINISTIC_CHECKPOINT_REQUIRED',
      'Restart verification checkpoint is unavailable or invalid JSON.',
    );
  }
  const parsed = CheckpointSchema.safeParse(value);
  if (!parsed.success)
    return fail(
      'UGV_DETERMINISTIC_CHECKPOINT_INVALID',
      'Restart verification checkpoint failed its boundary schema.',
    );
  assertSafeRedactedJson(parsed.data);
  return Object.freeze(parsed.data);
}

function assertExecutionResponse(
  response: ExecutionResponse,
  authority: UgvReadOnlyAuthoritySnapshot,
  taskId: string,
  executionContext: RuntimeExecutionContext,
): void {
  const { target, binding } = authority;
  const identity = response.execution;
  if (
    identity.taskId !== taskId ||
    identity.capabilityBindingId !== target.capabilityBindingId ||
    identity.capabilityBindingVersion !== target.capabilityBindingVersion ||
    identity.capabilityId !== target.capabilityId ||
    identity.capabilityVersion !== target.capabilityVersion ||
    identity.skillId !== target.skillId ||
    identity.skillVersion !== target.skillVersion ||
    identity.mcpProviderBindingId !== target.mcpProviderBindingId ||
    identity.providerId !== binding.binding.externalProviderId ||
    identity.serverId !== target.localServerId ||
    identity.toolName !== target.toolName ||
    identity.resourceId !== target.resourceId ||
    response.safety.executionMode !== executionContext.mode ||
    response.safety.simulationId !== executionContext.simulationId ||
    response.result['resourceId'] !== target.resourceId
  )
    fail(
      'UGV_DETERMINISTIC_EXECUTION_LINEAGE_MISMATCH',
      'Execution response differs from the exact admitted authority.',
    );
  for (const evidenceType of authority.evidenceTypes) {
    const matches = response.evidence.filter((item) => item.evidenceType === evidenceType);
    if (
      matches.length !== 1 ||
      matches[0]?.required !== true ||
      !matches[0].hardGate ||
      !matches[0].satisfied ||
      matches[0].evidenceId === undefined ||
      matches[0].observedAt === undefined ||
      matches[0].payloadRef === undefined
    )
      fail(
        'UGV_DETERMINISTIC_EVIDENCE_INCOMPLETE',
        'Execution response lacks one satisfied required Provider evidence item.',
      );
  }
}

function assertTaskLineage(
  task: z.infer<typeof TaskSchema>,
  goal: Readonly<Record<string, unknown>>,
  plan: Readonly<Record<string, unknown>>,
  skillExecution: z.infer<typeof SkillExecutionSchema>,
  trace: z.infer<typeof TraceSchema>,
  response: ExecutionResponse,
  authority: UgvReadOnlyAuthoritySnapshot,
  taskId: string,
  contextId: string,
): void {
  const metadata = object(task.requestMetadata['io.sdar/deterministicCapabilityExecution']);
  if (
    task.taskId !== taskId ||
    task.contextId !== contextId ||
    task.planId !== response.execution.workflowPlanId ||
    task.selectedSkillId !== authority.target.skillId ||
    task.selectedSkillVersion !== authority.target.skillVersion ||
    canonical(task.output.structured) !== canonical(response.result) ||
    metadata?.['capabilityBindingId'] !== authority.target.capabilityBindingId ||
    metadata['mcpProviderBindingId'] !== authority.target.mcpProviderBindingId ||
    metadata['toolName'] !== authority.target.toolName ||
    metadata['resourceId'] !== authority.target.resourceId ||
    goal['goalId'] !== task.goalId ||
    goal['contextId'] !== contextId ||
    goal['version'] !== task.goalVersion ||
    plan['planId'] !== task.planId ||
    plan['goalId'] !== task.goalId ||
    plan['goalVersion'] !== task.goalVersion ||
    skillExecution.taskId !== taskId ||
    skillExecution.goalId !== task.goalId ||
    skillExecution.skillId !== authority.target.skillId ||
    skillExecution.skillVersion !== authority.target.skillVersion ||
    skillExecution.workflowPlanId !== task.planId ||
    trace.instance.instanceId !== response.execution.workflowInstanceId ||
    trace.instance.planId !== task.planId ||
    trace.instance.goalId !== task.goalId ||
    trace.instance.budgetUsage.llmCalls !== 0 ||
    trace.instance.budgetUsage.mcpCalls !== 1 ||
    canonical(trace.instance.result) !== canonical(response.result) ||
    trace.events.length === 0
  )
    fail(
      'UGV_DETERMINISTIC_TASK_LINEAGE_INVALID',
      'Persisted Task, Goal, Plan, Skill execution, or LangGraph trace differs.',
    );
  for (const [kind, referenceId, referenceType] of [
    ['provider', authority.target.mcpProviderBindingId, 'mcp.provider_binding'],
    ['evidence', authority.target.capabilityBindingId, 'node.capability_binding'],
    ['resource', authority.target.resourceId, 'public.resource'],
    ['outcome', response.execution.mcpInvocationId, 'mcp.invocation'],
  ] as const)
    if (
      !skillExecution.references.some(
        (reference) =>
          reference['kind'] === kind &&
          reference['referenceId'] === referenceId &&
          reference['referenceType'] === referenceType,
      )
    )
      fail(
        'UGV_DETERMINISTIC_SKILL_REFERENCE_MISSING',
        'Skill execution is missing a required authority reference.',
      );
}

function assertInvocation(
  invocation: z.infer<typeof InvocationSchema>,
  response: ExecutionResponse,
  authority: UgvReadOnlyAuthoritySnapshot,
  taskId: string,
  contextId: string,
): readonly z.infer<typeof ProviderEvidenceSchema>[] {
  const executionContext: RuntimeExecutionContext = Object.freeze({
    mode: response.safety.executionMode,
    ...(response.safety.simulationId === undefined
      ? {}
      : { simulationId: response.safety.simulationId }),
  });
  if (
    invocation.invocationId !== response.execution.mcpInvocationId ||
    invocation.taskId !== taskId ||
    invocation.contextId !== contextId ||
    invocation.executionMode !== executionContext.mode ||
    invocation.simulationId !== executionContext.simulationId ||
    invocation.capabilityAttemptId !== undefined ||
    invocation.serverId !== authority.target.localServerId ||
    invocation.toolName !== authority.target.toolName ||
    canonical(invocation.executionSemantics) !== canonical(authority.tool.executionSemantics) ||
    canonical(invocation.arguments) !== canonical({ resourceId: authority.target.resourceId }) ||
    canonical(invocation.result.structuredContent) !== canonical(response.result)
  )
    fail(
      'UGV_DETERMINISTIC_MCP_INVOCATION_INVALID',
      'The only MCP-adapter invocation differs from the exact read-only Workflow authority.',
    );
  const evidence = invocation.result.evidence;
  if (
    evidence.length < authority.evidenceTypes.length ||
    evidence.some(
      (item) =>
        item.subjectRef !== `resource:${authority.target.resourceId}` ||
        !item.producer.includes(authority.binding.binding.externalProviderId),
    ) ||
    authority.evidenceTypes.some(
      (evidenceType) => evidence.filter((item) => item.evidenceType === evidenceType).length !== 1,
    )
  )
    fail(
      'UGV_DETERMINISTIC_PROVIDER_EVIDENCE_INVALID',
      'Provider evidence does not prove the exact public resource and producer lineage.',
    );
  return Object.freeze(evidence);
}

function validateConfiguration(
  input: UgvDeterministicReadOnlyConfiguration,
): UgvDeterministicReadOnlyConfiguration {
  const nodeControlBaseUrl = safeManagementBaseUrl(input.nodeControlBaseUrl);
  const runtimeManagementBaseUrl = safeManagementBaseUrl(input.runtimeManagementBaseUrl);
  const mode = input.mode ?? 'execute';
  let executionContext: RuntimeExecutionContext;
  try {
    executionContext = createRuntimeExecutionContext({
      mode: input.executionMode ?? 'live',
      ...(input.simulationId === undefined ? {} : { simulationId: input.simulationId }),
    });
  } catch {
    return fail(
      'UGV_DETERMINISTIC_CONFIGURATION_INVALID',
      'Execution mode and simulation identity are invalid.',
    );
  }
  if (
    input.runtimeCognitiveBearerToken.trim() === '' ||
    input.nodeControlBearerToken.trim() === '' ||
    input.nodeControlRuntimeServiceToken.trim() === '' ||
    input.runId.trim().length < 8 ||
    input.runId.length > 128 ||
    !['execute', 'verify-restart'].includes(mode) ||
    (mode === 'verify-restart' &&
      (input.checkpointFile === undefined || (input.restartEvidenceId?.trim() ?? '') === ''))
  )
    fail(
      'UGV_DETERMINISTIC_CONFIGURATION_INVALID',
      'Bounded run ID and all exact bearer roles are required.',
    );
  return Object.freeze({
    ...input,
    mode,
    executionMode: executionContext.mode as 'live' | 'simulation',
    ...(executionContext.simulationId === undefined
      ? {}
      : { simulationId: executionContext.simulationId }),
    nodeControlBaseUrl,
    runtimeManagementBaseUrl,
    ...(input.checkpointFile === undefined
      ? {}
      : { checkpointFile: resolve(input.checkpointFile) }),
    ...(input.restartEvidenceId === undefined
      ? {}
      : { restartEvidenceId: input.restartEvidenceId.trim() }),
  });
}

function deterministicExecutionContext(
  configuration: UgvDeterministicReadOnlyConfiguration,
): RuntimeExecutionContext {
  return createRuntimeExecutionContext({
    mode: configuration.executionMode ?? 'live',
    ...(configuration.simulationId === undefined
      ? {}
      : { simulationId: configuration.simulationId }),
  });
}

async function runtimeGet(
  configuration: UgvDeterministicReadOnlyConfiguration,
  path: string,
  request: typeof fetch,
): Promise<unknown> {
  return requestJson(
    `${configuration.runtimeManagementBaseUrl}${path}`,
    { redirect: 'manual' },
    request,
  );
}

function validateSchema(schema: unknown, value: unknown, scope: string): void {
  const validation = new AjvJsonSchemaValidator({ strict: false }).validate(schema, value);
  if (!validation.valid)
    fail(`${scope}_SCHEMA_VALIDATION_FAILED`, 'Structured output failed authoritative schema.');
}

function deterministicGoalId(taskId: string): string {
  return `goal-deterministic-${createHash('sha256').update(taskId).digest('hex').slice(0, 32)}`;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return fail(code, 'Execution evidence failed its boundary schema.');
  return parsed.data;
}

async function secretFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
): Promise<string> {
  const inline = environment[name];
  const file = environment[`${name}_FILE`];
  if ((inline === undefined) === (file === undefined))
    fail('UGV_DETERMINISTIC_CONFIGURATION_INVALID', `Set exactly one of ${name} or ${name}_FILE.`);
  const value = (inline ?? (file === undefined ? '' : await readFile(file, 'utf8'))).trim();
  if (value === '') fail('UGV_DETERMINISTIC_CONFIGURATION_INVALID', `${name} is empty.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === '')
    return fail('UGV_DETERMINISTIC_CONFIGURATION_INVALID', `${name} is required.`);
  return value;
}

export async function ugvDeterministicConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Readonly<{ configuration: UgvDeterministicReadOnlyConfiguration; reportFile: string }>> {
  return Object.freeze({
    configuration: Object.freeze({
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
      runtimeCognitiveBearerToken: await secretFromEnvironment(
        environment,
        'SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN',
      ),
      governanceReportFile:
        environment['SDAR_UGV_GOVERNANCE_REPORT_FILE'] ??
        'reports/sdar-ugv-smpp-integration/capability-skill-governance.redacted.json',
      runId: requiredEnvironment(environment, 'SDAR_UGV_READ_RUN_ID'),
      executionMode: z
        .enum(['live', 'simulation'])
        .parse(environment['SDAR_UGV_EXECUTION_MODE'] ?? 'live'),
      ...(environment['SDAR_UGV_SIMULATION_ID'] === undefined
        ? {}
        : { simulationId: environment['SDAR_UGV_SIMULATION_ID'] }),
      mode: z
        .enum(['execute', 'verify-restart'])
        .parse(environment['SDAR_UGV_READ_MODE'] ?? 'execute'),
      checkpointFile:
        environment['SDAR_UGV_DETERMINISTIC_CHECKPOINT_FILE'] ??
        'reports/sdar-ugv-smpp-integration/deterministic-readonly.checkpoint.json',
      ...(environment['SDAR_UGV_RESTART_EVIDENCE_ID'] === undefined
        ? {}
        : { restartEvidenceId: environment['SDAR_UGV_RESTART_EVIDENCE_ID'] }),
    }),
    reportFile:
      environment['SDAR_UGV_DETERMINISTIC_REPORT_FILE'] ??
      'reports/sdar-ugv-smpp-integration/deterministic-readonly.json',
  });
}

async function main(): Promise<void> {
  try {
    const { configuration, reportFile } = await ugvDeterministicConfigurationFromEnvironment();
    const report = await executeUgvDeterministicReadOnly(configuration);
    await writeRedactedUgvReport(reportFile, report);
    process.stdout.write(
      `${JSON.stringify({ status: report.status, reportFile: resolve(reportFile) })}\n`,
    );
  } catch (error: unknown) {
    const errorRecord = object(error);
    const code =
      error instanceof UgvDeterministicReadOnlyError || typeof errorRecord?.['code'] === 'string'
        ? String(errorRecord?.['code'])
        : 'UGV_DETERMINISTIC_READ_ONLY_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'failed', code })}\n`);
    process.exitCode = 1;
  }
}

function fail(code: string, message: string): never {
  throw new UgvDeterministicReadOnlyError(code, message);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
