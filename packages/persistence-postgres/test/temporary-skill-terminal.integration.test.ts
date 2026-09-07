import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
} from '../../../apps/server/test-support/postgres.js';
import { createAgentTask, type TaskTerminalPhase } from '../../domain/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresTemporarySkillRepository,
} from '../src/index.js';

const adminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const database = 'sdar_temporary_terminal_integration';
let pool: Pool;
beforeAll(async () => {
  pool = new Pool({ connectionString: await createIsolatedRuntimeDatabase(adminUrl, database) });
  await applyRuntimeMigrations(pool);
  await applyRuntimeMigrations(pool);
}, 60_000);
afterAll(async () => {
  await pool.end();
  await dropIsolatedRuntimeDatabase(adminUrl, database);
});
async function seed() {
  const id = randomUUID();
  const timestamp = '2026-09-07T08:00:00.000Z';
  await new PostgresConversationContextRepository(pool).save({
    contextId: id,
    userId: 'anonymous',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const task = {
    ...createAgentTask({
      taskId: id,
      contextId: id,
      userId: 'anonymous',
      requestText: 'Read a document.',
      requestMetadata: {},
      timestamp,
    }),
    temporarySkillId: id,
  };
  const { temporarySkillId: binding, ...unbound } = task;
  void binding;
  await new PostgresAgentTaskRepository(pool).save(unbound);
  const skill = {
    temporarySkillId: id,
    taskId: id,
    contextId: id,
    name: 'Document',
    description: 'Read one document.',
    tools: [],
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: { type: 'string' },
    capabilityFingerprint: 'document',
    status: 'active' as const,
    createdAt: timestamp,
  };
  await new PostgresTemporarySkillRepository(pool).save(skill);
  await new PostgresAgentTaskRepository(pool).save(task);
  return { task, skill };
}
describe('Temporary Skill owning terminal transaction', () => {
  it.each(['completed', 'failed', 'canceled', 'invalidated', 'capability_gap'] as const)(
    'expires and records %s exactly once',
    async (phase: TaskTerminalPhase) => {
      const { task, skill } = await seed();
      const tasks = new PostgresAgentTaskRepository(pool);
      const skills = new PostgresTemporarySkillRepository(pool);
      const terminal = {
        ...task,
        phase,
        phaseMessage: phase,
        output: { text: 'read', structured: { text: 'read' } },
        updatedAt: '2026-09-07T08:01:00.000Z',
      };
      await tasks.save(terminal);
      await expect(tasks.save(terminal)).rejects.toThrow('TASK_TERMINAL_MUTATION_FORBIDDEN');
      await pool.query('UPDATE agent_task SET phase=phase WHERE task_id=$1', [task.taskId]);
      expect(await skills.find(skill.temporarySkillId)).toMatchObject({
        status: 'expired',
        expiredAt: terminal.updatedAt,
      });
      const experience = requiredFixture(await skills.findExperience(skill.temporarySkillId));
      expect(experience.successful).toBe(phase === 'completed');
      await skills.expireAndSaveExperience(
        { ...skill, status: 'expired', expiredAt: terminal.updatedAt },
        experience,
      );
      expect(
        (
          await pool.query('SELECT * FROM temporary_skill_experience WHERE temporary_skill_id=$1', [
            skill.temporarySkillId,
          ])
        ).rowCount,
      ).toBe(1);
      await expect(
        skills.save({ ...skill, temporarySkillId: `late-${skill.temporarySkillId}` }),
      ).rejects.toThrow('TEMPORARY_SKILL_TASK_ALREADY_TERMINAL');
    },
  );
  it('rolls back expiration with Task terminal failure, then records process loss without success', async () => {
    const { task, skill } = await seed();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "UPDATE agent_task SET phase='failed',error_code='PROCESS_LOST' WHERE task_id=$1",
        [task.taskId],
      );
      expect(
        (
          await client.query('SELECT status FROM temporary_skill WHERE temporary_skill_id=$1', [
            skill.temporarySkillId,
          ])
        ).rows[0],
      ).toEqual({ status: 'expired' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const skills = new PostgresTemporarySkillRepository(pool);
    expect(await skills.find(skill.temporarySkillId)).toMatchObject({ status: 'active' });
    expect(await skills.findExperience(skill.temporarySkillId)).toBeUndefined();
    await new PostgresAgentTaskRepository(pool).save({
      ...task,
      phase: 'failed',
      errorCode: 'PROCESS_LOST',
    });
    expect(await skills.findExperience(skill.temporarySkillId)).toMatchObject({
      successful: false,
    });
  });
  it('does not count an unknown or unselected result as successful', async () => {
    for (const selected of [true, false]) {
      const { task, skill } = await seed();
      const { temporarySkillId: _, ...unselected } = task;
      void _;
      await new PostgresAgentTaskRepository(pool).save({
        ...(selected ? task : unselected),
        phase: 'completed',
      });
      expect(
        await new PostgresTemporarySkillRepository(pool).findExperience(skill.temporarySkillId),
      ).toMatchObject({ successful: false });
    }
  });
  it('refuses downgrade with active dependents and restores the terminal trigger after a safe down/up', async () => {
    const { task } = await seed();
    const down = await readFile(
      'infra/postgres/migrations/0181_v14_temporary_skill_terminal.down.sql',
      'utf8',
    );
    const client = await pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow(
        'TEMPORARY_SKILL_TERMINAL_DOWNGRADE_ACTIVE_REFERENCES',
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await new PostgresAgentTaskRepository(pool).save({
      ...task,
      phase: 'failed',
      errorCode: 'PROCESS_LOST',
    });
    await pool.query(down);
    await pool.query(
      await readFile('infra/postgres/migrations/0181_v14_temporary_skill_terminal.up.sql', 'utf8'),
    );
    const next = await seed();
    await new PostgresAgentTaskRepository(pool).save({ ...next.task, phase: 'canceled' });
    expect(
      await new PostgresTemporarySkillRepository(pool).findExperience(next.skill.temporarySkillId),
    ).toMatchObject({ successful: false });
  });
});

function requiredFixture<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('REQUIRED_TEST_FIXTURE_MISSING');
  return value;
}
