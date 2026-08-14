import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0157_v14_governed_control_confirmation.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0157_v14_governed_control_confirmation.down.sql',
  import.meta.url,
);

describe('0157 governed control confirmation migration', () => {
  it('persists exact bounded human authority and permits only one-way revocation', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('CREATE TABLE governed_control_confirmation');
    expect(sql).toContain("actor_kind='human'");
    expect(sql).toContain("actor_roles_json ? 'physical_control_approver'");
    expect(sql).toContain("expires_at <= confirmed_at + interval '15 minutes'");
    expect(sql).toContain('REFERENCES task_capability_binding(binding_id,task_id)');
    expect(sql).toContain('REFERENCES skill_version(skill_id,version)');
    expect(sql).toContain('GOVERNED_CONTROL_CONFIRMATION_IMMUTABLE');
    expect(sql).not.toContain('vehicle_fire_weapon');
  });

  it('has an explicit rollback', async () => {
    const sql = await readFile(down, 'utf8');

    expect(sql).toContain('DROP TABLE IF EXISTS governed_control_confirmation');
    expect(sql).toContain(
      "DELETE FROM schema_migration WHERE version='0157_v14_governed_control_confirmation'",
    );
  });
});
