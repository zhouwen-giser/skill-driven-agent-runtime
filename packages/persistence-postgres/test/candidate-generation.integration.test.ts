import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  ArtifactCandidateGenerator,
  ArtifactReplayValidationApplicationService,
  CandidateGenerationApplicationService,
  CandidateGenerationTriggerDispatcher,
  DeterministicProcessMiner,
  ExperienceEligibilityPolicy,
  ExperienceNormalizationService,
  ExperienceTraceNormalizer,
  GoalExperienceEpisodeBuilder,
  PatternFusionService,
  PatternGeneralizationService,
  ProcessMiningService,
  ReplayValidationTriggerDispatcher,
} from '../../application/src/index.js';
import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveSourceRef,
  createGoalExperienceEpisode,
  createSkillUsageSpecification,
  createSkillVersion,
  hashCanonicalEvidenceJson,
  type ArtifactRef,
  type CanonicalEvidenceEnvelope,
  type CognitiveSourceRef,
  type EvidenceExportConfiguration,
  type GoalExperienceEpisode,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  PostgresArtifactRepository,
  PostgresArtifactReplayValidationRepository,
  PostgresCandidateGenerationCatalog,
  PostgresCandidateGenerationRepository,
  PostgresCompilationRunRepository,
  PostgresConversationContextRepository,
  PostgresCognitiveRuntimeFactReader,
  PostgresExperienceCompilationRepository,
  PostgresGoalExperienceEpisodeRepository,
  PostgresSkillRepository,
} from '../src/index.js';
import {
  BullMqReplayValidationQueue,
  BullMqReplayValidationWorker,
  type RedisConnectionConfig,
} from '../../runtime-redis/src/index.js';
import {
  ExperienceReplayArtifactEvidenceProjector,
  RuntimeCoreEvidenceProjector,
} from '../../runtime-control-application/src/index.js';
import {
  PostgresEvidenceStore,
  PostgresExperienceReplayArtifactEvidenceSource,
  PostgresRuntimeCoreEvidenceSource,
  PostgresRuntimeSourceArtifactResolver,
  type StoredEvidenceRecord,
} from '../../runtime-control-persistence-postgres/src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
const tenantId = 'sdar-v1-trusted-intranet';
const taskTypeId = 'workflow.policy-remediation';
const capabilities = [
  'workflow.collect',
  'workflow.verify',
  'workflow.remediate',
  'workflow.recover',
] as const;

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE artifact_counterexample,artifact_validation_failure,artifact_replay_case_result,
       replay_dataset_case,replay_dataset_manifest,artifact_replay_case,
       artifact_replay_tenant_deletion,artifact_validation_run,
       candidate_model_invocation,candidate_static_validation,candidate_fingerprint,
       generalized_pattern,fused_pattern,candidate_generation_run,artifact_lineage,compiled_artifact,
       pattern_candidate_support,pattern_candidate,experience_trace_source,experience_trace,
       compilation_run,experience_job,planning_correction_fact,planning_interaction_episode,
       goal_experience_episode_source,goal_experience_episode,
       runtime_capability_summary,cognitive_runtime_outbox,skill_version,skill,
       conversation_context,evidence_export_configuration,evidence_outbox,
       evidence_source_checkpoint,evidence_export_state,evidence_dead_letter,
       evidence_projection_issue,evidence_quality_issue,episode_evidence_manifest
       RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

function phase12EvidenceConfiguration(): EvidenceExportConfiguration {
  return {
    exportId: 'phase12-candidate-evidence',
    revision: 1,
    endpointRef: 'https://evidence.example.test/v1/batches',
    sourceId: 'phase12-candidate-runtime',
    nodeId: 'node-phase12-candidate',
    credentialRef: 'env:PHASE12_EVIDENCE_TOKEN',
    includedFamilies: [
      'runtime',
      'skill',
      'mcp_task',
      'capability',
      'experience',
      'replay',
      'artifact',
      'node_control',
      'evidence',
    ],
    batchPolicy: { maxRecords: 1_000, maxBytes: 262_144, flushIntervalMs: 1_000 },
    retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 5 },
    outboxPolicy: { maxPendingRecords: 100_000, retentionDays: 30 },
    redactionProfile: 'strict_internal_v1',
    artifactMode: 'reference',
  };
}

async function insertReplayRun(
  input: Readonly<{
    validationRunId: string;
    artifactId: string;
    artifactVersion: number;
    artifactHash: string;
    datasetId: string;
    datasetVersion: number;
    datasetHash: string;
    now: string;
    maxAttempts: number;
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO artifact_validation_run(
       validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,
       result,metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,
       artifact_hash,dataset_hash,validator_version,metric_catalog_version,result_hash,
       result_payload,work_state,attempt,max_attempts,available_at,lease_owner,lease_token,
       lease_expires_at,cancel_requested_at,idempotency_key,source_event_id,last_error_code,
       last_error_summary,created_at,updated_at)
     VALUES($1,$2,$3,'replay',$4,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$5,NULL,$6,$7,
       $8,$9,'sdar-artifact-replay-validator/1.1','sdar-validation-metrics/1.1',
       NULL,NULL,'pending',0,$10,$5,NULL,NULL,NULL,NULL,$11,NULL,NULL,NULL,$5,$5)`,
    [
      input.validationRunId,
      input.artifactId,
      input.artifactVersion,
      input.datasetId,
      input.now,
      tenantId,
      input.datasetVersion,
      input.artifactHash,
      input.datasetHash,
      input.maxAttempts,
      `artifact-replay-test:${input.validationRunId}`,
    ],
  );
}

async function waitForCompletedReplayRuns(
  validationRunIds: readonly string[],
  expected: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ completed: number }>(
      `SELECT count(*)::integer AS completed
       FROM artifact_validation_run
       WHERE validation_run_id=ANY($1::text[]) AND work_state='completed'`,
      [validationRunIds],
    );
    if (result.rows[0]?.completed === expected) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error('P05_BULLMQ_WORKERS_TIMEOUT');
}

describe('P04R real P03→P04→P02 candidate product chain', () => {
  it('normalizes Formal facts, mines WorkflowPattern V1.2 and atomically saves a valid P02 Candidate', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    await contexts.save({
      contextId: 'context-success-a',
      userId: 'user-a',
      createdAt: '2026-07-28T03:00:00.000Z',
      updatedAt: '2026-07-28T03:00:00.000Z',
    });
    await contexts.save({
      contextId: 'context-success-b',
      userId: 'user-b',
      createdAt: '2026-07-28T03:00:01.000Z',
      updatedAt: '2026-07-28T03:00:01.000Z',
    });
    await contexts.save({
      contextId: 'context-failure-recovery',
      userId: 'user-b',
      createdAt: '2026-07-28T03:00:02.000Z',
      updatedAt: '2026-07-28T03:00:02.000Z',
    });
    await saveTerminalAuthorityFixtures();
    const episodeRepository = new PostgresGoalExperienceEpisodeRepository(pool);
    for (const episode of [
      formalEpisode('success-a', 'user-a', 'succeeded'),
      formalEpisode('success-b', 'user-b', 'succeeded'),
      formalEpisode('failure-recovery', 'user-b', 'failed'),
    ]) {
      await expect(episodeRepository.saveIfAbsent(episode)).resolves.toBe(true);
    }
    await saveCapabilityCatalog();

    const clock = { now: () => '2026-07-28T04:00:00.000Z' };
    const compilation = new PostgresExperienceCompilationRepository(pool);
    const compilationRuns = new PostgresCompilationRunRepository(pool);
    const normalization = new ExperienceNormalizationService({
      runs: compilationRuns,
      repository: compilation,
      normalizer: new ExperienceTraceNormalizer(),
      clock,
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });
    for (const episodeId of [
      'episode-p04r-success-a',
      'episode-p04r-success-b',
      'episode-p04r-failure-recovery',
    ]) {
      await compilationRuns.createNormalizationRun(episodeId, clock.now(), 3);
      const [run] = await normalization.claim('normalizer-p04r', 1);
      if (run === undefined) throw new Error('P04R_NORMALIZATION_RUN_MISSING');
      await normalization.process(run, 'normalizer-p04r');
    }
    const cohort = {
      tenantId,
      taskTypeId,
      minimumCompleteness: 0.8,
    } as const;
    const traces = await compilation.listTraces(cohort);
    expect(traces).toHaveLength(3);
    expect(
      traces.flatMap((trace) =>
        trace.trace.events.flatMap((event) =>
          event.activity === undefined || event.activity === null
            ? []
            : [event.activity.activityKey],
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        'skill-goal:collect-workflow-state',
        'skill-goal:verify-policy',
        'skill-goal:apply-safe-remediation',
      ]),
    );

    const miner = new DeterministicProcessMiner({ mandatoryThreshold: 2 / 3 });
    const miningRun = await compilationRuns.createProcessMiningRun(
      cohort,
      miner.fingerprintCohort(cohort),
      clock.now(),
      3,
    );
    const [claimedMining] = await compilationRuns.claim(
      'process_mining',
      'miner-p04r',
      clock.now(),
      120_000,
      1,
    );
    if (claimedMining?.runId !== miningRun.runId) {
      throw new Error('P04R_MINING_RUN_MISSING');
    }
    await new ProcessMiningService({
      runs: compilationRuns,
      repository: compilation,
      miner,
      clock,
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    }).process(claimedMining, 'miner-p04r');

    const patternRow = await pool.query<{ pattern_id: string }>(
      'SELECT pattern_id FROM pattern_candidate ORDER BY pattern_id LIMIT 1',
    );
    const sourcePatternRef = patternRow.rows[0]?.pattern_id;
    if (sourcePatternRef === undefined) throw new Error('P04R_PATTERN_MISSING');

    const candidateRuns = new PostgresCandidateGenerationRepository(pool);
    const wakes: string[] = [];
    await new CandidateGenerationTriggerDispatcher({
      source: candidateRuns,
      runs: candidateRuns,
      queue: {
        enqueue(runId) {
          wakes.push(runId);
          return Promise.resolve();
        },
      },
    }).dispatch();
    expect(wakes).toHaveLength(1);
    const service = new CandidateGenerationApplicationService({
      runs: candidateRuns,
      catalog: new PostgresCandidateGenerationCatalog(new PostgresSkillRepository(pool)),
      fusion: new PatternFusionService(),
      generalization: new PatternGeneralizationService(),
      generator: new ArtifactCandidateGenerator(),
      clock,
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });
    const [candidateRun] = await service.claim('candidate-worker-p04r', 1);
    if (candidateRun === undefined) throw new Error('P04R_CANDIDATE_RUN_MISSING');
    await service.process(candidateRun, 'candidate-worker-p04r');

    const evidence = await pool.query<{
      candidates: number;
      lineage: number;
      validations: number;
      fingerprints: number;
      fused: number;
      generalized: number;
      events: number;
      completed_runs: number;
      validation_result: string;
      all_v12_gates: boolean;
      artifact_id: string;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM compiled_artifact WHERE status='candidate') AS candidates,
         (SELECT count(*)::integer FROM artifact_lineage) AS lineage,
         (SELECT count(*)::integer FROM candidate_static_validation) AS validations,
         (SELECT count(*)::integer FROM candidate_fingerprint) AS fingerprints,
         (SELECT count(*)::integer FROM fused_pattern) AS fused,
         (SELECT count(*)::integer FROM generalized_pattern) AS generalized,
         (SELECT count(*)::integer FROM cognitive_runtime_outbox
          WHERE event_type='compiler.artifact_candidate_created') AS events,
         (SELECT count(*)::integer FROM candidate_generation_run
          WHERE status='completed') AS completed_runs,
         (SELECT result FROM candidate_static_validation LIMIT 1) AS validation_result,
         (SELECT schema_valid AND activity_identity_valid AND dag_valid
                 AND parallel_semantics_valid AND required_criteria_covered
                 AND capability_shape_valid AND capability_catalog_aligned
                 AND parameter_policy_valid AND parameter_schema_aligned
                 AND applicability_evaluable AND lineage_complete
                 AND recovery_semantics_valid AND side_effect_replay_safe AND bounds_valid
          FROM candidate_static_validation LIMIT 1) AS all_v12_gates,
         (SELECT artifact_id FROM compiled_artifact LIMIT 1) AS artifact_id`,
    );
    expect(evidence.rows[0]).toMatchObject({
      candidates: 1,
      lineage: 1,
      validations: 1,
      fingerprints: 1,
      fused: 1,
      generalized: 1,
      events: 1,
      completed_runs: 1,
      validation_result: 'passed_static',
      all_v12_gates: true,
    });
    const artifactId = evidence.rows[0]?.artifact_id;
    if (artifactId === undefined) throw new Error('P04R_ARTIFACT_MISSING');
    const artifact = await new PostgresArtifactRepository(pool).getDefinition({
      artifactId,
      version: 1,
    });
    expect(artifact).toMatchObject({
      artifactId,
      artifactType: 'plan_template',
      status: 'candidate',
      requiredCapabilities: expect.arrayContaining(
        capabilities.map((capabilityId) => ({ capabilityId })),
      ),
    });
    expect(JSON.stringify(artifact?.definition)).not.toMatch(
      /observe_input|verify_constraint|execute_action|recover_failure/u,
    );
    const loadedSource = await candidateRuns.loadSource(candidateRun);
    expect(loadedSource?.sourceUserScopeIds).toEqual(['user-a', 'user-b']);
    expect(loadedSource?.scopeEvidence.hasTemporaryAuthorization).toBe(false);
    if (loadedSource === undefined) throw new Error('P04R_CONFLICT_SOURCE_MISSING');
    const conflictFused = await new PatternFusionService().fuse({
      workflowPattern: loadedSource.workflowPattern,
      discoveredPattern: loadedSource.discoveredPattern,
      domain: loadedSource.domain,
      tenantId: loadedSource.tenantId,
      environmentClasses: loadedSource.environmentClasses,
      deviceClasses: loadedSource.deviceClasses,
      tenantScope: 'single',
      userScope: loadedSource.userScope,
      scopeEvidence: loadedSource.scopeEvidence,
    });
    const conflictGeneralized = new PatternGeneralizationService().generalize({
      fusedPattern: conflictFused,
      knownTaskTypeCapabilities: capabilities,
    });
    const conflictCandidate = new ArtifactCandidateGenerator().generate({
      generalizedPattern: conflictGeneralized,
      fusedPattern: conflictFused,
      knownCapabilityIds: capabilities,
      sourceEpisodeRefs: loadedSource.sourceEpisodeRefs,
      sourceCorrectionRefs: loadedSource.sourceCorrectionRefs,
      sourceUserScopeIds: loadedSource.sourceUserScopeIds,
      tenantId: loadedSource.tenantId,
      createdAt: clock.now(),
    });
    await pool.query(`UPDATE fused_pattern SET content_hash=$2 WHERE fused_pattern_id=$1`, [
      conflictFused.fusedPatternId,
      `sha256:${'f'.repeat(64)}`,
    ]);
    await pool.query(
      `UPDATE candidate_generation_run
       SET status='leased',lease_owner='conflict-worker',lease_token='conflict-token',
           lease_expires_at='2026-07-28T04:02:00.000Z',completed_at=NULL
       WHERE run_id=$1`,
      [candidateRun.runId],
    );
    await expect(
      candidateRuns.completeAtomically(
        {
          ...candidateRun,
          status: 'leased',
          leaseOwner: 'conflict-worker',
          leaseToken: 'conflict-token',
          leaseExpiresAt: '2026-07-28T04:02:00.000Z',
        },
        'conflict-worker',
        'conflict-token',
        {
          fusedPattern: conflictFused,
          generalizedPattern: conflictGeneralized,
          candidate: conflictCandidate,
        },
        clock.now(),
      ),
    ).rejects.toThrow(/FUSED_PATTERN_IMMUTABLE_CONFLICT/u);
    const conflictState = await pool.query<{ status: string }>(
      'SELECT status FROM candidate_generation_run WHERE run_id=$1',
      [candidateRun.runId],
    );
    expect(conflictState.rows[0]?.status).toBe('leased');
    await pool.query(
      `UPDATE goal_experience_episode
       SET snapshot=jsonb_set(
         snapshot,
         '{task,temporarySkillId}',
         to_jsonb('temporary-skill-p04r'::text),
         true
       )
       WHERE episode_id='episode-p04r-success-a'`,
    );
    const temporarySource = await candidateRuns.loadSource(candidateRun);
    expect(temporarySource?.scopeEvidence.hasTemporaryAuthorization).toBe(true);
    if (temporarySource === undefined) throw new Error('P04R_TEMPORARY_SOURCE_MISSING');
    const temporaryFused = await new PatternFusionService().fuse({
      workflowPattern: temporarySource.workflowPattern,
      discoveredPattern: temporarySource.discoveredPattern,
      domain: temporarySource.domain,
      tenantId: temporarySource.tenantId,
      environmentClasses: temporarySource.environmentClasses,
      deviceClasses: temporarySource.deviceClasses,
      tenantScope: 'single',
      userScope: temporarySource.userScope,
      scopeEvidence: temporarySource.scopeEvidence,
    });
    expect(() =>
      new PatternGeneralizationService().generalize({
        fusedPattern: temporaryFused,
        knownTaskTypeCapabilities: capabilities,
      }),
    ).toThrow(/TEMPORARY_AUTHORIZATION_REJECTED/u);
  }, 30_000);

  it('continues Formal facts through P03, P04 and P02 into durable P05 replay validation', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const original = [
      {
        suffix: 'success-a',
        userId: 'user-a',
        achieved: true,
        timestamp: '2026-07-28T03:00:00.000Z',
      },
      {
        suffix: 'success-b',
        userId: 'user-b',
        achieved: true,
        timestamp: '2026-07-28T03:00:01.000Z',
      },
      {
        suffix: 'failure-recovery',
        userId: 'user-b',
        achieved: false,
        timestamp: '2026-07-28T03:00:02.000Z',
      },
    ] as const;
    for (const item of original) {
      await contexts.save({
        contextId: `context-${item.suffix}`,
        userId: item.userId,
        createdAt: item.timestamp,
        updatedAt: item.timestamp,
      });
    }
    await saveTerminalAuthorityFixtures(original);
    const episodeRepository = new PostgresGoalExperienceEpisodeRepository(pool);
    for (const item of original) {
      await episodeRepository.saveIfAbsent(
        formalEpisode(item.suffix, item.userId, item.achieved ? 'succeeded' : 'failed'),
      );
    }
    await saveCapabilityCatalog();

    const now = { value: '2026-07-28T04:00:00.000Z' };
    const clock = { now: () => now.value };
    const compilation = new PostgresExperienceCompilationRepository(pool);
    const compilationRuns = new PostgresCompilationRunRepository(pool);
    const normalization = new ExperienceNormalizationService({
      runs: compilationRuns,
      repository: compilation,
      normalizer: new ExperienceTraceNormalizer(),
      clock,
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });
    for (const item of original) {
      await compilationRuns.createNormalizationRun(`episode-p04r-${item.suffix}`, clock.now(), 3);
      const [normalizationRun] = await normalization.claim('normalizer-p05', 1);
      if (normalizationRun === undefined) throw new Error('P05_NORMALIZATION_RUN_MISSING');
      await normalization.process(normalizationRun, 'normalizer-p05');
    }
    const cohort = { tenantId, taskTypeId, minimumCompleteness: 0.8 } as const;
    const miner = new DeterministicProcessMiner({ mandatoryThreshold: 2 / 3 });
    const miningRun = await compilationRuns.createProcessMiningRun(
      cohort,
      miner.fingerprintCohort(cohort),
      clock.now(),
      3,
    );
    const [claimedMining] = await compilationRuns.claim(
      'process_mining',
      'miner-p05',
      clock.now(),
      120_000,
      1,
    );
    if (claimedMining?.runId !== miningRun.runId) throw new Error('P05_MINING_RUN_MISSING');
    await new ProcessMiningService({
      runs: compilationRuns,
      repository: compilation,
      miner,
      clock,
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    }).process(claimedMining, 'miner-p05');

    const pattern = await pool.query<{ pattern_id: string }>(
      'SELECT pattern_id FROM pattern_candidate ORDER BY pattern_id LIMIT 1',
    );
    if (pattern.rows[0] === undefined) throw new Error('P05_PATTERN_MISSING');
    const candidateRuns = new PostgresCandidateGenerationRepository(pool);
    await new CandidateGenerationTriggerDispatcher({
      source: candidateRuns,
      runs: candidateRuns,
      queue: { enqueue: () => Promise.resolve() },
    }).dispatch();
    const candidateService = new CandidateGenerationApplicationService({
      runs: candidateRuns,
      catalog: new PostgresCandidateGenerationCatalog(new PostgresSkillRepository(pool)),
      fusion: new PatternFusionService(),
      generalization: new PatternGeneralizationService(),
      generator: new ArtifactCandidateGenerator(),
      clock,
      retryPolicy: { maxAttempts: 3, baseBackoffMs: 1_000, maxBackoffMs: 10_000 },
    });
    const [candidateRun] = await candidateService.claim('candidate-worker-p05', 1);
    if (candidateRun === undefined) throw new Error('P05_CANDIDATE_RUN_MISSING');
    await candidateService.process(candidateRun, 'candidate-worker-p05');

    const independent = [
      {
        suffix: 'p05-holdout-a',
        timestamp: '2026-07-28T03:10:00.000Z',
        request: 'Inspect tenant A workflow and remediate its policy deviation.',
      },
      {
        suffix: 'p05-holdout-b',
        timestamp: '2026-07-28T03:20:00.000Z',
        request: 'Verify tenant B workflow policy before applying remediation.',
      },
      {
        suffix: 'p05-holdout-c',
        timestamp: '2026-07-28T03:30:00.000Z',
        request: 'Collect workflow C state and safely resolve the verified deviation.',
      },
      {
        suffix: 'p05-holdout-d',
        timestamp: '2026-07-28T03:40:00.000Z',
        request: 'Audit workflow D policy and execute only the bounded repair.',
      },
      {
        suffix: 'p05-holdout-e',
        timestamp: '2026-07-28T03:50:00.000Z',
        request: 'Evaluate workflow E safeguards and apply the constrained correction.',
      },
    ] as const;
    for (const item of independent) {
      await contexts.save({
        contextId: `context-${item.suffix}`,
        userId: `user-${item.suffix}`,
        createdAt: item.timestamp,
        updatedAt: item.timestamp,
      });
    }
    await saveTerminalAuthorityFixtures(
      independent.map((item) => ({
        suffix: item.suffix,
        achieved: true,
        timestamp: item.timestamp,
        userId: `user-${item.suffix}`,
        request: item.request,
      })),
    );
    await saveHistoricalCapabilityAuthorities(independent);
    await pool.query(
      `UPDATE skill_version
       SET status='disabled'
       WHERE skill_id='skill.workflow-policy-remediation' AND version=1`,
    );
    for (const item of independent) {
      const episode = await new GoalExperienceEpisodeBuilder({
        facts: new PostgresCognitiveRuntimeFactReader(pool),
        episodes: episodeRepository,
        eligibility: new ExperienceEligibilityPolicy(),
        clock: { now: () => item.timestamp },
        nextEpisodeId: () => `episode-p04r-${item.suffix}`,
      }).build({ goalId: `goal-${item.suffix}`, goalVersion: 1 });
      await episodeRepository.saveIfAbsent(episode);
      await compilationRuns.createNormalizationRun(episode.episodeId, clock.now(), 3);
      const [normalizationRun] = await normalization.claim('normalizer-p05-holdout', 1);
      if (normalizationRun === undefined) {
        throw new Error('P05_HOLDOUT_NORMALIZATION_RUN_MISSING');
      }
      await normalization.process(normalizationRun, 'normalizer-p05-holdout');
    }

    now.value = '2026-07-28T05:00:00.000Z';
    const replayRepository = new PostgresArtifactReplayValidationRepository(pool);
    const replayWakes: string[] = [];
    const dispatched = await new ReplayValidationTriggerDispatcher(
      replayRepository,
      {
        enqueue(validationRunId) {
          replayWakes.push(validationRunId);
          return Promise.resolve();
        },
      },
      clock,
    ).dispatch();
    expect(dispatched).toBe(1);
    expect(replayWakes).toHaveLength(1);
    const replayService = new ArtifactReplayValidationApplicationService(replayRepository, clock, {
      maxAttempts: 3,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
    });
    const [replayRun] = await replayService.claim('replay-worker-p05', 1);
    if (replayRun === undefined) throw new Error('P05_REPLAY_RUN_MISSING');
    now.value = '2026-07-28T05:00:01.000Z';
    await replayService.process(replayRun, 'replay-worker-p05');

    const evidence = await pool.query<{
      cases: number;
      datasets: number;
      purposes: number;
      completed_runs: number;
      case_results: number;
      completion_events: number;
      result: string;
      work_state: string;
      result_hash: string;
      candidate_status: string;
      last_error_code: string | null;
      last_error_summary: string | null;
      native_episode_sources: number;
      production_authority_sources: number;
      historical_catalog_sources: number;
      historical_ready_capabilities: number;
      current_enabled_skill_versions: number;
      native_catalog_refs: number;
      native_policy_refs: number;
      counterfactual_results: number;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM artifact_replay_case) AS cases,
         (SELECT count(*)::integer FROM replay_dataset_manifest) AS datasets,
         (SELECT count(DISTINCT purpose)::integer FROM replay_dataset_manifest) AS purposes,
         (SELECT count(*)::integer FROM artifact_validation_run
          WHERE validation_type='replay' AND work_state='completed') AS completed_runs,
         (SELECT count(*)::integer FROM artifact_replay_case_result) AS case_results,
         (SELECT count(*)::integer FROM cognitive_runtime_outbox
          WHERE event_type='artifact.validation_completed') AS completion_events,
         (SELECT result FROM artifact_validation_run
          WHERE validation_type='replay' LIMIT 1) AS result,
         (SELECT work_state FROM artifact_validation_run
          WHERE validation_type='replay' LIMIT 1) AS work_state,
         (SELECT result_hash FROM artifact_validation_run
          WHERE validation_type='replay' LIMIT 1) AS result_hash,
         (SELECT last_error_code FROM artifact_validation_run
          WHERE validation_type='replay' LIMIT 1) AS last_error_code,
         (SELECT last_error_summary FROM artifact_validation_run
          WHERE validation_type='replay' LIMIT 1) AS last_error_summary,
         (SELECT count(*)::integer FROM goal_experience_episode episode
          WHERE NOT (episode.snapshot ? 'replayValidation')
            AND episode.snapshot ? 'contract'
            AND episode.snapshot ? 'currentPlan'
            AND episode.snapshot ? 'capabilityCatalogSnapshot') AS native_episode_sources,
         (SELECT count(*)::integer FROM goal_experience_episode episode
          WHERE episode.snapshot->'policyDecisionSnapshot' ? 'readinessRef'
            AND episode.snapshot->'worldStateSnapshot' ? 'executionReadiness')
            AS production_authority_sources,
         (SELECT count(*)::integer FROM goal_experience_episode episode
          WHERE episode.snapshot->'capabilityCatalogSnapshot'->>'summaryId'
                  ='runtime-capability-summary-p05'
            AND EXISTS(
              SELECT 1
              FROM goal_experience_episode_source source
              WHERE source.episode_id=episode.episode_id
                AND source.source_kind='capability_summary'
                AND source.source_id='runtime-capability-summary-p05'
            )) AS historical_catalog_sources,
         (SELECT COALESCE(sum(jsonb_array_length(
                   episode.snapshot->'capabilityCatalogSnapshot'->'readyCapabilityIds'
                 )),0)::integer
          FROM goal_experience_episode episode
          WHERE episode.snapshot->'capabilityCatalogSnapshot'->>'summaryId'
                  ='runtime-capability-summary-p05') AS historical_ready_capabilities,
         (SELECT count(*)::integer
          FROM skill_version
          WHERE status='enabled') AS current_enabled_skill_versions,
         (SELECT count(*)::integer FROM artifact_replay_case replay
          WHERE replay.content->>'capabilityCatalogSnapshotRef'
            LIKE '%capabilityCatalogSnapshot.knownCapabilityIds') AS native_catalog_refs,
         (SELECT count(*)::integer FROM artifact_replay_case replay
          WHERE replay.content->>'policySnapshotRef'
            LIKE '%policyDecisionSnapshot.authorityDecision') AS native_policy_refs,
         (SELECT count(*)::integer FROM artifact_replay_case_result result
          WHERE result.evaluation ? 'counterfactual'
            AND result.evaluation->'counterfactual' ? 'riskLevelDelta'
            AND result.evaluation->'counterfactual' ? 'criterionCoverageDelta'
            AND result.evaluation->'counterfactual' ? 'recoveryBranchDelta')
            AS counterfactual_results,
         (SELECT status FROM compiled_artifact LIMIT 1) AS candidate_status`,
    );
    if (evidence.rows[0]?.result !== 'passed') {
      const failureDiagnostics = await pool.query<{
        category: string;
        explanation: string;
        replay_case_id: string;
      }>(
        `SELECT failure.category,failure.content->>'explanation' AS explanation,
                failure.replay_case_id
         FROM artifact_validation_failure failure
         ORDER BY failure.replay_case_id,failure.category`,
      );
      console.info(
        JSON.stringify({
          event: 'p05.replay_validation.failure_diagnostics',
          failures: failureDiagnostics.rows,
        }),
      );
    }
    expect(evidence.rows[0]).toMatchObject({
      cases: 8,
      datasets: 4,
      purposes: 4,
      completed_runs: 1,
      case_results: 3,
      completion_events: 1,
      result: 'passed',
      work_state: 'completed',
      candidate_status: 'candidate',
      last_error_code: null,
      last_error_summary: null,
      native_episode_sources: 8,
      production_authority_sources: 5,
      historical_catalog_sources: 5,
      historical_ready_capabilities: 20,
      current_enabled_skill_versions: 0,
      native_catalog_refs: 8,
      native_policy_refs: 8,
      counterfactual_results: 3,
    });
    expect(evidence.rows[0]?.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const evidenceStore = new PostgresEvidenceStore(pool);
    const runtimeEvidenceSource = new PostgresRuntimeCoreEvidenceSource(pool);
    const runtimeEvidenceProjector = new RuntimeCoreEvidenceProjector({
      source: runtimeEvidenceSource,
      writer: evidenceStore,
      environment: 'integration',
      clock: { now: () => '2026-07-28T05:00:01.250Z' },
    });
    const runtimeTaskIds = await runtimeEvidenceSource.pendingTaskIds(100);
    expect(runtimeTaskIds).toEqual(
      expect.arrayContaining([
        'task-success-a',
        'task-success-b',
        'task-failure-recovery',
        ...independent.map((item) => `task-${item.suffix}`),
      ]),
    );
    for (const taskId of runtimeTaskIds) {
      const projection = await runtimeEvidenceProjector.projectTask(taskId);
      expect(projection.qualityIssueIds).toEqual([]);
      expect(projection.projectedRecordIds).toEqual(
        expect.arrayContaining([expect.stringMatching(/^evidence_[0-9a-f]{64}$/u)]),
      );
    }

    const phase8Clock = { value: '2026-07-28T05:00:02.000Z' };
    const phase8Source = new PostgresExperienceReplayArtifactEvidenceSource(pool);
    const phase8Projector = new ExperienceReplayArtifactEvidenceProjector({
      source: phase8Source,
      writer: evidenceStore,
      environment: 'integration',
      clock: { now: () => phase8Clock.value },
    });
    const phase8Partitions = await phase8Source.pendingPartitions(1_000);
    expect(phase8Partitions.map((partition) => partition.kind)).toEqual(
      expect.arrayContaining([
        'experience_task',
        'experience_pattern',
        'replay_case',
        'artifact',
        'replay_dataset',
        'validation',
      ]),
    );
    expect(phase8Partitions.map((partition) => phase8ProjectionPriority(partition.kind))).toEqual(
      [...phase8Partitions]
        .map((partition) => phase8ProjectionPriority(partition.kind))
        .sort((left, right) => left - right),
    );
    for (const partition of phase8Partitions) {
      const projection = await phase8Projector.projectPartition(partition);
      expect(projection.sourcePartition).toBe(partition.sourcePartition);
      expect(projection.qualityIssueIds).toEqual([]);
      expect(projection.projectedRecordIds.length).toBeGreaterThan(0);
    }

    await evidenceStore.applyConfiguration(
      phase12EvidenceConfiguration(),
      '2026-07-28T05:00:02.500Z',
    );

    const phase8Rows = (
      await Promise.all(
        phase8Partitions.map((partition) =>
          evidenceStore.pending(partition.sourcePartition, 1_000, '2026-07-28T05:00:03.000Z'),
        ),
      )
    ).flat();
    expect(phase8Rows.length).toBeGreaterThan(0);
    const phase8RecordTypes = new Set(phase8Rows.map(({ envelope }) => envelope.recordType));
    for (const recordType of [
      'experience.episode',
      'experience.trace',
      'experience.workflow_pattern',
      'replay.case',
      'replay.dataset',
      'artifact.lifecycle',
      'artifact.validation',
      'replay.run',
      'replay.case_result',
      'replay.metric_result',
    ]) {
      expect(phase8RecordTypes.has(recordType)).toBe(true);
    }

    const schemaValidator = new AjvJsonSchemaValidator({ strict: false });
    const checkedSchemas = new Set<string>();
    for (const { envelope, sourcePartition } of phase8Rows) {
      expect(sourcePartition).toMatch(/^v141:/u);
      expect(
        phase8Partitions.some((partition) => partition.sourcePartition === sourcePartition),
      ).toBe(true);
      expect(envelope.recordId).toMatch(/^evidence_[0-9a-f]{64}$/u);
      expect(envelope.payloadHash).toBe(hashCanonicalEvidenceJson(envelope.payload));
      if (!checkedSchemas.has(envelope.recordType)) {
        const schema = JSON.parse(
          readFileSync(
            path.resolve('schemas/evidence/v1/records', `${envelope.recordType}.schema.json`),
            'utf8',
          ),
        ) as object;
        expect(schemaValidator.validate(schema, envelope)).toEqual({ valid: true, errors: [] });
        checkedSchemas.add(envelope.recordType);
      }
    }
    const allEvidenceIds = new Set(
      (await pool.query<{ record_id: string }>('SELECT record_id FROM evidence_outbox')).rows.map(
        (row) => row.record_id,
      ),
    );
    for (const { envelope } of phase8Rows) {
      for (const reference of envelope.evidenceRefs.filter((value) =>
        value.startsWith('evidence_'),
      )) {
        expect(allEvidenceIds.has(reference)).toBe(true);
      }
    }

    const taskTrace = requiredPhase8Evidence(
      phase8Rows,
      'experience.trace',
      (envelope) => phase8PayloadField(envelope, 'sourceEpisodeId') === 'episode-p04r-success-a',
    );
    expect(taskTrace).toMatchObject({
      tenantId,
      userScopeId: 'user-a',
      taskId: 'task-success-a',
      contextId: 'context-success-a',
      episodeId: 'task-success-a',
      goalId: 'goal-success-a',
      goalVersion: 1,
    });
    const taskEpisode = requiredPhase8Evidence(
      phase8Rows,
      'experience.episode',
      (envelope) => envelope.sourceRecordId === 'episode-p04r-success-a',
    );
    expect(taskTrace.evidenceRefs).toEqual([taskEpisode.recordId]);
    expect(requiredPhase8StoredEvidence(phase8Rows, taskTrace.recordId).sourcePartition).toBe(
      'v141:experience_task:14:task-success-a',
    );

    const workflowPatternEvidence = requiredPhase8Evidence(
      phase8Rows,
      'experience.workflow_pattern',
    );
    const artifactLifecycleEvidence = requiredPhase8Evidence(phase8Rows, 'artifact.lifecycle');
    const replayDatasetEvidence = requiredPhase8Evidence(
      phase8Rows,
      'replay.dataset',
      (envelope) =>
        envelope.sourceRecordId === `${replayRun.datasetId}:${String(replayRun.datasetVersion)}`,
    );
    const replayRunEvidence = requiredPhase8Evidence(
      phase8Rows,
      'replay.run',
      (envelope) => envelope.sourceRecordId === replayRun.validationRunId,
    );
    for (const globalEvidence of [
      workflowPatternEvidence,
      artifactLifecycleEvidence,
      replayDatasetEvidence,
      replayRunEvidence,
    ]) {
      expect(globalEvidence).not.toHaveProperty('taskId');
      expect(globalEvidence).not.toHaveProperty('contextId');
      expect(globalEvidence).not.toHaveProperty('episodeId');
      expect(globalEvidence).not.toHaveProperty('userScopeId');
      expect(globalEvidence).not.toHaveProperty('goalId');
      expect(globalEvidence).not.toHaveProperty('planId');
    }
    for (const [globalEvidence, partitionKind] of [
      [workflowPatternEvidence, 'experience_pattern'],
      [artifactLifecycleEvidence, 'artifact'],
      [replayDatasetEvidence, 'replay_dataset'],
      [replayRunEvidence, 'validation'],
    ] as const) {
      expect(
        requiredPhase8StoredEvidence(phase8Rows, globalEvidence.recordId).sourcePartition,
      ).toMatch(new RegExp(`^v141:${partitionKind}:`, 'u'));
    }
    expect(artifactLifecycleEvidence.evidenceRefs).toContain(workflowPatternEvidence.recordId);
    expect(replayRunEvidence.evidenceRefs).toEqual(
      expect.arrayContaining([
        replayDatasetEvidence.recordId,
        requiredPhase8Evidence(
          phase8Rows,
          'artifact.validation',
          (envelope) => envelope.sourceRecordId === replayRun.validationRunId,
        ).recordId,
      ]),
    );

    const persistedReplayResult = await pool.query<{
      result_payload: Record<string, unknown>;
    }>(`SELECT result_payload FROM artifact_validation_run WHERE validation_run_id=$1`, [
      replayRun.validationRunId,
    ]);
    expect(replayRunEvidence.payload).toMatchObject({
      replaySafetyStatus: 'verified',
      noPhysicalSideEffects: true,
      replaySafety: persistedReplayResult.rows[0]?.result_payload['replaySafety'],
    });

    const artifactResolver = new PostgresRuntimeSourceArtifactResolver(pool);
    for (const envelope of [
      requiredPhase8Evidence(phase8Rows, 'replay.case'),
      replayDatasetEvidence,
      artifactLifecycleEvidence,
    ]) {
      const artifactRef = requiredArtifactRef(envelope);
      const resolved = await artifactResolver.resolve(artifactRef);
      expect(resolved.artifactRef).toEqual(artifactRef);
      expect(resolved.canonicalBytes.byteLength).toBe(artifactRef.byteSize);
      expect(`sha256:${createHash('sha256').update(resolved.canonicalBytes).digest('hex')}`).toBe(
        artifactRef.sha256,
      );
      expect(envelope.artifactRefs).toEqual([artifactRef.uri]);
    }

    const lateFixture = {
      suffix: 'phase8-late-arrival',
      userId: 'user-phase8-late-arrival',
      achieved: true,
      timestamp: '2026-07-28T02:59:00.000Z',
      request: 'Collect a late authoritative workflow trace without timestamp cursor loss.',
    } as const;
    await contexts.save({
      contextId: `context-${lateFixture.suffix}`,
      userId: lateFixture.userId,
      createdAt: lateFixture.timestamp,
      updatedAt: lateFixture.timestamp,
    });
    await saveTerminalAuthorityFixtures([lateFixture]);
    const lateEpisode = formalEpisodeAt(
      lateFixture.suffix,
      lateFixture.userId,
      'succeeded',
      lateFixture.timestamp,
      lateFixture.request,
    );
    await episodeRepository.saveIfAbsent(lateEpisode);
    const lateRuntimeProjection = await runtimeEvidenceProjector.projectTask(
      `task-${lateFixture.suffix}`,
    );
    expect(lateRuntimeProjection.projectedRecordIds.length).toBeGreaterThan(0);

    const lateTaskPartition = (await phase8Source.pendingPartitions(1_000)).find(
      (partition) =>
        partition.kind === 'experience_task' && partition.sourceId === `task-${lateFixture.suffix}`,
    );
    if (lateTaskPartition === undefined) throw new Error('PHASE8_LATE_TASK_PARTITION_MISSING');
    phase8Clock.value = '2026-07-28T05:00:03.500Z';
    const beforeTraceProjection = await phase8Projector.projectPartition(lateTaskPartition);
    expect(beforeTraceProjection.qualityIssueIds).toEqual([]);
    const checkpointBeforeLateArrival = await phase8Checkpoint(
      lateTaskPartition.sourceFamily,
      lateTaskPartition.sourcePartition,
    );
    await compilationRuns.createNormalizationRun(lateEpisode.episodeId, now.value, 3);
    const [lateNormalizationRun] = await normalization.claim('normalizer-phase8-late', 1);
    if (lateNormalizationRun === undefined) {
      throw new Error('PHASE8_LATE_NORMALIZATION_RUN_MISSING');
    }
    await normalization.process(lateNormalizationRun, 'normalizer-phase8-late');
    const lateTrace = await pool.query<{ trace_id: string; created_at: string }>(
      `SELECT trace_id,created_at::text
       FROM experience_trace WHERE source_episode_id=$1`,
      [lateEpisode.episodeId],
    );
    const lateTraceId = lateTrace.rows[0]?.trace_id;
    if (lateTraceId === undefined) throw new Error('PHASE8_LATE_TRACE_MISSING');
    const rescannedPartitions = await phase8Source.pendingPartitions(1_000);
    const rescannedTaskPartition = rescannedPartitions.find(
      (partition) => partition.sourcePartition === lateTaskPartition.sourcePartition,
    );
    if (rescannedTaskPartition === undefined) {
      throw new Error('PHASE8_LATE_TRACE_PARTITION_NOT_RESCANNED');
    }
    phase8Clock.value = '2026-07-28T05:00:04.000Z';
    const lateProjection = await phase8Projector.projectPartition(rescannedTaskPartition);
    expect(lateProjection.qualityIssueIds).toEqual([]);
    const checkpointAfterLateArrival = await phase8Checkpoint(
      lateTaskPartition.sourceFamily,
      lateTaskPartition.sourcePartition,
    );
    expect(checkpointAfterLateArrival.last_occurred_at).toBe(
      checkpointBeforeLateArrival.last_occurred_at,
    );
    expect(checkpointAfterLateArrival.last_source_revision).not.toBe(
      checkpointBeforeLateArrival.last_source_revision,
    );
    const rescannedRows = await evidenceStore.pending(
      lateTaskPartition.sourcePartition,
      1_000,
      '2026-07-28T05:00:05.000Z',
    );
    expect(
      requiredPhase8Evidence(
        rescannedRows,
        'experience.trace',
        (envelope) => envelope.sourceRecordId === lateTraceId,
      ).occurredAt,
    ).toBe('2026-07-28T02:59:00.000Z');

    const holdoutLeakage = await pool.query<{ leaked: number }>(
      `SELECT count(*)::integer AS leaked
       FROM replay_dataset_manifest manifest
       JOIN replay_dataset_case member
         ON member.dataset_id=manifest.dataset_id
        AND member.dataset_version=manifest.dataset_version
       JOIN artifact_replay_case replay ON replay.replay_case_id=member.replay_case_id
       WHERE manifest.purpose='promotion_holdout'
         AND replay.content->'sourceEpisodeRefs' ?| ARRAY[
           'episode-p04r-success-a','episode-p04r-success-b','episode-p04r-failure-recovery'
         ]`,
    );
    expect(holdoutLeakage.rows[0]?.leaked).toBe(0);

    const safetySeed = await pool.query<{
      content: Record<string, unknown>;
      fixture: Record<string, unknown>;
      source_episode_id: string;
      task_type_id: string;
    }>(
      `SELECT replay.content,replay.fixture,
              replay.primary_source_episode_id AS source_episode_id,replay.task_type_id
       FROM replay_dataset_manifest manifest
       JOIN replay_dataset_case member
         ON member.dataset_id=manifest.dataset_id
        AND member.dataset_version=manifest.dataset_version
       JOIN artifact_replay_case replay ON replay.replay_case_id=member.replay_case_id
       WHERE manifest.purpose='promotion_holdout'
       ORDER BY member.ordinal LIMIT 1`,
    );
    const safetySource = safetySeed.rows[0];
    if (safetySource === undefined) throw new Error('P05_SAFETY_SOURCE_MISSING');
    const safetyCaseId = 'replay-case-p05-side-effect';
    const safetyCaseHash = sha('p05-side-effect-case');
    const safetyCase = {
      ...safetySource.content,
      replayCaseId: safetyCaseId,
      contentHash: safetyCaseHash,
    };
    const safetyFixture = {
      ...safetySource.fixture,
      replayOperations: [
        { kind: 'network_request', targetRef: 'https://physical.example.invalid/mutate' },
      ],
    };
    await pool.query(
      `INSERT INTO artifact_replay_case(
         replay_case_id,tenant_id,task_type_id,primary_source_episode_id,content,fixture,
         content_hash,snapshot_completeness,retention_until,created_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,1,$8::timestamptz + interval '365 days',$8)`,
      [
        safetyCaseId,
        tenantId,
        safetySource.task_type_id,
        safetySource.source_episode_id,
        JSON.stringify(safetyCase),
        JSON.stringify(safetyFixture),
        safetyCaseHash,
        now.value,
      ],
    );
    const safetyDatasetId = 'replay-dataset-p05-side-effect';
    const safetyDatasetHash = sha('p05-side-effect-dataset');
    const safetyDataset = {
      datasetId: safetyDatasetId,
      datasetVersion: 1,
      purpose: 'promotion_holdout',
      tenantId,
      taskTypeIds: [taskTypeId],
      caseRefs: [safetyCaseId],
      splitPolicyVersion: 'sdar-replay-split/1.1',
      sourceRange: { from: now.value, to: now.value },
      sourceHash: sha('p05-side-effect-source'),
      contentHash: safetyDatasetHash,
      leakageCheckRef: 'replay-leakage-p05-side-effect',
      createdAt: now.value,
    };
    await pool.query(
      `INSERT INTO replay_dataset_manifest(
         dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,
         leakage_check_ref,created_at)
       VALUES($1,1,'promotion_holdout',$2,$3::jsonb,$4,$5,$6,$7)`,
      [
        safetyDatasetId,
        tenantId,
        JSON.stringify(safetyDataset),
        safetyDataset.sourceHash,
        safetyDatasetHash,
        safetyDataset.leakageCheckRef,
        now.value,
      ],
    );
    await pool.query(
      `INSERT INTO replay_dataset_case(dataset_id,dataset_version,replay_case_id,ordinal)
       VALUES($1,1,$2,0)`,
      [safetyDatasetId, safetyCaseId],
    );
    const candidatePin = await pool.query<{
      artifact_id: string;
      artifact_version: number;
      artifact_hash: string;
    }>(
      `SELECT artifact_id,artifact_version,artifact_hash
       FROM artifact_validation_run WHERE validation_type='replay' LIMIT 1`,
    );
    const pin = candidatePin.rows[0];
    if (pin === undefined) throw new Error('P05_CANDIDATE_PIN_MISSING');
    await insertReplayRun({
      validationRunId: 'validation-run-p05-side-effect',
      artifactId: pin.artifact_id,
      artifactVersion: pin.artifact_version,
      artifactHash: pin.artifact_hash,
      datasetId: safetyDatasetId,
      datasetVersion: 1,
      datasetHash: safetyDatasetHash,
      now: now.value,
      maxAttempts: 3,
    });
    const [safetyRun] = await replayService.claim('replay-worker-p05-safety', 1);
    if (safetyRun === undefined) throw new Error('P05_SAFETY_RUN_MISSING');
    now.value = '2026-07-28T05:00:02.000Z';
    await replayService.process(safetyRun, 'replay-worker-p05-safety');
    const safetyEvidence = await pool.query<{
      result: string;
      work_state: string;
      failures: number;
      counterexamples: number;
      completion_events: number;
    }>(
      `SELECT
         run.result,run.work_state,
         (SELECT count(*)::integer FROM artifact_validation_failure failure
          WHERE failure.validation_run_id=run.validation_run_id
            AND failure.category='side_effect_attempt'
            AND failure.severity='critical') AS failures,
         (SELECT count(*)::integer FROM artifact_counterexample counterexample
          WHERE counterexample.validation_run_id=run.validation_run_id) AS counterexamples,
         (SELECT count(*)::integer FROM cognitive_runtime_outbox event
          WHERE event.event_type='artifact.validation_completed'
            AND event.aggregate_id=run.validation_run_id) AS completion_events
       FROM artifact_validation_run run WHERE run.validation_run_id=$1`,
      ['validation-run-p05-side-effect'],
    );
    expect(safetyEvidence.rows[0]).toEqual({
      result: 'unsafe',
      work_state: 'completed',
      failures: 1,
      counterexamples: 1,
      completion_events: 1,
    });
    await expect(
      pool.query(
        `UPDATE artifact_validation_run SET result='tampered'
         WHERE validation_run_id='validation-run-p05-side-effect'`,
      ),
    ).rejects.toThrow(/Terminal Artifact Validation Run facts are immutable/u);

    now.value = '2026-07-28T05:00:03.000Z';
    await insertReplayRun({
      validationRunId: 'validation-run-p05-retry',
      artifactId: pin.artifact_id,
      artifactVersion: pin.artifact_version,
      artifactHash: pin.artifact_hash,
      datasetId: safetyDatasetId,
      datasetVersion: 1,
      datasetHash: safetyDatasetHash,
      now: now.value,
      maxAttempts: 2,
    });
    const [retryFirst] = await replayRepository.claim(
      'replay-worker-p05-retry-old',
      now.value,
      1_000,
      1,
    );
    if (retryFirst?.leaseToken === undefined) throw new Error('P05_RETRY_LEASE_MISSING');
    await expect(
      replayRepository.fail(
        retryFirst.validationRunId,
        'replay-worker-p05-stale',
        'stale-token',
        'TRANSIENT',
        'stale fence must not commit',
        now.value,
        '2026-07-28T05:00:04.000Z',
      ),
    ).resolves.toBe(false);
    await expect(
      replayRepository.fail(
        retryFirst.validationRunId,
        'replay-worker-p05-retry-old',
        retryFirst.leaseToken,
        'TRANSIENT',
        'bounded retry',
        now.value,
        '2026-07-28T05:00:04.000Z',
      ),
    ).resolves.toBe(true);
    now.value = '2026-07-28T05:00:04.000Z';
    const [retrySecond] = await replayRepository.claim(
      'replay-worker-p05-retry-new',
      now.value,
      1_000,
      1,
    );
    if (retrySecond?.leaseToken === undefined) throw new Error('P05_RETRY_RECLAIM_MISSING');
    await expect(
      replayRepository.fail(
        retrySecond.validationRunId,
        'replay-worker-p05-retry-new',
        retrySecond.leaseToken,
        'RETRY_EXHAUSTED',
        'retry budget exhausted',
        now.value,
      ),
    ).resolves.toBe(true);

    await insertReplayRun({
      validationRunId: 'validation-run-p05-cancel',
      artifactId: pin.artifact_id,
      artifactVersion: pin.artifact_version,
      artifactHash: pin.artifact_hash,
      datasetId: safetyDatasetId,
      datasetVersion: 1,
      datasetHash: safetyDatasetHash,
      now: now.value,
      maxAttempts: 3,
    });
    const [cancelRun] = await replayRepository.claim(
      'replay-worker-p05-cancel',
      now.value,
      1_000,
      1,
    );
    if (cancelRun === undefined) throw new Error('P05_CANCEL_LEASE_MISSING');
    await expect(
      replayRepository.requestCancellation(cancelRun.validationRunId, now.value),
    ).resolves.toBe(true);
    now.value = '2026-07-28T05:00:06.000Z';
    await replayRepository.listRequeueable(now.value);

    await insertReplayRun({
      validationRunId: 'validation-run-p05-stale-pin',
      artifactId: pin.artifact_id,
      artifactVersion: pin.artifact_version,
      artifactHash: sha('stale-pin'),
      datasetId: safetyDatasetId,
      datasetVersion: 1,
      datasetHash: safetyDatasetHash,
      now: now.value,
      maxAttempts: 3,
    });
    const [staleRun] = await replayService.claim('replay-worker-p05-stale-pin', 1);
    if (staleRun === undefined) throw new Error('P05_STALE_PIN_LEASE_MISSING');
    await replayService.process(staleRun, 'replay-worker-p05-stale-pin');

    const runtimeStates = await pool.query<{
      validation_run_id: string;
      work_state: string;
      attempt: number;
      last_error_code: string | null;
    }>(
      `SELECT validation_run_id,work_state,attempt,last_error_code
       FROM artifact_validation_run
       WHERE validation_run_id=ANY($1::text[])
       ORDER BY validation_run_id`,
      [['validation-run-p05-cancel', 'validation-run-p05-retry', 'validation-run-p05-stale-pin']],
    );
    expect(runtimeStates.rows).toEqual([
      {
        validation_run_id: 'validation-run-p05-cancel',
        work_state: 'canceled',
        attempt: 1,
        last_error_code: null,
      },
      {
        validation_run_id: 'validation-run-p05-retry',
        work_state: 'dead_letter',
        attempt: 2,
        last_error_code: 'RETRY_EXHAUSTED',
      },
      {
        validation_run_id: 'validation-run-p05-stale-pin',
        work_state: 'dead_letter',
        attempt: 1,
        last_error_code: 'ARTIFACT_REPLAY_VALIDATION_STALE_PIN',
      },
    ]);

    const batchStart = '2026-07-28T05:00:07.000Z';
    await pool.query(
      `INSERT INTO artifact_validation_run(
         validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,
         result,metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,
         artifact_hash,dataset_hash,validator_version,metric_catalog_version,result_hash,
         result_payload,work_state,attempt,max_attempts,available_at,lease_owner,lease_token,
         lease_expires_at,cancel_requested_at,idempotency_key,source_event_id,last_error_code,
         last_error_summary,created_at,updated_at)
       SELECT
         'validation-run-p05-parallel-' || lpad(series::text,3,'0'),
         $1,$2,'replay',$3,'pending',NULL,'{}'::jsonb,'[]'::jsonb,$4,NULL,$5,1,$6,$7,
         'sdar-artifact-replay-validator/1.1','sdar-validation-metrics/1.1',
         NULL,NULL,'pending',0,3,$4,NULL,NULL,NULL,NULL,
         'artifact-replay-test:parallel-' || lpad(series::text,3,'0'),
         NULL,NULL,NULL,$4,$4
       FROM generate_series(1,100) series`,
      [
        pin.artifact_id,
        pin.artifact_version,
        safetyDatasetId,
        batchStart,
        tenantId,
        pin.artifact_hash,
        safetyDatasetHash,
      ],
    );
    const throughputStartedAt = performance.now();
    const workerClaims = await Promise.all(
      ['a', 'b', 'c', 'd'].map((worker) =>
        replayRepository.claim(`replay-worker-p05-parallel-${worker}`, batchStart, 60_000, 25),
      ),
    );
    const throughputElapsedMs = performance.now() - throughputStartedAt;
    const claimedIds = workerClaims.flatMap((claims) =>
      claims.map((claim) => claim.validationRunId),
    );
    expect(workerClaims.map((claims) => claims.length)).toEqual([25, 25, 25, 25]);
    expect(new Set(claimedIds).size).toBe(100);
    await expect(
      replayRepository.claim('replay-worker-p05-backpressure', batchStart, 60_000, 1),
    ).resolves.toEqual([]);
    console.info(
      JSON.stringify({
        event: 'p05.replay_validation.postgres_throughput',
        claimed: claimedIds.length,
        workerCount: workerClaims.length,
        maxBatchPerWorker: 25,
        elapsedMs: Number(throughputElapsedMs.toFixed(3)),
        runsPerSecond: Number((claimedIds.length / (throughputElapsedMs / 1_000)).toFixed(3)),
        queueLagMs: 0,
        backpressureClaimCount: 0,
      }),
    );
    await pool.query(
      `UPDATE artifact_validation_run
       SET cancel_requested_at=$2,updated_at=$2
       WHERE validation_run_id=ANY($1::text[])`,
      [claimedIds, '2026-07-28T05:01:08.000Z'],
    );
    await replayRepository.listRequeueable('2026-07-28T05:01:08.000Z');
    const parallelTerminal = await pool.query<{ canceled: number }>(
      `SELECT count(*)::integer AS canceled FROM artifact_validation_run
       WHERE validation_run_id=ANY($1::text[]) AND work_state='canceled'`,
      [claimedIds],
    );
    expect(parallelTerminal.rows[0]?.canceled).toBe(100);

    const actualWorkerRunIds = Array.from(
      { length: 12 },
      (_, index) => `validation-run-p05-bullmq-${String(index + 1).padStart(2, '0')}`,
    );
    for (const validationRunId of actualWorkerRunIds) {
      await insertReplayRun({
        validationRunId,
        artifactId: pin.artifact_id,
        artifactVersion: pin.artifact_version,
        artifactHash: pin.artifact_hash,
        datasetId: safetyDatasetId,
        datasetVersion: 1,
        datasetHash: safetyDatasetHash,
        now: '2026-07-28T05:01:09.000Z',
        maxAttempts: 3,
      });
    }
    now.value = '2026-07-28T05:01:09.000Z';
    const configuredRedisPort = Number(process.env['SDAR_REDIS_PORT'] ?? 56379);
    if (!Number.isSafeInteger(configuredRedisPort) || configuredRedisPort < 1) {
      throw new Error('P05_REDIS_TEST_PORT_INVALID');
    }
    const redisConnection: RedisConnectionConfig = {
      host: '127.0.0.1',
      port: configuredRedisPort,
    };
    const queueName = `sdar-p05-postgres-workers-${String(Date.now())}`;
    const wakeQueue = new BullMqReplayValidationQueue(redisConnection, queueName);
    const participantIds = new Set<string>();
    let firstClaimGateResolve: (() => void) | undefined;
    const firstClaimGate = new Promise<void>((resolve) => {
      firstClaimGateResolve = resolve;
    });
    const workerService = {
      async claim(workerId: string, limit = 1) {
        participantIds.add(workerId);
        if (participantIds.size === 4) firstClaimGateResolve?.();
        await firstClaimGate;
        return replayService.claim(workerId, limit);
      },
      process: (run: Parameters<typeof replayService.process>[0], workerId: string) =>
        replayService.process(run, workerId),
    };
    const actualWorkers = ['a', 'b', 'c', 'd'].map(
      (suffix) =>
        new BullMqReplayValidationWorker(
          redisConnection,
          workerService,
          `replay-worker-p05-bullmq-${suffix}`,
          queueName,
        ),
    );
    try {
      for (const validationRunId of actualWorkerRunIds) {
        await wakeQueue.enqueue(validationRunId);
      }
      actualWorkers.forEach((worker) => {
        worker.start();
      });
      await waitForCompletedReplayRuns(actualWorkerRunIds, 12, 30_000);
    } finally {
      await Promise.all(actualWorkers.map((worker) => worker.close()));
      await wakeQueue.close();
    }
    const actualWorkerEvidence = await pool.query<{ completed: number }>(
      `SELECT count(*)::integer AS completed
       FROM artifact_validation_run
       WHERE validation_run_id=ANY($1::text[]) AND work_state='completed'`,
      [actualWorkerRunIds],
    );
    expect(participantIds.size).toBe(4);
    expect(actualWorkerEvidence.rows[0]?.completed).toBe(12);
    console.info(
      JSON.stringify({
        event: 'p05.replay_validation.actual_workers',
        workerCount: participantIds.size,
        completedRuns: actualWorkerEvidence.rows[0]?.completed,
        redisAuthority: false,
      }),
    );

    const directlyDeleted = await pool.query<{
      replay_case_id: string;
      dataset_id: string;
      dataset_version: number;
    }>(
      `SELECT replay.replay_case_id,member.dataset_id,member.dataset_version
       FROM artifact_replay_case replay
       JOIN replay_dataset_case member ON member.replay_case_id=replay.replay_case_id
       WHERE replay.primary_source_episode_id='episode-p04r-success-a'
       LIMIT 1`,
    );
    const direct = directlyDeleted.rows[0];
    if (direct === undefined) throw new Error('P05_DIRECT_CASCADE_SOURCE_MISSING');
    await pool.query(
      `DELETE FROM goal_experience_episode WHERE episode_id='episode-p04r-success-a'`,
    );
    const cascadeEvidence = await pool.query<{
      deleted_cases: number;
      promotion_eligible: boolean;
      successor_dataset_id: string | null;
      successor_dataset_version: number | null;
      successor_eligible: boolean;
      successor_case_refs: string[];
    }>(
      `SELECT
         (SELECT count(*)::integer FROM artifact_replay_case
          WHERE replay_case_id=$1) AS deleted_cases,
         former.promotion_eligible,
         former.successor_dataset_id,
         former.successor_dataset_version,
         successor.promotion_eligible AS successor_eligible,
         ARRAY(
           SELECT jsonb_array_elements_text(successor.content->'caseRefs')
         ) AS successor_case_refs
       FROM replay_dataset_manifest former
       JOIN replay_dataset_manifest successor
         ON successor.dataset_id=former.successor_dataset_id
        AND successor.dataset_version=former.successor_dataset_version
       WHERE former.dataset_id=$2 AND former.dataset_version=$3`,
      [direct.replay_case_id, direct.dataset_id, direct.dataset_version],
    );
    expect(cascadeEvidence.rows[0]).toMatchObject({
      deleted_cases: 0,
      promotion_eligible: false,
      successor_dataset_id: direct.dataset_id,
      successor_dataset_version: direct.dataset_version + 1,
      successor_eligible: false,
    });
    expect(cascadeEvidence.rows[0]?.successor_case_refs).not.toContain(direct.replay_case_id);

    await expect(replayRepository.purgeTenant(tenantId)).resolves.toBe(8);
    const deletionEvidence = await pool.query<{
      tombstones: number;
      cases: number;
      datasets: number;
      validation_runs: number;
      validation_results: number;
      invalidated_datasets: number;
      successor_datasets: number;
      promotion_eligible_runs: number;
      candidate_status: string;
    }>(
      `SELECT
         (SELECT count(*)::integer FROM artifact_replay_tenant_deletion
          WHERE tenant_id=$1) AS tombstones,
         (SELECT count(*)::integer FROM artifact_replay_case) AS cases,
         (SELECT count(*)::integer FROM replay_dataset_manifest) AS datasets,
         (SELECT count(*)::integer FROM artifact_validation_run
          WHERE validation_type='replay') AS validation_runs,
         (SELECT count(*)::integer FROM artifact_replay_case_result) AS validation_results,
         (SELECT count(*)::integer FROM replay_dataset_manifest
          WHERE promotion_eligible=false) AS invalidated_datasets,
         (SELECT count(*)::integer FROM replay_dataset_manifest
          WHERE invalidation_reason LIKE '%requires_resplit') AS successor_datasets,
         (SELECT count(*)::integer FROM artifact_validation_run
          WHERE validation_type='replay' AND promotion_eligible=true) AS promotion_eligible_runs,
         (SELECT status FROM compiled_artifact LIMIT 1) AS candidate_status`,
      [tenantId],
    );
    expect(deletionEvidence.rows[0]).toEqual({
      tombstones: 1,
      cases: 0,
      datasets: 10,
      validation_runs: 117,
      validation_results: 16,
      invalidated_datasets: 10,
      successor_datasets: 5,
      promotion_eligible_runs: 0,
      candidate_status: 'candidate',
    });
  }, 45_000);

  it('reclaims expired wake loss, rejects stale fencing and dead-letters terminal attempts', async () => {
    const repository = new PostgresCandidateGenerationRepository(pool);
    const first = await repository.createRun(
      tenantId,
      'process-pattern-requeue',
      'pattern-event-requeue',
      '2026-07-28T05:00:00.000Z',
      2,
    );
    const [leased] = await repository.claim('worker-old', '2026-07-28T05:00:00.000Z', 1_000, 1);
    expect(leased?.runId).toBe(first.runId);
    const requeueable = await repository.listRequeueable('2026-07-28T05:00:02.000Z');
    expect(requeueable.map((run) => run.runId)).toEqual([first.runId]);
    const [reclaimed] = await repository.claim('worker-new', '2026-07-28T05:00:02.000Z', 1_000, 1);
    expect(reclaimed).toMatchObject({ runId: first.runId, attempt: 2, leaseOwner: 'worker-new' });
    await expect(
      repository.fail(
        first.runId,
        'worker-old',
        leased?.leaseToken ?? '',
        'STALE',
        'stale worker',
        '2026-07-28T05:00:02.000Z',
      ),
    ).resolves.toBe(false);
    await repository.listRequeueable('2026-07-28T05:00:04.000Z');
    const terminal = await pool.query<{ status: string; last_error_code: string }>(
      `SELECT status,last_error_code FROM candidate_generation_run WHERE run_id=$1`,
      [first.runId],
    );
    expect(terminal.rows[0]).toEqual({
      status: 'dead_letter',
      last_error_code: 'CANDIDATE_GENERATION_LEASE_ATTEMPTS_EXHAUSTED',
    });
  });
});

async function saveCapabilityCatalog(): Promise<void> {
  const timestamp = '2026-07-28T03:00:00.000Z';
  const outcome = {
    schemaVersion: '1.0' as const,
    skillId: 'skill.workflow-policy-remediation',
    skillVersion: 1,
    effects: [
      'effect:collect-workflow-state',
      'effect:verify-policy',
      'effect:apply-safe-remediation',
    ],
    evidence: ['workflow-state', 'policy-verification', 'remediation-result'],
    artifacts: [],
    taskGoalPolicy: {},
    confidencePolicy: {},
    sideEffectPolicy: { classification: 'bounded_mutation' },
  };
  const skill = createSkillVersion({
    skillId: 'skill.workflow-policy-remediation',
    version: 1,
    name: 'Workflow Policy Remediation',
    summary: 'Collects state, verifies policy and applies a bounded remediation.',
    description: 'A formal Skill declaration used by the P04R candidate catalog.',
    capabilities: [...capabilities],
    workflowGuidance: 'Preserve policy, verification and recovery boundaries.',
    outputInstruction: 'Return verified remediation evidence.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    usageSpecification: createSkillUsageSpecification({
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Preserve the formal policy boundary.'],
        forbiddenActions: [],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Prefer verified remediation.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Guide remediation.', instructions: ['Verify before apply.'] },
      },
      taskBindings: [
        {
          bindingId: 'workflow-policy-remediation',
          taskType: taskTypeId,
          providerPolicy: {
            selection: 'dynamic',
            preferredProviderIds: [],
            forbiddenProviderIds: [],
            requiredAttributes: [],
          },
        },
      ],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    }),
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    outcomeSpecification: {
      ...outcome,
      specificationHash: sha(JSON.stringify(outcome)),
    },
    createdAt: timestamp,
  });
  await new PostgresSkillRepository(pool).saveVersionAndSetCurrent(skill, timestamp);
}

async function saveTerminalAuthorityFixtures(
  fixtures: readonly Readonly<{
    suffix: string;
    achieved: boolean;
    timestamp: string;
    userId?: string;
    request?: string;
  }>[] = [
    { suffix: 'success-a', achieved: true, timestamp: '2026-07-28T03:00:00.000Z' },
    { suffix: 'success-b', achieved: true, timestamp: '2026-07-28T03:00:01.000Z' },
    {
      suffix: 'failure-recovery',
      achieved: false,
      timestamp: '2026-07-28T03:00:02.000Z',
    },
  ],
): Promise<void> {
  for (const fixture of fixtures) {
    const { suffix, achieved, timestamp } = fixture;
    const userId = fixture.userId ?? `user-${suffix}`;
    const request =
      fixture.request ?? 'Collect workflow state, verify policy, and apply a safe remediation.';
    const goalId = `goal-${suffix}`;
    const planId = `plan-authority-${suffix}`;
    const instanceId = `instance-authority-${suffix}`;
    const controlId = `control-authority-${suffix}`;
    const taskId = `task-${suffix}`;
    const replayFacts = replayValidationSnapshot(suffix, timestamp, !achieved);
    await pool.query(
      `INSERT INTO goal(
         goal_id,context_id,version,title,description,constraints_json,success_criteria_json,
         status,created_at,updated_at)
       VALUES($1,$2,1,$3,$4,'[]'::jsonb,$5::jsonb,$6,$7,$7)`,
      [
        goalId,
        `context-${suffix}`,
        `Formal workflow remediation ${suffix}`,
        'Collect workflow state, verify policy, and apply a safe remediation.',
        JSON.stringify(['The workflow policy is verified before remediation.']),
        achieved ? 'achieved' : 'unachievable',
        timestamp,
      ],
    );
    const contractHash = replayFacts.acceptedPlan.contractHash;
    await pool.query(
      `INSERT INTO user_goal_contract(
         goal_id,goal_version,schema_version,contract_hash,contract_json,created_at)
       VALUES($1,1,'1.0',$2,$3::jsonb,$4)`,
      [goalId, contractHash, JSON.stringify(replayFacts.goalContract), timestamp],
    );
    await pool.query(
      `INSERT INTO user_goal_plan(
         plan_id,goal_id,goal_version,revision,revision_kind,status,contract_hash,
         content_hash,plan_json,created_at,updated_at)
       VALUES($1,$2,1,1,'initial',$3,$4,$5,$6::jsonb,$7,$7)`,
      [
        replayFacts.acceptedPlan.planId,
        goalId,
        achieved ? 'completed' : 'failed',
        contractHash,
        replayFacts.acceptedPlan.contentHash,
        JSON.stringify({
          ...replayFacts.acceptedPlan,
          status: achieved ? 'completed' : 'failed',
        }),
        timestamp,
      ],
    );
    for (const [index, skillGoal] of replayFacts.acceptedPlan.skillGoals.entries()) {
      const status =
        !achieved && index === 2 ? 'failed' : achieved || index < 2 ? 'achieved' : 'failed';
      await pool.query(
        `INSERT INTO skill_goal(
           skill_goal_id,plan_id,ordinal,status,contract_json,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)`,
        [
          skillGoal.skillGoalId,
          replayFacts.acceptedPlan.planId,
          index + 1,
          status,
          JSON.stringify({ ...skillGoal, status }),
          timestamp,
        ],
      );
    }
    for (const dependency of replayFacts.acceptedPlan.dependencies) {
      await pool.query(
        `INSERT INTO skill_goal_dependency(
           dependency_id,plan_id,predecessor_skill_goal_id,successor_skill_goal_id,predicate)
         VALUES($1,$2,$3,$4,$5)`,
        [
          dependency.dependencyId,
          replayFacts.acceptedPlan.planId,
          dependency.predecessorSkillGoalId,
          dependency.successorSkillGoalId,
          dependency.predicate,
        ],
      );
    }
    for (const [index, skillGoal] of replayFacts.acceptedPlan.skillGoals.entries()) {
      const attemptId = `attempt-${suffix}-${String(index + 1)}`;
      const status = !achieved && index === 2 ? 'failed' : 'achieved';
      await pool.query(
        `INSERT INTO skill_attempt(
           attempt_id,plan_id,skill_goal_id,ordinal,status,strategy_fingerprint,
           attempt_json,created_at,updated_at)
         VALUES($1,$2,$3,1,$4,$5,$6::jsonb,$7,$8)`,
        [
          attemptId,
          replayFacts.acceptedPlan.planId,
          skillGoal.skillGoalId,
          status,
          sha(`strategy-${attemptId}`),
          JSON.stringify({
            attemptId,
            planId: replayFacts.acceptedPlan.planId,
            skillGoalId: skillGoal.skillGoalId,
            ordinal: 1,
            status,
            strategyFingerprint: sha(`strategy-${attemptId}`),
            budget: { maxAttempts: 2, consumedAttempts: 1 },
            resolvedInput: replayFacts.parameterValues,
            createdAt: new Date(Date.parse(timestamp) + index * 1_000).toISOString(),
            updatedAt: new Date(Date.parse(timestamp) + index * 1_000 + 500).toISOString(),
          }),
          new Date(Date.parse(timestamp) + index * 1_000).toISOString(),
          new Date(Date.parse(timestamp) + index * 1_000 + 500).toISOString(),
        ],
      );
    }
    if (!achieved) {
      const failedGoal = replayFacts.acceptedPlan.skillGoals[2];
      if (failedGoal === undefined) throw new Error('P05_FAILED_SKILL_GOAL_MISSING');
      await pool.query(
        `INSERT INTO recovery_decision(
           recovery_decision_id,plan_id,skill_goal_id,attempt_id,action,reason_code,
           strategy_fingerprint,decision_json,created_at)
         VALUES($1,$2,$3,$4,'replacement_attempt','STALLED_CHANGED_STRATEGY',$5,$6::jsonb,$7)`,
        [
          `recovery-${suffix}`,
          replayFacts.acceptedPlan.planId,
          failedGoal.skillGoalId,
          `attempt-${suffix}-3`,
          sha(`recovery-strategy-${suffix}`),
          JSON.stringify({
            action: 'replacement_attempt',
            reasonCode: 'STALLED_CHANGED_STRATEGY',
            requiredCapabilities: ['workflow.recover'],
          }),
          new Date(Date.parse(timestamp) + 3_000).toISOString(),
        ],
      );
    }
    await pool.query(
      `INSERT INTO outcome_decision(
         outcome_decision_id,level,subject_id,plan_id,status,confidence,decision_json,created_at)
       VALUES($1,'user_goal',$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        `outcome-decision-${suffix}`,
        goalId,
        replayFacts.acceptedPlan.planId,
        achieved ? 'achieved' : 'not_achieved',
        achieved ? 'high' : 'medium',
        JSON.stringify({
          outcomeDecisionId: `outcome-decision-${suffix}`,
          level: 'user_goal',
          subjectId: goalId,
          status: achieved ? 'achieved' : 'not_achieved',
          confidence: achieved ? 'high' : 'medium',
          ruleIds: ['formal-terminal-authority'],
          criterionRefs: replayFacts.goalContract.criteria.map(
            (criterion) => criterion.criterionId,
          ),
          effectRefs: [],
          evidenceRefs: replayFacts.historical.evidenceRefs,
          artifactRefs: [],
          summary: achieved
            ? 'All formal workflow criteria were achieved.'
            : 'The formal workflow remained unachievable after recovery.',
          createdAt: new Date(Date.parse(timestamp) + 3_500).toISOString(),
        }),
        new Date(Date.parse(timestamp) + 3_500).toISOString(),
      ],
    );
    await pool.query(
      `INSERT INTO workflow_plan(
         plan_id,goal_id,goal_version,definition_json,confirmation_status,attempt_count,
         created_at,goal_contract_json)
       VALUES($1,$2,1,$3::jsonb,'confirmed',1,$4,$5::jsonb)`,
      [
        planId,
        goalId,
        JSON.stringify({
          workflowDefinitionId: `workflow-authority-${suffix}`,
          goalId,
          goalVersion: 1,
        }),
        timestamp,
        JSON.stringify({ goalId, version: 1 }),
      ],
    );
    await pool.query(
      `INSERT INTO workflow_plan_attempt(
         plan_id,attempt,candidate_json,validation_errors_json,valid,created_at,
         goal_contract_json)
       VALUES($1,1,$2::jsonb,'[]'::jsonb,true,$3,$4::jsonb)`,
      [
        planId,
        JSON.stringify({ workflowDefinitionId: `workflow-authority-${suffix}` }),
        timestamp,
        JSON.stringify({ goalId, version: 1 }),
      ],
    );
    await pool.query(
      `INSERT INTO task_execution_readiness(
         readiness_id,workflow_plan_id,plan_attempt,check_phase,dsl_hash,disposition,
         permitted_actions_json,guard_action,guard_reason_codes_json,confirmation_required,
         created_at)
       VALUES($1,$2,1,'planning',$3,$4,$5::jsonb,$6,$7::jsonb,false,$8)`,
      [
        `readiness-${suffix}`,
        planId,
        createHash('sha256').update(`dsl-${suffix}`).digest('hex'),
        achieved ? 'ready' : 'blocked',
        JSON.stringify(achieved ? ['execute'] : []),
        achieved ? 'proceed' : 'abort',
        JSON.stringify(achieved ? [] : ['POLICY_VERIFICATION_FAILED']),
        timestamp,
      ],
    );
    await pool.query(
      `INSERT INTO task_availability_snapshot(
         snapshot_id,readiness_id,node_id,server_id,operation_name,
         arguments_snapshot_json,arguments_hash,result_json,availability,risk_level,
         reservation_mode,source_revision,checked_at,normalization_reason_codes_json)
       VALUES($1,$2,$3,'server-authority','workflow.policy-remediation',$4::jsonb,$5,
         $6::jsonb,$7,'medium','none','catalog-v1',$8,'[]'::jsonb)`,
      [
        `availability-${suffix}`,
        `readiness-${suffix}`,
        `node-${suffix}`,
        JSON.stringify(replayFacts.parameterValues),
        createHash('sha256').update(JSON.stringify(replayFacts.parameterValues)).digest('hex'),
        JSON.stringify({ checked: true, achieved }),
        achieved ? 'available' : 'restricted',
        timestamp,
      ],
    );
    await pool.query(
      `INSERT INTO agent_task(
         task_id,context_id,user_id,phase,phase_message,goal_id,goal_version,
         output_text,output_structured,error_code,request_text,request_metadata,plan_id,
         created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,1,$7,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14)`,
      [
        taskId,
        `context-${suffix}`,
        userId,
        achieved ? 'completed' : 'failed',
        achieved ? 'Completed.' : 'Failed after recovery.',
        goalId,
        achieved ? 'Formal workflow remediation achieved.' : null,
        JSON.stringify({ achieved }),
        achieved ? null : 'POLICY_VERIFICATION_FAILED',
        request,
        JSON.stringify({
          taskTypeId,
          environmentClass: `environment-${suffix}`,
          deviceClass: `device-${suffix}`,
        }),
        planId,
        timestamp,
        new Date(Date.parse(timestamp) + 4_000).toISOString(),
      ],
    );
    await pool.query(`UPDATE workflow_plan SET confirmation_task_id=$2 WHERE plan_id=$1`, [
      planId,
      taskId,
    ]);
    await pool.query(
      `INSERT INTO workflow_instance(
         instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
         status,input_json,result_json,errors_json,started_at,completed_at)
       VALUES($1,$2,$3,1,$4,1,$5,'{}'::jsonb,$6::jsonb,$7::jsonb,$8,$9)`,
      [
        instanceId,
        planId,
        `workflow-authority-${suffix}`,
        goalId,
        achieved ? 'succeeded' : 'failed',
        JSON.stringify(achieved ? { remediated: true } : { remediated: false }),
        JSON.stringify(achieved ? {} : { code: 'POLICY_VERIFICATION_FAILED' }),
        timestamp,
        new Date(Date.parse(timestamp) + 4_000).toISOString(),
      ],
    );
    await pool.query(
      `INSERT INTO workflow_control(
         control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,input_json,
         skill_ids_json,planning_instruction,round_count,replan_count,final_instance_id,
         created_at,updated_at)
       VALUES($1,$2,$3,1,$4,$5,$6,'{}'::jsonb,'[]'::jsonb,$7,1,0,$8,$9,$10)`,
      [
        controlId,
        `context-${suffix}`,
        goalId,
        taskId,
        achieved ? 'achieved' : 'unachievable',
        planId,
        'Execute only the confirmed formal workflow plan.',
        instanceId,
        timestamp,
        new Date(Date.parse(timestamp) + 4_000).toISOString(),
      ],
    );
    await pool.query(
      `INSERT INTO runtime_terminal_outcome(
         outcome_id,outcome_kind,task_id,goal_id,goal_version,control_id,control_status,round_index,
         final_instance_id,summary,committed_at)
       VALUES($1,$2,$3,$4,1,$5,$6,0,$7,$8,$9)`,
      [
        `outcome-${suffix}`,
        achieved ? 'achieved' : 'unachievable',
        taskId,
        goalId,
        controlId,
        achieved ? 'achieved' : 'unachievable',
        instanceId,
        achieved
          ? 'Formal workflow remediation achieved.'
          : 'Formal workflow remediation exhausted after a recovery attempt.',
        new Date(Date.parse(timestamp) + 4_000).toISOString(),
      ],
    );
  }
}

async function saveHistoricalCapabilityAuthorities(
  fixtures: readonly Readonly<{
    suffix: string;
    timestamp: string;
    request: string;
  }>[],
): Promise<void> {
  const summaryId = 'runtime-capability-summary-p05';
  const catalogHash = sha('p05-historical-capability-summary');
  const builtAt = '2026-07-28T02:59:00.000Z';
  await pool.query(
    `INSERT INTO runtime_capability_summary(
       summary_id,revision,catalog_hash,generation_policy_version,status,
       schema_version,source_refs,built_at)
     VALUES($1,1,$2,'capability-summary-policy-v1','active','1.0','[]'::jsonb,$3)`,
    [summaryId, catalogHash, builtAt],
  );
  for (const [index, capabilityId] of capabilities.entries()) {
    await pool.query(
      `INSERT INTO runtime_capability_summary_item(
         summary_id,capability_id,ordinal,title,definition)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        summaryId,
        capabilityId,
        index,
        `Historical ${capabilityId}`,
        JSON.stringify({
          capabilityId,
          domain: 'workflow',
          title: `Historical ${capabilityId}`,
          shortDescription: `Execution-time declaration for ${capabilityId}.`,
          public: true,
          effects: [],
          evidence: [],
          artifacts: [],
          contexts: [],
          modes: ['guidance'],
          taskTypes: [taskTypeId],
          composition: [],
          limitations: [],
          exactSkillVersionRefs: ['skill.workflow-policy-remediation:1'],
        }),
      ],
    );
  }
  for (const fixture of fixtures) {
    const taskId = `task-${fixture.suffix}`;
    const invocationId = `model-invocation-${fixture.suffix}`;
    const understandingId = `understanding-${fixture.suffix}`;
    const sourceRefs = [
      {
        schemaVersion: '1.0',
        sourceRefId: `source-capability-summary-${fixture.suffix}`,
        sourceKind: 'capability_summary',
        sourceId: summaryId,
        sourceRevision: 1,
        authority: 'runtime_fact',
        dataClassification: 'internal',
        capturedAt: builtAt,
        contentHash: catalogHash,
      },
    ];
    await pool.query(
      `INSERT INTO model_invocation(
         invocation_id,stage,provider_id,model,operation,request_json,context_json,
         raw_response_json,structured_result_json,duration_ms,status,created_at,task_id)
       VALUES($1,'task_understanding','provider.p05','model.p05','structured_generation',
         '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,5,'succeeded',$2,$3)`,
      [invocationId, fixture.timestamp, taskId],
    );
    const snapshot = {
      schemaVersion: '1.0',
      understandingId,
      taskId,
      revision: 1,
      originalRequest: fixture.request,
      objective: 'Collect state, verify policy, and apply a bounded remediation.',
      taskTypeCandidates: [
        {
          taskTypeId,
          version: 1,
          confidence: 1,
          rationale: 'Persisted execution-time Task Type authority.',
        },
      ],
      capabilityRequirements: capabilities.map((capabilityId) => ({
        capabilityId,
        description: `Execution-time requirement for ${capabilityId}.`,
        required: true,
        available: true,
      })),
      knownConstraints: ['Verify policy before mutation.'],
      knownDimensions: [],
      assumptions: [],
      missingDimensions: [],
      confidence: 1,
      disposition: 'contract_candidate',
      sourceRefs,
      modelInvocationId: invocationId,
      policyVersion: 'task-understanding-v1',
      stateHash: sha(`understanding-${fixture.suffix}`),
      createdAt: fixture.timestamp,
    };
    await pool.query(
      `INSERT INTO generic_task_understanding(
         understanding_id,task_id,revision,disposition,objective,policy_version,state_hash,
         snapshot,source_refs,created_at,model_invocation_id)
       VALUES($1,$2,1,'contract_candidate',$3,'task-understanding-v1',$4,
         $5::jsonb,$6::jsonb,$7,$8)`,
      [
        understandingId,
        taskId,
        snapshot.objective,
        snapshot.stateHash,
        JSON.stringify(snapshot),
        JSON.stringify(sourceRefs),
        fixture.timestamp,
        invocationId,
      ],
    );
  }
}

function formalEpisode(
  suffix: string,
  userId: string,
  outcomeStatus: 'succeeded' | 'failed',
): GoalExperienceEpisode {
  const createdAt = `2026-07-28T03:00:0${suffix === 'success-a' ? '0' : suffix === 'success-b' ? '1' : '2'}.000Z`;
  return formalEpisodeAt(
    suffix,
    userId,
    outcomeStatus,
    createdAt,
    'Collect workflow state, verify policy, and apply a safe remediation.',
  );
}

function formalEpisodeAt(
  suffix: string,
  userId: string,
  outcomeStatus: 'succeeded' | 'failed',
  createdAt: string,
  requestText: string,
): GoalExperienceEpisode {
  const failed = outcomeStatus === 'failed';
  const attemptPrefix = `attempt-${suffix}`;
  const replayFacts = replayValidationSnapshot(suffix, createdAt, failed);
  const snapshot = {
    task: {
      taskId: `task-${suffix}`,
      contextId: `context-${suffix}`,
      userId,
      tenantId,
      taskTypeId,
      environmentClass: `environment-${suffix}`,
      deviceClass: `device-${suffix}`,
      requestText,
      createdAt,
    },
    contract: {
      goalId: `goal-${suffix}`,
      contractHash: sha(`contract-${suffix}`),
      contract: replayFacts.goalContract,
      createdAt,
    },
    currentPlan: {
      planId: replayFacts.acceptedPlan.planId,
      revision: replayFacts.acceptedPlan.revision,
      status: replayFacts.acceptedPlan.status,
      plan: replayFacts.acceptedPlan,
      createdAt,
      updatedAt: createdAt,
    },
    planRevisions: [
      {
        planId: `plan-${suffix}`,
        revision: 1,
        status: 'confirmed',
        planningMetadata: {
          parallelGroups: {
            'policy-readiness': ['collect-workflow-state', 'verify-policy'],
          },
        },
        plan: {
          skillGoals: [
            skillGoal('collect-workflow-state', 'Collect authoritative workflow state', [
              'workflow.collect',
            ]),
            skillGoal('verify-policy', 'Verify the workflow against policy', ['workflow.verify']),
            skillGoal('apply-safe-remediation', 'Apply the verified safe remediation', [
              'workflow.remediate',
            ]),
          ],
          dependencies: [
            dependency('collect-workflow-state', 'apply-safe-remediation'),
            dependency('verify-policy', 'apply-safe-remediation'),
          ],
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    attempts: [
      attempt(`${attemptPrefix}-collect`, 'collect-workflow-state', 'completed', createdAt),
      attempt(
        `${attemptPrefix}-verify`,
        'verify-policy',
        failed ? 'failed' : 'completed',
        new Date(Date.parse(createdAt) + 1_000).toISOString(),
      ),
      ...(!failed
        ? [
            attempt(
              `${attemptPrefix}-apply`,
              'apply-safe-remediation',
              'completed',
              new Date(Date.parse(createdAt) + 2_000).toISOString(),
            ),
          ]
        : [
            attempt(
              `${attemptPrefix}-verify-replacement`,
              'verify-policy',
              'completed',
              new Date(Date.parse(createdAt) + 3_000).toISOString(),
            ),
          ]),
    ],
    progress: failed
      ? [
          {
            progress_observation_id: `progress-${suffix}`,
            plan_id: `plan-${suffix}`,
            classification: 'stalled',
            vector: {
              effectRefs: ['effect:policy-read'],
              capabilityRefs: ['workflow.verify'],
            },
            observed_at: new Date(Date.parse(createdAt) + 1_500).toISOString(),
          },
        ]
      : [],
    recovery: failed
      ? [
          {
            recovery_decision_id: `recovery-${suffix}`,
            plan_id: `plan-${suffix}`,
            skill_goal_id: 'verify-policy',
            attempt_id: `${attemptPrefix}-verify`,
            action: 'replacement_attempt',
            reason_code: 'STALLED_CHANGED_STRATEGY',
            required_capabilities: ['workflow.recover'],
            created_at: new Date(Date.parse(createdAt) + 2_000).toISOString(),
          },
        ]
      : [],
    eventImpacts: [],
    interactions: [],
    terminalOutcome: {
      outcomeId: `outcome-${suffix}`,
      controlStatus: failed ? 'failed' : 'completed',
      committedAt: new Date(Date.parse(createdAt) + 4_000).toISOString(),
    },
    userGoalJudgment: { status: failed ? 'not_achieved' : 'achieved' },
    capabilityCatalogSnapshot: {
      knownCapabilityIds: [...capabilities],
      readyCapabilityIds: [...capabilities],
    },
    policyDecisionSnapshot: {
      authorityDecision: failed ? 'deny' : 'allow',
      contextStatus: 'known',
      historicalRiskLevel: 'medium',
    },
    worldStateSnapshot: replayFacts.worldState,
  };
  return createGoalExperienceEpisode({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    episodeId: `episode-p04r-${suffix}`,
    goalId: `goal-${suffix}`,
    goalVersion: 1,
    taskId: `task-${suffix}`,
    contextId: `context-${suffix}`,
    episodeType: 'terminal',
    revision: 1,
    terminalOutcomeRef: `runtime-terminal-outcome:outcome-${suffix}`,
    sourceHash: sha(`source-${suffix}`),
    episodeHash: sha(`episode-${suffix}`),
    completeness: 0.98,
    status: 'complete',
    dataClassification: 'internal',
    snapshot,
    sourceRefs: [
      source(`task-source-${suffix}`, 'task_request', `task-${suffix}`, createdAt),
      source(`contract-source-${suffix}`, 'goal_contract', `goal-${suffix}`, createdAt),
      source(`plan-source-${suffix}`, 'plan_revision', `plan-${suffix}`, createdAt),
      source(`attempt-source-${suffix}`, 'skill_attempt', `${attemptPrefix}-collect`, createdAt),
      source(
        `outcome-source-${suffix}`,
        'runtime_terminal_outcome',
        `outcome-${suffix}`,
        createdAt,
      ),
      ...(failed
        ? [
            source(
              `recovery-source-${suffix}`,
              'recovery_decision',
              `recovery-${suffix}`,
              createdAt,
            ),
          ]
        : []),
    ],
    redactionCodes: [],
    createdAt,
  });
}

function replayValidationSnapshot(suffix: string, createdAt: string, failed: boolean) {
  const activityKeys = [
    'skill-goal:collect-workflow-state',
    'skill-goal:verify-policy',
    'skill-goal:apply-safe-remediation',
  ];
  const criteria = activityKeys.map((activityKey) => ({
    criterionId: `criterion_${createHash('sha256').update(activityKey).digest('hex').slice(0, 16)}`,
    description: `${activityKey} must be completed.`,
    required: true,
    expectedEffectRefs: [`effect:${activityKey.split(':').at(-1) ?? activityKey}`],
    evidenceRequirements: [`evidence:${activityKey}`],
    artifactRequirements: [],
  }));
  const goalContract = {
    schemaVersion: '1.0' as const,
    goalId: `goal-${suffix}`,
    goalVersion: 1,
    title: `Replay validation ${suffix}`,
    description: 'Collect state, verify policy, and apply a bounded remediation.',
    constraints: ['Verify policy before mutation.'],
    criteria,
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  };
  const planId = `accepted-plan-${suffix}`;
  const skillGoals = activityKeys.map((activityKey, index) => ({
    skillGoalId: `accepted-goal-${suffix}-${String(index + 1)}`,
    requiredResult: `${activityKey} completed`,
    capabilityNeeds: [capabilities[index] ?? 'workflow.remediate'],
    coveredCriterionIds: [criteria[index]?.criterionId ?? criteria[0]?.criterionId ?? 'criterion'],
    requiredEffectRefs: criteria[index]?.expectedEffectRefs ?? [],
    evidenceRequirements: criteria[index]?.evidenceRequirements ?? [],
    artifactRequirements: [],
    assumptions: [],
    constraints: [],
    status: 'pending' as const,
  }));
  const dependencies = [
    {
      dependencyId: `accepted-dependency-${suffix}-1`,
      predecessorSkillGoalId: `accepted-goal-${suffix}-1`,
      successorSkillGoalId: `accepted-goal-${suffix}-3`,
      predicate: 'required' as const,
    },
    {
      dependencyId: `accepted-dependency-${suffix}-2`,
      predecessorSkillGoalId: `accepted-goal-${suffix}-2`,
      successorSkillGoalId: `accepted-goal-${suffix}-3`,
      predicate: 'required' as const,
    },
  ];
  return {
    goalContract,
    parameterValues: { maximumRetries: 1 },
    knownCapabilityIds: [...capabilities],
    readyCapabilityIds: [...capabilities],
    authorityDecision: 'allow' as const,
    historical: {
      succeeded: !failed,
      evidenceRefs: activityKeys.map((activityKey) => `evidence:${activityKey}`),
      artifactRefs: [],
      modelCallCount: 1,
      tokenInput: 128,
      tokenOutput: 64,
      estimatedCostUnits: 1,
      humanInteractionCount: 0,
      fallbackCount: failed ? 1 : 0,
      userPatchCount: 0,
      planningLatencyMs: 20,
    },
    acceptedPlan: {
      schemaVersion: '1.0' as const,
      planId,
      goalId: `goal-${suffix}`,
      goalVersion: 1,
      revision: 1,
      revisionKind: 'initial' as const,
      status: 'validated' as const,
      contractHash: sha(JSON.stringify(goalContract)),
      contentHash: sha(JSON.stringify({ planId, skillGoals, dependencies })),
      skillGoals,
      dependencies,
      inheritedCompletedEffectIds: [],
      forbiddenReplayFingerprints: [],
      createdAt,
    },
    worldState: { capturedAt: createdAt, environmentClass: 'server' },
    counterexample: failed,
  };
}

function skillGoal(
  skillGoalId: string,
  requiredResult: string,
  capabilityNeeds: readonly string[],
) {
  return {
    skillGoalId,
    requiredResult,
    capabilityNeeds,
    coveredCriterionIds: [`criterion:${skillGoalId}`],
    requiredEffectRefs: [`effect:${skillGoalId}`],
    evidenceRequirements: [],
    artifactRequirements: [],
    assumptions: [],
    constraints: [],
    status: 'ready',
  };
}

function dependency(predecessorSkillGoalId: string, successorSkillGoalId: string) {
  return {
    dependencyId: `dependency:${predecessorSkillGoalId}:${successorSkillGoalId}`,
    predecessorSkillGoalId,
    successorSkillGoalId,
    predicate: 'required',
  };
}

function attempt(attemptId: string, skillGoalId: string, status: string, createdAt: string) {
  const capability =
    skillGoalId === 'collect-workflow-state'
      ? 'workflow.collect'
      : skillGoalId === 'verify-policy'
        ? 'workflow.verify'
        : 'workflow.remediate';
  return {
    attempt_id: attemptId,
    skill_goal_id: skillGoalId,
    status,
    capability_refs: [capability],
    resolved_input: { maximumRetries: 1 },
    created_at: createdAt,
    updated_at: new Date(Date.parse(createdAt) + 500).toISOString(),
  };
}

function source(
  sourceRefId: string,
  sourceKind: CognitiveSourceRef['sourceKind'],
  sourceId: string,
  capturedAt: string,
): CognitiveSourceRef {
  return createCognitiveSourceRef({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    sourceRefId,
    sourceKind,
    sourceId,
    sourceRevision: 1,
    authority: 'runtime_fact',
    dataClassification: 'internal',
    capturedAt,
  });
}

function phase8ProjectionPriority(kind: string): number {
  const dependencyOrder = [
    'experience_task',
    'experience_pattern',
    'replay_case',
    'artifact',
    'replay_dataset',
    'validation',
    'retrieval',
    'usage',
    'feedback',
    'promotion',
  ] as const;
  const priority = dependencyOrder.findIndex((value) => value === kind);
  if (priority < 0) throw new Error(`Unknown Phase8 projection kind ${kind}.`);
  return priority;
}

function requiredPhase8Evidence(
  rows: readonly StoredEvidenceRecord[],
  recordType: string,
  predicate: (envelope: CanonicalEvidenceEnvelope) => boolean = () => true,
): CanonicalEvidenceEnvelope {
  const envelope = rows.find(
    (row) => row.envelope.recordType === recordType && predicate(row.envelope),
  )?.envelope;
  if (envelope === undefined) throw new Error(`Missing Phase8 Evidence ${recordType}.`);
  return envelope;
}

function requiredPhase8StoredEvidence(
  rows: readonly StoredEvidenceRecord[],
  recordId: string,
): StoredEvidenceRecord {
  const row = rows.find((candidate) => candidate.envelope.recordId === recordId);
  if (row === undefined) throw new Error(`Missing stored Phase8 Evidence ${recordId}.`);
  return row;
}

function requiredArtifactRef(envelope: CanonicalEvidenceEnvelope): ArtifactRef {
  const payload = envelope.payload;
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error(`Phase8 Evidence ${envelope.recordType} payload is not an object.`);
  }
  const value = (payload as Readonly<Record<string, unknown>>)['artifactRef'];
  const artifactValue = value as Readonly<Record<string, unknown>>;
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof artifactValue['artifactId'] !== 'string' ||
    !Number.isSafeInteger(artifactValue['version']) ||
    typeof artifactValue['uri'] !== 'string' ||
    typeof artifactValue['sha256'] !== 'string' ||
    !artifactValue['sha256'].startsWith('sha256:') ||
    typeof artifactValue['mediaType'] !== 'string' ||
    !Number.isSafeInteger(artifactValue['byteSize'])
  ) {
    throw new Error(`Phase8 Evidence ${envelope.recordType} ArtifactRef is invalid.`);
  }
  return value as unknown as ArtifactRef;
}

function phase8PayloadField(envelope: CanonicalEvidenceEnvelope, field: string): unknown {
  const payload = envelope.payload;
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') return undefined;
  return (payload as Readonly<Record<string, unknown>>)[field];
}

async function phase8Checkpoint(
  sourceFamily: string,
  sourcePartition: string,
): Promise<Readonly<{ last_occurred_at: string | null; last_source_revision: string }>> {
  const result = await pool.query<{
    last_occurred_at: string | null;
    last_source_revision: string;
  }>(
    `SELECT last_occurred_at::text AS last_occurred_at,last_source_revision
     FROM evidence_source_checkpoint
     WHERE source_family=$1 AND source_partition=$2`,
    [sourceFamily, sourcePartition],
  );
  const checkpoint = result.rows[0];
  if (checkpoint === undefined) throw new Error('Phase8 Evidence checkpoint is missing.');
  return checkpoint;
}

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
