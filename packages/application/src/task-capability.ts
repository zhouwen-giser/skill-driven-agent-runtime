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
  readonly #providerBindings: CurrentMcpProviderBindingAuthorityPort | undefined;
  readonly #runtimeProviderBindings: RuntimeMcpProviderBindingAdmissionVerifier | undefined;

  constructor(
    dependencies: Readonly<{
      store: TaskCapabilityAcceptanceStore;
      schemas: JsonSchemaValidator;
      evidence?: TaskCapabilityEvidenceSource;
      providerBindings?: CurrentMcpProviderBindingAuthorityPort;
      runtimeProviderBindings?: RuntimeMcpProviderBindingAdmissionVerifier;
    }>,
  ) {
    this.#store = dependencies.store;
    this.#schemas = dependencies.schemas;
    this.#evidence = dependencies.evidence;
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
    const sideEffectPolicy = exactlyOneConstraint(binding.constraintSnapshot, 'side_effect_policy');
    const input = isRecord(binding.inputSnapshot) ? binding.inputSnapshot : undefined;
    const resourceId = input?.['resourceId'];
    const allowedResourceIds = resourcePolicy['allowedResourceIds'];
    const localServerId = providerPolicy['localServerId'];
    const providerBindingId = providerPolicy['mcpProviderBindingId'];
    if (
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
    for (const criterion of binding.successCriteriaSnapshot) {
      if (!criterionSatisfied(criterion, result, binding, invocations, context))
        terminal('A frozen success criterion is not satisfied.');
    }
    for (const requirement of binding.evidenceRequirementSnapshot) {
      if (!evidenceSatisfied(requirement, result, binding, invocations))
        terminal('Required Capability evidence is incomplete.');
    }
    for (const constraint of binding.constraintSnapshot) {
      if (!constraintSatisfied(constraint, result, binding, invocations))
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

function criterionSatisfied(
  criterion: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
  context: Readonly<{ outputSchemaValid?: boolean }>,
) {
  if (criterion['type'] === 'field_equals' && typeof criterion['field'] === 'string')
    return Object.is(result[criterion['field']], criterion['value']);
  if (criterion['type'] === 'coverage' && typeof criterion['minimum'] === 'number')
    return typeof result['coverage'] === 'number' && result['coverage'] >= criterion['minimum'];
  if (criterion['type'] === 'output_schema_valid' && criterion['required'] === true)
    return context.outputSchemaValid === true;
  if (criterion['type'] === 'resource_identity_matches_request' && criterion['required'] === true)
    return resourceIdentityMatches(binding, result);
  if (criterion['type'] === 'required_evidence_complete' && criterion['required'] === true)
    return binding.evidenceRequirementSnapshot.every((requirement) =>
      evidenceSatisfied(requirement, result, binding, invocations),
    );
  // State confirmation and restoration are write-side semantics. They remain
  // fail-closed until an authoritative write lifecycle supplies those proofs.
  return false;
}

function evidenceSatisfied(
  requirement: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  binding: TaskCapabilityBinding,
  invocations: readonly McpInvocation[],
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
    return (
      typeof skillId === 'string' &&
      Number.isSafeInteger(skillVersion) &&
      binding.initialImplementationRefs.includes(`skill:${skillId}:${String(skillVersion)}`) &&
      typeof taskType === 'string' &&
      invocations.some(
        (invocation) => invocation.status === 'succeeded' && invocation.toolName === taskType,
      )
    );
  }
  if (constraint['type'] === 'confirmation_policy')
    return constraint['required'] === false && constraint['stage'] === 'not_applicable';
  return false;
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
