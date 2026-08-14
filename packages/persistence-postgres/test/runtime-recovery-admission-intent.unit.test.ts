import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresRuntimeRecoveryRepository } from '../src/index.js';

describe('PostgresRuntimeRecoveryRepository admission-intent preservation', () => {
  it('preserves only receipt-recorded Task, Workflow, and attempt authority when enabled', async () => {
    const { repository, query, release } = harness(true);

    await expect(repository.failInterrupted('2026-08-13T03:00:00.000Z')).resolves.toEqual({
      tasks: 0,
      workflowInstances: 0,
      taskAttempts: 0,
    });

    const taskSql = findSql(query, 'UPDATE agent_task task');
    expect(taskSql).toContain('FROM remote_task_admission_intent admission');
    expect(taskSql).toContain('admission.task_id=task.task_id');
    expect(taskSql).toContain("admission.status='receipt_recorded'");

    const workflowSql = findSql(query, 'UPDATE workflow_instance instance');
    expect(workflowSql).toContain('FROM remote_task_admission_intent admission');
    expect(workflowSql).toContain(
      "admission.local_envelope_json->>'workflowInstanceId'=instance.instance_id",
    );
    expect(workflowSql).toContain("admission.status='receipt_recorded'");

    const attemptSql = findSql(query, 'UPDATE task_execution_attempt');
    expect(attemptSql).toContain('FROM remote_task_admission_intent admission');
    expect(attemptSql).toContain('admission.task_id=task_execution_attempt.task_id');
    expect(attemptSql).toContain("admission.status='receipt_recorded'");
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps the original fail-all behavior when remote-wait preservation is disabled', async () => {
    const { repository, query } = harness(false);

    await repository.failInterrupted('2026-08-13T03:00:00.000Z');

    for (const sql of query.mock.calls.map(([text]) => text))
      expect(sql).not.toContain('remote_task_admission_intent');
  });
});

function harness(preserveRemoteWaits: boolean) {
  const query = vi.fn((text: string) => {
    if (text === 'BEGIN' || text === 'COMMIT') return Promise.resolve({ rows: [], rowCount: null });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  const repository = new PostgresRuntimeRecoveryRepository(
    { connect } as unknown as Pool,
    undefined,
    { preserveRemoteWaits },
  );
  return { repository, query, release };
}

function findSql(query: ReturnType<typeof vi.fn>, fragment: string): string {
  const match = query.mock.calls.find(([text]) => String(text).includes(fragment));
  if (match === undefined) throw new Error(`SQL containing ${fragment} was not executed`);
  return String(match[0]);
}
