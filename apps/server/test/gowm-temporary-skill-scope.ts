import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createAgentTask } from '../../../packages/domain/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresTemporarySkillRepository,
} from '../../../packages/persistence-postgres/src/index.js';

export async function verifyGowmTemporarySkillScope(pool: Pool, sourceTaskIds: readonly string[]) {
  assert.match(
    (await pool.query<{ name: string }>('SELECT current_database() name')).rows[0]?.name ?? '',
    /test/iu,
  );
  const run = `gowm-temporary-${randomUUID()}`;
  const allTasks = new PostgresAgentTaskRepository(pool);
  const results = [];
  for (const [index, sourceId] of sourceTaskIds.entries()) {
    const source = await allTasks.findById(sourceId);
    assert.ok(source);
    const ownership = (
      await pool.query<{ device_id: string; gowm_binding_id: string; sdar_service_key: string }>(
        'SELECT device_id,gowm_binding_id,sdar_service_key FROM agent_task WHERE task_id=$1',
        [sourceId],
      )
    ).rows[0];
    assert.ok(ownership);
    const scope = {
      allowedDeviceIds: [ownership.device_id],
      sdarServiceKey: ownership.sdar_service_key,
      includeNonDevice: false,
    };
    const tasks = new PostgresAgentTaskRepository(pool, undefined, undefined, scope);
    const temporary = new PostgresTemporarySkillRepository(pool, scope);
    const foreign = new PostgresTemporarySkillRepository(pool, { ...scope, allowedDeviceIds: [] });
    for (const phase of [
      'completed',
      'failed',
      'canceled',
      'invalidated',
      'capability_gap',
      'completed_without_evidence',
    ] as const) {
      const now = new Date().toISOString();
      const task = createAgentTask({
        taskId: `${run}-${String(index)}-${phase}`,
        contextId: source.contextId,
        userId: source.userId,
        requestText: 'Isolated temporary Skill provenance',
        requestMetadata: {},
        timestamp: now,
        deviceOwnership: {
          deviceId: ownership.device_id,
          bindingId: ownership.gowm_binding_id,
          sdarServiceKey: ownership.sdar_service_key,
        },
      });
      await tasks.save(task);
      const skill = {
        temporarySkillId: task.taskId,
        taskId: task.taskId,
        contextId: task.contextId,
        name: 'Read fixture',
        description: 'Scope fixture only; never dispatched',
        tools: [],
        inputSchema: { type: 'object', additionalProperties: false },
        outputSchema: { type: 'string' },
        capabilityFingerprint: run,
        status: 'active' as const,
        createdAt: now,
      };
      await assert.rejects(foreign.save(skill), /TEMPORARY_SKILL_DEVICE_SCOPE_DENIED/u);
      await temporary.save(skill);
      assert.ok(await temporary.find(skill.temporarySkillId));
      assert.equal(await foreign.find(skill.temporarySkillId), undefined);
      assert.deepEqual(await foreign.listByTask(task.taskId), []);
      const native = (
        await pool.query<{ device_id: string }>(
          'SELECT device_id FROM temporary_skill WHERE temporary_skill_id=$1',
          [skill.temporarySkillId],
        )
      ).rows[0];
      assert.equal(native?.device_id, ownership.device_id);
      const terminal = {
        ...task,
        temporarySkillId: skill.temporarySkillId,
        phase: phase === 'completed_without_evidence' ? ('completed' as const) : phase,
        phaseMessage: 'Fixture terminal transition',
        ...(phase === 'failed' ? { errorCode: 'PROCESS_LOST' } : {}),
        ...(phase === 'capability_gap'
          ? {
              errorCode: 'CAPABILITY_GAP',
              capabilityGap: {
                evaluationSummary: 'Fixture has no matching tool',
                missingCapability: 'Fixture unsupported operation',
                suggestedToolContract: {
                  name: 'fixture_missing',
                  description: 'Not dispatched',
                  inputSchema: { type: 'object', additionalProperties: false },
                },
              },
            }
          : {}),
        ...(phase === 'completed'
          ? { output: { text: 'Recorded fixture result', structured: null } }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      await tasks.save(terminal);
      await assert.rejects(tasks.save(terminal), /TASK_TERMINAL_MUTATION_FORBIDDEN/u);
      assert.equal((await tasks.findById(task.taskId))?.phase, terminal.phase);
      assert.equal((await temporary.find(skill.temporarySkillId))?.status, 'expired');
      const experience = await temporary.findExperience(skill.temporarySkillId);
      assert.ok(experience);
      assert.equal(experience.successful, phase === 'completed');
      assert.equal(await foreign.findExperience(skill.temporarySkillId), undefined);
      const rows = await pool.query<{ device_id: string }>(
        'SELECT device_id FROM temporary_skill_experience WHERE temporary_skill_id=$1',
        [skill.temporarySkillId],
      );
      assert.equal(rows.rowCount, 1);
      assert.equal(rows.rows[0]?.device_id, ownership.device_id);
      await assert.rejects(
        temporary.save({ ...skill, temporarySkillId: `${skill.temporarySkillId}-late` }),
        /TEMPORARY_SKILL_TASK_ALREADY_TERMINAL/u,
      );
      results.push({ taskId: task.taskId, deviceId: ownership.device_id, phase, status: 'PASS' });
    }
  }
  return {
    run,
    status: 'PASS' as const,
    results,
  };
}
