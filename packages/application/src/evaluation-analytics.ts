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
    const mcpUsageSnapshot = mcpUsage(samples);
    const modelEffectSnapshot = modelEffects(samples);
    const stabilitySnapshot = versionStability(samples);
    return {
      filters,
      sampleCount,
      successCount,
      successRate: ratio(successCount, sampleCount),
      averageDurationMs: ratio(totalDuration, sampleCount),
      totalCost,
      averageCost: ratio(totalCost, sampleCount),
      failureTypes: failureTypes(samples),
      mcpUsage: mcpUsageSnapshot,
      modelEffects: modelEffectSnapshot,
      versionStability: stabilitySnapshot,
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
      capabilityGrowth: capabilityGrowth(samples),
      optimizationSuggestions: optimizationSuggestions(
        failureTypes(samples),
        mcpUsageSnapshot,
        modelEffectSnapshot,
        stabilitySnapshot,
      ),
    };
  }
}

function mcpUsage(samples: readonly EvaluationAnalyticsSample[]) {
  const groups = new Map<string, EvaluationAnalyticsSample['mcpInvocations']>();
  for (const invocation of samples.flatMap((sample) => sample.mcpInvocations)) {
    const key = `${invocation.serverId}\0${invocation.toolName}`;
    groups.set(key, [...(groups.get(key) ?? []), invocation]);
  }
  return [...groups.entries()]
    .map(([key, invocations]) => {
      const [serverId = '', toolName = ''] = key.split('\0');
      return {
        serverId,
        toolName,
        invocationCount: invocations.length,
        successRate: ratio(
          invocations.filter((item) => item.status === 'succeeded').length,
          invocations.length,
        ),
        averageDurationMs: ratio(
          invocations.reduce((sum, item) => sum + item.durationMs, 0),
          invocations.length,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.invocationCount - left.invocationCount ||
        left.serverId.localeCompare(right.serverId) ||
        left.toolName.localeCompare(right.toolName),
    );
}

function modelEffects(samples: readonly EvaluationAnalyticsSample[]) {
  const groups = new Map<string, EvaluationAnalyticsSample['modelInvocations']>();
  for (const invocation of samples.flatMap((sample) => sample.modelInvocations)) {
    const key = `${invocation.providerId}\0${invocation.model}`;
    groups.set(key, [...(groups.get(key) ?? []), invocation]);
  }
  return [...groups.entries()]
    .map(([key, invocations]) => {
      const [providerId = '', model = ''] = key.split('\0');
      return {
        providerId,
        model,
        invocationCount: invocations.length,
        successRate: ratio(
          invocations.filter((item) => item.status === 'succeeded').length,
          invocations.length,
        ),
        averageDurationMs: ratio(
          invocations.reduce((sum, item) => sum + item.durationMs, 0),
          invocations.length,
        ),
        averageTokens: ratio(
          invocations.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0),
          invocations.length,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.invocationCount - left.invocationCount ||
        left.providerId.localeCompare(right.providerId) ||
        left.model.localeCompare(right.model),
    );
}

function capabilityGrowth(samples: readonly EvaluationAnalyticsSample[]) {
  const groups = new Map<
    string,
    { versions: Set<number>; samples: Set<string>; successes: Set<string> }
  >();
  for (const sample of samples)
    for (const skill of sample.skillVersions) {
      const group = groups.get(skill.skillId) ?? {
        versions: new Set<number>(),
        samples: new Set<string>(),
        successes: new Set<string>(),
      };
      group.versions.add(skill.version);
      group.samples.add(sample.experienceId);
      if (sample.successful) group.successes.add(sample.experienceId);
      groups.set(skill.skillId, group);
    }
  return [...groups.entries()]
    .map(([skillId, group]) => {
      const versions = [...group.versions].sort((a, b) => a - b);
      return {
        skillId,
        observedVersions: versions.length,
        firstVersion: versions[0] ?? 0,
        latestVersion: versions.at(-1) ?? 0,
        sampleCount: group.samples.size,
        successfulSamples: group.successes.size,
      };
    })
    .sort((left, right) => left.skillId.localeCompare(right.skillId));
}

function optimizationSuggestions(
  failures: ReturnType<typeof failureTypes>,
  tools: ReturnType<typeof mcpUsage>,
  models: ReturnType<typeof modelEffects>,
  versions: ReturnType<typeof versionStability>,
) {
  return [
    ...failures
      .filter((item) => item.count > 0)
      .map((item) => ({
        code: 'review_failure' as const,
        severity: 'warning' as const,
        target: item.code,
        summary: `Review repeated failure ${item.code}.`,
        evidenceCount: item.count,
      })),
    ...tools
      .filter((item) => item.successRate < 0.8)
      .map((item) => ({
        code: 'review_tool' as const,
        severity: 'warning' as const,
        target: `${item.serverId}.${item.toolName}`,
        summary: 'Review Tool reliability or Skill Tool selection.',
        evidenceCount: item.invocationCount,
      })),
    ...models
      .filter((item) => item.successRate < 0.8)
      .map((item) => ({
        code: 'review_model' as const,
        severity: 'warning' as const,
        target: `${item.providerId}/${item.model}`,
        summary: 'Review fixed-stage model configuration and Prompt evidence.',
        evidenceCount: item.invocationCount,
      })),
    ...versions
      .filter((item) => item.stabilityScore < 0.5)
      .map((item) => ({
        code: 'review_skill_version' as const,
        severity: 'warning' as const,
        target: `${item.skillId}@${String(item.skillVersion)}`,
        summary: 'Review or correct the unstable Skill version; do not disable automatically.',
        evidenceCount: item.sampleCount,
      })),
  ];
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
