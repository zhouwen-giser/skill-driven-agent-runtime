import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  createCompiledArtifact,
  createUserGoalCompletionContract,
  type CapabilityReadinessResult,
  type CompiledArtifact,
  type Goal,
  type ParameterBindingResult,
  type RuntimeExecutionDecision,
  type UserGoalCompletionContract,
} from '../../domain/src/index.js';
import {
  TemplateRuntimeService,
  type ArtifactExecutionRecord,
  type ArtifactExecutionStart,
  type ArtifactRepository,
  type InteractivePlanningSessionView,
  type MaterializedPlanningCandidateInput,
  type TemplatePlanningSessionPort,
  type TemplateRuntimeRequest,
  type TemplateRuntimeState,
} from '../src/index.js';

let artifact: CompiledArtifact;

beforeAll(async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as { artifacts: CompiledArtifact[] };
  const source = fixture.artifacts.find((candidate) => candidate.artifactType === 'plan_template');
  if (source === undefined) throw new Error('P08 plan template fixture missing.');
  artifact = createCompiledArtifact(
    { ...source, status: 'active' },
    { validationPassed: true, approvalRecorded: true },
  );
});

describe('P08 TemplateRuntimeService', () => {
  it('materializes an active P07-selected template and uses P02 execution records before existing formal planning', async () => {
    const readiness = capabilityReadiness();
    const state = currentState(readiness);
    const executions = new ExecutionRecorder();
    const planning = new PlanningRecorder('confirmed');
    const service = runtime(state, readiness, executions, planning);

    const outcome = await service.instantiate(request(readiness));

    expect(outcome.result).toMatchObject({
      disposition: 'ready_for_validation',
      planCandidateRef: expect.stringMatching(/^p08-candidate-/u),
    });
    expect(outcome.candidate?.parameterBindings).toEqual({ deviceId: 'pump-17' });
    expect(outcome.candidate?.skillGoalGraph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeKey: 'observe',
          objective: 'Observe pump-17.',
          input: { deviceId: 'pump-17' },
          requiredCapabilities: ['capability.inspect'],
        }),
      ]),
    );
    expect(planning.input?.plan.skillGoals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillGoalId: 'p08-node-observe',
          capabilityNeeds: ['capability.inspect'],
        }),
      ]),
    );
    expect(planning.input?.plan.skillGoals[0]).not.toHaveProperty('skillId');
    expect(executions.started).toHaveLength(1);
    expect(executions.started[0]?.decisionSnapshot).toMatchObject({
      retrievalDecisionId: 'decision.1',
      retrievalRequestId: 'request.1',
    });
    expect(executions.completed).toHaveLength(1);
    expect(executions.feedback).toEqual(
      expect.arrayContaining([expect.objectContaining({ reasonCode: 'handoff' })]),
    );
    expect(outcome.formalHandoff).toMatchObject({
      disposition: 'confirmed_and_committed',
      formalPlanRef: planning.input?.plan.planId,
    });
  });

  it('discards the candidate before formal handoff when current runtime facts change', async () => {
    const readiness = capabilityReadiness();
    const initial = currentState(readiness);
    const stale = {
      ...initial,
      policySnapshotHash: `sha256:${'d'.repeat(64)}`,
    };
    const executions = new ExecutionRecorder();
    const planning = new PlanningRecorder('confirmed');
    let reads = 0;
    const service = runtime(initial, readiness, executions, planning, () =>
      reads++ === 0 ? initial : stale,
    );

    const outcome = await service.instantiate(request(readiness));

    expect(outcome.result.disposition).toBe('discarded_stale');
    expect(outcome.formalHandoff?.disposition).toBe('discarded_stale');
    expect(planning.input).toBeUndefined();
    expect(executions.feedback).toEqual(
      expect.arrayContaining([expect.objectContaining({ reasonCode: 'discarded_stale' })]),
    );
  });

  it('rejects a P07 binding whose source is not permitted by the immutable template', async () => {
    const readiness = capabilityReadiness();
    const state = currentState(readiness);
    const bad = request(readiness);
    const parameterBinding: ParameterBindingResult = {
      ...bad.parameterBinding,
      bindings: {
        deviceId: {
          value: 'pump-17',
          source: 'request',
          trust: 'authoritative',
          confidence: 1,
        },
      },
    };
    const decision: RuntimeExecutionDecision = {
      ...bad.decision,
      parameterBindings: parameterBinding.bindings,
    };
    const service = runtime(
      state,
      readiness,
      new ExecutionRecorder(),
      new PlanningRecorder('confirmed'),
    );

    const outcome = await service.instantiate({ ...bad, parameterBinding, decision });

    expect(outcome.result).toMatchObject({
      disposition: 'fallback',
      reasonCodes: ['TEMPLATE_PARAMETER_SOURCE_FORBIDDEN'],
    });
  });

  it('preserves the original error when failure evidence persistence also fails', async () => {
    const readiness = capabilityReadiness();
    const state = currentState(readiness);
    const completionError = new Error('execution completion failed');
    const feedbackError = new Error('feedback persistence failed');
    const executions = new ExecutionRecorder({ completionError, feedbackError });
    const service = runtime(state, readiness, executions, new PlanningRecorder('confirmed'));

    const failure = await service.instantiate(request(readiness)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: 'TEMPLATE_FAILURE_EVIDENCE_PERSISTENCE_FAILED:TEMPLATE_RUNTIME_FAILED',
    });
    expect((failure as AggregateError).errors).toEqual([completionError, feedbackError]);
    expect((failure as AggregateError & { cause?: unknown }).cause).toBe(feedbackError);
    expect(executions.started).toHaveLength(1);
    expect(executions.completed).toHaveLength(0);
  });

  it('propagates the live Gateway stage fence into the atomic planning handoff', async () => {
    const readiness = capabilityReadiness();
    const state = currentState(readiness);
    const planning = new PlanningRecorder('confirmed');
    const service = runtime(state, readiness, new ExecutionRecorder(), planning);
    let commitAllowed = true;
    const commitDeadlineAt = '2099-07-29T00:00:00.500Z';

    await service.instantiate({
      ...request(readiness),
      commitGuard: {
        commitDeadlineAt,
        mayCommitFormalAuthority: () => commitAllowed,
      },
    });

    expect(planning.input?.commitFence?.deadlineAt).toBe(commitDeadlineAt);
    expect(planning.input?.commitFence?.mayCommit()).toBe(true);
    commitAllowed = false;
    expect(planning.input?.commitFence?.mayCommit()).toBe(false);
  });
});

function runtime(
  state: TemplateRuntimeState,
  readiness: CapabilityReadinessResult,
  executions: ExecutionRecorder,
  planning: PlanningRecorder,
  read: () => TemplateRuntimeState = () => state,
): TemplateRuntimeService {
  const repository: ArtifactRepository = {
    findActiveIndex: () =>
      Promise.resolve([
        {
          artifactId: artifact.artifactId,
          artifactKey: artifact.artifactKey,
          artifactVersion: artifact.version,
          artifactType: artifact.artifactType,
          domain: artifact.scope.domain,
          taskTypeIds: artifact.scope.taskTypeIds,
          riskLevel: artifact.riskLevel,
          contentHash: artifact.contentHash,
          dependencySnapshot: artifact.dependencySnapshot,
          pointerLockVersion: 7,
          activatedAt: '2026-07-29T00:00:00.000Z',
        },
      ]),
    getDefinition: () => Promise.resolve(artifact),
    saveCandidate: () => Promise.resolve(),
    activate: () => Promise.resolve(),
    deprecate: () => Promise.resolve(),
  };
  return new TemplateRuntimeService({
    artifacts: repository,
    executions,
    planning,
    states: { read: () => Promise.resolve(read()) },
    clock: { now: () => '2026-07-29T00:00:00.000Z' },
  });
}

function request(readiness: CapabilityReadinessResult): TemplateRuntimeRequest {
  const artifactRef = `${artifact.artifactId}:${String(artifact.version)}`;
  const parameterBinding: ParameterBindingResult = {
    artifactRef,
    bindings: {
      deviceId: {
        value: 'pump-17',
        source: 'user_confirmed',
        trust: 'authoritative',
        confidence: 1,
      },
    },
    missingRequiredParameters: [],
    rejectedCandidateBindings: [],
    requiresConfirmation: [],
  };
  return {
    input: {
      requestRef: 'request.1',
      goalContractRef: 'goal.contract.1',
      goalVersion: 1,
      artifactRef,
      artifactVersion: artifact.version,
      artifactHash: artifact.contentHash,
      activePointerVersion: 7,
      applicabilityRef: 'applicability.1',
      parameterBindingRef: 'parameter-binding.1',
      dependencyValidationRef: 'dependency-validation.1',
      capabilityReadinessRef: 'capability-readiness.1',
      policyDecisionRef: 'policy-decision.1',
      matcherSnapshotHash: `sha256:${'b'.repeat(64)}`,
      policySnapshotHash: `sha256:${'c'.repeat(64)}`,
      idempotencyKey: 'p08.instantiate.1',
    },
    decision: {
      decisionId: 'decision.1',
      requestId: 'request.1',
      path: 'template_adapt',
      selectedArtifactRef: artifactRef,
      parameterBindings: parameterBinding.bindings,
      missingParameters: [],
      requiredConfirmations: [],
      reasonCodes: ['TEMPLATE_SELECTED'],
      matcherSnapshotHash: `sha256:${'b'.repeat(64)}`,
      policySnapshotHash: `sha256:${'c'.repeat(64)}`,
      createdAt: '2026-07-29T00:00:00.000Z',
    },
    applicability: {
      artifactRef,
      applicable: true,
      confidence: 1,
      satisfiedConditionIds: [],
      missingConditionIds: [],
      violatedConditionIds: [],
      uncertainConditionIds: [],
      outOfDistribution: false,
      disposition: 'eligible',
      reasonCodes: ['APPLICABLE'],
    },
    parameterBinding,
    dependencyValidation: {
      artifactRef,
      valid: true,
      mismatches: [],
      snapshotHash: `sha256:${'e'.repeat(64)}`,
      reasonCodes: ['DEPENDENCIES_VALID'],
    },
    capabilityReadiness: readiness,
    taskId: 'task.1',
    userId: 'user.1',
    goalSessionId: 'goal-session.1',
    confirmedContractCandidateId: 'goal-contract-candidate.1',
    sourceRefs: [],
  };
}

function capabilityReadiness(): CapabilityReadinessResult {
  return {
    artifactRef: `${artifact.artifactId}:${String(artifact.version)}`,
    requiredCapabilities: artifact.requiredCapabilities,
    skillCandidateRefs: ['skill-candidate.inspect.1'],
    providerReadiness: { 'capability.inspect': 'ready' },
    valid: true,
    reasonCodes: ['CAPABILITY_READY'],
  };
}

function currentState(readiness: CapabilityReadinessResult): TemplateRuntimeState {
  const goal: Goal = {
    goalId: 'goal.1',
    contextId: 'context.1',
    version: 1,
    title: 'Inspect pump',
    description: 'Inspect the selected pump.',
    constraints: ['read only'],
    successCriteria: ['Structured state was observed.'],
    status: 'active',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
  const contract: UserGoalCompletionContract = createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId: goal.goalId,
    goalVersion: goal.version,
    title: goal.title,
    description: goal.description,
    constraints: goal.constraints,
    criteria: [
      {
        criterionId: 'criterion.1',
        description: goal.successCriteria[0] ?? '',
        required: true,
        expectedEffectRefs: ['effect.observed'],
        evidenceRequirements: ['evidence.structured_state'],
        artifactRequirements: [],
      },
    ],
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  });
  return {
    goal,
    contract,
    matcherSnapshotHash: `sha256:${'b'.repeat(64)}`,
    policySnapshotHash: `sha256:${'c'.repeat(64)}`,
    capabilityCatalogHash: artifact.dependencySnapshot.capabilityCatalogHash,
    readinessHash: hashJson(readiness),
    killSwitchActive: false,
  };
}

class ExecutionRecorder {
  readonly started: ArtifactExecutionStart[] = [];
  readonly completed: readonly { artifactExecutionId: string }[] = [];
  readonly feedback: readonly { reasonCode: string }[] = [];
  readonly #completionError: Error | undefined;
  readonly #feedbackError: Error | undefined;

  constructor(failures: Readonly<{ completionError?: Error; feedbackError?: Error }> = {}) {
    this.#completionError = failures.completionError;
    this.#feedbackError = failures.feedbackError;
  }

  start(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord> {
    this.started.push(input);
    return Promise.resolve({ ...input, status: 'started' });
  }

  complete(input: { artifactExecutionId: string }): Promise<void> {
    if (this.#completionError !== undefined) return Promise.reject(this.#completionError);
    (this.completed as { artifactExecutionId: string }[]).push(input);
    return Promise.resolve();
  }

  appendFeedback(input: { reasonCode: string }): Promise<void> {
    if (this.#feedbackError !== undefined) return Promise.reject(this.#feedbackError);
    (this.feedback as { reasonCode: string }[]).push(input);
    return Promise.resolve();
  }
}

class PlanningRecorder implements TemplatePlanningSessionPort {
  input: MaterializedPlanningCandidateInput | undefined;
  readonly #state: 'confirmed' | 'plan_review';

  constructor(state: 'confirmed' | 'plan_review') {
    this.#state = state;
  }

  startWithMaterializedCandidate(
    input: MaterializedPlanningCandidateInput,
  ): Promise<InteractivePlanningSessionView> {
    this.input = input;
    return Promise.resolve({
      outcome: 'started',
      session: { sessionId: 'planning-session.1', state: this.#state },
      candidate: {},
    } as unknown as InteractivePlanningSessionView);
  }
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
