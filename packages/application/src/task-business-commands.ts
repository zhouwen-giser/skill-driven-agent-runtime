import {
  FROZEN_TASK_BUSINESS_OPERATION_POLICY,
  type TaskBusinessOperationPolicy,
} from './task-business-operation-policy.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RemoteTaskBinding, RemoteTaskInputLink } from '../../domain/src/index.js';
import { hashCanonicalEvidenceJson } from '../../domain/src/evidence/canonical-evidence.js';
import {
  normalizeTaskBusinessView,
  assertTaskBusinessIdentity,
  TaskBusinessError,
  type TaskBusinessView,
} from '../../domain/src/task-business.js';
import {
  assertTaskBusinessCommandScope,
  taskBusinessIntentContentHash,
  taskBusinessIntentEffect,
  taskBusinessMutationPolicySchema,
  taskBusinessMutationRequestSchema,
  type TaskBusinessCommandRecord,
  type TaskBusinessCommandIntent,
  type TaskBusinessControlScope,
  type TaskBusinessMutationPolicy,
  type TaskBusinessMutationRequest,
} from '../../domain/src/task-business-command.js';
import {
  GovernedControlManagementService,
  type GovernedControlPrincipal,
  type GovernedControlManagementAuthorityReader,
} from './governed-control-management.js';
import type { GovernedControlConfirmationService } from './governed-control-authority.js';
import type { CurrentGovernedCapabilityAuthority } from './governed-control-authority.js';
import type { Clock, JsonSchemaValidator } from './ports.js';
import type { FrozenTaskBusinessBindingInput } from './mcp-registry.js';
import { canonicalHash } from './mcp-task-readiness.js';
import type {
  TaskBusinessReader,
  TaskBusinessRepository,
  TaskBusinessTarget,
  TaskBusinessSyncService,
} from './task-business-sync.js';

export interface TaskBusinessControlAuthority {
  load(
    taskId: string,
  ): Promise<Readonly<{ scope: TaskBusinessControlScope; policy: TaskBusinessMutationPolicy }>>;
  assertCurrent(target: TaskBusinessTarget, scope: TaskBusinessControlScope): Promise<void>;
}
export interface TaskBusinessCommandRepository {
  resolveTaskBinding(
    taskId: string,
    operationName: string,
  ): Promise<TaskBusinessTarget | undefined>;
  loadInput(
    inputRequestId: string,
  ): Promise<Readonly<{ link: RemoteTaskInputLink; target: TaskBusinessTarget }> | undefined>;
  find(taskId: string, intentId: string): Promise<TaskBusinessCommandRecord | undefined>;
  findByInput(inputRequestId: string): Promise<TaskBusinessCommandRecord | undefined>;
  list(taskId: string): Promise<readonly TaskBusinessCommandRecord[]>;
  pendingRecovery?(): Promise<readonly TaskBusinessCommandRecord[]>;
  prepare(intent: TaskBusinessCommandIntent): Promise<TaskBusinessCommandRecord>;
  attachConfirmation(
    taskId: string,
    intentId: string,
    confirmationId: string,
  ): Promise<TaskBusinessCommandRecord>;
  claim(
    record: TaskBusinessCommandRecord,
    scope: TaskBusinessControlScope,
  ): Promise<TaskBusinessCommandRecord | undefined>;
  recordDispatch(
    record: TaskBusinessCommandRecord,
    outcome: Readonly<{
      state: 'accepted' | 'uncertain';
      receipt?: Readonly<Record<string, unknown>>;
      errorCode?: string;
    }>,
  ): Promise<TaskBusinessCommandRecord>;
  rejectBeforeSend(
    record: TaskBusinessCommandRecord,
    errorCode: string,
  ): Promise<TaskBusinessCommandRecord>;
  claimReconciliation(
    taskId: string,
    intentId: string,
  ): Promise<TaskBusinessCommandRecord | undefined>;
  recordReconciliation(
    record: TaskBusinessCommandRecord,
    outcome: Readonly<{
      state: TaskBusinessCommandRecord['state'];
      evidence?: Readonly<Record<string, unknown>>;
      errorCode?: string;
    }>,
  ): Promise<TaskBusinessCommandRecord>;
  rollbackPreflight(): Promise<
    Readonly<{ writeTakeoverAllowed: boolean; pendingIntentIds: readonly string[] }>
  >;
}
export interface TaskBusinessMutationTransport {
  dispatchBusinessMutation(
    input: FrozenTaskBusinessBindingInput &
      Readonly<{
        request: TaskBusinessMutationRequest;
        /** Server-owned final boundary; never accepted from a model or HTTP body. */
        authorize: (
          identity: Readonly<{
            taskId: string;
            executionId: string;
            operation: TaskBusinessMutationRequest['operation'];
          }>,
        ) => Promise<boolean>;
      }>,
  ): Promise<Readonly<Record<string, unknown>>>;
}

export function assertTaskBusinessCurrentCapability(
  input: Readonly<{
    authority: CurrentGovernedCapabilityAuthority;
    scope: TaskBusinessControlScope;
    constraints: readonly Readonly<Record<string, unknown>>[];
    resourceId: string;
  }>,
): void {
  const { scope, authority } = input;
  const definition = authority.definition;
  const modes = z.array(z.string()).safeParse(definition['supported_modes']);
  const implementations = authority.implementationBindings.filter(
    (row) =>
      row['capability_id'] === scope.capabilityId &&
      row['capability_version'] === scope.capabilityVersion &&
      row['implementation_type'] === 'skill' &&
      row['implementation_id'] === scope.skillId &&
      row['implementation_version'] === String(scope.skillVersion) &&
      row['role'] === 'primary' &&
      row['status'] === 'active',
  );
  const override = z
    .record(z.string(), z.unknown())
    .safeParse(implementations[0]?.['provider_policy_override']);
  const resources = z
    .array(z.string())
    .safeParse(override.success ? override.data['allowedResourceIds'] : undefined);
  if (
    definition['capability_id'] !== scope.capabilityId ||
    definition['version'] !== scope.capabilityVersion ||
    definition['status'] !== 'published' ||
    !['medium', 'high', 'critical'].includes(String(definition['risk_level'])) ||
    !modes.success ||
    !modes.data.includes('plan_confirmed') ||
    !modes.data.includes('remote_task') ||
    hashCanonicalEvidenceJson(definition['constraints']) !==
      hashCanonicalEvidenceJson(input.constraints) ||
    implementations.length !== 1 ||
    !override.success ||
    override.data['selection'] !== 'required' ||
    override.data['mcpProviderBindingId'] !== scope.providerBindingId ||
    override.data['localServerId'] !== scope.serverId ||
    override.data['mcpToolName'] !== scope.toolName ||
    override.data['requireActive'] !== true ||
    override.data['requireAvailable'] !== true ||
    override.data['requireUnexpiredFreshness'] !== true ||
    override.data['denyFallback'] !== true ||
    !resources.success ||
    !resources.data.includes(input.resourceId)
  )
    throw new TaskBusinessError('TASK_BUSINESS_CURRENT_CAPABILITY_DENIED');
}

export function taskBusinessFrozenBindingHash(binding: RemoteTaskBinding): string {
  return `sha256:${canonicalHash({
    bindingId: binding.bindingId,
    taskId: binding.agentTaskId,
    remoteTaskId: binding.remoteTaskId,
    goalId: binding.goalId,
    goalVersion: binding.goalVersion,
    workflowPlanId: binding.workflowPlanId,
    workflowNodeRunId: binding.workflowNodeRunId,
    serverId: binding.serverId,
    operationName: binding.operationName,
    credentialRevision: binding.credentialRevision,
    authoritySnapshot: binding.authoritySnapshot,
    protocolContract: binding.protocolContract,
    executionContext: binding.executionContext,
  })}`;
}
export function taskBusinessInputLinkHash(
  link: Pick<
    RemoteTaskInputLink,
    'inputRequestId' | 'bindingId' | 'resultHash' | 'remoteRevision' | 'inputRequests'
  >,
): string {
  return hashCanonicalEvidenceJson({
    inputRequestId: link.inputRequestId,
    bindingId: link.bindingId,
    resultHash: link.resultHash,
    remoteRevision: link.remoteRevision,
    inputRequests: link.inputRequests,
  });
}

/** Thin governed command orchestration; native Task/Workflow and original input continuation remain owners. */
export class TaskBusinessCommandService {
  constructor(
    readonly dependencies: Readonly<{
      operationPolicy?: TaskBusinessOperationPolicy;
      repository: TaskBusinessCommandRepository;
      business: TaskBusinessRepository;
      sync: TaskBusinessSyncService;
      reader: TaskBusinessReader;
      transport: TaskBusinessMutationTransport;
      authority: TaskBusinessControlAuthority;
      confirmations: Pick<GovernedControlConfirmationService, 'issue' | 'revoke'>;
      revocations: Pick<GovernedControlManagementAuthorityReader, 'revocationAuthority'>;
      schemas: JsonSchemaValidator;
      clock: Clock;
    }>,
  ) {}

  list(taskId: string): Promise<readonly TaskBusinessCommandRecord[]> {
    return this.dependencies.repository.list(taskId);
  }
  rollbackPreflight(): ReturnType<TaskBusinessCommandRepository['rollbackPreflight']> {
    return this.dependencies.repository.rollbackPreflight();
  }

  async prepareNavigation(
    input: Readonly<{
      taskId: string;
      idempotencyKey: string;
      waypoints: readonly Readonly<{ longitude: number; latitude: number }>[];
      density: string;
    }>,
  ): Promise<TaskBusinessCommandRecord> {
    const key = z.string().min(1).max(256).parse(input.idempotencyKey);
    const intentId = commandId('navigation', input.taskId, key);
    const userRequestHash = hashCanonicalEvidenceJson({
      waypoints: input.waypoints,
      density: input.density,
    });
    const existing = await this.dependencies.repository.find(input.taskId, intentId);
    if (existing !== undefined) return sameUserRequest(existing, userRequestHash);
    const target = await this.dependencies.repository.resolveTaskBinding(
      input.taskId,
      (this.dependencies.operationPolicy ?? FROZEN_TASK_BUSINESS_OPERATION_POLICY)
        .navigationAdjustmentOperationName,
    );
    if (target === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_ORIGINAL_NAVIGATION_REQUIRED');
    const view = await this.#view(target);
    const ref = view.context.activeRefs['navigationAdjustment'];
    const intervention = view.objects.find(
      (object) =>
        ref !== undefined &&
        object.kind === 'intervention' &&
        object.value['interventionId'] === ref.id &&
        object.value.revision === ref.revision,
    );
    if (
      ref === undefined ||
      intervention?.value['state'] !== 'available' ||
      intervention.value['interventionType'] !== 'navigation.adjust_plan'
    )
      throw new TaskBusinessError('TASK_BUSINESS_INTERVENTION_NOT_CURRENT');
    const request = taskBusinessMutationRequestSchema.parse({
      operation: 'navigation_adjust_plan',
      interventionId: ref.id,
      expectedInterventionRevision: ref.revision,
      expectedEffectivePlanRevision: view.context.effectivePlanRevision,
      commandId: intentId,
      waypoints: input.waypoints,
      density: input.density,
    });
    this.#schema(intervention.value['inputSchema'], {
      waypoints: input.waypoints,
      density: input.density,
    });
    return this.#prepare(
      target,
      view,
      intentId,
      userRequestHash,
      request,
      deadline(intervention.value['validUntil'], this.dependencies.clock.now()),
    );
  }

  async authorizeInput(
    inputRequestId: string,
    inputResponses: unknown,
    principal?: GovernedControlPrincipal,
  ): Promise<boolean> {
    const original = await this.dependencies.repository.loadInput(inputRequestId);
    if (original === undefined) return false;
    let view: TaskBusinessView;
    try {
      view = await this.#view(original.target);
    } catch (error: unknown) {
      if (code(error) === 'SMPP_BUSINESS_EXTENSION_UNAVAILABLE') return false;
      throw error;
    }
    const { link, target } = original;
    if (link.status !== 'waiting') throw new TaskBusinessError('TASK_BUSINESS_INPUT_LINK_STALE');
    const responses = z.record(z.string(), z.unknown()).parse(inputResponses);
    const [entry] = Object.entries(responses);
    if (Object.keys(responses).length !== 1 || entry === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_INPUT_SCOPE_INVALID');
    const [requestKey, response] = entry;
    const ref = view.context.activeRefs['input:visualLock'];
    const object = view.objects.find(
      (candidate) =>
        ref !== undefined &&
        candidate.kind === 'input_request' &&
        candidate.value['requestId'] === ref.id &&
        candidate.value.revision === ref.revision &&
        candidate.value['requestKey'] === requestKey,
    );
    if (ref === undefined || object?.value['state'] !== 'pending')
      throw new TaskBusinessError('TASK_BUSINESS_INPUT_NOT_CURRENT');
    const nativeRequest = z
      .object({ params: z.object({ requestedSchema: z.unknown() }).loose() })
      .loose()
      .parse(link.inputRequests[requestKey]);
    if (
      hashCanonicalEvidenceJson(nativeRequest.params.requestedSchema) !==
      hashCanonicalEvidenceJson(object.value['inputSchema'])
    )
      throw new TaskBusinessError('TASK_BUSINESS_INPUT_SCHEMA_CONFLICT');
    const request = taskBusinessMutationRequestSchema.parse({
      operation: 'input_response',
      inputRequestId,
      inputLinkHash: taskBusinessInputLinkHash(link),
      requestId: ref.id,
      requestKey,
      expectedRequestRevision: ref.revision,
      expectedSubjectBinding: object.value['subjectBinding'],
      response,
    });
    if (request.operation !== 'input_response')
      throw new TaskBusinessError('TASK_BUSINESS_INPUT_SCOPE_INVALID');
    if (request.response.action === 'accept')
      this.#schema(object.value['inputSchema'], request.response.content);
    const intentId = commandId('input', target.binding.agentTaskId, inputRequestId);
    const record = await this.#prepare(
      target,
      view,
      intentId,
      hashCanonicalEvidenceJson(responses),
      request,
      deadline(object.value['deadlineAt'], this.dependencies.clock.now()),
    );
    if (principal === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_TRUSTED_CONFIRMATION_REQUIRED');
    await this.confirm(
      record.intent.taskId,
      intentId,
      principal,
      'Confirm exact non-firing original Task input response.',
    );
    return true;
  }

  async #prepare(
    target: TaskBusinessTarget,
    view: TaskBusinessView,
    intentId: string,
    userRequestHash: string,
    request: TaskBusinessMutationRequest,
    validUntil: string,
  ): Promise<TaskBusinessCommandRecord> {
    const { scope, policy } = await this.dependencies.authority.load(target.binding.agentTaskId);
    const parsed = taskBusinessMutationPolicySchema.parse(policy);
    if (
      !parsed.allowedOperations.includes(request.operation) ||
      !(
        this.dependencies.operationPolicy ?? FROZEN_TASK_BUSINESS_OPERATION_POLICY
      ).supportsMutation(scope.toolName)
    )
      throw new TaskBusinessError('TASK_BUSINESS_MUTATION_POLICY_DENIED');
    await this.dependencies.authority.assertCurrent(target, scope);
    const createdAt = this.dependencies.clock.now();
    const base = {
      schemaVersion: 'sdar.task-business-command/v1' as const,
      intentId,
      taskId: target.binding.agentTaskId,
      bindingId: target.binding.bindingId,
      goalId: target.binding.goalId,
      goalVersion: target.binding.goalVersion,
      identity: view.context.identity,
      frozenBindingHash: taskBusinessFrozenBindingHash(target.binding),
      authority: scope,
      request,
      userRequestHash,
      createdAt,
      validUntil,
      reconcileUntil: new Date(Date.parse(createdAt) + 600_000).toISOString(),
    };
    return this.dependencies.repository.prepare({
      ...base,
      contentHash: taskBusinessIntentContentHash(base),
    });
  }

  async confirm(
    taskId: string,
    intentId: string,
    principal: GovernedControlPrincipal,
    reason: string,
  ): Promise<TaskBusinessCommandRecord> {
    const record = await this.#required(taskId, intentId);
    if (record.state !== 'prepared') return record;
    if (record.confirmationId !== undefined) return record;
    const manager = new GovernedControlManagementService({
      clock: this.dependencies.clock,
      confirmations: this.dependencies.confirmations,
      authority: {
        ...this.dependencies.revocations,
        revocationAuthority: this.dependencies.revocations.revocationAuthority.bind(
          this.dependencies.revocations,
        ),
        issueAuthority: async (requestedTaskId) => {
          if (requestedTaskId !== taskId)
            throw new TaskBusinessError('TASK_BUSINESS_CONTROL_SCOPE_INVALID');
          const current = await this.dependencies.authority.load(taskId);
          assertTaskBusinessCommandScope(current.scope, record.intent.authority);
          if (!current.policy.allowedOperations.includes(record.intent.request.operation))
            throw new TaskBusinessError('TASK_BUSINESS_MUTATION_POLICY_DENIED');
          return {
            ...current.scope,
            arguments: taskBusinessIntentEffect(record.intent),
            argumentsHash: record.intent.contentHash.slice(7),
          };
        },
      },
    });
    const { confirmation } = await manager.issue({ taskId, reason, principal });
    return this.dependencies.repository.attachConfirmation(
      taskId,
      intentId,
      confirmation.confirmationId,
    );
  }

  async dispatchInput(
    inputRequestId: string,
    inputResponses: unknown,
  ): Promise<
    Readonly<{
      handled: boolean;
      acknowledged?: boolean;
      protocolRevision?: string;
      errorCode?: string;
    }>
  > {
    const record = await this.dependencies.repository.findByInput(inputRequestId);
    if (record === undefined) {
      const original = await this.dependencies.repository.loadInput(inputRequestId);
      if (original === undefined) return { handled: false };
      try {
        await this.#view(original.target);
      } catch (error: unknown) {
        if (code(error) === 'SMPP_BUSINESS_EXTENSION_UNAVAILABLE') return { handled: false };
        throw error;
      }
      throw new TaskBusinessError('TASK_BUSINESS_CONFIRMED_INPUT_INTENT_REQUIRED');
    }
    sameUserRequest(record, hashCanonicalEvidenceJson(inputResponses));
    const result = await this.dispatch(record.intent.taskId, record.intent.intentId);
    return {
      handled: true,
      acknowledged: ['accepted', 'confirmed'].includes(result.state),
      ...(typeof result.receipt?.['protocolRevision'] === 'string'
        ? { protocolRevision: result.receipt['protocolRevision'] }
        : {}),
      ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    };
  }

  async dispatch(taskId: string, intentId: string): Promise<TaskBusinessCommandRecord> {
    const record = await this.#required(taskId, intentId);
    if (record.state !== 'prepared') return record; // Recovery never resends an in-flight/uncertain command.
    if (record.confirmationId === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_TRUSTED_CONFIRMATION_REQUIRED');
    const target = await this.dependencies.business.loadTarget(record.intent.bindingId);
    if (target === undefined)
      throw new TaskBusinessError('TASK_BUSINESS_ORIGINAL_BINDING_REQUIRED');
    let claimed: TaskBusinessCommandRecord | undefined;
    try {
      const receipt = await this.dependencies.transport.dispatchBusinessMutation({
        ...bindingRead(target),
        expectedExecutionId: record.intent.identity.executionId,
        request: record.intent.request,
        authorize: async (actual) => {
          if (
            actual.taskId !== record.intent.identity.taskId ||
            actual.executionId !== record.intent.identity.executionId ||
            actual.operation !== record.intent.request.operation
          )
            throw new TaskBusinessError('TASK_BUSINESS_MUTATION_IDENTITY_CONFLICT');
          const current = await this.dependencies.authority.load(taskId);
          assertTaskBusinessCommandScope(current.scope, record.intent.authority);
          if (!current.policy.allowedOperations.includes(record.intent.request.operation))
            throw new TaskBusinessError('TASK_BUSINESS_MUTATION_POLICY_DENIED');
          await this.dependencies.authority.assertCurrent(target, current.scope);
          claimed = await this.dependencies.repository.claim(record, current.scope);
          return claimed !== undefined;
        },
      });
      if (claimed === undefined)
        throw new TaskBusinessError('TASK_BUSINESS_DISPATCH_BOUNDARY_MISSING');
      return await this.dependencies.repository.recordDispatch(claimed, {
        state: 'accepted',
        receipt,
      });
    } catch (error: unknown) {
      if (claimed !== undefined)
        return await this.dependencies.repository.recordDispatch(claimed, {
          state: 'uncertain',
          errorCode: code(error),
        });
      return await this.dependencies.repository.rejectBeforeSend(record, code(error));
    }
  }

  async reconcile(taskId: string, intentId: string): Promise<TaskBusinessCommandRecord> {
    const claimed = await this.dependencies.repository.claimReconciliation(taskId, intentId);
    if (claimed === undefined) return this.#required(taskId, intentId);
    try {
      const target = await this.dependencies.business.loadTarget(claimed.intent.bindingId);
      if (target === undefined)
        throw new TaskBusinessError('TASK_BUSINESS_ORIGINAL_BINDING_REQUIRED');
      const view = await this.#view(target);
      const outcome = observeTaskBusinessCommand(claimed, view);
      return await this.dependencies.repository.recordReconciliation(claimed, outcome);
    } catch (error: unknown) {
      return await this.dependencies.repository.recordReconciliation(claimed, {
        state: 'uncertain',
        errorCode: code(error),
      });
    }
  }
  /** Restore reads only. A persisted prepared command always requires a new explicit dispatch action. */
  async recover(): Promise<Readonly<{ examined: number; failures: readonly string[] }>> {
    const records = (await this.dependencies.repository.pendingRecovery?.()) ?? [];
    const failures: string[] = [];
    await Promise.all(
      records.map(async (record) => {
        try {
          if (record.state === 'prepared') {
            const target = await this.dependencies.business.loadTarget(record.intent.bindingId);
            if (
              Date.parse(record.intent.validUntil) <= Date.parse(this.dependencies.clock.now()) ||
              target === undefined ||
              target.binding.terminalAt !== undefined ||
              target.binding.invalidatedAt !== undefined
            )
              await this.dependencies.repository.rejectBeforeSend(
                record,
                'TASK_BUSINESS_RECOVERY_PREPARED_OBSOLETE',
              );
          } else await this.reconcile(record.intent.taskId, record.intent.intentId);
        } catch (error: unknown) {
          failures.push(`${record.intent.intentId}:${code(error)}`);
        }
      }),
    );
    return { examined: records.length, failures };
  }
  async #view(target: TaskBusinessTarget): Promise<TaskBusinessView> {
    if ((await this.dependencies.sync.refresh(target.binding.bindingId)) === 'unsupported')
      throw new TaskBusinessError('SMPP_BUSINESS_EXTENSION_UNAVAILABLE');
    const projection = await this.dependencies.business.find(target.binding.bindingId);
    if (projection?.quality.requiredObjectsResolved !== true)
      throw new TaskBusinessError('TASK_BUSINESS_REQUIRED_OBJECTS_INCOMPLETE');
    const raw = await this.dependencies.reader.readRemoteTaskBusinessContext(bindingRead(target));
    const view = normalizeTaskBusinessView(raw, {
      taskId: target.binding.remoteTaskId,
      providerId: target.providerId,
      resourceId: target.resourceId,
      operationName: target.binding.operationName,
      ...(target.executionId === undefined ? {} : { executionId: target.executionId }),
    });
    if (hashCanonicalEvidenceJson(view.context) !== projection.contextDigest)
      throw new TaskBusinessError('TASK_BUSINESS_READ_SNAPSHOT_CHANGED');
    return view;
  }
  async #required(taskId: string, intentId: string): Promise<TaskBusinessCommandRecord> {
    const record = await this.dependencies.repository.find(taskId, intentId);
    if (record === undefined) throw new TaskBusinessError('TASK_BUSINESS_COMMAND_NOT_FOUND');
    return record;
  }
  #schema(schema: unknown, value: unknown): void {
    const checked = this.dependencies.schemas.checkSchema(schema);
    if (!checked.valid || !this.dependencies.schemas.validate(schema, value).valid)
      throw new TaskBusinessError('TASK_BUSINESS_MUTATION_SCHEMA_INVALID');
  }
}

export function bindingRead(target: TaskBusinessTarget): FrozenTaskBusinessBindingInput {
  const binding = target.binding;
  return {
    serverId: binding.serverId,
    remoteTaskId: binding.remoteTaskId,
    operationName: binding.operationName,
    resourceId: target.resourceId,
    credentialRevision: binding.credentialRevision,
    protocolContract: binding.protocolContract,
    executionContext: binding.executionContext,
    ...(binding.authoritySnapshot === undefined
      ? {}
      : { authoritySnapshot: binding.authoritySnapshot }),
    signal: AbortSignal.timeout(30_000),
    ...(target.executionId === undefined ? {} : { expectedExecutionId: target.executionId }),
  };
}
function commandId(kind: string, taskId: string, key: string) {
  return `business-${kind}-${createHash('sha256')
    .update(JSON.stringify([taskId, key]))
    .digest('hex')}`;
}
function sameUserRequest(
  record: TaskBusinessCommandRecord,
  hash: string,
): TaskBusinessCommandRecord {
  if (record.intent.userRequestHash !== hash)
    throw new TaskBusinessError('TASK_BUSINESS_COMMAND_CONTENT_CONFLICT');
  return record;
}
function deadline(value: unknown, now: string): string {
  // Public deadlines are optional. This bounds our own review lifetime, not Provider expiry.
  if (value === undefined) return new Date(Date.parse(now) + 600_000).toISOString();
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  if (!parsed.success || Date.parse(parsed.data) <= Date.parse(now))
    throw new TaskBusinessError('TASK_BUSINESS_REQUEST_EXPIRED');
  return parsed.data;
}
function code(error: unknown): string {
  return error instanceof Error && 'code' in error
    ? String(error.code)
    : 'TASK_BUSINESS_TRANSPORT_FAILED';
}

export function observeTaskBusinessCommand(
  record: TaskBusinessCommandRecord,
  view: TaskBusinessView,
): Readonly<{
  state: TaskBusinessCommandRecord['state'];
  evidence: Readonly<Record<string, unknown>>;
}> {
  assertTaskBusinessIdentity(view.context.identity, record.intent.identity);
  const request = record.intent.request;
  const evidence = {
    contextRevision: view.context.contextRevision,
    contextDigest: hashCanonicalEvidenceJson(view.context),
    identity: view.context.identity,
    snapshotWatermark: view.resumeFrom,
  };
  if (request.operation === 'navigation_adjust_plan') {
    const effective = z
      .object({
        commandId: z.string(),
        planRevision: z.number().int(),
        routeRef: z.object({
          kind: z.literal('artifact'),
          id: z.string(),
          revision: z.number().int(),
        }),
      })
      .loose()
      .safeParse(view.context.summary.properties?.['effectiveNavigation']);
    const applied = view.objects.find(
      (object) =>
        object.kind === 'intervention' &&
        object.value['interventionId'] === request.interventionId &&
        object.value['acceptedCommandId'] === request.commandId &&
        object.value['state'] === 'applied',
    );
    const routeRefs = applied?.value['resultRefs'];
    const ownApplication =
      effective.success &&
      effective.data.commandId === request.commandId &&
      effective.data.planRevision > request.expectedEffectivePlanRevision &&
      view.context.effectivePlanRevision === effective.data.planRevision &&
      Array.isArray(routeRefs) &&
      routeRefs.some(
        (ref: unknown) =>
          hashCanonicalEvidenceJson(ref) === hashCanonicalEvidenceJson(effective.data.routeRef),
      ) &&
      view.objects.some(
        (object) =>
          object.kind === 'artifact' &&
          object.value['artifactId'] === effective.data.routeRef.id &&
          object.value.revision === effective.data.routeRef.revision &&
          object.value['artifactType'] === 'navigation.route',
      );
    return {
      state: ownApplication
        ? 'confirmed'
        : record.state === 'dispatching'
          ? 'uncertain'
          : record.state,
      evidence: {
        ...evidence,
        ownCommandApplied: ownApplication,
        ...(ownApplication ? { adoptedRouteRef: effective.data.routeRef } : {}),
        ...(effective.success ? { effectiveNavigation: effective.data } : {}),
      },
    };
  }
  const object = view.objects.find(
    (candidate) =>
      candidate.kind === 'input_request' &&
      candidate.value['requestId'] === request.requestId &&
      candidate.value.revision > request.expectedRequestRevision &&
      hashCanonicalEvidenceJson(candidate.value['subjectBinding']) ===
        hashCanonicalEvidenceJson(request.expectedSubjectBinding),
  );
  const response = z
    .object({ action: z.enum(['accept', 'decline', 'cancel']), value: z.unknown().optional() })
    .loose()
    .safeParse(object?.value['response']);
  const matches =
    response.success &&
    response.data.action === request.response.action &&
    (request.response.action !== 'accept' ||
      hashCanonicalEvidenceJson(response.data.value) ===
        hashCanonicalEvidenceJson(request.response.content));
  const fulfilled =
    matches &&
    ['answered', 'cancelled'].includes(String(object?.value['state'])) &&
    typeof object?.value['responseCommandId'] === 'string';
  return {
    state:
      fulfilled && record.state === 'accepted'
        ? 'confirmed'
        : record.state === 'dispatching'
          ? 'uncertain'
          : record.state,
    evidence: {
      ...evidence,
      originalRequestFulfilled: fulfilled,
      providerResponseCommandId: object?.value['responseCommandId'],
      causalQuality: 'request_response_match',
      gaps: ['required_input_has_no_client_command_id_wire_correlation'],
    },
  };
}
