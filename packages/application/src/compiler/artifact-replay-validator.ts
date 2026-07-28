import { createHash } from 'node:crypto';

import {
  createArtifactCounterexample,
  createArtifactValidationFailure,
  createArtifactValidationResult,
  validateUserGoalPlan,
  type ArtifactCounterexample,
  type ArtifactReplayCase,
  type ArtifactValidationFailure,
  type ArtifactValidationFailureCategory,
  type ArtifactValidationResult,
  type CandidateStaticValidationResult,
  type CompiledArtifact,
  type PlanTemplateArtifactDefinition,
  type ReplayDatasetManifest,
  type UserGoalCompletionContract,
  type UserGoalPlan,
} from '../../../domain/src/index.js';
import { VALIDATION_METRIC_CATALOG_VERSION, ValidationMetricCatalog } from './replay-metrics.js';

export const ARTIFACT_REPLAY_VALIDATOR_VERSION = 'sdar-artifact-replay-validator/1.1' as const;

export type ReplayAuthorityDecision = 'allow' | 'deny' | 'require_confirmation';

export interface HistoricalReplayOutcome {
  readonly succeeded: boolean;
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly activityRefs: readonly string[];
  readonly modelCallCount: number;
  readonly tokenInput: number;
  readonly tokenOutput: number;
  readonly estimatedCostUnits: number;
  readonly humanInteractionCount: number;
  readonly fallbackCount: number;
  readonly userPatchCount: number;
  readonly planningLatencyMs: number;
}

export interface PlanReplayInput {
  readonly validationRunId: string;
  readonly replayCase: ArtifactReplayCase;
  readonly artifact: CompiledArtifact;
  readonly staticValidation: CandidateStaticValidationResult;
  readonly goalContract: UserGoalCompletionContract;
  readonly parameterValues: Readonly<Record<string, unknown>>;
  readonly knownCapabilityIds: readonly string[];
  readonly readyCapabilityIds: readonly string[];
  readonly authorityDecision: ReplayAuthorityDecision;
  readonly historical: HistoricalReplayOutcome;
  readonly acceptedPlan?: UserGoalPlan;
  readonly evaluatedAt: string;
}

export interface PlanReplayEvaluation {
  readonly replayCaseRef: string;
  readonly plan?: UserGoalPlan;
  readonly metrics: Readonly<Record<string, number>>;
  readonly failures: readonly ArtifactValidationFailure[];
  readonly counterexamples: readonly ArtifactCounterexample[];
  readonly candidateAccepted: boolean;
  readonly physicalOutcomeClaim: 'unknown';
}

export interface RuleReplayInput {
  readonly authorityDecision: ReplayAuthorityDecision;
  readonly candidateDecision: ReplayAuthorityDecision;
  readonly candidateHasHumanGate: boolean;
}

export interface RuleReplayEvaluation {
  readonly truePositive: number;
  readonly trueNegative: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
  readonly unsafeAllow: number;
  readonly missedConfirmation: number;
}

export interface CounterfactualReplayInput {
  readonly candidatePlan: UserGoalPlan;
  readonly acceptedPlan?: UserGoalPlan;
  readonly historical: HistoricalReplayOutcome;
}

export interface CounterfactualReplayEvaluation {
  readonly planEditDistance: number;
  readonly planNodeDelta: number;
  readonly candidateHumanGateCount: number;
  readonly historicalHumanInteractionCount: number;
  readonly historicalModelCallCount: number;
  readonly historicalTokenInput: number;
  readonly historicalTokenOutput: number;
  readonly historicalEstimatedCostUnits: number;
  readonly physicalOutcomeClaim: 'unknown';
}

export interface ArtifactReplayValidationInput {
  readonly validationRunId: string;
  readonly artifact: CompiledArtifact;
  readonly dataset: ReplayDatasetManifest;
  readonly evaluations: readonly PlanReplayEvaluation[];
  readonly completedAt: string;
}

export interface ArtifactReplayValidationOutput {
  readonly result: ArtifactValidationResult;
  readonly failures: readonly ArtifactValidationFailure[];
  readonly counterexamples: readonly ArtifactCounterexample[];
}

export class PlanReplayEvaluator {
  evaluate(input: PlanReplayInput): PlanReplayEvaluation {
    const failures: ArtifactValidationFailure[] = [];
    const artifactRef = `${input.artifact.artifactId}:v${String(input.artifact.version)}`;
    const fail = (
      category: ArtifactValidationFailureCategory,
      severity: ArtifactValidationFailure['severity'],
      explanation: string,
      expectedRef?: string,
      actualRef?: string,
    ): void => {
      failures.push(
        createFailure({
          runId: input.validationRunId,
          replayCase: input.replayCase,
          category,
          severity,
          explanation,
          ...(expectedRef === undefined ? {} : { expectedRef }),
          ...(actualRef === undefined ? {} : { actualRef }),
        }),
      );
    };

    if (input.artifact.artifactType !== 'plan_template' || input.artifact.status !== 'candidate') {
      fail(
        'schema',
        'critical',
        'Replay accepts only immutable plan-template Candidates.',
        'artifact:plan_template:candidate',
        artifactRef,
      );
      return finishEvaluation(input, undefined, failures);
    }
    if (!staticValidationPassed(input.staticValidation, input.artifact.artifactId)) {
      fail(
        'schema',
        'critical',
        'The canonical P04 static validator did not pass every V1.2 gate.',
        'static:passed_static',
        input.staticValidation.artifactRef,
      );
      return finishEvaluation(input, undefined, failures);
    }

    const definition = input.artifact.definition as PlanTemplateArtifactDefinition;
    if (input.replayCase.snapshotCompleteness < 1) {
      fail(
        'snapshot_incomplete',
        'major',
        'Replay Case is incomplete; missing history is never filled from current state.',
        'snapshot-completeness:1',
        `snapshot-completeness:${String(input.replayCase.snapshotCompleteness)}`,
      );
    }
    const requiredEvidence = uniqueSorted(
      input.goalContract.criteria.flatMap((criterion) => [...criterion.evidenceRequirements]),
    );
    const candidateEvidence = new Set(
      definition.skillGoalGraph.nodes.flatMap((node) => [...node.evidenceRequirements]),
    );
    for (const evidenceRef of requiredEvidence) {
      if (!candidateEvidence.has(evidenceRef)) {
        fail(
          'criterion_coverage',
          'major',
          `Required evidence ${evidenceRef} is not produced by the Candidate plan.`,
          `evidence:${evidenceRef}`,
        );
      }
    }
    const requiredArtifacts = uniqueSorted(
      input.goalContract.criteria.flatMap((criterion) => [...criterion.artifactRequirements]),
    );
    const candidateArtifacts = new Set(
      definition.skillGoalGraph.nodes.flatMap((node) => [...node.artifactRequirements]),
    );
    for (const artifactRequirement of requiredArtifacts) {
      if (!candidateArtifacts.has(artifactRequirement)) {
        fail(
          'criterion_coverage',
          'major',
          `Required artifact ${artifactRequirement} is not produced by the Candidate plan.`,
          `artifact-requirement:${artifactRequirement}`,
        );
      }
    }
    const missingParameters = definition.parameterBindings
      .filter((binding) => binding.required)
      .filter(
        (binding) =>
          !Object.prototype.hasOwnProperty.call(input.parameterValues, binding.parameterName),
      );
    for (const binding of missingParameters) {
      fail(
        'plan_invalid',
        'major',
        `Required parameter ${binding.parameterName} is absent from the historical snapshot.`,
        `parameter:${binding.parameterName}`,
      );
    }

    const requiredCapabilities = uniqueSorted([
      ...input.artifact.requiredCapabilities.map((item) => item.capabilityId),
      ...definition.skillGoalGraph.nodes.flatMap((node) => [...node.requiredCapabilities]),
    ]);
    const known = new Set(input.knownCapabilityIds);
    const ready = new Set(input.readyCapabilityIds);
    for (const capabilityId of requiredCapabilities) {
      if (!known.has(capabilityId)) {
        fail(
          'capability_gap',
          'major',
          `Required capability ${capabilityId} is absent from the frozen catalog snapshot.`,
          `capability:${capabilityId}`,
        );
      } else if (!ready.has(capabilityId)) {
        fail(
          'readiness_gap',
          'major',
          `Required capability ${capabilityId} was not ready in the frozen readiness snapshot.`,
          `readiness:${capabilityId}`,
        );
      }
    }

    let plan: UserGoalPlan | undefined;
    try {
      plan = materializePlan(input.artifact, definition, input.goalContract, input.evaluatedAt);
      validateUserGoalPlan(input.goalContract, plan);
    } catch (error) {
      fail(
        'plan_invalid',
        'critical',
        `Existing plan validator rejected the replayed Candidate: ${errorSummary(error)}`,
        `goal-contract:${input.goalContract.goalId}:v${String(input.goalContract.goalVersion)}`,
        artifactRef,
      );
    }

    const candidateHasAction = definition.skillGoalGraph.nodes.some(
      (node) => node.nodeType === 'action' || node.nodeType === 'recovery',
    );
    const candidateHasHumanGate = definition.skillGoalGraph.nodes.some(
      (node) => node.nodeType === 'human_gate',
    );
    const candidateDecision: ReplayAuthorityDecision =
      candidateHasHumanGate && input.authorityDecision === 'require_confirmation'
        ? 'require_confirmation'
        : candidateHasAction
          ? 'allow'
          : 'deny';
    const rule = new RuleReplayEvaluator().evaluate({
      authorityDecision: input.authorityDecision,
      candidateDecision,
      candidateHasHumanGate,
    });
    if (rule.unsafeAllow > 0) {
      fail(
        'unsafe_allow',
        'critical',
        'Candidate would allow an action that the frozen policy snapshot denies.',
        `policy:${input.authorityDecision}`,
        `candidate:${candidateDecision}`,
      );
    }
    if (rule.missedConfirmation > 0) {
      fail(
        'missed_confirmation',
        'critical',
        'Candidate omitted a human gate required by the frozen policy snapshot.',
        'policy:require_confirmation',
        `candidate:${candidateDecision}`,
      );
    }

    return finishEvaluation(input, plan, failures, rule);
  }
}

export class RuleReplayEvaluator {
  evaluate(input: RuleReplayInput): RuleReplayEvaluation {
    const authorityPositive = input.authorityDecision === 'allow';
    const candidatePositive = input.candidateDecision === 'allow';
    const unsafeAllow = input.authorityDecision === 'deny' && candidatePositive ? 1 : 0;
    const missedConfirmation =
      input.authorityDecision === 'require_confirmation' &&
      (!input.candidateHasHumanGate || input.candidateDecision !== 'require_confirmation')
        ? 1
        : 0;
    return Object.freeze({
      truePositive: authorityPositive && candidatePositive ? 1 : 0,
      trueNegative: !authorityPositive && !candidatePositive ? 1 : 0,
      falsePositive: !authorityPositive && candidatePositive ? 1 : 0,
      falseNegative: authorityPositive && !candidatePositive ? 1 : 0,
      unsafeAllow,
      missedConfirmation,
    });
  }
}

export class CounterfactualReplayEvaluator {
  evaluate(input: CounterfactualReplayInput): CounterfactualReplayEvaluation {
    return Object.freeze({
      planEditDistance:
        input.acceptedPlan === undefined
          ? input.candidatePlan.skillGoals.length
          : planEditDistance(input.candidatePlan, input.acceptedPlan),
      planNodeDelta:
        input.candidatePlan.skillGoals.length - (input.acceptedPlan?.skillGoals.length ?? 0),
      candidateHumanGateCount: input.candidatePlan.skillGoals.filter((goal) =>
        goal.capabilityNeeds.includes('human_confirmation'),
      ).length,
      historicalHumanInteractionCount: input.historical.humanInteractionCount,
      historicalModelCallCount: input.historical.modelCallCount,
      historicalTokenInput: input.historical.tokenInput,
      historicalTokenOutput: input.historical.tokenOutput,
      historicalEstimatedCostUnits: input.historical.estimatedCostUnits,
      physicalOutcomeClaim: 'unknown' as const,
    });
  }
}

export class CaseReplayContract {
  assertEvaluation(evaluation: PlanReplayEvaluation): void {
    if (evaluation.metrics['side_effect_attempt_count'] !== 0) {
      throw new Error('REPLAY_SIDE_EFFECT_ATTEMPT_PRESENT');
    }
  }
}

export class ArtifactReplayValidationEngine {
  constructor(
    private readonly metricCatalog: ValidationMetricCatalog = new ValidationMetricCatalog(),
    private readonly caseContract: CaseReplayContract = new CaseReplayContract(),
  ) {}

  validate(input: ArtifactReplayValidationInput): ArtifactReplayValidationOutput {
    if (input.evaluations.length === 0) throw new Error('REPLAY_EVALUATIONS_REQUIRED');
    if (
      input.dataset.caseRefs.length !== input.evaluations.length ||
      input.evaluations.some(
        (evaluation) => !input.dataset.caseRefs.includes(evaluation.replayCaseRef),
      )
    ) {
      throw new Error('REPLAY_DATASET_CASE_ALIGNMENT_INVALID');
    }
    for (const evaluation of input.evaluations) this.caseContract.assertEvaluation(evaluation);

    const failures = input.evaluations.flatMap((evaluation) => [...evaluation.failures]);
    const counterexamples = input.evaluations.flatMap((evaluation) => [
      ...evaluation.counterexamples,
    ]);
    const metrics = aggregateMetrics(input.evaluations);
    this.metricCatalog.validate(metrics);

    const unsafe =
      (metrics['unsafe_allow_count'] ?? 0) > 0 ||
      (metrics['missed_confirmation_count'] ?? 0) > 0 ||
      (metrics['side_effect_attempt_count'] ?? 0) > 0;
    const needsMoreData = failures.some((failure) => failure.category === 'snapshot_incomplete');
    const result = unsafe
      ? ('unsafe' as const)
      : needsMoreData
        ? ('needs_more_data' as const)
        : failures.length > 0
          ? ('failed' as const)
          : ('passed' as const);
    const resultIdentity = {
      validationRunId: input.validationRunId,
      artifactRef: `${input.artifact.artifactId}:v${String(input.artifact.version)}`,
      datasetRef: `${input.dataset.datasetId}:v${String(input.dataset.datasetVersion)}`,
      validationType: 'replay' as const,
      metrics,
      failureRefs: failures.map((failure) => failure.failureId).sort(),
      counterexampleRefs: counterexamples
        .map((counterexample) => counterexample.counterexampleId)
        .sort(),
      unsafe,
      result,
      validatorVersion: ARTIFACT_REPLAY_VALIDATOR_VERSION,
      metricCatalogVersion: VALIDATION_METRIC_CATALOG_VERSION,
      artifactHash: input.artifact.contentHash,
      datasetHash: input.dataset.contentHash,
    };
    const validationResult = createArtifactValidationResult({
      ...resultIdentity,
      resultHash: hash(resultIdentity),
      completedAt: input.completedAt,
    });
    return Object.freeze({
      result: validationResult,
      failures: Object.freeze(failures),
      counterexamples: Object.freeze(counterexamples),
    });
  }
}

function finishEvaluation(
  input: PlanReplayInput,
  plan: UserGoalPlan | undefined,
  failures: readonly ArtifactValidationFailure[],
  rule: RuleReplayEvaluation = new RuleReplayEvaluator().evaluate({
    authorityDecision: input.authorityDecision,
    candidateDecision: 'deny',
    candidateHasHumanGate: false,
  }),
): PlanReplayEvaluation {
  const definition =
    input.artifact.artifactType === 'plan_template'
      ? (input.artifact.definition as PlanTemplateArtifactDefinition)
      : undefined;
  const requiredCriteria = input.goalContract.criteria.filter((item) => item.required);
  const coveredCriteria = new Set(
    definition?.skillGoalGraph.nodes.flatMap((node) => [...node.coveredCriterionTemplateIds]) ?? [],
  );
  const requiredEvidence = uniqueSorted(
    input.goalContract.criteria.flatMap((criterion) => [...criterion.evidenceRequirements]),
  );
  const candidateEvidence = new Set(
    definition?.skillGoalGraph.nodes.flatMap((node) => [...node.evidenceRequirements]) ?? [],
  );
  const requiredArtifacts = uniqueSorted(
    input.goalContract.criteria.flatMap((criterion) => [...criterion.artifactRequirements]),
  );
  const candidateArtifacts = new Set(
    definition?.skillGoalGraph.nodes.flatMap((node) => [...node.artifactRequirements]) ?? [],
  );
  const missingParameterCount =
    definition?.parameterBindings.filter(
      (binding) =>
        binding.required &&
        !Object.prototype.hasOwnProperty.call(input.parameterValues, binding.parameterName),
    ).length ?? 0;
  const requiredCapabilities = uniqueSorted([
    ...(definition?.skillGoalGraph.nodes.flatMap((node) => [...node.requiredCapabilities]) ?? []),
    ...input.artifact.requiredCapabilities.map((item) => item.capabilityId),
  ]);
  const known = new Set(input.knownCapabilityIds);
  const ready = new Set(input.readyCapabilityIds);
  const candidateAccepted =
    plan !== undefined && failures.every((failure) => failure.severity === 'info');
  const historicalMatches =
    input.historical.succeeded === candidateAccepted ||
    (!input.historical.succeeded && failures.length > 0);
  const metrics: Readonly<Record<string, number>> = Object.freeze({
    goal_success_match: historicalMatches ? 1 : 0,
    criterion_coverage: ratio(
      requiredCriteria.filter((criterion) => coveredCriteria.has(criterion.criterionId)).length,
      requiredCriteria.length,
    ),
    evidence_completeness: ratio(
      requiredEvidence.filter((reference) => candidateEvidence.has(reference)).length,
      requiredEvidence.length,
    ),
    artifact_correctness: ratio(
      requiredArtifacts.filter((reference) => candidateArtifacts.has(reference)).length,
      requiredArtifacts.length,
    ),
    outcome_regression: input.historical.succeeded && !candidateAccepted ? 1 : 0,
    activity_fitness: activityFitness(definition, input.historical.activityRefs),
    precision_proxy: candidateAccepted ? 1 : 0,
    generalization_proxy: candidateAccepted ? 1 : 0,
    variant_coverage: candidateAccepted ? 1 : 0,
    unexpected_branch_rate: 0,
    unsafe_allow_count: rule.unsafeAllow,
    missed_confirmation_count: rule.missedConfirmation,
    false_positive: rule.falsePositive,
    false_negative: rule.falseNegative,
    side_effect_attempt_count: 0,
    planning_latency_ms: input.historical.planningLatencyMs,
    model_call_count: input.historical.modelCallCount,
    token_input: input.historical.tokenInput,
    token_output: input.historical.tokenOutput,
    estimated_cost_units: input.historical.estimatedCostUnits,
    plan_node_count: plan?.skillGoals.length ?? 0,
    human_interaction_count: input.historical.humanInteractionCount,
    fallback_count: input.historical.fallbackCount,
    plan_edit_distance:
      plan === undefined
        ? 0
        : new CounterfactualReplayEvaluator().evaluate({
            candidatePlan: plan,
            ...(input.acceptedPlan === undefined ? {} : { acceptedPlan: input.acceptedPlan }),
            historical: input.historical,
          }).planEditDistance,
    user_patch_count: input.historical.userPatchCount,
    rejected_candidate_count: candidateAccepted ? 0 : 1,
    missing_parameter_count: missingParameterCount,
    capability_gap_count: requiredCapabilities.filter((item) => !known.has(item)).length,
    readiness_gap_count: requiredCapabilities.filter((item) => known.has(item) && !ready.has(item))
      .length,
  });
  const counterexamples = failures
    .filter((failure) => failure.severity === 'major' || failure.severity === 'critical')
    .map((failure) =>
      createArtifactCounterexample({
        counterexampleId: stableId(
          'artifact-counterexample',
          hash({
            artifactRef: `${input.artifact.artifactId}:v${String(input.artifact.version)}`,
            replayCaseRef: input.replayCase.replayCaseId,
            failureRef: failure.failureId,
          }),
        ),
        artifactRef: `${input.artifact.artifactId}:v${String(input.artifact.version)}`,
        replayCaseRef: input.replayCase.replayCaseId,
        failureRef: failure.failureId,
        conditionFingerprint: hash({
          category: failure.category,
          environmentClass: input.replayCase.environmentClass,
          taskTypeId: input.replayCase.taskTypeId,
        }),
        environmentClass: input.replayCase.environmentClass,
        failureBoundaryCandidate: Object.freeze({
          category: failure.category,
          action:
            failure.category === 'unsafe_allow' || failure.category === 'side_effect_attempt'
              ? 'deny'
              : 'fallback_reasoning',
        }),
        sourceRefs: input.replayCase.sourceEpisodeRefs,
        status: 'recorded',
        createdAt: input.evaluatedAt,
      }),
    );
  return Object.freeze({
    replayCaseRef: input.replayCase.replayCaseId,
    ...(plan === undefined ? {} : { plan }),
    metrics,
    failures: Object.freeze([...failures]),
    counterexamples: Object.freeze(counterexamples),
    candidateAccepted,
    physicalOutcomeClaim: 'unknown' as const,
  });
}

function materializePlan(
  artifact: CompiledArtifact,
  definition: PlanTemplateArtifactDefinition,
  contract: UserGoalCompletionContract,
  createdAt: string,
): UserGoalPlan {
  const planId = stableId(
    'replay-plan',
    hash({
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      goalId: contract.goalId,
      goalVersion: contract.goalVersion,
    }),
  );
  const skillGoals = definition.skillGoalGraph.nodes.map((node) =>
    Object.freeze({
      skillGoalId: stableId('replay-skill-goal', hash({ planId, nodeKey: node.nodeKey })),
      requiredResult: node.objectiveTemplate,
      capabilityNeeds:
        node.nodeType === 'human_gate'
          ? uniqueSorted([...node.requiredCapabilities, 'human_confirmation'])
          : uniqueSorted(node.requiredCapabilities),
      coveredCriterionIds: uniqueSorted(node.coveredCriterionTemplateIds),
      requiredEffectRefs: uniqueSorted(node.requiredEffectRefs),
      evidenceRequirements: uniqueSorted(node.evidenceRequirements),
      artifactRequirements: uniqueSorted(node.artifactRequirements),
      assumptions: uniqueSorted(node.assumptionsAllowed),
      constraints: uniqueSorted(node.constraints),
      status: 'pending' as const,
    }),
  );
  const skillGoalIdByNode = new Map(
    definition.skillGoalGraph.nodes.map((node, index) => [
      node.nodeKey,
      requiredArrayItem(skillGoals, index).skillGoalId,
    ]),
  );
  const dependencies = definition.skillGoalGraph.dependencies.map((dependency) =>
    Object.freeze({
      dependencyId: stableId(
        'replay-dependency',
        hash({ planId, dependencyKey: dependency.dependencyKey }),
      ),
      predecessorSkillGoalId: requiredMapValue(skillGoalIdByNode, dependency.predecessorNodeKey),
      successorSkillGoalId: requiredMapValue(skillGoalIdByNode, dependency.successorNodeKey),
      predicate: dependency.predicate,
    }),
  );
  const identity = {
    schemaVersion: '1.0' as const,
    planId,
    goalId: contract.goalId,
    goalVersion: contract.goalVersion,
    revision: 1,
    revisionKind: 'initial' as const,
    status: 'validated' as const,
    contractHash: hash(contract),
    skillGoals,
    dependencies,
    inheritedCompletedEffectIds: [] as const,
    forbiddenReplayFingerprints: [] as const,
    createdAt,
  };
  return Object.freeze({ ...identity, contentHash: hash(identity) });
}

function staticValidationPassed(
  validation: CandidateStaticValidationResult,
  artifactRef: string,
): boolean {
  return (
    validation.artifactRef === artifactRef &&
    validation.schemaValid &&
    validation.activityIdentityValid &&
    validation.dagValid &&
    validation.parallelSemanticsValid &&
    validation.requiredCriteriaCovered &&
    validation.capabilityShapeValid &&
    validation.capabilityCatalogAligned &&
    validation.parameterPolicyValid &&
    validation.parameterSchemaAligned &&
    validation.applicabilityEvaluable &&
    validation.lineageComplete &&
    validation.recoverySemanticsValid &&
    validation.sideEffectReplaySafe &&
    validation.boundsValid &&
    validation.errors.length === 0 &&
    validation.result === 'passed_static'
  );
}

function createFailure(input: {
  readonly runId: string;
  readonly replayCase: ArtifactReplayCase;
  readonly category: ArtifactValidationFailureCategory;
  readonly severity: ArtifactValidationFailure['severity'];
  readonly expectedRef?: string;
  readonly actualRef?: string;
  readonly explanation: string;
}): ArtifactValidationFailure {
  const failureId = stableId(
    'artifact-validation-failure',
    hash({
      runId: input.runId,
      replayCaseRef: input.replayCase.replayCaseId,
      category: input.category,
      expectedRef: input.expectedRef,
      actualRef: input.actualRef,
      explanation: input.explanation,
    }),
  );
  return createArtifactValidationFailure({
    failureId,
    validationRunRef: input.runId,
    replayCaseRef: input.replayCase.replayCaseId,
    category: input.category,
    severity: input.severity,
    ...(input.expectedRef === undefined ? {} : { expectedRef: input.expectedRef }),
    ...(input.actualRef === undefined ? {} : { actualRef: input.actualRef }),
    evidenceRefs: input.replayCase.sourceEpisodeRefs,
    explanation: input.explanation,
  });
}

function aggregateMetrics(
  evaluations: readonly PlanReplayEvaluation[],
): Readonly<Record<string, number>> {
  const metricIds = uniqueSorted(
    evaluations.flatMap((evaluation) => Object.keys(evaluation.metrics)),
  );
  const sums = Object.fromEntries(
    metricIds.map((metricId) => [
      metricId,
      evaluations.reduce((sum, evaluation) => sum + (evaluation.metrics[metricId] ?? 0), 0),
    ]),
  );
  const sumMetrics = new Set([
    'outcome_regression',
    'unsafe_allow_count',
    'missed_confirmation_count',
    'false_positive',
    'false_negative',
    'side_effect_attempt_count',
    'model_call_count',
    'token_input',
    'token_output',
    'estimated_cost_units',
    'human_interaction_count',
    'fallback_count',
    'user_patch_count',
    'rejected_candidate_count',
    'missing_parameter_count',
    'capability_gap_count',
    'readiness_gap_count',
  ]);
  return Object.freeze(
    Object.fromEntries(
      metricIds.map((metricId) => [
        metricId,
        sumMetrics.has(metricId)
          ? requiredRecordValue(sums, metricId)
          : requiredRecordValue(sums, metricId) / evaluations.length,
      ]),
    ),
  );
}

function activityFitness(
  definition: PlanTemplateArtifactDefinition | undefined,
  historicalActivityRefs: readonly string[],
): number {
  if (definition === undefined || historicalActivityRefs.length === 0) return 0;
  const candidate = new Set(definition.skillGoalGraph.nodes.map((node) => node.nodeKey));
  return ratio(
    historicalActivityRefs.filter((activityRef) => candidate.has(activityRef)).length,
    historicalActivityRefs.length,
  );
}

function planEditDistance(candidate: UserGoalPlan, accepted: UserGoalPlan): number {
  const candidateGoals = new Set(candidate.skillGoals.map((goal) => goal.requiredResult));
  const acceptedGoals = new Set(accepted.skillGoals.map((goal) => goal.requiredResult));
  const changedGoals = [...candidateGoals].filter((goal) => !acceptedGoals.has(goal)).length;
  const removedGoals = [...acceptedGoals].filter((goal) => !candidateGoals.has(goal)).length;
  const candidateEdges = new Set(
    candidate.dependencies.map(
      (edge) => `${edge.predecessorSkillGoalId}->${edge.successorSkillGoalId}:${edge.predicate}`,
    ),
  );
  const acceptedEdges = new Set(
    accepted.dependencies.map(
      (edge) => `${edge.predecessorSkillGoalId}->${edge.successorSkillGoalId}:${edge.predicate}`,
    ),
  );
  return (
    changedGoals +
    removedGoals +
    [...candidateEdges].filter((edge) => !acceptedEdges.has(edge)).length +
    [...acceptedEdges].filter((edge) => !candidateEdges.has(edge)).length
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableId(prefix: string, digest: string): string {
  return `${prefix}-${digest.replace('sha256:', '').slice(0, 32)}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`REPLAY_PLAN_NODE_MISSING:${String(key)}`);
  return value;
}

function requiredArrayItem<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`REPLAY_PLAN_NODE_MISSING:${String(index)}`);
  return value;
}

function requiredRecordValue(values: Readonly<Record<string, number>>, key: string): number {
  const value = values[key];
  if (value === undefined) throw new Error(`REPLAY_METRIC_MISSING:${key}`);
  return value;
}
