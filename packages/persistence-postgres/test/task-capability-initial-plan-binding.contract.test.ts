import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const upPath = new URL(
  '../../../infra/postgres/migrations/0167_v14_task_capability_initial_plan_binding.up.sql',
  import.meta.url,
);
const downPath = new URL(
  '../../../infra/postgres/migrations/0167_v14_task_capability_initial_plan_binding.down.sql',
  import.meta.url,
);

describe('Task Capability initial plan binding migration', () => {
  it('permits only the one-time prepared attempt plan binding', async () => {
    const sql = await readFile(upPath, 'utf8');

    expect(sql).toContain("OLD.status='prepared' AND NEW.status='prepared'");
    expect(sql).toContain('OLD.plan_id IS NULL AND NEW.plan_id IS NOT NULL');
    expect(sql).toContain('TASK_CAPABILITY_ATTEMPT_CONTENT_IMMUTABLE');
  });

  it('restores strict immutable attempt content on rollback', async () => {
    const sql = await readFile(downPath, 'utf8');

    expect(sql).toContain('NEW.plan_id IS DISTINCT FROM OLD.plan_id');
    expect(sql).toContain("version='0167_v14_task_capability_initial_plan_binding'");
  });
});
