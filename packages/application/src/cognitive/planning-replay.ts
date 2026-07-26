import { createHash } from 'node:crypto';

import {
  COGNITIVE_SCHEMA_VERSION,
  createPlanningReplayCase,
  createPlanningReplayDataset,
  createPromotionProvenanceReport,
  createReplayVariantResult,
  createShadowPlanningReport,
  type PlanningReplayCase,
  type PlanningReplayDataset,
  type PlanningReplayMetrics,
  type PromotionGateResult,
  type PromotionProvenanceReport,
  type PromotionReplayReport,
  type PromotionShadowReport,
  type ReplayVariantResult,
  type ShadowCaseComparison,
} from '../../../domain/src/index.js';
import { canonicalJson } from './planning-correction-service.js';
import type {
  PromotionCandidateRecord,
  PromotionReplayEvaluationRunner,
  PromotionShadowReportSource,
} from './promotion-ports.js';

export interface PlanningReplaySourceRecord {
  readonly episodeId: string;
  readonly request: string;
  readonly worldSummary: Readonly<Record<string, unknown>>;
  readonly acceptedContract: Readonly<Record<string, unknown>>;
  readonly acceptedPlan: Readonly<Record<string, unknown>>;
  readonly corrections: readonly Readonly<Record<string, unknown>>[];
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly catalogHash: string;
  readonly sourceHash: string;
  readonly createdAt: string;
  readonly baselineMetrics: PlanningReplayMetrics;
}

export interface PlanningReplayDatasetSource {
  load(candidate: PromotionCandidateRecord): Promise<readonly PlanningReplaySourceRecord[]>;
  resolveCatalogHash?(candidate: PromotionCandidateRecord): Promise<string | undefined>;
}

export interface ReplayExecutionReceipt {
  readonly sideEffectClass: 'none' | 'read_only' | 'physical';
  readonly providerCalls: number;
  readonly mcpCalls: number;
  readonly deviceCalls: number;
}

export interface ReplayPlanningEvaluator {
  evaluate(
    testCase: PlanningReplayCase,
    candidate: PromotionCandidateRecord,
  ): Promise<
    Readonly<{
      baseline: ReplayVariantResult;
      champion: ReplayVariantResult;
      candidate: ReplayVariantResult;
      receipt: ReplayExecutionReceipt;
    }>
  >;
}

export interface PromotionProvenanceReportRepository {
  find(candidate: PromotionCandidateRecord): Promise<PromotionProvenanceReport | undefined>;
  save(report: PromotionProvenanceReport): Promise<PromotionProvenanceReport>;
}

export class PlanningReplayDatasetBuilder {
  readonly #source: PlanningReplayDatasetSource;

  constructor(source: PlanningReplayDatasetSource) {
    this.#source = source;
  }

  async build(candidate: PromotionCandidateRecord): Promise<PlanningReplayDataset> {
    const records = [...(await this.#source.load(candidate))].sort((left, right) =>
      left.episodeId.localeCompare(right.episodeId),
    );
    const promotionCount = records.length === 0 ? 0 : Math.max(1, Math.floor(records.length / 3));
    const boundary = records.length - promotionCount;
    const authoritativeRef = `${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}`;
    const cases = records.map((record, index) =>
      createPlanningReplayCase({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        caseId: stableId('replay-case', `${authoritativeRef}:${record.episodeId}`),
        episodeId: record.episodeId,
        partition: index < boundary ? 'mutate_dev' : 'promotion_test',
        request: record.request,
        worldSummary: record.worldSummary,
        acceptedContract: record.acceptedContract,
        acceptedPlan: record.acceptedPlan,
        corrections: record.corrections,
        outcome: record.outcome,
        catalogHash: record.catalogHash,
        knowledgeContext: [authoritativeRef],
        sourceHash: record.sourceHash,
        baselineMetrics: record.baselineMetrics,
      }),
    );
    const catalogHash =
      records[0]?.catalogHash ??
      candidate.catalogHash ??
      (await this.#source.resolveCatalogHash?.(candidate));
    if (catalogHash === undefined) throw new Error('PLANNING_REPLAY_CATALOG_HASH_UNAVAILABLE');
    if (cases.some((item) => item.catalogHash !== catalogHash)) {
      throw new Error('PLANNING_REPLAY_CATALOG_HASH_MIXED');
    }
    const builtAt = records.at(-1)?.createdAt ?? candidate.createdAt;
    const identity = {
      knowledgeKind: candidate.kind,
      knowledgeId: candidate.knowledgeId,
      knowledgeRevision: candidate.revision,
      catalogHash,
      cases,
    };
    const datasetHash = hash(identity);
    return createPlanningReplayDataset({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      datasetId: stableId('replay-dataset', datasetHash),
      ...identity,
      datasetHash,
      builtAt,
    });
  }
}

export class NoPhysicalProvider {
  assertNoSideEffects(receipt: ReplayExecutionReceipt): void {
    if (
      receipt.sideEffectClass !== 'none' ||
      receipt.providerCalls !== 0 ||
      receipt.mcpCalls !== 0 ||
      receipt.deviceCalls !== 0
    ) {
      throw new Error('REPLAY_PHYSICAL_SIDE_EFFECT_FORBIDDEN');
    }
  }
}

export class ConservativeReplayPlanningEvaluator implements ReplayPlanningEvaluator {
  evaluate(testCase: PlanningReplayCase): Promise<
    Readonly<{
      baseline: ReplayVariantResult;
      champion: ReplayVariantResult;
      candidate: ReplayVariantResult;
      receipt: ReplayExecutionReceipt;
    }>
  > {
    const baseline = variant(testCase, 'baseline', testCase.baselineMetrics);
    return Promise.resolve(
      Object.freeze({
        baseline,
        champion: variant(testCase, 'champion', testCase.baselineMetrics),
        candidate: variant(testCase, 'candidate', testCase.baselineMetrics),
        receipt: Object.freeze({
          sideEffectClass: 'none' as const,
          providerCalls: 0,
          mcpCalls: 0,
          deviceCalls: 0,
        }),
      }),
    );
  }
}

export class ShadowPlanningService {
  readonly #evaluator: ReplayPlanningEvaluator;
  readonly #physicalProvider: NoPhysicalProvider;

  constructor(
    dependencies: Readonly<{
      evaluator: ReplayPlanningEvaluator;
      physicalProvider: NoPhysicalProvider;
    }>,
  ) {
    this.#evaluator = dependencies.evaluator;
    this.#physicalProvider = dependencies.physicalProvider;
  }

  async compare(
    dataset: PlanningReplayDataset,
    candidate: PromotionCandidateRecord,
  ): Promise<ReturnType<typeof createShadowPlanningReport>> {
    const comparisons: ShadowCaseComparison[] = [];
    for (const testCase of dataset.cases.filter((item) => item.partition === 'promotion_test')) {
      const result = await this.#evaluator.evaluate(testCase, candidate);
      this.#physicalProvider.assertNoSideEffects(result.receipt);
      comparisons.push(
        Object.freeze({
          caseId: testCase.caseId,
          verdict: verdict(result.champion, result.candidate),
          baseline: result.baseline,
          champion: result.champion,
          candidate: result.candidate,
        }),
      );
    }
    const counts = {
      improvedCount: count(comparisons, 'improved'),
      neutralCount: count(comparisons, 'neutral'),
      regressedCount: count(comparisons, 'regressed'),
      invalidCount: count(comparisons, 'invalid'),
      unsafeCount: count(comparisons, 'unsafe'),
    };
    const comparisonHash = hash(comparisons);
    return createShadowPlanningReport({
      reportRef: `shadow-planning:${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}:${comparisonHash}`,
      datasetId: dataset.datasetId,
      comparisons,
      ...counts,
      comparisonHash,
    });
  }
}

export class PromotionReportGenerator {
  readonly #datasets: PlanningReplayDatasetBuilder;
  readonly #shadow: ShadowPlanningService;

  constructor(
    dependencies: Readonly<{
      datasets: PlanningReplayDatasetBuilder;
      shadow: ShadowPlanningService;
    }>,
  ) {
    this.#datasets = dependencies.datasets;
    this.#shadow = dependencies.shadow;
  }

  async generate(candidate: PromotionCandidateRecord): Promise<PromotionProvenanceReport> {
    const dataset = await this.#datasets.build(candidate);
    const shadow = await this.#shadow.compare(dataset, candidate);
    const mutateDevCaseIds = dataset.cases
      .filter((item) => item.partition === 'mutate_dev')
      .map((item) => item.caseId);
    const promotionTestCaseIds = dataset.cases
      .filter((item) => item.partition === 'promotion_test')
      .map((item) => item.caseId);
    const replayPassedCount = shadow.improvedCount + shadow.neutralCount;
    const replayFailedCount = shadow.regressedCount + shadow.invalidCount + shadow.unsafeCount;
    const enoughSamples = dataset.cases.length >= 3 && promotionTestCaseIds.length > 0;
    const noHardRegression = shadow.comparisons.every(
      (item) => item.candidate.metrics.hardFailureCount <= item.champion.metrics.hardFailureCount,
    );
    const gates: PromotionGateResult[] = [
      gate('replay_sample_count', dataset.cases.length, 3, enoughSamples),
      gate(
        'promotion_holdout_count',
        promotionTestCaseIds.length,
        1,
        promotionTestCaseIds.length > 0,
      ),
      gate('hard_failure_non_regression', noHardRegression, true, noHardRegression),
      gate('replay_failed', replayFailedCount, 0, replayFailedCount === 0),
      gate('physical_side_effect_calls', 0, 0, true),
    ];
    const status = !enoughSamples
      ? ('incubating' as const)
      : gates.every((item) => item.passed)
        ? ('passed' as const)
        : ('failed' as const);
    const reportIdentity = {
      knowledgeKind: candidate.kind,
      knowledgeId: candidate.knowledgeId,
      knowledgeRevision: candidate.revision,
      dataset,
      mutateDevCaseIds,
      promotionTestCaseIds,
      shadow,
      replayPassedCount,
      replayFailedCount,
      status,
      gates,
      generatedAt: dataset.builtAt,
    };
    const reportHash = hash(reportIdentity);
    return createPromotionProvenanceReport({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      reportId: stableId('promotion-report', reportHash),
      reportRef: `promotion-provenance:${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}:${reportHash}`,
      ...reportIdentity,
      reportHash,
    });
  }
}

export class ReplayPromotionEvidenceService
  implements PromotionReplayEvaluationRunner, PromotionShadowReportSource
{
  readonly #generator: PromotionReportGenerator;
  readonly #repository: PromotionProvenanceReportRepository;
  readonly #inFlight = new Map<string, Promise<PromotionProvenanceReport>>();

  constructor(
    dependencies: Readonly<{
      generator: PromotionReportGenerator;
      repository: PromotionProvenanceReportRepository;
    }>,
  ) {
    this.#generator = dependencies.generator;
    this.#repository = dependencies.repository;
  }

  async run(candidate: PromotionCandidateRecord): Promise<PromotionReplayReport> {
    const report = await this.#ensure(candidate);
    return Object.freeze({
      reportRef: report.reportRef,
      passedCount: report.replayPassedCount,
      failedCount: report.replayFailedCount,
      status: report.status,
      reportHash: report.reportHash,
    });
  }

  async find(candidate: PromotionCandidateRecord): Promise<PromotionShadowReport | undefined> {
    const report = await this.#ensure(candidate);
    return Object.freeze({
      reportRef: report.shadow.reportRef,
      improvedCount: report.shadow.improvedCount,
      regressedCount:
        report.shadow.regressedCount + report.shadow.invalidCount + report.shadow.unsafeCount,
    });
  }

  async #ensure(candidate: PromotionCandidateRecord): Promise<PromotionProvenanceReport> {
    const key = `${candidate.kind}:${candidate.knowledgeId}:${String(candidate.revision)}`;
    const existing = await this.#repository.find(candidate);
    if (existing !== undefined) return existing;
    const pending =
      this.#inFlight.get(key) ??
      this.#generator
        .generate(candidate)
        .then((report) => this.#repository.save(report))
        .finally(() => {
          this.#inFlight.delete(key);
        });
    this.#inFlight.set(key, pending);
    return pending;
  }
}

function verdict(champion: ReplayVariantResult, candidate: ReplayVariantResult) {
  if (!candidate.valid) return 'invalid' as const;
  if (!candidate.safe) return 'unsafe' as const;
  if (
    candidate.metrics.hardFailureCount > champion.metrics.hardFailureCount ||
    candidate.metrics.coverage < champion.metrics.coverage ||
    candidate.metrics.riskScore > champion.metrics.riskScore
  ) {
    return 'regressed' as const;
  }
  const improved =
    candidate.metrics.missingDimensionCount < champion.metrics.missingDimensionCount ||
    candidate.metrics.coverage > champion.metrics.coverage ||
    candidate.metrics.patchCount < champion.metrics.patchCount ||
    candidate.metrics.attemptCount < champion.metrics.attemptCount ||
    candidate.metrics.recoveryCount < champion.metrics.recoveryCount ||
    candidate.metrics.tokenCount < champion.metrics.tokenCount ||
    candidate.metrics.latencyMs < champion.metrics.latencyMs;
  return improved ? ('improved' as const) : ('neutral' as const);
}

function variant(
  testCase: PlanningReplayCase,
  name: ReplayVariantResult['variant'],
  metrics: PlanningReplayMetrics,
): ReplayVariantResult {
  const hardFailures =
    metrics.hardFailureCount === 0 ? [] : [`recorded-hard-failure:${testCase.caseId}`];
  return createReplayVariantResult({
    caseId: testCase.caseId,
    variant: name,
    valid: true,
    safe: metrics.riskScore < 1,
    metrics,
    hardFailures,
    outputHash: hash({ caseId: testCase.caseId, name, metrics, hardFailures }),
  });
}

function count(
  comparisons: readonly ShadowCaseComparison[],
  expected: ShadowCaseComparison['verdict'],
) {
  return comparisons.filter((item) => item.verdict === expected).length;
}

function gate(
  code: string,
  actual: number | boolean,
  required: number | boolean,
  passed: boolean,
): PromotionGateResult {
  return Object.freeze({ code, actual, required, passed });
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}
