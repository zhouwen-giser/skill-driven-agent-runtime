import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { MODEL_STAGES } from '../../domain/src/index.js';

const migrationUrl = new URL(
  '../../../infra/postgres/migrations/0153_v14_initial_model_prompts.up.sql',
  import.meta.url,
);
const rollbackUrl = new URL(
  '../../../infra/postgres/migrations/0153_v14_initial_model_prompts.down.sql',
  import.meta.url,
);
const repairUrl = new URL(
  '../../../infra/postgres/migrations/0154_v14_initial_model_prompt_pointer_repair.up.sql',
  import.meta.url,
);
const repairRollbackUrl = new URL(
  '../../../infra/postgres/migrations/0154_v14_initial_model_prompt_pointer_repair.down.sql',
  import.meta.url,
);
const seedRepairUrl = new URL(
  '../../../infra/postgres/migrations/0163_v14_initial_model_prompt_seed_repair.up.sql',
  import.meta.url,
);
const seedRepairRollbackUrl = new URL(
  '../../../infra/postgres/migrations/0163_v14_initial_model_prompt_seed_repair.down.sql',
  import.meta.url,
);

describe('initial Model Prompt migration contract', () => {
  it('persists one enabled database Prompt for every fixed Model stage without overwriting', async () => {
    const migration = await readFile(migrationUrl, 'utf8');
    for (const stage of MODEL_STAGES) {
      expect(migration).toContain(`'prompt.runtime-default.${stage}', '${stage}'`);
    }
    expect(migration).toContain("'{{instruction}}', 'enabled', 'admin'");
    expect(migration).toContain('ON CONFLICT DO NOTHING');
    expect(migration).toContain('CREATE TEMP TABLE initial_model_prompt_seeded ON COMMIT DROP');
    expect(migration).toContain('FROM initial_model_prompt_seeded AS seeded');
    expect(migration).toContain("VALUES ('0153_v14_initial_model_prompts')");
  });

  it('retains immutable Prompt lineage during rollback', async () => {
    const rollback = await readFile(rollbackUrl, 'utf8');
    expect(rollback).not.toContain('DELETE FROM prompt');
    expect(rollback).toContain('rollback deliberately retains them');
    expect(rollback).toContain("version = '0153_v14_initial_model_prompts'");
  });

  it('repairs only untouched initial Prompt pointers and retains them on rollback', async () => {
    const repair = await readFile(repairUrl, 'utf8');
    const rollback = await readFile(repairRollbackUrl, 'utf8');
    expect(repair).toContain('target.current_version IS NULL');
    expect(repair).toContain("version.content = '{{instruction}}'");
    for (const stage of MODEL_STAGES) {
      expect(repair).toContain(`'prompt.runtime-default.${stage}'`);
    }
    expect(repair).toContain("VALUES ('0154_v14_initial_model_prompt_pointer_repair')");
    expect(rollback).not.toContain('UPDATE prompt');
    expect(rollback).toContain("version = '0154_v14_initial_model_prompt_pointer_repair'");
  });

  it('repairs missing baseline Prompt rows without replacing stage ownership', async () => {
    const repair = await readFile(seedRepairUrl, 'utf8');
    const rollback = await readFile(seedRepairRollbackUrl, 'utf8');
    for (const stage of MODEL_STAGES) {
      expect(repair).toContain(`'prompt.runtime-default.${stage}', '${stage}'`);
    }
    expect(repair).toContain(
      'WHERE NOT EXISTS (SELECT 1 FROM prompt existing WHERE existing.stage = seed.stage)',
    );
    expect(repair).toContain('ON CONFLICT DO NOTHING');
    expect(repair).toContain("'{{instruction}}', 'enabled', 'admin'");
    expect(repair).toContain("VALUES ('0163_v14_initial_model_prompt_seed_repair')");
    expect(rollback).not.toContain('DELETE FROM prompt');
    expect(rollback).not.toContain('DELETE FROM prompt_version');
    expect(rollback).toContain("version = '0163_v14_initial_model_prompt_seed_repair'");
  });
});
