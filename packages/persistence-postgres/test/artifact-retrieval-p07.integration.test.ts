import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  ArtifactRetrievalService,
  type ArtifactRetrievalRequest,
} from '../../application/src/index.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../domain/src/index.js';
import {
  ArtifactRevalidationSignalAdapter,
  PostgresArtifactMatchAuditRepository,
  PostgresArtifactRepository,
  PostgresArtifactShadowGovernanceRepository,
  PostgresArtifactValidationDependencyRepository,
  PostgresRuntimeCandidateDecisionRepository,
} from '../src/index.js';

interface Fixture {
  readonly artifacts: readonly CompiledArtifact[];
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding: ArtifactRuntimeBinding;
}

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
let fixture: Fixture;

beforeAll(async () => {
  fixture = JSON.parse(
    await readFile(
      new URL('../../../schemas/v1.3/fixtures/artifact-domain.golden.json', import.meta.url),
      'utf8',
    ),
  ) as Fixture;
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE compiled_artifact,artifact_active_pointer,artifact_lineage,artifact_validation_run,
       artifact_approval,artifact_execution,artifact_feedback,artifact_match_log,experience_trace,
       pattern_candidate,cognitive_management_action,cognitive_runtime_outbox,
       cognitive_runtime_consumer_cursor,replay_dataset_case,replay_dataset_manifest,
       artifact_replay_case,artifact_promotion_assessment,artifact_promotion_package,
       artifact_promotion_policy CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P07 P06 Active -> P02 Repository -> retrieval audit integration', () => {
  it('uses the PostgreSQL active pointer, writes a durable match audit and records a revalidation signal', async () => {
    const active = await seedP06ActiveArtifact('tenant-a');
    const artifacts = new PostgresArtifactRepository(pool);
    const governance = new PostgresArtifactShadowGovernanceRepository(pool);
    let matchSequence = 0;
    let decisionSequence = 0;
    let triggerSequence = 0;
    const service = new ArtifactRetrievalService({
      repository: artifacts,
      audit: new PostgresArtifactMatchAuditRepository(pool),
      decisionAudit: new PostgresRuntimeCandidateDecisionRepository(pool),
      revalidation: new ArtifactRevalidationSignalAdapter(governance),
      validationDependencies: new PostgresArtifactValidationDependencyRepository(pool),
      authorization: { isAuthorized: () => Promise.resolve(true) },
      featureFlags: activeFeatureFlags,
      nextDecisionId: () => `p07-decision-${String(++decisionSequence)}`,
      nextMatchId: () => `p07-match-${String(++matchSequence)}`,
      nextTriggerId: () => `p07-trigger-${String(++triggerSequence)}`,
    });

    const selected = await service.retrieve(request(active, 'tenant-a'));
    expect(selected.decision).toMatchObject({
      path: 'compiled_fast',
      selectedArtifactRef: `${active.artifactId}:${String(active.version)}`,
    });
    await expect(
      new PostgresArtifactValidationDependencyRepository(pool).load({
        artifactId: active.artifactId,
        artifactVersion: active.version,
      }),
    ).resolves.toEqual({
      validatorVersion: 'artifact-replay-validator/1.1',
      promotionPolicyVersion: 'artifact-promotion-policy/1.1',
    });
    await expect(
      pool.query(
        `SELECT candidate_artifact_id,decision,reason_codes->>0 AS first_reason
         FROM artifact_match_log WHERE match_id='p07-match-1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          candidate_artifact_id: active.artifactId,
          decision: 'compiled_fast',
        }),
      ],
    });
    await expect(
      pool.query(
        `SELECT decision_id,matcher_snapshot_hash,policy_snapshot_hash
         FROM runtime_candidate_decision WHERE decision_id='p07-decision-1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          decision_id: 'p07-decision-1',
          matcher_snapshot_hash: `sha256:${'b'.repeat(64)}`,
          policy_snapshot_hash: `sha256:${'a'.repeat(64)}`,
        }),
      ],
    });

    const fallback = await service.retrieve({
      ...request(active, 'tenant-a'),
      currentDependencySnapshot: {
        ...active.dependencySnapshot,
        capabilityCatalogHash: `sha256:${'f'.repeat(64)}`,
      },
    });
    expect(fallback.decision.path).toBe('cognitive_runtime');
    await expect(
      pool.query(
        `SELECT trigger.trigger_type,trigger.source_refs,trigger.validation_run_id,run.work_state,
                run.status,run.dataset_ref
         FROM artifact_revalidation_trigger trigger
         JOIN artifact_validation_run run ON run.validation_run_id=trigger.validation_run_id
         WHERE trigger.trigger_id='p07-trigger-1'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          trigger_type: 'capability_catalog_changed',
          validation_run_id: 'dependency-revalidation-p07-trigger-1',
          work_state: 'pending',
          status: 'pending',
          dataset_ref: 'p07-promotion-holdout',
        }),
      ],
    });
    await expect(governance.listPendingRevalidationTriggers()).resolves.toContain('p07-trigger-1');
  });

  it('measures the PostgreSQL-authoritative active retrieval path without bypassing audit writes', async () => {
    const active = await seedP06ActiveArtifact('tenant-a');
    const artifacts = new PostgresArtifactRepository(pool);
    let matchSequence = 0;
    const service = new ArtifactRetrievalService({
      repository: artifacts,
      audit: new PostgresArtifactMatchAuditRepository(pool),
      decisionAudit: new PostgresRuntimeCandidateDecisionRepository(pool),
      revalidation: { signal: () => Promise.resolve() },
      validationDependencies: new PostgresArtifactValidationDependencyRepository(pool),
      authorization: { isAuthorized: () => Promise.resolve(true) },
      featureFlags: activeFeatureFlags,
      nextDecisionId: () => `p07-performance-decision-${String(matchSequence)}`,
      nextMatchId: () => `p07-performance-match-${String(++matchSequence)}`,
      nextTriggerId: () => 'p07-performance-unused-trigger',
    });
    const durations: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const startedAt = performance.now();
      const result = await service.retrieve({
        ...request(active, 'tenant-a'),
        requestId: `p07-performance-request-${String(index)}`,
        taskId: `p07-performance-task-${String(index)}`,
      });
      durations.push(performance.now() - startedAt);
      expect(result.decision.path).toBe('compiled_fast');
    }
    const sorted = [...durations].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    if (p95 === undefined) throw new Error('P07_PERFORMANCE_SAMPLES_MISSING');
    console.info(
      JSON.stringify({
        evidence: 'P07_PERFORMANCE',
        samples: durations.length,
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: p95,
        authority: 'postgresql_active_pointer_and_artifact_match_log',
      }),
    );
    expect(p95).toBeLessThan(100);
  });

  it('uses the last passed P05 holdout evidence to revalidate a global Artifact', async () => {
    const active = await seedP06ActiveArtifact(undefined);
    await seedNewerIneligibleReplay(active);
    const governance = new PostgresArtifactShadowGovernanceRepository(pool);
    const service = new ArtifactRetrievalService({
      repository: new PostgresArtifactRepository(pool),
      audit: new PostgresArtifactMatchAuditRepository(pool),
      decisionAudit: new PostgresRuntimeCandidateDecisionRepository(pool),
      revalidation: new ArtifactRevalidationSignalAdapter(governance),
      validationDependencies: new PostgresArtifactValidationDependencyRepository(pool),
      authorization: { isAuthorized: () => Promise.resolve(true) },
      featureFlags: activeFeatureFlags,
      nextDecisionId: () => 'p07-global-decision',
      nextMatchId: () => 'p07-global-match',
      nextTriggerId: () => 'p07-global-trigger',
    });
    const result = await service.retrieve({
      ...request(active, undefined),
      currentDependencySnapshot: {
        ...active.dependencySnapshot,
        capabilityCatalogHash: `sha256:${'f'.repeat(64)}`,
      },
    });
    expect(result.decision.path).toBe('cognitive_runtime');
    await expect(
      pool.query(
        `SELECT run.tenant_id,run.dataset_ref,run.dataset_version,run.dataset_hash,run.work_state
         FROM artifact_revalidation_trigger trigger
         JOIN artifact_validation_run run ON run.validation_run_id=trigger.validation_run_id
         WHERE trigger.trigger_id='p07-global-trigger'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          tenant_id: 'tenant-a',
          dataset_ref: 'p07-promotion-holdout',
          dataset_version: 1,
          dataset_hash: `sha256:${'d'.repeat(64)}`,
          work_state: 'pending',
        }),
      ],
    });
  });
});

async function seedP06ActiveArtifact(scopeTenantId: string | undefined): Promise<CompiledArtifact> {
  const source = fixture.artifacts[1];
  if (source === undefined) {
    throw new Error('P07 golden fixture must include the structured candidate artifact');
  }
  const candidate = {
    artifact: {
      ...structuredClone(source),
      scope: {
        ...structuredClone(source.scope),
        ...(scopeTenantId === undefined ? {} : { tenantId: scopeTenantId }),
      },
      status: 'candidate' as const,
    },
    lineage: {
      ...structuredClone(fixture.lineage),
      lineageId: source.lineageRef,
      artifactId: source.artifactId,
      artifactVersion: source.version,
      validationRunRefs: [],
    },
    runtimeBinding: {
      ...structuredClone(fixture.runtimeBinding),
      artifactId: source.artifactId,
      artifactVersion: source.version,
    },
  };
  const repository = new PostgresArtifactRepository(pool);
  await repository.saveCandidate(candidate);
  await pool.query(
    `INSERT INTO replay_dataset_manifest(
       dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,
       leakage_check_ref,promotion_eligible,created_at)
     VALUES($1,1,'promotion_holdout','tenant-a',$2::jsonb,$3,$4,$5,true,$6)`,
    [
      'p07-promotion-holdout',
      JSON.stringify({ datasetId: 'p07-promotion-holdout', source: 'P07 integration' }),
      `sha256:${'e'.repeat(64)}`,
      `sha256:${'d'.repeat(64)}`,
      'p07-leakage-check',
      '2026-07-29T00:00:00.000Z',
    ],
  );
  await pool.query(
    `INSERT INTO artifact_validation_run(
       validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
       metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,artifact_hash,
       dataset_hash,validator_version,metric_catalog_version,result_hash,result_payload,
       promotion_eligible,work_state,attempt,max_attempts,available_at,idempotency_key,
       created_at,updated_at)
     VALUES($1,$2,$3,'replay',$4,'passed','passed','{}'::jsonb,'[]'::jsonb,$5,$5,'tenant-a',1,
       $6,$7,'artifact-replay-validator/1.1','artifact-replay-metrics/1.1',$8,'{}'::jsonb,
       true,'completed',1,5,$5,$9,$5,$5)`,
    [
      'p07-passed-replay',
      source.artifactId,
      source.version,
      'p07-promotion-holdout',
      '2026-07-29T00:00:00.000Z',
      source.contentHash,
      `sha256:${'d'.repeat(64)}`,
      `sha256:${'f'.repeat(64)}`,
      'p07-passed-replay-idempotency',
    ],
  );
  await pool.query(
    `INSERT INTO artifact_promotion_policy(
       promotion_policy_version,policy_hash,definition,created_at,created_by)
     VALUES('artifact-promotion-policy/1.1',$1,'{}'::jsonb,$2,'p07-test')`,
    [`sha256:${'1'.repeat(64)}`, '2026-07-29T00:00:00.000Z'],
  );
  await pool.query(
    `INSERT INTO artifact_promotion_package(
       promotion_package_id,artifact_id,artifact_version,artifact_ref,artifact_hash,
       validation_summary_ref,validation_summary_hash,shadow_summary_ref,shadow_summary_hash,
       counterexample_summary_ref,counterexample_summary_hash,risk_review_ref,risk_review_hash,
       dependency_snapshot_ref,dependency_snapshot_hash,promotion_policy_version,eligibility,
       content_hash,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       'artifact-promotion-policy/1.1','eligible_for_review',$16,$17)`,
    [
      'p07-promotion-package',
      source.artifactId,
      source.version,
      `${source.artifactId}:${String(source.version)}`,
      source.contentHash,
      'p07-validation-summary',
      `sha256:${'2'.repeat(64)}`,
      'p07-shadow-summary',
      `sha256:${'3'.repeat(64)}`,
      'p07-counterexample-summary',
      `sha256:${'4'.repeat(64)}`,
      'p07-risk-review',
      `sha256:${'5'.repeat(64)}`,
      'p07-dependency-snapshot',
      `sha256:${'6'.repeat(64)}`,
      `sha256:${'7'.repeat(64)}`,
      '2026-07-29T00:00:00.000Z',
    ],
  );
  await pool.query(
    `UPDATE compiled_artifact SET status='active',validation_summary_id='p06-approved-validation'
     WHERE artifact_id=$1 AND version=$2`,
    [source.artifactId, source.version],
  );
  await pool.query(
    `INSERT INTO artifact_active_pointer(
       artifact_key,artifact_id,artifact_version,activated_by,activated_at,lock_version)
     VALUES($1,$2,$3,'p06-governance','2026-07-29T00:00:00.000Z',1)`,
    [source.artifactKey, source.artifactId, source.version],
  );
  const active = await repository.getDefinition({
    artifactId: source.artifactId,
    version: source.version,
  });
  if (active === undefined) throw new Error('P07_ACTIVE_SEED_FAILED');
  return active;
}

async function seedNewerIneligibleReplay(artifact: CompiledArtifact): Promise<void> {
  await pool.query(
    `INSERT INTO replay_dataset_manifest(
       dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,
       leakage_check_ref,promotion_eligible,created_at)
     VALUES($1,2,'promotion_holdout','tenant-a',$2::jsonb,$3,$4,$5,true,$6)`,
    [
      'p07-promotion-holdout',
      JSON.stringify({ datasetId: 'p07-promotion-holdout', version: 2 }),
      `sha256:${'8'.repeat(64)}`,
      `sha256:${'9'.repeat(64)}`,
      'p07-leakage-check-v2',
      '2026-07-30T00:00:00.000Z',
    ],
  );
  await pool.query(
    `INSERT INTO artifact_validation_run(
       validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
       metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,artifact_hash,
       dataset_hash,validator_version,metric_catalog_version,result_hash,result_payload,
       promotion_eligible,work_state,attempt,max_attempts,available_at,idempotency_key,
       created_at,updated_at)
     VALUES($1,$2,$3,'replay',$4,'passed','passed','{}'::jsonb,'[]'::jsonb,$5,$5,'tenant-a',2,
       $6,$7,'artifact-replay-validator/1.1','artifact-replay-metrics/1.1',$8,'{}'::jsonb,
       false,'completed',1,5,$5,$9,$5,$5)`,
    [
      'p07-ineligible-replay-v2',
      artifact.artifactId,
      artifact.version,
      'p07-promotion-holdout',
      '2026-07-30T00:00:00.000Z',
      artifact.contentHash,
      `sha256:${'9'.repeat(64)}`,
      `sha256:${'a'.repeat(64)}`,
      'p07-ineligible-replay-v2-idempotency',
    ],
  );
}

function request(
  artifact: CompiledArtifact,
  tenantId: string | undefined,
): ArtifactRetrievalRequest {
  return {
    requestId: 'p07-request-1',
    taskId: 'p07-task-1',
    ...(tenantId === undefined ? {} : { tenantId }),
    domain: artifact.scope.domain,
    taskTypeIds: ['task_type.inspect'],
    intentText: 'inspect device',
    structuredContext: { environmentClass: 'trusted_intranet' },
    parameterCandidates: [
      {
        parameterName: 'deviceId',
        value: 'device-1',
        source: 'user_confirmed',
        trust: 'authoritative',
        confidence: 1,
      },
    ],
    semanticScores: {},
    semanticThreshold: 0.9,
    ambiguityThreshold: 0.01,
    uncertainty: 0,
    outOfDistribution: false,
    currentDependencySnapshot: artifact.dependencySnapshot,
    currentValidatorVersion: 'artifact-replay-validator/1.1',
    currentPromotionPolicyVersion: 'artifact-promotion-policy/1.1',
    knownCapabilityIds: new Set(['capability.inspect']),
    skillCandidateRefs: { 'capability.inspect': ['skill.inspect:1'] },
    providerReadiness: { 'capability.inspect': 'ready' },
    policyDecision: 'allow',
    policySnapshotHash: `sha256:${'a'.repeat(64)}`,
    killSwitchActive: false,
    matcherSnapshotHash: `sha256:${'b'.repeat(64)}`,
    createdAt: '2026-07-29T00:00:00.000Z',
  };
}

function activeFeatureFlags() {
  return {
    artifactMode: 'active' as const,
    compilerEnabled: true,
    registryEnabled: true,
    shadowEnabled: true,
    promotionEnabled: true,
    retrievalEnabled: true,
    modelRouteEnabled: true,
    templateEnabled: true,
    ruleEnabled: true,
    fastGatewayEnabled: true,
    caseEnabled: true,
    modelCascadeEnabled: true,
    tenantAllowlist: new Set<string>(),
    artifactAllowlist: new Set(
      fixture.artifacts.map((artifact) => `${artifact.artifactId}:${String(artifact.version)}`),
    ),
  };
}
