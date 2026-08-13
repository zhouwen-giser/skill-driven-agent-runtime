import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresRuntimeTaskSummaryQuery } from '../src/index.js';

describe('PostgresRuntimeTaskSummaryQuery', () => {
  it('derives advisory controls from the authoritative Task phase and bindings', async () => {
    const query = vi.fn(() =>
      Promise.resolve({
        rows: [
          row('executing', { planId: 'plan-1', goalId: 'goal-1' }),
          row('paused', { planId: 'plan-1', goalId: 'goal-1' }),
          row('planning', { planId: 'plan-1', goalId: 'goal-1' }),
          row('completed', { planId: 'plan-1', goalId: 'goal-1' }),
        ],
      }),
    );
    const summaries = await new PostgresRuntimeTaskSummaryQuery({ query } as unknown as Pool).list({
      limit: 10,
    });

    expect(summaries.map((item) => item.controlledActions)).toEqual([
      { pause: true, resume: false, cancel: true, goalPatch: true },
      { pause: false, resume: true, cancel: true, goalPatch: true },
      { pause: false, resume: false, cancel: true, goalPatch: true },
      { pause: false, resume: false, cancel: false, goalPatch: false },
    ]);
  });

  it('reads a Task summary and its header revision from one PostgreSQL snapshot', async () => {
    const query = vi.fn(() =>
      Promise.resolve({ rows: [row('executing', { planId: 'plan-1', goalId: 'goal-1' })] }),
    );
    const projection = await new PostgresRuntimeTaskSummaryQuery({
      query,
    } as unknown as Pool).getWithRevision('task-summary');

    expect(query).toHaveBeenCalledTimes(1);
    expect(projection).toMatchObject({
      revision: 7,
      summary: {
        taskId: 'task-summary',
        controlledActions: { pause: true, resume: false, cancel: true, goalPatch: true },
      },
    });
  });
});

function row(phase: string, bindings: Readonly<{ planId?: string; goalId?: string }> = {}) {
  return {
    task_id: 'task-summary',
    goal_id: bindings.goalId ?? null,
    plan_id: bindings.planId ?? null,
    context_id: 'context-summary',
    phase,
    selected_skill_id: null,
    binding_id: null,
    created_at: new Date('2026-08-14T01:00:00.000Z'),
    updated_at: new Date('2026-08-14T01:00:01.000Z'),
    revision: '7',
  };
}
