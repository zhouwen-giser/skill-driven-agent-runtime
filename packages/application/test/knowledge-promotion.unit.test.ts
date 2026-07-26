import { describe, expect, it } from 'vitest';

import {
  ActiveKnowledgeProjector,
  CapabilityPatternPromotionTarget,
  CorrectionDiffRecorder,
  DuplicateCandidateDetector,
  EvidenceThresholdEvaluator,
  KnowledgePromotionService,
  PlanningHeuristicPromotionTarget,
  ReplayEvaluationRunner,
  TaskTypePromotionTarget,
  type ActiveKnowledgeProjectionRepository,
  type KnowledgePromotionRepository,
  type PromotionCandidateRecord,
  type PromotionRevalidationCandidate,
  type PromotionReplayEvaluationRunner,
  type PromotionShadowReportSource,
} from '../src/index.js';
import {
  createKnowledgePromotionEvaluation,
  type ActiveKnowledgeProjection,
  type KnowledgePromotionEvaluation,
  type PromotionEvidenceSummary,
} from '../../domain/src/index.js';

const timestamp = '2026-07-26T06:00:00.000Z';

describe('G12 governed knowledge promotion', () => {
  it('rejects a single-Episode Candidate and enforces initial thresholds', () => {
    const evaluator = new EvidenceThresholdEvaluator();
    const decision = evaluator.evaluate({
      candidate: candidate({ kind: 'planning_heuristic' }),
      evidence: evidence({ uniqueGoalCount: 1, supportingRefs: ['episode.one'] }),
      replay: { reportRef: 'replay.one', passedCount: 1, failedCount: 0 },
      humanApproved: true,
      policyAllowed: true,
    });
    expect(decision.passed).toBe(false);
    expect(decision.gates).toContainEqual(
      expect.objectContaining({ code: 'unique_goals', passed: false }),
    );
  });

  it('shares one evaluator while retaining separate target validation', () => {
    const heuristic = new PlanningHeuristicPromotionTarget();
    const taskType = new TaskTypePromotionTarget();
    const pattern = new CapabilityPatternPromotionTarget();
    expect(heuristic.kind).toBe('planning_heuristic');
    expect(taskType.kind).toBe('task_type');
    expect(pattern.kind).toBe('capability_pattern');
    expect(heuristic.validate(candidate({ kind: 'planning_heuristic' }))).toEqual([]);
    expect(
      taskType.validate(
        candidate({
          kind: 'task_type',
          definition: {
            requiredDimensions: ['target'],
            criteriaTemplate: ['criterion'],
            capabilityRequirements: ['inspect'],
          },
        }),
      ),
    ).toEqual([]);
    expect(
      pattern.validate(
        candidate({
          kind: 'capability_pattern',
          definition: {
            exactSkillVersionMappings: [],
            effects: ['inspection completed'],
            evidenceRequirements: ['inspection report'],
          },
        }),
      ),
    ).toContain('capability_pattern_current_skill_mapping_required');
  });

  it('requires replay, shadow, human approval and policy allow for high risk', () => {
    const evaluator = new EvidenceThresholdEvaluator();
    const decision = evaluator.evaluate({
      candidate: candidate({ kind: 'planning_heuristic', risk: 'high' }),
      evidence: evidence({
        uniqueGoalCount: 6,
        uniqueUserCount: 3,
        successfulOutcomeCount: 5,
        supportingRefs: ['1', '2', '3', '4', '5', '6'],
      }),
      replay: { reportRef: 'replay.high', passedCount: 6, failedCount: 0 },
      humanApproved: false,
      policyAllowed: false,
    });
    expect(decision.passed).toBe(false);
    expect(decision.gates.filter((gate) => !gate.passed).map((gate) => gate.code)).toEqual(
      expect.arrayContaining(['shadow_required', 'human_approval', 'policy_allow']),
    );
  });

  it('CAS-promotes one Candidate Version once and projects only the Active authoritative ref', async () => {
    const repository = new InMemoryPromotionRepository(
      candidate({ kind: 'planning_heuristic' }),
      evidence({
        uniqueGoalCount: 3,
        uniqueUserCount: 2,
        successfulOutcomeCount: 2,
        userAcceptedPlanningCount: 2,
        supportingRefs: ['episode.1', 'episode.2', 'episode.3'],
      }),
    );
    const projections = new InMemoryProjectionRepository();
    const service = serviceFixture(repository, projections);
    const result = await service.evaluate({
      kind: 'planning_heuristic',
      knowledgeId: 'knowledge.test',
      expectedVersion: 1,
      actorId: 'operator.test',
      humanApproved: true,
      policyAllowed: true,
    });
    expect(result.evaluation.status).toBe('passed');
    expect(result.knowledge.status).toBe('active');
    expect(result.knowledge.version).toBe(3);
    expect(projections.items).toEqual([
      expect.objectContaining({
        knowledgeId: 'knowledge.test',
        knowledgeRevision: 1,
        authoritativeRef: 'planning_heuristic:knowledge.test:1',
      }),
    ]);
    await expect(
      service.evaluate({
        kind: 'planning_heuristic',
        knowledgeId: 'knowledge.test',
        expectedVersion: 1,
        actorId: 'operator.test',
        humanApproved: true,
        policyAllowed: true,
      }),
    ).rejects.toThrow('KNOWLEDGE_PROMOTION_VERSION_CONFLICT');
    expect(repository.evaluations).toHaveLength(1);
  });

  it('keeps a threshold-qualified Candidate inactive while Replay evidence is incubating', async () => {
    const repository = new InMemoryPromotionRepository(
      candidate({ kind: 'planning_heuristic' }),
      evidence({
        uniqueGoalCount: 3,
        uniqueUserCount: 2,
        successfulOutcomeCount: 2,
        supportingRefs: ['episode.1', 'episode.2', 'episode.3'],
      }),
    );
    const service = serviceFixture(repository, new InMemoryProjectionRepository(), {
      replay: {
        run: () =>
          Promise.resolve({
            reportRef: 'replay.incubating',
            reportHash: `sha256:${'a'.repeat(64)}`,
            passedCount: 1,
            failedCount: 0,
            status: 'incubating',
          }),
      },
    });

    const result = await service.evaluate({
      kind: 'planning_heuristic',
      knowledgeId: 'knowledge.test',
      expectedVersion: 1,
      actorId: 'operator.test',
      humanApproved: true,
      policyAllowed: true,
    });

    expect(result.evaluation).toMatchObject({
      status: 'incubating',
      decisionSummary:
        'The Candidate remains incubating because the separated replay holdout is insufficient.',
    });
    expect(result.knowledge).toMatchObject({ status: 'candidate', version: 3 });
  });

  it('retains manual rejection and active revalidation/deprecation transitions', async () => {
    const repository = new InMemoryPromotionRepository(
      candidate({ kind: 'planning_heuristic' }),
      evidence(),
    );
    const service = serviceFixture(repository, new InMemoryProjectionRepository());
    const rejected = await service.reject({
      kind: 'planning_heuristic',
      knowledgeId: 'knowledge.test',
      expectedVersion: 1,
      actorId: 'reviewer.test',
      reason: 'Unsafe generalization.',
    });
    expect(rejected.status).toBe('rejected');
    expect(repository.evaluations[0]).toMatchObject({
      status: 'rejected',
      decidedBy: 'reviewer.test',
    });

    const activeRepository = new InMemoryPromotionRepository(
      candidate({ kind: 'planning_heuristic', status: 'active', version: 4 }),
      evidence(),
    );
    const activeService = serviceFixture(activeRepository, new InMemoryProjectionRepository());
    expect(
      (
        await activeService.revalidate({
          kind: 'planning_heuristic',
          knowledgeId: 'knowledge.test',
          expectedVersion: 4,
          actorId: 'system.policy',
          reason: 'policy_changed',
        })
      ).status,
    ).toBe('validating');
    activeRepository.record = candidate({
      kind: 'planning_heuristic',
      status: 'active',
      version: 6,
    });
    expect(
      (
        await activeService.deprecate({
          kind: 'planning_heuristic',
          knowledgeId: 'knowledge.test',
          expectedVersion: 6,
          actorId: 'operator.test',
        })
      ).status,
    ).toBe('deprecated');
  });

  it('automatically returns Active knowledge with a new contradiction to validating', async () => {
    const active = candidate({
      kind: 'planning_heuristic',
      status: 'active',
      version: 3,
    });
    const repository = new InMemoryPromotionRepository(active, evidence());
    repository.revalidationCandidates = [{ record: active, reason: 'contradiction_detected' }];
    const projections = new InMemoryProjectionRepository();
    await new ActiveKnowledgeProjector({
      repository: projections,
      clock: { now: () => timestamp },
    }).project(active);
    const service = serviceFixture(repository, projections);

    await expect(service.revalidateChangedActive()).resolves.toBe(1);
    expect(repository.record).toMatchObject({ status: 'validating', version: 4 });
    expect(projections.items).toEqual([]);
  });

  it('rebuilds a deleted Memory projection only from Active PostgreSQL authority', async () => {
    const projections = new InMemoryProjectionRepository();
    const projector = new ActiveKnowledgeProjector({
      repository: projections,
      clock: { now: () => timestamp },
    });
    const active = candidate({ kind: 'task_type', status: 'active', version: 3 });
    const candidateRecord = candidate({ kind: 'task_type', status: 'candidate' });
    await expect(projector.project(candidateRecord)).rejects.toThrow(
      'KNOWLEDGE_PROJECTION_REQUIRES_ACTIVE',
    );
    await projector.project(active);
    projections.items.length = 0;
    expect(await projector.rebuild([active, candidateRecord])).toBe(1);
    expect(projections.items).toHaveLength(1);
  });

  it('reuses generic replay case and correction-diff components without Skill publication', async () => {
    const replay = new ReplayEvaluationRunner({
      cases: {
        list: () =>
          Promise.resolve([
            { caseId: 'case.success', sourceRef: 'episode.success', expectedOutcome: 'success' },
            { caseId: 'case.failure', sourceRef: 'episode.failure', expectedOutcome: 'failure' },
          ]),
      },
      runner: {
        run: (_candidate, testCase) =>
          Promise.resolve({
            observedOutcome: testCase.caseId === 'case.success' ? 'success' : 'success',
          }),
      },
    });
    await expect(replay.run(candidate({ kind: 'planning_heuristic' }))).resolves.toMatchObject({
      passedCount: 1,
      failedCount: 1,
    });
    expect(
      new CorrectionDiffRecorder().diff(
        { criteria: ['a'], nested: { enabled: false } },
        { criteria: ['a', 'b'], nested: { enabled: true } },
      ),
    ).toEqual([
      { path: '/criteria', before: ['a'], after: ['a', 'b'] },
      { path: '/nested/enabled', before: false, after: true },
    ]);
  });
});

function serviceFixture(
  repository: InMemoryPromotionRepository,
  projections: InMemoryProjectionRepository,
  overrides: Readonly<{
    replay?: PromotionReplayEvaluationRunner;
    shadow?: PromotionShadowReportSource;
  }> = {},
) {
  const replay: PromotionReplayEvaluationRunner = {
    run: () => Promise.resolve({ reportRef: 'replay.persisted', passedCount: 3, failedCount: 0 }),
  };
  const shadow: PromotionShadowReportSource = {
    find: () => Promise.resolve(undefined),
  };
  return new KnowledgePromotionService({
    repository,
    evaluator: new EvidenceThresholdEvaluator(),
    replay: overrides.replay ?? replay,
    duplicates: new DuplicateCandidateDetector(repository),
    shadow: overrides.shadow ?? shadow,
    projector: new ActiveKnowledgeProjector({
      repository: projections,
      clock: { now: () => timestamp },
    }),
    targets: [
      new PlanningHeuristicPromotionTarget(),
      new TaskTypePromotionTarget(),
      new CapabilityPatternPromotionTarget(),
    ],
    policyVersion: 'knowledge-promotion-v1',
    clock: { now: () => timestamp },
    nextEvaluationId: () => 'evaluation.test',
    nextTransitionId: (ordinal) => `transition.${String(ordinal)}`,
  });
}

function candidate(
  overrides: Partial<PromotionCandidateRecord> & Pick<PromotionCandidateRecord, 'kind'>,
): PromotionCandidateRecord {
  const { kind, ...rest } = overrides;
  return {
    schemaVersion: '1.0',
    knowledgeId: 'knowledge.test',
    revision: 1,
    version: 1,
    status: 'candidate',
    kind,
    scope: 'global_candidate',
    risk: 'low',
    title: 'Inspect before acting',
    summary: 'Gather durable evidence before changing a plan.',
    definition: {},
    supportSourceRefs: [],
    contradictionSourceRefs: [],
    createdAt: timestamp,
    ...rest,
  };
}

function evidence(overrides: Partial<PromotionEvidenceSummary> = {}): PromotionEvidenceSummary {
  return {
    uniqueGoalCount: 0,
    uniqueUserCount: 0,
    successfulOutcomeCount: 0,
    failedOutcomeCount: 0,
    userAcceptedPlanningCount: 0,
    userRejectedPlanningCount: 0,
    replayPassedCount: 0,
    replayFailedCount: 0,
    shadowImprovedCount: 0,
    shadowRegressedCount: 0,
    supportingRefs: [],
    contradictingRefs: [],
    ...overrides,
  };
}

class InMemoryPromotionRepository implements KnowledgePromotionRepository {
  evaluations: KnowledgePromotionEvaluation[] = [];
  revalidationCandidates: readonly PromotionRevalidationCandidate[] = [];
  record: PromotionCandidateRecord;
  readonly summary: PromotionEvidenceSummary;

  constructor(record: PromotionCandidateRecord, summary: PromotionEvidenceSummary) {
    this.record = record;
    this.summary = summary;
  }

  find(kind: PromotionCandidateRecord['kind'], knowledgeId: string) {
    return Promise.resolve(
      kind === this.record.kind && knowledgeId === this.record.knowledgeId
        ? { record: this.record, evidence: this.summary }
        : undefined,
    );
  }

  findActive(kind: PromotionCandidateRecord['kind'], knowledgeId: string) {
    return Promise.resolve(
      kind === this.record.kind &&
        knowledgeId === this.record.knowledgeId &&
        this.record.status === 'active'
        ? this.record
        : undefined,
    );
  }

  findDuplicate() {
    return Promise.resolve(undefined);
  }

  list(kind: PromotionCandidateRecord['kind'], limit = 100) {
    return Promise.resolve(
      kind === this.record.kind && limit > 0 ? Object.freeze([this.record]) : Object.freeze([]),
    );
  }

  complete(input: Parameters<KnowledgePromotionRepository['complete']>[0]) {
    if (input.expectedVersion !== this.record.version)
      return Promise.reject(new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT'));
    if (
      this.evaluations.some(
        (item) =>
          item.knowledgeId === input.evaluation.knowledgeId &&
          item.knowledgeRevision === input.evaluation.knowledgeRevision,
      )
    )
      return Promise.reject(new Error('KNOWLEDGE_PROMOTION_EVALUATION_CONFLICT'));
    this.evaluations.push(createKnowledgePromotionEvaluation(input.evaluation));
    this.record = {
      ...this.record,
      status: input.finalStatus,
      version: input.expectedVersion + input.transitions.length,
    };
    return Promise.resolve(this.record);
  }

  transition(input: Parameters<KnowledgePromotionRepository['transition']>[0]) {
    if (input.expectedVersion !== this.record.version)
      return Promise.reject(new Error('KNOWLEDGE_PROMOTION_VERSION_CONFLICT'));
    this.record = { ...this.record, status: input.toStatus, version: this.record.version + 1 };
    if (input.evaluation !== undefined) this.evaluations.push(input.evaluation);
    return Promise.resolve(this.record);
  }

  listActive() {
    return Promise.resolve(this.record.status === 'active' ? [this.record] : []);
  }

  listRevalidationCandidates() {
    return Promise.resolve(this.revalidationCandidates);
  }
}

class InMemoryProjectionRepository implements ActiveKnowledgeProjectionRepository {
  readonly items: ActiveKnowledgeProjection[] = [];

  upsert(projection: ActiveKnowledgeProjection) {
    const existing = this.items.findIndex(
      (item) =>
        item.knowledgeKind === projection.knowledgeKind &&
        item.knowledgeId === projection.knowledgeId &&
        item.knowledgeRevision === projection.knowledgeRevision,
    );
    if (existing >= 0) this.items[existing] = projection;
    else this.items.push(projection);
    return Promise.resolve();
  }

  remove(
    knowledgeKind: ActiveKnowledgeProjection['knowledgeKind'],
    knowledgeId: string,
    knowledgeRevision: number,
  ) {
    const index = this.items.findIndex(
      (item) =>
        item.knowledgeKind === knowledgeKind &&
        item.knowledgeId === knowledgeId &&
        item.knowledgeRevision === knowledgeRevision,
    );
    if (index >= 0) this.items.splice(index, 1);
    return Promise.resolve();
  }

  prune(activeProjectionIds: ReadonlySet<string>) {
    let count = 0;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      if (item !== undefined && !activeProjectionIds.has(item.projectionId)) {
        this.items.splice(index, 1);
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}
