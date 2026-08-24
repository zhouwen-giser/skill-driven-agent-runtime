import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0173_remote_task_accepted_substate.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0173_remote_task_accepted_substate.down.sql',
  import.meta.url,
);

describe('0173 remote Task accepted substate migration', () => {
  it('admits accepted while preserving the complete bounded provider substate set', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('DROP CONSTRAINT remote_task_binding_provider_substate_check');
    expect(sql).toContain(
      "'accepted','scheduled','queued','running','paused','resuming','stopping'",
    );
    expect(sql).toContain("VALUES ('0173_remote_task_accepted_substate')");
  });

  it('restores the prior constraint on rollback', async () => {
    const sql = await readFile(down, 'utf8');

    expect(sql).not.toContain("'accepted','scheduled'");
    expect(sql).toContain("'scheduled','queued','running','paused','resuming','stopping'");
    expect(sql).toContain(
      "DELETE FROM schema_migration WHERE version='0173_remote_task_accepted_substate'",
    );
  });
});
