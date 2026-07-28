import { describe, expect, it } from 'vitest';

import {
  ArtifactReplayValidationEngine,
  CaseReplayContract,
  CounterfactualReplayEvaluator,
  PlanReplayEvaluator,
  RuleReplayEvaluator,
  type HistoricalReplayOutcome,
  type PlanReplayInput,
} from '../src/index.js';
import {
  USER_GOAL_RUNTIME_LIMITS,
  type ArtifactReplayCase,
  type CandidateStaticValidationResult,
  type CompiledArtifact,
  type PlanTemplateArtifactDefinition,
  type ReplayDatasetManifest,
  type UserGoalCompletionContract,
} from '../../domain/src/index.js';

const at = '2026-07-28T18:00:00.000Z';
const sha = (letter: string): string => `sha256:${letter.repeat(64)}`;

describe('P05 Artifact replay validator', () => {
  it('materializes a Candidate through the existing plan validator and passes safe replay', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(input());
    expect(evaluation.candidateAccepted).toBe(true);
    expect(evaluation.plan).toMatchObject({
      goalId: 'goal-p05',
      status: 'validated',
      revisionKind: 'initial',
    });
    expect(evaluation.failures).toEqual([]);
    expect(evaluation.metrics).toMatchObject({
      criterion_coverage: 1,
      evidence_completeness: 1,
      artifact_correctness: 1,
      side_effect_attempt_count: 0,
    });
    expect(evaluation.physicalOutcomeClaim).toBe('unknown');
  });

  it('fails closed on missing historical parameters, catalog gaps and readiness gaps', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(
      input({
        parameterValues: {},
        knownCapabilityIds: ['cap-observe'],
        readyCapabilityIds: [],
      }),
    );
    expect(evaluation.candidateAccepted).toBe(false);
    expect(evaluation.failures.map((failure) => failure.category).sort()).toEqual([
      'capability_gap',
      'plan_invalid',
      'readiness_gap',
    ]);
    expect(evaluation.metrics).toMatchObject({
      missing_parameter_count: 1,
      capability_gap_count: 1,
      readiness_gap_count: 1,
    });
    expect(evaluation.counterexamples).toHaveLength(3);
  });

  it('rejects an unsafe allow against a deny snapshot', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(input({ authorityDecision: 'deny' }));
    expect(evaluation.failures).toEqual([
      expect.objectContaining({ category: 'unsafe_allow', severity: 'critical' }),
    ]);
    expect(evaluation.metrics['unsafe_allow_count']).toBe(1);
  });

  it('rejects a missed confirmation instead of treating an action as confirmed', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(
      input({ authorityDecision: 'require_confirmation' }),
    );
    expect(evaluation.failures).toEqual([
      expect.objectContaining({ category: 'missed_confirmation', severity: 'critical' }),
    ]);
    expect(evaluation.metrics['missed_confirmation_count']).toBe(1);
  });

  it('requires all canonical P04 static validation gates', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(
      input({
        staticValidation: {
          ...staticValidation(),
          capabilityCatalogAligned: false,
          result: 'failed_static',
        },
      }),
    );
    expect(evaluation.plan).toBeUndefined();
    expect(evaluation.failures).toEqual([
      expect.objectContaining({ category: 'schema', severity: 'critical' }),
    ]);
  });

  it('reports missing Evidence and Artifact requirements as replay failures', () => {
    const base = artifact();
    const definition = base.definition as PlanTemplateArtifactDefinition;
    const nodes = definition.skillGoalGraph.nodes.map((node) =>
      node.nodeKey === 'verify-result'
        ? { ...node, evidenceRequirements: [], artifactRequirements: [] }
        : node,
    );
    const evaluation = new PlanReplayEvaluator().evaluate(
      input({
        artifact: {
          ...base,
          definition: {
            ...definition,
            skillGoalGraph: { ...definition.skillGoalGraph, nodes },
          },
        },
      }),
    );
    expect(evaluation.failures).toEqual([
      expect.objectContaining({
        category: 'criterion_coverage',
        explanation: expect.stringContaining('evidence'),
      }),
      expect.objectContaining({
        category: 'criterion_coverage',
        explanation: expect.stringContaining('artifact'),
      }),
    ]);
    expect(evaluation.metrics).toMatchObject({
      evidence_completeness: 0,
      artifact_correctness: 0,
    });
  });

  it('returns needs_more_data for an incomplete immutable snapshot', () => {
    const incomplete = {
      ...replayCase(),
      snapshotCompleteness: 0.888889,
    };
    const evaluation = new PlanReplayEvaluator().evaluate(input({ replayCase: incomplete }));
    const output = new ArtifactReplayValidationEngine().validate({
      validationRunId: 'validation-run-p05',
      artifact: artifact(),
      dataset: dataset(),
      evaluations: [evaluation],
      completedAt: at,
    });
    expect(output.result).toMatchObject({ result: 'needs_more_data', unsafe: false });
    expect(output.failures).toEqual([expect.objectContaining({ category: 'snapshot_incomplete' })]);
  });

  it('uses existing plan validation to reject a cyclic Candidate graph', () => {
    const base = artifact();
    const definition = base.definition as PlanTemplateArtifactDefinition;
    const cyclic: CompiledArtifact = {
      ...base,
      definition: {
        ...definition,
        skillGoalGraph: {
          ...definition.skillGoalGraph,
          dependencies: [
            ...definition.skillGoalGraph.dependencies,
            {
              dependencyKey: 'edge-return',
              predecessorNodeKey: 'verify-result',
              successorNodeKey: 'perform-action',
              predicate: 'required',
            },
          ],
        },
      },
    };
    const evaluation = new PlanReplayEvaluator().evaluate(input({ artifact: cyclic }));
    expect(evaluation.failures).toEqual([
      expect.objectContaining({
        category: 'plan_invalid',
        explanation: expect.stringMatching(/DAG contains a cycle/u),
      }),
    ]);
  });

  it('classifies rule replay TP, TN, FP, FN, unsafe allow and missed confirmation', () => {
    const evaluator = new RuleReplayEvaluator();
    expect(
      evaluator.evaluate({
        authorityDecision: 'allow',
        candidateDecision: 'allow',
        candidateHasHumanGate: false,
      }),
    ).toMatchObject({ truePositive: 1, falsePositive: 0, falseNegative: 0 });
    expect(
      evaluator.evaluate({
        authorityDecision: 'deny',
        candidateDecision: 'deny',
        candidateHasHumanGate: false,
      }),
    ).toMatchObject({ trueNegative: 1, unsafeAllow: 0 });
    expect(
      evaluator.evaluate({
        authorityDecision: 'deny',
        candidateDecision: 'allow',
        candidateHasHumanGate: false,
      }),
    ).toMatchObject({ falsePositive: 1, unsafeAllow: 1 });
    expect(
      evaluator.evaluate({
        authorityDecision: 'allow',
        candidateDecision: 'deny',
        candidateHasHumanGate: false,
      }),
    ).toMatchObject({ falseNegative: 1 });
    expect(
      evaluator.evaluate({
        authorityDecision: 'require_confirmation',
        candidateDecision: 'allow',
        candidateHasHumanGate: false,
      }),
    ).toMatchObject({ missedConfirmation: 1 });
  });

  it('keeps counterfactual output epistemically honest about physical outcomes', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(input());
    if (evaluation.plan === undefined) throw new Error('fixture plan missing');
    const counterfactual = new CounterfactualReplayEvaluator().evaluate({
      candidatePlan: evaluation.plan,
      historical: historical(),
    });
    expect(counterfactual).toMatchObject({
      planEditDistance: 2,
      physicalOutcomeClaim: 'unknown',
      historicalModelCallCount: 2,
    });
    expect(counterfactual).not.toHaveProperty('wouldHaveSucceeded');
  });

  it('aggregates immutable deterministic result pins without approval or promotion output', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(input());
    const engine = new ArtifactReplayValidationEngine();
    const first = engine.validate({
      validationRunId: 'validation-run-p05',
      artifact: artifact(),
      dataset: dataset(),
      evaluations: [evaluation],
      completedAt: at,
    });
    const second = engine.validate({
      validationRunId: 'validation-run-p05',
      artifact: artifact(),
      dataset: dataset(),
      evaluations: [evaluation],
      completedAt: at,
    });
    expect(first.result).toMatchObject({
      result: 'passed',
      unsafe: false,
      artifactHash: sha('a'),
      datasetHash: sha('d'),
    });
    expect(first.result.resultHash).toBe(second.result.resultHash);
    expect(first.result).not.toHaveProperty('approved');
    expect(first.result).not.toHaveProperty('activated');
  });

  it('aggregates unsafe decisions as unsafe and records deterministic counterexamples', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(input({ authorityDecision: 'deny' }));
    const output = new ArtifactReplayValidationEngine().validate({
      validationRunId: 'validation-run-p05',
      artifact: artifact(),
      dataset: dataset(),
      evaluations: [evaluation],
      completedAt: at,
    });
    expect(output.result).toMatchObject({ result: 'unsafe', unsafe: true });
    expect(output.failures).toHaveLength(1);
    expect(output.counterexamples).toHaveLength(1);
    expect(output.counterexamples[0]).toMatchObject({
      status: 'recorded',
      failureBoundaryCandidate: { category: 'unsafe_allow', action: 'deny' },
    });
  });

  it('rejects an evaluation that reports any physical side effect', () => {
    const evaluation = new PlanReplayEvaluator().evaluate(input());
    expect(() => {
      new CaseReplayContract().assertEvaluation({
        ...evaluation,
        metrics: { ...evaluation.metrics, side_effect_attempt_count: 1 },
      });
    }).toThrow(/REPLAY_SIDE_EFFECT_ATTEMPT_PRESENT/u);
  });
});

function input(overrides: Partial<PlanReplayInput> = {}): PlanReplayInput {
  return {
    validationRunId: 'validation-run-p05',
    replayCase: replayCase(),
    artifact: artifact(),
    staticValidation: staticValidation(),
    goalContract: goalContract(),
    parameterValues: { target: 'device-7' },
    knownCapabilityIds: ['cap-act', 'cap-observe'],
    readyCapabilityIds: ['cap-act', 'cap-observe'],
    authorityDecision: 'allow',
    historical: historical(),
    evaluatedAt: at,
    ...overrides,
  };
}

function artifact(): CompiledArtifact {
  return {
    artifactId: 'artifact-p05',
    artifactKey: 'plan-template-p05',
    version: 1,
    artifactType: 'plan_template',
    name: 'P05 fixture',
    description: 'Replay validation fixture.',
    scope: { tenantId: 'tenant-p05', domain: 'test', taskTypeIds: ['task-test'] },
    definition: {
      goalPattern: {
        objectiveTemplate: 'Apply the requested action.',
        criterionTemplates: [
          {
            criterionTemplateId: 'criterion-result',
            statementTemplate: 'Result is verified.',
            required: true,
          },
        ],
      },
      parameterSchema: {
        type: 'object',
        required: ['target'],
        properties: { target: { type: 'string' } },
      },
      parameterBindings: [
        {
          parameterName: 'target',
          schema: { type: 'string' },
          required: true,
          allowedSources: 'user_confirmed',
          trustLevel: 'authoritative',
          defaultPolicy: 'none',
        },
      ],
      skillGoalGraph: {
        nodes: [
          {
            nodeKey: 'perform-action',
            nodeType: 'action',
            objectiveTemplate: 'Perform action.',
            requiredCapabilities: ['cap-act'],
            requiredEffectRefs: ['effect-applied'],
            coveredCriterionTemplateIds: [],
            evidenceRequirements: [],
            artifactRequirements: [],
            inputTemplate: { target: '${target}' },
            assumptionsAllowed: [],
            constraints: [],
          },
          {
            nodeKey: 'verify-result',
            nodeType: 'verification',
            objectiveTemplate: 'Verify result.',
            requiredCapabilities: ['cap-observe'],
            requiredEffectRefs: ['effect-verified'],
            coveredCriterionTemplateIds: ['criterion-result'],
            evidenceRequirements: ['evidence-result'],
            artifactRequirements: ['artifact-result'],
            inputTemplate: {},
            assumptionsAllowed: [],
            constraints: [],
          },
        ],
        dependencies: [
          {
            dependencyKey: 'edge-action-verify',
            predecessorNodeKey: 'perform-action',
            successorNodeKey: 'verify-result',
            predicate: 'required',
          },
        ],
      },
      completionContractTemplate: {
        titleTemplate: 'Result',
        descriptionTemplate: 'Result completion contract.',
        criteria: [
          {
            criterionTemplateId: 'criterion-result',
            statementTemplate: 'Result is verified.',
            required: true,
          },
        ],
        evidenceRequirements: ['evidence-result'],
        artifactRequirements: ['artifact-result'],
      },
      recoveryBranches: [],
    },
    applicability: {
      requiredConditions: [],
      optionalConditions: [],
      forbiddenConditions: [],
      requiredParameters: ['target'],
      allowedEnvironmentClasses: ['test'],
      excludedEnvironmentClasses: [],
      minimumIntentScore: 0.8,
      minimumConditionScore: 0.8,
      maximumUncertainty: 0.2,
      outOfDistributionPolicy: 'fallback_reasoning',
    },
    requiredCapabilities: [{ capabilityId: 'cap-act' }, { capabilityId: 'cap-observe' }],
    requiredPolicies: [{ policyId: 'policy-test', version: '1.0' }],
    dependencySnapshot: {
      capabilityCatalogHash: sha('b'),
      policyVersionRefs: ['policy-test:1.0'],
      taskTypeVersionRefs: ['task-test:1.0'],
      schemaVersionRefs: ['PlanTemplate:1.1'],
      requiredSkillVersionRefs: [],
      compilerVersion: 'compiler-test-1.0',
    },
    riskLevel: 'medium',
    status: 'candidate',
    lineageRef: 'lineage-p05',
    validationSummaryRef: 'static-validation-p05',
    contentHash: sha('a'),
    createdAt: at,
  };
}

function staticValidation(): CandidateStaticValidationResult {
  return {
    artifactRef: 'artifact-p05',
    schemaValid: true,
    activityIdentityValid: true,
    dagValid: true,
    parallelSemanticsValid: true,
    requiredCriteriaCovered: true,
    capabilityShapeValid: true,
    capabilityCatalogAligned: true,
    parameterPolicyValid: true,
    parameterSchemaAligned: true,
    applicabilityEvaluable: true,
    lineageComplete: true,
    recoverySemanticsValid: true,
    sideEffectReplaySafe: true,
    boundsValid: true,
    errors: [],
    warnings: [],
    validatorVersion: 'candidate-static-validator/1.2',
    result: 'passed_static',
  };
}

function goalContract(): UserGoalCompletionContract {
  return {
    schemaVersion: '1.0',
    goalId: 'goal-p05',
    goalVersion: 1,
    title: 'Apply and verify',
    description: 'Apply an action and verify its result.',
    constraints: [],
    criteria: [
      {
        criterionId: 'criterion-result',
        description: 'Result is verified.',
        required: true,
        expectedEffectRefs: ['effect-verified'],
        evidenceRequirements: ['evidence-result'],
        artifactRequirements: ['artifact-result'],
      },
    ],
    assumptions: [],
    policy: USER_GOAL_RUNTIME_LIMITS,
  };
}

function replayCase(): ArtifactReplayCase {
  return {
    replayCaseId: 'replay-case-p05',
    tenantId: 'tenant-p05',
    requestSnapshotRef: 'snapshot-request',
    goalContractSnapshotRef: 'snapshot-goal-contract',
    capabilityCatalogSnapshotRef: 'snapshot-capability-catalog',
    worldStateSnapshotRef: 'snapshot-world-state',
    policySnapshotRef: 'snapshot-policy',
    readinessSnapshotRef: 'snapshot-readiness',
    acceptedPlanSnapshotRef: 'snapshot-accepted-plan',
    executionTraceSnapshotRef: 'snapshot-execution-trace',
    outcomeSnapshotRef: 'snapshot-outcome',
    correctionRefs: [],
    environmentClass: 'test',
    taskTypeId: 'task-test',
    sourceEpisodeRefs: ['episode-p05'],
    goalLineageHash: sha('c'),
    snapshotCompleteness: 1,
    contentHash: sha('e'),
  };
}

function dataset(): ReplayDatasetManifest {
  return {
    datasetId: 'dataset-p05',
    datasetVersion: 1,
    purpose: 'candidate_development',
    tenantId: 'tenant-p05',
    taskTypeIds: ['task-test'],
    caseRefs: ['replay-case-p05'],
    splitPolicyVersion: 'sdar-replay-split/1.1',
    sourceRange: { from: at, to: at },
    sourceHash: sha('f'),
    contentHash: sha('d'),
    leakageCheckRef: 'leakage-p05',
    createdAt: at,
  };
}

function historical(): HistoricalReplayOutcome {
  return {
    succeeded: true,
    evidenceRefs: ['evidence-result'],
    artifactRefs: ['artifact-result'],
    activityRefs: ['perform-action', 'verify-result'],
    modelCallCount: 2,
    tokenInput: 100,
    tokenOutput: 50,
    estimatedCostUnits: 1,
    humanInteractionCount: 0,
    fallbackCount: 0,
    userPatchCount: 0,
    planningLatencyMs: 25,
  };
}
