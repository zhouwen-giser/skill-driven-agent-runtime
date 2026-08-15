import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresRuntimeCoreEvidenceSource } from '../src/index.js';

describe('PostgresRuntimeCoreEvidenceSource', () => {
  it('enumerates every terminal Task once even when no terminal-outcome row exists', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ task_id: 'task-failed-without-outcome' }],
    });
    const source = new PostgresRuntimeCoreEvidenceSource({ query } as unknown as Pool);

    await expect(source.pendingTaskIds(10)).resolves.toEqual(['task-failed-without-outcome']);

    const [sql, parameters] = query.mock.calls[0] as [string, readonly unknown[]];
    expect(sql).toContain('FROM agent_task task');
    expect(sql).toContain(
      "task.phase IN ('capability_gap','completed','canceled','failed','invalidated')",
    );
    expect(sql).toContain(
      'LEFT JOIN runtime_terminal_outcome outcome ON outcome.task_id=task.task_id',
    );
    expect(sql).toContain('checkpoint.last_occurred_at < task.updated_at');
    expect(sql).toContain('GROUP BY task.task_id,task.updated_at');
    expect(sql).toContain("evidence.record_type='runtime.run_seal'");
    expect(parameters).toEqual([10]);
  });
});
