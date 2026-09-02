import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const upUrl = new URL(
  '../../../infra/postgres/migrations/0175_v14_mcp_task_consumer_sync.up.sql',
  import.meta.url,
);
const downUrl = new URL(
  '../../../infra/postgres/migrations/0175_v14_mcp_task_consumer_sync.down.sql',
  import.meta.url,
);

describe('0175 MCP Task consumer sync migration', () => {
  it('adds restart-stable logical identity, append-only attempts, and a companion relation', async () => {
    const sql = await readFile(upUrl, 'utf8');

    expect(sql).toContain('logical_invocation_id text UNIQUE');
    expect(sql).toContain('reconciliation_contract_json jsonb');
    expect(sql).toContain('CREATE TABLE remote_task_reconciliation_attempt');
    expect(sql).toContain('expected_intent_version integer NOT NULL');
    expect(sql).toContain("source_contract='sdar.smpp-diagnostics/v1+frozen-mcp-v1'");
    expect(sql).toContain(
      "status IN ('found_exact','not_found','conflict','unavailable','deferred')",
    );
    expect(sql).toContain('CREATE TABLE remote_task_provider_execution_link');
    expect(sql).toContain('binding_id text NOT NULL UNIQUE');
    expect(sql).toContain('logical_invocation_id text NOT NULL UNIQUE');
    expect(sql).toContain('remote_task_id text NOT NULL');
    expect(sql).toContain('UNIQUE(runtime_server_id,remote_task_id)');
    expect(sql).toContain('provider_origin_type');
    expect(sql).toContain('source_revision text NOT NULL');
    expect(sql).toContain('remote_task_reconciliation_attempt_immutable');
    expect(sql).toContain('remote_task_provider_execution_link_immutable');
    expect(sql).toContain("VALUES('0175_v14_mcp_task_consumer_sync')");
  });

  it('refuses rollback while any new authority record remains', async () => {
    const sql = await readFile(downUrl, 'utf8');

    expect(sql).toContain('REMOTE_TASK_CONSUMER_SYNC_ROLLBACK_REQUIRES_EMPTY_STATE');
    expect(sql).toContain('remote_task_reconciliation_attempt');
    expect(sql).toContain('remote_task_provider_execution_link');
    expect(sql).toContain("WHERE version='0175_v14_mcp_task_consumer_sync'");
  });
});
