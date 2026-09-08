import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createAgentTask } from '../../../packages/domain/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresTemporarySkillRepository,
} from '../../../packages/persistence-postgres/src/index.js';

export async function verifyGowmTemporarySkillScope(pool: Pool, sourceTaskIds: readonly string[]) {
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
    const now = new Date().toISOString();
    const task = createAgentTask({
      taskId: `${run}-${String(index)}`,
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
    let terminalError: string | undefined;
    try {
      await tasks.save({
        ...task,
        phase: 'failed',
        phaseMessage: 'Fixture process loss',
        errorCode: 'PROCESS_LOST',
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      terminalError = error instanceof Error ? error.message : 'UNKNOWN';
    }
    results.push({
      taskId: task.taskId,
      deviceId: ownership.device_id,
      scopedCreateAndRead: 'PASS',
      terminalError: terminalError ?? null,
      phase: (await tasks.findById(task.taskId))?.phase,
      skillStatus: (await temporary.find(skill.temporarySkillId))?.status,
      experience: (await temporary.findExperience(skill.temporarySkillId)) ?? null,
    });
  }
  return {
    run,
    status: results.some((row) => row.terminalError !== null) ? 'INCOMPLETE' : 'PASS',
    results,
  };
}
