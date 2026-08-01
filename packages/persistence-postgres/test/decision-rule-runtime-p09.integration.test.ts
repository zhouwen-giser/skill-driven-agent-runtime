import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
} from '../../domain/src/index.js';
import { PostgresArtifactRepository, PostgresRuleUsageRepository } from '../src/index.js';

interface ArtifactFixture {
  readonly artifacts: readonly CompiledArtifact[];
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding: ArtifactRuntimeBinding;
}

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
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
    `TRUNCATE compiled_artifact,artifact_active_pointer,artifact_lineage,
       artifact_validation_run,artifact_approval,artifact_execution,artifact_feedback,
       artifact_match_log,experience_trace,pattern_candidate,cognitive_runtime_outbox CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P09 PostgreSQL Rule usage authority', () => {
  it('accepts exact replay, rejects id drift, and emits P02 Outbox evidence', async () => {
    const artifact = fixture.artifacts.find(
      (candidate) => candidate.artifactType === 'decision_rule',
    );
    if (artifact === undefined) throw new Error('Decision Rule fixture missing.');
    const candidateArtifact: CompiledArtifact = { ...artifact, status: 'candidate' };
    await new PostgresArtifactRepository(pool).saveCandidate({
      artifact: candidateArtifact,
      lineage: {
        ...structuredClone(fixture.lineage),
        lineageId: candidateArtifact.lineageRef,
        artifactId: candidateArtifact.artifactId,
        artifactVersion: candidateArtifact.version,
        validationRunRefs: [],
      },
      runtimeBinding: {
        ...structuredClone(fixture.runtimeBinding),
        artifactId: candidateArtifact.artifactId,
        artifactVersion: candidateArtifact.version,
      },
    });

    const repository = new PostgresRuleUsageRepository(pool);
    const start = {
      artifactExecutionId: 'execution.rule.p09',
      artifactId: candidateArtifact.artifactId,
      version: candidateArtifact.version,
      taskId: 'task.rule.p09',
      goalId: 'goal.rule.p09',
      goalVersion: 1,
      mode: 'decision_rule_evaluation',
      decisionSnapshot: {
        resultHash: candidateArtifact.contentHash,
        evaluation: {
          resultHash: candidateArtifact.contentHash,
          createdAt: '2026-07-30T00:00:00.000Z',
        },
        p09: true,
      },
      startedAt: '2026-07-30T00:00:00.000Z',
    };
    await expect(
      repository.startOrLoad({
        ...start,
        decisionSnapshot: {
          ...start.decisionSnapshot,
          evaluation: {
            resultHash: candidateArtifact.contentHash,
            createdAt: '2026-07-30T00:00:09.000Z',
          },
        },
        startedAt: '2026-07-30T00:00:09.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'started',
    });
    await expect(repository.startOrLoad(start)).resolves.toMatchObject({
      status: 'started',
    });
    await expect(
      repository.startOrLoad({ ...start, taskId: 'task.rule.drifted' }),
    ).rejects.toMatchObject({ code: 'RULE_USAGE_IDEMPOTENCY_CONFLICT' });

    const completion = {
      artifactExecutionId: start.artifactExecutionId,
      status: 'completed' as const,
      completedAt: '2026-07-30T00:00:01.000Z',
    };
    await repository.completeOnce(completion);
    await repository.completeOnce(completion);
    await expect(
      repository.completeOnce({ ...completion, status: 'failed' }),
    ).rejects.toMatchObject({ code: 'RULE_USAGE_CAS_CONFLICT' });

    const feedback = {
      feedbackId: 'feedback.rule.p09',
      artifactExecutionId: start.artifactExecutionId,
      artifactId: candidateArtifact.artifactId,
      feedbackType: 'rule_runtime_event',
      reasonCode: 'RULE_DECISION_ADVICE',
      summary: 'P09 evaluation evidence.',
      impact: { eventType: 'artifact.rule_evaluated' },
      outcomeRef: 'outcome.rule.p09',
      createdAt: '2026-07-30T00:00:02.000Z',
    };
    await repository.appendFeedbackOnce(feedback);
    await repository.appendFeedbackOnce(feedback);
    await expect(
      repository.appendFeedbackOnce({ ...feedback, reasonCode: 'RULE_DECISION_DENY' }),
    ).rejects.toMatchObject({ code: 'RULE_FEEDBACK_IDEMPOTENCY_CONFLICT' });

    const stored = await pool.query<{ executions: number; feedback: number; outbox: number }>(
      `SELECT
         (SELECT count(*)::integer FROM artifact_execution) AS executions,
         (SELECT count(*)::integer FROM artifact_feedback) AS feedback,
         (SELECT count(*)::integer FROM cognitive_runtime_outbox
           WHERE aggregate_id IN ($1,$2)) AS outbox`,
      [start.artifactExecutionId, feedback.feedbackId],
    );
    expect(stored.rows).toEqual([{ executions: 1, feedback: 1, outbox: 3 }]);
  });
});
