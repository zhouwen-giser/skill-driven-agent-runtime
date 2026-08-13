import { createHash } from 'node:crypto';

import {
  createMcpProviderDispatchHash,
  matchSkillEvidence,
  type CognitiveManagementActionLeaseGuard,
  type CognitiveManagementActionRecoveryResult,
} from '../../../packages/application/src/index.js';
import type { DeterministicCapabilityExecutionInput } from '../../../packages/management-api/src/index.js';
import {
  createRuntimeExecutionContext,
  isTerminalSkillExecutionStatus,
  isTerminalTaskPhase,
  resolveWorkflowBudgetLimits,
  type AgentTask,
  type InternalToolResult,
  type McpInvocation,
  type RuntimeExecutionContext,
  type SkillEvidenceMatch,
  type SkillExecutionView,
  type SkillVersion,
  type WorkflowInstance,
  type WorkflowBudgetLimits,
} from '../../../packages/domain/src/index.js';

export interface DeterministicCapabilityExecutionIdentity {
  readonly goalId: string;
  readonly workflowDefinitionId: string;
  readonly workflowPlanId: string;
  readonly workflowInstanceId: string;
  readonly skillExecutionId: string;
  readonly mcpInvocationId: string;
}

export interface DeterministicCapabilityRecoveryDependencies {
  readonly findTask: (taskId: string) => Promise<AgentTask | undefined>;
  readonly findWorkflow: (instanceId: string) => Promise<WorkflowInstance | undefined>;
  readonly findSkillExecutionByPlan: (planId: string) => Promise<SkillExecutionView | undefined>;
  readonly findSkillVersion: (
    skillId: string,
    skillVersion: number,
  ) => Promise<SkillVersion | undefined>;
  readonly listInvocationsByTask: (taskId: string) => Promise<readonly McpInvocation[]>;
  readonly workflowBudgetDefaults: WorkflowBudgetLimits;
  readonly mcpCallCost: number;
  readonly recordTaskResult: (
    input: Readonly<{
      taskId: string;
      structured: unknown;
      outputSchema: unknown;
    }>,
  ) => Promise<AgentTask>;
  readonly recordTaskFailure: (taskId: string, errorCode: string) => Promise<void>;
  readonly recordSkillEvidenceAndReferences: (
    input: DeterministicSkillSuccessProjection,
  ) => Promise<void>;
  readonly recordSkillCompleted: (
    workflowPlanId: string,
    details: Readonly<{ workflowInstanceId: string; mcpInvocationId: string }>,
  ) => Promise<void>;
  readonly recordSkillFailure: (workflowPlanId: string, errorCode: string) => Promise<void>;
}

export interface DeterministicSkillSuccessProjection {
  readonly workflowPlanId: string;
  readonly providerId: string;
  readonly providerBindingId: string;
  readonly serverId: string;
  readonly capabilityBindingId: string;
  readonly capabilityBindingVersion: number;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly resourceId: string;
  readonly invocationId: string;
  readonly workflowInstanceId: string;
  readonly evidence: readonly SkillEvidenceMatch[];
}

export class DeterministicCapabilityRecoveryService {
  readonly #dependencies: DeterministicCapabilityRecoveryDependencies;

  constructor(dependencies: DeterministicCapabilityRecoveryDependencies) {
    this.#dependencies = dependencies;
  }

  async reconcile(
    input: DeterministicCapabilityExecutionInput,
    lease: CognitiveManagementActionLeaseGuard,
  ): Promise<CognitiveManagementActionRecoveryResult<DeterministicCapabilityExecutionResponse>> {
    const identity = deterministicExecutionIdentity(input.taskId);
    const [task, instance, skillExecution, invocations, skill] = await Promise.all([
      this.#dependencies.findTask(input.taskId),
      this.#dependencies.findWorkflow(identity.workflowInstanceId),
      this.#dependencies.findSkillExecutionByPlan(identity.workflowPlanId),
      this.#dependencies.listInvocationsByTask(input.taskId),
      this.#dependencies.findSkillVersion(input.skillId, input.skillVersion),
    ]);
    const invocation = invocations.length === 1 ? invocations[0] : undefined;
    const invocationIdentityExact =
      invocation !== undefined && exactInvocationIdentity(invocation, input, identity);
    const invocationCompletionSemanticsSafe =
      invocation !== undefined && recoverableInvocationExecutionSemantics(invocation, input);
    const dispatchIdentity = lease.providerDispatchIdentity();
    const dispatchExact =
      invocationIdentityExact &&
      dispatchIdentity?.dispatchId === identity.mcpInvocationId &&
      dispatchIdentity.dispatchHash ===
        createMcpProviderDispatchHash({
          invocationId: identity.mcpInvocationId,
          taskId: input.taskId,
          contextId: input.contextId,
          providerBindingId: input.mcpProviderBindingId,
          providerId: input.providerId,
          serverId: input.serverId,
          toolName: input.toolName,
          arguments: invocation.arguments,
        });
    const expectedBudgetLimits =
      skill === undefined
        ? undefined
        : resolveWorkflowBudgetLimits(this.#dependencies.workflowBudgetDefaults, [
            skill.runtimePolicy,
          ]);

    if (
      task !== undefined &&
      instance !== undefined &&
      skillExecution !== undefined &&
      skill !== undefined &&
      invocation !== undefined &&
      expectedBudgetLimits !== undefined &&
      dispatchExact &&
      invocationCompletionSemanticsSafe &&
      completeAuthorityExact(
        task,
        instance,
        skillExecution,
        skill,
        invocation,
        input,
        identity,
        expectedBudgetLimits,
        this.#dependencies.mcpCallCost,
      )
    ) {
      const toolResult = requireDeterministicToolResult(invocation.result);
      if (canonicalJson(toolResult.structuredContent) !== canonicalJson(instance.result))
        return this.#orphan(task, skillExecution, lease, 'DETERMINISTIC_RECOVERY_RESULT_MISMATCH');
      const matchedEvidence = matchSkillEvidence({
        requirements: skillExecution.usagePolicy.evidenceRequirements,
        result: toolResult,
      });
      if (
        matchedEvidence.matches.some(
          (match) => (match.required || match.hardGate) && !match.satisfied,
        )
      )
        return this.#orphan(task, skillExecution, lease, 'DETERMINISTIC_RECOVERY_EVIDENCE_MISSING');
      assertNoHomeAssistantEntityId(instance.result);

      if (task.phase !== 'completed' && task.phase !== 'executing' && task.phase !== 'evaluating')
        return this.#orphan(
          task,
          skillExecution,
          lease,
          'DETERMINISTIC_RECOVERY_TASK_STATE_INVALID',
        );
      if (
        skillExecution.status !== 'completed' &&
        skillExecution.status !== 'executing' &&
        skillExecution.status !== 'waiting_external'
      )
        return this.#orphan(
          task,
          skillExecution,
          lease,
          'DETERMINISTIC_RECOVERY_SKILL_STATE_INVALID',
        );
      let completedTask = task;
      let taskResultValid =
        task.phase !== 'completed' ||
        (task.output !== undefined &&
          canonicalJson(task.output.structured) === canonicalJson(instance.result));
      await lease.runFencedProjection(async () => {
        await this.#dependencies.recordSkillEvidenceAndReferences({
          workflowPlanId: identity.workflowPlanId,
          providerId: input.providerId,
          providerBindingId: input.mcpProviderBindingId,
          serverId: input.serverId,
          capabilityBindingId: input.capabilityBindingId,
          capabilityBindingVersion: input.capabilityBindingVersion,
          capabilityId: input.capabilityId,
          capabilityVersion: input.capabilityVersion,
          resourceId: input.resourceId,
          invocationId: identity.mcpInvocationId,
          workflowInstanceId: identity.workflowInstanceId,
          evidence: matchedEvidence.matches,
        });
        if (task.phase !== 'completed')
          completedTask = await this.#dependencies.recordTaskResult({
            taskId: input.taskId,
            structured: instance.result,
            outputSchema: skill.outputSchema,
          });
        taskResultValid =
          taskResultValid &&
          completedTask.phase === 'completed' &&
          completedTask.output !== undefined &&
          canonicalJson(completedTask.output.structured) === canonicalJson(instance.result);
        if (taskResultValid && skillExecution.status !== 'completed')
          await this.#dependencies.recordSkillCompleted(identity.workflowPlanId, {
            workflowInstanceId: identity.workflowInstanceId,
            mcpInvocationId: identity.mcpInvocationId,
          });
      });
      const completedOutput = completedTask.output;
      if (!taskResultValid || completedTask.phase !== 'completed' || completedOutput === undefined)
        return this.#orphan(
          completedTask,
          skillExecution,
          lease,
          'DETERMINISTIC_RECOVERY_TASK_RESULT_INVALID',
        );
      const response = deterministicCapabilityExecutionResponse(
        input,
        instance,
        identity.mcpInvocationId,
        matchedEvidence.matches,
      );
      if (
        canonicalJson(response.result) !== canonicalJson(completedOutput.structured) ||
        canonicalJson(response.result) !== canonicalJson(toolResult.structuredContent)
      )
        return this.#orphan(
          completedTask,
          skillExecution,
          lease,
          'DETERMINISTIC_RECOVERY_RESPONSE_MISMATCH',
        );
      assertNoHomeAssistantEntityId(response);
      return { disposition: 'completed', result: response };
    }

    // Every persisted invocation is terminal. An exact failed or canceled receipt proves that
    // Provider dispatch returned and must be terminally orphaned instead of remaining eligible
    // for an unsafe replay. Successful projection additionally requires the stricter semantics
    // and full Task/Workflow/Skill authority checks above.
    const exactReceipt = dispatchExact;
    if (lease.executionPhase() === 'provider_dispatch' && !exactReceipt) {
      await lease.assertCurrent();
      return {
        disposition: 'indeterminate',
        errorCode: 'DETERMINISTIC_RECOVERY_PROVIDER_DISPATCH_INDETERMINATE',
      };
    }
    const noDomainEvidence =
      task === undefined &&
      instance === undefined &&
      skillExecution === undefined &&
      invocations.length === 0;
    return this.#orphan(
      task,
      skillExecution,
      lease,
      noDomainEvidence
        ? 'DETERMINISTIC_RECOVERY_INTERRUPTED_BEFORE_EXECUTION'
        : 'DETERMINISTIC_RECOVERY_ORPHANED',
    );
  }

  async #orphan(
    task: AgentTask | undefined,
    skillExecution: SkillExecutionView | undefined,
    lease: CognitiveManagementActionLeaseGuard,
    errorCode: string,
  ): Promise<CognitiveManagementActionRecoveryResult<never>> {
    await lease.runFencedProjection(async () => {
      if (task !== undefined && !isTerminalTaskPhase(task.phase))
        await this.#dependencies.recordTaskFailure(task.taskId, errorCode);
      if (skillExecution !== undefined && !isTerminalSkillExecutionStatus(skillExecution.status))
        await this.#dependencies.recordSkillFailure(skillExecution.workflowPlanId, errorCode);
    });
    return { disposition: 'orphaned', errorCode };
  }
}

export function deterministicExecutionIdentity(
  taskId: string,
): DeterministicCapabilityExecutionIdentity {
  const suffix = createHash('sha256').update(taskId).digest('hex').slice(0, 32);
  return Object.freeze({
    goalId: `goal-deterministic-${suffix}`,
    workflowDefinitionId: `workflow-deterministic-${suffix}`,
    workflowPlanId: `plan-deterministic-${suffix}`,
    workflowInstanceId: `workflow-instance-deterministic-${suffix}`,
    skillExecutionId: `skill-execution-deterministic-${suffix}`,
    mcpInvocationId: `mcp-invocation-deterministic-${suffix}`,
  });
}

export function deterministicRuntimeExecutionContext(
  input: DeterministicCapabilityExecutionInput,
): RuntimeExecutionContext {
  return createRuntimeExecutionContext({
    mode: input.executionMode ?? 'live',
    ...(input.simulationId === undefined ? {} : { simulationId: input.simulationId }),
  });
}

export function requireDeterministicToolResult(value: unknown): InternalToolResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value['content']) ||
    value['isError'] !== false ||
    value['structuredContent'] === undefined ||
    !Array.isArray(value['evidence'])
  )
    throw deterministicExecutionError(
      'DETERMINISTIC_PROVIDER_RESULT_INVALID',
      'Recorded Provider result is not one validated immediate MCP Tool result.',
    );
  return value as unknown as InternalToolResult;
}

export type DeterministicCapabilityExecutionResponse = ReturnType<
  typeof deterministicCapabilityExecutionResponse
>;

export function deterministicCapabilityExecutionResponse(
  input: DeterministicCapabilityExecutionInput,
  instance: WorkflowInstance,
  invocationId: string,
  evidence: readonly SkillEvidenceMatch[],
) {
  const executionContext = deterministicRuntimeExecutionContext(input);
  return Object.freeze({
    schemaVersion: 'sdar.deterministic-read-only-capability-execution/v1' as const,
    status: 'succeeded' as const,
    execution: Object.freeze({
      taskId: input.taskId,
      capabilityBindingId: input.capabilityBindingId,
      capabilityBindingVersion: input.capabilityBindingVersion,
      capabilityId: input.capabilityId,
      capabilityVersion: input.capabilityVersion,
      skillId: input.skillId,
      skillVersion: input.skillVersion,
      workflowPlanId: instance.planId,
      workflowInstanceId: instance.instanceId,
      mcpProviderBindingId: input.mcpProviderBindingId,
      mcpInvocationId: invocationId,
      providerId: input.providerId,
      serverId: input.serverId,
      toolName: input.toolName,
      resourceId: input.resourceId,
    }),
    result: instance.result,
    evidence: Object.freeze(
      evidence.map((match) =>
        Object.freeze({
          requirementId: match.requirementId,
          evidenceType: match.evidenceType,
          required: match.required,
          hardGate: match.hardGate,
          satisfied: match.satisfied,
          ...(match.evidenceId === undefined ? {} : { evidenceId: match.evidenceId }),
          ...(match.observedAt === undefined ? {} : { observedAt: match.observedAt }),
          ...(match.payloadRef === undefined ? {} : { payloadRef: match.payloadRef }),
        }),
      ),
    ),
    safety: Object.freeze({
      executionMode: executionContext.mode,
      ...(executionContext.simulationId === undefined
        ? {}
        : { simulationId: executionContext.simulationId }),
      physicalWrites: 0 as const,
      modelCalls: instance.budgetUsage.llmCalls,
      mcpCalls: instance.budgetUsage.mcpCalls,
      identifierAuthority: 'public_resource_id' as const,
    }),
  });
}

export function assertNoHomeAssistantEntityId(value: unknown): void {
  const pending: unknown[] = [value];
  let inspected = 0;
  const entityValue =
    /^(?:automation|binary_sensor|button|climate|cover|fan|input_boolean|input_number|light|lock|media_player|number|scene|script|select|sensor|switch)\.[a-z0-9_]+$/u;
  while (pending.length > 0) {
    const current = pending.pop();
    inspected += 1;
    if (inspected > 20_000)
      throw deterministicExecutionError(
        'DETERMINISTIC_OUTPUT_TOO_COMPLEX',
        'Deterministic execution data exceeds the bounded inspection budget.',
      );
    if (typeof current === 'string') {
      if (entityValue.test(current))
        throw deterministicExecutionError(
          'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN',
          'SDAR deterministic execution data must not contain Home Assistant entity IDs.',
        );
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, item] of Object.entries(current)) {
      if (/^entity_?id$/iu.test(key))
        throw deterministicExecutionError(
          'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN',
          'SDAR deterministic execution data must not contain Home Assistant entity IDs.',
        );
      pending.push(item);
    }
  }
}

export function deterministicExecutionError(
  code: string,
  message: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function completeAuthorityExact(
  task: AgentTask,
  instance: WorkflowInstance,
  skillExecution: SkillExecutionView,
  skill: SkillVersion,
  invocation: McpInvocation,
  input: DeterministicCapabilityExecutionInput,
  identity: DeterministicCapabilityExecutionIdentity,
  expectedBudgetLimits: WorkflowBudgetLimits,
  expectedMcpCallCost: number,
): boolean {
  const policy = skillExecution.usagePolicy;
  const usage = skill.usageSpecification;
  if (usage?.taskBindings.length !== 1) return false;
  const staticTaskBinding = usage.taskBindings[0];
  if (staticTaskBinding === undefined) return false;
  const expectedTaskOperations = [
    {
      bindingId: staticTaskBinding.bindingId,
      taskType: staticTaskBinding.taskType,
      providerId: input.serverId,
      operationName: input.toolName,
      protocolMode: 'frozen_v1',
    },
  ];
  const requiredStaticChildCount =
    (usage.composition?.fixedDependencies.length ?? 0) +
    (usage.composition?.capabilitySlots.filter((slot) => slot.required).length ?? 0);
  const expectedInput = deterministicWorkflowInput(policy, input.resourceId);
  const requiredContextIds = [...policy.requiredContextIds].sort();
  const contextRequirementIds = policy.context.requirements
    .filter((requirement) => requirement.required && requirement.status === 'satisfied')
    .map((requirement) => requirement.requirementId)
    .sort();
  const readinessBinding = policy.readiness.bindings[0];
  return (
    exactTaskAuthority(task, input, identity) &&
    instance.instanceId === identity.workflowInstanceId &&
    instance.planId === identity.workflowPlanId &&
    instance.workflowDefinitionId === identity.workflowDefinitionId &&
    instance.workflowVersion === 1 &&
    instance.goalId === identity.goalId &&
    instance.goalVersion === 1 &&
    instance.skillVersions.length === 1 &&
    instance.skillVersions[0]?.skillId === input.skillId &&
    instance.skillVersions[0].version === input.skillVersion &&
    canonicalJson(instance.input) === canonicalJson(expectedInput) &&
    canonicalJson(instance.budgetLimits) === canonicalJson(expectedBudgetLimits) &&
    instance.status === 'succeeded' &&
    instance.result !== undefined &&
    instance.result !== false &&
    Object.keys(instance.errors).length === 0 &&
    instance.completedAt !== undefined &&
    instance.terminationReason === undefined &&
    instance.pendingConfirmation === undefined &&
    instance.budgetUsage.replanCount === 0 &&
    Number.isSafeInteger(instance.budgetUsage.durationMs) &&
    instance.budgetUsage.durationMs >= 0 &&
    instance.budgetUsage.durationMs <= expectedBudgetLimits.maxDurationSeconds * 1_000 &&
    instance.budgetUsage.llmCalls === 0 &&
    instance.budgetUsage.mcpCalls === 1 &&
    instance.budgetUsage.cost === expectedMcpCallCost &&
    skillExecution.executionId === identity.skillExecutionId &&
    skillExecution.taskId === input.taskId &&
    skillExecution.goalId === identity.goalId &&
    skillExecution.goalVersion === instance.goalVersion &&
    skillExecution.selectionRef === task.skillSelectionId &&
    skillExecution.applicabilityStatus === 'satisfied' &&
    skillExecution.workflowPlanId === identity.workflowPlanId &&
    skillExecution.workflowDefinitionId === identity.workflowDefinitionId &&
    skillExecution.workflowDefinitionVersion === instance.workflowVersion &&
    skillExecution.skillId === input.skillId &&
    skillExecution.skillVersion === input.skillVersion &&
    policy.skill.skillId === input.skillId &&
    policy.skill.skillVersion === input.skillVersion &&
    policy.mode === 'procedure' &&
    policy.modeDecision.mode === 'procedure' &&
    policy.modeDecision.confirmationSatisfied &&
    policy.composition.root.skillId === input.skillId &&
    policy.composition.root.skillVersion === input.skillVersion &&
    policy.composition.expandedSkills.length === 1 &&
    policy.composition.edges.length === 0 &&
    requiredStaticChildCount === 0 &&
    policy.childPolicies.length === 0 &&
    canonicalJson(policy.evidenceRequirements) ===
      canonicalJson(usage.evidencePolicy.requirements) &&
    policy.rejectSuccessWithoutRequiredEvidence ===
      usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence &&
    staticTaskBinding.taskType === input.toolName &&
    staticTaskBinding.providerPolicy.selection === 'required' &&
    staticTaskBinding.providerPolicy.requiredProviderId === input.serverId &&
    canonicalJson(policy.taskOperations) === canonicalJson(expectedTaskOperations) &&
    canonicalJson(requiredContextIds) ===
      canonicalJson(['provider-binding-freshness', 'public-resource-id']) &&
    canonicalJson(contextRequirementIds) === canonicalJson(requiredContextIds) &&
    policy.context.complete &&
    policy.readiness.overall === 'ready' &&
    policy.readiness.bindings.length === 1 &&
    readinessBinding?.selectedProviderId === input.serverId &&
    readinessBinding.selectedOperationName === input.toolName &&
    policy.rejectSuccessWithoutRequiredEvidence &&
    skill.skillId === input.skillId &&
    skill.version === input.skillVersion &&
    invocation.status === 'succeeded' &&
    invocation.result !== undefined &&
    isRecord(instance.result) &&
    instance.result['resourceId'] === input.resourceId
  );
}

function exactTaskAuthority(
  task: AgentTask,
  input: DeterministicCapabilityExecutionInput,
  identity: DeterministicCapabilityExecutionIdentity,
): boolean {
  const metadata = task.requestMetadata['io.sdar/deterministicCapabilityExecution'];
  const executionContext = deterministicRuntimeExecutionContext(input);
  return (
    task.taskId === input.taskId &&
    task.contextId === input.contextId &&
    task.requestText === `deterministic:${input.capabilityBindingId}:${input.resourceId}` &&
    task.goalId === identity.goalId &&
    task.goalVersion === 1 &&
    task.planId === identity.workflowPlanId &&
    task.selectedSkillId === input.skillId &&
    task.selectedSkillVersion === input.skillVersion &&
    typeof task.skillSelectionId === 'string' &&
    task.skillSelectionId.trim() !== '' &&
    isRecord(metadata) &&
    metadata['schemaVersion'] === '1.0' &&
    metadata['capabilityBindingId'] === input.capabilityBindingId &&
    metadata['capabilityBindingVersion'] === input.capabilityBindingVersion &&
    metadata['capabilityId'] === input.capabilityId &&
    metadata['capabilityVersion'] === input.capabilityVersion &&
    metadata['skillId'] === input.skillId &&
    metadata['skillVersion'] === input.skillVersion &&
    metadata['mcpProviderBindingId'] === input.mcpProviderBindingId &&
    metadata['providerId'] === input.providerId &&
    metadata['serverId'] === input.serverId &&
    metadata['toolName'] === input.toolName &&
    metadata['resourceId'] === input.resourceId &&
    (metadata['executionMode'] ?? 'live') === executionContext.mode &&
    metadata['simulationId'] === executionContext.simulationId
  );
}

function deterministicWorkflowInput(
  policy: SkillExecutionView['usagePolicy'],
  resourceId: string,
): unknown {
  if (
    policy.requiredContextIds.length === 0 &&
    policy.taskOperations.length === 0 &&
    policy.childPolicies.length === 0 &&
    policy.evidenceRequirements.length === 0
  )
    return { resourceId };
  return {
    skillInput: { resourceId },
    context: Object.fromEntries(
      policy.context.requirements.map((requirement) => [
        requirement.requirementId,
        requirement.status === 'satisfied',
      ]),
    ),
    evidence: {},
  };
}

function exactInvocationIdentity(
  invocation: McpInvocation,
  input: DeterministicCapabilityExecutionInput,
  identity: DeterministicCapabilityExecutionIdentity,
): boolean {
  const executionContext = deterministicRuntimeExecutionContext(input);
  return (
    invocation.invocationId === identity.mcpInvocationId &&
    invocation.taskId === input.taskId &&
    invocation.contextId === input.contextId &&
    invocation.serverId === input.serverId &&
    invocation.toolName === input.toolName &&
    invocation.executionMode === executionContext.mode &&
    invocation.simulationId === executionContext.simulationId &&
    canonicalJson(invocation.arguments) === canonicalJson({ resourceId: input.resourceId })
  );
}

function recoverableInvocationExecutionSemantics(
  invocation: McpInvocation,
  input: DeterministicCapabilityExecutionInput,
): boolean {
  const semantics = invocation.executionSemantics;
  if (semantics.effect === 'read_only' && semantics.execution === 'synchronous') return true;

  // Frozen MCP discovery does not declare execution semantics, so its durable receipt retains
  // the domain's complete default_unknown profile. The exception is intentionally limited to
  // the two deterministic get-state identities admitted by the server route; any explicit
  // side effect or task-capable/asynchronous execution remains unrecoverable.
  const supportedUnknownSemanticsRead =
    (input.capabilityId === 'home.light.read-state' &&
      input.skillId === 'home.light.get-state' &&
      input.toolName === 'light_get_state') ||
    (input.capabilityId === 'home.climate.read-state' &&
      input.skillId === 'home.climate.get-state' &&
      input.toolName === 'climate_get_state');
  return (
    supportedUnknownSemanticsRead &&
    semantics.source === 'default_unknown' &&
    semantics.effect === 'unknown' &&
    semantics.execution === 'unknown' &&
    semantics.cancellation === 'unknown' &&
    semantics.idempotency === 'unknown' &&
    semantics.replay === 'unknown'
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
