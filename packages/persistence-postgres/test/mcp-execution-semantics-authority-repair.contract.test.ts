import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../infra/postgres/migrations/0152_v14_mcp_execution_semantics_authority_repair.up.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../../../infra/postgres/migrations/0152_v14_mcp_execution_semantics_authority_repair.down.sql',
  import.meta.url,
);

describe('MCP execution-semantics authority repair migration', () => {
  it('reconstructs only explicit authority provenance and prevents another lossy refresh', async () => {
    const migration = compact(await readFile(migrationUrl, 'utf8'));

    expect(migration).toContain('LOCK TABLE mcp_tool IN SHARE ROW EXCLUSIVE MODE');
    expect(migration).toContain(
      "SET declared_execution_semantics_json = execution_semantics_json WHERE declared_execution_semantics_json IS NULL AND execution_semantics_json->>'source' = 'mcp_declared'",
    );
    expect(migration).toContain(
      "SET admin_execution_semantics_override_json = execution_semantics_json WHERE declared_execution_semantics_json IS NULL AND admin_execution_semantics_override_json IS NULL AND execution_semantics_json->>'source' = 'admin_override'",
    );
    expect(migration).toContain(
      'ADD CONSTRAINT mcp_tool_execution_semantics_authority_check CHECK',
    );
    expect(migration).toContain(
      "WHEN 'mcp_declared' THEN declared_execution_semantics_json IS NOT NULL AND declared_execution_semantics_json = execution_semantics_json",
    );
    expect(migration).toContain(
      "WHEN 'admin_override' THEN declared_execution_semantics_json IS NULL AND admin_execution_semantics_override_json IS NOT NULL AND admin_execution_semantics_override_json = execution_semantics_json",
    );
    expect(migration).toContain(
      "WHEN 'default_unknown' THEN declared_execution_semantics_json IS NULL AND admin_execution_semantics_override_json IS NULL",
    );
    expect(migration).toContain("VALUES ('0152_v14_mcp_execution_semantics_authority_repair')");
  });

  it('removes the schema constraint without deleting repaired provenance', async () => {
    const rollback = compact(await readFile(rollbackUrl, 'utf8'));

    expect(rollback).toContain(
      'ALTER TABLE mcp_tool DROP CONSTRAINT mcp_tool_execution_semantics_authority_check',
    );
    expect(rollback).toContain(
      "WHERE version = '0152_v14_mcp_execution_semantics_authority_repair'",
    );
    expect(rollback).not.toContain('UPDATE mcp_tool');
  });
});

function compact(source: string): string {
  return source.replace(/\s+/gu, ' ').replace(/ ?; ?/gu, '').trim();
}
