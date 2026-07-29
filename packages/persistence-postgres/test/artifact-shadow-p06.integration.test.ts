import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  ArtifactPromotionApplicationService,
  ArtifactShadowApplicationService,
} from '../../application/src/index.js';
import {
  createArtifactApprovalRecord,
  createArtifactValidationResult,
  hashArtifactApprovalRecord,
  hashCanonical,
} from '../../domain/src/index.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../domain/src/index.js';
import {
  PostgresArtifactRepository,
  PostgresArtifactShadowGovernanceRepository,
} from '../src/index.js';

interface ArtifactFixture {
  readonly artifacts: readonly CompiledArtifact[];
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding: ArtifactRuntimeBinding;
}

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 8 });
const hash = `sha256:${'a'.repeat(64)}`;
const now = '2026-07-29T03:00:00.000Z';
let fixture: ArtifactFixture;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as ArtifactFixture;
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE compiled_artifact,artifact_active_pointer,artifact_lineage,artifact_validation_run,
       artifact_approval,artifact_execution,artifact_feedback,artifact_match_log,experience_trace,
       pattern_candidate,cognitive_management_action,cognitive_runtime_outbox,
       cognitive_runtime_consumer_cursor CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P06 P05 evidence -> promotion -> P02 activation integration', () => {
  it('uses immutable P05 result data, PostgreSQL candidate authority, exact approval binding and outbox', async () => {
    const candidate = candidatePersistence();
    const artifacts = new PostgresArtifactRepository(pool);
    const governance = new PostgresArtifactShadowGovernanceRepository(pool);
    await artifacts.saveCandidate(candidate);

    const validation = createArtifactValidationResult({
      validationRunId: 'validation-p05-1',
      artifactRef: `${candidate.artifact.artifactId}:${String(candidate.artifact.version)}`,
      datasetRef: 'dataset-p05-1:1',
      validationType: 'replay',
      metrics: { holdout_pass_rate: 1, unsafe_allow_count: 0 },
      failureRefs: [],
      counterexampleRefs: [],
      unsafe: false,
      result: 'passed',
      validatorVersion: 'validator/1.1',
      metricCatalogVersion: 'metrics/1.1',
      artifactHash: candidate.artifact.contentHash,
      datasetHash: hash,
      resultHash: hash,
      completedAt: now,
    });
    await pool.query(
      `INSERT INTO artifact_validation_run(
         validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
         metrics,counterexample_refs,started_at,completed_at,result_hash,result_payload)
       VALUES($1,$2,$3,'replay',$4,'passed','P05 immutable replay passed',$5::jsonb,'[]'::jsonb,
         $6,$6,$7,$8::jsonb)`,
      [
        validation.validationRunId,
        candidate.artifact.artifactId,
        candidate.artifact.version,
        validation.datasetRef,
        JSON.stringify(validation.metrics),
        now,
        validation.resultHash,
        JSON.stringify(validation),
      ],
    );

    const shadow = new ArtifactShadowApplicationService(
      governance,
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
    const enrolled = await shadow.enroll({
      shadowRunId: 'shadow-p06-1',
      artifactId: candidate.artifact.artifactId,
      artifactVersion: candidate.artifact.version,
      artifactRef: validation.artifactRef,
      artifactHash: candidate.artifact.contentHash,
      formalRequestRef: 'formal-request-p06-1',
      formalGoalRef: 'formal-goal-p06-1',
      formalPlanRef: 'formal-plan-p06-1',
      formalGoalVersion: 1,
      formalPlanVersion: 1,
      shadowMode: 'decision_and_plan',
      policySnapshotHash: hash,
      capabilityCatalogHash: hash,
      idempotencyKey: 'shadow-p06-1',
      expiresAt: '2026-07-29T03:05:00.000Z',
      createdAt: now,
      formalProjection: {
        decision: { route: 'formal' },
        plan: { nodeKeys: ['inspect'] },
        criterionRefs: ['criterion-p06-1'],
        evidenceRefs: [
          'evidence-p06-1',
          'environment-class:warehouse',
          'device-class:tablet',
          'preference-isolation:verified',
        ],
        riskLevel: 'medium',
        estimatedCostUnits: 2,
        estimatedLatencyMs: 10,
        correctionRefs: [],
      },
      declaredOperations: ['compare_projection'],
      currentPolicySnapshotHash: hash,
      currentCapabilityCatalogHash: hash,
      currentFormalGoalVersion: 1,
      currentFormalPlanVersion: 1,
      formalOutcomeRef: 'formal-outcome-p06-1',
    });
    expect(enrolled?.shadowRunId).toBe('shadow-p06-1');
    const claimed = await shadow.claim('shadow-worker-p06');
    expect(claimed).toHaveLength(1);
    const leased = claimed[0];
    if (leased === undefined) throw new Error('P06_SHADOW_LEASE_MISSING');
    await shadow.process(leased, 'shadow-worker-p06');
    const completedShadow = await pool.query<{
      status: string;
      work_state: string;
      last_error_code: string | null;
      last_error_summary: string | null;
    }>(
      `SELECT status,work_state,last_error_code,last_error_summary
       FROM artifact_shadow_run WHERE shadow_run_id='shadow-p06-1'`,
    );
    expect(completedShadow.rows).toEqual([
      {
        status: 'completed',
        work_state: 'completed',
        last_error_code: null,
        last_error_summary: null,
      },
    ]);
    const completedParent = await pool.query<{
      status: string;
      work_state: string;
      lease_owner: string | null;
      lease_token: string | null;
      lease_expires_at: Date | null;
    }>(
      `SELECT status,work_state,lease_owner,lease_token,lease_expires_at
       FROM artifact_validation_run WHERE validation_run_id='shadow-p06-1'`,
    );
    expect(completedParent.rows).toEqual([
      {
        status: 'passed',
        work_state: 'completed',
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      },
    ]);
    const shadowEvidence = await governance.listPromotionEvidence({
      artifactId: candidate.artifact.artifactId,
      artifactVersion: candidate.artifact.version,
    });
    expect(shadowEvidence?.shadowRuns).toHaveLength(1);
    expect(shadowEvidence?.shadowRuns[0]).toMatchObject({
      stale: false,
      unsafeAttempt: false,
      policyViolation: false,
    });

    const promotionPolicy = {
      version: 'promotion-policy/1.1',
      minimumIndependentGoals: 1,
      minimumHoldoutCases: 0,
      minimumShadowRuns: 1,
      minimumEnvironmentClasses: 1,
      minimumDeviceClasses: 1,
    };
    const coverage = {
      independentGoals: 1,
      holdoutCases: 0,
      shadowRuns: shadowEvidence?.shadowRuns.length ?? 0,
      environmentClasses: ['warehouse'],
      deviceClasses: ['tablet'],
      userPreferenceIsolated: true,
      temporaryAuthorizationObserved: false,
      dependencyValid: true,
      unresolvedCriticalCounterexample: false,
      snapshotComplete: true,
    } as const;
    const promotion = await new ArtifactPromotionApplicationService(
      governance,
      promotionPolicy,
    ).createPackage({
      promotionPackageId: 'promotion-p06-1',
      artifactRef: validation.artifactRef,
      artifactHash: candidate.artifact.contentHash,
      validationSummaryRef: validation.validationRunId,
      validationSummaryHash: validation.resultHash,
      shadowSummaryRef: 'shadow-summary-p06-1',
      shadowSummaryHash: hashCanonical(shadowEvidence?.shadowRuns ?? []),
      counterexampleSummaryRef: 'counterexample-summary-p06-1',
      counterexampleSummaryHash: hashCanonical([]),
      riskReviewRef: 'risk-review-p06-1',
      riskReviewHash: hashCanonical({
        promotionPolicyVersion: promotionPolicy.version,
        validationSummaryHash: validation.resultHash,
        shadowSummaryHash: hashCanonical(shadowEvidence?.shadowRuns ?? []),
        counterexampleSummaryHash: hashCanonical([]),
        coverage,
        eligibility: 'eligible_for_review',
        reasonCodes: [],
      }),
      dependencySnapshotRef: 'dependency-p06-1',
      dependencySnapshotHash: hashCanonical(candidate.artifact.dependencySnapshot),
      createdAt: now,
    });
    expect(promotion.eligibility).toBe('eligible_for_review');

    const approval = createArtifactApprovalRecord({
      approvalId: 'approval-p06-1',
      artifactId: candidate.artifact.artifactId,
      artifactVersion: candidate.artifact.version,
      approverId: 'operator-p06',
      decision: 'approved',
      reason: 'P05 holdout and P06 Shadow evidence reviewed by operator.',
      validationSummaryHash: validation.resultHash,
      promotionPackageHash: promotion.contentHash,
      createdAt: now,
    });
    await governance.recordApproval({
      approval,
      promotionPackageId: promotion.promotionPackageId,
      expectedVersion: candidate.artifact.version,
    });
    const activation = await governance.activateApproved({
      activationId: 'activation-p06-1',
      artifactId: candidate.artifact.artifactId,
      artifactVersion: candidate.artifact.version,
      artifactKey: candidate.artifact.artifactKey,
      expectedVersion: candidate.artifact.version,
      expectedLockVersion: 0,
      approvalId: approval.approvalId,
      approvalHash: hashArtifactApprovalRecord(approval),
      promotionPackageHash: promotion.contentHash,
      actorId: approval.approverId,
      activatedAt: now,
    });
    expect(activation.activePointerVersion).toBe(1);
    await expect(
      artifacts.getDefinition({
        artifactId: candidate.artifact.artifactId,
        version: candidate.artifact.version,
      }),
    ).resolves.toMatchObject({
      status: 'active',
      validationSummaryRef: validation.validationRunId,
    });
    await expect(
      artifacts.findActiveIndex({ domain: candidate.artifact.scope.domain }),
    ).resolves.toEqual([
      expect.objectContaining({ artifactId: candidate.artifact.artifactId, pointerLockVersion: 1 }),
    ]);

    const unsafeEnrolled = await shadow.enroll({
      shadowRunId: 'shadow-p06-safety-1',
      artifactId: candidate.artifact.artifactId,
      artifactVersion: candidate.artifact.version,
      artifactRef: validation.artifactRef,
      artifactHash: candidate.artifact.contentHash,
      formalRequestRef: 'formal-request-p06-safety-1',
      formalGoalRef: 'formal-goal-p06-safety-1',
      formalPlanRef: 'formal-plan-p06-safety-1',
      formalGoalVersion: 1,
      formalPlanVersion: 1,
      shadowMode: 'decision_and_plan',
      policySnapshotHash: hash,
      capabilityCatalogHash: hash,
      idempotencyKey: 'shadow-p06-safety-1',
      expiresAt: '2026-07-29T03:05:00.000Z',
      createdAt: now,
      declaredOperations: ['provider_operation'],
      currentPolicySnapshotHash: hash,
      currentCapabilityCatalogHash: hash,
      currentFormalGoalVersion: 1,
      currentFormalPlanVersion: 1,
    });
    expect(unsafeEnrolled?.shadowRunId).toBe('shadow-p06-safety-1');
    const unsafeClaimed = await shadow.claim('shadow-worker-p06-safety');
    const unsafeLease = unsafeClaimed[0];
    if (unsafeLease === undefined) throw new Error('P06_SAFETY_SHADOW_LEASE_MISSING');
    await shadow.process(unsafeLease, 'shadow-worker-p06-safety');
    const safetyTrigger = await pool.query<{
      validation_run_id: string;
      status: string;
      work_state: string;
      last_error_code: string | null;
    }>(
      `SELECT trigger.validation_run_id,run.status,run.work_state,run.last_error_code
       FROM artifact_revalidation_trigger trigger
       JOIN artifact_validation_run run ON run.validation_run_id=trigger.validation_run_id
       WHERE trigger.artifact_id=$1 AND trigger.artifact_version=$2
         AND trigger.trigger_type='safety_incident'`,
      [candidate.artifact.artifactId, candidate.artifact.version],
    );
    expect(safetyTrigger.rows).toEqual([
      expect.objectContaining({
        status: 'failed',
        work_state: 'dead_letter',
        last_error_code: 'ARTIFACT_REVALIDATION_SOURCE_MISSING',
      }),
    ]);
    await expect(
      artifacts.findActiveIndex({ domain: candidate.artifact.scope.domain }),
    ).resolves.toEqual([]);
    await expect(
      pool.query<{ status: string }>(
        `SELECT status FROM compiled_artifact WHERE artifact_id=$1 AND version=$2`,
        [candidate.artifact.artifactId, candidate.artifact.version],
      ),
    ).resolves.toMatchObject({ rows: [{ status: 'deprecated' }] });
    const outbox = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM cognitive_runtime_outbox ORDER BY event_type`,
    );
    expect(outbox.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        'compiler.artifact_candidate_created',
        'artifact.promotion_ready',
        'artifact.approval_recorded',
        'artifact.activated',
        'artifact.deprecated',
      ]),
    );
  });
});

function candidatePersistence() {
  const artifact = structuredClone(fixture.artifacts[0]);
  if (artifact === undefined) throw new Error('P06_ARTIFACT_FIXTURE_MISSING');
  return {
    artifact,
    lineage: {
      ...structuredClone(fixture.lineage),
      lineageId: artifact.lineageRef,
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
      validationRunRefs: [],
    },
    runtimeBinding: {
      ...structuredClone(fixture.runtimeBinding),
      artifactId: artifact.artifactId,
      artifactVersion: artifact.version,
    },
  };
}
