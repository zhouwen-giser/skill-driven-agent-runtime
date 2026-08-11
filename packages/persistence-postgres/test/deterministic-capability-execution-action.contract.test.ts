import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationRoot = new URL('../../../infra/postgres/migrations/', import.meta.url);
const repositoryRoot = new URL('../src/', import.meta.url);

describe('deterministic Capability execution cognitive action migration', () => {
  it('adds the durable operation without replacing the cognitive action authority', async () => {
    const migration = await readFile(
      new URL('0149_v14_deterministic_capability_execution_action.up.sql', migrationRoot),
      'utf8',
    );

    expect(migration).toContain('ALTER TABLE cognitive_management_action');
    expect(migration).toContain("'deterministic_capability_execution'");
    expect(migration).toContain("VALUES ('0149_v14_deterministic_capability_execution_action')");
    expect(migration).not.toMatch(/CREATE\s+TABLE\s+cognitive_management_action/iu);
  });

  it('refuses rollback while deterministic execution evidence exists', async () => {
    const rollback = await readFile(
      new URL('0149_v14_deterministic_capability_execution_action.down.sql', migrationRoot),
      'utf8',
    );

    expect(rollback).toContain("WHERE operation = 'deterministic_capability_execution'");
    expect(rollback).toContain('0149 rollback refused');
    expect(rollback).toContain(
      "WHERE version = '0149_v14_deterministic_capability_execution_action'",
    );
  });

  it('adds durable owner, expiry, attempt, and token fencing with legacy recovery', async () => {
    const migration = await readFile(
      new URL('0150_v14_cognitive_management_action_lease_recovery.up.sql', migrationRoot),
      'utf8',
    );

    expect(migration).toContain('ADD COLUMN lease_owner text');
    expect(migration).toContain('ADD COLUMN lease_expires_at timestamptz');
    expect(migration).toContain('ADD COLUMN lease_attempt integer NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN lease_token text');
    expect(migration).toContain('ADD COLUMN execution_phase text');
    expect(migration).toContain('ADD COLUMN provider_dispatch_id text');
    expect(migration).toContain('ADD COLUMN provider_dispatch_hash text');
    expect(migration).toContain(
      "execution_phase IN ('claimed', 'execution_started', 'provider_dispatch')",
    );
    expect(migration).toContain("execution_phase = 'terminal'");
    expect(migration).toContain("provider_dispatch_hash ~ '^sha256:[0-9a-f]{64}$'");
    expect(migration).toContain("WHERE status = 'pending'");
    expect(migration).toContain("lease_owner = 'legacy-pre-0150'");
    expect(migration).toContain('cognitive_management_action_lease_state_check');
    expect(migration).toContain("VALUES ('0150_v14_cognitive_management_action_lease_recovery')");
  });

  it('refuses lease rollback while a pending owner could still commit', async () => {
    const rollback = await readFile(
      new URL('0150_v14_cognitive_management_action_lease_recovery.down.sql', migrationRoot),
      'utf8',
    );

    expect(rollback).toContain("WHERE status = 'pending'");
    expect(rollback).toContain('0150 rollback refused');
    expect(rollback).toContain('DROP CONSTRAINT cognitive_management_action_lease_state_check');
    expect(rollback).toContain('DROP COLUMN execution_phase');
    expect(rollback).toContain('DROP COLUMN provider_dispatch_hash');
    expect(rollback).toContain('DROP COLUMN provider_dispatch_id');
    expect(rollback).toContain('DROP COLUMN lease_token');
    expect(rollback).toContain(
      "WHERE version = '0150_v14_cognitive_management_action_lease_recovery'",
    );
  });

  it('keeps canonical leased and atomic terminal audit writers inside the 0150 state contract', async () => {
    const [canonicalWriter, atomicWriter] = await Promise.all([
      readFile(
        new URL('cognitive/cognitive-management-action-repository.ts', repositoryRoot),
        'utf8',
      ),
      readFile(new URL('compiler/artifact-repositories.ts', repositoryRoot), 'utf8'),
    ]);

    expect(canonicalWriter).toContain(
      'lease_owner,lease_expires_at,lease_attempt,lease_token,execution_phase',
    );
    expect(canonicalWriter).toContain("1,$12,'claimed'");
    expect(canonicalWriter).toContain("SET execution_phase='execution_started'");
    expect(canonicalWriter).toContain("execution_phase='provider_dispatch'");
    expect(canonicalWriter).toContain("lease_token=NULL,execution_phase='terminal'");

    expect(atomicWriter).toContain('request_hash,status,result,claimed_at,completed_at,updated_at');
    expect(atomicWriter).toContain("'completed',$9::jsonb,$8,$8,$8");
    expect(atomicWriter).toContain("NULL,NULL,0,NULL,'terminal',NULL,NULL");
    expect(atomicWriter).toContain('This terminal audit row remains provisional');
    expect(atomicWriter).not.toContain('completeActivationAudit');
  });
});
