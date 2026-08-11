import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../infra/postgres/migrations/0151_v14_capability_attempt_evidence_lineage.up.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../../../infra/postgres/migrations/0151_v14_capability_attempt_evidence_lineage.down.sql',
  import.meta.url,
);

describe('Capability attempt evidence-lineage migration contract', () => {
  it('binds MCP evidence and terminal outcomes to the same Task/Capability-attempt identity', async () => {
    const migration = compact(await readFile(migrationUrl, 'utf8'));

    expect(migration).toContain(
      "WHERE attempt.status IN ('prepared','running','waiting') AND attempt.attempt_no=( SELECT MAX(latest.attempt_no) FROM task_capability_execution_attempt AS latest WHERE latest.task_id=attempt.task_id )",
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'CAPABILITY_ATTEMPT_LINEAGE_MIGRATION_REQUIRES_RECONCILIATION' USING ERRCODE='55000'",
    );
    expect(migration).toContain(
      'ALTER TABLE task_capability_execution_attempt ADD CONSTRAINT task_capability_attempt_identity_unique UNIQUE(attempt_id,task_id)',
    );
    expect(migration.match(/ADD COLUMN capability_attempt_id text/gu)).toHaveLength(2);
    expect(migration).toContain(
      'ADD CONSTRAINT mcp_invocation_capability_attempt_task_check CHECK ( capability_attempt_id IS NULL OR task_id IS NOT NULL )',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT mcp_invocation_capability_attempt_fk FOREIGN KEY(capability_attempt_id,task_id) REFERENCES task_capability_execution_attempt(attempt_id,task_id) ON DELETE RESTRICT',
    );
    expect(migration).toContain(
      'CREATE INDEX mcp_invocation_capability_attempt_idx ON mcp_invocation(capability_attempt_id,started_at,invocation_id) WHERE capability_attempt_id IS NOT NULL',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT runtime_terminal_outcome_capability_attempt_task_check CHECK ( capability_attempt_id IS NULL OR task_id IS NOT NULL )',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT runtime_terminal_outcome_capability_attempt_fk FOREIGN KEY(capability_attempt_id,task_id) REFERENCES task_capability_execution_attempt(attempt_id,task_id) ON DELETE RESTRICT',
    );
    expect(migration).toContain(
      "INSERT INTO schema_migration(version) VALUES('0151_v14_capability_attempt_evidence_lineage')",
    );
  });

  it('rolls back every lineage column, constraint, index, and migration marker', async () => {
    const rollback = compact(await readFile(rollbackUrl, 'utf8'));

    expect(rollback).toContain(
      'ALTER TABLE runtime_terminal_outcome DROP CONSTRAINT runtime_terminal_outcome_capability_attempt_fk, DROP CONSTRAINT runtime_terminal_outcome_capability_attempt_task_check, DROP COLUMN capability_attempt_id',
    );
    expect(rollback).toContain('DROP INDEX mcp_invocation_capability_attempt_idx');
    expect(rollback).toContain(
      'ALTER TABLE mcp_invocation DROP CONSTRAINT mcp_invocation_capability_attempt_fk, DROP CONSTRAINT mcp_invocation_capability_attempt_task_check, DROP COLUMN capability_attempt_id',
    );
    expect(rollback).toContain(
      'ALTER TABLE task_capability_execution_attempt DROP CONSTRAINT task_capability_attempt_identity_unique',
    );
    expect(rollback).toContain(
      "DELETE FROM schema_migration WHERE version = '0151_v14_capability_attempt_evidence_lineage'",
    );
  });
});

function compact(source: string): string {
  return source.replace(/\s+/gu, ' ').replace(/ ?; ?/gu, '').trim();
}
