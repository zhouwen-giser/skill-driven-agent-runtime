import {
  createArtifactPromotionPackage,
  createArtifactShadowResult,
  createArtifactShadowRun,
  hashCanonical,
  type ArtifactCounterexample,
  type ArtifactPromotionEligibility,
  type ArtifactPromotionPackage,
  type ArtifactRevalidationTrigger,
  type ArtifactShadowMode,
  type ArtifactShadowResult,
  type ArtifactShadowRun,
  type ArtifactValidationResult,
  type CompiledArtifact,
} from '../../../domain/src/index.js';

/** A P06 worker may only calculate these projections. It has no execution port. */
export const SHADOW_PROHIBITED_OPERATIONS = Object.freeze([
  'skill_execute',
  'mcp_call',
  'provider_task',
  'network_request',
  'device_control',
  'external_write',
  'formal_request_write',
  'formal_goal_write',
  'formal_plan_write',
  'formal_attempt_write',
  'formal_workflow_write',
  'formal_outcome_write',
  'formal_notification',
  'active_pointer_write',
  'approval_write',
  'goal_terminal_write',
] as const);
export type ShadowProhibitedOperation = (typeof SHADOW_PROHIBITED_OPERATIONS)[number];

export const ARTIFACT_SHADOW_QUEUE_NAME = 'sdar-artifact-shadow' as const;
export const ARTIFACT_REVALIDATION_QUEUE_NAME = 'sdar-artifact-revalidation' as const;

export type ArtifactShadowWorkState =
  | 'pending'
  | 'leased'
  | 'retry_wait'
  | 'completed'
  | 'discarded_stale'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

export interface ArtifactShadowRunRecord extends ArtifactShadowRun {
  readonly tenantId?: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly policySnapshotHash: string;
  readonly capabilityCatalogHash: string;
  readonly workState: ArtifactShadowWorkState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly expiresAt: string;
  readonly idempotencyKey: string;
  readonly leaseOwner?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorSummary?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Selection is deliberately outside P06. The caller must supply an exact artifact
 * ref and formal correlation. This preserves the formal runtime as authority.
 */
export interface ArtifactShadowEnrollment {
  readonly shadowRunId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly artifactRef: string;
  readonly artifactHash: string;
  readonly tenantId?: string;
  readonly formalRequestRef: string;
  readonly formalGoalRef?: string;
  readonly formalPlanRef?: string;
  readonly formalGoalVersion?: number;
  readonly formalPlanVersion?: number;
  readonly shadowMode: ArtifactShadowMode;
  readonly policySnapshotHash: string;
  readonly capabilityCatalogHash: string;
  readonly idempotencyKey: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  /** Formal facts are supplied directly by the formal-runtime observer. */
  readonly formalProjection?: ShadowProjectionSnapshot;
  /** Candidate projection is compiled from the immutable P02 artifact, never caller supplied. */
  readonly formalOutcomeRef?: string;
  /** Declared operations are inspected only to deny side effects before evaluation. */
  readonly declaredOperations?: readonly string[];
  /** Admission-time facts retained for audit only; worker-start reads the live source. */
  readonly currentPolicySnapshotHash?: string;
  readonly currentCapabilityCatalogHash?: string;
  readonly currentFormalGoalVersion?: number;
  readonly currentFormalPlanVersion?: number;
  /** Internal P06 admission bound; persisted PostgreSQL state decides acceptance. */
  readonly maximumQueueDepth?: number;
}

export interface ShadowProjectionSnapshot {
  readonly decision?: Readonly<Record<string, unknown>>;
  readonly plan?: Readonly<Record<string, unknown>>;
  readonly criterionRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  readonly estimatedCostUnits?: number;
  readonly estimatedLatencyMs?: number;
  readonly correctionRefs: readonly string[];
  /** Physical outcomes are intentionally not projected by P06. */
  readonly physicalOutcome?: never;
}

export interface ArtifactShadowWork {
  readonly run: ArtifactShadowRunRecord;
  readonly artifact: CompiledArtifact;
  readonly formal: ShadowProjectionSnapshot;
  readonly candidate: ShadowProjectionSnapshot;
  readonly formalOutcomeRef?: string;
  readonly declaredOperations: readonly string[];
  readonly currentPolicySnapshotHash: string;
  readonly currentCapabilityCatalogHash: string;
  readonly currentFormalGoalVersion?: number;
  readonly currentFormalPlanVersion?: number;
}

/**
 * Read at worker start from the formal runtime's own authoritative stores. The
 * enrollment copy is audit context only and cannot prove a queued run is current.
 */
export interface ArtifactShadowCurrentState {
  readonly policySnapshotHash: string;
  readonly capabilityCatalogHash: string;
  readonly formalGoalVersion?: number;
  readonly formalPlanVersion?: number;
}

export interface ArtifactShadowCurrentStateReader {
  readEnrollmentCurrent(
    input: ArtifactShadowEnrollment,
  ): Promise<ArtifactShadowCurrentState | undefined>;
  readCurrent(
    input: Readonly<{ run: ArtifactShadowRunRecord; work: ArtifactShadowWork }>,
  ): Promise<ArtifactShadowCurrentState | undefined>;
}

export interface ShadowCompletion {
  readonly result: ArtifactShadowResult;
  readonly stale: boolean;
  readonly unsafe: boolean;
}

/** Immutable assessment persisted alongside the package; it is not an operator claim. */
export interface ArtifactPromotionEvidenceAssessment {
  readonly policy: PromotionPolicyConfig;
  readonly coverage: PromotionCoverage;
  readonly reasonCodes: readonly string[];
  readonly evidenceHash: string;
}

export interface ArtifactShadowRepository {
  enqueue(input: ArtifactShadowEnrollment): Promise<ArtifactShadowRunRecord>;
  claim(
    workerId: string,
    now: string,
    leaseMs: number,
    limit: number,
  ): Promise<readonly ArtifactShadowRunRecord[]>;
  loadWork(run: ArtifactShadowRunRecord): Promise<ArtifactShadowWork | undefined>;
  complete(
    run: ArtifactShadowRunRecord,
    workerId: string,
    leaseToken: string,
    completion: ShadowCompletion,
    now: string,
  ): Promise<boolean>;
  discardStale(
    run: ArtifactShadowRunRecord,
    workerId: string,
    leaseToken: string,
    reasonCode: string,
    now: string,
  ): Promise<boolean>;
  fail(
    run: ArtifactShadowRunRecord,
    workerId: string,
    leaseToken: string,
    errorCode: string,
    errorSummary: string,
    now: string,
    retryAt?: string,
  ): Promise<boolean>;
  listRequeueable(now: string, limit?: number): Promise<readonly ArtifactShadowRunRecord[]>;
  createPromotionPackage(
    input: ArtifactPromotionPackage,
    assessment: ArtifactPromotionEvidenceAssessment,
  ): Promise<ArtifactPromotionPackage>;
  listPromotionEvidence(input: Readonly<{ artifactId: string; artifactVersion: number }>): Promise<
    | Readonly<{
        validationResult: ArtifactValidationResult;
        counterexamples: readonly ArtifactCounterexample[];
        shadowRuns: readonly ArtifactShadowResult[];
        artifact: CompiledArtifact;
        coverage: PromotionCoverage;
      }>
    | undefined
  >;
  recordRevalidationTrigger(
    input: ArtifactRevalidationTrigger,
    validationRunId?: string,
  ): Promise<void>;
  loadRevalidationValidationRun(triggerId: string): Promise<string | undefined>;
  listPendingRevalidationTriggers(limit?: number): Promise<readonly string[]>;
}

export interface ArtifactShadowWakeQueue {
  enqueue(shadowRunId: string): Promise<void>;
}

/** Redis carries a trigger wake only; P02 remains the validation-run authority. */
export interface ArtifactRevalidationWakeQueue {
  enqueue(triggerId: string): Promise<void>;
}

export interface ArtifactReplayValidationWakeQueue {
  enqueue(validationRunId: string): Promise<void>;
}

export class ArtifactRevalidationApplicationService {
  constructor(
    private readonly repository: Pick<
      ArtifactShadowRepository,
      'loadRevalidationValidationRun' | 'listPendingRevalidationTriggers'
    >,
    private readonly replayQueue: ArtifactReplayValidationWakeQueue,
  ) {}

  async process(triggerId: string): Promise<void> {
    const validationRunId = await this.repository.loadRevalidationValidationRun(triggerId);
    if (validationRunId === undefined) {
      throw new ArtifactShadowSafetyError('ARTIFACT_REVALIDATION_RUN_MISSING');
    }
    await this.replayQueue.enqueue(validationRunId);
  }

  async requeue(limit = 100): Promise<number> {
    const triggerIds = await this.repository.listPendingRevalidationTriggers(limit);
    for (const triggerId of triggerIds) await this.process(triggerId);
    return triggerIds.length;
  }
}

export interface ArtifactShadowFeatureGate {
  readonly artifactMode: 'off' | 'shadow' | 'advisory' | 'active';
  readonly tenantAllowlist: ReadonlySet<string>;
  readonly degraded: boolean;
  readonly maximumQueueDepth: number;
  readonly samplingRate: number;
}

export class ArtifactShadowSafetyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ArtifactShadowSafetyError';
    this.code = code;
  }
}

export class ArtifactShadowSafetyBoundary {
  assertNoSideEffect(operation: string): void {
    if (!SHADOW_ALLOWED_OPERATIONS.has(operation)) {
      throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_SIDE_EFFECT_DENIED');
    }
  }
}

/** Closed allowlist: new operation names are unsafe until a P06 contract permits them. */
const SHADOW_ALLOWED_OPERATIONS: ReadonlySet<string> = new Set([
  'read_formal_snapshot',
  'read_artifact_snapshot',
  'compile_candidate_projection',
  'compare_projection',
]);

export class ArtifactShadowApplicationService {
  constructor(
    private readonly repository: ArtifactShadowRepository,
    private readonly queue: ArtifactShadowWakeQueue,
    private readonly clock: Readonly<{ now(): string }>,
    private readonly featureGate: ArtifactShadowFeatureGate,
    private readonly safety: ArtifactShadowSafetyBoundary = new ArtifactShadowSafetyBoundary(),
    private readonly currentState?: ArtifactShadowCurrentStateReader,
  ) {}

  async enroll(input: ArtifactShadowEnrollment): Promise<ArtifactShadowRunRecord | undefined> {
    assertEnrollment(input);
    const currentState = this.currentState;
    if (
      this.featureGate.artifactMode === 'off' ||
      this.featureGate.degraded ||
      currentState === undefined
    ) {
      return undefined;
    }
    const current = await currentState.readEnrollmentCurrent(input);
    if (current === undefined || enrollmentIsStale(input, current)) return undefined;
    if (
      input.tenantId !== undefined &&
      this.featureGate.tenantAllowlist.size > 0 &&
      !this.featureGate.tenantAllowlist.has(input.tenantId)
    ) {
      return undefined;
    }
    if (!shouldSample(input.shadowRunId, this.featureGate.samplingRate)) return undefined;
    const run = await this.repository.enqueue({
      ...input,
      maximumQueueDepth: this.featureGate.maximumQueueDepth,
    });
    // PostgreSQL applied capacity/backpressure before this wake. Redis stores no run state.
    await this.queue.enqueue(run.shadowRunId);
    return run;
  }

  claim(workerId: string, limit = 1): Promise<readonly ArtifactShadowRunRecord[]> {
    return this.repository.claim(workerId, this.clock.now(), 120_000, Math.min(limit, 10));
  }

  async process(run: ArtifactShadowRunRecord, workerId: string): Promise<void> {
    if (run.workState !== 'leased') return;
    const leaseToken = run.leaseToken;
    if (leaseToken === undefined)
      throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_LEASE_REQUIRED');
    const now = this.clock.now();
    const currentState = this.currentState;
    try {
      if (Date.parse(run.expiresAt) <= Date.parse(now)) {
        await this.repository.discardStale(
          run,
          workerId,
          leaseToken,
          'ARTIFACT_SHADOW_TTL_EXPIRED',
          now,
        );
        return;
      }
      const work = await this.repository.loadWork(run);
      const current =
        work === undefined || currentState === undefined
          ? undefined
          : await currentState.readCurrent({ run, work });
      if (work === undefined || current === undefined || shadowWorkIsStale(work, current)) {
        await this.repository.discardStale(
          run,
          workerId,
          leaseToken,
          'ARTIFACT_SHADOW_STALE_PIN',
          now,
        );
        return;
      }
      for (const operation of work.declaredOperations) this.safety.assertNoSideEffect(operation);
      const result = evaluateShadowProjection(work, now);
      const currentBeforePersistence =
        currentState === undefined ? undefined : await currentState.readCurrent({ run, work });
      if (
        currentBeforePersistence === undefined ||
        shadowWorkIsStale(work, currentBeforePersistence)
      ) {
        await this.repository.discardStale(
          run,
          workerId,
          leaseToken,
          'ARTIFACT_SHADOW_STALE_BEFORE_PERSIST',
          this.clock.now(),
        );
        return;
      }
      const completed = await this.repository.complete(
        run,
        workerId,
        leaseToken,
        { result, stale: false, unsafe: false },
        this.clock.now(),
      );
      if (!completed) throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_FENCE_REJECTED');
    } catch (error: unknown) {
      const code =
        error instanceof ArtifactShadowSafetyError ? error.code : 'ARTIFACT_SHADOW_FAILED';
      if (code === 'ARTIFACT_SHADOW_SIDE_EFFECT_DENIED') {
        const unsafe = createUnsafeShadowResult(run, this.clock.now());
        await this.repository.complete(
          run,
          workerId,
          leaseToken,
          { result: unsafe, stale: false, unsafe: true },
          this.clock.now(),
        );
        return;
      }
      await this.repository.fail(
        run,
        workerId,
        leaseToken,
        code,
        redactedError(error),
        this.clock.now(),
      );
    }
  }

  async requeue(limit = 100): Promise<number> {
    const runs = await this.repository.listRequeueable(this.clock.now(), limit);
    for (const run of runs) await this.queue.enqueue(run.shadowRunId);
    return runs.length;
  }
}

export interface PromotionPolicyConfig {
  readonly version: string;
  readonly minimumIndependentGoals: number;
  readonly minimumHoldoutCases: number;
  readonly minimumShadowRuns: number;
  readonly minimumEnvironmentClasses: number;
  readonly minimumDeviceClasses: number;
}

export interface PromotionCoverage {
  readonly independentGoals: number;
  readonly holdoutCases: number;
  readonly shadowRuns: number;
  readonly environmentClasses: readonly string[];
  readonly deviceClasses: readonly string[];
  readonly userPreferenceIsolated: boolean;
  readonly temporaryAuthorizationObserved: boolean;
  readonly dependencyValid: boolean;
  readonly unresolvedCriticalCounterexample: boolean;
  readonly snapshotComplete: boolean;
}

export interface PromotionAssessment {
  readonly eligibility: ArtifactPromotionEligibility;
  readonly reasonCodes: readonly string[];
}

export function assessPromotion(
  input: Readonly<{
    validationResult: ArtifactValidationResult;
    shadowResults: readonly ArtifactShadowResult[];
    coverage: PromotionCoverage;
    policy: PromotionPolicyConfig;
  }>,
): PromotionAssessment {
  const reasons: string[] = [];
  const unsafeShadow = input.shadowResults.some(
    (result) => result.unsafeAttempt || result.policyViolation,
  );
  if (input.validationResult.unsafe || input.validationResult.result === 'unsafe' || unsafeShadow) {
    return Object.freeze({
      eligibility: 'unsafe',
      reasonCodes: Object.freeze(['UNSAFE_EVIDENCE']),
    });
  }
  if (input.coverage.temporaryAuthorizationObserved)
    reasons.push('TEMPORARY_AUTHORIZATION_REJECTED');
  if (!input.coverage.dependencyValid) reasons.push('DEPENDENCY_INVALID');
  if (input.coverage.unresolvedCriticalCounterexample) reasons.push('CRITICAL_COUNTEREXAMPLE');
  if (input.validationResult.result !== 'passed') reasons.push('VALIDATION_NOT_PASSED');
  if (reasons.length > 0) {
    return Object.freeze({ eligibility: 'ineligible', reasonCodes: Object.freeze(reasons) });
  }
  if (input.shadowResults.some((result) => result.stale)) reasons.push('STALE_SHADOW_EXCLUDED');
  const completedShadowRuns = input.shadowResults.filter(
    (result) => !result.stale && !result.unsafeAttempt && !result.policyViolation,
  ).length;
  if (input.coverage.independentGoals < input.policy.minimumIndependentGoals) {
    reasons.push('INDEPENDENT_GOAL_COVERAGE_INSUFFICIENT');
  }
  if (input.coverage.holdoutCases < input.policy.minimumHoldoutCases) {
    reasons.push('HOLDOUT_COVERAGE_INSUFFICIENT');
  }
  if (Math.min(input.coverage.shadowRuns, completedShadowRuns) < input.policy.minimumShadowRuns) {
    reasons.push('SHADOW_COVERAGE_INSUFFICIENT');
  }
  if (new Set(input.coverage.environmentClasses).size < input.policy.minimumEnvironmentClasses) {
    reasons.push('ENVIRONMENT_GENERALIZATION_INSUFFICIENT');
  }
  if (new Set(input.coverage.deviceClasses).size < input.policy.minimumDeviceClasses) {
    reasons.push('SINGLE_DEVICE_GENERALIZATION_REJECTED');
  }
  if (!input.coverage.userPreferenceIsolated) reasons.push('SINGLE_USER_PREFERENCE_REJECTED');
  if (!input.coverage.snapshotComplete) reasons.push('SNAPSHOT_INCOMPLETE');
  return Object.freeze({
    eligibility: reasons.length === 0 ? 'eligible_for_review' : 'needs_more_data',
    reasonCodes: Object.freeze(reasons),
  });
}

export interface PromotionPackageInput {
  readonly promotionPackageId: string;
  readonly artifactRef: string;
  readonly artifactHash: string;
  readonly validationSummaryRef: string;
  readonly validationSummaryHash: string;
  readonly shadowSummaryRef: string;
  readonly shadowSummaryHash: string;
  readonly counterexampleSummaryRef: string;
  readonly counterexampleSummaryHash: string;
  readonly riskReviewRef: string;
  readonly riskReviewHash: string;
  readonly dependencySnapshotRef: string;
  readonly dependencySnapshotHash: string;
  readonly createdAt: string;
}

export class ArtifactPromotionApplicationService {
  constructor(
    private readonly repository: ArtifactShadowRepository,
    private readonly policy: PromotionPolicyConfig,
  ) {}

  async createPackage(input: PromotionPackageInput): Promise<ArtifactPromotionPackage> {
    const [artifactId, artifactVersion] = artifactRefParts(input.artifactRef);
    const evidence = await this.repository.listPromotionEvidence({ artifactId, artifactVersion });
    if (evidence === undefined)
      throw new ArtifactShadowSafetyError('ARTIFACT_PROMOTION_EVIDENCE_MISSING');
    if (
      evidence.artifact.contentHash !== input.artifactHash ||
      evidence.validationResult.validationRunId !== input.validationSummaryRef ||
      evidence.validationResult.resultHash !== input.validationSummaryHash
    ) {
      throw new ArtifactShadowSafetyError('ARTIFACT_PROMOTION_VALIDATION_EVIDENCE_INVALID');
    }
    const shadowSummaryHash = hashCanonical(evidence.shadowRuns);
    const counterexampleSummaryHash = hashCanonical(evidence.counterexamples);
    const dependencySnapshotHash = hashCanonical(evidence.artifact.dependencySnapshot);
    if (
      input.shadowSummaryHash !== shadowSummaryHash ||
      input.counterexampleSummaryHash !== counterexampleSummaryHash ||
      input.dependencySnapshotHash !== dependencySnapshotHash
    ) {
      throw new ArtifactShadowSafetyError('ARTIFACT_PROMOTION_EVIDENCE_HASH_MISMATCH');
    }
    const assessment = assessPromotion({
      validationResult: evidence.validationResult,
      shadowResults: evidence.shadowRuns,
      coverage: evidence.coverage,
      policy: this.policy,
    });
    const riskReviewHash = hashCanonical({
      promotionPolicyVersion: this.policy.version,
      validationSummaryHash: evidence.validationResult.resultHash,
      shadowSummaryHash,
      counterexampleSummaryHash,
      coverage: evidence.coverage,
      eligibility: assessment.eligibility,
      reasonCodes: assessment.reasonCodes,
    });
    if (input.riskReviewHash !== riskReviewHash) {
      throw new ArtifactShadowSafetyError('ARTIFACT_PROMOTION_RISK_REVIEW_HASH_MISMATCH');
    }
    const contentWithoutHash = {
      promotionPackageId: input.promotionPackageId,
      artifactRef: input.artifactRef,
      artifactHash: input.artifactHash,
      validationSummaryRef: input.validationSummaryRef,
      validationSummaryHash: input.validationSummaryHash,
      shadowSummaryRef: input.shadowSummaryRef,
      shadowSummaryHash,
      counterexampleSummaryRef: input.counterexampleSummaryRef,
      counterexampleSummaryHash,
      riskReviewRef: input.riskReviewRef,
      riskReviewHash,
      dependencySnapshotRef: input.dependencySnapshotRef,
      dependencySnapshotHash,
      promotionPolicyVersion: this.policy.version,
      eligibility: assessment.eligibility,
      createdAt: input.createdAt,
    };
    const value = createArtifactPromotionPackage({
      ...contentWithoutHash,
      contentHash: hashCanonical(contentWithoutHash),
    });
    return this.repository.createPromotionPackage(value, {
      policy: this.policy,
      coverage: evidence.coverage,
      reasonCodes: assessment.reasonCodes,
      evidenceHash: hashCanonical({
        validationSummaryHash: evidence.validationResult.resultHash,
        shadowSummaryHash,
        counterexampleSummaryHash,
        riskReviewHash,
      }),
    });
  }
}

function evaluateShadowProjection(
  work: ArtifactShadowWork,
  completedAt: string,
): ArtifactShadowResult {
  const comparison = Object.freeze({
    decision_agreement: agreement(work.formal.decision, work.candidate.decision),
    plan_agreement: agreement(work.formal.plan, work.candidate.plan),
    criterion_coverage: overlap(work.formal.criterionRefs, work.candidate.criterionRefs),
    evidence_coverage: overlap(work.formal.evidenceRefs, work.candidate.evidenceRefs),
    risk_agreement: work.formal.riskLevel === work.candidate.riskLevel ? 1 : 0,
    cost_delta: numericDelta(work.candidate.estimatedCostUnits, work.formal.estimatedCostUnits),
    latency_delta: numericDelta(work.candidate.estimatedLatencyMs, work.formal.estimatedLatencyMs),
    correction_overlap: overlap(work.formal.correctionRefs, work.candidate.correctionRefs),
    // P06 never performs a physical action, so a physical outcome remains unknown.
    physical_outcome: undefined,
  });
  const base = {
    shadowRunRef: work.run.shadowRunId,
    artifactRef: work.run.artifactRef,
    ...(work.run.shadowMode === 'plan_only'
      ? {}
      : { shadowDecisionRef: `${work.run.shadowRunId}:decision` }),
    ...(work.run.shadowMode === 'decision_only'
      ? {}
      : { shadowPlanRef: `${work.run.shadowRunId}:plan` }),
    ...(work.run.formalPlanRef === undefined ? {} : { formalPlanRef: work.run.formalPlanRef }),
    ...(work.formalOutcomeRef === undefined ? {} : { formalOutcomeRef: work.formalOutcomeRef }),
    comparison,
    policyViolation: false,
    unsafeAttempt: false,
    stale: false,
    evaluatorVersion: 'artifact-shadow-evaluator/1.1',
    completedAt,
  };
  return createArtifactShadowResult({ ...base, resultHash: hashCanonical(base) });
}

function createUnsafeShadowResult(
  run: ArtifactShadowRunRecord,
  completedAt: string,
): ArtifactShadowResult {
  const base = {
    shadowRunRef: run.shadowRunId,
    artifactRef: run.artifactRef,
    comparison: { physical_outcome: undefined },
    policyViolation: true,
    unsafeAttempt: true,
    stale: false,
    evaluatorVersion: 'artifact-shadow-evaluator/1.1',
    completedAt,
  };
  return createArtifactShadowResult({ ...base, resultHash: hashCanonical(base) });
}

function shadowWorkIsStale(work: ArtifactShadowWork, current: ArtifactShadowCurrentState): boolean {
  return (
    work.artifact.contentHash !== work.run.artifactHash ||
    current.policySnapshotHash !== work.run.policySnapshotHash ||
    current.capabilityCatalogHash !== work.run.capabilityCatalogHash ||
    (work.run.formalGoalVersion !== undefined &&
      current.formalGoalVersion !== work.run.formalGoalVersion) ||
    (work.run.formalPlanVersion !== undefined &&
      current.formalPlanVersion !== work.run.formalPlanVersion)
  );
}

function enrollmentIsStale(
  enrollment: ArtifactShadowEnrollment,
  current: ArtifactShadowCurrentState,
): boolean {
  return (
    enrollment.policySnapshotHash !== current.policySnapshotHash ||
    enrollment.capabilityCatalogHash !== current.capabilityCatalogHash ||
    (enrollment.formalGoalVersion !== undefined &&
      enrollment.formalGoalVersion !== current.formalGoalVersion) ||
    (enrollment.formalPlanVersion !== undefined &&
      enrollment.formalPlanVersion !== current.formalPlanVersion)
  );
}

function artifactRefParts(artifactRef: string): readonly [string, number] {
  const separator = artifactRef.lastIndexOf(':');
  const artifactId = separator <= 0 ? '' : artifactRef.slice(0, separator);
  const artifactVersion = Number(artifactRef.slice(separator + 1));
  if (artifactId.length === 0 || !Number.isSafeInteger(artifactVersion) || artifactVersion < 1) {
    throw new ArtifactShadowSafetyError('ARTIFACT_PROMOTION_ARTIFACT_REF_INVALID');
  }
  return [artifactId, artifactVersion] as const;
}

function assertEnrollment(input: ArtifactShadowEnrollment): void {
  createArtifactShadowRun({
    shadowRunId: input.shadowRunId,
    artifactRef: input.artifactRef,
    artifactHash: input.artifactHash,
    formalRequestRef: input.formalRequestRef,
    ...(input.formalGoalRef === undefined ? {} : { formalGoalRef: input.formalGoalRef }),
    ...(input.formalPlanRef === undefined ? {} : { formalPlanRef: input.formalPlanRef }),
    ...(input.formalGoalVersion === undefined
      ? {}
      : { formalGoalVersion: input.formalGoalVersion }),
    ...(input.formalPlanVersion === undefined
      ? {}
      : { formalPlanVersion: input.formalPlanVersion }),
    status: 'queued',
    shadowMode: input.shadowMode,
    startedAt: input.createdAt,
  });
  if (Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) {
    throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_TTL_INVALID');
  }
  for (const operation of input.declaredOperations ?? []) {
    if (typeof operation !== 'string' || operation.length === 0 || operation.length > 128) {
      throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_OPERATION_INVALID');
    }
  }
  assertShadowProjection(input.formalProjection);
}

function assertShadowProjection(projection: ShadowProjectionSnapshot | undefined): void {
  if (projection === undefined) return;
  if ('physicalOutcome' in projection) {
    throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_PHYSICAL_OUTCOME_FORBIDDEN');
  }
  for (const values of [
    projection.criterionRefs,
    projection.evidenceRefs,
    projection.correctionRefs,
  ]) {
    if (
      !Array.isArray(values) ||
      values.some((value) => typeof value !== 'string' || value.length === 0)
    ) {
      throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_PROJECTION_INVALID');
    }
  }
}

function shouldSample(runId: string, rate: number): boolean {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new ArtifactShadowSafetyError('ARTIFACT_SHADOW_SAMPLING_RATE_INVALID');
  }
  if (rate === 0) return false;
  if (rate === 1) return true;
  let accumulator = 0;
  for (const character of runId) accumulator = (accumulator * 31 + character.charCodeAt(0)) >>> 0;
  return accumulator / 0xffffffff < rate;
}

function agreement(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): number {
  if (left === undefined || right === undefined) return 0;
  return hashCanonical(left) === hashCanonical(right) ? 1 : 0;
}

function overlap(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) return 1;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const value of leftSet) if (rightSet.has(value)) shared += 1;
  return shared / Math.max(leftSet.size, rightSet.size, 1);
}

function numericDelta(
  candidate: number | undefined,
  formal: number | undefined,
): number | undefined {
  if (candidate === undefined || formal === undefined) return undefined;
  return candidate - formal;
}

function redactedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(password|secret|token|authorization|credential)=[^\s]+/giu, '$1=[REDACTED]')
    .slice(0, 2048);
}
