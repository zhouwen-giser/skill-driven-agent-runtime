import { describe, expect, it, vi } from 'vitest';

import {
  COGNITIVE_SCHEMA_VERSION,
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  createCognitiveSourceRef,
  createExperienceTrace,
  createGoalExperienceEpisode,
  type ExperienceTrace,
} from '../../domain/src/index.js';
import {
  CompilationRunReconciler,
  ExperienceNormalizationService,
  type CompilationRun,
  type CompilationRunRepository,
  type ExperienceCompilationRepository,
} from '../src/compiler/experience-compilation.js';
import { ExperienceTraceNormalizer } from '../src/compiler/experience-normalizer.js';

const now = '2026-07-27T02:00:00.000Z';
const sha = (character: string): string => `sha256:${character.repeat(64)}`;

describe('Experience normalization durable orchestration', () => {
  it('normalizes and completes a leased run with its fencing token', async () => {
    const run = leasedRun();
    const episode = sourceEpisode();
    const expected = new ExperienceTraceNormalizer().normalize(episode).trace;
    const complete = vi.fn(() => Promise.resolve(true));
    const runs = runRepository({ claim: () => Promise.resolve([run]), complete });
    const repository = compilationRepository({
      findSourceEpisode: () => Promise.resolve(episode),
      findTraceBySource: () => Promise.resolve(undefined),
      saveTrace: (report) => Promise.resolve({ trace: report.trace, inserted: true }),
    });
    const service = new ExperienceNormalizationService({
      runs,
      repository,
      normalizer: new ExperienceTraceNormalizer(),
      clock: { now: () => now },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await expect(service.claim('worker-1')).resolves.toEqual([run]);
    await service.process(run, 'worker-1');

    expect(complete).toHaveBeenCalledWith(
      run.runId,
      'worker-1',
      'lease-token-1',
      expected.traceId,
      now,
    );
  });

  it('reuses a persisted Trace and does not normalize the Episode twice', async () => {
    const trace = persistedTrace();
    const normalize = vi.fn();
    const complete = vi.fn(() => Promise.resolve(true));
    const service = new ExperienceNormalizationService({
      runs: runRepository({ complete }),
      repository: compilationRepository({
        findSourceEpisode: () => Promise.resolve(sourceEpisode()),
        findTraceBySource: () => Promise.resolve(trace),
      }),
      normalizer: { normalize },
      clock: { now: () => now },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await service.process(leasedRun(), 'worker-1');

    expect(normalize).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(
      'normalization-run-1',
      'worker-1',
      'lease-token-1',
      trace.traceId,
      now,
    );
  });

  it('records bounded retry and redacts secret material on failure', async () => {
    const fail = vi.fn(() => Promise.resolve(true));
    const service = new ExperienceNormalizationService({
      runs: runRepository({ fail }),
      repository: compilationRepository({
        findSourceEpisode: () =>
          Promise.reject(
            Object.assign(new Error('password=top-secret'), { code: 'SOURCE_FAILED' }),
          ),
      }),
      normalizer: new ExperienceTraceNormalizer(),
      clock: { now: () => now },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await service.process(leasedRun(), 'worker-1');

    expect(fail).toHaveBeenCalledWith(
      'normalization-run-1',
      'worker-1',
      'lease-token-1',
      'SOURCE_FAILED',
      'password=[REDACTED]',
      now,
      '2026-07-27T02:00:01.000Z',
    );
  });

  it('rebuilds lost Redis wakes from PostgreSQL requeueable runs', async () => {
    const enqueue = vi.fn(() => Promise.resolve());
    const reconciler = new CompilationRunReconciler({
      runs: runRepository({ listRequeueable: () => Promise.resolve([leasedRun()]) }),
      queue: { enqueue },
      runType: 'normalization',
    });

    await expect(reconciler.requeue(now)).resolves.toBe(1);
    expect(enqueue).toHaveBeenCalledWith('normalization-run-1');
  });
});

function leasedRun(): CompilationRun {
  return {
    runId: 'normalization-run-1',
    runType: 'normalization',
    sourceEpisodeId: 'episode-1',
    status: 'leased',
    attempt: 1,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: 'worker-1',
    leaseToken: 'lease-token-1',
    leaseExpiresAt: '2026-07-27T02:01:00.000Z',
    idempotencyKey: 'normalization:episode-1',
    payload: { sourceEpisodeId: 'episode-1' },
    createdAt: now,
    updatedAt: now,
  };
}

function sourceEpisode() {
  return createGoalExperienceEpisode({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    episodeId: 'episode-1',
    goalId: 'goal-1',
    goalVersion: 1,
    taskId: 'task-1',
    contextId: 'context-1',
    episodeType: 'terminal',
    revision: 1,
    terminalOutcomeRef: 'runtime-terminal-outcome:outcome-1',
    sourceHash: sha('a'),
    episodeHash: sha('b'),
    completeness: 1,
    status: 'complete',
    dataClassification: 'internal',
    snapshot: {
      task: {
        taskId: 'task-1',
        contextId: 'context-1',
        tenantId: 'tenant-1',
        taskTypeId: 'task-type-1',
        createdAt: now,
      },
      contract: { goalId: 'goal-1', createdAt: now },
      terminalOutcome: {
        outcomeId: 'outcome-1',
        controlStatus: 'completed',
        committedAt: now,
      },
    },
    sourceRefs: [
      createCognitiveSourceRef({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        sourceRefId: 'source-1',
        sourceKind: 'runtime_terminal_outcome',
        sourceId: 'outcome-1',
        sourceRevision: 1,
        authority: 'runtime_fact',
        dataClassification: 'internal',
        capturedAt: now,
      }),
    ],
    redactionCodes: [],
    createdAt: now,
  });
}

function persistedTrace(): ExperienceTrace {
  return createExperienceTrace({
    traceId: 'trace-1',
    sourceEpisodeId: 'episode-1',
    taskTypeRefs: ['task-type-1'],
    goalFingerprint: sha('c'),
    capabilityFingerprint: sha('d'),
    environmentFingerprint: sha('e'),
    trace: {
      schemaVersion: EXPERIENCE_COMPILATION_CONTRACT_VERSION,
      tenantId: 'tenant-1',
      events: [],
      correctionRefs: [],
      outcomeStatus: 'unknown',
      missingFactCodes: [],
      environmentClass: 'server',
    },
    completeness: 1,
    dataClassification: 'internal',
    normalizerVersion: EXPERIENCE_NORMALIZER_VERSION,
    sourceHash: sha('a'),
    createdAt: now,
  });
}

function runRepository(overrides: Partial<CompilationRunRepository>): CompilationRunRepository {
  return {
    createNormalizationRun: () => Promise.resolve(leasedRun()),
    createProcessMiningRun: () => Promise.resolve(leasedRun()),
    claim: () => Promise.resolve([]),
    complete: () => Promise.resolve(true),
    fail: () => Promise.resolve(true),
    listRequeueable: () => Promise.resolve([]),
    ...overrides,
  };
}

function compilationRepository(
  overrides: Partial<ExperienceCompilationRepository>,
): ExperienceCompilationRepository {
  return {
    findSourceEpisode: () => Promise.resolve(sourceEpisode()),
    findTrace: () => Promise.resolve(undefined),
    findTraceBySource: () => Promise.resolve(undefined),
    saveTrace: (report) => Promise.resolve({ trace: report.trace, inserted: true }),
    listTraces: () => Promise.resolve([]),
    saveProcessMiningResult: (result) =>
      Promise.resolve({
        workflowPattern: result.workflowPattern,
        inserted: true,
      }),
    deleteUserScope: () => Promise.resolve(0),
    ...overrides,
  };
}
