import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const up = new URL(
  '../../../infra/postgres/migrations/0172_v14_initial_task_admission.up.sql',
  import.meta.url,
);
const down = new URL(
  '../../../infra/postgres/migrations/0172_v14_initial_task_admission.down.sql',
  import.meta.url,
);

describe('0172 initial Task admission authority migration', () => {
  it('binds one bounded idempotency key to exact Task, Context and Capability authority', async () => {
    const sql = await readFile(up, 'utf8');

    expect(sql).toContain('CREATE TABLE initial_task_admission');
    expect(sql).toContain('idempotency_key text PRIMARY KEY');
    expect(sql).toContain("request_hash ~ '^sha256:[a-f0-9]{64}$'");
    expect(sql).toContain('task_id text NOT NULL UNIQUE REFERENCES agent_task(task_id)');
    expect(sql).toContain('REFERENCES conversation_context(context_id)');
    expect(sql).toContain('REFERENCES task_capability_binding(binding_id,task_id)');
    expect(sql).toContain('REFERENCES task_capability_execution_attempt(attempt_id,task_id)');
    expect(sql).toContain('INITIAL_TASK_ADMISSION_IMMUTABLE');
    expect(sql).toContain("VALUES ('0172_v14_initial_task_admission')");
  });

  it('has an explicit rollback', async () => {
    const sql = await readFile(down, 'utf8');

    expect(sql).toContain('DROP TABLE initial_task_admission');
    expect(sql).toContain(
      "DELETE FROM schema_migration WHERE version='0172_v14_initial_task_admission'",
    );
  });
});
