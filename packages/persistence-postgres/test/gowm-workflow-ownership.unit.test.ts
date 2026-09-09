import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { WorkflowPlanAttempt, WorkflowPlanRecord } from '../../domain/src/workflow.js';
import {
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowPlanRepository,
} from '../src/repositories.js';

const scope = { allowedDeviceIds: ['a'], sdarServiceKey: 'sdar', includeNonDevice: false };
const goalContract = {
  goalId: 'goal',
  version: 1,
  title: 'read',
  description: 'read',
  constraints: [],
  successCriteria: ['read'],
};
const attempt: WorkflowPlanAttempt = {
  planId: 'plan',
  executionTaskId: 'task',
  goalContract,
  attempt: 1,
  candidate: {},
  validationErrors: [],
  valid: false,
  createdAt: '2026-09-08T00:00:00Z',
};

function database(failAttempt = false, finalized = false) {
  const query = vi.fn((sql: string, parameters?: readonly unknown[]) => {
    void parameters;
    if (sql.startsWith('SELECT device_id FROM agent_task'))
      return Promise.resolve({ rows: [{ device_id: 'a' }], rowCount: 1 });
    if (sql.includes('INSERT INTO workflow_plan_attempt') && failAttempt)
      return Promise.reject(new Error('attempt-write-failed'));
    if (sql.includes('INSERT INTO workflow_plan') && sql.includes('DO UPDATE SET') && finalized)
      return Promise.resolve({ rows: [], rowCount: 0 });
    if (sql.includes('SELECT workflow_plan.device_id'))
      return Promise.resolve({ rows: [{ device_id: 'a' }], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { query, release, pool: { connect, query } as unknown as Pool };
}

describe('GOWM Workflow ownership and creation order', () => {
  it('commits the unexecuted root before its attempt on the same transaction client', async () => {
    const db = database();
    await new PostgresWorkflowPlanRepository(db.pool, undefined, scope).saveAttempt(attempt);
    const statements = db.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe('BEGIN');
    const root = statements.findIndex((sql) => sql.includes('INSERT INTO workflow_plan('));
    const child = statements.findIndex((sql) => sql.includes('INSERT INTO workflow_plan_attempt'));
    expect(root).toBeGreaterThan(0);
    expect(child).toBeGreaterThan(root);
    expect(db.query.mock.calls[root]?.[1]?.slice(-2)).toEqual(['a', 'task']);
    expect(db.query.mock.calls[child]?.[1]?.at(-1)).toBe('a');
    expect(statements.at(-1)).toBe('COMMIT');
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rolls the root back when the attempt cannot be saved', async () => {
    const db = database(true);
    await expect(
      new PostgresWorkflowPlanRepository(db.pool, undefined, scope).saveAttempt(attempt),
    ).rejects.toThrow('attempt-write-failed');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(db.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(db.release).toHaveBeenCalledOnce();
  });

  it('rejects overwriting a finalized root instead of silently succeeding', async () => {
    const db = database(false, true);
    const plan: WorkflowPlanRecord = {
      planId: 'plan',
      executionTaskId: 'task',
      goalId: 'goal',
      goalVersion: 1,
      goalContract,
      confirmationStatus: 'failed',
      attemptCount: 1,
      createdAt: attempt.createdAt,
    };
    await expect(
      new PostgresWorkflowPlanRepository(db.pool, undefined, scope).savePlan(plan),
    ).rejects.toThrow('WORKFLOW_PLANNING_ROOT_CONFLICT');
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('derives event ownership from its instance and preserves the native sequence', async () => {
    const db = database();
    await new PostgresWorkflowExecutionRepository(db.pool, undefined, scope).saveNodeEvents([
      {
        eventId: 'event',
        instanceId: 'instance',
        sequence: 3,
        nodeId: 'same-node',
        eventType: 'node_started',
        timestamp: attempt.createdAt,
        summary: 'started',
      },
    ]);
    const insert = db.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO workflow_node_event'),
    );
    expect(insert?.[1]).toEqual([
      'event',
      'instance',
      3,
      'same-node',
      'node_started',
      attempt.createdAt,
      null,
      'started',
      'a',
    ]);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
});
