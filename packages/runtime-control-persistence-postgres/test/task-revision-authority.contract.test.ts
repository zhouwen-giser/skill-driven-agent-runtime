import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationRoot = new URL('../../../infra/postgres/migrations/', import.meta.url);

describe('Runtime Task revision authority migration', () => {
  it('adds a durable per-Task command fence, exact lease proof, and effect ledger', async () => {
    const migration = await readFile(
      new URL('0162_v14_agent_task_revision_authority.up.sql', migrationRoot),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS active_command_token uuid');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS command_operation text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS command_idempotency_key text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS command_claimed_at timestamptz');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS command_execution_phase text');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS runtime_task_command_effect');
    expect(migration).toContain('BEFORE INSERT OR UPDATE ON agent_task');
    expect(migration).not.toContain('pg_advisory');
    expect(migration).toContain('sdar.runtime_task_command_task_id');
    expect(migration).toContain('sdar.runtime_task_command_token');
    expect(migration).toContain('setting_expected_revision bigint');
    expect(migration).toContain("action.subject_id='runtime-task-control:' || setting_task_id");
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain("RAISE EXCEPTION 'AGENT_TASK_COMMAND_INSERT_FORBIDDEN'");
    expect(migration).toContain("RAISE EXCEPTION 'AGENT_TASK_COMMAND_FENCED'");
    expect(migration).toContain("RAISE EXCEPTION 'AGENT_TASK_COMMAND_STALE_WRITER'");
    expect(migration).toContain("command_execution_phase IN ('claimed','dispatch_started')");
    expect(migration).toContain('ALTER COLUMN expected_version TYPE bigint');
    expect(migration).toContain("VALUES ('0162_v14_agent_task_revision_authority')");
  });

  it('refuses rollback after authoritative Task revision evidence exists', async () => {
    const rollback = await readFile(
      new URL('0162_v14_agent_task_revision_authority.down.sql', migrationRoot),
      'utf8',
    );

    expect(rollback).toContain('SELECT 1 FROM runtime_task_command_effect');
    expect(rollback).toContain('WHERE expected_version > 2147483647');
    expect(rollback).toContain('WHERE revision <> 0 OR active_command_token IS NOT NULL');
    expect(rollback).toContain('0162 rollback refused');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS enforce_agent_task_revision_authority()');
    expect(rollback).toContain('DROP COLUMN IF EXISTS active_command_token');
    expect(rollback).toContain('ALTER COLUMN expected_version TYPE integer');
    expect(rollback).toContain("WHERE version = '0162_v14_agent_task_revision_authority'");
  });
});
