import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresEvidenceStore } from '../src/evidence-store.js';
import { PostgresEvidenceQualityAuthoritySource } from '../src/evidence-quality-source.js';

export async function verifyGowmQualitySource(pool: Pool, taskIds: readonly string[]) {
  const [a, b] = taskIds;
  assert.ok(a && b);
  const owner = (
    await pool.query<{ device_id: string; sdar_service_key: string }>(
      'SELECT device_id,sdar_service_key FROM agent_task WHERE task_id=$1',
      [a],
    )
  ).rows[0];
  assert.ok(owner);
  const scope = {
    allowedDeviceIds: [owner.device_id],
    sdarServiceKey: owner.sdar_service_key,
    includeNonDevice: false,
  };
  const source = new PostgresEvidenceQualityAuthoritySource(pool, scope);
  const all = new PostgresEvidenceQualityAuthoritySource(pool);
  const fixture = new PostgresEvidenceStore(pool);
  const run = randomUUID();
  const issues = taskIds.map((taskId) => ({
    issueId: `${run}-${taskId}`,
    sourcePartition: `runtime-core:${taskId}`,
    projectorVersion: 'quality-source-fixture/v1',
    episodeId: taskId,
  }));
  try {
    for (const issue of issues)
      await fixture.recordProjectionIssue(
        {
          ...issue,
          issueCode: 'payload_hash_conflict',
          severity: 'diagnostic',
          retryable: false,
          sourceSystem: 'runtime',
          sourceTable: 'agent_task',
          sourceRecordId: issue.episodeId,
          recordType: 'runtime.outcome',
          detail: { fixture: run },
          createdAt: new Date().toISOString(),
        },
        'diagnostic',
      );
    const unrestricted = await all.findings('payload_conflict');
    const restricted = await source.findings('payload_conflict');
    for (const [index, issue] of issues.entries()) {
      const identity = `projection-issue:${issue.issueId}`;
      assert.ok(unrestricted.some((row) => row.identity === identity));
      assert.equal(
        restricted.some((row) => row.identity === identity),
        index === 0,
      );
    }
    for (const rule of [
      'sequence_gap',
      'orphan_reference',
      'version_gap',
      'missing_verification',
      'remote_task_unclosed',
      'skill_tree_incomplete',
      'experience_missing_fact',
      'node_revision_regression',
      'export_ack_gap',
    ] as const) {
      const findings = await source.findings(rule);
      assert.ok(findings.every((finding) => finding.episodeId !== b));
    }
  } finally {
    for (const issue of issues)
      await fixture.resolveProjectionIssue({ ...issue, resolvedAt: new Date().toISOString() });
  }
}
