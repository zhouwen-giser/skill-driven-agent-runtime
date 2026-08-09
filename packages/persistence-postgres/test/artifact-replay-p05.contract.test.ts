import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../infra/postgres/migrations/0129_v13_artifact_replay_validation.up.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../../../infra/postgres/migrations/0129_v13_artifact_replay_validation.down.sql',
  import.meta.url,
);
const repositoryUrl = new URL(
  '../src/compiler/artifact-replay-validation-repository.ts',
  import.meta.url,
);

describe('P05 PostgreSQL replay-validation contract', () => {
  it('extends the canonical P02 ValidationRun instead of creating a second authority', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('ALTER TABLE artifact_validation_run');
    expect(migration).not.toMatch(/CREATE TABLE artifact_validation_run/u);
    expect(migration).toContain('artifact_validation_run_replay_pin_check');
    expect(migration).toContain('dataset_version IS NULL OR');
    expect(migration).toContain('idempotency_key IS NOT NULL');
  });

  it('persists immutable cases, datasets, case results, failures and counterexamples', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    for (const table of [
      'artifact_replay_case',
      'replay_dataset_manifest',
      'replay_dataset_case',
      'artifact_replay_case_result',
      'artifact_validation_failure',
      'artifact_counterexample',
      'artifact_replay_tenant_deletion',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration).toContain('sdar_reject_artifact_replay_content_mutation');
    expect(migration).toContain('sdar_invalidate_replay_datasets_for_case');
    expect(migration).toContain('sdar_guard_terminal_artifact_validation_run_mutation');
    expect(migration).toContain('promotion_eligible');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('retention_until');
  });

  it('keeps queue state as wake-only and PostgreSQL as lease/fencing authority', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    const repository = await readFile(repositoryUrl, 'utf8');
    expect(migration).toContain(
      "'pending','leased','retry_wait','completed','dead_letter','canceled'",
    );
    expect(migration).toContain('lease_token');
    expect(repository).toContain("work_state='leased'");
    expect(repository).toContain('lease_owner=$2 AND lease_token=$3');
    expect(repository).toContain('ARTIFACT_REPLAY_VALIDATION_STALE_PIN');
    expect(repository).toContain('artifact.content_hash');
    expect(repository).toContain('dataset.content_hash');
  });

  it('emits only validation completion and never mutates Candidate lifecycle state', async () => {
    const repository = await readFile(repositoryUrl, 'utf8');
    expect(repository).toContain('artifact.validation_completed');
    expect(repository).not.toContain('artifact.promotion_ready');
    expect(repository).not.toContain("SET status='awaiting_approval'");
    expect(repository).not.toContain("SET status='active'");
    expect(repository).not.toContain('artifact_active_pointer');
  });

  it('persists the domain-validated replay safety proof inside result_payload', async () => {
    const repository = await readFile(repositoryUrl, 'utf8');
    expect(repository).toContain(
      'const result = createArtifactValidationResult(completion.validationResult)',
    );
    expect(repository).toContain('result_payload=$10::jsonb');
    expect(repository).toContain('JSON.stringify(result)');
  });

  it('provides a symmetric P05-only rollback', async () => {
    const rollback = await readFile(rollbackUrl, 'utf8');
    expect(rollback).toContain(
      'DROP CONSTRAINT IF EXISTS artifact_validation_run_replay_dataset_fk',
    );
    expect(rollback).toContain('DROP TABLE IF EXISTS artifact_replay_case');
    expect(rollback).toContain("WHERE version='0129_v13_artifact_replay_validation'");
    expect(rollback).not.toContain('DROP TABLE IF EXISTS compiled_artifact');
    expect(rollback).not.toContain('DROP TABLE IF EXISTS candidate_generation_run');
  });
});
