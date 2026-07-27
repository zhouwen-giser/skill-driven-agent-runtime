import { describe, expect, it, vi } from 'vitest';

import {
  COGNITIVE_SCHEMA_VERSION,
  EXPERIENCE_COMPILATION_CONTRACT_VERSION,
  EXPERIENCE_NORMALIZER_VERSION,
  createCohortDefinition,
  createCognitiveSourceRef,
  createExperienceTrace,
  createGoalExperienceEpisode,
  type ExperienceTrace,
} from '../../domain/src/index.js';
import {
  CompilationRunReconciler,
  ExperienceCompilationTriggerDispatcher,
  ExperienceNormalizationService,
  ProcessMiningService,
  type CompilationRun,
  type CompilationRunRepository,
  type ExperienceCompilationRepository,
  type ProcessMiningResult,
} from '../src/compiler/experience-compilation.js';
import { ExperienceTraceNormalizer } from '../src/compiler/experience-normalizer.js';
import { DeterministicProcessMiner } from '../src/compiler/process-miner.js';

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

  it('dispatches formal Episode and Trace events into the two durable compiler queues', async () => {
    const cohort = createCohortDefinition({
      tenantId: 'tenant-1',
      taskTypeId: 'task-type-1',
      minimumCompleteness: 0.5,
    });
    const miner = new DeterministicProcessMiner();
    const normalizationRun = leasedRun();
    const processMiningRun = miningRun(miner.fingerprintCohort(cohort), cohort);
    const createNormalizationRun = vi.fn(() => Promise.resolve(normalizationRun));
    const createProcessMiningRun = vi.fn(() => Promise.resolve(processMiningRun));
    const enqueueNormalization = vi.fn(() => Promise.resolve());
    const enqueueMining = vi.fn(() => Promise.resolve());
    const dispatcher = new ExperienceCompilationTriggerDispatcher({
      source: {
        listPending: () =>
          Promise.resolve([
            {
              triggerId: 'event-episode-1',
              runType: 'normalization' as const,
              sourceEpisodeId: 'episode-1',
              occurredAt: now,
            },
            {
              triggerIds: ['event-trace-1', 'event-trace-2'],
              runType: 'process_mining' as const,
              cohort,
              occurredAt: now,
            },
          ]),
      },
      runs: runRepository({ createNormalizationRun, createProcessMiningRun }),
      normalizationQueue: { enqueue: enqueueNormalization },
      miningQueue: { enqueue: enqueueMining },
      miner,
      clock: { now: () => now },
    });

    await expect(dispatcher.dispatch()).resolves.toBe(2);
    expect(createNormalizationRun).toHaveBeenCalledWith('episode-1', now, 5, 'event-episode-1');
    expect(createProcessMiningRun).toHaveBeenCalledWith(
      cohort,
      miner.fingerprintCohort(cohort),
      now,
      5,
      ['event-trace-1', 'event-trace-2'],
    );
    expect(enqueueNormalization).toHaveBeenCalledWith(normalizationRun.runId);
    expect(enqueueMining).toHaveBeenCalledWith(processMiningRun.runId);
  });

  it('mines and persists a leased cohort run with the exact cohort fingerprint', async () => {
    const cohort = createCohortDefinition({
      tenantId: 'tenant-1',
      taskTypeId: 'task-type-1',
      minimumCompleteness: 0.8,
    });
    const miner = new DeterministicProcessMiner();
    const cohortFingerprint = miner.fingerprintCohort(cohort);
    const run = miningRun(cohortFingerprint, cohort);
    const complete = vi.fn(() => Promise.resolve(true));
    const saveProcessMiningResult = vi.fn((result: ProcessMiningResult) =>
      Promise.resolve({ workflowPattern: result.workflowPattern, inserted: true }),
    );
    const service = new ProcessMiningService({
      runs: runRepository({ complete }),
      repository: compilationRepository({
        listTraces: () => Promise.resolve([persistedTrace()]),
        saveProcessMiningResult,
      }),
      miner,
      clock: { now: () => now },
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await service.process(run, 'worker-1');

    expect(saveProcessMiningResult).toHaveBeenCalledOnce();
    const result = await miner.discover(cohort, [persistedTrace()]);
    expect(complete).toHaveBeenCalledWith(
      run.runId,
      'worker-1',
      'mining-lease-token-1',
      result.workflowPattern.workflowPatternId,
      now,
    );
  });

  it('fails closed when a mining run payload does not match its durable fingerprint', async () => {
    const cohort = createCohortDefinition({
      tenantId: 'tenant-1',
      taskTypeId: 'task-type-1',
      minimumCompleteness: 0.8,
    });
    const fail = vi.fn(() => Promise.resolve(true));
    const service = new ProcessMiningService({
      runs: runRepository({ fail }),
      repository: compilationRepository({}),
      miner: new DeterministicProcessMiner(),
      clock: { now: () => now },
      retryPolicy: { maxAttempts: 1, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });

    await service.process(miningRun(sha('f'), cohort), 'worker-1');

    expect(fail).toHaveBeenCalledWith(
      'mining-run-1',
      'worker-1',
      'mining-lease-token-1',
      'PROCESS_MINING_COHORT_FINGERPRINT_MISMATCH',
      'PROCESS_MINING_COHORT_FINGERPRINT_MISMATCH',
      now,
      undefined,
    );
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

function miningRun(
  cohortFingerprint: string,
  cohort: ReturnType<typeof createCohortDefinition>,
): CompilationRun {
  return {
    runId: 'mining-run-1',
    runType: 'process_mining',
    tenantId: cohort.tenantId,
    cohortFingerprint,
    status: 'leased',
    attempt: 1,
    maxAttempts: 3,
    availableAt: now,
    leaseOwner: 'worker-1',
    leaseToken: 'mining-lease-token-1',
    leaseExpiresAt: '2026-07-27T02:02:00.000Z',
    idempotencyKey: `process-mining:${cohortFingerprint}:${now}`,
    payload: {
      cohort: {
        tenantId: cohort.tenantId,
        taskTypeId: cohort.taskTypeId,
        minimumCompleteness: cohort.minimumCompleteness,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
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
      events: [
        {
          eventId: 'event-goal-created',
          sequence: 0,
          occurredAt: now,
          eventType: 'goal_created',
          actorType: 'runtime',
          capabilityRefs: [],
          authorityRefs: ['source-1'],
          parentEventRefs: [],
          payloadSummary: {},
        },
        {
          eventId: 'event-goal-completed',
          sequence: 1,
          occurredAt: '2026-07-27T02:00:01.000Z',
          eventType: 'goal_completed',
          actorType: 'runtime',
          capabilityRefs: [],
          authorityRefs: ['source-2'],
          parentEventRefs: ['event-goal-created'],
          payloadSummary: {},
        },
      ],
      correctionRefs: [],
      outcomeStatus: 'succeeded',
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
    findWorkflowPattern: () => Promise.resolve(undefined),
    deleteUserScope: () => Promise.resolve(0),
    ...overrides,
  };
}
