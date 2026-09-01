import {
  ResultProcessingError,
  TaskCapabilityError,
  type GoalEvaluator,
  type GovernedControlConsumedConfirmationReader,
  type McpRegistryRepository,
  type RemoteTaskLifecycleQuery,
  type ResultProcessor,
  type RuntimeTaskCapabilityService,
  type SkillRepository,
  type WorkflowContinuationRepository,
} from '../../../packages/application/src/index.js';
import {
  createTaskCapabilityBinding,
  createTaskCapabilityExecutionAttempt,
  hashCanonicalEvidenceJson,
  normalizeResultEnvelope,
  type GoalEvaluationResult,
  type ProcessedResultRecord,
  type RuntimeTaskCapabilityTerminalProof,
  type SelectedTaskOperation,
  type SkillVersion,
  type TaskCapabilityBinding,
  type TaskCapabilityExecutionAttempt,
  type WorkflowInstance,
} from '../../../packages/domain/src/index.js';

import { adaptUgvMoveInput, UgvMoveInputAdapterError } from './ugv-move-input-adapter.js';
import {
  snapshotUgvMovePositionPolicy,
  type UgvMovePositionPolicy,
} from './ugv-move-position-result.js';
import {
  UgvMoveWorkflowAuthorityError,
  type UgvMoveWorkflowAuthority,
  type UgvMoveWorkflowAuthorityIdentity,
} from './ugv-move-workflow-authority.js';
import {
  UgvMoveWorkflowEvidenceError,
  verifyUgvMoveTerminalWorkflowEvidence,
  type UgvMoveTerminalWorkflowEvidenceInput,
  type UgvMoveTerminalWorkflowEvidenceVerification,
} from './ugv-move-workflow-evidence.js';
import { createUgvSimulationTargetPolicy } from './ugv-move-skill-usage.js';

const SKILL_ID = 'embodied.move_to';
const SKILL_VERSION = 1;
const SKILL_REFERENCE = 'skill:embodied.move_to:1';
const CAPABILITY_ID = 'embodied.move';
const NAVIGATE_OPERATION = 'vehicle_navigate';
const RESOURCE_ID = 'vehicle:ugv1';
const TERMINAL_SUMMARY =
  'UGV movement completed with durable final-position evidence under the exact governed execution authority.';

export type UgvMoveTerminalEvidenceVerifier = (
  input: UgvMoveTerminalWorkflowEvidenceInput,
) => UgvMoveTerminalWorkflowEvidenceVerification;

export interface UgvMoveTerminalOutcomeDependencies {
  readonly taskCapabilities: Pick<RuntimeTaskCapabilityService, 'findBinding' | 'listAttempts'>;
  readonly skills: Pick<SkillRepository, 'findVersion'>;
  readonly workflowAuthority: Pick<UgvMoveWorkflowAuthority, 'loadExact'>;
  readonly invocations: Pick<McpRegistryRepository, 'listInvocationsByTask'>;
  readonly remoteTasks: Pick<RemoteTaskLifecycleQuery, 'listByAgentTaskId'>;
  readonly confirmations: GovernedControlConsumedConfirmationReader;
  readonly continuations: Pick<WorkflowContinuationRepository, 'listAttempts'>;
  readonly resultProcessor: Pick<ResultProcessor, 'process'>;
  readonly positionPolicy: UgvMovePositionPolicy;
  readonly verifyTerminalEvidence?: UgvMoveTerminalEvidenceVerifier;
}

export interface UgvMovePreparedTerminalOutcome {
  readonly processedResult: ProcessedResultRecord;
  readonly capabilityTerminalProof: RuntimeTaskCapabilityTerminalProof;
  readonly verifiedOutcomeRefs: Readonly<{
    readonly effectRefs: readonly ['effect.final_position'];
    readonly evidenceRefs: readonly ['evidence.final_position'];
    readonly artifactRefs: readonly [];
  }>;
}

/**
 * Profile-only terminal authority. It returns an unpersisted ProcessedResultRecord so the existing
 * terminal repository can commit Result, Task, Goal, control, and Capability attempt atomically.
 */
export class UgvMoveTerminalOutcomeAuthority {
  readonly #dependencies: Omit<UgvMoveTerminalOutcomeDependencies, 'positionPolicy'>;
  readonly #positionPolicy: UgvMovePositionPolicy;

  constructor(dependencies: UgvMoveTerminalOutcomeDependencies) {
    this.#dependencies = dependencies;
    this.#positionPolicy = snapshotUgvMovePositionPolicy(dependencies.positionPolicy);
  }

  async prepare(
    taskIdInput: string,
    instance: WorkflowInstance,
  ): Promise<UgvMovePreparedTerminalOutcome> {
    const taskId = taskIdInput.trim();
    const identity = terminalIdentity(taskId, instance);
    const [bindingInput, attemptsInput, skill, selected] = await Promise.all([
      this.#dependencies.taskCapabilities.findBinding(taskId),
      this.#dependencies.taskCapabilities.listAttempts(taskId),
      this.#dependencies.skills.findVersion(SKILL_ID, SKILL_VERSION),
      this.#loadSelected(identity),
    ]);
    const binding = exactBinding(bindingInput, taskId);
    const attempt = exactActiveAttempt(attemptsInput, binding, instance);
    assertExactSkill(skill, selected.skill.skillId, selected.skill.version);
    assertBindingSelection(binding, attempt, selected, instance);

    const [invocations, remoteTaskLifecycle, continuationAttempts] = await Promise.all([
      this.#dependencies.invocations.listInvocationsByTask(taskId),
      this.#dependencies.remoteTasks.listByAgentTaskId(taskId),
      this.#dependencies.continuations.listAttempts(instance.instanceId),
    ]);
    const navigateInvocations = invocations.filter(
      (invocation) => invocation.toolName === NAVIGATE_OPERATION,
    );
    const navigate = navigateInvocations[0];
    const continuationAttempt = continuationAttempts[0];
    if (
      navigateInvocations.length !== 1 ||
      navigate === undefined ||
      continuationAttempts.length !== 1 ||
      continuationAttempt === undefined
    )
      guard('UGV terminal authority requires one navigation and one continuation attempt.');
    const confirmation = await this.#dependencies.confirmations.findConsumedByInvocation(
      navigate.invocationId,
    );
    if (
      confirmation?.capabilityBindingId !== binding.bindingId ||
      confirmation.capabilityAttemptId !== attempt.attemptId
    )
      guard('UGV terminal authority requires the exact consumed Capability confirmation.');
    const lifecycle = remoteTaskLifecycle[0];
    if (
      remoteTaskLifecycle.length !== 1 ||
      lifecycle?.binding.workflowPlanId !== instance.planId ||
      lifecycle.binding.workflowDefinitionId !== instance.workflowDefinitionId ||
      lifecycle.binding.workflowDefinitionVersion !== instance.workflowVersion ||
      lifecycle.binding.workflowInstanceId !== instance.instanceId ||
      lifecycle.binding.goalId !== instance.goalId ||
      lifecycle.binding.goalVersion !== instance.goalVersion
    )
      guard('UGV remote Task lineage differs from the succeeded Workflow instance.');

    const verification = this.#verifyEvidence({
      taskId,
      selectedTaskOperation: selected,
      confirmation,
      invocations,
      remoteTaskLifecycle,
      continuationAttempt,
      workflowResult: instance.result,
      policy: this.#positionPolicy,
    });
    const exactSkill = requiredSkill(skill);
    let output: ProcessedResultRecord['output'];
    try {
      output = this.#dependencies.resultProcessor.process({
        text: TERMINAL_SUMMARY,
        structured: verification.skillResult,
        outputSchema: exactSkill.outputSchema,
      });
    } catch (error: unknown) {
      if (error instanceof ResultProcessingError)
        guard('The deterministic UGV terminal result does not satisfy the exact Skill schema.');
      throw error;
    }
    const completedAt = requiredCompletionTime(instance);
    let normalized: ProcessedResultRecord['normalized'];
    try {
      normalized = normalizeResultEnvelope(verification.skillResult);
    } catch {
      guard('The deterministic UGV terminal result is not JSON serializable.');
    }
    return Object.freeze({
      processedResult: Object.freeze({
        resultId: `processed-result-terminal-${taskId}`,
        taskId,
        skillId: SKILL_ID,
        skillVersion: SKILL_VERSION,
        normalized,
        output,
        facts: Object.freeze([
          Object.freeze({
            name: 'resourceId',
            value: verification.skillResult.resourceId,
            confidence: 1,
          }),
          Object.freeze({ name: 'status', value: verification.skillResult.status, confidence: 1 }),
          Object.freeze({
            name: 'finalPosition',
            value: Object.freeze({ ...verification.skillResult.finalPosition }),
            confidence: 1,
          }),
        ]),
        valuable: true,
        valueSummary: TERMINAL_SUMMARY,
        memoryCandidates: Object.freeze([]),
        createdAt: completedAt,
      }),
      capabilityTerminalProof: Object.freeze({
        taskId,
        bindingId: binding.bindingId,
        bindingHash: binding.bindingHash,
        attemptId: attempt.attemptId,
        requestedCapabilityId: binding.requestedCapabilityId,
        capabilityVersion: binding.capabilityVersion,
      }),
      verifiedOutcomeRefs: Object.freeze({
        effectRefs: Object.freeze(['effect.final_position'] as const),
        evidenceRefs: Object.freeze(['evidence.final_position'] as const),
        artifactRefs: Object.freeze([] as const),
      }),
    });
  }

  async #loadSelected(identity: UgvMoveWorkflowAuthorityIdentity) {
    try {
      return await this.#dependencies.workflowAuthority.loadExact(identity);
    } catch (error: unknown) {
      if (error instanceof UgvMoveWorkflowAuthorityError)
        guard('The exact persisted UGV Workflow selection authority is invalid.');
      throw error;
    }
  }

  #verifyEvidence(
    input: UgvMoveTerminalWorkflowEvidenceInput,
  ): UgvMoveTerminalWorkflowEvidenceVerification {
    try {
      return (this.#dependencies.verifyTerminalEvidence ?? verifyUgvMoveTerminalWorkflowEvidence)(
        input,
      );
    } catch (error: unknown) {
      if (error instanceof UgvMoveWorkflowEvidenceError)
        guard('Durable UGV Workflow evidence does not authorize terminal success.');
      throw error;
    }
  }
}

/** Model-free Goal evaluator for the exact UGV Profile terminal boundary. */
export class UgvMoveDeterministicGoalEvaluator implements GoalEvaluator {
  readonly #authority: Pick<UgvMoveTerminalOutcomeAuthority, 'prepare'>;

  constructor(authority: Pick<UgvMoveTerminalOutcomeAuthority, 'prepare'>) {
    this.#authority = authority;
  }

  async evaluate(input: Parameters<GoalEvaluator['evaluate']>[0]): Promise<GoalEvaluationResult> {
    const taskId = input.taskId?.trim();
    if (
      taskId === undefined ||
      taskId === '' ||
      input.goal.status !== 'active' ||
      input.goal.goalId !== input.instance.goalId ||
      input.goal.version !== input.instance.goalVersion
    )
      guard('The UGV Goal and succeeded Workflow terminal identities do not match.');
    await this.#authority.prepare(taskId, input.instance);
    return Object.freeze({ decision: 'achieved' as const, summary: TERMINAL_SUMMARY });
  }
}

function terminalIdentity(
  taskId: string,
  instance: WorkflowInstance,
): UgvMoveWorkflowAuthorityIdentity {
  if (
    taskId === '' ||
    instance.status !== 'succeeded' ||
    instance.result === undefined ||
    Object.keys(instance.errors).length !== 0 ||
    !sameJson(instance.skillVersions, [{ skillId: SKILL_ID, version: SKILL_VERSION }]) ||
    !present(instance.instanceId) ||
    !present(instance.planId) ||
    !present(instance.workflowDefinitionId) ||
    !Number.isSafeInteger(instance.workflowVersion) ||
    instance.workflowVersion < 1 ||
    !present(instance.goalId) ||
    !Number.isSafeInteger(instance.goalVersion) ||
    instance.goalVersion < 1
  )
    guard('UGV terminal success requires one exact succeeded Workflow instance.');
  requiredCompletionTime(instance);
  return Object.freeze({
    taskId,
    workflowPlanId: instance.planId,
    workflowDefinitionId: instance.workflowDefinitionId,
    workflowDefinitionVersion: instance.workflowVersion,
    goalId: instance.goalId,
    goalVersion: instance.goalVersion,
    skillId: SKILL_ID,
    skillVersion: SKILL_VERSION,
  });
}

function exactBinding(
  binding: TaskCapabilityBinding | undefined,
  taskId: string,
): TaskCapabilityBinding {
  if (binding === undefined) guard('UGV terminal success requires the frozen Task binding.');
  let exact: TaskCapabilityBinding;
  try {
    exact = createTaskCapabilityBinding(binding);
  } catch {
    guard('The frozen UGV Task binding is malformed or does not reproduce its hash.');
  }
  if (
    exact.taskId !== taskId ||
    exact.requestedCapabilityId !== CAPABILITY_ID ||
    exact.capabilityVersion < 2 ||
    !sameStrings(exact.initialImplementationRefs, [SKILL_REFERENCE])
  )
    guard('The frozen Task binding is not the exact embodied.move@2 authority.');
  return exact;
}

function exactActiveAttempt(
  attempts: readonly TaskCapabilityExecutionAttempt[],
  binding: TaskCapabilityBinding,
  instance: WorkflowInstance,
): TaskCapabilityExecutionAttempt {
  let exact: readonly TaskCapabilityExecutionAttempt[];
  try {
    exact = attempts.map((attempt) => createTaskCapabilityExecutionAttempt(attempt));
  } catch {
    guard('The UGV Capability execution-attempt lineage is malformed.');
  }
  const ordered = [...exact].sort((left, right) => left.attemptNo - right.attemptNo);
  const latest = ordered.at(-1);
  if (
    latest === undefined ||
    new Set(ordered.map(({ attemptId }) => attemptId)).size !== ordered.length ||
    new Set(ordered.map(({ attemptNo }) => attemptNo)).size !== ordered.length ||
    latest.taskId !== binding.taskId ||
    latest.capabilityBindingId !== binding.bindingId ||
    latest.planId !== instance.planId ||
    !['prepared', 'running', 'waiting'].includes(latest.status) ||
    !sameStrings(latest.skillVersionRefs, [SKILL_REFERENCE]) ||
    ordered
      .slice(0, -1)
      .some((attempt) => ['prepared', 'running', 'waiting', 'succeeded'].includes(attempt.status))
  )
    guard('UGV terminal success requires the latest active exact Capability attempt.');
  return latest;
}

function assertExactSkill(
  skill: SkillVersion | undefined,
  selectedSkillId: string,
  selectedSkillVersion: number,
): void {
  const exact = requiredSkill(skill);
  const evidence = exact.usageSpecification?.evidencePolicy.requirements[0];
  const outcome = exact.outcomeSpecification;
  if (
    exact.skillId !== selectedSkillId ||
    exact.version !== selectedSkillVersion ||
    exact.status !== 'enabled' ||
    !exact.validationPassed ||
    exact.usageSpecification?.evidencePolicy.requirements.length !== 1 ||
    evidence?.requirementId !== 'final-position' ||
    evidence.evidenceType !== 'position.observation' ||
    !evidence.required ||
    !evidence.hardGate ||
    !exact.usageSpecification.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    !sameStrings(outcome?.effects ?? [], ['effect.final_position']) ||
    !sameStrings(outcome?.evidence ?? [], ['evidence.final_position']) ||
    (outcome?.artifacts.length ?? -1) !== 0
  )
    guard('The current exact UGV Skill hard-gate contract is invalid.');
}

function requiredSkill(skill: SkillVersion | undefined): SkillVersion {
  if (skill?.skillId !== SKILL_ID || skill.version !== SKILL_VERSION)
    guard('The exact embodied.move_to@1 Skill version is unavailable.');
  return skill;
}

function assertBindingSelection(
  binding: TaskCapabilityBinding,
  attempt: TaskCapabilityExecutionAttempt,
  selected: Awaited<ReturnType<UgvMoveWorkflowAuthority['loadExact']>>,
  instance: WorkflowInstance,
): void {
  let adapted: ReturnType<typeof adaptUgvMoveInput>;
  try {
    adapted = adaptUgvMoveInput(binding.inputSnapshot);
  } catch (error: unknown) {
    if (error instanceof UgvMoveInputAdapterError)
      guard('The frozen UGV Capability input cannot be deterministically adapted.');
    throw error;
  }
  const resourcePolicy = exactlyOneConstraint(binding, 'resource_policy');
  const providerPolicy = exactlyOneConstraint(binding, 'provider_binding_policy');
  const exactSkill = exactlyOneConstraint(binding, 'exact_skill_version');
  const confirmation = exactlyOneConstraint(binding, 'confirmation_policy');
  const physical = exactlyOneConstraint(binding, 'physical_side_effect_policy');
  const execution = exactlyOneConstraint(binding, 'runtime_execution_mode_policy');
  const targetPolicies = binding.constraintSnapshot.filter(
    (constraint) => constraint['type'] === 'ugv_simulation_target_policy',
  );
  if (
    selected.skill.skillId !== SKILL_ID ||
    selected.skill.version !== SKILL_VERSION ||
    selected.resource.resourceId !== RESOURCE_ID ||
    !exactExecutionSelection(execution, selected.execution, targetPolicies) ||
    !sameJson(adapted.providerArguments, selected.resolvedArguments) ||
    adapted.argumentsHash !== selected.argumentsHash ||
    resourcePolicy['selection'] !== 'exact_value' ||
    !sameJson(resourcePolicy['allowedResourceIds'], [RESOURCE_ID]) ||
    providerPolicy['mcpProviderBindingId'] !== selected.providerBinding.bindingId ||
    providerPolicy['localServerId'] !== selected.server.serverId ||
    providerPolicy['mcpToolName'] !== NAVIGATE_OPERATION ||
    providerPolicy['bindingRevision'] !== selected.providerBinding.revision ||
    providerPolicy['catalogRevision'] !== selected.server.catalogRevision ||
    providerPolicy['catalogChecksum'] !== selected.server.catalogChecksum ||
    providerPolicy['requiredStatus'] !== 'active' ||
    providerPolicy['requiredAvailabilityStatus'] !== 'available' ||
    providerPolicy['requiredFreshness'] !== 'unexpired' ||
    providerPolicy['fallback'] !== 'deny' ||
    exactSkill['skillId'] !== SKILL_ID ||
    exactSkill['skillVersion'] !== SKILL_VERSION ||
    exactSkill['taskType'] !== CAPABILITY_ID ||
    confirmation['required'] !== true ||
    !['before_execution', 'pre_dispatch'].includes(String(confirmation['stage'])) ||
    confirmation['autoConfirmPlan'] !== false ||
    physical['sideEffecting'] !== true ||
    physical['dispatchMaximum'] !== 1 ||
    physical['uncertainDispatchPolicy'] !== 'reconcile_never_redispatch' ||
    physical['remoteTaskTerminalEvidenceRequired'] !== true ||
    attempt.providerBindingRefs.length !== 1 ||
    attempt.providerBindingRefs[0] !== selected.providerBinding.bindingId ||
    !sameJson(exactWorkflowSkillInput(instance.input), binding.inputSnapshot)
  )
    guard(
      'The frozen UGV Capability, Provider, execution context, and selected-operation authority drifted.',
    );
  assertCompletionContracts(binding);
}

function exactWorkflowSkillInput(input: unknown): unknown {
  const envelope = record(input);
  const context = record(envelope?.['context']);
  const evidence = record(envelope?.['evidence']);
  if (
    envelope === undefined ||
    !exactKeys(envelope, ['skillInput', 'context', 'evidence']) ||
    context === undefined ||
    !exactKeys(context, ['current-position', 'resource-state', 'permission-context']) ||
    context['current-position'] !== true ||
    context['resource-state'] !== true ||
    context['permission-context'] !== true ||
    evidence === undefined ||
    Object.keys(evidence).length !== 0
  )
    guard('The UGV Workflow execution input envelope is missing or malformed.');
  return envelope['skillInput'];
}

function assertExactTargetPolicy(policy: Readonly<Record<string, unknown>>): void {
  const policyId = policy['policyId'];
  const revision = policy['revision'];
  if (
    typeof policyId !== 'string' ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  )
    guard('The frozen UGV simulation target policy identity is invalid.');
  let expected: Readonly<Record<string, unknown>>;
  try {
    expected = createUgvSimulationTargetPolicy({ policyId, revision });
  } catch {
    guard('The frozen UGV simulation target policy identity is invalid.');
  }
  if (!sameJson(policy, expected))
    guard('The frozen UGV simulation target policy contract is not exact.');
}

function exactExecutionSelection(
  policy: Readonly<Record<string, unknown>>,
  selected: SelectedTaskOperation['execution'],
  targetPolicies: readonly Readonly<Record<string, unknown>>[],
): boolean {
  if (selected.mode === 'live')
    return (
      policy['mode'] === 'live' &&
      policy['simulationId'] === undefined &&
      targetPolicies.length === 0
    );
  if (
    policy['mode'] !== 'simulation' ||
    policy['simulationId'] !== selected.simulationId ||
    targetPolicies.length !== 1 ||
    targetPolicies[0] === undefined
  )
    return false;
  assertExactTargetPolicy(targetPolicies[0]);
  return true;
}

function assertCompletionContracts(binding: TaskCapabilityBinding): void {
  const requiredCriterion = (
    type: string,
    predicate: (value: Readonly<Record<string, unknown>>) => boolean,
  ) => {
    const matches = binding.successCriteriaSnapshot.filter((value) => value['type'] === type);
    return matches.length === 1 && matches[0] !== undefined && predicate(matches[0]);
  };
  const evidence = binding.evidenceRequirementSnapshot.filter(
    (value) => value['evidenceType'] === 'position.observation',
  );
  if (
    !requiredCriterion('output_schema_valid', (value) => value['required'] === true) ||
    !requiredCriterion(
      'resource_identity_matches_request',
      (value) => value['required'] === true,
    ) ||
    !requiredCriterion('required_evidence_complete', (value) => value['required'] === true) ||
    !requiredCriterion('remote_task_identity_present', (value) => value['required'] === true) ||
    !requiredCriterion(
      'remote_terminal_observation_present',
      (value) => value['required'] === true,
    ) ||
    !requiredCriterion('external_command_dispatch_count', (value) => value['maximum'] === 1) ||
    evidence.length !== 1 ||
    evidence[0]?.['required'] !== true ||
    evidence[0]['hardGate'] !== true
  )
    guard('The frozen UGV Capability completion and evidence hard gates are incomplete.');
}

function exactlyOneConstraint(binding: TaskCapabilityBinding, type: string) {
  const matches = binding.constraintSnapshot.filter((constraint) => constraint['type'] === type);
  const exact = matches[0];
  if (matches.length !== 1 || exact === undefined)
    guard(`The frozen UGV Task binding requires one ${type} constraint.`);
  return exact;
}

function requiredCompletionTime(instance: WorkflowInstance): string {
  const completedAt = instance.completedAt;
  if (
    completedAt === undefined ||
    !Number.isFinite(Date.parse(completedAt)) ||
    !Number.isFinite(Date.parse(instance.startedAt)) ||
    Date.parse(completedAt) < Date.parse(instance.startedAt)
  )
    guard('The succeeded UGV Workflow has no valid completion timestamp.');
  return completedAt;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return hashCanonicalEvidenceJson(left) === hashCanonicalEvidenceJson(right);
  } catch {
    return false;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function guard(message: string): never {
  throw new TaskCapabilityError('TASK_CAPABILITY_TERMINAL_GUARD_FAILED', message);
}
