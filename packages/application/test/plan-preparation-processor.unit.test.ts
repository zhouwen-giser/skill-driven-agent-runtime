import { describe, expect, it } from 'vitest';

import { createAgentTask, type AgentTask } from '../../domain/src/index.js';
import { PlanPreparationProcessor } from '../src/index.js';

const timestamp = '2026-07-12T00:00:00.000Z';

describe('PlanPreparationProcessor LLM decisions', () => {
  it('binds the LLM-formulated Goal and LLM-selected Skill before planning', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    const processor = processorWith(tasks);
    await processor.process({ taskId: 'task-1', contextId: 'context-1' });

    expect(tasks.value).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      goalId: 'goal-1',
      goalVersion: 1,
    });
    expect(tasks.messages.join(' ')).toContain('LLM intent execute');
    expect(tasks.messages.join(' ')).toContain('LLM selected skill-1@2');
  });

  it('marks the Task failed when a configured decision model fails without fallback', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    const processor = processorWith(tasks, true);
    await expect(
      processor.process({ taskId: 'task-1', contextId: 'context-1' }),
    ).rejects.toMatchObject({ code: 'MODEL_INVOCATION_FAILED' });
    expect(tasks.value).toMatchObject({
      phase: 'failed',
      phaseMessage: 'Task preparation failed with MODEL_INVOCATION_FAILED.',
    });
  });
});

function processorWith(tasks: MemoryTasks, fail = false) {
  let event = 0;
  return new PlanPreparationProcessor({
    tasks,
    events: {
      publish: (value) => {
        tasks.messages.push(value.summary);
        return Promise.resolve();
      },
    },
    clock: { now: () => timestamp },
    ids: { nextId: () => `event-${String(++event)}` },
    decisions: {
      decideIntent: () =>
        fail
          ? Promise.reject(
              Object.assign(new Error('configured model failed'), {
                code: 'MODEL_INVOCATION_FAILED',
              }),
            )
          : Promise.resolve({ intent: 'execute', summary: 'Execute the task.' }),
      formulateGoal: () =>
        Promise.resolve({
          title: 'Goal',
          description: 'Complete the task.',
          constraints: [],
          successCriteria: ['Completed'],
          requiresInput: false,
        }),
    },
    goals: {
      create: (input) =>
        Promise.resolve({
          ...input,
          constraints: input.constraints ?? [],
          successCriteria: input.successCriteria ?? [],
          version: 1,
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
    },
    skillSelection: {
      select: (goalDescription) =>
        Promise.resolve({
          selectionId: 'selection-1',
          goalDescription,
          candidates: [],
          selectedSkillId: 'skill-1',
          selectedSkillVersion: 2,
          decisionSummary: 'Selected by the configured LLM.',
          createdAt: timestamp,
        }),
    },
    nextGoalId: () => 'goal-1',
  });
}

function task(): AgentTask {
  return createAgentTask({
    taskId: 'task-1',
    contextId: 'context-1',
    userId: 'anonymous',
    requestText: 'Complete it.',
    requestMetadata: {},
    timestamp,
  });
}

class MemoryTasks {
  value: AgentTask | undefined;
  readonly messages: string[] = [];
  findById() {
    return Promise.resolve(this.value);
  }
  save(value: AgentTask) {
    this.value = value;
    return Promise.resolve();
  }
}
