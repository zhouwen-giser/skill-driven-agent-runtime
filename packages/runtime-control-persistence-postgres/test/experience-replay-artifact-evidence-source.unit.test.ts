import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { brotliCompressSync } from 'node:zlib';

import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { canonicalizeSourceArtifactJson } from '../../domain/src/index.js';
import { PostgresExperienceReplayArtifactEvidenceSource } from '../src/index.js';

describe('PostgresExperienceReplayArtifactEvidenceSource', () => {
  it('carries the exact durable source observation cursor into the projection partition', async () => {
    const source = new PostgresExperienceReplayArtifactEvidenceSource({
      query: () =>
        Promise.resolve({
          rows: [
            {
              kind: 'experience_task',
              source_family: 'experience',
              source_id: 'task-a',
              source_version: null,
              episode_id: 'task-a',
              observed_at: new Date('2026-08-04T03:05:00.000Z'),
            },
          ],
        }),
    } as unknown as Pool);

    await expect(source.pendingPartitions(1)).resolves.toEqual([
      {
        kind: 'experience_task',
        sourceFamily: 'experience',
        sourcePartition: 'v141:experience_task:6:task-a',
        sourceId: 'task-a',
        episodeId: 'task-a',
        observedAt: '2026-08-04T03:05:00.000Z',
      },
    ]);
  });

  it('enumerates bounded source partitions, scopes task facts exactly and decodes patterns', async () => {
    const client = new FakeClient();
    const pool = new FakePool(client);
    const source = new PostgresExperienceReplayArtifactEvidenceSource(pool as unknown as Pool);

    await expect(source.pendingPartitions(10)).resolves.toEqual([]);
    const snapshot = await source.load({
      kind: 'experience_task',
      sourceFamily: 'experience',
      sourcePartition: 'v141:experience_task:6:task-a',
      sourceId: 'task-a',
      episodeId: 'task-a',
    });
    const patternSnapshot = await source.load({
      kind: 'experience_pattern',
      sourceFamily: 'experience',
      sourcePartition: 'v141:experience_pattern:9:pattern-a',
      sourceId: 'pattern-a',
    });
    const retrievalSnapshot = await source.load({
      kind: 'retrieval',
      sourceFamily: 'artifact',
      sourcePartition: 'v141:retrieval:7:match-a',
      sourceId: 'match-a',
    });
    const artifactSnapshot = await source.load({
      kind: 'artifact',
      sourceFamily: 'artifact',
      sourcePartition: 'v141:artifact:10:artifact-a:v3',
      sourceId: 'artifact-a',
      sourceVersion: 3,
    });
    const usageSnapshot = await source.load({
      kind: 'usage',
      sourceFamily: 'artifact',
      sourcePartition: 'v141:usage:11:execution-a',
      sourceId: 'execution-a',
    });

    expect(snapshot?.task).toMatchObject({ task_id: 'task-a' });
    expect(patternSnapshot?.patterns[0]?.['definition']).toMatchObject({
      workflowPattern: { workflowPatternId: 'workflow-a' },
    });
    expect(retrievalSnapshot?.retrievals).toEqual([
      expect.objectContaining({
        match_id: 'match-a',
        candidate_artifact_id: 'artifact-a',
        artifact_version: 3,
      }),
    ]);
    expect(artifactSnapshot?.artifacts).toEqual([
      expect.objectContaining({
        artifact_id: 'artifact-a',
        version: 3,
        workflow_pattern_refs: ['workflow-a'],
      }),
    ]);
    expect(usageSnapshot?.usages).toEqual([
      expect.objectContaining({
        artifact_execution_id: 'execution-a',
        artifact_id: 'artifact-a',
        artifact_version: 3,
        retrieval_artifact_id: 'artifact-a',
        retrieval_artifact_version: 3,
      }),
    ]);
    expect(pool.sql[0]).toContain("'experience_pattern'");
    expect(pool.sql[0]).toContain("'artifact'");
    expect(pool.sql[0]).not.toContain('NOT EXISTS');
    expect(pool.sql[0]).toContain('checkpoint.last_occurred_at < normalized.observed_at');
    expect(pool.sql[0]).toContain("date_trunc('milliseconds',MAX(observed_at)) AS observed_at");
    expect(pool.sql[0]).toContain('trace.created_at');
    expect(pool.sql[0]).toContain('interaction.created_at');
    expect(pool.sql[0]).toContain("run.run_type='process_mining'");
    const scopedSql = client.sql.filter(
      (sql) =>
        sql.includes('goal_experience_episode') ||
        sql.includes('experience_trace') ||
        sql.includes('pattern_candidate') ||
        sql.includes('replay_dataset'),
    );
    expect(scopedSql.length).toBeGreaterThan(0);
    expect(scopedSql.some((sql) => /episode(?:_row)?\.task_id=\$1/u.test(sql))).toBe(true);
    expect(scopedSql.join('\n')).not.toContain('task.goal_id=episode.goal_id');
    const episodeSql = client.sql.find((sql) => sql.includes('goal_experience_episode_source'));
    expect(episodeSql).toContain("'schemaVersion','1.0'");
    expect(episodeSql).toContain("'sourceRefId',source_row.source_ref_id");
    expect(episodeSql).toContain("'contentHash',source_row.content_hash");
    const patternSql = client.sql.find((sql) => sql.includes('FROM pattern_candidate pattern_row'));
    expect(patternSql).toContain("support.support_kind='support'");
    expect(patternSql).toContain("support.support_kind='contradiction'");
    const retrievalSql = client.sql.find((sql) =>
      sql.includes('FROM artifact_match_log match_row'),
    );
    expect(retrievalSql).toContain('artifact_row.version=match_row.artifact_version');
    expect(retrievalSql).not.toContain("'artifact_version',artifact_row.version");
    const usageSql = client.sql.find((sql) =>
      sql.includes('FROM artifact_execution execution_row'),
    );
    expect(usageSql).toContain("'retrieval_artifact_version',match_row.artifact_version");
    const interactionSql = client.sql.find((sql) =>
      sql.includes('FROM planning_interaction_episode interaction_row'),
    );
    expect(interactionSql).toContain("interaction_row.snapshot->'correctionIds'");
    expect(interactionSql).toContain("'correction_ids'");
    const artifactSql = client.sql.find((sql) =>
      sql.includes('FROM compiled_artifact artifact_row'),
    );
    expect(artifactSql).toContain('generalized_row.source_fused_pattern_ref');
    expect(artifactSql).toContain(
      'lineage_row.source_pattern_refs ? fused_row.source_process_pattern_ref',
    );
    expect(artifactSql).toContain(
      'lineage_row.source_pattern_refs ? fused_row.workflow_pattern_id',
    );
    expect(artifactSql).toContain(
      'generalized_row.tenant_id IS NOT DISTINCT FROM artifact_row.tenant_id',
    );
    expect(JSON.stringify(client.parameters)).toContain('artifact-a:3');
  });
});

class FakePool {
  readonly sql: string[] = [];
  readonly #client: FakeClient;

  constructor(client: FakeClient) {
    this.#client = client;
  }

  query(sql: string): Promise<Readonly<{ rows: readonly unknown[] }>> {
    this.sql.push(sql);
    return Promise.resolve({ rows: [] });
  }

  connect(): Promise<FakeClient> {
    return Promise.resolve(this.#client);
  }
}

class FakeClient {
  readonly sql: string[] = [];
  readonly parameters: (readonly unknown[])[] = [];

  query(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly Readonly<Record<string, unknown>>[] }>> {
    this.sql.push(sql);
    this.parameters.push(parameters);
    if (sql.includes('FROM agent_task task_row'))
      return Promise.resolve({ rows: [{ value: { task_id: 'task-a' } }] });
    if (sql.includes('FROM pattern_candidate pattern_row'))
      return Promise.resolve({ rows: [{ value: patternRow() }] });
    if (sql.includes('FROM artifact_match_log match_row'))
      return Promise.resolve({
        rows: [
          {
            value: {
              match_id: 'match-a',
              request_id: 'request-a',
              task_id: 'task-a',
              candidate_artifact_id: 'artifact-a',
              artifact_version: 3,
              artifact_tenant_id: 'tenant-a',
            },
          },
        ],
      });
    if (sql.includes('FROM compiled_artifact artifact_row'))
      return Promise.resolve({
        rows: [
          {
            value: {
              artifact_id: 'artifact-a',
              version: 3,
              workflow_pattern_refs: ['workflow-a'],
            },
          },
        ],
      });
    if (sql.includes('FROM artifact_execution execution_row'))
      return Promise.resolve({
        rows: [
          {
            value: {
              artifact_execution_id: 'execution-a',
              artifact_id: 'artifact-a',
              artifact_version: 3,
              task_id: 'task-a',
              retrieval_artifact_id: 'artifact-a',
              retrieval_artifact_version: 3,
            },
          },
        ],
      });
    return Promise.resolve({ rows: [] });
  }

  release(): void {
    this.sql.push('CLIENT RELEASE');
  }
}

function patternRow() {
  const quality = {
    supportCount: 1,
    totalTraceCount: 1,
    supportRate: 1,
    successRate: 1,
    traceCoverage: 1,
    fitness: 1,
    precisionProxy: 1,
    environmentCoverage: 1,
    contradictionRate: 0,
    generalization: 1,
    mandatoryThreshold: 1,
  };
  const definition = {
    schemaVersion: '1.2',
    cohort: { tenantId: 'tenant-a', taskTypeId: 'task-type-a', minimumCompleteness: 1 },
    variants: [
      {
        variantId: 'variant-a',
        activitySequence: ['activity-a'],
        activityKindSequence: ['skill_goal'],
        concurrencyGroups: [],
        branchSequence: [],
        occurrenceCount: 1,
        traceRefs: ['trace-a'],
        successCount: 1,
        failureCount: 0,
      },
    ],
    discoveredPattern: {
      patternId: 'pattern-a',
      cohortFingerprint: `sha256:${'1'.repeat(64)}`,
      algorithmVersion: 'sdar-deterministic-process-miner/1.2',
      mandatoryActivities: ['activity-a'],
      optionalActivities: [],
      orderingConstraints: [],
      parallelCandidates: [],
      recoveryBranches: [],
      failureVariants: [],
      supportRefs: ['trace-a'],
      contradictionRefs: [],
      environmentCoverage: ['integration'],
      quality,
    },
    workflowPattern: {
      workflowPatternId: 'workflow-a',
      taskTypeId: 'task-type-a',
      activityPatterns: [
        {
          activityKey: 'activity-a',
          activityKind: 'skill_goal',
          objectiveSummary: 'Perform activity A',
          required: true,
          supportCount: 1,
          supportRate: 1,
          capabilityRefs: ['capability-a'],
          effectRefs: ['effect-a'],
          lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
        },
      ],
      dependencyPatterns: [],
      recoveryPatterns: [],
      sourcePatternRef: 'pattern-a',
      sourceTraceRefs: ['trace-a'],
      quality,
    },
  };
  const serialized = canonicalizeSourceArtifactJson(definition);
  return {
    pattern_id: 'pattern-a',
    definition: {
      schemaVersion: '1.2',
      encoding: 'br+base64',
      contentHash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
      uncompressedBytes: Buffer.byteLength(serialized),
      workflowPatternId: definition.workflowPattern.workflowPatternId,
      supportCount: definition.workflowPattern.sourceTraceRefs.length,
      contradictionCount: definition.discoveredPattern.contradictionRefs.length,
      payload: brotliCompressSync(serialized).toString('base64'),
    },
  };
}
