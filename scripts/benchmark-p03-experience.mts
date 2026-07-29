import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

import {
  COGNITIVE_SCHEMA_VERSION,
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  createCognitiveSourceRef,
  createExperienceTrace,
  createGoalExperienceEpisode,
  type ExperienceTrace,
  type ExperienceTraceEvent,
  type ExperienceTraceEventType,
} from '../packages/domain/src/index.js';
import { ExperienceTraceNormalizer } from '../packages/application/src/compiler/experience-normalizer.js';
import { DeterministicProcessMiner } from '../packages/application/src/compiler/process-miner.js';

const normalizationSamples = 1_000;
const normalizer = new ExperienceTraceNormalizer();
const episode = benchmarkEpisode();
const normalizationDurations: number[] = [];
for (let index = 0; index < normalizationSamples; index += 1) {
  const startedAt = performance.now();
  normalizer.normalize(episode);
  normalizationDurations.push(performance.now() - startedAt);
}

const miningResults = [];
for (const traceCount of [1_000, 10_000]) {
  const traces = Array.from({ length: traceCount }, (_, index) => benchmarkTrace(index));
  const miner = new DeterministicProcessMiner({ mandatoryThreshold: 0.8 });
  const beforeHeapBytes = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await miner.discover(
    {
      tenantId: 'tenant-benchmark',
      taskTypeId: 'task-type-benchmark',
      minimumCompleteness: 0.8,
    },
    traces,
  );
  const elapsedMs = performance.now() - startedAt;
  const afterHeapBytes = process.memoryUsage().heapUsed;
  const definitionJson = JSON.stringify({
    schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
    cohort: result.cohort,
    variants: result.variants,
    discoveredPattern: result.discoveredPattern,
    workflowPattern: result.workflowPattern,
  });
  const compressed = gzipSync(definitionJson);
  const brotliCompressed = brotliCompressSync(definitionJson, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  miningResults.push({
    traceCount,
    elapsedMs: rounded(elapsedMs),
    tracesPerSecond: rounded((traceCount / elapsedMs) * 1_000),
    heapDeltaBytes: afterHeapBytes - beforeHeapBytes,
    definitionBytes: Buffer.byteLength(definitionJson),
    compressedDefinitionBytes: compressed.byteLength,
    base64CompressedDefinitionBytes: Buffer.byteLength(compressed.toString('base64')),
    brotliDefinitionBytes: brotliCompressed.byteLength,
    base64BrotliDefinitionBytes: Buffer.byteLength(brotliCompressed.toString('base64')),
    variantCount: result.variants.length,
    orderingConstraintCount: result.discoveredPattern.orderingConstraints.length,
    parallelCandidateCount: result.discoveredPattern.parallelCandidates.length,
    recoveryPatternCount: result.discoveredPattern.recoveryBranches.length,
    failureVariantCount: result.discoveredPattern.failureVariants.length,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: '1.0',
      packageId: 'SDAR-V1.3-P03',
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      normalization: {
        samples: normalizationSamples,
        p50Ms: rounded(percentile(normalizationDurations, 0.5)),
        p95Ms: rounded(percentile(normalizationDurations, 0.95)),
        maximumMs: rounded(Math.max(...normalizationDurations)),
      },
      mining: miningResults,
      classification: 'local deterministic benchmark; not production capacity evidence',
    },
    null,
    2,
  )}\n`,
);

function benchmarkTrace(index: number): ExperienceTrace {
  const failed = index % 10 === 0;
  const hasHumanGate = index % 5 === 0;
  const hasParallel = index % 3 === 0;
  const eventTypes: ExperienceTraceEventType[] = [
    'goal_created',
    'plan_created',
    ...(hasHumanGate ? (['human_intervention'] as const) : []),
    'skill_attempt_started',
    ...(hasParallel ? (['business_event_observed'] as const) : []),
    failed ? 'workflow_failed' : 'skill_attempt_completed',
    ...(failed
      ? (['recovery_started', 'skill_attempt_started', 'goal_failed'] as const)
      : (['goal_completed'] as const)),
  ];
  const events = eventTypes.map((eventType, sequence): ExperienceTraceEvent => ({
    eventId: `event-${String(index)}-${String(sequence)}`,
    sequence,
    occurredAt: new Date(Date.parse('2026-07-27T04:00:00.000Z') + sequence * 1_000).toISOString(),
    eventType,
    actorType: eventType === 'human_intervention' ? 'user' : 'runtime',
    capabilityRefs: eventType === 'skill_attempt_started' ? ['capability-benchmark'] : [],
    authorityRefs: [`source-${String(index)}-${String(sequence)}`],
    parentEventRefs: [],
    ...(hasParallel &&
    ['skill_attempt_started', 'business_event_observed'].includes(eventType) &&
    sequence < 6
      ? { concurrencyGroup: 'parallel-benchmark' }
      : {}),
    ...(failed && sequence >= eventTypes.indexOf('recovery_started')
      ? { branchRef: 'recovery-benchmark' }
      : {}),
    payloadSummary: { eventType },
  }));
  return createExperienceTrace({
    traceId: `trace-benchmark-${String(index)}`,
    sourceEpisodeId: `episode-benchmark-${String(index)}`,
    taskTypeRefs: ['task-type-benchmark'],
    goalFingerprint: hash(`goal:${String(index % 4)}`),
    capabilityFingerprint: hash('capability-benchmark'),
    environmentFingerprint: hash(`environment:${String(index % 3)}`),
    trace: {
      schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
      tenantId: 'tenant-benchmark',
      events,
      correctionRefs: hasHumanGate ? [`correction-${String(index)}`] : [],
      outcomeRef: `outcome-${String(index)}`,
      outcomeStatus: failed ? 'failed' : 'succeeded',
      missingFactCodes: [],
      environmentClass: `environment-${String(index % 3)}`,
    },
    completeness: 0.95,
    dataClassification: 'internal',
    normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
    sourceHash: hash(`source:${String(index)}`),
    createdAt: '2026-07-27T04:00:00.000Z',
  });
}

function benchmarkEpisode() {
  return createGoalExperienceEpisode({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    episodeId: 'episode-benchmark-normalization',
    goalId: 'goal-benchmark-normalization',
    goalVersion: 1,
    taskId: 'task-benchmark-normalization',
    contextId: 'context-benchmark-normalization',
    episodeType: 'terminal',
    revision: 1,
    terminalOutcomeRef: 'runtime-terminal-outcome:outcome-benchmark-normalization',
    sourceHash: hash('benchmark-normalization-source'),
    episodeHash: hash('benchmark-normalization-episode'),
    completeness: 1,
    status: 'complete',
    dataClassification: 'internal',
    snapshot: {
      task: {
        taskId: 'task-benchmark-normalization',
        contextId: 'context-benchmark-normalization',
        tenantId: 'tenant-benchmark',
        taskTypeId: 'task-type-benchmark',
        environmentClass: 'server',
        createdAt: '2026-07-27T04:00:00.000Z',
      },
      contract: {
        goalId: 'goal-benchmark-normalization',
        createdAt: '2026-07-27T04:00:01.000Z',
      },
      planRevisions: [
        {
          planId: 'plan-benchmark-normalization',
          revision: 1,
          status: 'confirmed',
          capabilityId: 'capability-benchmark',
          createdAt: '2026-07-27T04:00:02.000Z',
        },
      ],
      attempts: [
        {
          attempt_id: 'attempt-benchmark-normalization',
          status: 'completed',
          created_at: '2026-07-27T04:00:03.000Z',
          updated_at: '2026-07-27T04:00:04.000Z',
        },
      ],
      terminalOutcome: {
        outcomeId: 'outcome-benchmark-normalization',
        controlStatus: 'completed',
        committedAt: '2026-07-27T04:00:05.000Z',
      },
      userGoalJudgment: { status: 'achieved' },
    },
    sourceRefs: [
      createCognitiveSourceRef({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        sourceRefId: 'source-benchmark-normalization',
        sourceKind: 'runtime_terminal_outcome',
        sourceId: 'outcome-benchmark-normalization',
        sourceRevision: 1,
        authority: 'runtime_fact',
        dataClassification: 'internal',
        capturedAt: '2026-07-27T04:00:05.000Z',
      }),
    ],
    redactionCodes: [],
    createdAt: '2026-07-27T04:00:05.000Z',
  });
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile));
  const value = sorted[index];
  if (value === undefined) throw new Error('P03_BENCHMARK_PERCENTILE_MISSING');
  return value;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
