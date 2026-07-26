import {
  assertIdentifier,
  assertPositiveVersion,
  assertSha256,
  assertTimestamp,
  type COGNITIVE_SCHEMA_VERSION,
} from './common.js';
import { CognitiveDomainError } from './errors.js';
import type { KnowledgeKind } from './knowledge.js';
import type { PromotionGateResult } from './promotion.js';

export const REPLAY_DIMENSIONS = Object.freeze([
  'understanding',
  'contract',
  'plan',
  'injection',
  'task_type_recognition',
  'capability_gap',
] as const);

export type ReplayDimension = (typeof REPLAY_DIMENSIONS)[number];
export type ReplayPartition = 'mutate_dev' | 'promotion_test';
export type ShadowVerdict = 'improved' | 'neutral' | 'regressed' | 'invalid' | 'unsafe';

export interface PlanningReplayMetrics {
  readonly missingDimensionCount: number;
  readonly coverage: number;
  readonly patchCount: number;
  readonly attemptCount: number;
  readonly recoveryCount: number;
  readonly riskScore: number;
  readonly tokenCount: number;
  readonly latencyMs: number;
  readonly hardFailureCount: number;
  readonly dimensionScores: Readonly<Record<ReplayDimension, number>>;
}

export interface PlanningReplayCase {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly caseId: string;
  readonly episodeId: string;
  readonly partition: ReplayPartition;
  readonly request: string;
  readonly worldSummary: Readonly<Record<string, unknown>>;
  readonly acceptedContract: Readonly<Record<string, unknown>>;
  readonly acceptedPlan: Readonly<Record<string, unknown>>;
  readonly corrections: readonly Readonly<Record<string, unknown>>[];
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly catalogHash: string;
  readonly knowledgeContext: readonly string[];
  readonly sourceHash: string;
  readonly baselineMetrics: PlanningReplayMetrics;
}

export interface PlanningReplayDataset {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly datasetId: string;
  readonly knowledgeKind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly knowledgeRevision: number;
  readonly catalogHash: string;
  readonly cases: readonly PlanningReplayCase[];
  readonly datasetHash: string;
  readonly builtAt: string;
}

export interface ReplayVariantResult {
  readonly caseId: string;
  readonly variant: 'baseline' | 'champion' | 'candidate';
  readonly valid: boolean;
  readonly safe: boolean;
  readonly metrics: PlanningReplayMetrics;
  readonly hardFailures: readonly string[];
  readonly outputHash: string;
}

export interface ShadowCaseComparison {
  readonly caseId: string;
  readonly verdict: ShadowVerdict;
  readonly baseline: ReplayVariantResult;
  readonly champion: ReplayVariantResult;
  readonly candidate: ReplayVariantResult;
}

export interface ShadowPlanningReport {
  readonly reportRef: string;
  readonly datasetId: string;
  readonly comparisons: readonly ShadowCaseComparison[];
  readonly improvedCount: number;
  readonly neutralCount: number;
  readonly regressedCount: number;
  readonly invalidCount: number;
  readonly unsafeCount: number;
  readonly comparisonHash: string;
}

export interface PromotionProvenanceReport {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly reportId: string;
  readonly reportRef: string;
  readonly knowledgeKind: KnowledgeKind;
  readonly knowledgeId: string;
  readonly knowledgeRevision: number;
  readonly dataset: PlanningReplayDataset;
  readonly mutateDevCaseIds: readonly string[];
  readonly promotionTestCaseIds: readonly string[];
  readonly shadow: ShadowPlanningReport;
  readonly replayPassedCount: number;
  readonly replayFailedCount: number;
  readonly status: 'incubating' | 'passed' | 'failed';
  readonly gates: readonly PromotionGateResult[];
  readonly generatedAt: string;
  readonly reportHash: string;
}

export function createPlanningReplayCase(input: PlanningReplayCase): PlanningReplayCase {
  assertIdentifier(input.caseId, 'replayCaseId');
  assertIdentifier(input.episodeId, 'replayEpisodeId');
  assertSha256(input.sourceHash, 'replaySourceHash');
  if (!['mutate_dev', 'promotion_test'].includes(input.partition)) invalid('Invalid partition.');
  if (input.request.trim().length === 0) invalid('Replay request is required.');
  if (input.knowledgeContext.length === 0) invalid('Replay knowledge context is required.');
  assertSha256(input.catalogHash, 'replayCatalogHash');
  return Object.freeze({
    ...input,
    worldSummary: freezeObject(input.worldSummary),
    acceptedContract: freezeObject(input.acceptedContract),
    acceptedPlan: freezeObject(input.acceptedPlan),
    corrections: Object.freeze(input.corrections.map(freezeObject)),
    outcome: freezeObject(input.outcome),
    knowledgeContext: Object.freeze([...new Set(input.knowledgeContext)].sort()),
    baselineMetrics: createPlanningReplayMetrics(input.baselineMetrics),
  });
}

export function createPlanningReplayDataset(input: PlanningReplayDataset): PlanningReplayDataset {
  assertIdentifier(input.datasetId, 'replayDatasetId');
  assertIdentifier(input.knowledgeId, 'replayKnowledgeId');
  assertPositiveVersion(input.knowledgeRevision, 'replayKnowledgeRevision');
  assertSha256(input.catalogHash, 'replayCatalogHash');
  assertSha256(input.datasetHash, 'replayDatasetHash');
  assertTimestamp(input.builtAt, 'replayBuiltAt');
  const cases = input.cases.map(createPlanningReplayCase);
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length) {
    invalid('Replay case IDs must be unique across partitions.');
  }
  return Object.freeze({ ...input, cases: Object.freeze(cases) });
}

export function createReplayVariantResult(input: ReplayVariantResult): ReplayVariantResult {
  assertIdentifier(input.caseId, 'replayCaseId');
  assertSha256(input.outputHash, 'replayOutputHash');
  return Object.freeze({
    ...input,
    metrics: createPlanningReplayMetrics(input.metrics),
    hardFailures: Object.freeze([...new Set(input.hardFailures)].sort()),
  });
}

export function createShadowPlanningReport(input: ShadowPlanningReport): ShadowPlanningReport {
  assertIdentifier(input.datasetId, 'replayDatasetId');
  assertSha256(input.comparisonHash, 'shadowComparisonHash');
  const comparisons = input.comparisons.map((item) =>
    Object.freeze({
      ...item,
      baseline: createReplayVariantResult(item.baseline),
      champion: createReplayVariantResult(item.champion),
      candidate: createReplayVariantResult(item.candidate),
    }),
  );
  const counts = countVerdicts(comparisons);
  if (
    counts.improved !== input.improvedCount ||
    counts.neutral !== input.neutralCount ||
    counts.regressed !== input.regressedCount ||
    counts.invalid !== input.invalidCount ||
    counts.unsafe !== input.unsafeCount
  ) {
    invalid('Shadow verdict counts do not match comparisons.');
  }
  return Object.freeze({ ...input, comparisons: Object.freeze(comparisons) });
}

export function createPromotionProvenanceReport(
  input: PromotionProvenanceReport,
): PromotionProvenanceReport {
  assertIdentifier(input.reportId, 'promotionReportId');
  assertIdentifier(input.knowledgeId, 'promotionReportKnowledgeId');
  assertPositiveVersion(input.knowledgeRevision, 'promotionReportKnowledgeRevision');
  assertTimestamp(input.generatedAt, 'promotionReportGeneratedAt');
  assertSha256(input.reportHash, 'promotionReportHash');
  const dataset = createPlanningReplayDataset(input.dataset);
  const mutate = [...new Set(input.mutateDevCaseIds)].sort();
  const promotion = [...new Set(input.promotionTestCaseIds)].sort();
  if (mutate.some((id) => promotion.includes(id))) invalid('Replay partitions must be disjoint.');
  const allIds = new Set(dataset.cases.map((item) => item.caseId));
  if ([...mutate, ...promotion].some((id) => !allIds.has(id))) {
    invalid('Promotion report references an unknown Replay case.');
  }
  if (input.status === 'passed' && input.replayFailedCount > 0) {
    invalid('A passing Promotion report cannot contain replay failures.');
  }
  return Object.freeze({
    ...input,
    dataset,
    mutateDevCaseIds: Object.freeze(mutate),
    promotionTestCaseIds: Object.freeze(promotion),
    shadow: createShadowPlanningReport(input.shadow),
    gates: Object.freeze(input.gates.map((gate) => Object.freeze({ ...gate }))),
  });
}

function createPlanningReplayMetrics(input: PlanningReplayMetrics): PlanningReplayMetrics {
  for (const [key, value] of Object.entries(input)) {
    if (key === 'dimensionScores') continue;
    if (!Number.isFinite(value) || Number(value) < 0) invalid(`Invalid replay metric ${key}.`);
  }
  if (input.coverage > 1 || input.riskScore > 1) invalid('Ratio metrics must not exceed one.');
  const dimensionScores = Object.fromEntries(
    REPLAY_DIMENSIONS.map((dimension) => {
      const value = input.dimensionScores[dimension];
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        invalid(`Invalid ${dimension} score.`);
      }
      return [dimension, value];
    }),
  ) as Record<ReplayDimension, number>;
  return Object.freeze({ ...input, dimensionScores: Object.freeze(dimensionScores) });
}

function countVerdicts(comparisons: readonly ShadowCaseComparison[]) {
  return {
    improved: comparisons.filter((item) => item.verdict === 'improved').length,
    neutral: comparisons.filter((item) => item.verdict === 'neutral').length,
    regressed: comparisons.filter((item) => item.verdict === 'regressed').length,
    invalid: comparisons.filter((item) => item.verdict === 'invalid').length,
    unsafe: comparisons.filter((item) => item.verdict === 'unsafe').length,
  };
}

function freezeObject(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...value });
}

function invalid(message: string): never {
  throw new CognitiveDomainError('KNOWLEDGE_PROMOTION_INVALID', message);
}
