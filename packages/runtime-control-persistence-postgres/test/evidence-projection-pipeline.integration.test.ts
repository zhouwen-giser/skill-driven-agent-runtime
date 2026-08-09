import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  canonicalizeSourceArtifactJson,
  createCohortDefinition,
  createDiscoveredProcessPattern,
  createProcessVariant,
  createWorkflowPattern,
  hashCanonicalEvidenceJson,
  type EvidenceJsonValue,
} from '../../domain/src/index.js';
import {
  CanonicalEvidenceProjectionPipeline,
  EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
  type ExperienceReplayArtifactEvidenceSource,
  type ExperienceReplayArtifactProjectionPartition,
  type McpCapabilityEvidenceSource,
  type RuntimeCoreEvidenceSource,
  type SkillEvidenceSource,
} from '../../runtime-control-application/src/index.js';
import {
  PostgresEvidenceStore,
  PostgresExperienceReplayArtifactEvidenceSource,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const pool = new Pool({ connectionString, max: 4 });
const poisonId = 'phase8-projection-a-poison';
const healthyId = 'phase8-projection-b-healthy';
const testSourceIds = new Set([poisonId, healthyId]);

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
  await cleanup();
  await pool.query(
    `INSERT INTO pattern_candidate(
       pattern_id,pattern_type,cohort_fingerprint,definition,support_refs,
       contradiction_refs,confidence,status,created_at)
     VALUES
       ($1,'workflow_pattern','phase8-poison-isolation','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,
        1,'candidate',clock_timestamp()),
       ($2,'workflow_pattern','phase8-poison-isolation',$3::jsonb,'[]'::jsonb,'[]'::jsonb,
        1,'candidate',clock_timestamp())`,
    [poisonId, healthyId, JSON.stringify(patternEnvelope(healthyId))],
  );
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe('canonical Evidence projection poison isolation', { concurrent: false }, () => {
  it('persists poison state, projects a healthy partition, retries after restart, and resolves only after repair', async () => {
    let failure: 'decode_poison' | 'source_unavailable' | 'repaired' = 'decode_poison';
    const attempts: string[] = [];
    const first = createPipeline(() => failure, attempts);

    const firstResult = await first.drain(10);

    expect(firstResult).toMatchObject({
      attemptedItems: 2,
      projectedItems: 1,
      failedItems: 1,
      issuePersistenceFailures: 0,
    });
    expect(attempts).toEqual([poisonId, healthyId]);
    const partition = await partitionFor(poisonId);
    const initialIssue = await projectionIssue(partition.sourcePartition);
    expect(initialIssue).toMatchObject({
      issue_code: 'projection_bug',
      severity: 'blocking',
      evaluation_role: 'required',
      source_system: 'runtime',
      source_table: 'pattern_candidate',
      source_record_id: poisonId,
      source_partition: partition.sourcePartition,
      projector_version: EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
      retryable: true,
      detail: {
        failureCode: 'UNCLASSIFIED_ERROR',
        failureStage: 'item_projection',
        sourceFamily: 'experience',
      },
      resolved_at: null,
    });
    expect(JSON.stringify(initialIssue)).not.toMatch(/secret|message|stack|credential/iu);
    await expect(checkpointIds()).resolves.toEqual([healthyId]);

    const duringBackoff = await testExperienceSource().pendingPartitions(10);
    expect(duringBackoff.map(({ sourceId }) => sourceId)).toEqual([healthyId]);

    await replacePoisonPatternWithLegalAuthority();
    await ageOpenIssue(partition.sourcePartition);
    failure = 'source_unavailable';
    attempts.length = 0;
    const restarted = createPipeline(() => failure, attempts);
    const restartedResult = await restarted.drain(10);

    expect(restartedResult).toMatchObject({ attemptedItems: 2, projectedItems: 1, failedItems: 1 });
    expect(attempts).toEqual([poisonId, healthyId]);
    const retriedIssue = await projectionIssue(partition.sourcePartition);
    expect(retriedIssue.issue_id).toBe(initialIssue.issue_id);
    expect(retriedIssue).toMatchObject({
      issue_code: 'source_unavailable',
      detail: {
        failureCode: 'SOURCE_UNAVAILABLE_PG_RUNTIME',
        failureStage: 'item_projection',
        sourceFamily: 'experience',
      },
      resolved_at: null,
    });
    expect(new Date(retriedIssue.created_at).getTime()).toBeGreaterThan(
      new Date(initialIssue.created_at).getTime(),
    );
    await expect(checkpointIds()).resolves.toEqual([healthyId]);

    await ageOpenIssue(partition.sourcePartition);
    failure = 'repaired';
    attempts.length = 0;
    const repaired = createPipeline(() => failure, attempts);
    const repairedResult = await repaired.drain(10);

    expect(repairedResult).toMatchObject({ attemptedItems: 2, projectedItems: 2, failedItems: 0 });
    expect(attempts).toEqual([poisonId, healthyId]);
    const resolvedIssue = await projectionIssue(partition.sourcePartition);
    expect(resolvedIssue.issue_id).toBe(initialIssue.issue_id);
    expect(resolvedIssue.resolved_at).not.toBeNull();
    await expect(checkpointIds()).resolves.toEqual([poisonId, healthyId]);
  });
});

function createPipeline(
  failure: () => 'decode_poison' | 'source_unavailable' | 'repaired',
  attempts: string[],
) {
  const store = new PostgresEvidenceStore(pool);
  const authoritativeSource = new PostgresExperienceReplayArtifactEvidenceSource(pool);
  return new CanonicalEvidenceProjectionPipeline({
    writer: store,
    runtimeCore: { source: emptyRuntimeSource(), projector: { projectTask: noTask } },
    skill: { source: emptySkillSource(), projector: { projectTask: noTask } },
    mcpCapability: { source: emptyMcpCapabilitySource(), projector: { projectTask: noTask } },
    experienceReplayArtifact: {
      source: testExperienceSource(),
      projector: {
        projectPartition: async (partition) => {
          attempts.push(partition.sourceId);
          const snapshot = await authoritativeSource.load(partition);
          if (snapshot === undefined) throw new Error('TEST_PATTERN_SNAPSHOT_MISSING');
          if (partition.sourceId === poisonId && failure() === 'source_unavailable') {
            throw Object.assign(new Error('secret-must-not-be-persisted'), { code: '57P03' });
          }
          const projectedAt = new Date().toISOString();
          await store.saveCheckpoint({
            sourceFamily: partition.sourceFamily,
            sourcePartition: partition.sourcePartition,
            lastSourceRecordId: partition.sourceId,
            lastSourceRevision: `test-revision:${partition.sourceId}`,
            lastPayloadHash: `sha256:${partition.sourceId === poisonId ? 'a'.repeat(64) : 'b'.repeat(64)}`,
            lastProjectedAt: projectedAt,
            projectorVersion: EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
          });
        },
      },
    },
  });
}

function testExperienceSource(): ExperienceReplayArtifactEvidenceSource {
  const source = new PostgresExperienceReplayArtifactEvidenceSource(pool);
  return {
    pendingPartitions: async (limit) =>
      (await source.pendingPartitions(1_000))
        .filter(({ sourceId }) => testSourceIds.has(sourceId))
        .slice(0, limit),
    load: (partition) => source.load(partition),
  };
}

async function partitionFor(
  sourceId: string,
): Promise<ExperienceReplayArtifactProjectionPartition> {
  const partition = (await testExperienceSource().pendingPartitions(10)).find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (partition === undefined) {
    const result = await pool.query<{ source_partition: string }>(
      `SELECT source_partition FROM evidence_projection_issue WHERE source_record_id=$1`,
      [sourceId],
    );
    const sourcePartition = result.rows[0]?.source_partition;
    if (sourcePartition === undefined) throw new Error('TEST_PROJECTION_PARTITION_MISSING');
    return {
      kind: 'experience_pattern',
      sourceFamily: 'experience',
      sourcePartition,
      sourceId,
    };
  }
  return partition;
}

async function projectionIssue(sourcePartition: string) {
  const result = await pool.query<{
    issue_id: string;
    issue_code: string;
    severity: string;
    evaluation_role: string;
    source_system: string;
    source_table: string;
    source_record_id: string;
    source_partition: string;
    projector_version: string;
    retryable: boolean;
    detail: Record<string, unknown>;
    created_at: Date | string;
    resolved_at: Date | string | null;
  }>(
    `SELECT issue_id,issue_code,severity,evaluation_role,source_system,source_table,
       source_record_id,source_partition,projector_version,retryable,detail,created_at,resolved_at
     FROM evidence_projection_issue
     WHERE source_partition=$1 AND projector_version=$2`,
    [sourcePartition, EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION],
  );
  const issue = result.rows[0];
  if (issue === undefined) throw new Error('TEST_PROJECTION_ISSUE_MISSING');
  return issue;
}

async function checkpointIds(): Promise<readonly string[]> {
  const result = await pool.query<{ last_source_record_id: string }>(
    `SELECT last_source_record_id
     FROM evidence_source_checkpoint
     WHERE source_family='experience'
       AND last_source_record_id=ANY($1::text[])
     ORDER BY last_source_record_id`,
    [[poisonId, healthyId]],
  );
  return result.rows.map(({ last_source_record_id: sourceId }) => sourceId);
}

async function ageOpenIssue(sourcePartition: string): Promise<void> {
  await pool.query(
    `UPDATE evidence_projection_issue
     SET created_at=clock_timestamp() - interval '10 seconds'
     WHERE source_partition=$1 AND resolved_at IS NULL`,
    [sourcePartition],
  );
}

async function replacePoisonPatternWithLegalAuthority(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM pattern_candidate WHERE pattern_id=$1`, [poisonId]);
    await client.query(
      `INSERT INTO pattern_candidate(
         pattern_id,pattern_type,cohort_fingerprint,definition,support_refs,
         contradiction_refs,confidence,status,created_at)
       VALUES($1,'workflow_pattern','phase8-poison-isolation',$2::jsonb,
         '[]'::jsonb,'[]'::jsonb,1,'candidate',clock_timestamp())`,
      [poisonId, JSON.stringify(patternEnvelope(poisonId))],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM evidence_projection_issue
     WHERE source_record_id=ANY($1::text[])
        OR source_partition IN (
          'v141:experience_pattern:' || length($2)::text || ':' || $2,
          'v141:experience_pattern:' || length($3)::text || ':' || $3
        )`,
    [[poisonId, healthyId], poisonId, healthyId],
  );
  await pool.query(
    `DELETE FROM evidence_source_checkpoint
     WHERE source_family='experience' AND last_source_record_id=ANY($1::text[])`,
    [[poisonId, healthyId]],
  );
  await pool.query(`DELETE FROM pattern_candidate WHERE pattern_id=ANY($1::text[])`, [
    [poisonId, healthyId],
  ]);
}

function emptyRuntimeSource(): RuntimeCoreEvidenceSource {
  return { pendingTaskIds: () => Promise.resolve([]), load: () => Promise.resolve(undefined) };
}

function emptySkillSource(): SkillEvidenceSource {
  return { pendingTaskIds: () => Promise.resolve([]), load: () => Promise.resolve(undefined) };
}

function emptyMcpCapabilitySource(): McpCapabilityEvidenceSource {
  return { pendingTaskIds: () => Promise.resolve([]), load: () => Promise.resolve(undefined) };
}

function noTask(): Promise<void> {
  return Promise.reject(new Error('TEST_UNEXPECTED_TASK_PROJECTION'));
}

function patternEnvelope(patternId: string) {
  const traceRef = `trace:${patternId}`;
  const activityKey = `activity:${patternId}`;
  const cohort = createCohortDefinition({
    tenantId: 'tenant-phase8-isolation',
    taskTypeId: 'task-type-phase8-isolation',
    environmentClass: 'integration',
    minimumCompleteness: 1,
  });
  const variant = createProcessVariant({
    variantId: `variant:${patternId}`,
    activitySequence: [activityKey],
    activityKindSequence: ['skill_goal'],
    concurrencyGroups: [],
    branchSequence: [],
    occurrenceCount: 1,
    traceRefs: [traceRef],
    successCount: 1,
    failureCount: 0,
  });
  const quality = Object.freeze({
    supportCount: 1,
    totalTraceCount: 1,
    supportRate: 1,
    successRate: 1,
    traceCoverage: 1,
    fitness: 1,
    precisionProxy: 1,
    environmentCoverage: 1,
    contradictionRate: 0,
    generalization: 0.5,
    mandatoryThreshold: 0.8,
  });
  const discoveredPattern = createDiscoveredProcessPattern({
    patternId,
    cohortFingerprint: hashCanonicalEvidenceJson(cohort),
    algorithmVersion: 'sdar-deterministic-process-miner/1.2',
    mandatoryActivities: [activityKey],
    optionalActivities: [],
    orderingConstraints: [],
    parallelCandidates: [],
    recoveryBranches: [],
    failureVariants: [],
    supportRefs: [traceRef],
    contradictionRefs: [],
    environmentCoverage: ['integration'],
    quality,
  });
  const workflowPattern = createWorkflowPattern({
    workflowPatternId: `workflow:${patternId}`,
    taskTypeId: 'task-type-phase8-isolation',
    activityPatterns: [
      {
        activityKey,
        activityKind: 'skill_goal',
        objectiveSummary: 'Project a legal healthy pattern partition.',
        required: true,
        supportCount: 1,
        supportRate: 1,
        capabilityRefs: ['capability.phase8-isolation'],
        effectRefs: ['effect.phase8-isolation'],
        lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
      },
    ],
    dependencyPatterns: [],
    recoveryPatterns: [],
    sourcePatternRef: patternId,
    sourceTraceRefs: [traceRef],
    quality,
  });
  const definition = {
    schemaVersion: '1.2',
    cohort,
    variants: [variant],
    discoveredPattern,
    workflowPattern,
  } as const;
  const serialized = canonicalizeSourceArtifactJson(definition as unknown as EvidenceJsonValue);
  return Object.freeze({
    schemaVersion: '1.2',
    encoding: 'br+base64',
    contentHash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    uncompressedBytes: Buffer.byteLength(serialized),
    workflowPatternId: workflowPattern.workflowPatternId,
    supportCount: 1,
    contradictionCount: 0,
    payload: brotliCompressSync(serialized).toString('base64'),
  });
}
