import {
  ANONYMOUS_USER_ID,
  createTaskCapabilityBinding,
  createTaskCapabilityExecutionAttempt,
  type AgentTask,
  type McpInvocation,
  type RuntimeTaskCapabilityTerminalProof,
  type SkillUsageSelectionContext,
  type TaskCapabilityBinding,
  type TaskCapabilityExecutionAttempt,
  type TaskExecutionAttempt,
} from '../../domain/src/index.js';

import type {
  CurrentMcpProviderBindingAuthorityPort,
  JsonSchemaValidator,
  RuntimeTaskEvent,
} from './ports.js';
import type { RuntimeMcpProviderBindingAdmissionVerifier } from './mcp-runtime-binding-authority.js';
import { canonicalHash } from './mcp-task-readiness.js';

export interface RuntimeCapabilityResolution {
  readonly exposureId: string;
  readonly exposureVersion: number;
  readonly requestedCapabilityId: string;
  readonly capabilityVersion: number;
  readonly requestSchema: unknown;
  readonly requesterPolicy?: Readonly<Record<string, unknown>>;
  readonly successCriteria: readonly Readonly<Record<string, unknown>>[];
  readonly requiredEvidence: readonly Readonly<Record<string, unknown>>[];
  readonly constraints: readonly Readonly<Record<string, unknown>>[];
  readonly implementationRefs: readonly string[];
  readonly providerBindingRefs: readonly string[];
  readonly providerBindingRequirements?: readonly Readonly<{
    bindingId: string;
    localServerId: string;
  }>[];
  readonly providerPolicySnapshot?: unknown;
}

export interface TaskCapabilityAcceptanceStore {
  resolveExposure(
    exposureId: string,
    exposureVersion: number,
    now: string,
  ): Promise<RuntimeCapabilityResolution | undefined>;
  accept(
    input: Readonly<{
      task: AgentTask;
      inputAttempt: TaskExecutionAttempt;
      binding: TaskCapabilityBinding;
      capabilityAttempt: TaskCapabilityExecutionAttempt;
      event: RuntimeTaskEvent;
    }>,
  ): Promise<void>;
  findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
  listAttempts(taskId: string): Promise<readonly TaskCapabilityExecutionAttempt[]>;
  bindInitialPlan?(taskId: string, planId: string): Promise<void>;
  appendAttempt(
    input: Omit<TaskCapabilityExecutionAttempt, 'attemptNo' | 'status'>,
  ): Promise<TaskCapabilityExecutionAttempt>;
  updateLatestAttempt(
    taskId: string,
    status: Exclude<TaskCapabilityExecutionAttempt['status'], 'prepared'>,
    timestamp: string,
  ): Promise<void>;
  reconcileCanceledAttempts(): Promise<number>;
  reconcileFailedAttempts(): Promise<number>;
}

export interface TaskCapabilityEvidenceSource {
  listInvocationsByTask(taskId: string): Promise<readonly McpInvocation[]>;
}

/**
 * PostgreSQL-owned proof projected for one physical dispatch. It deliberately contains no claim
 * that a vehicle is stationary: a remote Task terminal state proves command completion only.
 */
export interface TaskCapabilityPhysicalDispatchEvidence {
  readonly invocationId: string;
  readonly invocationPresent: boolean;
  readonly capabilityAttemptId?: string;
  readonly confirmation?: Readonly<{
    confirmationId: string;
    consumedInvocationId?: string;
    consumedDispatchHash?: string;
    consumedAt?: string;
    revokedAt?: string;
  }>;
  readonly admission?: Readonly<{
    intentId: string;
    invocationId: string;
    taskId: string;
    capabilityAttemptId?: string;
    bindingId: string;
    recordedInvocationId?: string;
    materializedBindingId?: string;
    argumentsHash: string;
    dispatchHash?: string;
    workflowPlanId: string;
    workflowNodeId: string;
    workflowNodeRunId: string;
    status: string;
    reasonCode?: string;
  }>;
  readonly remoteTask?: Readonly<{
    bindingId: string;
    remoteTaskId: string;
    mcpInvocationId: string;
    workflowNodeId: string;
    workflowNodeRunId: string;
    workflowPlanId: string;
    workflowDefinitionId: string;
    workflowDefinitionVersion: number;
    workflowInstanceId: string;
    executionMode: string;
    protocolStatus: string;
    localState: string;
    providerFailureCount: number;
    providerEvidence: readonly unknown[];
    resultIsError?: boolean;
    lastSafeErrorCode?: string;
    invalidatedAt?: string;
    createdAt: string;
    terminalAt?: string;
    acceptedObservationCount: number;
    acceptedObservedAt?: string;
    unsafeObservationCount: number;
    failedProtocolAttemptCount: number;
    terminalEventCount: number;
    processedCompletedEventCount: number;
    terminalEventCreatedAt?: string;
    terminalEventProcessedAt?: string;
    terminalEventStatus?: string;
    terminalEventErrorCode?: string;
    continuationAttemptCount: number;
    waitingExternalContinuationCount: number;
    succeededContinuationCount: number;
  }>;
}

export interface TaskCapabilityPhysicalPlanEvidence {
  readonly planId: string;
  readonly confirmationStatus: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly entryNodeId: string;
  readonly exitNodeIds: readonly string[];
  readonly nodes: readonly Readonly<{
    nodeId: string;
    ordinal: number;
    type: string;
    serverId?: string;
    toolName?: string;
    taskRequired: boolean;
  }>[];
  readonly edges: readonly Readonly<{
    sourceNodeId: string;
    targetNodeId: string;
    outcome?: string;
  }>[];
}

export interface TaskCapabilityPhysicalEvidenceSnapshot {
  readonly plan?: TaskCapabilityPhysicalPlanEvidence;
  readonly dispatches: readonly TaskCapabilityPhysicalDispatchEvidence[];
}

export interface TaskCapabilityPhysicalEvidenceSource {
  loadPhysicalEvidence(
    input: Readonly<{ taskId: string; capabilityAttemptId: string; planId: string }>,
  ): Promise<TaskCapabilityPhysicalEvidenceSnapshot>;
}

export interface TaskCapabilityTerminalSuccessContext {
  readonly outputSchemaValid?: boolean;
  readonly requiredBinding?: Readonly<{
    requestedCapabilityId: string;
    capabilityVersion: number;
  }>;
}

export interface TaskCapabilitySkillUsageAuthority {
  readonly skillId: string;
  readonly skillVersion: number;
  readonly context: SkillUsageSelectionContext;
}

export class RuntimeTaskCapabilityService {
  readonly #store: TaskCapabilityAcceptanceStore;
  readonly #schemas: JsonSchemaValidator;
  readonly #evidence: TaskCapabilityEvidenceSource | undefined;
  readonly #physicalEvidence: TaskCapabilityPhysicalEvidenceSource | undefined;
  readonly #providerBindings: CurrentMcpProviderBindingAuthorityPort | undefined;
  readonly #runtimeProviderBindings: RuntimeMcpProviderBindingAdmissionVerifier | undefined;

  constructor(
    dependencies: Readonly<{
      store: TaskCapabilityAcceptanceStore;
      schemas: JsonSchemaValidator;
      evidence?: TaskCapabilityEvidenceSource;
      physicalEvidence?: TaskCapabilityPhysicalEvidenceSource;
      providerBindings?: CurrentMcpProviderBindingAuthorityPort;
      runtimeProviderBindings?: RuntimeMcpProviderBindingAdmissionVerifier;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#schemas = dependencies.schemas;
    this.#evidence = dependencies.evidence;
    this.#physicalEvidence = dependencies.physicalEvidence;
    this.#providerBindings = dependencies.providerBindings;
    this.#runtimeProviderBindings = dependencies.runtimeProviderBindings;
  }

  async prepareAcceptance(
    input: Readonly<{
      task: AgentTask;
      metadata: Readonly<Record<string, unknown>>;
      capabilityInput: unknown;
      inputAttempt: TaskExecutionAttempt;
      bindingId: string;
      capabilityAttemptId: string;
      event: RuntimeTaskEvent;
    }>,
  ) {
    const request = requestedCapability(input.metadata);
    if (request === undefined) return undefined;
    const resolution = await this.#store.resolveExposure(
      request.exposureId,
      request.exposureVersion,
      input.task.createdAt,
    );
    if (resolution === undefined)
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_ADMISSION_REJECTED',
        'The requested Exposure is not active, current, or ready.',
      );
    const currentProviderBindings = await this.#requireCurrentProviderBindings(resolution);
    assertRequester(resolution.requesterPolicy, input.task.userId);
    const validation = this.#schemas.validate(resolution.requestSchema, input.capabilityInput);
    if (!validation.valid)
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_INPUT_INVALID',
        'The requested Capability input does not match the frozen Exposure schema.',
      );
    const binding = createTaskCapabilityBinding({
      bindingId: input.bindingId,
      taskId: input.task.taskId,
      requestedCapabilityId: resolution.requestedCapabilityId,
      capabilityVersion: resolution.capabilityVersion,
      exposureId: resolution.exposureId,
      exposureVersion: resolution.exposureVersion,
      inputSnapshot: input.capabilityInput,
      successCriteriaSnapshot: resolution.successCriteria,
      evidenceRequirementSnapshot: resolution.requiredEvidence,
      constraintSnapshot: resolution.constraints,
      initialImplementationRefs: resolution.implementationRefs,
      ...(currentProviderBindings.length === 0
        ? resolution.providerPolicySnapshot === undefined
          ? {}
          : { providerPolicySnapshot: resolution.providerPolicySnapshot }
        : {
            providerPolicySnapshot: Object.freeze({
              resolution: resolution.providerPolicySnapshot ?? null,
              currentProviderBindings,
            }),
          }),
      boundAt: input.task.createdAt,
    });
    const capabilityAttempt = createTaskCapabilityExecutionAttempt({
      attemptId: input.capabilityAttemptId,
      taskId: input.task.taskId,
      capabilityBindingId: binding.bindingId,
      attemptNo: 1,
      skillVersionRefs: resolution.implementationRefs.filter((value) => value.startsWith('skill:')),
      providerBindingRefs: resolution.providerBindingRefs,
      reason: 'initial',
      status: 'prepared',
    });
    return Object.freeze({
      task: input.task,
      inputAttempt: input.inputAttempt,
      binding,
      capabilityAttempt,
      event: input.event,
    });
  }

  async #requireCurrentProviderBindings(resolution: RuntimeCapabilityResolution) {
    const requirements = resolution.providerBindingRequirements ?? [];
    if (requirements.length === 0) return Object.freeze([]);
    if (this.#providerBindings === undefined)
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_PROVIDER_BINDING_NOT_CURRENT',
        'Current MCP Provider Binding authority is unavailable.',
      );
    if (this.#runtimeProviderBindings === undefined)
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_PROVIDER_BINDING_NOT_CURRENT',
        'Runtime MCP Provider Binding authority is unavailable.',
      );
    const authorities: Awaited<
      ReturnType<CurrentMcpProviderBindingAuthorityPort['loadCurrentMcpProviderBinding']>
    >[] = [];
    for (const requirement of requirements) {
      try {
        const authority = await this.#providerBindings.loadCurrentMcpProviderBinding({
          bindingId: requirement.bindingId,
          localServerId: requirement.localServerId,
        });
        if (
          authority.binding.bindingId !== requirement.bindingId ||
          authority.binding.localServerId !== requirement.localServerId ||
          Date.parse(authority.binding.availabilityValidUntil) <= Date.parse(authority.observedAt)
        )
          throw new Error('MCP_PROVIDER_BINDING_NOT_CURRENT');
        await this.#runtimeProviderBindings.assertCurrent({
          authority,
          bindingId: requirement.bindingId,
          localServerId: requirement.localServerId,
        });
        authorities.push(authority);
      } catch {
        throw new TaskCapabilityError(
          'TASK_CAPABILITY_PROVIDER_BINDING_NOT_CURRENT',
          'Current MCP Provider Binding authority does not match the admitted Capability.',
        );
      }
    }
    return Object.freeze(authorities);
  }

  accept(input: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]) {
    return this.#store.accept(input);
  }

  findBinding(taskId: string) {
    return this.#store.findBinding(taskId);
  }

  async bindInitialPlan(taskId: string, planId: string): Promise<void> {
    if ((await this.#store.findBinding(taskId)) === undefined) return;
    if (this.#store.bindInitialPlan === undefined)
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_ATTEMPT_CONTEXT_INVALID',
        'Capability execution attempt plan binding is unavailable.',
      );
    await this.#store.bindInitialPlan(taskId, planId);
  }

  /**
   * Projects only context evidence already frozen by Capability admission. The
   * current Provider Binding is re-verified on both Control and Runtime sides;
   * request text and mutable request metadata never become authority here.
   */
  async resolveSkillUsageAuthority(
    taskId: string,
  ): Promise<TaskCapabilitySkillUsageAuthority | undefined> {
    const binding = await this.#store.findBinding(taskId);
    if (binding === undefined) return undefined;
    const skillReference = exactlyOneSkillReference(binding.initialImplementationRefs);
    const exactSkill = exactlyOneConstraint(binding.constraintSnapshot, 'exact_skill_version');
    const resourcePolicy = exactlyOneConstraint(binding.constraintSnapshot, 'resource_policy');
    const providerPolicy = exactlyOneConstraint(
      binding.constraintSnapshot,
      'provider_binding_policy',
    );
    const confirmationPolicy = exactlyOneConstraint(
      binding.constraintSnapshot,
      'confirmation_policy',
    );
    const sideEffectPolicy = exactlyOneSideEffectPolicy(binding.constraintSnapshot);
    const input = isRecord(binding.inputSnapshot) ? binding.inputSnapshot : undefined;
    const resourceId = input?.['resourceId'];
    const allowedResourceIds = resourcePolicy['allowedResourceIds'];
    const localServerId = providerPolicy['localServerId'];
    const providerBindingId = providerPolicy['mcpProviderBindingId'];
    if (
      input === undefined ||
      exactSkill['skillId'] !== skillReference.skillId ||
      exactSkill['skillVersion'] !== skillReference.skillVersion ||
      typeof resourceId !== 'string' ||
      resourceId.trim() === '' ||
      !Array.isArray(allowedResourceIds) ||
      !allowedResourceIds.includes(resourceId) ||
      typeof localServerId !== 'string' ||
      localServerId.trim() === '' ||
      typeof providerBindingId !== 'string' ||
      providerBindingId.trim() === '' ||
      providerPolicy['requiredStatus'] !== 'active' ||
      providerPolicy['requiredAvailabilityStatus'] !== 'available' ||
      providerPolicy['requiredFreshness'] !== 'unexpired' ||
      providerPolicy['fallback'] !== 'deny' ||
      typeof confirmationPolicy['required'] !== 'boolean' ||
      typeof sideEffectPolicy['sideEffecting'] !== 'boolean' ||
      (sideEffectPolicy['type'] === 'physical_side_effect_policy' &&
        !sideEffectPolicy['sideEffecting']) ||
      (sideEffectPolicy['sideEffecting'] && !confirmationPolicy['required'])
    )
      skillUsageAuthorityInvalid('The frozen Task Capability usage policy is incomplete.');
    if (this.#providerBindings === undefined || this.#runtimeProviderBindings === undefined)
      skillUsageAuthorityInvalid('Current Provider Binding authority is unavailable.');

    const resolvedBindingId = await this.resolveCurrentProviderBindingId(taskId, localServerId);
    if (resolvedBindingId !== providerBindingId)
      skillUsageAuthorityInvalid('The frozen Provider Binding identity is not current.');
    try {
      const authority = await this.#providerBindings.loadCurrentMcpProviderBinding({
        bindingId: providerBindingId,
        localServerId,
      });
      if (
        authority.binding.bindingId !== providerBindingId ||
        authority.binding.localServerId !== localServerId ||
        (typeof providerPolicy['bindingRevision'] === 'number' &&
          authority.binding.revision !== providerPolicy['bindingRevision']) ||
        (typeof providerPolicy['catalogRevision'] === 'string' &&
          authority.binding.catalogRevision !== providerPolicy['catalogRevision']) ||
        (typeof providerPolicy['catalogChecksum'] === 'string' &&
          authority.binding.catalogChecksum !== providerPolicy['catalogChecksum'])
      )
        throw new Error('MCP_PROVIDER_BINDING_NOT_CURRENT');
      await this.#runtimeProviderBindings.assertCurrent({
        authority,
        bindingId: providerBindingId,
        localServerId,
      });
      return Object.freeze({
        skillId: skillReference.skillId,
        skillVersion: skillReference.skillVersion,
        context: Object.freeze({
          observations: Object.freeze([
            Object.freeze({
              requirementId: 'public-resource-id',
              source: 'authoritative_context' as const,
              status: 'available' as const,
              evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}`,
            }),
            Object.freeze({
              requirementId: 'provider-binding-freshness',
              source: 'authoritative_context' as const,
              status: 'available' as const,
              evidenceRef: `node-control-provider-binding:${providerBindingId}:revision:${String(authority.binding.revision)}:observed-at:${authority.observedAt}`,
            }),
          ]),
          risk: !sideEffectPolicy['sideEffecting'] ? ('low' as const) : ('high' as const),
          humanConfirmation: confirmationPolicy['required']
            ? ('pending' as const)
            : ('not_requested' as const),
          taskAvailabilityArguments: Object.freeze({
            unresolved: false as const,
            value: Object.freeze(structuredClone(input)),
          }),
          systemPolicy: Object.freeze({
            allowedModes: Object.freeze(['guidance', 'template', 'procedure'] as const),
            requireProcedureForHighRisk: true,
            allowGuidanceWithIncompleteContext: false,
          }),
        }),
      });
    } catch (error) {
      if (
        error instanceof TaskCapabilityError &&
        error.code === 'TASK_CAPABILITY_SKILL_USAGE_AUTHORITY_INVALID'
      )
        throw error;
      skillUsageAuthorityInvalid('The current Provider Binding could not be verified.');
    }
  }

  listAttempts(taskId: string) {
    return this.#store.listAttempts(taskId);
  }

  async resolveCurrentProviderBindingId(
    taskId: string,
    localServerId: string,
  ): Promise<string | undefined> {
    const binding = await this.#store.findBinding(taskId);
    if (binding === undefined) return undefined;
    const frozenAuthorities = currentProviderBindingAuthorities(binding.providerPolicySnapshot);
    if (frozenAuthorities !== undefined) {
      const matches = frozenAuthorities.filter(
        (authority) => authority.localServerId === localServerId,
      );
      if (matches.length === 1) return matches[0]?.bindingId;
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_PROVIDER_BINDING_CONTEXT_INVALID',
        'Frozen MCP Provider Binding authority does not uniquely match the requested Server.',
      );
    }
    const attempts = await this.#store.listAttempts(taskId);
    const references = attempts.at(-1)?.providerBindingRefs ?? [];
    if (references.length === 0) return undefined;
    if (references.length === 1 && references[0]?.trim() !== '') return references[0];
    throw new TaskCapabilityError(
      'TASK_CAPABILITY_PROVIDER_BINDING_CONTEXT_INVALID',
      'Legacy MCP Provider Binding references are ambiguous for the requested Server.',
    );
  }

  async resolveCurrentCapabilityAttemptId(taskId: string): Promise<string | undefined> {
    const binding = await this.#store.findBinding(taskId);
    if (binding === undefined) return undefined;
    const latestAttempt = (await this.#store.listAttempts(taskId)).at(-1);
    if (
      latestAttempt?.taskId !== taskId ||
      latestAttempt.capabilityBindingId !== binding.bindingId ||
      !['prepared', 'running', 'waiting'].includes(latestAttempt.status)
    )
      throw new TaskCapabilityError(
        'TASK_CAPABILITY_ATTEMPT_CONTEXT_INVALID',
        'MCP invocation requires the latest active Capability execution attempt.',
      );
    return latestAttempt.attemptId;
  }

  async appendAttempt(
    taskId: string,
    input: Readonly<{
      attemptId: string;
      reason: Exclude<TaskCapabilityExecutionAttempt['reason'], 'initial'>;
      planId?: string;
      planTemplateRef?: string;
      skillVersionRefs?: readonly string[];
      providerBindingRefs?: readonly string[];
    }>,
  ) {
    const binding = await this.#store.findBinding(taskId);
    if (binding === undefined) return undefined;
    return this.#store.appendAttempt({
      attemptId: input.attemptId,
      taskId,
      capabilityBindingId: binding.bindingId,
      ...(input.planId === undefined ? {} : { planId: input.planId }),
      ...(input.planTemplateRef === undefined ? {} : { planTemplateRef: input.planTemplateRef }),
      skillVersionRefs: input.skillVersionRefs ?? [],
      providerBindingRefs: input.providerBindingRefs ?? [],
      reason: input.reason,
    });
  }

  async assertTerminalSuccess(
    taskId: string,
    result: unknown,
    context: TaskCapabilityTerminalSuccessContext = {},
  ): Promise<RuntimeTaskCapabilityTerminalProof | undefined> {
    const binding = await this.#store.findBinding(taskId);
    if (binding === undefined) {
      if (context.requiredBinding !== undefined)
        terminal('Capability completion requires the exact frozen Task binding.');
      return undefined;
    }
    if (
      context.requiredBinding !== undefined &&
      (binding.requestedCapabilityId !== context.requiredBinding.requestedCapabilityId ||
        binding.capabilityVersion !== context.requiredBinding.capabilityVersion)
    )
      terminal('Capability completion binding does not match the expected Capability authority.');
    if (!isRecord(result)) terminal('Capability completion requires a structured result.');
    const latestAttempt = (await this.#store.listAttempts(taskId)).at(-1);
    if (
      latestAttempt?.taskId !== taskId ||
      latestAttempt.capabilityBindingId !== binding.bindingId ||
      !['prepared', 'running', 'waiting'].includes(latestAttempt.status)
    )
      terminal('Capability completion requires the latest active execution attempt.');
    const taskInvocations =
      this.#evidence === undefined ? [] : await this.#evidence.listInvocationsByTask(taskId);
    const invocations = taskInvocations.filter(
      (invocation) => invocation.capabilityAttemptId === latestAttempt.attemptId,
    );
    const physicalPolicy = physicalSideEffectPolicy(binding.constraintSnapshot);
    const physicalDispatches =
      physicalPolicy === undefined
        ? undefined
        : await this.#loadPhysicalDispatchProof(
            taskId,
            latestAttempt,
            binding,
            invocations,
            physicalPolicy,
          );
    for (const criterion of binding.successCriteriaSnapshot) {
      if (!criterionSatisfied(criterion, result, binding, invocations, context, physicalDispatches))
        terminal(`Frozen success criterion ${String(criterion['type'])} is not satisfied.`);
    }
    for (const requirement of binding.evidenceRequirementSnapshot) {
      if (!evidenceSatisfied(requirement, result, binding, invocations, physicalDispatches))
        terminal('Required Capability evidence is incomplete.');
    }
    for (const constraint of binding.constraintSnapshot) {
      if (!constraintSatisfied(constraint, result, binding, invocations, physicalDispatches))
        terminal('A frozen safety or authorization constraint is not satisfied.');
    }
    return Object.freeze({
      taskId,
      bindingId: binding.bindingId,
      bindingHash: binding.bindingHash,
      attemptId: latestAttempt.attemptId,
      requestedCapabilityId: binding.requestedCapabilityId,
      capabilityVersion: binding.capabilityVersion,
    });
  }

  async #loadPhysicalDispatchProof(
    taskId: string,
    capabilityAttempt: TaskCapabilityExecutionAttempt,
    binding: TaskCapabilityBinding,
    invocations: readonly McpInvocation[],
    policy: Readonly<Record<string, unknown>>,
  ): Promise<PhysicalDispatchProof> {
    if (this.#physicalEvidence === undefined)
      terminal('Physical Capability completion requires durable remote Task lifecycle evidence.');
    if (capabilityAttempt.planId === undefined)
      terminal('Physical Capability completion requires one exact confirmed Workflow plan.');
    const evidence = await this.#physicalEvidence.loadPhysicalEvidence({
      taskId,
      capabilityAttemptId: capabilityAttempt.attemptId,
      planId: capabilityAttempt.planId,
    });
    return createPhysicalDispatchProof(
      capabilityAttempt.attemptId,
      capabilityAttempt.planId,
      binding,
      invocations,
      evidence,
      policy,
    );
  }

  async markLatestAttempt(
    taskId: string,
    status: 'succeeded' | 'failed' | 'canceled',
    timestamp: string,
  ) {
    if ((await this.#store.findBinding(taskId)) === undefined) return;
    await this.#store.updateLatestAttempt(taskId, status, timestamp);
  }

  reconcileCanceledAttempts(): Promise<number> {
    return this.#store.reconcileCanceledAttempts();
  }

  reconcileFailedAttempts(): Promise<number> {
    return this.#store.reconcileFailedAttempts();
  }
}

function requestedCapability(metadata: Readonly<Record<string, unknown>>) {
  const raw = metadata['io.sdar/requestedCapability'];
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) invalidRequest();
  const exposureId = raw['exposureId'];
  const versionConstraint = raw['versionConstraint'];
  const requestId = raw['requestId'];
  if (
    typeof exposureId !== 'string' ||
    exposureId.trim() === '' ||
    typeof versionConstraint !== 'string' ||
    !/^[1-9][0-9]*$/u.test(versionConstraint) ||
    typeof requestId !== 'string' ||
    requestId.trim() === ''
  )
    invalidRequest();
  return { exposureId: exposureId.trim(), exposureVersion: Number(versionConstraint) };
}

function assertRequester(policy: Readonly<Record<string, unknown>> | undefined, userId: string) {
  if (policy === undefined) return;
  if (userId === ANONYMOUS_USER_ID && policy['allowAnonymous'] === false)
    throw new TaskCapabilityError(
      'TASK_CAPABILITY_REQUESTER_FORBIDDEN',
      'Anonymous access is forbidden.',
    );
  const allowlist = policy['allowedRequesterIds'];
  if (
    Array.isArray(allowlist) &&
    allowlist.length > 0 &&
    !allowlist.some((value) => value === userId)
  )
    throw new TaskCapabilityError(
      'TASK_CAPABILITY_REQUESTER_FORBIDDEN',
      'Requester is not allowlisted.',
    );
}

interface PhysicalDispatchProof {
  readonly expectedDispatchCount: number;
  readonly expectedPlanNodes: readonly TaskCapabilityPhysicalPlanEvidence['nodes'][number][];
  readonly dispatches: readonly Readonly<{
    invocation: McpInvocation;
    evidence: TaskCapabilityPhysicalDispatchEvidence;
  }>[];
  readonly valid: boolean;
}

function physicalSideEffectPolicy(
  constraints: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> | undefined {
  const policies = constraints.filter(
    (constraint) => constraint['type'] === 'physical_side_effect_policy',
  );
  if (policies.length === 0) return undefined;
  if (policies.length !== 1) terminal('Physical Capability requires one side-effect policy.');
  return policies[0];
}

function createPhysicalDispatchProof(
  capabilityAttemptId: string,
  planId: string,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
  evidence: TaskCapabilityPhysicalEvidenceSnapshot,
  policy: Readonly<Record<string, unknown>>,
): PhysicalDispatchProof {
  const rawExpectedDispatchCount = policy['dispatchMaximum'];
  const expectedDispatchCount =
    typeof rawExpectedDispatchCount === 'number' &&
    Number.isSafeInteger(rawExpectedDispatchCount) &&
    rawExpectedDispatchCount > 0
      ? rawExpectedDispatchCount
      : 0;
  const provider = providerBindingPolicy(binding.constraintSnapshot);
  const expectedPlanNodes =
    provider === undefined
      ? undefined
      : physicalPlanSequence(evidence.plan, planId, provider, expectedDispatchCount);
  const sideEffectingInvocations = invocations
    .filter((invocation) => invocation.executionSemantics.effect === 'side_effecting')
    .sort(compareInvocationOrder);
  const invocationIds = new Set(sideEffectingInvocations.map((item) => item.invocationId));
  const matchingEvidence = evidence.dispatches.filter((item) =>
    invocationIds.has(item.invocationId),
  );
  const evidenceByInvocation = new Map(
    matchingEvidence.map((item) => [item.invocationId, item] as const),
  );
  const dispatches = sideEffectingInvocations.flatMap((invocation) => {
    const item = evidenceByInvocation.get(invocation.invocationId);
    return item === undefined ? [] : [{ invocation, evidence: item }];
  });
  let valid =
    expectedDispatchCount > 0 &&
    provider !== undefined &&
    expectedPlanNodes !== undefined &&
    invocations.length === expectedDispatchCount &&
    sideEffectingInvocations.length === expectedDispatchCount &&
    evidence.dispatches.length === expectedDispatchCount &&
    evidence.dispatches.every((item) => item.capabilityAttemptId === capabilityAttemptId) &&
    matchingEvidence.length === expectedDispatchCount &&
    evidenceByInvocation.size === expectedDispatchCount &&
    dispatches.length === expectedDispatchCount;

  const confirmationIds = new Set<string>();
  const admissionIntentIds = new Set<string>();
  const dispatchHashes = new Set<string>();
  const remoteBindingIds = new Set<string>();
  const remoteTaskIds = new Set<string>();
  const nodeRunIds = new Set<string>();
  const workflowInstanceIds = new Set<string>();
  let previousTerminalAt: number | undefined;
  for (const [index, { invocation, evidence: dispatchEvidence }] of dispatches.entries()) {
    const confirmation = dispatchEvidence.confirmation;
    const admission = dispatchEvidence.admission;
    const remote = dispatchEvidence.remoteTask;
    const expectedNode = expectedPlanNodes?.[index];
    const invocationStartedAt = parseTimestamp(invocation.startedAt);
    const invocationCompletedAt = parseTimestamp(invocation.completedAt);
    const consumedAt = parseTimestamp(confirmation?.consumedAt);
    const bindingCreatedAt = parseTimestamp(remote?.createdAt);
    const acceptedObservedAt = parseTimestamp(remote?.acceptedObservedAt);
    const remoteTerminalAt = parseTimestamp(remote?.terminalAt);
    const terminalCreatedAt = parseTimestamp(remote?.terminalEventCreatedAt);
    const terminalProcessedAt = parseTimestamp(remote?.terminalEventProcessedAt);
    const receipt = isRecord(invocation.result) ? invocation.result['remoteTask'] : undefined;
    const remoteReceipt = isRecord(receipt) ? receipt : undefined;
    const intermediate = index < expectedDispatchCount - 1;
    const lifecycleValid =
      remote !== undefined &&
      (intermediate
        ? remote.localState === 'reentered' &&
          remote.terminalEventStatus === 'processed' &&
          remote.processedCompletedEventCount === 1 &&
          terminalProcessedAt !== undefined &&
          remote.continuationAttemptCount === 1 &&
          remote.waitingExternalContinuationCount === 1 &&
          remote.succeededContinuationCount === 0
        : ((remote.localState === 'terminal_event_claimed' &&
            remote.terminalEventStatus === 'claimed' &&
            remote.processedCompletedEventCount === 0 &&
            terminalProcessedAt === undefined) ||
            (remote.localState === 'reentered' &&
              remote.terminalEventStatus === 'processed' &&
              remote.processedCompletedEventCount === 1 &&
              terminalProcessedAt !== undefined)) &&
          remote.continuationAttemptCount === 1 &&
          remote.waitingExternalContinuationCount === 0 &&
          remote.succeededContinuationCount === 1);
    const dispatchValid =
      dispatchEvidence.invocationPresent &&
      dispatchEvidence.capabilityAttemptId === capabilityAttemptId &&
      invocation.capabilityAttemptId === capabilityAttemptId &&
      invocation.executionMode === 'live' &&
      invocation.status === 'succeeded' &&
      invocation.executionSemantics.effect === 'side_effecting' &&
      invocation.executionSemantics.execution === 'task_required' &&
      invocation.executionSemantics.replay === 'forbidden' &&
      invocation.serverId === provider?.serverId &&
      invocation.toolName === provider.toolName &&
      nonEmpty(invocation.controlConfirmationId) &&
      nonEmpty(invocation.controlProviderBindingId) &&
      nonEmpty(invocation.controlArgumentsHash) &&
      nonEmpty(invocation.controlDispatchHash) &&
      invocation.controlArgumentsHash === canonicalHash(invocation.arguments) &&
      invocation.controlArgumentsHash === canonicalHash(binding.inputSnapshot) &&
      confirmation?.confirmationId === invocation.controlConfirmationId &&
      confirmation.consumedInvocationId === invocation.invocationId &&
      confirmation.consumedDispatchHash === invocation.controlDispatchHash &&
      confirmation.revokedAt === undefined &&
      invocationStartedAt !== undefined &&
      invocationCompletedAt !== undefined &&
      consumedAt !== undefined &&
      invocationStartedAt <= consumedAt &&
      consumedAt <= invocationCompletedAt &&
      admission?.invocationId === invocation.invocationId &&
      admission.taskId === binding.taskId &&
      admission.capabilityAttemptId === capabilityAttemptId &&
      admission.recordedInvocationId === invocation.invocationId &&
      admission.argumentsHash === invocation.controlArgumentsHash &&
      admission.dispatchHash === invocation.controlDispatchHash &&
      admission.status === 'materialized' &&
      admission.reasonCode === undefined &&
      admission.bindingId === remote?.bindingId &&
      admission.materializedBindingId === remote.bindingId &&
      admission.workflowPlanId === planId &&
      admission.workflowNodeId === remote.workflowNodeId &&
      admission.workflowNodeRunId === remote.workflowNodeRunId &&
      remote.mcpInvocationId === invocation.invocationId &&
      remote.workflowPlanId === planId &&
      remote.workflowNodeId === expectedNode?.nodeId &&
      remote.executionMode === 'live' &&
      remote.protocolStatus === 'completed' &&
      remote.providerFailureCount === 0 &&
      remote.resultIsError === false &&
      remote.lastSafeErrorCode === undefined &&
      remote.invalidatedAt === undefined &&
      remote.unsafeObservationCount === 0 &&
      remote.failedProtocolAttemptCount === 0 &&
      remote.acceptedObservationCount === 1 &&
      remote.terminalEventCount === 1 &&
      remote.terminalEventErrorCode === undefined &&
      lifecycleValid &&
      bindingCreatedAt !== undefined &&
      acceptedObservedAt !== undefined &&
      remoteTerminalAt !== undefined &&
      terminalCreatedAt !== undefined &&
      bindingCreatedAt === acceptedObservedAt &&
      bindingCreatedAt <= remoteTerminalAt &&
      remoteTerminalAt <= terminalCreatedAt &&
      (terminalProcessedAt === undefined || terminalCreatedAt <= terminalProcessedAt) &&
      (previousTerminalAt === undefined || previousTerminalAt <= invocationStartedAt) &&
      remoteReceipt?.['remoteTaskId'] === remote.remoteTaskId;
    valid &&= dispatchValid;
    previousTerminalAt = terminalCreatedAt;
    if (confirmation !== undefined) confirmationIds.add(confirmation.confirmationId);
    if (admission !== undefined) admissionIntentIds.add(admission.intentId);
    if (invocation.controlDispatchHash !== undefined)
      dispatchHashes.add(invocation.controlDispatchHash);
    if (remote !== undefined) {
      remoteBindingIds.add(remote.bindingId);
      remoteTaskIds.add(remote.remoteTaskId);
      nodeRunIds.add(remote.workflowNodeRunId);
      workflowInstanceIds.add(remote.workflowInstanceId);
    }
  }
  valid &&=
    confirmationIds.size === expectedDispatchCount &&
    admissionIntentIds.size === expectedDispatchCount &&
    dispatchHashes.size === expectedDispatchCount &&
    remoteBindingIds.size === expectedDispatchCount &&
    remoteTaskIds.size === expectedDispatchCount &&
    nodeRunIds.size === expectedDispatchCount &&
    workflowInstanceIds.size === 1;
  return Object.freeze({
    expectedDispatchCount,
    expectedPlanNodes: Object.freeze(expectedPlanNodes ?? []),
    dispatches: Object.freeze(dispatches),
    valid,
  });
}

function physicalPlanSequence(
  plan: TaskCapabilityPhysicalPlanEvidence | undefined,
  planId: string,
  provider: Readonly<{ serverId: string; toolName: string }>,
  expectedDispatchCount: number,
): readonly TaskCapabilityPhysicalPlanEvidence['nodes'][number][] | undefined {
  if (
    plan?.planId !== planId ||
    plan.confirmationStatus !== 'confirmed' ||
    expectedDispatchCount < 1 ||
    plan.nodes.some((node) => node.type === 'loop' || node.type === 'parallel')
  )
    return undefined;
  const toolNodes = plan.nodes.filter((node) => node.type === 'mcp_tool');
  if (
    toolNodes.length !== expectedDispatchCount ||
    new Set(toolNodes.map((node) => node.nodeId)).size !== expectedDispatchCount ||
    toolNodes.some(
      (node) =>
        node.serverId !== provider.serverId ||
        node.toolName !== provider.toolName ||
        !node.taskRequired,
    )
  )
    return undefined;
  for (const [index, node] of toolNodes.entries()) {
    const previous = toolNodes[index - 1];
    const next = toolNodes[index + 1];
    const incoming = plan.edges.filter((edge) => edge.targetNodeId === node.nodeId);
    const outgoing = plan.edges.filter((edge) => edge.sourceNodeId === node.nodeId);
    if (
      (previous === undefined
        ? incoming.length > 1
        : incoming.length !== 1 || incoming[0]?.sourceNodeId !== previous.nodeId) ||
      (next === undefined
        ? outgoing.length > 1
        : outgoing.length !== 1 || outgoing[0]?.targetNodeId !== next.nodeId)
    )
      return undefined;
  }
  return Object.freeze(toolNodes);
}

function boundedMovementSatisfied(
  constraint: Readonly<Record<string, unknown>>,
  proof: PhysicalDispatchProof,
  binding: TaskCapabilityBinding,
): boolean {
  const toolName = constraint['toolName'];
  const missionType = constraint['missionType'];
  const missionTypePath = propertyPath(constraint['missionTypeArgumentPath']);
  const directionPath = propertyPath(constraint['directionArgumentPath']);
  const distancePath = propertyPath(constraint['distanceArgumentPath']);
  const allowedDirections = stringValues(constraint['allowedDirections']);
  const exclusiveMinimum = constraint['exclusiveMinimum'];
  const maximumInclusive = constraint['maximumInclusive'];
  const exactDirection = constraint['exactDirection'];
  const exactDistancePerDispatch = constraint['exactDistancePerDispatch'];
  const exactDispatchCount = constraint['exactDispatchCount'];
  const exactTotalDistance = constraint['exactTotalDistance'];
  if (
    typeof toolName !== 'string' ||
    typeof missionType !== 'string' ||
    missionTypePath === undefined ||
    directionPath === undefined ||
    distancePath === undefined ||
    allowedDirections === undefined ||
    allowedDirections.length === 0 ||
    typeof exclusiveMinimum !== 'number' ||
    !Number.isFinite(exclusiveMinimum) ||
    typeof maximumInclusive !== 'number' ||
    !Number.isFinite(maximumInclusive) ||
    maximumInclusive <= exclusiveMinimum ||
    typeof exactDirection !== 'string' ||
    exactDirection.trim() === '' ||
    typeof exactDistancePerDispatch !== 'number' ||
    !Number.isFinite(exactDistancePerDispatch) ||
    !Number.isSafeInteger(exactDispatchCount) ||
    typeof exactDispatchCount !== 'number' ||
    exactDispatchCount < 1 ||
    typeof exactTotalDistance !== 'number' ||
    !Number.isFinite(exactTotalDistance) ||
    constraint['strictSequential'] !== true ||
    constraint['terminalBeforeNext'] !== true
  )
    return false;
  const inputDirection = valueAtPath(binding.inputSnapshot, directionPath);
  const inputDistance = valueAtPath(binding.inputSnapshot, distancePath);
  return (
    inputDirection === exactDirection &&
    inputDistance === exactDistancePerDispatch &&
    exactDispatchCount === proof.expectedDispatchCount &&
    nearlyEqual(exactDistancePerDispatch * exactDispatchCount, exactTotalDistance) &&
    proof.dispatches.every(({ invocation }) => {
      const direction = valueAtPath(invocation.arguments, directionPath);
      const distance = valueAtPath(invocation.arguments, distancePath);
      return (
        invocation.toolName === toolName &&
        valueAtPath(invocation.arguments, missionTypePath) === missionType &&
        direction === exactDirection &&
        typeof direction === 'string' &&
        allowedDirections.includes(direction) &&
        distance === exactDistancePerDispatch &&
        typeof distance === 'number' &&
        Number.isFinite(distance) &&
        distance > exclusiveMinimum &&
        distance <= maximumInclusive
      );
    })
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function compareInvocationOrder(left: McpInvocation, right: McpInvocation): number {
  return (
    left.startedAt.localeCompare(right.startedAt) ||
    left.invocationId.localeCompare(right.invocationId)
  );
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function propertyPath(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty) ? value : undefined;
}

function stringValues(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty) ? value : undefined;
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function criterionSatisfied(
  criterion: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
  context: Readonly<{ outputSchemaValid?: boolean }>,
  physicalDispatches?: PhysicalDispatchProof,
) {
  if (criterion['type'] === 'field_equals' && typeof criterion['field'] === 'string')
    return Object.is(result[criterion['field']], criterion['value']);
  if (criterion['type'] === 'coverage' && typeof criterion['minimum'] === 'number')
    return typeof result['coverage'] === 'number' && result['coverage'] >= criterion['minimum'];
  if (criterion['type'] === 'output_schema_valid' && criterion['required'] === true)
    return context.outputSchemaValid === true;
  if (criterion['type'] === 'resource_identity_matches_request' && criterion['required'] === true)
    return resourceIdentityMatches(binding, result);
  if (
    criterion['type'] === 'state_confirmation_matches_request' &&
    criterion['required'] === true
  ) {
    const input = isRecord(binding.inputSnapshot) ? binding.inputSnapshot : undefined;
    return (
      input !== undefined &&
      result['resourceId'] === input['resourceId'] &&
      result['power'] === input['power'] &&
      result['confirmed'] === true
    );
  }
  if (criterion['type'] === 'required_evidence_complete' && criterion['required'] === true)
    return binding.evidenceRequirementSnapshot.every((requirement) =>
      evidenceSatisfied(requirement, result, binding, invocations, physicalDispatches),
    );
  if (criterion['type'] === 'mcp_acceptance_is_terminal_success')
    return criterion['value'] === false && physicalDispatches?.valid === true;
  if (criterion['type'] === 'remote_task_identity_present' && criterion['required'] === true)
    return physicalDispatches?.valid === true;
  if (criterion['type'] === 'remote_terminal_observation_present' && criterion['required'] === true)
    return physicalDispatches?.valid === true;
  if (criterion['type'] === 'external_command_dispatch_count' && physicalDispatches?.valid === true)
    return exactDispatchCriterionCount(criterion) === physicalDispatches.expectedDispatchCount;
  // Baseline restoration is a cross-Task write lifecycle proof. It remains
  // fail-closed until an authoritative lifecycle supplies that proof.
  return false;
}

function evidenceSatisfied(
  requirement: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
  physicalDispatches?: PhysicalDispatchProof,
) {
  if (requirement['type'] === 'provider_result' && typeof requirement['field'] === 'string')
    return providerResultEvidenceSatisfied(requirement, result, binding, invocations);
  if (requirement['type'] === 'route_trace') return result['routeTrace'] !== undefined;
  if (
    requirement['type'] === 'required_evidence' &&
    typeof requirement['evidenceType'] === 'string' &&
    requirement['required'] === true
  ) {
    const evidenceType = requirement['evidenceType'];
    if (physicalDispatches !== undefined)
      return (
        physicalDispatches.valid &&
        physicalDispatches.dispatches.every(({ evidence }) =>
          providerEvidencePresent(
            evidence.remoteTask?.providerEvidence,
            evidenceType,
            requirement['hardGate'] === true,
          ),
        )
      );
    const policy = providerBindingPolicy(binding.constraintSnapshot);
    if (policy === undefined) return false;
    return invocations.some(
      (invocation) =>
        invocation.status === 'succeeded' &&
        invocation.serverId === policy.serverId &&
        invocation.toolName === policy.toolName &&
        invocation.executionSemantics.effect === 'read_only' &&
        isRecord(invocation.result) &&
        invocation.result['isError'] === false &&
        canonical(invocation.result['structuredContent']) === canonical(result) &&
        providerEvidencePresent(
          invocation.result['evidence'],
          evidenceType,
          requirement['hardGate'] === true,
        ),
    );
  }
  return false;
}

function providerResultEvidenceSatisfied(
  requirement: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
): boolean {
  const field = requirement['field'];
  if (typeof field !== 'string') return false;
  const governedKeys = [
    'inputField',
    'serverId',
    'toolName',
    'evidenceType',
    'required',
    'hardGate',
  ] as const;
  if (!governedKeys.some((key) => Object.hasOwn(requirement, key)))
    return result[field] !== undefined;

  const inputField = requirement['inputField'];
  const serverId = requirement['serverId'];
  const toolName = requirement['toolName'];
  const evidenceType = requirement['evidenceType'];
  if (
    field.trim() === '' ||
    typeof inputField !== 'string' ||
    inputField.trim() === '' ||
    typeof serverId !== 'string' ||
    serverId.trim() === '' ||
    typeof toolName !== 'string' ||
    toolName.trim() === '' ||
    typeof evidenceType !== 'string' ||
    evidenceType.trim() === '' ||
    requirement['required'] !== true ||
    requirement['hardGate'] !== true ||
    result[field] === undefined
  )
    return false;
  const input = isRecord(binding.inputSnapshot) ? binding.inputSnapshot : undefined;
  const expectedResourceId = input?.[inputField];
  if (typeof expectedResourceId !== 'string' || expectedResourceId.trim() === '') return false;

  const matchingInvocations = invocations.filter(
    (invocation) =>
      invocation.status === 'succeeded' &&
      invocation.executionMode === 'live' &&
      invocation.serverId === serverId &&
      invocation.toolName === toolName &&
      invocation.executionSemantics.effect === 'read_only' &&
      invocation.arguments['resourceId'] === expectedResourceId &&
      isRecord(invocation.result) &&
      invocation.result['isError'] === false &&
      canonical(invocation.result['structuredContent']) === canonical(result[field]) &&
      providerEvidencePresent(invocation.result['evidence'], evidenceType, true),
  );
  return matchingInvocations.length === 1;
}

function constraintSatisfied(
  constraint: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
  physicalDispatches?: PhysicalDispatchProof,
) {
  if (constraint['type'] === 'authorization' || constraint['type'] === 'safety') {
    const evidence = result['policyEvidence'];
    return (
      Array.isArray(evidence) &&
      evidence.some(
        (item) =>
          isRecord(item) && item['type'] === constraint['type'] && item['satisfied'] === true,
      )
    );
  }
  if (constraint['type'] === 'resource_policy') {
    const input = isRecord(binding.inputSnapshot) ? binding.inputSnapshot : undefined;
    const resourceId = input?.['resourceId'];
    if (physicalDispatches !== undefined)
      return (
        constraint['identifierAuthority'] === 'public_smpp_tool_schema' &&
        constraint['selection'] === 'exact_value' &&
        constraint['downstreamResourceBinding'] === 'forbidden' &&
        typeof resourceId === 'string' &&
        Array.isArray(constraint['allowedResourceIds']) &&
        constraint['allowedResourceIds'].includes(resourceId) &&
        resourceIdentityMatches(binding, result) &&
        physicalDispatches.valid &&
        physicalDispatches.dispatches.every(
          ({ invocation }) => invocation.arguments['resourceId'] === resourceId,
        )
      );
    return (
      constraint['identifierAuthority'] === 'public_resource_id' &&
      constraint['selection'] === 'request_value' &&
      constraint['physicalResourceBinding'] === 'forbidden' &&
      typeof resourceId === 'string' &&
      Array.isArray(constraint['allowedResourceIds']) &&
      constraint['allowedResourceIds'].includes(resourceId) &&
      resourceIdentityMatches(binding, result) &&
      !containsPhysicalResourceIdentity(result)
    );
  }
  if (constraint['type'] === 'provider_binding_policy') {
    const policy = providerBindingPolicy([constraint]);
    if (policy === undefined) return false;
    if (physicalDispatches !== undefined)
      return (
        physicalDispatches.valid &&
        constraint['requiredStatus'] === 'active' &&
        constraint['requiredAvailabilityStatus'] === 'available' &&
        constraint['requiredFreshness'] === 'unexpired' &&
        constraint['fallback'] === 'deny' &&
        physicalDispatches.dispatches.every(
          ({ invocation }) =>
            invocation.serverId === policy.serverId &&
            invocation.toolName === policy.toolName &&
            invocation.controlProviderBindingId === constraint['mcpProviderBindingId'],
        )
      );
    return (
      constraint['requiredStatus'] === 'active' &&
      constraint['requiredAvailabilityStatus'] === 'available' &&
      constraint['requiredFreshness'] === 'unexpired' &&
      constraint['fallback'] === 'deny' &&
      binding.initialImplementationRefs.some((reference) => reference.startsWith('skill:')) &&
      invocations.some(
        (invocation) =>
          invocation.status === 'succeeded' &&
          invocation.serverId === policy.serverId &&
          invocation.toolName === policy.toolName &&
          invocation.executionSemantics.effect === 'read_only',
      )
    );
  }
  if (constraint['type'] === 'exact_skill_version') {
    const skillId = constraint['skillId'];
    const skillVersion = constraint['skillVersion'];
    const taskType = constraint['taskType'];
    const exact =
      typeof skillId === 'string' &&
      Number.isSafeInteger(skillVersion) &&
      binding.initialImplementationRefs.includes(`skill:${skillId}:${String(skillVersion)}`) &&
      typeof taskType === 'string';
    if (!exact) return false;
    return physicalDispatches === undefined
      ? invocations.some(
          (invocation) => invocation.status === 'succeeded' && invocation.toolName === taskType,
        )
      : physicalDispatches.valid &&
          physicalDispatches.dispatches.every(({ invocation }) => invocation.toolName === taskType);
  }
  if (constraint['type'] === 'confirmation_policy')
    return physicalDispatches === undefined
      ? constraint['required'] === false && constraint['stage'] === 'not_applicable'
      : constraint['required'] === true &&
          ['before_execution', 'pre_dispatch'].includes(String(constraint['stage'])) &&
          physicalDispatches.valid;
  if (constraint['type'] === 'physical_side_effect_policy')
    return (
      physicalDispatches?.valid === true &&
      constraint['sideEffecting'] === true &&
      constraint['dispatchMaximum'] === physicalDispatches.expectedDispatchCount &&
      constraint['uncertainDispatchPolicy'] === 'reconcile_never_redispatch' &&
      constraint['remoteTaskTerminalEvidenceRequired'] === true
    );
  if (constraint['type'] === 'bounded_movement_policy')
    return (
      physicalDispatches?.valid === true &&
      boundedMovementSatisfied(constraint, physicalDispatches, binding)
    );
  return false;
}

function exactDispatchCriterionCount(
  criterion: Readonly<Record<string, unknown>>,
): number | undefined {
  const exact = criterion['exact'];
  if (typeof exact === 'number' && Number.isSafeInteger(exact) && exact > 0) return exact;
  const minimum = criterion['minimum'];
  const maximum = criterion['maximum'];
  return typeof minimum === 'number' &&
    Number.isSafeInteger(minimum) &&
    minimum > 0 &&
    minimum === maximum
    ? minimum
    : undefined;
}

function resourceIdentityMatches(
  binding: TaskCapabilityBinding,
  result: Readonly<Record<string, unknown>>,
): boolean {
  const input = isRecord(binding.inputSnapshot) ? binding.inputSnapshot : undefined;
  return typeof input?.['resourceId'] === 'string' && result['resourceId'] === input['resourceId'];
}

function providerBindingPolicy(
  constraints: readonly Readonly<Record<string, unknown>>[],
): Readonly<{ serverId: string; toolName: string }> | undefined {
  const policies = constraints.filter(
    (constraint) => constraint['type'] === 'provider_binding_policy',
  );
  if (policies.length !== 1) return undefined;
  const policy = policies[0];
  if (
    policy === undefined ||
    typeof policy['mcpProviderBindingId'] !== 'string' ||
    policy['mcpProviderBindingId'].trim() === '' ||
    typeof policy['localServerId'] !== 'string' ||
    typeof policy['mcpToolName'] !== 'string'
  )
    return undefined;
  return { serverId: policy['localServerId'], toolName: policy['mcpToolName'] };
}

function providerEvidencePresent(value: unknown, evidenceType: string, hardGate: boolean): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (
      !isRecord(item) ||
      item['evidenceType'] !== evidenceType ||
      typeof item['evidenceId'] !== 'string' ||
      item['evidenceId'].trim() === '' ||
      typeof item['observedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(item['observedAt'])) ||
      !isRecord(item['payloadRef'])
    )
      return false;
    const payload = item['payloadRef'];
    if (payload['kind'] === 'structured_content') return typeof payload['jsonPointer'] === 'string';
    if (
      payload['kind'] !== 'uri' ||
      typeof payload['uri'] !== 'string' ||
      payload['uri'].trim() === ''
    )
      return false;
    return (
      !hardGate ||
      (typeof payload['sha256'] === 'string' && /^[a-f0-9]{64}$/u.test(payload['sha256']))
    );
  });
}

function containsPhysicalResourceIdentity(value: unknown): boolean {
  if (
    typeof value === 'string' &&
    /^(?:light|climate|sensor|switch|input_boolean)\.[a-z0-9_]+$/iu.test(value)
  )
    return true;
  if (Array.isArray(value)) return value.some(containsPhysicalResourceIdentity);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /^(?:entityId|entity_id|physicalResourceId|physical_resource_id)$/iu.test(key) ||
      containsPhysicalResourceIdentity(item),
  );
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

function currentProviderBindingAuthorities(
  value: unknown,
): readonly Readonly<{ bindingId: string; localServerId: string }>[] | undefined {
  if (!isRecord(value) || value['currentProviderBindings'] === undefined) return undefined;
  const current = value['currentProviderBindings'];
  if (!Array.isArray(current)) return Object.freeze([]);
  const authorities: Readonly<{ bindingId: string; localServerId: string }>[] = [];
  for (const item of current) {
    const authorityBinding = isRecord(item) ? item['binding'] : undefined;
    if (
      !isRecord(authorityBinding) ||
      typeof authorityBinding['bindingId'] !== 'string' ||
      authorityBinding['bindingId'].trim() === '' ||
      typeof authorityBinding['localServerId'] !== 'string' ||
      authorityBinding['localServerId'].trim() === ''
    )
      return Object.freeze([]);
    authorities.push(
      Object.freeze({
        bindingId: authorityBinding['bindingId'],
        localServerId: authorityBinding['localServerId'],
      }),
    );
  }
  return Object.freeze(authorities);
}

function exactlyOneSkillReference(references: readonly string[]) {
  const parsed = references.map((reference) => {
    const match = /^skill:([^:]+):([1-9]\d*)$/u.exec(reference);
    if (match === null) return undefined;
    const skillId = match[1];
    const skillVersion = Number(match[2]);
    return skillId === undefined || !Number.isSafeInteger(skillVersion)
      ? undefined
      : Object.freeze({ skillId, skillVersion });
  });
  const reference = parsed[0];
  if (parsed.length !== 1 || reference === undefined)
    skillUsageAuthorityInvalid('The Task Capability must freeze exactly one Skill version.');
  return reference;
}

function exactlyOneConstraint(
  constraints: readonly Readonly<Record<string, unknown>>[],
  type: string,
) {
  const matches = constraints.filter((constraint) => constraint['type'] === type);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    skillUsageAuthorityInvalid(`The Task Capability requires one ${type} constraint.`);
  return match;
}

function exactlyOneSideEffectPolicy(
  constraints: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  const matches = constraints.filter(
    (constraint) =>
      constraint['type'] === 'side_effect_policy' ||
      constraint['type'] === 'physical_side_effect_policy',
  );
  const match = matches[0];
  if (matches.length !== 1 || match === undefined)
    skillUsageAuthorityInvalid(
      'The Task Capability requires exactly one side-effect policy constraint.',
    );
  return match;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(): never {
  throw new TaskCapabilityError(
    'TASK_CAPABILITY_REQUEST_INVALID',
    'io.sdar/requestedCapability requires an Exposure id, exact positive version, and request id.',
  );
}

function skillUsageAuthorityInvalid(message: string): never {
  throw new TaskCapabilityError('TASK_CAPABILITY_SKILL_USAGE_AUTHORITY_INVALID', message);
}

function terminal(message: string): never {
  throw new TaskCapabilityError('TASK_CAPABILITY_TERMINAL_GUARD_FAILED', message);
}

export class TaskCapabilityError extends Error {
  constructor(
    readonly code:
      | 'TASK_CAPABILITY_REQUEST_INVALID'
      | 'TASK_CAPABILITY_ADMISSION_REJECTED'
      | 'TASK_CAPABILITY_REQUESTER_FORBIDDEN'
      | 'TASK_CAPABILITY_INPUT_INVALID'
      | 'TASK_CAPABILITY_PROVIDER_BINDING_NOT_CURRENT'
      | 'TASK_CAPABILITY_PROVIDER_BINDING_CONTEXT_INVALID'
      | 'TASK_CAPABILITY_SKILL_USAGE_AUTHORITY_INVALID'
      | 'TASK_CAPABILITY_ATTEMPT_CONTEXT_INVALID'
      | 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'TaskCapabilityError';
  }
}
