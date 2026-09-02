import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const upPath = new URL(
  '../../../infra/postgres/migrations/0165_v14_remote_task_catalog_lineage.up.sql',
  import.meta.url,
);
const downPath = new URL(
  '../../../infra/postgres/migrations/0165_v14_remote_task_catalog_lineage.down.sql',
  import.meta.url,
);
const repairPath = new URL(
  '../../../infra/postgres/migrations/0166_v14_failed_remote_continuation_quarantine.up.sql',
  import.meta.url,
);
const terminalCallbackRepairPath = new URL(
  '../../../infra/postgres/migrations/0168_v14_failed_terminal_callback_quarantine.up.sql',
  import.meta.url,
);

describe('remote Task Catalog lineage migration', () => {
  it('retains active remote authority while detaching sealed admission history', async () => {
    const sql = await readFile(upPath, 'utf8');

    expect(sql).toContain('CREATE TRIGGER mcp_tool_active_remote_task_guard');
    expect(sql).toContain("intent.status IN ('prepared','dispatching','receipt_recorded')");
    expect(sql).toContain("binding.local_state NOT IN ('reentered','closed','quarantined')");
    expect(sql).toContain('DROP CONSTRAINT remote_task_admission_tool_fk');
    expect(sql).not.toMatch(/CASCADE|DELETE FROM remote_task_admission_intent/u);
  });

  it('only restores the historical FK when every admission still has Catalog lineage', async () => {
    const sql = await readFile(downPath, 'utf8');

    expect(sql).toContain('LEFT JOIN mcp_tool AS tool');
    expect(sql).toContain('0165 rollback refused');
    expect(sql).toContain('ADD CONSTRAINT remote_task_admission_tool_fk');
    expect(sql).toContain("version = '0165_v14_remote_task_catalog_lineage'");
  });

  it('quarantines only legacy terminal bindings with failed continuation evidence', async () => {
    const sql = await readFile(repairPath, 'utf8');

    expect(sql).toContain("control.status = 'failed'");
    expect(sql).toContain("attempt.status = 'failed'");
    expect(sql).toContain(
      "binding.local_state IN ('terminal_event_pending','terminal_event_claimed')",
    );
    expect(sql).toContain("SET local_state = 'quarantined'");
  });

  it('quarantines terminal callbacks that cannot recover after Workflow control failure', async () => {
    const sql = await readFile(terminalCallbackRepairPath, 'utf8');

    expect(sql).toContain("workflow.status='failed'");
    expect(sql).toContain("attempt.status='succeeded'");
    expect(sql).toContain("control.status IN ('pending','claimed')");
    expect(sql).toContain("SET local_state='quarantined'");
  });
});
