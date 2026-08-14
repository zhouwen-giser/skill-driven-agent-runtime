import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0161_v14_remote_task_cancellation_authority.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0161_v14_remote_task_cancellation_authority.down.sql',
  import.meta.url,
);

describe('0161 remote Task cancellation authority migration', () => {
  it('freezes one bounded cancellation profile on every binding', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('ADD COLUMN task_cancellation text');
    expect(sql).toContain(
      "task_cancellation IN ('unsupported','cooperative','task_cancel','unknown')",
    );
    expect(sql).toContain("SET task_cancellation='unknown'");
    expect(sql).toContain('ALTER COLUMN task_cancellation SET NOT NULL');
    expect(sql).not.toContain('task_cancellation IS NULL OR');
  });

  it('freezes receipt recovery authority without consulting a later catalog revision', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain("'{taskCancellation}'");
    expect(sql).toContain('\'"unknown"\'::jsonb');
    expect(sql).toContain('remote_task_admission_receipt_cancellation_authority_check');
    expect(sql).toContain("remote_receipt_json->>'taskCancellation' IN");
  });

  it('refuses rollback while frozen authority, active work, or cancellation evidence exists', async () => {
    const sql = await readFile(down, 'utf8');

    expect(sql).toContain('0161 rollback refused');
    expect(sql).toContain("task_cancellation <> 'unknown'");
    expect(sql).toContain("local_state NOT IN ('closed','reentered','quarantined')");
    expect(sql).toContain("remote_receipt_json->>'taskCancellation' <> 'unknown'");
    expect(sql).toContain('EXISTS (SELECT 1 FROM remote_task_cancel_request)');
    expect(sql).toContain('EXISTS (SELECT 1 FROM remote_task_cancel_attempt)');
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS remote_task_admission_receipt_cancellation_authority_check',
    );
    expect(sql).toContain("remote_receipt_json=remote_receipt_json - 'taskCancellation'");
    expect(sql).toContain('DROP COLUMN IF EXISTS task_cancellation');
  });
});
