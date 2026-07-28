import { createHash } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  ArtifactCandidateGenerator,
  ArtifactReplayValidationApplicationService,
  CandidateGenerationApplicationService,
  CandidateGenerationTriggerDispatcher,
  DeterministicProcessMiner,
  ExperienceNormalizationService,
  ExperienceTraceNormalizer,
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
  type CognitiveSourceRef,
  type GoalExperienceEpisode,
} from '../../domain/src/index.js';
import {
  PostgresArtifactRepository,
  PostgresArtifactReplayValidationRepository,
  PostgresCandidateGenerationCatalog,
  PostgresCandidateGenerationRepository,
  PostgresCompilationRunRepository,
  PostgresConversationContextRepository,
  PostgresExperienceCompilationRepository,
  PostgresGoalExperienceEpisodeRepository,
  PostgresSkillRepository,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
const tenantId = 'tenant-p04r-integration';
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
       compilation_run,experience_job,goal_experience_episode_source,goal_experience_episode,
       cognitive_runtime_outbox,skill_version,skill,conversation_context CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

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
      })),
    );
    for (const item of independent) {
      const episode = formalEpisodeAt(
        item.suffix,
        `user-${item.suffix}`,
        'succeeded',
        item.timestamp,
        item.request,
      );
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
    });
    expect(evidence.rows[0]?.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);

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

    await expect(replayRepository.purgeTenant(tenantId)).resolves.toBe(9);
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
      validation_runs: 105,
      validation_results: 4,
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
    const goalId = `goal-${suffix}`;
    const planId = `plan-authority-${suffix}`;
    const instanceId = `instance-authority-${suffix}`;
    const controlId = `control-authority-${suffix}`;
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
    const contractHash = sha(`contract-${suffix}`);
    await pool.query(
      `INSERT INTO user_goal_contract(
         goal_id,goal_version,schema_version,contract_hash,contract_json,created_at)
       VALUES($1,1,'1.0',$2,$3::jsonb,$4)`,
      [
        goalId,
        contractHash,
        JSON.stringify({
          schemaVersion: '1.0',
          goalId,
          goalVersion: 1,
          title: `Formal workflow remediation ${suffix}`,
          constraints: [],
          criteria: [
            {
              criterionId: `criterion-${suffix}`,
              description: 'The workflow policy is verified before remediation.',
              required: true,
            },
          ],
        }),
        timestamp,
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
         control_id,context_id,goal_id,goal_version,status,current_plan_id,input_json,
         skill_ids_json,planning_instruction,round_count,replan_count,final_instance_id,
         created_at,updated_at)
       VALUES($1,$2,$3,1,$4,$5,'{}'::jsonb,'[]'::jsonb,$6,1,0,$7,$8,$9)`,
      [
        controlId,
        `context-${suffix}`,
        goalId,
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
         outcome_id,outcome_kind,goal_id,goal_version,control_id,control_status,round_index,
         final_instance_id,summary,committed_at)
       VALUES($1,$2,$3,1,$4,$5,0,$6,$7,$8)`,
      [
        `outcome-${suffix}`,
        achieved ? 'achieved' : 'unachievable',
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
      environmentClass: suffix === 'success-b' ? 'edge' : 'server',
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
  };
  return createGoalExperienceEpisode({
    schemaVersion: COGNITIVE_SCHEMA_VERSION,
    episodeId: `episode-p04r-${suffix}`,
    goalId: `goal-${suffix}`,
    goalVersion: 1,
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

function sha(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
