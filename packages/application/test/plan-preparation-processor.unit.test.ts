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
      planId: 'plan-task-1',
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

  it('reuses the active Goal for another Task in the same context', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await processorWith(tasks, false, 'active').process({
      taskId: 'task-1',
      contextId: 'context-1',
    });
    expect(tasks.value).toMatchObject({ goalId: 'goal-existing', goalVersion: 3 });
    expect(tasks.goalFormulations).toBe(0);
    expect(tasks.messages).toContain('Continuing the active Goal for this context.');
  });

  it('records an LLM-decided related successor after the previous Goal ended', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await processorWith(tasks, false, 'terminal').process({
      taskId: 'task-1',
      contextId: 'context-1',
    });
    expect(tasks.createdGoal).toMatchObject({
      goalId: 'goal-1',
      previousGoalId: 'goal-existing',
      transition: {
        relationship: 'related_successor',
        fromGoalId: 'goal-existing',
        toGoalId: 'goal-1',
      },
    });
  });

  it('uses an explainable inferred Goal instead of entering input-required', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.goalRequiresInput = true;
    tasks.inferenceOutcome = 'inferred';
    await processorWith(tasks).process({ taskId: 'task-1', contextId: 'context-1' });
    expect(tasks.value).toMatchObject({ phase: 'awaiting_plan_confirmation' });
    expect(tasks.createdGoal).toMatchObject({ description: 'Inspect inferred device-17.' });
  });

  it('asks the explicit inference question when available evidence is unreliable', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.goalRequiresInput = true;
    tasks.inferenceOutcome = 'input_required';
    await processorWith(tasks).process({ taskId: 'task-1', contextId: 'context-1' });
    expect(tasks.value).toMatchObject({
      phase: 'awaiting_user_input',
      phaseMessage: 'Which device should be inspected?',
    });
    expect(tasks.createdGoal).toBeUndefined();
  });

  it('executes immediately only when the selected Skill auto-confirms the generated plan', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.autoConfirm = true;
    await processorWith(tasks).process({ taskId: 'task-1', contextId: 'context-1' });
    expect(tasks.value).toMatchObject({
      phase: 'executing',
      planId: 'plan-task-1',
      phaseMessage: 'Skill policy auto-confirmed the plan.',
    });
    expect(tasks.autoExecutions).toEqual([{ taskId: 'task-1', planId: 'plan-task-1' }]);
  });

  it('binds a task-scoped Temporary Skill and always stops at plan confirmation', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.useTemporarySkill = true;
    tasks.autoConfirm = true;

    await processorWith(tasks).process({ taskId: 'task-1', contextId: 'context-1' });

    expect(tasks.value).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      temporarySkillId: 'temporary-1',
      planId: 'plan-task-1',
    });
    expect(tasks.value.selectedSkillId).toBeUndefined();
    expect(tasks.planningInput).toMatchObject({ temporarySkillId: 'temporary-1' });
    expect(tasks.autoExecutions).toEqual([]);
  });
});

function processorWith(
  tasks: MemoryTasks,
  fail = false,
  prior: 'none' | 'active' | 'terminal' = 'none',
) {
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
      formulateGoal: () => {
        tasks.goalFormulations += 1;
        return Promise.resolve({
          title: 'Goal',
          description: 'Complete the task.',
          constraints: [],
          successCriteria: ['Completed'],
          requiresInput: tasks.goalRequiresInput,
          ...(tasks.goalRequiresInput ? { clarificationQuestion: 'Missing device.' } : {}),
        });
      },
      decideGoalContinuity: () =>
        Promise.resolve({
          relationship: 'related_successor',
          decisionSummary: 'Continue with the next related phase.',
        }),
    },
    goals: {
      findActiveByContextId: () =>
        Promise.resolve(prior === 'active' ? existingGoal('active') : undefined),
      findLatestByContextId: () =>
        Promise.resolve(prior === 'terminal' ? existingGoal('achieved') : undefined),
      create: (input) => {
        tasks.createdGoal = input;
        return Promise.resolve({
          ...input,
          constraints: input.constraints ?? [],
          successCriteria: input.successCriteria ?? [],
          version: 1,
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      },
    },
    skillSelection: {
      select: (goalDescription) =>
        Promise.resolve(
          tasks.useTemporarySkill
            ? {
                temporarySkillId: 'temporary-1',
                name: 'Temporary device status',
                decisionSummary: 'No formal Skill matched; use the registered Tool once.',
              }
            : {
                selectionId: 'selection-1',
                goalDescription,
                candidates: [],
                selectedSkillId: 'skill-1',
                selectedSkillVersion: 2,
                decisionSummary: 'Selected by the configured LLM.',
                createdAt: timestamp,
              },
        ),
    },
    nextGoalId: () => 'goal-1',
    nextGoalTransitionId: () => 'goal-transition-1',
    inputInference: {
      resolve: () =>
        Promise.resolve(
          tasks.inferenceOutcome === 'inferred'
            ? {
                inferenceId: 'inference-1',
                taskId: 'task-1',
                contextId: 'context-1',
                outcome: 'inferred' as const,
                decisionSummary: 'Memory reliably identifies device-17.',
                usedSources: [],
                inferredGoal: {
                  title: 'Inspect device',
                  description: 'Inspect inferred device-17.',
                  constraints: [],
                  successCriteria: ['Inspected'],
                },
                createdAt: timestamp,
              }
            : {
                inferenceId: 'inference-1',
                taskId: 'task-1',
                contextId: 'context-1',
                outcome: 'input_required' as const,
                decisionSummary: 'Evidence conflicts.',
                usedSources: [],
                clarificationQuestion: 'Which device should be inspected?',
                createdAt: timestamp,
              },
        ),
    },
    taskPlanning: {
      prepare: (input) => {
        tasks.planningInput = input;
        return Promise.resolve({
          planId: 'plan-task-1',
          autoConfirmed: tasks.useTemporarySkill ? false : tasks.autoConfirm,
        });
      },
      executeAuto: (input) => {
        tasks.autoExecutions.push(input);
        return Promise.resolve();
      },
    },
  });
}

function existingGoal(status: 'active' | 'achieved') {
  return {
    goalId: 'goal-existing',
    contextId: 'context-1',
    version: 3,
    title: 'Existing Goal',
    description: 'Continue the existing work.',
    constraints: [],
    successCriteria: ['Complete'],
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as const;
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
  goalFormulations = 0;
  createdGoal: unknown;
  goalRequiresInput = false;
  inferenceOutcome: 'inferred' | 'input_required' = 'inferred';
  autoConfirm = false;
  useTemporarySkill = false;
  planningInput: unknown;
  readonly autoExecutions: { taskId: string; planId: string }[] = [];
  findById() {
    return Promise.resolve(this.value);
  }
  save(value: AgentTask) {
    this.value = value;
    return Promise.resolve();
  }
}
