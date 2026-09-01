import {
  canonicalHash,
  createMcpProviderDispatchHash,
  ugvGovernedControlConfirmationId,
  type GovernedControlConfirmation,
  type RemoteTaskLifecycleEvidence,
} from '../../../packages/application/src/index.js';
import {
  createSelectedTaskOperation,
  createProviderEvidenceItem,
  hashCanonicalEvidenceJson,
  type InternalToolResult,
  type McpInvocation,
  type SelectedTaskOperation,
  type WorkflowContinuationAttempt,
} from '../../../packages/domain/src/index.js';

import {
  assessUgvMoveOutcome,
  type UgvMoveOutcomeAssessment,
  type UgvMovePositionPolicy,
} from './ugv-move-position-result.js';
import { UGV_MOVE_WORKFLOW_NODE_IDS } from './ugv-move-workflow.js';

const STATE_OPERATION = 'vehicle_get_state';
const NAVIGATE_OPERATION = 'vehicle_navigate';
const FINAL_POSITION_REQUIREMENT = 'final-position';

export interface UgvMoveWorkflowEvidenceInput {
  readonly taskId: string;
  readonly selectedTaskOperation: SelectedTaskOperation;
  /** Exact consumed PostgreSQL confirmation row for the single governed dispatch. */
  readonly confirmation: GovernedControlConfirmation;
  readonly invocations: readonly McpInvocation[];
  readonly remoteTaskLifecycle: readonly RemoteTaskLifecycleEvidence[];
  /** Exact running PostgreSQL attempt whose continuation invocation is executing the final read. */
  readonly continuationAttempt: WorkflowContinuationAttempt;
  readonly finalToolResult: InternalToolResult;
  readonly assessedAt: string;
  readonly policy: UgvMovePositionPolicy;
}

export interface UgvMoveWorkflowEvidenceProjection {
  readonly assessment: UgvMoveOutcomeAssessment;
  readonly result: InternalToolResult;
}

export interface UgvMoveTerminalWorkflowEvidenceInput {
  readonly taskId: string;
  readonly selectedTaskOperation: SelectedTaskOperation;
  /** Exact consumed PostgreSQL confirmation row for the single governed dispatch. */
  readonly confirmation: GovernedControlConfirmation;
  readonly invocations: readonly McpInvocation[];
  readonly remoteTaskLifecycle: readonly RemoteTaskLifecycleEvidence[];
  /** Exact succeeded attempt while its terminal control remains claimed by this callback. */
  readonly continuationAttempt: WorkflowContinuationAttempt;
  /** Persisted succeeded Workflow result, not a freshly generated result. */
  readonly workflowResult: unknown;
  readonly policy: UgvMovePositionPolicy;
}

export interface UgvMoveSkillResult {
  readonly resourceId: string;
  readonly status: 'completed';
  readonly finalPosition: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly frame: 'EPSG:4326';
  }>;
}

export interface UgvMoveTerminalWorkflowEvidenceVerification {
  readonly assessment: Extract<UgvMoveOutcomeAssessment, Readonly<{ status: 'completed' }>>;
  readonly skillResult: UgvMoveSkillResult;
}

export type UgvMoveWorkflowEvidenceErrorCode =
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_TASK_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_SELECTED_OPERATION_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_CONFIRMATION_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATIONS_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_REMOTE_TASK_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID';

/**
 * Projects the final Skill result only from durable MCP invocation and remote-Task facts.
 * Provider completion alone never creates position evidence.
 */
export function projectUgvMoveWorkflowEvidence(
  input: UgvMoveWorkflowEvidenceInput,
): UgvMoveWorkflowEvidenceProjection {
  const prepared = prepareWorkflowEvidence(input);
  assertContinuationAuthority(
    prepared.lifecycle,
    input.continuationAttempt,
    prepared.navigate,
    prepared.final,
    'final_read',
  );
  if (
    input.finalToolResult.isError ||
    !sameJson(prepared.persistedFinalResult, input.finalToolResult)
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID',
      'The final state result is missing, rejected, or differs from PostgreSQL invocation evidence.',
    );
  const assessment = assessPreparedWorkflowEvidence(prepared, input.assessedAt, input.policy);
  return Object.freeze({
    assessment,
    result: projectResult(input.finalToolResult, assessment, prepared.navigate.invocationId),
  });
}

/**
 * Re-verifies the persisted succeeded Workflow at the continuation callback boundary. The
 * succeeded continuation attempt is required, while its control must still be claimed; the
 * callback has not yet been acknowledged or made replayable at this point.
 */
export function verifyUgvMoveTerminalWorkflowEvidence(
  input: UgvMoveTerminalWorkflowEvidenceInput,
): UgvMoveTerminalWorkflowEvidenceVerification {
  const prepared = prepareWorkflowEvidence(input);
  assertContinuationAuthority(
    prepared.lifecycle,
    input.continuationAttempt,
    prepared.navigate,
    prepared.final,
    'terminal_callback',
  );
  const assessment = assessPreparedWorkflowEvidence(
    prepared,
    prepared.final.completedAt,
    input.policy,
  );
  if (assessment.status !== 'completed')
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID',
      'A succeeded UGV Workflow requires the deterministic final-position hard gate.',
    );
  const skillResult = completedSkillResult(assessment);
  if (!sameJson(input.workflowResult, skillResult))
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID',
      'The persisted Workflow result differs from the result derived from durable UGV evidence.',
    );
  return Object.freeze({ assessment, skillResult });
}

interface PreparedWorkflowEvidence {
  readonly selected: SelectedTaskOperation;
  readonly ordered: readonly McpInvocation[];
  readonly initial: McpInvocation;
  readonly navigate: McpInvocation;
  readonly final: McpInvocation;
  readonly lifecycle: RemoteTaskLifecycleEvidence;
  readonly initialResult: InternalToolResult;
  readonly persistedFinalResult: InternalToolResult;
  readonly terminalStructured: unknown;
  readonly providerObservedAt: string;
  readonly runtimeRevision: string;
}

function prepareWorkflowEvidence(
  input: Omit<UgvMoveWorkflowEvidenceInput, 'finalToolResult' | 'assessedAt' | 'policy'>,
): PreparedWorkflowEvidence {
  const taskId = input.taskId.trim();
  if (taskId === '')
    invalid('UGV_MOVE_WORKFLOW_EVIDENCE_TASK_INVALID', 'UGV evidence requires a Task identity.');
  const selected = revalidateSelectedTaskOperation(input.selectedTaskOperation);
  const ordered = [...input.invocations].sort(compareInvocations);
  const initial = ordered[0];
  const navigate = ordered[1];
  const final = ordered[2];
  if (
    ordered.length !== 3 ||
    initial?.toolName !== STATE_OPERATION ||
    navigate?.toolName !== NAVIGATE_OPERATION ||
    final?.toolName !== STATE_OPERATION ||
    ordered.some((invocation) => invocation.taskId !== taskId || invocation.status !== 'succeeded')
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATIONS_INVALID',
      'UGV movement requires exactly two successful state reads around one navigation dispatch.',
    );
  const lifecycle = exactRemoteLifecycle(input.remoteTaskLifecycle, taskId, navigate, selected);
  assertInvocationLineage(ordered, initial, navigate, final, lifecycle, selected);
  assertGovernedConfirmation(
    input.confirmation,
    taskId,
    initial,
    navigate,
    final,
    lifecycle,
    selected,
  );

  const initialResult = internalResult(initial.result);
  const persistedFinalResult = internalResult(final.result);
  if (
    initialResult === undefined ||
    persistedFinalResult === undefined ||
    initialResult.isError ||
    persistedFinalResult.isError
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_RESULT_INVALID',
      'The initial or final state result is missing or rejected in PostgreSQL evidence.',
    );

  const terminalResult = lifecycle.binding.resultSnapshot;
  const runtimeRevision = lifecycle.binding.runtimeRevision;
  if (
    lifecycle.binding.protocolStatus !== 'completed' ||
    terminalResult === undefined ||
    terminalResult.isError ||
    runtimeRevision === undefined ||
    runtimeRevision.trim() === ''
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_REMOTE_TASK_INVALID',
      'The exact remote navigation Task has no durable completed terminal result.',
    );
  const terminalStructured = structuredContent(terminalResult);
  const providerObservedAt = stringField(terminalStructured, 'observedAt');
  if (terminalStructured === undefined || providerObservedAt === undefined)
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_REMOTE_TASK_INVALID',
      'The remote navigation result has no Provider terminal observation.',
    );
  return Object.freeze({
    selected,
    ordered,
    initial,
    navigate,
    final,
    lifecycle,
    initialResult,
    persistedFinalResult,
    terminalStructured,
    providerObservedAt,
    runtimeRevision,
  });
}

function assessPreparedWorkflowEvidence(
  prepared: PreparedWorkflowEvidence,
  assessedAt: string,
  policy: UgvMovePositionPolicy,
): UgvMoveOutcomeAssessment {
  const { selected, ordered, initial, navigate, final, lifecycle } = prepared;
  return assessUgvMoveOutcome({
    resourceId: selected.resource.resourceId,
    expectedProviderId: selected.provider.providerId,
    correlationId: navigate.invocationId,
    dispatchedAt: navigate.startedAt,
    assessedAt,
    target: target(selected),
    policy,
    initialState: {
      operationName: STATE_OPERATION,
      startedAt: initial.startedAt,
      completedAt: initial.completedAt,
      result: structuredContent(prepared.initialResult),
    },
    providerTerminal: {
      status: 'completed',
      remoteTaskId: lifecycle.binding.remoteTaskId,
      runtimeRevision: prepared.runtimeRevision,
      observedAt: prepared.providerObservedAt,
      result: prepared.terminalStructured,
    },
    finalState: {
      operationName: STATE_OPERATION,
      startedAt: final.startedAt,
      completedAt: final.completedAt,
      result: structuredContent(prepared.persistedFinalResult),
    },
    executionAudit: {
      navigationDispatchCount: ordered.filter(
        (invocation) => invocation.toolName === NAVIGATE_OPERATION,
      ).length,
      forbiddenOperationCount: ordered.filter(
        (invocation) =>
          invocation.toolName !== NAVIGATE_OPERATION && invocation.toolName !== STATE_OPERATION,
      ).length,
    },
  });
}

function exactRemoteLifecycle(
  values: readonly RemoteTaskLifecycleEvidence[],
  taskId: string,
  navigate: McpInvocation,
  selected: SelectedTaskOperation,
): RemoteTaskLifecycleEvidence {
  const matches = values.filter(
    ({ binding }) =>
      binding.agentTaskId === taskId &&
      binding.mcpInvocationId === navigate.invocationId &&
      binding.serverId === selected.server.serverId &&
      binding.operationName === selected.operation.operationName &&
      executionContextMatches(binding.executionContext, selected.execution),
  );
  const exact = matches[0];
  if (values.length !== 1 || matches.length !== 1 || exact === undefined)
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_REMOTE_TASK_INVALID',
      'UGV evidence requires exactly one remote Task bound to the navigation invocation.',
    );
  return exact;
}

function revalidateSelectedTaskOperation(selected: SelectedTaskOperation): SelectedTaskOperation {
  try {
    const { snapshotHash, ...draft } = selected;
    const recreated = createSelectedTaskOperation(draft);
    if (recreated.snapshotHash !== snapshotHash)
      invalid(
        'UGV_MOVE_WORKFLOW_EVIDENCE_SELECTED_OPERATION_INVALID',
        'Selected Task operation content differs from its persisted snapshot hash.',
      );
    return recreated;
  } catch (error: unknown) {
    if (error instanceof UgvMoveWorkflowEvidenceError) throw error;
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_SELECTED_OPERATION_INVALID',
      'Selected Task operation is malformed or has been tampered with.',
    );
  }
}

function assertInvocationLineage(
  ordered: readonly McpInvocation[],
  initial: McpInvocation,
  navigate: McpInvocation,
  final: McpInvocation,
  lifecycle: RemoteTaskLifecycleEvidence,
  selected: SelectedTaskOperation,
): void {
  const binding = lifecycle.binding;
  const expectedNavigateNodeRunId = `${binding.workflowInstanceId}~${encodeURIComponent(
    UGV_MOVE_WORKFLOW_NODE_IDS.navigate,
  )}~1`;
  const invocationTimesValid = ordered.every((invocation) => {
    const startedAt = Date.parse(invocation.startedAt);
    const completedAt = Date.parse(invocation.completedAt);
    return (
      invocation.invocationId.trim() !== '' &&
      Number.isFinite(startedAt) &&
      Number.isFinite(completedAt) &&
      completedAt >= startedAt &&
      invocation.durationMs === completedAt - startedAt &&
      invocation.errorCode === undefined &&
      invocation.errorMessage === undefined
    );
  });
  if (
    new Set(ordered.map((invocation) => invocation.invocationId)).size !== ordered.length ||
    !invocationTimesValid ||
    Date.parse(initial.completedAt) > Date.parse(navigate.startedAt) ||
    initial.serverId !== selected.finalStateRead.serverId ||
    final.serverId !== selected.finalStateRead.serverId ||
    navigate.serverId !== selected.server.serverId ||
    hashCanonicalEvidenceJson(initial.arguments) !== selected.finalStateRead.argumentsHash ||
    hashCanonicalEvidenceJson(final.arguments) !== selected.finalStateRead.argumentsHash ||
    hashCanonicalEvidenceJson(navigate.arguments) !== selected.argumentsHash ||
    !sameJson(initial.executionSemantics, selected.finalStateRead.executionSemantics) ||
    !sameJson(final.executionSemantics, selected.finalStateRead.executionSemantics) ||
    !sameJson(navigate.executionSemantics, selected.operation.executionSemantics) ||
    ordered.some(
      (invocation) =>
        invocation.taskId !== binding.agentTaskId ||
        invocation.contextId !== binding.contextId ||
        invocation.executionMode !== selected.execution.mode ||
        (selected.execution.mode === 'simulation'
          ? invocation.simulationId !== selected.execution.simulationId
          : invocation.simulationId !== undefined),
    ) ||
    navigate.invocationId !== binding.mcpInvocationId ||
    remoteTaskIdFromInvocation(navigate.result) !== binding.remoteTaskId ||
    binding.contextId.trim() === '' ||
    binding.goalId.trim() === '' ||
    !Number.isSafeInteger(binding.goalVersion) ||
    binding.goalVersion < 1 ||
    binding.workflowPlanId.trim() === '' ||
    binding.workflowDefinitionId.trim() === '' ||
    !Number.isSafeInteger(binding.workflowDefinitionVersion) ||
    binding.workflowDefinitionVersion < 1 ||
    binding.workflowInstanceId.trim() === '' ||
    binding.workflowNodeId !== UGV_MOVE_WORKFLOW_NODE_IDS.navigate ||
    binding.workflowNodeRunId !== expectedNavigateNodeRunId ||
    binding.taskBehavior !== selected.operation.taskExecutionProfile.taskBehavior ||
    binding.taskCancellation !== selected.operation.executionSemantics.cancellation ||
    binding.protocolContract.serverDiscoverySnapshotId !== selected.server.discoverySnapshotId ||
    !sameRemoteAuthority(binding.authoritySnapshot, selected)
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID',
      'Durable MCP, Task, Plan, Workflow, node-run, or Provider lineage differs from selection.',
    );
}

function executionContextMatches(
  context: Readonly<{ mode: string; simulationId?: string }>,
  execution: SelectedTaskOperation['execution'],
): boolean {
  return (
    context.mode === execution.mode &&
    (execution.mode === 'simulation'
      ? context.simulationId === execution.simulationId
      : context.simulationId === undefined)
  );
}

function assertGovernedConfirmation(
  confirmation: GovernedControlConfirmation,
  taskId: string,
  initial: McpInvocation,
  navigate: McpInvocation,
  final: McpInvocation,
  lifecycle: RemoteTaskLifecycleEvidence,
  selected: SelectedTaskOperation,
): void {
  const binding = lifecycle.binding;
  const argumentsHash = selected.argumentsHash.slice('sha256:'.length);
  const expectedDispatchHash = createMcpProviderDispatchHash({
    invocationId: navigate.invocationId,
    taskId,
    contextId: binding.contextId,
    providerBindingId: selected.providerBinding.bindingId,
    providerId: selected.provider.providerId,
    serverId: selected.server.serverId,
    toolName: selected.operation.operationName,
    arguments: selected.resolvedArguments,
  });
  const expectedConfirmationId = ugvGovernedControlConfirmationId({
    ...confirmation,
    selectedTaskOperationSnapshotHash: selected.snapshotHash,
  });
  const confirmedAt = Date.parse(confirmation.confirmedAt);
  const consumedAt = Date.parse(confirmation.consumedAt ?? '');
  const expiresAt = Date.parse(confirmation.expiresAt);
  if (
    confirmation.confirmationId !== expectedConfirmationId ||
    confirmation.taskId !== taskId ||
    confirmation.capabilityId !== selected.task.semanticTaskType ||
    !Number.isSafeInteger(confirmation.capabilityVersion) ||
    confirmation.capabilityVersion < 1 ||
    confirmation.capabilityAttemptId.trim() === '' ||
    navigate.capabilityAttemptId !== confirmation.capabilityAttemptId ||
    confirmation.planId !== binding.workflowPlanId ||
    !/^[0-9a-f]{64}$/u.test(confirmation.planHash) ||
    confirmation.skillId !== selected.skill.skillId ||
    confirmation.skillVersion !== selected.skill.version ||
    confirmation.providerBindingId !== selected.providerBinding.bindingId ||
    confirmation.serverId !== selected.server.serverId ||
    confirmation.toolName !== selected.operation.operationName ||
    confirmation.argumentsHash !== argumentsHash ||
    confirmation.authenticationMethod.trim() === '' ||
    confirmation.actorRoles.length !== 1 ||
    confirmation.actorRoles[0] !== 'physical_control_approver' ||
    confirmation.revokedAt !== undefined ||
    confirmation.revokedBy !== undefined ||
    confirmation.consumedInvocationId !== navigate.invocationId ||
    confirmation.consumedDispatchHash !== expectedDispatchHash ||
    !Number.isFinite(confirmedAt) ||
    !Number.isFinite(consumedAt) ||
    !Number.isFinite(expiresAt) ||
    confirmedAt > consumedAt ||
    consumedAt < Date.parse(navigate.startedAt) ||
    consumedAt > Date.parse(navigate.completedAt) ||
    expiresAt <= consumedAt ||
    navigate.controlConfirmationId !== confirmation.confirmationId ||
    navigate.controlProviderBindingId !== confirmation.providerBindingId ||
    navigate.controlArgumentsHash !== confirmation.argumentsHash ||
    navigate.controlDispatchHash !== confirmation.consumedDispatchHash ||
    hasGovernedControlAuthority(initial) ||
    hasGovernedControlAuthority(final)
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_CONFIRMATION_INVALID',
      'The navigate invocation is not bound to the exact consumed governed confirmation.',
    );
}

function assertContinuationAuthority(
  lifecycle: RemoteTaskLifecycleEvidence,
  attempt: WorkflowContinuationAttempt,
  navigate: McpInvocation,
  final: McpInvocation,
  phase: 'final_read' | 'terminal_callback',
): void {
  const binding = lifecycle.binding;
  const control = exactLifecycleItem(lifecycle.controls);
  const continuation = exactLifecycleItem(lifecycle.continuations);
  const controlPayload = requiredContinuationRecord(control.payload);
  const terminalResult = controlPayload['result'];
  const claimedAt = Date.parse(control.claimedAt ?? '');
  const controlCreatedAt = Date.parse(control.createdAt);
  const terminalAt = Date.parse(binding.terminalAt ?? '');
  const providerObservedAt = Date.parse(
    stringField(binding.resultSnapshot?.structuredContent, 'observedAt') ?? '',
  );
  const attemptStartedAt = Date.parse(attempt.startedAt ?? '');
  const attemptCompletedAt = Date.parse(attempt.completedAt ?? '');
  const continuationCreatedAt = Date.parse(continuation.createdAt);
  const continuationUpdatedAt = Date.parse(continuation.updatedAt);
  const finalStartedAt = Date.parse(final.startedAt);
  if (
    binding.protocolStatus !== 'completed' ||
    binding.localState !== 'terminal_event_claimed' ||
    control.bindingId !== binding.bindingId ||
    control.type !== 'task.completed' ||
    control.status !== 'claimed' ||
    control.claimedAt === undefined ||
    control.processedAt !== undefined ||
    control.errorCode !== undefined ||
    control.resultHash !== canonicalHash(control.payload) ||
    control.remoteRevision !== binding.remoteRevision ||
    control.runtimeRevision !== binding.runtimeRevision ||
    controlPayload['remoteTaskId'] !== binding.remoteTaskId ||
    controlPayload['status'] !== 'completed' ||
    controlPayload['protocolRevision'] !== binding.protocolRevision ||
    controlPayload['tasksSchemaRevision'] !== binding.tasksSchemaRevision ||
    controlPayload['runtimeRevision'] !== binding.runtimeRevision ||
    controlPayload['providerRevision'] !== binding.providerRevision ||
    controlPayload['lastUpdatedAt'] !== binding.lastProviderUpdatedAt ||
    terminalResult === undefined ||
    !sameJson(terminalResult, binding.resultSnapshot) ||
    continuation.snapshotId !== attempt.snapshotId ||
    continuation.continuationId !== attempt.continuationId ||
    continuation.stateVersion !== attempt.snapshotStateVersion ||
    (continuation.lifecycle !== 'active' && continuation.lifecycle !== 'terminal') ||
    continuation.waitId !== binding.bindingId ||
    continuation.waitState !== 'waiting' ||
    continuation.nodeId !== binding.workflowNodeId ||
    continuation.nodeRunId !== binding.workflowNodeRunId ||
    attempt.eventId !== control.eventId ||
    attempt.workflowInstanceId !== binding.workflowInstanceId ||
    (phase === 'final_read'
      ? attempt.status !== 'running' || attempt.completedAt !== undefined
      : attempt.status !== 'succeeded' ||
        attempt.completedAt === undefined ||
        !Number.isFinite(attemptCompletedAt)) ||
    attempt.errorCode !== undefined ||
    !Number.isFinite(claimedAt) ||
    !Number.isFinite(controlCreatedAt) ||
    !Number.isFinite(terminalAt) ||
    !Number.isFinite(providerObservedAt) ||
    !Number.isFinite(attemptStartedAt) ||
    !Number.isFinite(continuationCreatedAt) ||
    !Number.isFinite(continuationUpdatedAt) ||
    binding.updatedAt !== control.claimedAt ||
    binding.terminalAt !== control.createdAt ||
    attempt.createdAt !== control.claimedAt ||
    controlCreatedAt > claimedAt ||
    terminalAt > claimedAt ||
    claimedAt > attemptStartedAt ||
    (phase === 'terminal_callback' &&
      (attemptCompletedAt < attemptStartedAt ||
        attemptCompletedAt < Date.parse(final.completedAt))) ||
    continuationCreatedAt > controlCreatedAt ||
    continuationUpdatedAt < continuationCreatedAt ||
    Date.parse(navigate.completedAt) > terminalAt ||
    finalStartedAt <= terminalAt ||
    finalStartedAt <= claimedAt ||
    finalStartedAt <= providerObservedAt ||
    finalStartedAt <= attemptStartedAt
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID',
      phase === 'final_read'
        ? 'The final read is not executing under the exact claimed durable continuation authority.'
        : 'The terminal callback lacks its exact succeeded continuation authority.',
    );
}

function hasGovernedControlAuthority(invocation: McpInvocation): boolean {
  return (
    invocation.controlConfirmationId !== undefined ||
    invocation.controlProviderBindingId !== undefined ||
    invocation.controlArgumentsHash !== undefined ||
    invocation.controlDispatchHash !== undefined
  );
}

function sameRemoteAuthority(
  authority: RemoteTaskLifecycleEvidence['binding']['authoritySnapshot'],
  selected: SelectedTaskOperation,
): boolean {
  const provider = authority?.providerBinding;
  return (
    authority?.runtime.serverId === selected.server.serverId &&
    authority.runtime.toolRevision === selected.server.toolRevision &&
    authority.runtime.protocolSnapshotId === selected.server.discoverySnapshotId &&
    authority.runtime.catalogRevision === selected.server.catalogRevision &&
    authority.runtime.catalogChecksum === selected.server.catalogChecksum &&
    provider?.bindingId === selected.providerBinding.bindingId &&
    provider.revision === selected.providerBinding.revision &&
    provider.providerId === selected.provider.providerId &&
    provider.catalogRevision === selected.server.catalogRevision &&
    provider.catalogChecksum === selected.server.catalogChecksum
  );
}

function remoteTaskIdFromInvocation(value: unknown): string | undefined {
  const remoteTask = record(record(value)?.['remoteTask']);
  return stringField(remoteTask, 'remoteTaskId');
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return hashCanonicalEvidenceJson(left) === hashCanonicalEvidenceJson(right);
  } catch {
    return false;
  }
}

function exactLifecycleItem<T>(values: readonly T[]): T {
  const value = values[0];
  if (values.length !== 1 || value === undefined)
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID',
      'The final read requires exactly one terminal control and predecessor continuation.',
    );
  return value;
}

function requiredContinuationRecord(value: unknown): Readonly<Record<string, unknown>> {
  const object = record(value);
  if (object === undefined)
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_CONTINUATION_INVALID',
      'The claimed terminal control payload is invalid.',
    );
  return object;
}

function projectResult(
  result: InternalToolResult,
  assessment: UgvMoveOutcomeAssessment,
  navigateInvocationId: string,
): InternalToolResult {
  const metadata = { ...(result.metadata ?? {}) };
  if (assessment.status !== 'completed') {
    metadata['io.sdar/ugv-move-assessment'] = Object.freeze({ ...assessment });
    return Object.freeze({
      ...result,
      metadata: Object.freeze(metadata),
      validatedEvidence: Object.freeze({
        ...(result.validatedEvidence ?? {}),
        [FINAL_POSITION_REQUIREMENT]: false,
      }),
    });
  }
  const evidenceId = `ugv-position-${navigateInvocationId}`;
  const evidenceItem = Object.freeze({
    evidenceId,
    evidenceType: assessment.evidence.evidenceType,
    observedAt: assessment.evidence.observedAt,
    subjectRef: assessment.evidence.resourceId,
    producer: Object.freeze([
      `mcp_invocation:${navigateInvocationId}`,
      `remote_task:${assessment.evidence.remoteTaskId}`,
    ]),
    payloadRef: Object.freeze({
      kind: 'structured_content' as const,
      jsonPointer: '/chassis/position',
    }),
  });
  createProviderEvidenceItem(evidenceItem);
  const projectedEvidence = Object.freeze({
    ...assessment.evidence,
    evidenceId,
  });
  metadata['io.sdar/evidence'] = Object.freeze({ items: Object.freeze([projectedEvidence]) });
  metadata['io.sdar/ugv-move-assessment'] = Object.freeze({
    status: assessment.status,
    reasonCode: assessment.reasonCode,
  });
  metadata['ugvSkillResult'] = completedSkillResult(assessment);
  return Object.freeze({
    ...result,
    metadata: Object.freeze(metadata),
    evidence: Object.freeze([...(result.evidence ?? []), evidenceItem]),
    validatedEvidence: Object.freeze({
      ...(result.validatedEvidence ?? {}),
      [FINAL_POSITION_REQUIREMENT]: true,
    }),
  });
}

function completedSkillResult(
  assessment: Extract<UgvMoveOutcomeAssessment, Readonly<{ status: 'completed' }>>,
): UgvMoveSkillResult {
  return Object.freeze({
    resourceId: assessment.evidence.resourceId,
    status: 'completed' as const,
    finalPosition: Object.freeze({
      x: assessment.evidence.finalPosition.longitude,
      y: assessment.evidence.finalPosition.latitude,
      frame: 'EPSG:4326' as const,
    }),
  });
}

function target(selected: SelectedTaskOperation) {
  const mission = record(selected.resolvedArguments['mission']);
  const value = record(mission?.['target']);
  const longitude = value?.['longitude'];
  const latitude = value?.['latitude'];
  if (typeof longitude !== 'number' || typeof latitude !== 'number')
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_INVOCATION_LINEAGE_INVALID',
      'Selected navigation target is not a finite WGS84 position.',
    );
  return Object.freeze({ longitude, latitude });
}

function internalResult(value: unknown): InternalToolResult | undefined {
  const object = record(value);
  return object !== undefined &&
    Array.isArray(object['content']) &&
    typeof object['isError'] === 'boolean'
    ? (object as unknown as InternalToolResult)
    : undefined;
}

function structuredContent(result: InternalToolResult): unknown {
  return result.structuredContent;
}

function stringField(value: unknown, key: string): string | undefined {
  const object = record(value);
  const field = object?.[key];
  return typeof field === 'string' && field.trim() !== '' ? field : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function compareInvocations(left: McpInvocation, right: McpInvocation): number {
  const started = left.startedAt.localeCompare(right.startedAt);
  return started === 0 ? left.invocationId.localeCompare(right.invocationId) : started;
}

function invalid(code: UgvMoveWorkflowEvidenceErrorCode, message: string): never {
  throw new UgvMoveWorkflowEvidenceError(code, message);
}

export class UgvMoveWorkflowEvidenceError extends Error {
  constructor(
    readonly code: UgvMoveWorkflowEvidenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveWorkflowEvidenceError';
  }
}
