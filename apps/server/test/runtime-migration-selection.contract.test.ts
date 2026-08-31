import { readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { planPostV122MigrationFiles } from '../src/runtime.js';

const baselineVersion = 'v1.2.2_clean_slate_baseline';
const migrationDirectory = new URL('../../../infra/postgres/migrations/', import.meta.url);

describe('post-v1.2.2 Runtime migration selection', () => {
  it('selects MCP Task consumer sync migration 0175 after Evidence migration 0174', async () => {
    const plan = planPostV122MigrationFiles(await readdir(migrationDirectory), [baselineVersion]);

    expect(plan.slice(-4)).toEqual([
      '0172_v14_initial_task_admission.up.sql',
      '0173_remote_task_accepted_substate.up.sql',
      '0174_v14_evidence_delivery_origin.up.sql',
      '0175_v14_mcp_task_consumer_sync.up.sql',
    ]);
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
