import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { EvidenceQualityIssue } from '../../domain/src/index.js';
import { PostgresEvidenceStore } from '../src/evidence-store.js';

export async function verifyGowmIssueResolveScope(
  pool: Pool,
  taskIds: readonly string[],
): Promise<void> {
  const [a, b] = taskIds;
  assert.ok(a);
  assert.ok(b);
  const owner = (
    await pool.query<{ device_id: string; sdar_service_key: string }>(
      'SELECT device_id,sdar_service_key FROM agent_task WHERE task_id=$1',
      [a],
    )
  ).rows[0];
  assert.ok(owner);
  const writer = new PostgresEvidenceStore(pool);
  const store = new PostgresEvidenceStore(pool, {
    allowedDeviceIds: [owner.device_id],
    sdarServiceKey: owner.sdar_service_key,
    includeNonDevice: false,
  });
  const retained = (
    await pool.query<{ issue_id: string }>('SELECT issue_id FROM evidence_quality_issue')
  ).rows.map((row) => row.issue_id);
  const fixtureTaskIds: readonly string[] = [a, b];
  for (const mode of ['projection', 'single', 'episode', 'rule', 'source'] as const) {
    const id = randomUUID();
    const at = new Date().toISOString();
    const issues: EvidenceQualityIssue[] = [];
    for (const taskId of fixtureTaskIds) {
      const issue: EvidenceQualityIssue = {
        issueId: `${id}-${taskId}`,
        issueCode: 'reference_unresolved',
        severity: 'diagnostic',
        recordType: `fixture.${id}`,
        episodeId: taskId,
        sourceSystem: 'runtime',
        sourceTable: 'agent_task',
        sourceRecordId: taskId,
        detail: { fixture: true },
        createdAt: at,
      };
      const save = (repository: PostgresEvidenceStore, candidate: EvidenceQualityIssue) =>
        mode === 'projection'
          ? repository.recordProjectionIssue(
              {
                ...candidate,
                sourcePartition: `runtime-core:${taskId}`,
                projectorVersion: 'scope-fixture/v1',
                retryable: false,
              },
              'diagnostic',
            )
          : repository.recordQualityIssue(candidate, 'orphan_reference');
      if (taskId === a) {
        await save(store, issue);
        await save(store, issue);
      } else {
        await assert.rejects(save(store, issue), { code: 'EVIDENCE_ISSUE_IDENTITY_CONFLICT' });
        await save(writer, issue);
        await assert.rejects(save(store, { ...issue, episodeId: a }), {
          code: 'EVIDENCE_ISSUE_IDENTITY_CONFLICT',
        });
      }
      issues.push(issue);
    }
    for (const issue of issues) {
      assert.ok(issue.episodeId);
      if (mode === 'projection')
        await store.resolveProjectionIssue({
          issueId: issue.issueId,
          sourcePartition: `runtime-core:${issue.episodeId}`,
          projectorVersion: 'scope-fixture/v1',
          resolvedAt: at,
        });
      else if (mode === 'single')
        await store.resolveQualityIssue({
          issueId: issue.issueId,
          ruleId: 'orphan_reference',
          resolvedAt: at,
        });
      else if (mode === 'episode')
        await store.resolveQualityIssues({
          episodeId: issue.episodeId ?? '',
          recordTypePrefix: `fixture.${id}`,
          retainedIssueIds: [],
          resolvedAt: at,
        });
      else if (mode === 'rule')
        await store.resolveQualityRuleIssues({
          ruleId: 'orphan_reference',
          retainedIssueIds: retained,
          resolvedAt: at,
        });
      else
        await store.resolveSourceQualityIssues({
          sourceTable: 'agent_task',
          sourceRecordId: issue.sourceRecordId,
          recordTypePrefix: `fixture.${id}`,
          retainedIssueIds: [],
          resolvedAt: at,
        });
    }
    const table = mode === 'projection' ? 'evidence_projection_issue' : 'evidence_quality_issue';
    const rows = await pool.query<{
      episode_id: string;
      resolved_at: Date | null;
      revision: string;
    }>(
      `SELECT episode_id,resolved_at,revision::text FROM ${table} WHERE issue_id=ANY($1::text[])`,
      [issues.map((issue) => issue.issueId)],
    );
    assert.equal(rows.rows.length, 2);
    for (const row of rows.rows) {
      assert.equal(row.resolved_at !== null, row.episode_id === a);
      assert.equal(row.revision, row.episode_id === a ? '2' : '1');
    }
  }
}
