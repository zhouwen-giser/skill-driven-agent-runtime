import { createHash } from 'node:crypto';

import {
  type ArtifactApplicabilityResult,
  type CapabilityReadinessResult,
  type CognitiveSourceRef,
  type CompiledArtifact,
  type DependencyValidationResult,
  type FormalPlanHandoffResult,
  type Goal,
  type GoalContextSnapshot,
  type MaterializedCompletionContract,
  type MaterializedDependency,
  type MaterializedRecoveryBranch,
  type MaterializedSkillGoalNode,
  type ParameterBindingResult,
  type ParameterBindingTrust,
  type PlanTemplateArtifactDefinition,
  type RuntimeExecutionDecision,
  type SkillGoal,
  type TemplateInstantiationInput,
  type TemplateInstantiationResult,
  type UserGoalCompletionContract,
  type UserGoalPlan,
  type UserGoalPlanCandidate,
} from '../../../domain/src/index.js';
import type { JsonValue } from '../../../domain/src/compiler/contracts.js';
import type { ArtifactExecutionRepository, ArtifactRepository } from './artifact-persistence.js';
import type {
  InteractivePlanningSessionView,
  MaterializedPlanningCandidateInput,
} from '../cognitive/interactive-planning-session-service.js';

export interface TemplateRuntimeState {
  readonly goal: Goal;
  readonly contract: UserGoalCompletionContract;
  readonly matcherSnapshotHash: string;
  readonly policySnapshotHash: string;
  readonly capabilityCatalogHash: string;
  readonly readinessHash: string;
  readonly killSwitchActive: boolean;
}

/** Current facts are read twice: once before materialization and once before formal handoff. */
export interface TemplateRuntimeStateReader {
  read(
    input: Readonly<{ goalContractRef: string; goalVersion: number }>,
  ): Promise<TemplateRuntimeState>;
}

export interface TemplatePlanningSessionPort {
  startWithMaterializedCandidate(
    input: MaterializedPlanningCandidateInput,
  ): Promise<InteractivePlanningSessionView>;
}

export interface TemplateRuntimeRequest {
  readonly input: TemplateInstantiationInput;
  readonly decision: RuntimeExecutionDecision;
  readonly applicability: ArtifactApplicabilityResult;
  readonly parameterBinding: ParameterBindingResult;
  readonly dependencyValidation: DependencyValidationResult;
  readonly capabilityReadiness: CapabilityReadinessResult;
  readonly taskId: string;
  readonly userId: string;
  readonly goalSessionId: string;
  readonly confirmedContractCandidateId: string;
  readonly sourceRefs: readonly CognitiveSourceRef[];
}

export interface TemplateRuntimeOutcome {
  readonly result: TemplateInstantiationResult;
  readonly goalContext?: GoalContextSnapshot;
  readonly candidate?: UserGoalPlanCandidate;
  readonly formalHandoff?: FormalPlanHandoffResult;
}

/**
 * P08 adapter from a P07-selected active plan template to the pre-existing
 * formal planning session. It never selects a Skill/Provider/MCP operation,
 * and it never writes a formal plan itself.
 */
export class TemplateRuntimeService {
  readonly #artifacts: ArtifactRepository;
  readonly #executions: ArtifactExecutionRepository;
  readonly #states: TemplateRuntimeStateReader;
  readonly #planning: TemplatePlanningSessionPort;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      artifacts: ArtifactRepository;
      executions: ArtifactExecutionRepository;
      states: TemplateRuntimeStateReader;
      planning: TemplatePlanningSessionPort;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#artifacts = dependencies.artifacts;
    this.#executions = dependencies.executions;
    this.#states = dependencies.states;
    this.#planning = dependencies.planning;
    this.#clock = dependencies.clock;
  }

  async instantiate(request: TemplateRuntimeRequest): Promise<TemplateRuntimeOutcome> {
    const createdAt = this.#clock.now();
    if (request.input.idempotencyKey.trim() === '')
      throw new Error('TEMPLATE_IDEMPOTENCY_KEY_REQUIRED');
    const instantiationId = `p08-instantiation-${shortHash(
      `${request.input.idempotencyKey}:${request.input.artifactHash}:${String(request.input.goalVersion)}`,
    )}`;
    let executionId: string | undefined;
    try {
      assertP07Eligibility(request);
      const before = await this.#readCurrent(request.input);
      const active = await this.#readActiveTemplate(request.input);
      assertCurrentAgainstInput(request, before.state, active.artifact, active.pointerLockVersion);
      const goalContext = goalContextSnapshot(request.input, before.state, active.artifact);
      const materialized = materializeCandidate(
        request,
        before.state,
        active.artifact,
        goalContext,
        instantiationId,
      );
      const execution = await this.#executions.start({
        artifactExecutionId: `p08-execution-${shortHash(
          `${request.input.idempotencyKey}:${request.input.artifactHash}:${String(request.input.goalVersion)}`,
        )}`,
        artifactId: active.artifact.artifactId,
        version: active.artifact.version,
        taskId: request.taskId,
        goalId: before.state.goal.goalId,
        goalVersion: before.state.goal.version,
        mode: 'plan_template_instantiation',
        decisionSnapshot: usageSnapshot(request, materialized.candidate, before.snapshotHash),
        generatedPlanId: materialized.formalPlan.planId,
        startedAt: createdAt,
      });
      executionId = execution.artifactExecutionId;
      await this.#executions.complete({
        artifactExecutionId: execution.artifactExecutionId,
        status: 'completed',
        completedAt: this.#clock.now(),
      });

      const beforeHandoff = await this.#readCurrent(request.input);
      if (before.snapshotHash !== beforeHandoff.snapshotHash) {
        await this.#recordUsageFeedback(
          execution.artifactExecutionId,
          active.artifact,
          'discarded_stale',
          {
            before: before.snapshotHash,
            after: beforeHandoff.snapshotHash,
          },
        );
        return staleOutcome(
          instantiationId,
          request.input,
          createdAt,
          goalContext,
          materialized.candidate,
        );
      }
      assertCurrentAgainstInput(
        request,
        beforeHandoff.state,
        active.artifact,
        active.pointerLockVersion,
      );

      const session = await this.#planning.startWithMaterializedCandidate({
        taskId: request.taskId,
        userId: request.userId,
        goalSessionId: request.goalSessionId,
        confirmedContractCandidateId: request.confirmedContractCandidateId,
        goal: beforeHandoff.state.goal,
        contract: beforeHandoff.state.contract,
        plan: materialized.formalPlan,
        sourceRefs: request.sourceRefs,
        experienceHints: materialized.candidate.adaptationRefs,
        requiresManualConfirmation: materialized.requiredConfirmations.length > 0,
        planningMetadata: {
          priorities: {},
          parallelGroups: materialized.candidate.skillGoalGraph.parallelGroups,
        },
      });
      const committed = session.session.state === 'confirmed';
      await this.#recordUsageFeedback(execution.artifactExecutionId, active.artifact, 'handoff', {
        instantiationId,
        candidateId: materialized.candidate.candidateId,
        planningSessionId: session.session.sessionId,
        formalPlanId: committed ? materialized.formalPlan.planId : undefined,
        runtimeSnapshotHash: beforeHandoff.snapshotHash,
      });
      const formalHandoff: FormalPlanHandoffResult = {
        handoffId: `p08-handoff-${shortHash(`${materialized.candidate.contentHash}:${request.input.idempotencyKey}`)}`,
        planCandidateRef: materialized.candidate.candidateId,
        disposition: committed ? 'confirmed_and_committed' : 'requires_confirmation',
        formalPlanningSessionRef: session.session.sessionId,
        ...(committed
          ? {
              formalPlanRef: materialized.formalPlan.planId,
              formalPlanVersion: materialized.formalPlan.revision,
              goalLockRef: `goal-lock:${beforeHandoff.state.goal.goalId}:${String(beforeHandoff.state.goal.version)}`,
            }
          : {}),
        validationRef: `p08-validation:${materialized.formalPlan.contentHash}`,
        reasonCodes: materialized.reasonCodes,
        completedAt: this.#clock.now(),
      };
      return {
        result: {
          instantiationId,
          requestRef: request.input.requestRef,
          artifactRef: request.input.artifactRef,
          disposition:
            materialized.requiredConfirmations.length > 0
              ? 'requires_confirmation'
              : 'ready_for_validation',
          planCandidateRef: materialized.candidate.candidateId,
          missingParameters: [],
          requiredConfirmations: materialized.requiredConfirmations,
          reasonCodes: materialized.reasonCodes,
          createdAt,
        },
        goalContext,
        candidate: materialized.candidate,
        formalHandoff,
      };
    } catch (error) {
      const classified = classifyError(error);
      if (executionId !== undefined) {
        await this.#executions
          .appendFeedback({
            feedbackId: `p08-feedback-${instantiationId}`,
            artifactExecutionId: executionId,
            artifactId: request.input.artifactRef,
            feedbackType: 'template_instantiation',
            reasonCode: classified.code,
            summary: 'Template instantiation did not reach formal planning handoff.',
            impact: { disposition: classified.disposition },
            createdAt: this.#clock.now(),
          })
          .catch(() => undefined);
      }
      return {
        result: {
          instantiationId,
          requestRef: request.input.requestRef,
          artifactRef: request.input.artifactRef,
          disposition: classified.disposition,
          missingParameters: classified.missingParameters,
          requiredConfirmations: classified.requiredConfirmations,
          reasonCodes: [classified.code],
          createdAt,
        },
      };
    }
  }

  async #readCurrent(input: TemplateInstantiationInput): Promise<
    Readonly<{
      readonly state: TemplateRuntimeState;
      readonly snapshotHash: string;
    }>
  > {
    const state = await this.#states.read({
      goalContractRef: input.goalContractRef,
      goalVersion: input.goalVersion,
    });
    if (state.killSwitchActive)
      throw new TemplateRuntimeError('deny', 'TEMPLATE_KILL_SWITCH_ACTIVE');
    return {
      state,
      snapshotHash: hashJson({
        goalId: state.goal.goalId,
        goalVersion: state.goal.version,
        contract: state.contract,
        matcherSnapshotHash: state.matcherSnapshotHash,
        policySnapshotHash: state.policySnapshotHash,
        capabilityCatalogHash: state.capabilityCatalogHash,
        readinessHash: state.readinessHash,
      }),
    };
  }

  async #readActiveTemplate(
    input: TemplateInstantiationInput,
  ): Promise<Readonly<{ artifact: CompiledArtifact; pointerLockVersion: number }>> {
    const artifact = await this.#artifacts.getDefinition({
      artifactId: artifactIdFromRef(input.artifactRef, input.artifactVersion),
      version: input.artifactVersion,
    });
    if (artifact === undefined)
      throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_ARTIFACT_NOT_FOUND');
    const active = await this.#artifacts.findActiveIndex({
      ...(artifact.scope.tenantId === undefined ? {} : { tenantId: artifact.scope.tenantId }),
      artifactTypes: ['plan_template'],
      limit: 256,
    });
    const entry = active.find(
      (candidate) =>
        candidate.artifactId === artifact.artifactId &&
        candidate.artifactVersion === artifact.version,
    );
    if (entry === undefined)
      throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_ACTIVE_POINTER_STALE');
    return { artifact, pointerLockVersion: entry.pointerLockVersion };
  }

  async #recordUsageFeedback(
    executionId: string,
    artifact: CompiledArtifact,
    reasonCode: string,
    impact: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.#executions.appendFeedback({
      feedbackId: `p08-feedback-${executionId}-${reasonCode}`,
      artifactExecutionId: executionId,
      artifactId: artifact.artifactId,
      feedbackType: 'template_instantiation',
      reasonCode,
      summary: 'P08 template instantiation correlation.',
      impact,
      createdAt: this.#clock.now(),
    });
  }
}

interface Materialization {
  readonly candidate: UserGoalPlanCandidate;
  readonly formalPlan: UserGoalPlan;
  readonly requiredConfirmations: readonly string[];
  readonly reasonCodes: readonly string[];
}

function assertP07Eligibility(request: TemplateRuntimeRequest): void {
  if (
    request.decision.path !== 'template_adapt' ||
    !sameArtifactRef(request.decision.selectedArtifactRef, request.input)
  ) {
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_P07_DECISION_INELIGIBLE');
  }
  if (
    !sameArtifactRef(request.applicability.artifactRef, request.input) ||
    !request.applicability.applicable
  ) {
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_APPLICABILITY_REJECTED');
  }
  if (
    request.applicability.disposition !== 'eligible' &&
    request.applicability.disposition !== 'requires_adaptation'
  ) {
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_APPLICABILITY_DISPOSITION_INVALID');
  }
  if (
    !sameArtifactRef(request.parameterBinding.artifactRef, request.input) ||
    !sameArtifactRef(request.dependencyValidation.artifactRef, request.input) ||
    !sameArtifactRef(request.capabilityReadiness.artifactRef, request.input)
  ) {
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_P07_ARTIFACT_REF_MISMATCH');
  }
  if (!request.dependencyValidation.valid)
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_DEPENDENCY_VALIDATION_FAILED');
  if (!request.capabilityReadiness.valid)
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_CAPABILITY_READINESS_FAILED');
  if (
    request.decision.matcherSnapshotHash !== request.input.matcherSnapshotHash ||
    request.decision.policySnapshotHash !== request.input.policySnapshotHash
  ) {
    throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_P07_SNAPSHOT_MISMATCH');
  }
  if (request.parameterBinding.missingRequiredParameters.length > 0) {
    throw new TemplateRuntimeError(
      'requires_confirmation',
      'TEMPLATE_REQUIRED_PARAMETERS_MISSING',
      request.parameterBinding.missingRequiredParameters,
    );
  }
}

function assertCurrentAgainstInput(
  request: TemplateRuntimeRequest,
  state: TemplateRuntimeState,
  artifact: CompiledArtifact,
  pointerLockVersion: number,
): void {
  if (artifact.artifactType !== 'plan_template' || artifact.status !== 'active')
    throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_ARTIFACT_NOT_ACTIVE');
  if (
    artifact.version !== request.input.artifactVersion ||
    artifact.contentHash !== request.input.artifactHash ||
    pointerLockVersion !== request.input.activePointerVersion
  ) {
    throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_ARTIFACT_POINTER_OR_HASH_STALE');
  }
  if (
    state.goal.version !== request.input.goalVersion ||
    state.contract.goalVersion !== request.input.goalVersion ||
    state.goal.goalId !== state.contract.goalId
  ) {
    throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_GOAL_VERSION_STALE');
  }
  if (
    state.matcherSnapshotHash !== request.input.matcherSnapshotHash ||
    state.policySnapshotHash !== request.input.policySnapshotHash ||
    artifact.dependencySnapshot.capabilityCatalogHash !== state.capabilityCatalogHash ||
    hashJson(request.capabilityReadiness) !== state.readinessHash
  ) {
    throw new TemplateRuntimeError('discarded_stale', 'TEMPLATE_RUNTIME_SNAPSHOT_STALE');
  }
}

function materializeCandidate(
  request: TemplateRuntimeRequest,
  state: TemplateRuntimeState,
  artifact: CompiledArtifact,
  goalContext: GoalContextSnapshot,
  instantiationId: string,
): Materialization {
  if (!isPlanTemplateDefinition(artifact.definition))
    throw new TemplateRuntimeError('failed', 'TEMPLATE_DEFINITION_INVALID');
  const definition = artifact.definition;
  const bindings = validateBindings(definition, request.parameterBinding, request.decision);
  const criterionMap = criterionMapping(definition, state.contract);
  const nodes = materializeNodes(definition, bindings.values, criterionMap, state.contract);
  const dependencies = materializeDependencies(definition);
  assertDag(nodes, dependencies);
  const parallelGroups = parallelGroupsFor(nodes);
  const recoveryBranches = materializeRecoveryBranches(definition, bindings.values);
  const coverage = criterionCoverage(nodes, state.contract);
  if (coverage.missingCriterionRefs.length > 0)
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_REQUIRED_CRITERION_UNCOVERED');
  const completionContract = materializeCompletion(definition, bindings.values, state.contract);
  const runtimeSnapshotHash = hashJson({
    artifactRef: artifact.artifactId,
    artifactVersion: artifact.version,
    artifactHash: artifact.contentHash,
    goalContextHash: goalContext.contentHash,
    policySnapshotHash: state.policySnapshotHash,
    capabilityCatalogHash: state.capabilityCatalogHash,
  });
  const adaptationRefs = [
    ...(request.applicability.disposition === 'requires_adaptation'
      ? [`adaptation:applicability:${request.input.applicabilityRef}`]
      : []),
    ...bindings.candidateNames.map((name) => `adaptation:candidate_binding:${name}`),
  ];
  const candidateWithoutHash = {
    candidateId: `p08-candidate-${shortHash(`${instantiationId}:${artifact.contentHash}`)}`,
    goalContractRef: request.input.goalContractRef,
    goalVersion: state.contract.goalVersion,
    sourceArtifactRef: artifact.artifactId,
    sourceArtifactVersion: artifact.version,
    sourceArtifactHash: artifact.contentHash,
    parameterBindings: bindings.values,
    skillGoalGraph: { nodes, dependencies, parallelGroups },
    completionContract,
    recoveryBranches,
    criterionCoverage: coverage,
    adaptationRefs,
    runtimeSnapshotHash,
  } as const;
  const candidate: UserGoalPlanCandidate = {
    ...candidateWithoutHash,
    contentHash: hashJson(candidateWithoutHash),
  };
  const formalPlanWithoutHash = {
    schemaVersion: '1.0' as const,
    planId: `p08-plan-${shortHash(`${candidate.candidateId}:${runtimeSnapshotHash}`)}`,
    goalId: state.contract.goalId,
    goalVersion: state.contract.goalVersion,
    revision: 1,
    revisionKind: 'initial' as const,
    status: 'validated' as const,
    contractHash: hashJson(state.contract),
    skillGoals: nodes.map((node) => toFormalSkillGoal(node, recoveryBranches)),
    dependencies: dependencies.map((dependency) => ({
      dependencyId: `p08-${dependency.dependencyKey}`,
      predecessorSkillGoalId: `p08-node-${dependency.predecessorNodeKey}`,
      successorSkillGoalId: `p08-node-${dependency.successorNodeKey}`,
      predicate: dependency.predicate,
    })),
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: request.decision.createdAt,
  };
  const formalPlan: UserGoalPlan = {
    ...formalPlanWithoutHash,
    contentHash: hashJson(formalPlanWithoutHash),
  };
  const requiredConfirmations = unique([
    ...request.decision.requiredConfirmations,
    ...request.parameterBinding.requiresConfirmation,
    ...(request.applicability.disposition === 'requires_adaptation' ? ['template_adaptation'] : []),
    ...bindings.candidateNames.map((name) => `candidate_parameter:${name}`),
    ...nodes
      .filter((node) => node.nodeType === 'human_gate')
      .map((node) => `human_gate:${node.nodeKey}`),
  ]);
  return {
    candidate,
    formalPlan,
    requiredConfirmations,
    reasonCodes: unique([
      ...request.decision.reasonCodes,
      ...request.applicability.reasonCodes,
      ...request.dependencyValidation.reasonCodes,
      ...request.capabilityReadiness.reasonCodes,
      ...(adaptationRefs.length === 0 ? [] : ['TEMPLATE_BOUNDED_ADAPTATION_RECORDED']),
    ]),
  };
}

function validateBindings(
  definition: PlanTemplateArtifactDefinition,
  result: ParameterBindingResult,
  decision: RuntimeExecutionDecision,
): Readonly<{ values: Readonly<Record<string, JsonValue>>; candidateNames: readonly string[] }> {
  const values: Record<string, JsonValue> = {};
  const candidateNames: string[] = [];
  for (const parameter of definition.parameterBindings) {
    const binding = result.bindings[parameter.parameterName];
    if (binding === undefined) {
      if (parameter.required)
        throw new TemplateRuntimeError(
          'requires_confirmation',
          'TEMPLATE_REQUIRED_PARAMETER_UNBOUND',
          [parameter.parameterName],
        );
      continue;
    }
    const decisionBinding = decision.parameterBindings[parameter.parameterName];
    if (decisionBinding === undefined || hashJson(decisionBinding) !== hashJson(binding))
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_PARAMETER_BINDING_DECISION_MISMATCH');
    if (binding.source !== parameter.allowedSources)
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_PARAMETER_SOURCE_FORBIDDEN');
    if (trustRank(binding.trust) < trustRank(parameter.trustLevel))
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_PARAMETER_TRUST_INSUFFICIENT');
    if (!matchesSchema(binding.value, parameter.schema))
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_PARAMETER_SCHEMA_INVALID');
    values[parameter.parameterName] = binding.value;
    if (binding.trust === 'candidate') candidateNames.push(parameter.parameterName);
  }
  return { values: Object.freeze(values), candidateNames: Object.freeze(candidateNames.sort()) };
}

function criterionMapping(
  definition: PlanTemplateArtifactDefinition,
  contract: UserGoalCompletionContract,
): ReadonlyMap<string, string> {
  const template = definition.completionContractTemplate.criteria;
  const requiredTemplate = template.filter((criterion) => criterion.required);
  const requiredGoal = contract.criteria.filter((criterion) => criterion.required);
  if (requiredTemplate.length !== requiredGoal.length)
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_GOAL_REQUIRED_CRITERIA_MISMATCH');
  const optionalTemplate = template.filter((criterion) => !criterion.required);
  const optionalGoal = contract.criteria.filter((criterion) => !criterion.required);
  if (optionalTemplate.length > optionalGoal.length)
    throw new TemplateRuntimeError('fallback', 'TEMPLATE_GOAL_OPTIONAL_CRITERIA_MISMATCH');
  const mapped = new Map<string, string>();
  requiredTemplate.forEach((criterion, index) => {
    const goal = requiredGoal[index];
    if (goal === undefined)
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_CRITERION_MAPPING_MISSING');
    mapped.set(criterion.criterionTemplateId, goal.criterionId);
  });
  optionalTemplate.forEach((criterion, index) => {
    const goal = optionalGoal[index];
    if (goal === undefined)
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_CRITERION_MAPPING_MISSING');
    mapped.set(criterion.criterionTemplateId, goal.criterionId);
  });
  return mapped;
}

function materializeNodes(
  definition: PlanTemplateArtifactDefinition,
  bindings: Readonly<Record<string, JsonValue>>,
  criteria: ReadonlyMap<string, string>,
  contract: UserGoalCompletionContract,
): readonly MaterializedSkillGoalNode[] {
  return definition.skillGoalGraph.nodes.map((node) => {
    const coveredCriterionRefs = node.coveredCriterionTemplateIds.map((templateId) => {
      const criterion = criteria.get(templateId);
      if (criterion === undefined)
        throw new TemplateRuntimeError('fallback', 'TEMPLATE_NODE_CRITERION_MAPPING_MISSING');
      return criterion;
    });
    const linked = contract.criteria.filter((criterion) =>
      coveredCriterionRefs.includes(criterion.criterionId),
    );
    return {
      nodeKey: node.nodeKey,
      nodeType: node.nodeType,
      objective: renderText(node.objectiveTemplate, bindings),
      requiredCapabilities: unique(node.requiredCapabilities),
      requiredEffectRefs: unique([
        ...node.requiredEffectRefs,
        ...linked.flatMap((item) => item.expectedEffectRefs),
      ]),
      coveredCriterionRefs: unique(coveredCriterionRefs),
      evidenceRequirements: unique([
        ...node.evidenceRequirements,
        ...linked.flatMap((item) => item.evidenceRequirements),
      ]),
      artifactRequirements: unique([
        ...node.artifactRequirements,
        ...linked.flatMap((item) => item.artifactRequirements),
      ]),
      input: renderJson(node.inputTemplate, bindings),
      assumptionsAllowed: unique(node.assumptionsAllowed),
      constraints: unique(node.constraints),
    };
  });
}

function materializeDependencies(
  definition: PlanTemplateArtifactDefinition,
): readonly MaterializedDependency[] {
  const nodeKeys = new Set(definition.skillGoalGraph.nodes.map((node) => node.nodeKey));
  return definition.skillGoalGraph.dependencies.map((dependency) => {
    if (
      !nodeKeys.has(dependency.predecessorNodeKey) ||
      !nodeKeys.has(dependency.successorNodeKey) ||
      dependency.predecessorNodeKey === dependency.successorNodeKey
    ) {
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_DAG_NODE_REFERENCE_INVALID');
    }
    if (dependency.predicate === 'optional' && dependency.condition === undefined)
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_CONDITIONAL_EDGE_MISSING');
    return {
      dependencyKey: dependency.dependencyKey,
      predecessorNodeKey: dependency.predecessorNodeKey,
      successorNodeKey: dependency.successorNodeKey,
      predicate: dependency.predicate,
      ...(dependency.condition === undefined ? {} : { condition: dependency.condition }),
    };
  });
}

function materializeRecoveryBranches(
  definition: PlanTemplateArtifactDefinition,
  bindings: Readonly<Record<string, JsonValue>>,
): readonly MaterializedRecoveryBranch[] {
  return definition.recoveryBranches.map((branch) => {
    if (
      branch.maximumApplications < 1 ||
      (branch.sideEffectReplayPolicy === 'explicitly_safe' && branch.maximumApplications > 1)
    ) {
      throw new TemplateRuntimeError('fallback', 'TEMPLATE_RECOVERY_REPLAY_POLICY_UNSAFE');
    }
    return {
      trigger: branch.trigger,
      requiredCapabilities: unique(branch.requiredCapabilities),
      planPatch: renderJson(branch.planPatchTemplate, bindings),
      maximumApplications: branch.maximumApplications,
      sideEffectReplayPolicy: branch.sideEffectReplayPolicy,
    };
  });
}

function materializeCompletion(
  definition: PlanTemplateArtifactDefinition,
  bindings: Readonly<Record<string, JsonValue>>,
  contract: UserGoalCompletionContract,
): MaterializedCompletionContract {
  const required = contract.criteria.filter((criterion) => criterion.required);
  return {
    title: renderText(definition.completionContractTemplate.titleTemplate, bindings),
    description: renderText(definition.completionContractTemplate.descriptionTemplate, bindings),
    requiredCriterionRefs: required.map((criterion) => criterion.criterionId),
    evidenceRequirementRefs: unique([
      ...definition.completionContractTemplate.evidenceRequirements,
      ...required.flatMap((criterion) => criterion.evidenceRequirements),
    ]),
    artifactRequirementRefs: unique([
      ...definition.completionContractTemplate.artifactRequirements,
      ...required.flatMap((criterion) => criterion.artifactRequirements),
    ]),
  };
}

function criterionCoverage(
  nodes: readonly MaterializedSkillGoalNode[],
  contract: UserGoalCompletionContract,
): UserGoalPlanCandidate['criterionCoverage'] {
  const requiredCriterionRefs = contract.criteria
    .filter((criterion) => criterion.required)
    .map((criterion) => criterion.criterionId);
  const coveredCriterionRefs = unique(nodes.flatMap((node) => node.coveredCriterionRefs));
  return {
    requiredCriterionRefs,
    coveredCriterionRefs,
    missingCriterionRefs: requiredCriterionRefs.filter(
      (criterion) => !coveredCriterionRefs.includes(criterion),
    ),
  };
}

function toFormalSkillGoal(
  node: MaterializedSkillGoalNode,
  recoveryBranches: readonly MaterializedRecoveryBranch[],
): SkillGoal {
  const recoveryConstraints = recoveryBranches.map((branch) => `p08-recovery:${hashJson(branch)}`);
  return {
    skillGoalId: `p08-node-${node.nodeKey}`,
    requiredResult: node.objective,
    capabilityNeeds: node.requiredCapabilities,
    coveredCriterionIds: node.coveredCriterionRefs,
    requiredEffectRefs: node.requiredEffectRefs,
    evidenceRequirements: node.evidenceRequirements,
    artifactRequirements: node.artifactRequirements,
    assumptions: node.assumptionsAllowed,
    constraints: unique([
      ...node.constraints,
      `p08-node-type:${node.nodeType}`,
      `p08-input:${hashJson(node.input)}`,
      ...recoveryConstraints,
    ]),
    status: 'pending',
  };
}

function parallelGroupsFor(
  nodes: readonly MaterializedSkillGoalNode[],
): Readonly<Record<string, readonly string[]>> {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    for (const constraint of node.constraints) {
      const match = /^parallel-group:([\x21-\x7E]{1,128})$/u.exec(constraint);
      if (match?.[1] === undefined) continue;
      const existing = groups.get(match[1]) ?? [];
      existing.push(node.nodeKey);
      groups.set(match[1], existing);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      [...groups.entries()].map(([group, nodeKeys]) => [group, Object.freeze(unique(nodeKeys))]),
    ),
  );
}

function assertDag(
  nodes: readonly MaterializedSkillGoalNode[],
  dependencies: readonly MaterializedDependency[],
): void {
  const inbound = new Map(nodes.map((node) => [node.nodeKey, 0]));
  const outgoing = new Map(nodes.map((node) => [node.nodeKey, [] as string[]]));
  for (const dependency of dependencies) {
    inbound.set(dependency.successorNodeKey, (inbound.get(dependency.successorNodeKey) ?? 0) + 1);
    outgoing.get(dependency.predecessorNodeKey)?.push(dependency.successorNodeKey);
  }
  const queue = [...inbound].filter(([, count]) => count === 0).map(([nodeKey]) => nodeKey);
  let visited = 0;
  for (const nodeKey of queue) {
    visited += 1;
    for (const successor of outgoing.get(nodeKey) ?? []) {
      const next = (inbound.get(successor) ?? 0) - 1;
      inbound.set(successor, next);
      if (next === 0) queue.push(successor);
    }
  }
  if (visited !== nodes.length) throw new TemplateRuntimeError('fallback', 'TEMPLATE_DAG_CYCLE');
}

function usageSnapshot(
  request: TemplateRuntimeRequest,
  candidate: UserGoalPlanCandidate,
  runtimeSnapshotHash: string,
): Readonly<Record<string, unknown>> {
  return {
    p08: true,
    instantiationRequestRef: request.input.requestRef,
    artifactHash: request.input.artifactHash,
    candidateHash: candidate.contentHash,
    runtimeSnapshotHash,
    parameterBindingHash: hashJson(request.parameterBinding.bindings),
    adaptationRefs: candidate.adaptationRefs,
  };
}

function staleOutcome(
  instantiationId: string,
  input: TemplateInstantiationInput,
  createdAt: string,
  goalContext: GoalContextSnapshot,
  candidate: UserGoalPlanCandidate,
): TemplateRuntimeOutcome {
  return {
    result: {
      instantiationId,
      requestRef: input.requestRef,
      artifactRef: input.artifactRef,
      disposition: 'discarded_stale',
      planCandidateRef: candidate.candidateId,
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: ['TEMPLATE_RUNTIME_SNAPSHOT_STALE'],
      createdAt,
    },
    goalContext,
    candidate,
    formalHandoff: {
      handoffId: `p08-handoff-${shortHash(`${candidate.contentHash}:${input.idempotencyKey}`)}`,
      planCandidateRef: candidate.candidateId,
      disposition: 'discarded_stale',
      reasonCodes: ['TEMPLATE_RUNTIME_SNAPSHOT_STALE'],
      completedAt: createdAt,
    },
  };
}

function goalContextSnapshot(
  input: TemplateInstantiationInput,
  state: TemplateRuntimeState,
  artifact: CompiledArtifact,
): GoalContextSnapshot {
  const required = state.contract.criteria.filter((criterion) => criterion.required);
  const optional = state.contract.criteria.filter((criterion) => !criterion.required);
  const context = {
    goalContractRef: input.goalContractRef,
    goalVersion: state.contract.goalVersion,
    objective: state.contract.description,
    requiredCriterionRefs: Object.freeze(required.map((criterion) => criterion.criterionId)),
    optionalCriterionRefs: Object.freeze(optional.map((criterion) => criterion.criterionId)),
    evidenceRequirementRefs: Object.freeze(
      unique(required.flatMap((criterion) => criterion.evidenceRequirements)),
    ),
    artifactRequirementRefs: Object.freeze(
      unique(required.flatMap((criterion) => criterion.artifactRequirements)),
    ),
    targetScope: Object.freeze({ contextId: state.goal.contextId }),
    constraints: Object.freeze([...state.goal.constraints]),
    authorizationRefs: Object.freeze([]),
    riskLevel: artifact.riskLevel,
  } as const;
  return Object.freeze({ ...context, contentHash: hashJson(context) });
}

class TemplateRuntimeError extends Error {
  readonly disposition: TemplateInstantiationResult['disposition'];
  readonly code: string;
  readonly missingParameters: readonly string[];
  readonly requiredConfirmations: readonly string[];

  constructor(
    disposition: TemplateInstantiationResult['disposition'],
    code: string,
    missingParameters: readonly string[] = [],
    requiredConfirmations: readonly string[] = [],
  ) {
    super(code);
    this.name = 'TemplateRuntimeError';
    this.disposition = disposition;
    this.code = code;
    this.missingParameters = missingParameters;
    this.requiredConfirmations = requiredConfirmations;
  }
}

function classifyError(error: unknown): TemplateRuntimeError {
  return error instanceof TemplateRuntimeError
    ? error
    : new TemplateRuntimeError('failed', 'TEMPLATE_RUNTIME_FAILED');
}

function isPlanTemplateDefinition(
  value: CompiledArtifact['definition'],
): value is PlanTemplateArtifactDefinition {
  return (
    'skillGoalGraph' in value &&
    'parameterBindings' in value &&
    'completionContractTemplate' in value
  );
}

function artifactIdFromRef(ref: string, version: number): string {
  const suffix = `:${String(version)}`;
  return ref.endsWith(suffix) ? ref.slice(0, -suffix.length) : ref;
}

function sameArtifactRef(ref: string | undefined, input: TemplateInstantiationInput): boolean {
  if (ref === undefined) return false;
  return (
    ref === input.artifactRef ||
    ref ===
      `${artifactIdFromRef(input.artifactRef, input.artifactVersion)}:${String(input.artifactVersion)}`
  );
}

function renderText(template: string, bindings: Readonly<Record<string, JsonValue>>): string {
  return template.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/gu, (_match, name: string) => {
    const value = bindings[name];
    if (value === undefined)
      throw new TemplateRuntimeError('requires_confirmation', 'TEMPLATE_PARAMETER_UNRESOLVED', [
        name,
      ]);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function renderJson(value: JsonValue, bindings: Readonly<Record<string, JsonValue>>): JsonValue {
  if (typeof value === 'string') {
    const onlyParameter = /^\{\{([A-Za-z0-9_.-]+)\}\}$/u.exec(value);
    if (onlyParameter?.[1] !== undefined) {
      const bound = bindings[onlyParameter[1]];
      if (bound === undefined)
        throw new TemplateRuntimeError('requires_confirmation', 'TEMPLATE_PARAMETER_UNRESOLVED', [
          onlyParameter[1],
        ]);
      return bound;
    }
    return renderText(value, bindings);
  }
  if (isJsonArray(value)) return value.map((item) => renderJson(item, bindings));
  if (isJsonObject(value)) {
    const rendered: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child === undefined)
        throw new TemplateRuntimeError('failed', 'TEMPLATE_JSON_VALUE_UNDEFINED');
      rendered[key] = renderJson(child, bindings);
    }
    return rendered;
  }
  return value;
}

function matchesSchema(value: JsonValue, schema: JsonValue): boolean {
  if (!isJsonObject(schema)) return true;
  const allowed = schema['enum'];
  if (
    Array.isArray(allowed) &&
    !allowed.some((candidate) => hashJson(candidate) === hashJson(value))
  )
    return false;
  const expectedType = schema['type'];
  if (expectedType === undefined) return true;
  if (expectedType === 'string') return typeof value === 'string';
  if (expectedType === 'number') return typeof value === 'number';
  if (expectedType === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'null') return value === null;
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return isJsonObject(value);
  return false;
}

function trustRank(value: ParameterBindingTrust): number {
  if (value === 'authoritative') return 3;
  if (value === 'trusted') return 2;
  return 1;
}

function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
