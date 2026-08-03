import {
  ANONYMOUS_USER_ID,
  createTaskCapabilityBinding,
  createTaskCapabilityExecutionAttempt,
  type AgentTask,
  type TaskCapabilityBinding,
  type TaskCapabilityExecutionAttempt,
  type TaskExecutionAttempt,
} from '../../domain/src/index.js';

import type { JsonSchemaValidator, RuntimeTaskEvent } from './ports.js';

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
}

export class RuntimeTaskCapabilityService {
  readonly #store: TaskCapabilityAcceptanceStore;
  readonly #schemas: JsonSchemaValidator;

  constructor(
    dependencies: Readonly<{ store: TaskCapabilityAcceptanceStore; schemas: JsonSchemaValidator }>,
  ) {
    this.#store = dependencies.store;
    this.#schemas = dependencies.schemas;
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
      ...(resolution.providerPolicySnapshot === undefined
        ? {}
        : { providerPolicySnapshot: resolution.providerPolicySnapshot }),
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

  accept(input: Parameters<TaskCapabilityAcceptanceStore['accept']>[0]) {
    return this.#store.accept(input);
  }

  findBinding(taskId: string) {
    return this.#store.findBinding(taskId);
  }

  listAttempts(taskId: string) {
    return this.#store.listAttempts(taskId);
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

  async assertTerminalSuccess(taskId: string, result: unknown): Promise<void> {
    const binding = await this.#store.findBinding(taskId);
    if (binding === undefined) return;
    if (!isRecord(result)) terminal('Capability completion requires a structured result.');
    for (const criterion of binding.successCriteriaSnapshot) {
      if (!criterionSatisfied(criterion, result))
        terminal('A frozen success criterion is not satisfied.');
    }
    for (const requirement of binding.evidenceRequirementSnapshot) {
      if (!evidenceSatisfied(requirement, result))
        terminal('Required Capability evidence is incomplete.');
    }
    for (const constraint of binding.constraintSnapshot) {
      if (!constraintSatisfied(constraint, result))
        terminal('A frozen safety or authorization constraint is not satisfied.');
    }
  }

  async markLatestAttempt(
    taskId: string,
    status: 'succeeded' | 'failed' | 'canceled',
    timestamp: string,
  ) {
    if ((await this.#store.findBinding(taskId)) === undefined) return;
    await this.#store.updateLatestAttempt(taskId, status, timestamp);
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
) {
  if (criterion['type'] === 'field_equals' && typeof criterion['field'] === 'string')
    return Object.is(result[criterion['field']], criterion['value']);
  if (criterion['type'] === 'coverage' && typeof criterion['minimum'] === 'number')
    return typeof result['coverage'] === 'number' && result['coverage'] >= criterion['minimum'];
  return false;
}

function evidenceSatisfied(
  requirement: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
) {
  if (requirement['type'] === 'provider_result' && typeof requirement['field'] === 'string')
    return result[requirement['field']] !== undefined;
  if (requirement['type'] === 'route_trace') return result['routeTrace'] !== undefined;
  return false;
}

function constraintSatisfied(
  constraint: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
) {
  if (constraint['type'] !== 'authorization' && constraint['type'] !== 'safety') return false;
  const evidence = result['policyEvidence'];
  return (
    Array.isArray(evidence) &&
    evidence.some(
      (item) => isRecord(item) && item['type'] === constraint['type'] && item['satisfied'] === true,
    )
  );
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
      | 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'TaskCapabilityError';
  }
}
