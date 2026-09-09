import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { EvidenceQualityIssue } from '../../domain/src/index.js';
import { PostgresEvidenceStore, PostgresEvidenceOperationsRepository } from '../src/index.js';

export async function verifyGowmIssueReadScope(
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
  const scope = {
    allowedDeviceIds: [owner.device_id],
    sdarServiceKey: owner.sdar_service_key,
    includeNonDevice: false,
  };
  const writer = new PostgresEvidenceStore(pool);
  const reader = new PostgresEvidenceStore(pool, scope);
  const management = new PostgresEvidenceOperationsRepository(pool, scope);
  const id = randomUUID();
  const issues: EvidenceQualityIssue[] = [];
  for (const taskId of [a, b]) {
    const issue: EvidenceQualityIssue = {
      issueId: `${id}-${taskId}`,
      issueCode: 'schema_invalid',
      severity: 'diagnostic',
      episodeId: taskId,
      recordId: `missing-envelope-${id}-${taskId}`,
      sourceSystem: 'runtime',
      sourceTable: 'agent_task',
      sourceRecordId: taskId,
      detail: { fixture: true },
      createdAt: new Date().toISOString(),
    };
    await writer.recordQualityIssue(issue);
    await writer.recordProjectionIssue(
      {
        ...issue,
        projectorVersion: 'scope-fixture/v1',
        sourcePartition: `runtime-core:${taskId}`,
        retryable: false,
      },
      'diagnostic',
    );
    issues.push(issue);
  }
  for (const [index, taskId] of [a, b].entries()) {
    const expected = index === 0;
    assert.equal(
      (await reader.listOpenEpisodeQualityIssues(taskId)).some(
        (issue) => issue.issueId === issues[index]?.issueId,
      ),
      expected,
    );
    assert.equal(
      (await management.listQualityIssues({ limit: 100, episodeId: taskId })).items.some(
        (issue) => issue.issueId === issues[index]?.issueId,
      ),
      expected,
    );
    assert.equal(
      (await management.listProjectionIssues({ limit: 100, episodeId: taskId })).items.some(
        (issue) => issue.issueId === issues[index]?.issueId,
      ),
      expected,
    );
  }
  for (const taskId of [a, b]) {
    const record = (
      await pool.query<{ sequence: string }>(
        'SELECT sequence::text FROM evidence_outbox WHERE task_id=$1 ORDER BY sequence DESC LIMIT 1',
        [taskId],
      )
    ).rows[0];
    assert.ok(record);
    await writer.deadLetter(
      record.sequence,
      'export_rejected',
      { fixture: true },
      new Date().toISOString(),
    );
  }
  const dead = await pool.query<{ dead_letter_id: string; task_id: string }>(
    'SELECT dead.dead_letter_id,evidence.task_id FROM evidence_dead_letter dead JOIN evidence_outbox evidence USING(sequence) WHERE evidence.task_id=ANY($1::text[])',
    [taskIds],
  );
  assert.equal(new Set(dead.rows.map((row) => row.task_id)).size, 2);
  const listed = await management.listDeadLetters({ limit: 100 });
  for (const row of dead.rows)
    assert.equal(
      listed.items.some((item) => item.deadLetterId === row.dead_letter_id),
      row.task_id === a,
    );
}
