import { readdir, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { planPostV122MigrationFiles } from '../src/runtime.js';

const baselineVersion = 'v1.2.2_clean_slate_baseline';
const migrationDirectory = new URL('../../../infra/postgres/migrations/', import.meta.url);

describe('post-v1.2.2 Runtime migration selection', () => {
  it('selects accepted-substate, binding-authority and live qualification migrations after 0172', async () => {
    const plan = planPostV122MigrationFiles(await readdir(migrationDirectory), [baselineVersion]);

    expect(plan.slice(-4)).toEqual([
      '0172_v14_initial_task_admission.up.sql',
      '0173_remote_task_accepted_substate.up.sql',
      '0174_runtime_provider_binding_authority.up.sql',
      '0175_ugv_live_qualification.up.sql',
    ]);
  });

  it('records and removes the LIVE qualification version in its migration pair', async () => {
    const version = '0175_ugv_live_qualification';
    const [up, down] = await Promise.all([
      readFile(new URL(`${version}.up.sql`, migrationDirectory), 'utf8'),
      readFile(new URL(`${version}.down.sql`, migrationDirectory), 'utf8'),
    ]);
    expect(up).toContain(`INSERT INTO schema_migration(version) VALUES ('${version}')`);
    expect(down).toContain(`DELETE FROM schema_migration WHERE version='${version}'`);
  });

  it('reconciles clean-baseline remote input and preserves same-revision observation history', async () => {
    const version = '0174_runtime_provider_binding_authority';
    const [up, down] = await Promise.all([
      readFile(new URL(`${version}.up.sql`, migrationDirectory), 'utf8'),
      readFile(new URL(`${version}.down.sql`, migrationDirectory), 'utf8'),
    ]);
    expect(up).toContain(
      "CHECK (source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow','remote_task'))",
    );
    expect(up).toMatch(
      /DROP INDEX remote_task_observation_frozen_revision_idx;\s*CREATE INDEX remote_task_observation_frozen_revision_idx\s+ON remote_task_observation\(binding_id,runtime_revision\) WHERE runtime_revision IS NOT NULL;/u,
    );
    expect(up).toMatch(
      /CREATE UNIQUE INDEX remote_task_observation_provider_event_idx\s+ON remote_task_observation\(binding_id,provider_event_id,runtime_revision\)\s+WHERE provider_event_id IS NOT NULL AND accepted;/u,
    );
    // Both restored constraints validate existing data inside one transaction;
    // incompatible evidence must fail rollback rather than be deleted or rewritten.
    expect(down.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(down).toContain(
      "CHECK (source IN ('goal_deliberation','skill_input_resolution','goal_evaluation','workflow'))",
    );
    expect(down).toMatch(
      /CREATE UNIQUE INDEX remote_task_observation_frozen_revision_idx\s+ON remote_task_observation\(binding_id,runtime_revision\) WHERE runtime_revision IS NOT NULL;/u,
    );
    expect(down).not.toMatch(
      /\b(?:DELETE FROM|UPDATE) (?:remote_task_observation|task_input_request)\b/u,
    );
  });

  it('does not select migrations already recorded in the complete ledger', async () => {
    const availableFiles = await readdir(migrationDirectory);
    const initialPlan = planPostV122MigrationFiles(availableFiles, [baselineVersion]);
    const completeLedger = [
      baselineVersion,
      ...initialPlan.map((file) => file.slice(0, -'.up.sql'.length)),
    ];

    expect(planPostV122MigrationFiles(availableFiles, completeLedger)).toEqual([]);
  });

  it('rejects an unknown migration version in the ledger', async () => {
    const availableFiles = await readdir(migrationDirectory);
    const initialPlan = planPostV122MigrationFiles(availableFiles, [baselineVersion]);
    const invalidLedger = [
      baselineVersion,
      ...initialPlan.map((file) => file.slice(0, -'.up.sql'.length)),
      '0174_unapproved_migration_name',
    ];

    expect(() => planPostV122MigrationFiles(availableFiles, invalidLedger)).toThrow(
      'SDAR_V123_MIGRATION_LEDGER_INVALID',
    );
  });
});
