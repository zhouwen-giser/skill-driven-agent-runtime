import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_SHADOW_GOVERNANCE_SCHEMA_HASHES,
  ArtifactDomainError,
  createArtifactActivationRecord,
  createArtifactApprovalRecord,
  createArtifactPromotionPackage,
  createArtifactRevalidationTrigger,
  createArtifactShadowResult,
  createArtifactShadowRun,
  hashArtifactApprovalRecord,
  hashCanonical,
} from '../src/index.js';

const hash = `sha256:${'a'.repeat(64)}`;
const laterHash = `sha256:${'b'.repeat(64)}`;
const timestamp = '2026-07-29T01:00:00.000Z';

describe('P06 frozen shadow and promotion contracts', () => {
  it('freezes the exact six V1.1 schema hashes', () => {
    expect(ARTIFACT_SHADOW_GOVERNANCE_SCHEMA_HASHES).toEqual({
      ArtifactShadowRun: '57b1f4a99385c94d967ac2eb84ed90dc74ab196c25e42fc67de488d963ec369d',
      ArtifactShadowResult: '69f51efc62cb86f2b0df4e5a95cf3bce00580869a0b6fb891498cdc260c1ec69',
      ArtifactPromotionPackage: '4889edac5db4fe3251d9b29c4aaddb05341bb1d9adb257398a556859a517bf52',
      ArtifactApprovalRecord: 'a041ba372f0e123ba7ba4d5fb451ba889e0f46ae727a4714aabb5c70c119394d',
      ArtifactActivationRecord: 'd45959a850c3433df4be744f77e758209e317ceb88c5dc816d448878b2e3a7ef',
      ArtifactRevalidationTrigger:
        'cd9b13e443b5fa7aa80a004bbb99b3e988a44247eed92997efa8682ea774745a',
    });
  });

  it('hashes canonical JSON with the frozen SHA-256 algorithm and no runtime adapter', () => {
    expect(hashCanonical({ b: 2, a: 1 })).toBe(
      'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
    expect(hashCanonical({ text: '你好' })).toBe(
      'sha256:ac72dedbe8e0d53dda6f5cbfd5e1c9e6f7f8bac70c7423177e450174b1c09d83',
    );
  });

  it('preserves a durable terminal shadow fact without a formal side effect', () => {
    const run = createArtifactShadowRun({
      shadowRunId: 'shadow-run-1',
      artifactRef: 'artifact-1:1',
      artifactHash: hash,
      formalRequestRef: 'request-1',
      formalGoalRef: 'goal-1',
      formalPlanRef: 'plan-1',
      formalGoalVersion: 1,
      formalPlanVersion: 1,
      status: 'completed',
      shadowMode: 'decision_and_plan',
      startedAt: timestamp,
      completedAt: '2026-07-29T01:00:01.000Z',
    });
    expect(Object.isFrozen(run)).toBe(true);
    expect(run.status).toBe('completed');
    expect(() => {
      const nonTerminal = { ...run };
      Reflect.deleteProperty(nonTerminal, 'completedAt');
      return createArtifactShadowRun({ ...nonTerminal, status: 'queued' });
    }).not.toThrow();
    expect(() => createArtifactShadowRun({ ...run, status: 'queued' })).toThrow(/terminal/u);
  });

  it('retains unknown physical outcome as absent and freezes comparison data', () => {
    const result = createArtifactShadowResult({
      shadowRunRef: 'shadow-run-1',
      artifactRef: 'artifact-1:1',
      shadowDecisionRef: 'shadow-decision-1',
      comparison: { decision_agreement: 1, physical_outcome: undefined },
      policyViolation: false,
      unsafeAttempt: false,
      stale: false,
      resultHash: hash,
      evaluatorVersion: 'shadow-evaluator/1.1',
      completedAt: timestamp,
    });
    expect(Object.isFrozen(result.comparison)).toBe(true);
    expect(result.formalOutcomeRef).toBeUndefined();
    expect(result.comparison['physical_outcome']).toBeUndefined();
  });

  it('requires every immutable evidence hash in a promotion package', () => {
    expect(
      createArtifactPromotionPackage({
        promotionPackageId: 'promotion-1',
        artifactRef: 'artifact-1:1',
        artifactHash: hash,
        validationSummaryRef: 'validation-1',
        validationSummaryHash: hash,
        shadowSummaryRef: 'shadow-summary-1',
        shadowSummaryHash: hash,
        counterexampleSummaryRef: 'counterexample-summary-1',
        counterexampleSummaryHash: hash,
        riskReviewRef: 'risk-review-1',
        riskReviewHash: hash,
        dependencySnapshotRef: 'dependency-1',
        dependencySnapshotHash: hash,
        promotionPolicyVersion: 'promotion-policy/1.1',
        eligibility: 'eligible_for_review',
        contentHash: laterHash,
        createdAt: timestamp,
      }).eligibility,
    ).toBe('eligible_for_review');
    expect(() =>
      createArtifactPromotionPackage({
        promotionPackageId: 'promotion-1',
        artifactRef: 'artifact-1:1',
        artifactHash: hash,
        validationSummaryRef: 'validation-1',
        validationSummaryHash: 'invalid',
        shadowSummaryRef: 'shadow-summary-1',
        shadowSummaryHash: hash,
        counterexampleSummaryRef: 'counterexample-summary-1',
        counterexampleSummaryHash: hash,
        riskReviewRef: 'risk-review-1',
        riskReviewHash: hash,
        dependencySnapshotRef: 'dependency-1',
        dependencySnapshotHash: hash,
        promotionPolicyVersion: 'promotion-policy/1.1',
        eligibility: 'eligible_for_review',
        contentHash: laterHash,
        createdAt: timestamp,
      }),
    ).toThrow(ArtifactDomainError);
  });

  it('binds approval and activation to exact evidence hashes and a pointer version', () => {
    const approval = createArtifactApprovalRecord({
      approvalId: 'approval-1',
      artifactId: 'artifact-1',
      artifactVersion: 1,
      approverId: 'operator-1',
      decision: 'approved',
      reason: 'Validated shadow evidence satisfies the policy.',
      validationSummaryHash: hash,
      promotionPackageHash: laterHash,
      createdAt: timestamp,
    });
    const approvalHash = hashArtifactApprovalRecord(approval);
    expect(approvalHash).toMatch(/^sha256:/u);
    expect(
      createArtifactActivationRecord({
        activationId: 'activation-1',
        artifactRef: 'artifact-1:1',
        artifactHash: hash,
        approvalRef: approval.approvalId,
        approvalHash,
        activePointerVersion: 1,
        activatedBy: approval.approverId,
        activatedAt: timestamp,
      }).activePointerVersion,
    ).toBe(1);
  });

  it('permits only registered revalidation trigger types and sourced severity', () => {
    expect(
      createArtifactRevalidationTrigger({
        triggerId: 'trigger-1',
        artifactRef: 'artifact-1:1',
        triggerType: 'new_counterexample',
        sourceRefs: ['counterexample-1'],
        severity: 'urgent',
        createdAt: timestamp,
      }).severity,
    ).toBe('urgent');
    expect(() =>
      createArtifactRevalidationTrigger({
        triggerId: 'trigger-1',
        artifactRef: 'artifact-1:1',
        triggerType: 'unbounded' as 'new_counterexample',
        sourceRefs: [],
        severity: 'urgent',
        createdAt: timestamp,
      }),
    ).toThrow(ArtifactDomainError);
  });
});
