import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../infra/postgres/migrations/0130_v13_artifact_shadow_governance.up.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../../../infra/postgres/migrations/0130_v13_artifact_shadow_governance.down.sql',
  import.meta.url,
);
const repositoryUrl = new URL(
  '../src/compiler/artifact-shadow-governance-repository.ts',
  import.meta.url,
);
const applicationUrl = new URL(
  '../../application/src/compiler/artifact-shadow-runtime.ts',
  import.meta.url,
);
const serverRuntimeUrl = new URL('../../../apps/server/src/runtime.ts', import.meta.url);

describe('P06 PostgreSQL Shadow and promotion governance contract', () => {
  it('keeps P02 core tables authoritative and makes Shadow a ValidationRun child projection', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    expect(migration).toContain('CREATE TABLE artifact_shadow_run');
    expect(migration).toContain('REFERENCES artifact_validation_run(validation_run_id)');
    expect(migration).not.toContain('CREATE TABLE artifact_active_pointer');
    expect(migration).not.toContain('CREATE TABLE artifact_approval (');
    expect(migration).toContain('ALTER TABLE artifact_approval');
  });

  it('persists all P06 child projections and preserves exact approval/package bindings', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    for (const table of [
      'artifact_shadow_run',
      'artifact_shadow_result',
      'artifact_promotion_policy',
      'artifact_promotion_package',
      'artifact_activation_record',
      'artifact_revalidation_trigger',
      'artifact_rollback_record',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(migration).toContain('promotion_package_hash');
    expect(migration).toContain('approval_hash');
    expect(migration).toContain('active_pointer_version');
  });

  it('uses PostgreSQL leases, stale terminalization, atomic pointer CAS and outbox events', async () => {
    const repository = await readFile(repositoryUrl, 'utf8');
    expect(repository).toContain("work_state='leased'");
    expect(repository).toContain('lease_owner=$2 AND lease_token=$3');
    expect(repository).toContain('ARTIFACT_SHADOW_TTL_EXPIRED');
    expect(repository).toContain('SELECT pg_advisory_xact_lock');
    expect(repository).toContain('ARTIFACT_CAS_CONFLICT');
    expect(repository).toContain("eventType: 'artifact.shadow_completed'");
    expect(repository).toContain("eventType: 'artifact.activated'");
    expect(repository).toContain("status='running',work_state='leased'");
    expect(repository).toContain("terminal ? 'dead_letter' : 'retry_wait'");
    expect(repository).toContain('artifact_promotion_assessment');
    expect(repository).toContain('async requestRevalidationAtomically');
    expect(repository).toContain("VALUES($1,$2,$3,'revalidation'");
  });

  it('derives promotion hashes from persisted P05/P06 evidence instead of caller summaries', async () => {
    const application = await readFile(applicationUrl, 'utf8');
    expect(application).toContain('await this.repository.listPromotionEvidence');
    expect(application).toContain('ARTIFACT_PROMOTION_EVIDENCE_HASH_MISMATCH');
    expect(application).toContain('ARTIFACT_PROMOTION_RISK_REVIEW_HASH_MISMATCH');
  });

  it('uses no retrieval, fast-gateway or external execution capability', async () => {
    const repository = await readFile(repositoryUrl, 'utf8');
    const application = await readFile(applicationUrl, 'utf8');
    expect(repository).not.toMatch(/fast.gateway|retriev|mcp_call|skill_execute|provider_task/iu);
    expect(application).toContain('ARTIFACT_SHADOW_SIDE_EFFECT_DENIED');
    expect(application).not.toMatch(/fast.gateway|retriev/iu);
  });

  it('exposes an explicit formal-runtime sidecar hook and reads current pins at worker start', async () => {
    const [application, runtime] = await Promise.all([
      readFile(applicationUrl, 'utf8'),
      readFile(serverRuntimeUrl, 'utf8'),
    ]);
    expect(application).toContain('ArtifactShadowCurrentStateReader');
    expect(application).toContain('await currentState.readEnrollmentCurrent(input)');
    expect(application).toContain('await currentState.readCurrent({ run, work })');
    expect(runtime).toContain('enrollArtifactShadow');
    expect(runtime).toContain('artifactShadowRuntime?.service.enroll(input)');
  });

  it('has a P06-only rollback that does not delete P02 Artifact authority', async () => {
    const rollback = await readFile(rollbackUrl, 'utf8');
    expect(rollback).toContain('DROP TABLE artifact_shadow_run');
    expect(rollback).toContain('DROP TABLE artifact_promotion_package');
    expect(rollback).not.toContain('DROP TABLE compiled_artifact');
    expect(rollback).not.toContain('DROP TABLE artifact_active_pointer');
    expect(rollback).not.toContain('DROP TABLE artifact_approval');
  });
});
