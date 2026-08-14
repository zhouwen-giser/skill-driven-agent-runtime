import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationRoot = new URL('../../../infra/postgres/migrations/', import.meta.url);

describe('Runtime Task control cognitive action migration', () => {
  it('adds all four durable Task command operations without replacing the action authority', async () => {
    const migration = await readFile(
      new URL('0156_v14_runtime_task_control_actions.up.sql', migrationRoot),
      'utf8',
    );

    expect(migration).toContain('ALTER TABLE cognitive_management_action');
    for (const operation of ['task_pause', 'task_resume', 'task_cancel', 'task_goal_patch'])
      expect(migration).toContain(`'${operation}'`);
    expect(migration).toContain("VALUES ('0156_v14_runtime_task_control_actions')");
    expect(migration).not.toMatch(/CREATE\s+TABLE\s+cognitive_management_action/iu);
  });

  it('refuses rollback while any durable Task command evidence exists', async () => {
    const rollback = await readFile(
      new URL('0156_v14_runtime_task_control_actions.down.sql', migrationRoot),
      'utf8',
    );

    expect(rollback).toContain(
      "WHERE operation IN ('task_pause','task_resume','task_cancel','task_goal_patch')",
    );
    expect(rollback).toContain('0156 rollback refused');
    expect(rollback).toContain("WHERE version = '0156_v14_runtime_task_control_actions'");
  });
});
