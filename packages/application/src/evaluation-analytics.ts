import type {
  EvaluationAnalyticsFilter,
  EvaluationAnalyticsSample,
  EvaluationAnalyticsSnapshot,
} from '../../domain/src/index.js';
import type { EvaluationAnalyticsRepository } from './ports.js';

export class EvaluationAnalyticsService {
  readonly #repository: EvaluationAnalyticsRepository;
  constructor(dependencies: Readonly<{ repository: EvaluationAnalyticsRepository }>) {
    this.#repository = dependencies.repository;
  }

  async summarize(filters: EvaluationAnalyticsFilter): Promise<EvaluationAnalyticsSnapshot> {
    validateFilters(filters);
    const samples = await this.#repository.query(filters);
    const sampleCount = samples.length;
    const successCount = samples.filter((sample) => sample.successful).length;
    const totalDuration = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    const totalCost = samples.reduce((sum, sample) => sum + sample.cost, 0);
    return {
      filters,
      sampleCount,
      successCount,
      successRate: ratio(successCount, sampleCount),
      averageDurationMs: ratio(totalDuration, sampleCount),
      totalCost,
      averageCost: ratio(totalCost, sampleCount),
      failureTypes: failureTypes(samples),
      versionStability: versionStability(samples),
      qualityTrend: samples
        .flatMap((sample) =>
          sample.qualityReport === undefined
            ? []
            : [
                {
                  reportId: sample.qualityReport.reportId,
                  taskId: sample.qualityReport.taskId,
                  instanceId: sample.instanceId,
                  skillVersions: sample.skillVersions,
                  score: sample.qualityReport.overallScore,
                  status: sample.qualityReport.status,
                  createdAt: sample.qualityReport.createdAt,
                },
              ],
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.reportId.localeCompare(right.reportId),
        ),
    };
  }
}

function validateFilters(filters: EvaluationAnalyticsFilter): void {
  if (filters.skillVersion !== undefined && filters.skillId === undefined)
    throw new Error('EVALUATION_ANALYTICS_SKILL_ID_REQUIRED');
  if (filters.toolName !== undefined && filters.serverId === undefined)
    throw new Error('EVALUATION_ANALYTICS_SERVER_ID_REQUIRED');
  if (
    filters.skillVersion !== undefined &&
    (!Number.isInteger(filters.skillVersion) || filters.skillVersion < 1)
  )
    throw new Error('EVALUATION_ANALYTICS_SKILL_VERSION_INVALID');
}

function failureTypes(samples: readonly EvaluationAnalyticsSample[]) {
  const counts = new Map<string, number>();
  for (const sample of samples)
    for (const code of sample.failureCodes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

function versionStability(samples: readonly EvaluationAnalyticsSample[]) {
  const groups = new Map<
    string,
    { skillId: string; skillVersion: number; samples: EvaluationAnalyticsSample[] }
  >();
  for (const sample of samples)
    for (const skill of sample.skillVersions) {
      const key = `${skill.skillId}\0${String(skill.version)}`;
      const group = groups.get(key) ?? {
        skillId: skill.skillId,
        skillVersion: skill.version,
        samples: [],
      };
      group.samples.push(sample);
      groups.set(key, group);
    }
  return [...groups.values()]
    .map((group) => {
      const successRate = ratio(
        group.samples.filter((sample) => sample.successful).length,
        group.samples.length,
      );
      const values = group.samples.map(
        (sample) => sample.qualityReport?.overallScore ?? (sample.successful ? 1 : 0),
      );
      const averageQuality = ratio(
        values.reduce((sum, value) => sum + value, 0),
        values.length,
      );
      const qualityDeviation = standardDeviation(values, averageQuality);
      return {
        skillId: group.skillId,
        skillVersion: group.skillVersion,
        sampleCount: group.samples.length,
        successRate,
        averageQuality,
        qualityDeviation,
        stabilityScore: clamp(successRate * (1 - qualityDeviation)),
      };
    })
    .sort(
      (left, right) =>
        left.skillId.localeCompare(right.skillId) || left.skillVersion - right.skillVersion,
    );
}

function standardDeviation(values: readonly number[], average: number): number {
  if (values.length === 0) return 0;
  return metric(
    Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length),
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : metric(numerator / denominator);
}

function clamp(value: number): number {
  return metric(Math.min(1, Math.max(0, value)));
}

function metric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
