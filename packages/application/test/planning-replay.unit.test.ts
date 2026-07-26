import { describe, expect, it } from 'vitest';

import {
  ConservativeReplayPlanningEvaluator,
  NoPhysicalProvider,
  PlanningReplayDatasetBuilder,
  PromotionReportGenerator,
  ReplayPromotionEvidenceService,
  ShadowPlanningService,
  type PlanningReplaySourceRecord,
  type PromotionCandidateRecord,
  type PromotionProvenanceReportRepository,
  type ReplayPlanningEvaluator,
} from '../src/index.js';
import {
  createReplayVariantResult,
  type PlanningReplayCase,
  type PlanningReplayMetrics,
  type PromotionProvenanceReport,
} from '../../domain/src/index.js';

const timestamp = '2026-07-26T11:00:00.000Z';
const catalogHash = `sha256:${'a'.repeat(64)}`;

describe('G16 planning replay and Shadow harness', () => {
  it('builds a deterministic dataset with disjoint mutate_dev and promotion_test cases', async () => {
    const builder = new PlanningReplayDatasetBuilder({
      load: () => Promise.resolve(records(6)),
    });

    const first = await builder.build(candidate());
    const second = await builder.build(candidate());

    expect(second).toEqual(first);
    expect(first.cases.filter((item) => item.partition === 'mutate_dev')).toHaveLength(4);
    expect(first.cases.filter((item) => item.partition === 'promotion_test')).toHaveLength(2);
    expect(new Set(first.cases.map((item) => `${item.partition}:${item.caseId}`)).size).toBe(6);
    expect(first.cases[0]).toMatchObject({
      request: 'Inspect device 1.',
      acceptedContract: { objective: 'Inspect device 1.' },
      acceptedPlan: { planId: 'plan.1' },
      outcome: { status: 'achieved' },
      catalogHash,
      knowledgeContext: ['planning_heuristic:knowledge.replay:1'],
    });
  });

  it('compares baseline/champion/candidate without mutating a formal task', async () => {
    const formalTask = { state: 'awaiting_confirmation' };
    const evaluator: ReplayPlanningEvaluator = {
      evaluate: (testCase) => {
        const improved = metrics({ patchCount: 0, coverage: 1 });
        return Promise.resolve({
          baseline: result(testCase, 'baseline', metrics()),
          champion: result(testCase, 'champion', metrics()),
          candidate: result(testCase, 'candidate', improved),
          receipt: { sideEffectClass: 'none', providerCalls: 0, mcpCalls: 0, deviceCalls: 0 },
        });
      },
    };
    const dataset = await new PlanningReplayDatasetBuilder({
      load: () => Promise.resolve(records(3)),
    }).build(candidate());
    const report = await new ShadowPlanningService({
      evaluator,
      physicalProvider: new NoPhysicalProvider(),
    }).compare(dataset, candidate());

    expect(report.improvedCount).toBe(1);
    expect(report.regressedCount).toBe(0);
    expect(formalTask.state).toBe('awaiting_confirmation');
  });

  it('classifies improved, neutral, regressed, invalid, and unsafe Shadow verdicts', async () => {
    let ordinal = 0;
    const evaluator: ReplayPlanningEvaluator = {
      evaluate: (testCase) => {
        const current = ordinal++;
        const candidateResult =
          current === 0
            ? result(testCase, 'candidate', metrics({ patchCount: 0 }))
            : current === 1
              ? result(testCase, 'candidate', metrics())
              : current === 2
                ? result(testCase, 'candidate', metrics({ coverage: 0.5 }))
                : current === 3
                  ? resultWithValidity(testCase, false, true)
                  : resultWithValidity(testCase, true, false);
        return Promise.resolve({
          baseline: result(testCase, 'baseline', metrics()),
          champion: result(testCase, 'champion', metrics()),
          candidate: candidateResult,
          receipt: { sideEffectClass: 'none', providerCalls: 0, mcpCalls: 0, deviceCalls: 0 },
        });
      },
    };
    const dataset = await new PlanningReplayDatasetBuilder({
      load: () => Promise.resolve(records(15)),
    }).build(candidate());
    const report = await new ShadowPlanningService({
      evaluator,
      physicalProvider: new NoPhysicalProvider(),
    }).compare(dataset, candidate());

    expect(report.comparisons).toHaveLength(5);
    expect(report).toMatchObject({
      improvedCount: 1,
      neutralCount: 1,
      regressedCount: 1,
      invalidCount: 1,
      unsafeCount: 1,
    });
  });

  it('rejects physical/MCP side effects and hard-failure regression', async () => {
    expect(() => {
      new NoPhysicalProvider().assertNoSideEffects({
        sideEffectClass: 'none',
        providerCalls: 0,
        mcpCalls: 1,
        deviceCalls: 0,
      });
    }).toThrow('REPLAY_PHYSICAL_SIDE_EFFECT_FORBIDDEN');

    const evaluator: ReplayPlanningEvaluator = {
      evaluate: (testCase) =>
        Promise.resolve({
          baseline: result(testCase, 'baseline', metrics()),
          champion: result(testCase, 'champion', metrics()),
          candidate: result(testCase, 'candidate', metrics({ hardFailureCount: 1 })),
          receipt: { sideEffectClass: 'none', providerCalls: 0, mcpCalls: 0, deviceCalls: 0 },
        }),
    };
    const report = await generator(records(3), evaluator).generate(candidate());
    expect(report.status).toBe('failed');
    expect(report.replayFailedCount).toBe(1);
    expect(report.gates).toContainEqual(
      expect.objectContaining({ code: 'hard_failure_non_regression', passed: false }),
    );
  });

  it('keeps insufficient candidates incubating and persists one reproducible report', async () => {
    const repository = new InMemoryReportRepository();
    const service = new ReplayPromotionEvidenceService({
      generator: generator(records(2), new ConservativeReplayPlanningEvaluator()),
      repository,
    });

    const [replay, shadow] = await Promise.all([
      service.run(candidate()),
      service.find(candidate()),
    ]);

    expect(replay).toMatchObject({ status: 'incubating', passedCount: 1, failedCount: 0 });
    expect(shadow).toMatchObject({ improvedCount: 0, regressedCount: 0 });
    expect(repository.items).toHaveLength(1);
    expect((await service.run(candidate())).reportHash).toBe(replay.reportHash);
    expect(repository.items[0]?.mutateDevCaseIds).not.toEqual(
      repository.items[0]?.promotionTestCaseIds,
    );
  });

  it('builds a reproducible empty incubating dataset from the current catalog', async () => {
    const withoutCatalog = candidateWithoutCatalog();
    const builder = new PlanningReplayDatasetBuilder({
      load: () => Promise.resolve([]),
      resolveCatalogHash: () => Promise.resolve(catalogHash),
    });

    const dataset = await builder.build(withoutCatalog);
    const report = await generator(
      [],
      new ConservativeReplayPlanningEvaluator(),
      catalogHash,
    ).generate(withoutCatalog);

    expect(dataset).toMatchObject({ catalogHash, cases: [] });
    expect(report).toMatchObject({
      status: 'incubating',
      replayPassedCount: 0,
      replayFailedCount: 0,
    });
  });
});

function generator(
  recordsValue: readonly PlanningReplaySourceRecord[],
  evaluator: ReplayPlanningEvaluator,
  resolvedCatalogHash?: string,
) {
  return new PromotionReportGenerator({
    datasets: new PlanningReplayDatasetBuilder({
      load: () => Promise.resolve(recordsValue),
      ...(resolvedCatalogHash === undefined
        ? {}
        : { resolveCatalogHash: () => Promise.resolve(resolvedCatalogHash) }),
    }),
    shadow: new ShadowPlanningService({
      evaluator,
      physicalProvider: new NoPhysicalProvider(),
    }),
  });
}

function records(count: number): readonly PlanningReplaySourceRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    return {
      episodeId: `episode.${String(ordinal)}`,
      request: `Inspect device ${String(ordinal)}.`,
      worldSummary: { device: `device.${String(ordinal)}` },
      acceptedContract: { objective: `Inspect device ${String(ordinal)}.` },
      acceptedPlan: { planId: `plan.${String(ordinal)}` },
      corrections: ordinal === 1 ? [{ path: '/criteria' }] : [],
      outcome: { status: 'achieved' },
      catalogHash,
      sourceHash: `sha256:${String(ordinal).padStart(64, '0')}`,
      createdAt: timestamp,
      baselineMetrics: metrics(),
    };
  });
}

function candidate(overrides: Partial<PromotionCandidateRecord> = {}): PromotionCandidateRecord {
  return {
    schemaVersion: '1.0',
    knowledgeId: 'knowledge.replay',
    revision: 1,
    version: 1,
    status: 'candidate',
    kind: 'planning_heuristic',
    scope: 'global_candidate',
    risk: 'low',
    title: 'Inspect before acting',
    summary: 'Inspect before changing a plan.',
    definition: {},
    supportSourceRefs: [],
    contradictionSourceRefs: [],
    catalogHash,
    createdAt: timestamp,
    ...overrides,
  };
}

function candidateWithoutCatalog(): PromotionCandidateRecord {
  const { catalogHash: omitted, ...record } = candidate();
  void omitted;
  return record;
}

function metrics(overrides: Partial<PlanningReplayMetrics> = {}): PlanningReplayMetrics {
  return {
    missingDimensionCount: 0,
    coverage: 0.8,
    patchCount: 1,
    attemptCount: 1,
    recoveryCount: 0,
    riskScore: 0,
    tokenCount: 100,
    latencyMs: 50,
    hardFailureCount: 0,
    dimensionScores: {
      understanding: 0.8,
      contract: 1,
      plan: 0.8,
      injection: 1,
      task_type_recognition: 0.8,
      capability_gap: 1,
    },
    ...overrides,
  };
}

function result(
  testCase: PlanningReplayCase,
  variant: 'baseline' | 'champion' | 'candidate',
  metricsValue: PlanningReplayMetrics,
) {
  return createReplayVariantResult({
    caseId: testCase.caseId,
    variant,
    valid: true,
    safe: true,
    metrics: metricsValue,
    hardFailures: metricsValue.hardFailureCount === 0 ? [] : ['goal-not-achieved'],
    outputHash: `sha256:${variant === 'baseline' ? 'b' : variant === 'champion' ? 'c' : 'd'}${'0'.repeat(63)}`,
  });
}

function resultWithValidity(testCase: PlanningReplayCase, valid: boolean, safe: boolean) {
  return createReplayVariantResult({
    caseId: testCase.caseId,
    variant: 'candidate',
    valid,
    safe,
    metrics: metrics(),
    hardFailures: [],
    outputHash: `sha256:${valid ? 'e' : 'f'}${safe ? '1' : '2'}${'0'.repeat(62)}`,
  });
}

class InMemoryReportRepository implements PromotionProvenanceReportRepository {
  readonly items: PromotionProvenanceReport[] = [];

  find(): Promise<PromotionProvenanceReport | undefined> {
    return Promise.resolve(this.items[0]);
  }

  save(report: PromotionProvenanceReport): Promise<PromotionProvenanceReport> {
    this.items.push(report);
    return Promise.resolve(report);
  }
}
