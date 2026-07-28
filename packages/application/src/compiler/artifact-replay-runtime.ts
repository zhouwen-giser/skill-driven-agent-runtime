import type {
  ArtifactReplayCase,
  ArtifactValidationResult,
  CandidateStaticValidationResult,
  CompiledArtifact,
  ReplayDatasetManifest,
  UserGoalCompletionContract,
  UserGoalPlan,
} from '../../../domain/src/index.js';
import {
  ArtifactReplayValidationEngine,
  PlanReplayEvaluator,
  type HistoricalReplayOutcome,
  type ReplayAuthorityDecision,
} from './artifact-replay-validator.js';
import {
  ArtifactReplayCaseBuilder,
  ReplayDatasetBuilder,
  type ArtifactReplaySource,
  type ReplayDatasetBuild,
} from './replay-dataset.js';

export type ReplayValidationWorkState =
  'pending' | 'leased' | 'retry_wait' | 'completed' | 'dead_letter' | 'canceled';

export interface ReplayValidationRunRecord {
  readonly validationRunId: string;
  readonly tenantId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactHash: string;
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly datasetHash: string;
  readonly workState: ReplayValidationWorkState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly cancelRequestedAt?: string;
  readonly idempotencyKey: string;
  readonly lastErrorCode?: string;
  readonly lastErrorSummary?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReplayValidationTrigger {
  readonly triggerId: string;
  readonly tenantId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactHash: string;
  readonly taskTypeId: string;
  readonly candidateSourceTraceRefs: readonly string[];
  readonly occurredAt: string;
}

export interface ReplayValidationCaseFixture {
  readonly sourceEpisodeRef: string;
  readonly goalContract: UserGoalCompletionContract;
  readonly parameterValues: Readonly<Record<string, unknown>>;
  readonly knownCapabilityIds: readonly string[];
  readonly readyCapabilityIds: readonly string[];
  readonly authorityDecision: ReplayAuthorityDecision;
  readonly historical: HistoricalReplayOutcome;
  readonly acceptedPlan?: UserGoalPlan;
}

export interface ReplayValidationSource {
  readonly source: ArtifactReplaySource;
  readonly fixture: ReplayValidationCaseFixture;
}

export interface ReplayValidationWork {
  readonly artifact: CompiledArtifact;
  readonly staticValidation: CandidateStaticValidationResult;
  readonly dataset: ReplayDatasetManifest;
  readonly cases: readonly ArtifactReplayCase[];
  readonly fixtures: Readonly<Record<string, ReplayValidationCaseFixture>>;
}

export interface ReplayValidationCompletion {
  readonly validationResult: ArtifactValidationResult;
  readonly caseEvaluations: readonly ReturnType<PlanReplayEvaluator['evaluate']>[];
  readonly failures: ReturnType<PlanReplayEvaluator['evaluate']>['failures'];
  readonly counterexamples: ReturnType<PlanReplayEvaluator['evaluate']>['counterexamples'];
}

export interface ReplayValidationRepository {
  listPendingTriggers(limit?: number): Promise<readonly ReplayValidationTrigger[]>;
  listSources(trigger: ReplayValidationTrigger): Promise<readonly ReplayValidationSource[]>;
  persistDatasetAndCreateRun(
    trigger: ReplayValidationTrigger,
    build: ReplayDatasetBuild,
    fixtures: Readonly<Record<string, ReplayValidationCaseFixture>>,
    now: string,
    maxAttempts?: number,
  ): Promise<ReplayValidationRunRecord>;
  claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ReplayValidationRunRecord[]>;
  loadWork(run: ReplayValidationRunRecord): Promise<ReplayValidationWork | undefined>;
  completeAtomically(
    run: ReplayValidationRunRecord,
    workerId: string,
    leaseToken: string,
    completion: ReplayValidationCompletion,
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
  listRequeueable(now: string, limit?: number): Promise<readonly ReplayValidationRunRecord[]>;
  requestCancellation(runId: string, now: string): Promise<boolean>;
  purgeTenant(tenantId: string): Promise<number>;
  purgeExpired(now: string, limit?: number): Promise<number>;
}

export interface ReplayValidationWakeQueue {
  enqueue(validationRunId: string): Promise<void>;
}

export class ReplayValidationTriggerDispatcher {
  constructor(
    private readonly repository: ReplayValidationRepository,
    private readonly queue: ReplayValidationWakeQueue,
    private readonly clock: Readonly<{ now(): string }>,
  ) {}

  async dispatch(limit = 100): Promise<number> {
    const triggers = await this.repository.listPendingTriggers(limit);
    let dispatched = 0;
    for (const trigger of triggers) {
      const sources = await this.repository.listSources(trigger);
      const caseBuilder = new ArtifactReplayCaseBuilder();
      const builtCases = sources.map((source) => caseBuilder.build(source.source));
      const build = new ReplayDatasetBuilder().build({
        tenantId: trigger.tenantId,
        datasetVersion: 1,
        cases: builtCases,
        candidateSourceTraceRefs: trigger.candidateSourceTraceRefs,
        createdAt: this.clock.now(),
      });
      const fixtureByEpisode = new Map(
        sources.map((source) => [source.fixture.sourceEpisodeRef, source.fixture]),
      );
      const fixtures = Object.fromEntries(
        build.cases.map((replayCase) => {
          const fixture = replayCase.sourceEpisodeRefs
            .map((reference) => fixtureByEpisode.get(reference))
            .find((value) => value !== undefined);
          if (fixture === undefined) {
            throw new Error(`REPLAY_CASE_FIXTURE_MISSING:${replayCase.replayCaseId}`);
          }
          return [replayCase.replayCaseId, fixture];
        }),
      );
      const run = await this.repository.persistDatasetAndCreateRun(
        trigger,
        build,
        Object.freeze(fixtures),
        this.clock.now(),
      );
      await this.queue.enqueue(run.validationRunId);
      dispatched += 1;
    }
    return dispatched;
  }
}

export class ArtifactReplayValidationApplicationService {
  constructor(
    private readonly repository: ReplayValidationRepository,
    private readonly clock: Readonly<{ now(): string }>,
    private readonly retryPolicy: Readonly<{
      maxAttempts: number;
      baseBackoffMs: number;
      maxBackoffMs: number;
    }>,
    private readonly evaluator: PlanReplayEvaluator = new PlanReplayEvaluator(),
    private readonly engine: ArtifactReplayValidationEngine = new ArtifactReplayValidationEngine(),
  ) {}

  claim(workerId: string, limit = 1): Promise<readonly ReplayValidationRunRecord[]> {
    return this.repository.claim(workerId, this.clock.now(), 120_000, limit);
  }

  async process(run: ReplayValidationRunRecord, workerId: string): Promise<void> {
    if (run.workState !== 'leased') return;
    const leaseToken = requiredLeaseToken(run);
    try {
      if (run.cancelRequestedAt !== undefined) {
        throw codedError('ARTIFACT_REPLAY_VALIDATION_CANCELED');
      }
      const work = await this.repository.loadWork(run);
      if (work === undefined) throw codedError('ARTIFACT_REPLAY_VALIDATION_SOURCE_NOT_FOUND');
      if (
        work.artifact.contentHash !== run.artifactHash ||
        work.dataset.contentHash !== run.datasetHash ||
        work.dataset.datasetVersion !== run.datasetVersion
      ) {
        throw codedError('ARTIFACT_REPLAY_VALIDATION_STALE_PIN');
      }
      const evaluatedAt = this.clock.now();
      const caseEvaluations = work.cases.map((replayCase) => {
        const fixture = work.fixtures[replayCase.replayCaseId];
        if (fixture === undefined) {
          throw codedError(`ARTIFACT_REPLAY_VALIDATION_FIXTURE_MISSING:${replayCase.replayCaseId}`);
        }
        return this.evaluator.evaluate({
          validationRunId: run.validationRunId,
          replayCase,
          artifact: work.artifact,
          staticValidation: work.staticValidation,
          goalContract: fixture.goalContract,
          parameterValues: fixture.parameterValues,
          knownCapabilityIds: fixture.knownCapabilityIds,
          readyCapabilityIds: fixture.readyCapabilityIds,
          authorityDecision: fixture.authorityDecision,
          historical: fixture.historical,
          ...(fixture.acceptedPlan === undefined ? {} : { acceptedPlan: fixture.acceptedPlan }),
          evaluatedAt,
        });
      });
      const validated = this.engine.validate({
        validationRunId: run.validationRunId,
        artifact: work.artifact,
        dataset: work.dataset,
        evaluations: caseEvaluations,
        completedAt: this.clock.now(),
      });
      const completed = await this.repository.completeAtomically(
        run,
        workerId,
        leaseToken,
        {
          validationResult: validated.result,
          caseEvaluations,
          failures: validated.failures,
          counterexamples: validated.counterexamples,
        },
        this.clock.now(),
      );
      if (!completed) throw codedError('ARTIFACT_REPLAY_VALIDATION_FENCE_REJECTED');
    } catch (error: unknown) {
      await this.fail(run, workerId, leaseToken, error);
    }
  }

  private async fail(
    run: ReplayValidationRunRecord,
    workerId: string,
    leaseToken: string,
    error: unknown,
  ): Promise<void> {
    const now = this.clock.now();
    const canceled = errorCode(error) === 'ARTIFACT_REPLAY_VALIDATION_CANCELED';
    const stale = errorCode(error) === 'ARTIFACT_REPLAY_VALIDATION_STALE_PIN';
    const attemptLimit = Math.min(run.maxAttempts, this.retryPolicy.maxAttempts);
    const retryAt =
      canceled || stale || run.attempt >= attemptLimit
        ? undefined
        : new Date(
            Date.parse(now) +
              Math.min(
                this.retryPolicy.maxBackoffMs,
                this.retryPolicy.baseBackoffMs * 2 ** Math.max(0, run.attempt - 1),
              ),
          ).toISOString();
    await this.repository.fail(
      run.validationRunId,
      workerId,
      leaseToken,
      errorCode(error),
      errorSummary(error),
      now,
      retryAt,
    );
  }
}

export class ReplayValidationRunReconciler {
  constructor(
    private readonly repository: ReplayValidationRepository,
    private readonly queue: ReplayValidationWakeQueue,
  ) {}

  async requeue(now: string, limit = 100): Promise<number> {
    const runs = await this.repository.listRequeueable(now, limit);
    for (const run of runs) await this.queue.enqueue(run.validationRunId);
    return runs.length;
  }
}

function requiredLeaseToken(run: ReplayValidationRunRecord): string {
  if (run.leaseToken === undefined) {
    throw codedError('ARTIFACT_REPLAY_VALIDATION_LEASE_TOKEN_MISSING');
  }
  return run.leaseToken;
}

function codedError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(code), { code });
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code.split(':')[0]?.slice(0, 128) ?? 'ARTIFACT_REPLAY_VALIDATION_FAILED';
  }
  if (error instanceof Error) {
    const prefix = error.message.split(':')[0] ?? '';
    if (/^[A-Z0-9_]+$/u.test(prefix)) return prefix.slice(0, 128);
  }
  return 'ARTIFACT_REPLAY_VALIDATION_FAILED';
}

function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : 'Artifact replay validation failed.')
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2_048);
}
