import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0158_v14_governed_control_dispatch_consumption.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0158_v14_governed_control_dispatch_consumption.down.sql',
  import.meta.url,
);

describe('0158 governed control dispatch consumption migration', () => {
  it('binds one confirmation to an exact attempt, Tool, arguments and invocation dispatch', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('capability_attempt_id text NOT NULL');
    expect(sql).toContain('provider_binding_id text NOT NULL');
    expect(sql).toContain('arguments_hash char(64) NOT NULL');
    expect(sql).toContain('UNIQUE(consumed_invocation_id)');
    expect(sql).toContain('arguments_hash,consumed_invocation_id,consumed_dispatch_hash');
    expect(sql).toContain('control_provider_binding_id text');
    expect(sql).toContain('control_arguments_hash char(64)');
    expect(sql).toContain('mcp_invocation_control_authority_fk');
    expect(sql).toContain('REFERENCES governed_control_confirmation');
    expect(sql).toContain('GOVERNED_CONTROL_CONFIRMATION_SCOPE_MIGRATION_REQUIRES_REISSUE');
  });

  it('has an explicit rollback to the pre-consumption confirmation shape', async () => {
    const sql = await readFile(down, 'utf8');

    expect(sql).toContain('DROP CONSTRAINT mcp_invocation_control_authority_fk');
    expect(sql).toContain('DROP COLUMN consumed_invocation_id');
    expect(sql).toContain("WHERE version='0158_v14_governed_control_dispatch_consumption'");
  });
});
