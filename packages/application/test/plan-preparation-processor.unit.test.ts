import { describe, expect, it } from 'vitest';

import { createAgentTask, transitionTask, type AgentTask } from '../../domain/src/index.js';
import {
  PlanPreparationProcessor,
  type PlanPreparationProcessorDependencies,
} from '../src/index.js';

const timestamp = '2026-07-12T00:00:00.000Z';
const initialJob = {
  taskId: 'task-1',
  contextId: 'context-1',
  attemptId: 'attempt-1',
  mode: 'initial' as const,
};

function skillAttempt() {
  return {
    attemptId: 'skill-attempt-1',
    planId: 'user-goal-plan-1',
    skillGoalId: 'skill-goal-1',
    ordinal: 1,
    status: 'selecting' as const,
    strategyFingerprint: `sha256:${'a'.repeat(64)}`,
    budget: { maxAttempts: 2, consumedAttempts: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('PlanPreparationProcessor LLM decisions', () => {
  it('keeps the original planning path when P10 returns cognitive fallback', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await processorWith(tasks, false, 'none', undefined, undefined, {
      evaluate: () =>
        Promise.resolve({
          decision: gatewayDecision('cognitive_runtime'),
          formalHandoffCommitted: false,
        }),
    }).process(initialJob);
    expect(tasks.value).toMatchObject({ phase: 'awaiting_plan_confirmation' });
    expect(tasks.goalFormulations).toBe(1);
    expect(tasks.userGoalPlanningInputs[0]?.taskId).toBe('task-1');
  });

  it('stops denied P10 requests without entering cognitive fallback', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await expect(
      processorWith(tasks, false, 'none', undefined, undefined, {
        evaluate: () =>
          Promise.resolve({
            decision: gatewayDecision('denied'),
            formalHandoffCommitted: false,
          }),
      }).process(initialJob),
    ).rejects.toMatchObject({ code: 'GATEWAY_DENIED' });
    expect(tasks.value).toMatchObject({ phase: 'failed' });
    expect(tasks.goalFormulations).toBe(0);
  });

  it('uses existing formal interaction for P10 confirmation', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await processorWith(tasks, false, 'none', undefined, undefined, {
      evaluate: () =>
        Promise.resolve({
          decision: gatewayDecision('human_input'),
          formalHandoffCommitted: false,
          interactionQuestion: 'Approve the selected Artifact route?',
        }),
    }).process(initialJob);
    expect(tasks.value).toMatchObject({
      phase: 'awaiting_user_input',
      phaseMessage: 'Approve the selected Artifact route?',
    });
    expect(tasks.goalFormulations).toBe(0);
  });

  it('schedules a committed fast-path plan through the normal Task continuation', async () => {
    const tasks = new MemoryTasks();
    tasks.value = {
      ...task(),
      goalId: 'goal-1',
      goalVersion: 1,
    };
    await processorWith(tasks, false, 'none', undefined, undefined, {
      evaluate: () =>
        Promise.resolve({
          decision: gatewayDecision('template_adapt'),
          formalHandoffCommitted: true,
          formalPlanRef: 'formal-plan-1',
        }),
    }).process(initialJob);
    expect(tasks.goalFormulations).toBe(0);
    expect(tasks.userGoalRuntimeCalls).toContain('skill_goal_scheduling');
    expect(tasks.value).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      userGoalPlanId: 'formal-plan-1',
    });
  });

  it('fails closed when a fast path lacks a formal handoff commit', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await expect(
      processorWith(tasks, false, 'none', undefined, undefined, {
        evaluate: () =>
          Promise.resolve({
            decision: gatewayDecision('compiled_fast'),
            formalHandoffCommitted: false,
          }),
      }).process(initialJob),
    ).rejects.toMatchObject({ code: 'GATEWAY_FORMAL_HANDOFF_INCOMPLETE' });
    expect(tasks.goalFormulations).toBe(0);
  });

  it('routes an ambiguous task through Understanding and stops at its blocking question', async () => {
    const tasks = new MemoryTasks();
    const understandingInputs: unknown[] = [];
    tasks.value = {
      ...task(),
      requestText: 'Help me with this.',
      requestMetadata: { structured_input: { resourceId: 'device:17' } },
    };
    await processorWith(tasks, false, 'none', undefined, {
      route: () => ({ kind: 'generic_task', reason: 'underspecified_request' }),
      understand: (input) => {
        understandingInputs.push(input);
        return Promise.resolve({
          schemaVersion: '1.0',
          understandingId: 'understanding-1',
          taskId: 'task-1',
          revision: 1,
          originalRequest: 'Help me with this.',
          objective: 'Help with an unspecified task.',
          taskTypeCandidates: [],
          capabilityRequirements: [],
          knownConstraints: [],
          knownDimensions: [],
          assumptions: [],
          missingDimensions: [
            {
              dimensionId: 'dimension-target',
              kind: 'target',
              severity: 'blocking',
              question: 'What should be handled?',
              answered: false,
              authorizationSensitive: false,
            },
          ],
          confidence: 0.3,
          disposition: 'clarification_required',
          sourceRefs: [],
          modelInvocationId: 'model-invocation-1',
          policyVersion: 'task-understanding-v1',
          stateHash: `sha256:${'a'.repeat(64)}`,
          createdAt: timestamp,
        });
      },
    }).process(initialJob);

    expect(tasks.value).toMatchObject({
      phase: 'awaiting_user_input',
      phaseMessage: 'What should be handled?',
    });
    expect(tasks.goalFormulations).toBe(0);
    expect(tasks.planningInput).toBeUndefined();
    expect(understandingInputs).toEqual([
      expect.objectContaining({
        requestMetadata: { structured_input: { resourceId: 'device:17' } },
      }),
    ]);
  });

  it('binds the User Goal Plan scheduled Skill before Workflow planning', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    const processor = processorWith(tasks);
    await processor.process(initialJob);

    expect(tasks.value).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      goalId: 'goal-1',
      goalVersion: 1,
      planId: 'plan-task-1',
    });
    expect(tasks.messages.join(' ')).toContain('LLM intent execute');
    expect(tasks.messages.join(' ')).toContain('Scheduled skill-1@2 from User Goal Plan');
    expect(tasks.userGoalRuntimeCalls).toEqual(['goal_planning', 'skill_goal_scheduling']);
    expect(tasks.value.skillSelectionId).toBe('selection-1');
  });

  it('does not invent a Skill Selection reference when generic scheduling has no record', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.selectionRecordId = undefined;

    await processorWith(tasks).process(initialJob);

    expect(tasks.value).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      selectedSkillId: 'skill-1',
      skillAttemptId: 'skill-attempt-1',
    });
    expect(tasks.value).not.toHaveProperty('skillSelectionId');
  });

  it('marks the Task failed when a configured decision model fails without fallback', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    const processor = processorWith(tasks, true);
    await expect(processor.process(initialJob)).rejects.toMatchObject({
      code: 'MODEL_INVOCATION_FAILED',
    });
    expect(tasks.value).toMatchObject({
      phase: 'failed',
      phaseMessage: 'Task preparation failed with MODEL_INVOCATION_FAILED: configured model failed',
    });
    expect(tasks.capabilityAttemptTransitions).toEqual([
      { taskId: 'task-1', status: 'failed', timestamp },
    ]);
  });

  it('reuses the active Goal for another Task in the same context', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await processorWith(tasks, false, 'active').process(initialJob);
    expect(tasks.value).toMatchObject({ goalId: 'goal-existing', goalVersion: 3 });
    expect(tasks.goalFormulations).toBe(0);
    expect(tasks.messages).toContain('Continuing the active Goal for this context.');
  });

  it('records an LLM-decided related successor after the previous Goal ended', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    await processorWith(tasks, false, 'terminal').process(initialJob);
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
    await processorWith(tasks).process(initialJob);
    expect(tasks.value).toMatchObject({ phase: 'awaiting_plan_confirmation' });
    expect(tasks.createdGoal).toMatchObject({ description: 'Inspect inferred device-17.' });
  });

  it('asks the explicit inference question when available evidence is unreliable', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.goalRequiresInput = true;
    tasks.inferenceOutcome = 'input_required';
    await processorWith(tasks).process(initialJob);
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
    await processorWith(tasks).process(initialJob);
    expect(tasks.value).toMatchObject({
      phase: 'executing',
      planId: 'plan-task-1',
      phaseMessage: 'Skill policy auto-confirmed the plan.',
    });
    expect(tasks.autoExecutions).toEqual([
      {
        taskId: 'task-1',
        planId: 'plan-task-1',
        executionInput: { deviceId: 'device-1' },
      },
    ]);
  });

  it('uses the immutable scheduled Skill contract for auto-confirmed Workflow execution', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.autoConfirm = true;

    await processorWith(tasks).process(initialJob);

    expect(tasks.value).toMatchObject({
      phase: 'executing',
      selectedSkillId: 'skill-1',
      planId: 'plan-task-1',
    });
    expect(tasks.planningInput).toMatchObject({ skillId: 'skill-1', skillVersion: 2 });
    expect(tasks.autoExecutions).toHaveLength(1);
  });

  it('continues Goal deliberation on the original Task using the saved answer', async () => {
    const tasks = new MemoryTasks();
    let waiting = task();
    waiting = transitionTask(waiting, 'context_loading', 'loaded', timestamp);
    waiting = transitionTask(waiting, 'goal_deliberation', 'deliberating', timestamp);
    waiting = transitionTask(waiting, 'awaiting_user_input', 'Which device?', timestamp);
    waiting = transitionTask(waiting, 'goal_deliberation', 'continuation queued', timestamp);
    tasks.value = waiting;
    tasks.attemptReason = 'input_response';
    tasks.supplementaryContent = 'device-17';

    await processorWith(tasks).process({ ...initialJob, mode: 'continue_after_input' });

    expect(tasks.value).toMatchObject({
      taskId: 'task-1',
      phase: 'awaiting_plan_confirmation',
      goalId: 'goal-1',
    });
    expect(tasks.formulationInputs[0]).toContain('device-17');
    expect(tasks.userGoalPlanningInputs.at(-1)?.taskId).toBe('task-1');
  });

  it('requests missing top-level Skill input and replans with the resolved response', async () => {
    const tasks = new MemoryTasks();
    tasks.value = task();
    tasks.skillInputRequired = true;

    await processorWith(tasks).process(initialJob);
    expect(tasks.value).toMatchObject({
      phase: 'awaiting_user_input',
      selectedSkillId: 'skill-1',
      phaseMessage: 'Additional Skill input is required for: deviceId.',
    });

    tasks.value = transitionTask(
      tasks.value,
      'planning',
      'Supplementary input saved; continuation queued.',
      timestamp,
    );
    tasks.attemptReason = 'input_response';
    tasks.inputRequestSource = 'skill_input_resolution';
    tasks.supplementaryContent = 'device-22';
    await processorWith(tasks).process({ ...initialJob, mode: 'continue_after_input' });

    expect(tasks.value).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      planId: 'plan-task-1',
      skillInputResolutionId: 'skill-input-resolution-1',
    });
    expect(tasks.planningInput).toMatchObject({
      skillInputResolution: {
        structuredInput: { deviceId: 'device-22' },
      },
    });
  });

  it('submits a remote Task answer without invoking Goal formulation or Workflow replanning', async () => {
    const tasks = new MemoryTasks();
    let current = task();
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
    ] as const)
      current = transitionTask(current, phase, phase, timestamp);
    tasks.value = current;
    tasks.attemptReason = 'input_response';
    tasks.inputRequestSource = 'remote_task';
    tasks.supplementaryContent = {
      approval: { action: 'accept', content: { approved: true } },
    };
    const submitted: unknown[] = [];

    await processorWith(tasks, false, 'none', (inputRequestId, content) => {
      submitted.push({ inputRequestId, content });
      return Promise.resolve();
    }).process({ ...initialJob, mode: 'continue_after_input' });

    expect(submitted).toEqual([
      { inputRequestId: 'input-request-1', content: tasks.supplementaryContent },
    ]);
    expect(tasks.goalFormulations).toBe(0);
    expect(tasks.planningInput).toBeUndefined();
  });
});

function processorWith(
  tasks: MemoryTasks,
  fail = false,
  prior: 'none' | 'active' | 'terminal' = 'none',
  submitRemoteInput?: (inputRequestId: string, inputResponses: unknown) => Promise<void>,
  taskUnderstanding?: PlanPreparationProcessorDependencies['taskUnderstanding'],
  fastGateway?: PlanPreparationProcessorDependencies['fastGateway'],
) {
  let event = 0;
  let attemptStatus: 'queued' | 'running' | 'completed' | 'failed' = 'queued';
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
      formulateGoal: ({ requestText }) => {
        tasks.goalFormulations += 1;
        tasks.formulationInputs.push(requestText);
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
      get: (goalId) =>
        Promise.resolve(
          goalId === 'goal-existing'
            ? existingGoal('active')
            : {
                goalId: 'goal-1',
                contextId: 'context-1',
                version: 1,
                title: 'Goal',
                description: 'Complete the task.',
                constraints: [],
                successCriteria: ['Completed'],
                status: 'active' as const,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
        ),
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
    skills: {
      findVersion: () =>
        Promise.resolve({
          skillId: 'skill-1',
          version: 2,
          name: 'Device Skill',
          summary: 'Inspect a device.',
          description: 'Inspect a device.',
          capabilities: ['device'],
          workflowGuidance: 'Inspect once.',
          outputInstruction: 'Return the result.',
          inputSchema: {
            type: 'object',
            required: ['deviceId'],
            properties: { deviceId: { type: 'string' } },
          },
          outputSchema: { type: 'object' },
          toolPolicy: { required: [], optional: [], forbidden: [] },
          runtimePolicy: { autoConfirmPlan: tasks.autoConfirm },
          status: 'enabled' as const,
          sourceKind: 'admin' as const,
          validationPassed: true,
          createdAt: timestamp,
        }),
    },
    skillInputs: {
      resolve: ({ task: selectedTask, goal, skill, supplementaryInputs }) => {
        const supplied = supplementaryInputs.at(-1)?.content;
        const stillMissing = tasks.skillInputRequired && supplied === undefined;
        return Promise.resolve({
          resolutionId: 'skill-input-resolution-1',
          taskId: selectedTask.taskId,
          goalId: goal.goalId,
          goalVersion: goal.version,
          skillId: skill.skillId,
          skillVersion: skill.version,
          ...(stillMissing
            ? { structuredInput: {} }
            : {
                structuredInput: {
                  deviceId: typeof supplied === 'string' ? supplied : 'device-1',
                },
              }),
          unresolvedFields: stillMissing ? ['deviceId'] : [],
          sourceRefs: [`task:${selectedTask.taskId}:request-text`],
          decisionSummary: stillMissing ? 'The device is missing.' : 'Resolved from the request.',
          status: stillMissing ? ('input_required' as const) : ('resolved' as const),
          createdAt: timestamp,
        });
      },
    },
    userGoalPlanning: {
      findReusablePlan: () => Promise.resolve(undefined),
      plan: (input) => {
        tasks.userGoalPlanningInputs.push(input);
        tasks.userGoalRuntimeCalls.push('goal_planning');
        return Promise.resolve({ plan: { planId: 'user-goal-plan-1' } });
      },
    },
    skillGoalScheduler: {
      dispatchReady: () => {
        tasks.userGoalRuntimeCalls.push('skill_goal_scheduling');
        return Promise.resolve([
          {
            kind: 'selected' as const,
            attempt: skillAttempt(),
            skill: {
              skillId: 'skill-1',
              version: 2,
              name: 'Device Skill',
              summary: 'Inspect a device.',
              description: 'Inspect a device.',
              capabilities: ['device'],
              workflowGuidance: 'Inspect once.',
              outputInstruction: 'Return the result.',
              inputSchema: {
                type: 'object',
                required: ['deviceId'],
                properties: { deviceId: { type: 'string' } },
              },
              outputSchema: { type: 'object' },
              toolPolicy: { required: [], optional: [], forbidden: [] },
              runtimePolicy: { autoConfirmPlan: tasks.autoConfirm },
              status: 'enabled' as const,
              sourceKind: 'admin' as const,
              validationPassed: true,
              createdAt: timestamp,
            },
            ...(tasks.selectionRecordId === undefined
              ? {}
              : { selectionRecordId: tasks.selectionRecordId }),
          },
        ]);
      },
      findAttempt: () => Promise.resolve(skillAttempt()),
      createExecutionContract: ({ attempt }) =>
        Promise.resolve({
          attempt: { ...attempt, status: 'planning_workflow' as const },
          contract: { executionContractId: 'execution-contract-1' },
        }),
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
    taskInputs: {
      findAttempt: () =>
        Promise.resolve({
          attemptId: 'attempt-1',
          taskId: 'task-1',
          contextId: 'context-1',
          reason: tasks.attemptReason,
          status: attemptStatus,
          createdAt: timestamp,
        }),
      findResponseForAttempt: () =>
        Promise.resolve(
          tasks.attemptReason === 'input_response'
            ? {
                request: {
                  inputRequestId: 'input-request-1',
                  taskId: 'task-1',
                  contextId: 'context-1',
                  source: tasks.inputRequestSource,
                  question: 'Which device?',
                  status: 'answered' as const,
                  createdAt: timestamp,
                  answeredAt: timestamp,
                },
                response: {
                  inputResponseId: 'input-response-1',
                  inputRequestId: 'input-request-1',
                  taskId: 'task-1',
                  content: tasks.supplementaryContent,
                  createdAt: timestamp,
                },
              }
            : undefined,
        ),
      listResponses: () =>
        Promise.resolve(
          tasks.supplementaryContent === undefined
            ? []
            : [
                {
                  inputResponseId: 'input-response-1',
                  inputRequestId: 'input-request-1',
                  taskId: 'task-1',
                  content: tasks.supplementaryContent,
                  createdAt: timestamp,
                },
              ],
        ),
      updateAttempt: (_attemptId, status) => {
        attemptStatus = status;
        return Promise.resolve();
      },
    },
    taskCapabilities: {
      markLatestAttempt: (taskId, status, transitionTimestamp) => {
        tasks.capabilityAttemptTransitions.push({
          taskId,
          status,
          timestamp: transitionTimestamp,
        });
        return Promise.resolve();
      },
    },
    requestTaskInput: (_taskId, question) => {
      if (tasks.value === undefined) throw new Error('TASK_NOT_FOUND');
      tasks.value = transitionTask(tasks.value, 'awaiting_user_input', question, timestamp);
      return Promise.resolve();
    },
    workflowContinuation: {
      continueAfterInput: () => Promise.reject(new Error('UNUSED')),
    },
    ...(submitRemoteInput === undefined
      ? {}
      : { remoteTaskInput: { submitAnswer: submitRemoteInput } }),
    ...(taskUnderstanding === undefined ? {} : { taskUnderstanding }),
    ...(fastGateway === undefined ? {} : { fastGateway }),
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

function gatewayDecision(
  path:
    | 'compiled_fast'
    | 'template_adapt'
    | 'case_adapt'
    | 'small_model'
    | 'cognitive_runtime'
    | 'human_input'
    | 'denied',
) {
  return {
    decisionId: 'gateway-runtime-decision-1',
    requestId: 'request-1',
    path,
    parameterBindings: {},
    missingParameters: [],
    requiredConfirmations: path === 'human_input' ? ['GATEWAY_POLICY_CONFIRM'] : [],
    reasonCodes: path === 'denied' ? ['GATEWAY_DENIED'] : [],
    matcherSnapshotHash: `sha256:${'a'.repeat(64)}`,
    policySnapshotHash: `sha256:${'b'.repeat(64)}`,
    createdAt: timestamp,
  };
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
  readonly formulationInputs: string[] = [];
  readonly userGoalRuntimeCalls: string[] = [];
  attemptReason: 'initial' | 'input_response' = 'initial';
  inputRequestSource: 'goal_deliberation' | 'skill_input_resolution' | 'remote_task' =
    'goal_deliberation';
  supplementaryContent: unknown;
  createdGoal: unknown;
  goalRequiresInput = false;
  inferenceOutcome: 'inferred' | 'input_required' = 'inferred';
  skillInputRequired = false;
  autoConfirm = false;
  useTemporarySkill = false;
  selectionRecordId: string | undefined = 'selection-1';
  planningInput: unknown;
  readonly userGoalPlanningInputs: Readonly<{ goal: unknown; taskId: string }>[] = [];
  readonly autoExecutions: { taskId: string; planId: string; executionInput: unknown }[] = [];
  readonly capabilityAttemptTransitions: Readonly<{
    taskId: string;
    status: 'succeeded' | 'failed' | 'canceled';
    timestamp: string;
  }>[] = [];
  findById() {
    return Promise.resolve(this.value);
  }
  findByPlanId(planId: string) {
    return Promise.resolve(this.value?.planId === planId ? this.value : undefined);
  }
  list() {
    return Promise.resolve(this.value === undefined ? [] : [this.value]);
  }
  save(value: AgentTask) {
    this.value = value;
    return Promise.resolve();
  }
}
