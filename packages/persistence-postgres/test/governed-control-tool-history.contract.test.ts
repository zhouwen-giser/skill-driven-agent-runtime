import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0164_v14_governed_control_tool_history.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0164_v14_governed_control_tool_history.down.sql',
  import.meta.url,
);
const admissionUp = new URL(
  '../../../infra/postgres/migrations/0165_v14_remote_admission_tool_history.up.sql',
  import.meta.url,
);
const admissionDown = new URL(
  '../../../infra/postgres/migrations/0165_v14_remote_admission_tool_history.down.sql',
  import.meta.url,
);

describe('governed control tool history migration', () => {
  it('decouples immutable confirmation evidence from mutable current catalog rows', async () => {
    const sql = await readFile(up, 'utf8');
    expect(sql).toContain('DROP CONSTRAINT governed_control_confirmation_tool_fk');
    expect(sql).toContain("VALUES ('0164_v14_governed_control_tool_history')");
  });

  it('restores the old FK only when every historical identity is still current', async () => {
    const sql = await readFile(down, 'utf8');
    expect(sql).toContain('GOVERNED_CONTROL_TOOL_HISTORY_ROLLBACK_REQUIRES_RECONCILIATION');
    expect(sql).toContain("ERRCODE='55000'");
    expect(sql.indexOf('IF EXISTS')).toBeLessThan(sql.indexOf('ADD CONSTRAINT'));
    expect(sql).toContain('REFERENCES mcp_tool(server_id,tool_name) ON DELETE RESTRICT');
  });

  it('applies the same historical boundary to immutable remote admission evidence', async () => {
    const [upSql, downSql] = await Promise.all([
      readFile(admissionUp, 'utf8'),
      readFile(admissionDown, 'utf8'),
    ]);
    expect(upSql).toContain('DROP CONSTRAINT remote_task_admission_tool_fk');
    expect(upSql).toContain("VALUES ('0165_v14_remote_admission_tool_history')");
    expect(downSql).toContain('REMOTE_ADMISSION_TOOL_HISTORY_ROLLBACK_REQUIRES_RECONCILIATION');
    expect(downSql).toContain('FOREIGN KEY(server_id,operation_name)');
  });
});
