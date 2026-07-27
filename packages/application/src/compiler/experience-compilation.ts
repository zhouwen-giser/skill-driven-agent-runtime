import {
  EXPERIENCE_NORMALIZER_VERSION,
  createCohortDefinition,
} from '../../../domain/src/index.js';
import type {
  CohortDefinition,
  DiscoveredProcessPattern,
  ExperienceTrace,
  GoalExperienceEpisode,
  ProcessVariant,
  WorkflowPattern,
} from '../../../domain/src/index.js';
import type { JsonObject } from '../../../domain/src/compiler/contracts.js';
import type {
  ExperienceTraceNormalizer,
  ExperienceTraceNormalizationReport,
} from './experience-normalizer.js';
import type { DeterministicProcessMiner } from './process-miner.js';

export type CompilationRunType = 'normalization' | 'process_mining';
export type CompilationRunStatus =
  'pending' | 'leased' | 'retry_wait' | 'completed' | 'dead_letter';

export interface CompilationRun {
  readonly runId: string;
  readonly runType: CompilationRunType;
  readonly sourceEpisodeId?: string;
  readonly sourceEventId?: string;
  readonly tenantId?: string;
  readonly userScopeId?: string;
  readonly cohortFingerprint?: string;
  readonly status: CompilationRunStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly idempotencyKey: string;
  readonly payload: JsonObject;
  readonly resultRef?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorSummary?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProcessMiningResult {
  readonly cohort: CohortDefinition;
  readonly cohortFingerprint: string;
  readonly variants: readonly ProcessVariant[];
  readonly discoveredPattern: DiscoveredProcessPattern;
  readonly workflowPattern: WorkflowPattern;
}

export interface ExperienceCompilationRepository {
  findSourceEpisode(episodeId: string): Promise<GoalExperienceEpisode | undefined>;
  findTrace(traceId: string): Promise<ExperienceTrace | undefined>;
  findTraceBySource(
    sourceEpisodeId: string,
    normalizerVersion: string,
    sourceHash: string,
  ): Promise<ExperienceTrace | undefined>;
  saveTrace(
    report: ExperienceTraceNormalizationReport,
  ): Promise<Readonly<{ trace: ExperienceTrace; inserted: boolean }>>;
  listTraces(cohort: CohortDefinition, limit?: number): Promise<readonly ExperienceTrace[]>;
  saveProcessMiningResult(
    result: ProcessMiningResult,
    createdAt: string,
  ): Promise<Readonly<{ workflowPattern: WorkflowPattern; inserted: boolean }>>;
  findWorkflowPattern(
    tenantId: string,
    workflowPatternId: string,
  ): Promise<WorkflowPattern | undefined>;
  deleteUserScope(userScopeId: string, actorId: string): Promise<number>;
}

export interface CompilationRunRepository {
  createNormalizationRun(
    sourceEpisodeId: string,
    now: string,
    maxAttempts?: number,
    sourceEventId?: string,
  ): Promise<CompilationRun>;
  createProcessMiningRun(
    cohort: CohortDefinition,
    cohortFingerprint: string,
    now: string,
    maxAttempts?: number,
    sourceEventId?: string,
  ): Promise<CompilationRun>;
  claim(
    runType: CompilationRunType,
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly CompilationRun[]>;
  complete(
    runId: string,
    workerId: string,
    leaseToken: string,
    resultRef: string,
    now: string,
  ): Promise<boolean>;
  fail(
    runId: string,
    workerId: string,
    leaseToken: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<boolean>;
  listRequeueable(
    runType: CompilationRunType,
    now: string,
    limit?: number,
  ): Promise<readonly CompilationRun[]>;
}

export interface CompilationWakeQueuePort {
  enqueue(runId: string): Promise<void>;
}

export type ExperienceCompilationTrigger =
  | Readonly<{
      triggerId: string;
      runType: 'normalization';
      sourceEpisodeId: string;
      occurredAt: string;
    }>
  | Readonly<{
      triggerId: string;
      runType: 'process_mining';
      cohort: CohortDefinition;
      occurredAt: string;
    }>;

export interface ExperienceCompilationTriggerSource {
  listPending(limit?: number): Promise<readonly ExperienceCompilationTrigger[]>;
}

export class ExperienceCompilationTriggerDispatcher {
  readonly #source: ExperienceCompilationTriggerSource;
  readonly #runs: CompilationRunRepository;
  readonly #normalizationQueue: CompilationWakeQueuePort;
  readonly #miningQueue: CompilationWakeQueuePort;
  readonly #miner: Pick<DeterministicProcessMiner, 'fingerprintCohort'>;

  constructor(
    dependencies: Readonly<{
      source: ExperienceCompilationTriggerSource;
      runs: CompilationRunRepository;
      normalizationQueue: CompilationWakeQueuePort;
      miningQueue: CompilationWakeQueuePort;
      miner: Pick<DeterministicProcessMiner, 'fingerprintCohort'>;
    }>,
  ) {
    this.#source = dependencies.source;
    this.#runs = dependencies.runs;
    this.#normalizationQueue = dependencies.normalizationQueue;
    this.#miningQueue = dependencies.miningQueue;
    this.#miner = dependencies.miner;
  }

  async dispatch(limit = 100): Promise<number> {
    const triggers = await this.#source.listPending(limit);
    for (const trigger of triggers) {
      if (trigger.runType === 'normalization') {
        const run = await this.#runs.createNormalizationRun(
          trigger.sourceEpisodeId,
          trigger.occurredAt,
          5,
          trigger.triggerId,
        );
        await this.#normalizationQueue.enqueue(run.runId);
      } else {
        const run = await this.#runs.createProcessMiningRun(
          trigger.cohort,
          this.#miner.fingerprintCohort(trigger.cohort),
          trigger.occurredAt,
          5,
          trigger.triggerId,
        );
        await this.#miningQueue.enqueue(run.runId);
      }
    }
    return triggers.length;
  }
}

export class ExperienceNormalizationService {
  readonly #runs: CompilationRunRepository;
  readonly #repository: ExperienceCompilationRepository;
  readonly #normalizer: Pick<ExperienceTraceNormalizer, 'normalize'>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #retryPolicy: Readonly<{
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  }>;

  constructor(
    dependencies: Readonly<{
      runs: CompilationRunRepository;
      repository: ExperienceCompilationRepository;
      normalizer: Pick<ExperienceTraceNormalizer, 'normalize'>;
      clock: Readonly<{ now(): string }>;
      retryPolicy: Readonly<{
        maxAttempts: number;
        baseBackoffMs: number;
        maxBackoffMs: number;
      }>;
    }>,
  ) {
    this.#runs = dependencies.runs;
    this.#repository = dependencies.repository;
    this.#normalizer = dependencies.normalizer;
    this.#clock = dependencies.clock;
    this.#retryPolicy = dependencies.retryPolicy;
  }

  claim(workerId: string, limit = 1): Promise<readonly CompilationRun[]> {
    return this.#runs.claim('normalization', workerId, this.#clock.now(), 60_000, limit);
  }

  async process(run: CompilationRun, workerId: string): Promise<void> {
    if (run.runType !== 'normalization' || run.status !== 'leased') return;
    const leaseToken = requiredLeaseToken(run);
    try {
      const sourceEpisodeId =
        run.sourceEpisodeId ?? requiredString(run.payload['sourceEpisodeId'], 'sourceEpisodeId');
      const episode = await this.#repository.findSourceEpisode(sourceEpisodeId);
      if (episode === undefined) throw codedError('EXPERIENCE_COMPILATION_EPISODE_NOT_FOUND');
      const existing = await this.#repository.findTraceBySource(
        episode.episodeId,
        EXPERIENCE_NORMALIZER_VERSION,
        episode.sourceHash,
      );
      const trace =
        existing ?? (await this.#repository.saveTrace(this.#normalizer.normalize(episode))).trace;
      await this.#runs.complete(run.runId, workerId, leaseToken, trace.traceId, this.#clock.now());
    } catch (error: unknown) {
      await this.#fail(run, workerId, leaseToken, error);
    }
  }

  async #fail(
    run: CompilationRun,
    workerId: string,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const now = this.#clock.now();
    const attemptLimit = Math.min(run.maxAttempts, this.#retryPolicy.maxAttempts);
    const retryAt =
      run.attempt >= attemptLimit
        ? undefined
        : new Date(
            Date.parse(now) +
              Math.min(
                this.#retryPolicy.maxBackoffMs,
                this.#retryPolicy.baseBackoffMs * 2 ** Math.max(0, run.attempt - 1),
              ),
          ).toISOString();
    await this.#runs.fail(
      run.runId,
      workerId,
      leaseToken,
      errorCode(error),
      errorSummary(error),
      now,
      retryAt,
    );
  }
}

export class ProcessMiningService {
  readonly #runs: CompilationRunRepository;
  readonly #repository: ExperienceCompilationRepository;
  readonly #miner: Pick<DeterministicProcessMiner, 'fingerprintCohort' | 'discover'>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #retryPolicy: Readonly<{
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  }>;

  constructor(
    dependencies: Readonly<{
      runs: CompilationRunRepository;
      repository: ExperienceCompilationRepository;
      miner: Pick<DeterministicProcessMiner, 'fingerprintCohort' | 'discover'>;
      clock: Readonly<{ now(): string }>;
      retryPolicy: Readonly<{
        maxAttempts: number;
        baseBackoffMs: number;
        maxBackoffMs: number;
      }>;
    }>,
  ) {
    this.#runs = dependencies.runs;
    this.#repository = dependencies.repository;
    this.#miner = dependencies.miner;
    this.#clock = dependencies.clock;
    this.#retryPolicy = dependencies.retryPolicy;
  }

  claim(workerId: string, limit = 1): Promise<readonly CompilationRun[]> {
    return this.#runs.claim('process_mining', workerId, this.#clock.now(), 120_000, limit);
  }

  async process(run: CompilationRun, workerId: string): Promise<void> {
    if (run.runType !== 'process_mining' || run.status !== 'leased') return;
    const leaseToken = requiredLeaseToken(run);
    try {
      const cohort = cohortFromPayload(run.payload['cohort']);
      const cohortFingerprint = this.#miner.fingerprintCohort(cohort);
      if (run.cohortFingerprint === undefined || run.cohortFingerprint !== cohortFingerprint) {
        throw codedError('PROCESS_MINING_COHORT_FINGERPRINT_MISMATCH');
      }
      const traces = await this.#repository.listTraces(cohort, 10_000);
      const result = this.#miner.discover(cohort, traces);
      if (result.cohortFingerprint !== cohortFingerprint) {
        throw codedError('PROCESS_MINING_RESULT_FINGERPRINT_MISMATCH');
      }
      const persisted = await this.#repository.saveProcessMiningResult(result, this.#clock.now());
      await this.#runs.complete(
        run.runId,
        workerId,
        leaseToken,
        persisted.workflowPattern.workflowPatternId,
        this.#clock.now(),
      );
    } catch (error: unknown) {
      await this.#fail(run, workerId, leaseToken, error);
    }
  }

  async #fail(
    run: CompilationRun,
    workerId: string,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const now = this.#clock.now();
    const attemptLimit = Math.min(run.maxAttempts, this.#retryPolicy.maxAttempts);
    const retryAt =
      run.attempt >= attemptLimit
        ? undefined
        : new Date(
            Date.parse(now) +
              Math.min(
                this.#retryPolicy.maxBackoffMs,
                this.#retryPolicy.baseBackoffMs * 2 ** Math.max(0, run.attempt - 1),
              ),
          ).toISOString();
    await this.#runs.fail(
      run.runId,
      workerId,
      leaseToken,
      errorCode(error),
      errorSummary(error),
      now,
      retryAt,
    );
  }
}

export class CompilationRunReconciler {
  readonly #runs: CompilationRunRepository;
  readonly #queue: CompilationWakeQueuePort;
  readonly #runType: CompilationRunType;

  constructor(
    dependencies: Readonly<{
      runs: CompilationRunRepository;
      queue: CompilationWakeQueuePort;
      runType: CompilationRunType;
    }>,
  ) {
    this.#runs = dependencies.runs;
    this.#queue = dependencies.queue;
    this.#runType = dependencies.runType;
  }

  async requeue(now: string, limit = 100): Promise<number> {
    const runs = await this.#runs.listRequeueable(this.#runType, now, limit);
    for (const run of runs) await this.#queue.enqueue(run.runId);
    return runs.length;
  }
}

function cohortFromPayload(value: unknown): CohortDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw codedError('PROCESS_MINING_COHORT_PAYLOAD_INVALID');
  }
  const input = value as Readonly<Record<string, unknown>>;
  assertExactRecordKeys(
    input,
    [
      'tenantId',
      'taskTypeId',
      'goalFingerprint',
      'capabilityFingerprint',
      'environmentClass',
      'deviceClass',
      'timeRange',
      'minimumCompleteness',
    ],
    'PROCESS_MINING_COHORT_PAYLOAD_INVALID',
  );
  const tenantId = requiredString(input['tenantId'], 'tenantId');
  const taskTypeId = requiredString(input['taskTypeId'], 'taskTypeId');
  const goalFingerprint = optionalString(input['goalFingerprint']);
  const capabilityFingerprint = optionalString(input['capabilityFingerprint']);
  const environmentClass = optionalString(input['environmentClass']);
  const deviceClass = optionalString(input['deviceClass']);
  const minimumCompleteness = input['minimumCompleteness'];
  if (typeof minimumCompleteness !== 'number') {
    throw codedError('PROCESS_MINING_MINIMUM_COMPLETENESS_INVALID');
  }
  const timeRangeValue = input['timeRange'];
  let timeRange: CohortDefinition['timeRange'];
  if (timeRangeValue !== undefined) {
    if (
      typeof timeRangeValue !== 'object' ||
      timeRangeValue === null ||
      Array.isArray(timeRangeValue)
    ) {
      throw codedError('PROCESS_MINING_TIME_RANGE_INVALID');
    }
    const timeRangeInput = timeRangeValue as Readonly<Record<string, unknown>>;
    assertExactRecordKeys(timeRangeInput, ['from', 'to'], 'PROCESS_MINING_TIME_RANGE_INVALID');
    timeRange = {
      from: requiredString(timeRangeInput['from'], 'timeRange.from'),
      to: requiredString(timeRangeInput['to'], 'timeRange.to'),
    };
  }
  return createCohortDefinition({
    tenantId,
    taskTypeId,
    ...(goalFingerprint === undefined ? {} : { goalFingerprint }),
    ...(capabilityFingerprint === undefined ? {} : { capabilityFingerprint }),
    ...(environmentClass === undefined ? {} : { environmentClass }),
    ...(deviceClass === undefined ? {} : { deviceClass }),
    ...(timeRange === undefined ? {} : { timeRange }),
    minimumCompleteness,
  });
}

function assertExactRecordKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw codedError(code);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredLeaseToken(run: CompilationRun): string {
  if (run.leaseToken === undefined) throw codedError('EXPERIENCE_COMPILATION_LEASE_TOKEN_MISSING');
  return run.leaseToken;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw codedError(`EXPERIENCE_COMPILATION_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code.slice(0, 128);
  }
  return 'EXPERIENCE_COMPILATION_FAILED';
}

function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : 'Experience compilation failed.')
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2048);
}
