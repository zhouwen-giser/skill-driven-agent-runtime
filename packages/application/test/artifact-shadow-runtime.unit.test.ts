import { describe, expect, it } from 'vitest';

import {
  ArtifactPromotionApplicationService,
  ArtifactShadowApplicationService,
  ArtifactShadowSafetyBoundary,
  assessPromotion,
  type ArtifactShadowRepository,
  type ArtifactShadowRunRecord,
  type ArtifactShadowWork,
} from '../src/index.js';
import { hashCanonical } from '../../domain/src/index.js';
import type {
  CompiledArtifact,
  ArtifactRevalidationTrigger,
  ArtifactShadowResult,
  ArtifactValidationResult,
} from '../../domain/src/index.js';

const hash = `sha256:${'a'.repeat(64)}`;
const laterHash = `sha256:${'b'.repeat(64)}`;
const now = '2026-07-29T02:00:00.000Z';

describe('P06 artifact shadow runtime', () => {
  it('hard-denies every prohibited shadow side effect before a transport exists', () => {
    const boundary = new ArtifactShadowSafetyBoundary();
    expect(() => {
      boundary.assertNoSideEffect('mcp_call');
    }).toThrow('ARTIFACT_SHADOW_SIDE_EFFECT_DENIED');
    expect(() => {
      boundary.assertNoSideEffect('formal_plan_write');
    }).toThrow('ARTIFACT_SHADOW_SIDE_EFFECT_DENIED');
    expect(() => {
      boundary.assertNoSideEffect('compare_projection');
    }).not.toThrow();
  });

  it('never enqueues while artifact mode is off', async () => {
    const calls: string[] = [];
    const service = new ArtifactShadowApplicationService(
      fakeRepository(calls),
      {
        enqueue: (runId) => {
          calls.push(`wake:${runId}`);
          return Promise.resolve();
        },
      },
      { now: () => now },
      {
        artifactMode: 'off',
        tenantAllowlist: new Set(),
        degraded: false,
        maximumQueueDepth: 10,
        samplingRate: 1,
      },
    );
    expect(
      await service.enroll({
        shadowRunId: 'shadow-1',
        artifactId: 'artifact-1',
        artifactVersion: 1,
        artifactRef: 'artifact-1:1',
        artifactHash: hash,
        formalRequestRef: 'request-1',
        shadowMode: 'decision_only',
        policySnapshotHash: hash,
        capabilityCatalogHash: hash,
        idempotencyKey: 'enroll-1',
        expiresAt: '2026-07-29T02:01:00.000Z',
        createdAt: now,
      }),
    ).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('persists only a prohibited-operation safety result from supplied projections', async () => {
    const calls: string[] = [];
    const repository = fakeRepository(calls);
    const run: ArtifactShadowRunRecord = {
      shadowRunId: 'shadow-unsafe-1',
      artifactRef: 'artifact-1:1',
      artifactHash: hash,
      formalRequestRef: 'request-1',
      formalGoalRef: 'goal-1',
      formalPlanRef: 'plan-1',
      formalGoalVersion: 1,
      formalPlanVersion: 1,
      status: 'running',
      shadowMode: 'decision_and_plan',
      startedAt: now,
      artifactId: 'artifact-1',
      artifactVersion: 1,
      policySnapshotHash: hash,
      capabilityCatalogHash: hash,
      workState: 'leased',
      attempt: 1,
      maxAttempts: 1,
      availableAt: now,
      expiresAt: '2026-07-29T02:01:00.000Z',
      idempotencyKey: 'unsafe-1',
      leaseOwner: 'worker-1',
      leaseToken: 'lease-1',
      leaseExpiresAt: '2026-07-29T02:01:00.000Z',
      createdAt: now,
      updatedAt: now,
    };
    const work: ArtifactShadowWork = {
      run,
      artifact: { contentHash: hash } as unknown as CompiledArtifact,
      formal: {
        decision: { route: 'formal' },
        criterionRefs: ['criterion-1'],
        evidenceRefs: ['evidence-1'],
        correctionRefs: [],
      },
      candidate: {
        decision: { route: 'candidate' },
        criterionRefs: ['criterion-1'],
        evidenceRefs: ['evidence-1'],
        correctionRefs: [],
      },
      declaredOperations: ['mcp_call'],
      currentPolicySnapshotHash: hash,
      currentCapabilityCatalogHash: hash,
      currentFormalGoalVersion: 1,
      currentFormalPlanVersion: 1,
    };
    let completion: ArtifactShadowResult | undefined;
    repository.loadWork = () => Promise.resolve(work);
    repository.complete = (_run, _workerId, _leaseToken, value) => {
      completion = value.result;
      calls.push(`complete:${String(value.unsafe)}`);
      return Promise.resolve(true);
    };
    const service = new ArtifactShadowApplicationService(
      repository,
      { enqueue: () => Promise.resolve() },
      { now: () => now },
      {
        artifactMode: 'shadow',
        tenantAllowlist: new Set(),
        degraded: false,
        maximumQueueDepth: 10,
        samplingRate: 1,
      },
      undefined,
      {
        readEnrollmentCurrent: () =>
          Promise.resolve({
            policySnapshotHash: hash,
            capabilityCatalogHash: hash,
            formalGoalVersion: 1,
            formalPlanVersion: 1,
          }),
        readCurrent: () =>
          Promise.resolve({
            policySnapshotHash: hash,
            capabilityCatalogHash: hash,
            formalGoalVersion: 1,
            formalPlanVersion: 1,
          }),
      },
    );

    await service.process(run, 'worker-1');

    expect(completion).toMatchObject({ unsafeAttempt: true, policyViolation: true });
    expect(completion?.comparison['physical_outcome']).toBeUndefined();
    expect(calls).toEqual(['complete:true']);
  });

  it('rejects unsafe, temporary authorization, single device, single-user and single-success evidence', () => {
    const base = {
      validationResult: validationResult(),
      shadowResults: [] as readonly ArtifactShadowResult[],
      policy: {
        version: 'promotion-policy/1.1',
        minimumIndependentGoals: 2,
        minimumHoldoutCases: 2,
        minimumShadowRuns: 2,
        minimumEnvironmentClasses: 2,
        minimumDeviceClasses: 2,
      },
      coverage: {
        independentGoals: 1,
        holdoutCases: 1,
        shadowRuns: 0,
        environmentClasses: ['warehouse'],
        deviceClasses: ['tablet'],
        userPreferenceIsolated: false,
        temporaryAuthorizationObserved: false,
        dependencyValid: true,
        unresolvedCriticalCounterexample: false,
        snapshotComplete: true,
      },
    };
    expect(assessPromotion(base).eligibility).toBe('needs_more_data');
    expect(assessPromotion(base).reasonCodes).toContain('SINGLE_DEVICE_GENERALIZATION_REJECTED');
    expect(assessPromotion(base).reasonCodes).toContain('SINGLE_USER_PREFERENCE_REJECTED');
    expect(
      assessPromotion({
        ...base,
        coverage: { ...base.coverage, temporaryAuthorizationObserved: true },
      }).reasonCodes,
    ).toContain('TEMPORARY_AUTHORIZATION_REJECTED');
    expect(
      assessPromotion({
        ...base,
        validationResult: { ...validationResult(), unsafe: true, result: 'unsafe' },
      }).eligibility,
    ).toBe('unsafe');
  });

  it('creates a review-only immutable promotion package, never an approval or activation', async () => {
    const calls: string[] = [];
    const service = new ArtifactPromotionApplicationService(fakeRepository(calls), {
      version: 'promotion-policy/1.1',
      minimumIndependentGoals: 1,
      minimumHoldoutCases: 1,
      minimumShadowRuns: 0,
      minimumEnvironmentClasses: 1,
      minimumDeviceClasses: 1,
    });
    const value = await service.createPackage({
      promotionPackageId: 'promotion-1',
      artifactRef: 'artifact-1:1',
      artifactHash: hash,
      validationSummaryRef: 'validation-1',
      validationSummaryHash: hash,
      shadowSummaryRef: 'shadow-summary-1',
      shadowSummaryHash: hashCanonical([]),
      counterexampleSummaryRef: 'counterexample-summary-1',
      counterexampleSummaryHash: hashCanonical([]),
      riskReviewRef: 'risk-1',
      riskReviewHash: hashCanonical({
        promotionPolicyVersion: 'promotion-policy/1.1',
        validationSummaryHash: hash,
        shadowSummaryHash: hashCanonical([]),
        counterexampleSummaryHash: hashCanonical([]),
        coverage: {
          independentGoals: 1,
          holdoutCases: 1,
          shadowRuns: 0,
          environmentClasses: ['warehouse'],
          deviceClasses: ['tablet'],
          userPreferenceIsolated: true,
          temporaryAuthorizationObserved: false,
          dependencyValid: true,
          unresolvedCriticalCounterexample: false,
          snapshotComplete: true,
        },
        eligibility: 'eligible_for_review',
        reasonCodes: [],
      }),
      dependencySnapshotRef: 'dependency-1',
      dependencySnapshotHash: hashCanonical({}),
      createdAt: now,
    });
    expect(value.eligibility).toBe('eligible_for_review');
    expect(value.contentHash).toMatch(/^sha256:/u);
    expect(calls).toEqual(['package:promotion-1']);
  });
});

function validationResult(): ArtifactValidationResult {
  return {
    validationRunId: 'validation-1',
    artifactRef: 'artifact-1:1',
    datasetRef: 'dataset-1:1',
    validationType: 'replay',
    metrics: { holdout_pass_rate: 1, side_effect_attempt_count: 0 },
    failureRefs: [],
    counterexampleRefs: [],
    unsafe: false,
    result: 'passed',
    validatorVersion: 'validator/1.1',
    metricCatalogVersion: 'metrics/1.1',
    artifactHash: hash,
    datasetHash: laterHash,
    resultHash: hash,
    replaySafety: {
      provider: 'ReplayNoPhysicalProvider',
      physicalAdapterInvocationCount: 0,
      sideEffectAttemptCount: 0,
      deniedBeforePhysicalBoundaryCount: 0,
      denialEvidenceRefs: [],
      physicalOutcomeClaim: 'none',
    },
    completedAt: now,
  };
}

function fakeRepository(calls: string[]): ArtifactShadowRepository {
  return {
    enqueue: (input) => {
      calls.push(`enqueue:${input.shadowRunId}`);
      return Promise.resolve({
        shadowRunId: input.shadowRunId,
        artifactRef: input.artifactRef,
        artifactHash: input.artifactHash,
        formalRequestRef: input.formalRequestRef,
        status: 'queued',
        shadowMode: input.shadowMode,
        startedAt: input.createdAt,
        artifactId: input.artifactId,
        artifactVersion: input.artifactVersion,
        policySnapshotHash: input.policySnapshotHash,
        capabilityCatalogHash: input.capabilityCatalogHash,
        workState: 'pending',
        attempt: 0,
        maxAttempts: 1,
        availableAt: input.createdAt,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
    },
    claim: () => Promise.resolve([]),
    loadWork: () => Promise.resolve(undefined),
    complete: () => Promise.resolve(true),
    discardStale: () => Promise.resolve(true),
    fail: () => Promise.resolve(true),
    listRequeueable: () => Promise.resolve([]),
    createPromotionPackage: (input) => {
      calls.push(`package:${input.promotionPackageId}`);
      return Promise.resolve(input);
    },
    listPromotionEvidence: () =>
      Promise.resolve({
        validationResult: validationResult(),
        counterexamples: [],
        shadowRuns: [],
        artifact: { contentHash: hash, dependencySnapshot: {} } as unknown as CompiledArtifact,
        coverage: {
          independentGoals: 1,
          holdoutCases: 1,
          shadowRuns: 0,
          environmentClasses: ['warehouse'],
          deviceClasses: ['tablet'],
          userPreferenceIsolated: true,
          temporaryAuthorizationObserved: false,
          dependencyValid: true,
          unresolvedCriticalCounterexample: false,
          snapshotComplete: true,
        },
      }),
    recordRevalidationTrigger: (input: ArtifactRevalidationTrigger) => {
      void input;
      return Promise.resolve();
    },
    loadRevalidationValidationRun: () => Promise.resolve(undefined),
    listPendingRevalidationTriggers: () => Promise.resolve([]),
  };
}
