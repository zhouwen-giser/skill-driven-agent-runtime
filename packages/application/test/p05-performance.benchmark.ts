import { performance } from 'node:perf_hooks';

import {
  ArtifactReplayCaseBuilder,
  PlanReplayEvaluator,
  ReplayDatasetBuilder,
  type ArtifactReplaySource,
  type HistoricalReplayOutcome,
  type PlanReplayInput,
} from '../src/index.js';
import {
  USER_GOAL_RUNTIME_LIMITS,
  type ArtifactReplayCase,
  type CandidateStaticValidationResult,
  type CompiledArtifact,
  type UserGoalCompletionContract,
} from '../../domain/src/index.js';

const sha = (letter: string): string => `sha256:${letter.repeat(64)}`;
const timestamp = '2026-07-29T02:00:00.000Z';

const dataset1k = benchmarkDataset(1_000, 5);
const memoryBefore = process.memoryUsage().heapUsed;
const dataset10k = benchmarkDataset(10_000, 3);
const memoryAfter = process.memoryUsage().heapUsed;
const replay = benchmarkReplay(2_000);

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: '1.0',
      benchmark: 'SDAR-P05-artifact-replay',
      nodeVersion: process.version,
      datasetBuild: {
        cases1k: dataset1k,
        cases10k: dataset10k,
      },
      replayCase: replay,
      heapDeltaBytesFor10k: Math.max(0, memoryAfter - memoryBefore),
      workerModel: {
        perWorkerConcurrency: 1,
        horizontalParallelism: 'PostgreSQL SKIP LOCKED with lease fencing',
        backpressure: 'bounded claim limit and durable available_at',
      },
    },
    null,
    2,
  )}\n`,
);

function benchmarkDataset(
  caseCount: number,
  iterations: number,
): Readonly<{
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  casesPerSecondAtP50: number;
}> {
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    const cases = Array.from({ length: caseCount }, (_, index) =>
      new ArtifactReplayCaseBuilder().build(source(index)),
    );
    const build = new ReplayDatasetBuilder().build({
      tenantId: 'tenant-p05-benchmark',
      datasetVersion: iteration + 1,
      cases,
      candidateSourceTraceRefs: [],
      createdAt: timestamp,
    });
    if (build.leakage.checkedCaseCount !== caseCount || !build.leakage.passed) {
      throw new Error('P05_BENCHMARK_DATASET_INVALID');
    }
    samples.push(performance.now() - started);
  }
  const p50Ms = percentile(samples, 0.5);
  return {
    iterations,
    p50Ms,
    p95Ms: percentile(samples, 0.95),
    casesPerSecondAtP50: round((caseCount / p50Ms) * 1_000),
  };
}

function benchmarkReplay(iterations: number): Readonly<{
  iterations: number;
  p50Ms: number;
  p95Ms: number;
  casesPerSecondAtP50: number;
}> {
  const evaluator = new PlanReplayEvaluator();
  const replayInput = input();
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    const evaluation = evaluator.evaluate(replayInput);
    if (!evaluation.candidateAccepted || evaluation.failures.length > 0) {
      throw new Error('P05_BENCHMARK_REPLAY_INVALID');
    }
    samples.push(performance.now() - started);
  }
  const p50Ms = percentile(samples, 0.5);
  return {
    iterations,
    p50Ms,
    p95Ms: percentile(samples, 0.95),
    casesPerSecondAtP50: round((1 / p50Ms) * 1_000),
  };
}

function percentile(samples: readonly number[], quantile: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1);
  return round(ordered[index] ?? 0);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function source(index: number): ArtifactReplaySource {
  const key = String(index + 1);
  const occurredAt = new Date(Date.parse('2025-01-01T00:00:00.000Z') + index * 1_000).toISOString();
  return {
    tenantId: 'tenant-p05-benchmark',
    sourceEpisodeRef: `episode-${key}`,
    sourceEpisodeRevisionRef: `episode-${key}:revision-1`,
    goalLineageHash: shaForIndex(index, 0),
    requestSnapshotRef: `request-${key}`,
    requestFingerprint: shaForIndex(index, 1),
    nearDuplicateFingerprint: shaForIndex(index, 2),
    goalContractSnapshotRef: `goal-contract-${key}`,
    capabilityCatalogSnapshotRef: `capability-catalog-${key}`,
    worldStateSnapshotRef: `world-state-${key}`,
    policySnapshotRef: `policy-${key}`,
    readinessSnapshotRef: `readiness-${key}`,
    acceptedPlanSnapshotRef: `accepted-plan-${key}`,
    acceptedPlanRevisionRef: `accepted-plan-${key}:revision-1`,
    executionTraceSnapshotRef: `execution-trace-${key}`,
    outcomeSnapshotRef: `outcome-${key}`,
    correctionRefs: [],
    environmentClass: index % 2 === 0 ? 'warehouse' : 'laboratory',
    deviceClass: `benchmark-device-${key}`,
    taskTypeId: 'task-benchmark',
    sourceTraceRefs: [`trace-${key}`],
    counterexample: index % 100 === 0,
    occurredAt,
  };
}

function shaForIndex(index: number, salt: number): string {
  return `sha256:${(index * 3 + salt + 1).toString(16).padStart(64, '0')}`;
}

function input(): PlanReplayInput {
  return {
    validationRunId: 'validation-run-benchmark',
    replayCase: replayCase(),
    artifact: artifact(),
    staticValidation: staticValidation(),
    goalContract: goalContract(),
    parameterValues: { target: 'device-7' },
    knownCapabilityIds: ['cap-act'],
    readyCapabilityIds: ['cap-act'],
    authorityDecision: 'allow',
    historical: historical(),
    evaluatedAt: timestamp,
  };
}

function artifact(): CompiledArtifact {
  return {
    artifactId: 'artifact-p05-benchmark',
    artifactKey: 'plan-template-p05-benchmark',
    version: 1,
    artifactType: 'plan_template',
    name: 'P05 benchmark',
    description: 'Replay performance fixture.',
    scope: { tenantId: 'tenant-p05-benchmark', domain: 'test', taskTypeIds: ['task-benchmark'] },
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
            objectiveTemplate: 'Perform and verify action.',
            requiredCapabilities: ['cap-act'],
            requiredEffectRefs: ['effect-result'],
            coveredCriterionTemplateIds: ['criterion-result'],
            evidenceRequirements: ['evidence-result'],
            artifactRequirements: ['artifact-result'],
            inputTemplate: { target: '${target}' },
            assumptionsAllowed: [],
            constraints: [],
          },
        ],
        dependencies: [],
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
    requiredCapabilities: [{ capabilityId: 'cap-act' }],
    requiredPolicies: [{ policyId: 'policy-test', version: '1.0' }],
    dependencySnapshot: {
      capabilityCatalogHash: sha('b'),
      policyVersionRefs: ['policy-test:1.0'],
      taskTypeVersionRefs: ['task-benchmark:1.0'],
      schemaVersionRefs: ['PlanTemplate:1.1'],
      requiredSkillVersionRefs: [],
      compilerVersion: 'compiler-test-1.0',
    },
    riskLevel: 'medium',
    status: 'candidate',
    lineageRef: 'lineage-p05-benchmark',
    validationSummaryRef: 'static-validation-p05-benchmark',
    contentHash: sha('a'),
    createdAt: timestamp,
  };
}

function staticValidation(): CandidateStaticValidationResult {
  return {
    artifactRef: 'artifact-p05-benchmark',
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
    goalId: 'goal-p05-benchmark',
    goalVersion: 1,
    title: 'Apply and verify',
    description: 'Apply an action and verify its result.',
    constraints: [],
    criteria: [
      {
        criterionId: 'criterion-result',
        description: 'Result is verified.',
        required: true,
        expectedEffectRefs: ['effect-result'],
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
    replayCaseId: 'replay-case-p05-benchmark',
    tenantId: 'tenant-p05-benchmark',
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
    taskTypeId: 'task-benchmark',
    sourceEpisodeRefs: ['episode-p05-benchmark'],
    goalLineageHash: sha('c'),
    snapshotCompleteness: 1,
    contentHash: sha('e'),
  };
}

function historical(): HistoricalReplayOutcome {
  return {
    succeeded: true,
    evidenceRefs: ['evidence-result'],
    artifactRefs: ['artifact-result'],
    activityRefs: ['perform-action'],
    modelCallCount: 1,
    tokenInput: 100,
    tokenOutput: 50,
    estimatedCostUnits: 1,
    humanInteractionCount: 0,
    fallbackCount: 0,
    userPatchCount: 0,
    planningLatencyMs: 25,
  };
}
