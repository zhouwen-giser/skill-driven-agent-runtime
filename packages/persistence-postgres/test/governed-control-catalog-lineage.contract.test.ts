import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const upPath = new URL(
  '../../../infra/postgres/migrations/0164_v14_governed_control_catalog_lineage.up.sql',
  import.meta.url,
);
const downPath = new URL(
  '../../../infra/postgres/migrations/0164_v14_governed_control_catalog_lineage.down.sql',
  import.meta.url,
);

describe('governed control Catalog lineage migration', () => {
  it('detaches immutable confirmations from mutable Tool rows without deleting lineage', async () => {
    const sql = await readFile(upPath, 'utf8');

    expect(sql).toContain('DROP CONSTRAINT governed_control_confirmation_tool_fk');
    expect(sql).not.toMatch(/CASCADE|DELETE FROM governed_control_confirmation/u);
    expect(sql).toContain("VALUES ('0164_v14_governed_control_catalog_lineage')");
  });

  it('refuses rollback after a Catalog refresh removed historical Tool lineage', async () => {
    const sql = await readFile(downPath, 'utf8');

    expect(sql).toContain('LEFT JOIN mcp_tool AS tool');
    expect(sql).toContain('0164 rollback refused');
    expect(sql).toContain('ADD CONSTRAINT governed_control_confirmation_tool_fk');
    expect(sql).toContain("version = '0164_v14_governed_control_catalog_lineage'");
  });
});
