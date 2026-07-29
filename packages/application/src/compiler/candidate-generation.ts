import type {
  CandidateStaticValidationResult,
  DiscoveredProcessPattern,
  FusedPattern,
  GeneralizedPattern,
  PatternScopeEvidence,
  WorkflowPattern,
} from '../../../domain/src/index.js';
import type { JsonObject } from '../../../domain/src/compiler/contracts.js';
import type { ArtifactCandidatePersistence } from './artifact-persistence.js';
import type { ArtifactCandidateGenerator, GeneratedCandidate } from './candidate-generator.js';
import type {
  PatternFusionService,
  PatternGeneralizationService,
  SemanticModelPort,
} from './pattern-generalization.js';

export type CandidateGenerationRunStatus =
  'pending' | 'leased' | 'retry_wait' | 'completed' | 'dead_letter';

export interface CandidateGenerationRun {
  readonly runId: string;
  readonly tenantId: string;
  readonly sourcePatternRef: string;
  readonly sourceEventId?: string;
  readonly status: CandidateGenerationRunStatus;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly idempotencyKey: string;
  readonly payload: JsonObject;
  readonly resultArtifactRef?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorSummary?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CandidateGenerationSource {
  readonly tenantId: string;
  readonly domain: string;
  readonly workflowPattern: WorkflowPattern;
  readonly discoveredPattern: DiscoveredProcessPattern;
  readonly environmentClasses: readonly string[];
  readonly deviceClasses: readonly string[];
  readonly userScope: 'single' | 'multi';
  readonly sourceUserScopeIds: readonly string[];
  readonly scopeEvidence: PatternScopeEvidence;
  readonly sourceEpisodeRefs: readonly string[];
  readonly sourceCorrectionRefs: readonly string[];
}

export interface CandidateGenerationCatalog {
  listKnownCapabilityIds(): Promise<readonly string[]>;
  listTaskTypeCapabilityIds(taskTypeId: string): Promise<readonly string[]>;
}

export interface CandidateGenerationCompletion {
  readonly fusedPattern: FusedPattern;
  readonly generalizedPattern: GeneralizedPattern;
  readonly candidate: GeneratedCandidate;
}

export interface CandidateGenerationRunRepository {
  createRun(
    tenantId: string,
    sourcePatternRef: string,
    sourceEventId: string,
    now: string,
    maxAttempts?: number,
  ): Promise<CandidateGenerationRun>;
  claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly CandidateGenerationRun[]>;
  loadSource(run: CandidateGenerationRun): Promise<CandidateGenerationSource | undefined>;
  findExistingFingerprints(
    artifactType: string,
    domain: string,
    taskTypeId: string,
  ): Promise<readonly string[]>;
  completeAtomically(
    run: CandidateGenerationRun,
    workerId: string,
    leaseToken: string,
    completion: CandidateGenerationCompletion,
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
  listRequeueable(now: string, limit?: number): Promise<readonly CandidateGenerationRun[]>;
}

export interface CandidateGenerationTrigger {
  readonly triggerId: string;
  readonly tenantId: string;
  readonly sourcePatternRef: string;
  readonly occurredAt: string;
}

export interface CandidateGenerationTriggerSource {
  listPending(limit?: number): Promise<readonly CandidateGenerationTrigger[]>;
}

export interface CandidateGenerationWakeQueue {
  enqueue(runId: string): Promise<void>;
}

export class CandidateGenerationTriggerDispatcher {
  readonly #source: CandidateGenerationTriggerSource;
  readonly #runs: CandidateGenerationRunRepository;
  readonly #queue: CandidateGenerationWakeQueue;

  constructor(
    dependencies: Readonly<{
      source: CandidateGenerationTriggerSource;
      runs: CandidateGenerationRunRepository;
      queue: CandidateGenerationWakeQueue;
    }>,
  ) {
    this.#source = dependencies.source;
    this.#runs = dependencies.runs;
    this.#queue = dependencies.queue;
  }

  async dispatch(limit = 100): Promise<number> {
    const triggers = await this.#source.listPending(limit);
    for (const trigger of triggers) {
      const run = await this.#runs.createRun(
        trigger.tenantId,
        trigger.sourcePatternRef,
        trigger.triggerId,
        trigger.occurredAt,
      );
      await this.#queue.enqueue(run.runId);
    }
    return triggers.length;
  }
}

export class CandidateGenerationApplicationService {
  readonly #runs: CandidateGenerationRunRepository;
  readonly #catalog: CandidateGenerationCatalog;
  readonly #fusion: Pick<PatternFusionService, 'fuse'>;
  readonly #generalization: Pick<PatternGeneralizationService, 'generalize'>;
  readonly #generator: Pick<ArtifactCandidateGenerator, 'generate'>;
  readonly #clock: Readonly<{ now(): string }>;
  readonly #model: SemanticModelPort | undefined;
  readonly #retryPolicy: Readonly<{
    maxAttempts: number;
    baseBackoffMs: number;
    maxBackoffMs: number;
  }>;

  constructor(
    dependencies: Readonly<{
      runs: CandidateGenerationRunRepository;
      catalog: CandidateGenerationCatalog;
      fusion: Pick<PatternFusionService, 'fuse'>;
      generalization: Pick<PatternGeneralizationService, 'generalize'>;
      generator: Pick<ArtifactCandidateGenerator, 'generate'>;
      clock: Readonly<{ now(): string }>;
      model?: SemanticModelPort;
      retryPolicy: Readonly<{
        maxAttempts: number;
        baseBackoffMs: number;
        maxBackoffMs: number;
      }>;
    }>,
  ) {
    this.#runs = dependencies.runs;
    this.#catalog = dependencies.catalog;
    this.#fusion = dependencies.fusion;
    this.#generalization = dependencies.generalization;
    this.#generator = dependencies.generator;
    this.#clock = dependencies.clock;
    this.#model = dependencies.model;
    this.#retryPolicy = dependencies.retryPolicy;
  }

  claim(workerId: string, limit = 1): Promise<readonly CandidateGenerationRun[]> {
    return this.#runs.claim(workerId, this.#clock.now(), 120_000, limit);
  }

  async process(run: CandidateGenerationRun, workerId: string): Promise<void> {
    if (run.status !== 'leased') return;
    const leaseToken = requiredLeaseToken(run);
    try {
      const source = await this.#runs.loadSource(run);
      if (source === undefined) throw codedError('CANDIDATE_GENERATION_SOURCE_NOT_FOUND');
      if (
        source.tenantId !== run.tenantId ||
        source.discoveredPattern.patternId !== run.sourcePatternRef
      ) {
        throw codedError('CANDIDATE_GENERATION_SOURCE_SCOPE_MISMATCH');
      }
      const [knownCapabilityIds, knownTaskTypeCapabilities] = await Promise.all([
        this.#catalog.listKnownCapabilityIds(),
        this.#catalog.listTaskTypeCapabilityIds(source.workflowPattern.taskTypeId),
      ]);
      const fusedPattern = await this.#fusion.fuse({
        workflowPattern: source.workflowPattern,
        discoveredPattern: source.discoveredPattern,
        domain: source.domain,
        tenantId: source.tenantId,
        environmentClasses: source.environmentClasses,
        deviceClasses: source.deviceClasses,
        tenantScope: 'single',
        userScope: source.userScope,
        scopeEvidence: source.scopeEvidence,
        ...(this.#model === undefined ? {} : { model: this.#model }),
      });
      const generalizedPattern = this.#generalization.generalize({
        fusedPattern,
        knownTaskTypeCapabilities,
      });
      const existingFingerprints = await this.#runs.findExistingFingerprints(
        'plan_template',
        source.domain,
        source.workflowPattern.taskTypeId,
      );
      const candidate = this.#generator.generate({
        generalizedPattern,
        fusedPattern,
        knownCapabilityIds,
        sourceEpisodeRefs: source.sourceEpisodeRefs,
        sourceCorrectionRefs: source.sourceCorrectionRefs,
        sourceUserScopeIds: source.sourceUserScopeIds,
        existingFingerprints,
        tenantId: source.tenantId,
        createdAt: this.#clock.now(),
      });
      if (candidate.validation.result !== 'passed_static') {
        throw codedError(
          `CANDIDATE_STATIC_VALIDATION_FAILED:${candidate.validation.errors
            .map((issue) => issue.code)
            .join(',')}`,
        );
      }
      const completed = await this.#runs.completeAtomically(
        run,
        workerId,
        leaseToken,
        { fusedPattern, generalizedPattern, candidate },
        this.#clock.now(),
      );
      if (!completed) throw codedError('CANDIDATE_GENERATION_FENCE_REJECTED');
    } catch (error: unknown) {
      await this.#fail(run, workerId, leaseToken, error);
    }
  }

  async #fail(
    run: CandidateGenerationRun,
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

export class CandidateGenerationRunReconciler {
  readonly #runs: CandidateGenerationRunRepository;
  readonly #queue: CandidateGenerationWakeQueue;

  constructor(
    dependencies: Readonly<{
      runs: CandidateGenerationRunRepository;
      queue: CandidateGenerationWakeQueue;
    }>,
  ) {
    this.#runs = dependencies.runs;
    this.#queue = dependencies.queue;
  }

  async requeue(now: string, limit = 100): Promise<number> {
    const runs = await this.#runs.listRequeueable(now, limit);
    for (const run of runs) await this.#queue.enqueue(run.runId);
    return runs.length;
  }
}

export function candidatePersistence(
  completion: CandidateGenerationCompletion,
): ArtifactCandidatePersistence {
  return Object.freeze({
    artifact: completion.candidate.artifact,
    lineage: completion.candidate.lineage,
  });
}

export function candidateValidation(
  completion: CandidateGenerationCompletion,
): CandidateStaticValidationResult {
  return completion.candidate.validation;
}

function requiredLeaseToken(run: CandidateGenerationRun): string {
  if (run.leaseToken === undefined) throw codedError('CANDIDATE_GENERATION_LEASE_TOKEN_MISSING');
  return run.leaseToken;
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
  if (error instanceof Error) {
    const prefix = error.message.split(':')[0] ?? '';
    if (/^[A-Z0-9_]+$/u.test(prefix)) return prefix.slice(0, 128);
  }
  return 'CANDIDATE_GENERATION_FAILED';
}

function errorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : 'Candidate generation failed.')
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2_048);
}
