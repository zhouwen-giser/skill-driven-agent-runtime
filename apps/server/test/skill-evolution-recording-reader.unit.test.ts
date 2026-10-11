import { describe, expect, it } from 'vitest';
import type {
  EvolutionExperience,
  McpInvocation,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../../packages/domain/src/index.js';
import {
  budgetCeiling,
  timestamp,
} from '../../../packages/application/test/skill-evolution-fixture.js';
import { PostgresBackedSkillRecordingReader } from '../src/composition/skill-evolution.js';

describe('retained evolution recording ownership', () => {
  it.each(['adjust_plan', 'unachievable'] as const)(
    'retains a succeeded Workflow when Goal evaluation is %s',
    async (decision) => {
      const fixture = setup(true);
      const experience = {
        ...fixture.experience,
        evaluation: { decision, summary: 'Workflow finished, Goal remains unmet.' },
        successful: false,
      };
      await expect(fixture.reader.read(experience)).resolves.toEqual({
        instanceStatus: 'succeeded',
        invocations: [fixture.invocation],
      });
      expect(fixture.reads()).toBe(1);
    },
  );
  it.each([true, false])(
    'reads only exact instance invocations (successful=%s)',
    async (successful) => {
      const fixture = setup(successful);
      expect(await fixture.reader.read(fixture.experience)).toEqual({
        instanceStatus: successful ? 'succeeded' : 'failed',
        invocations: [fixture.invocation],
      });
    },
  );
  it.each(['task', 'plan', 'goal', 'input', 'result', 'errors', 'status'] as const)(
    'rejects %s attribution drift before accessing recordings',
    async (fault) => {
      const fixture = setup(true);
      if (fault === 'status') fixture.instance.status = 'failed';
      if (fault === 'task') fixture.plan.executionTaskId = 'other-task';
      if (fault === 'plan')
        fixture.plan.definition = { ...fixture.experience.workflow, version: 2 };
      if (fault === 'goal') fixture.plan.goalVersion = 2;
      if (fault === 'input') fixture.instance.input = { id: 'other' };
      if (fault === 'result') fixture.instance.result = false;
      if (fault === 'errors')
        fixture.instance.errors = { second: { code: 'different', message: 'different' } };
      await expect(fixture.reader.read(fixture.experience)).rejects.toMatchObject({
        code:
          fault === 'task' || fault === 'plan' || fault === 'goal'
            ? 'SKILL_EVOLUTION_SOURCE_PLAN_MISMATCH'
            : 'SKILL_EVOLUTION_SOURCE_INSTANCE_MISMATCH',
      });
      expect(fixture.reads()).toBe(0);
    },
  );
});

function setup(successful: boolean) {
  const experience: EvolutionExperience = {
    experienceId: 'experience',
    controlId: 'control',
    roundIndex: 0,
    taskId: 'task',
    contextId: 'context',
    goal: {
      goalId: 'goal',
      version: 1,
      title: 'Read',
      description: 'Read status',
      constraints: [],
      successCriteria: ['status'],
    },
    workflow: {
      workflowDefinitionId: 'workflow',
      version: 1,
      goalId: 'goal',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        { nodeId: 'result', name: 'Result', type: 'result', value: { op: 'literal', value: true } },
      ],
      edges: [],
    },
    instanceId: 'instance',
    skillVersions: [],
    tools: [],
    input: { id: 'a' },
    ...(successful ? { result: true } : {}),
    errors: successful ? {} : { second: { code: 'OFFLINE', message: 'Offline' } },
    evaluation: {
      decision: successful ? 'achieved' : 'unachievable',
      summary: 'Recorded terminal result',
    },
    successful,
    durationMs: 1000,
    createdAt: timestamp,
  };
  const instance: { -readonly [P in keyof WorkflowInstance]: WorkflowInstance[P] } = {
    instanceId: 'instance',
    planId: 'plan',
    workflowDefinitionId: 'workflow',
    workflowVersion: 1,
    goalId: 'goal',
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: budgetCeiling,
    budgetUsage: { durationMs: 1000, replanCount: 0, llmCalls: 0, mcpCalls: 1, cost: 0 },
    status: successful ? 'succeeded' : 'failed',
    input: experience.input,
    ...(successful ? { result: experience.result } : {}),
    errors: experience.errors,
    startedAt: timestamp,
    completedAt: '2026-10-11T00:00:01.000Z',
  };
  const plan: { -readonly [P in keyof WorkflowPlanRecord]: WorkflowPlanRecord[P] } = {
    planId: 'plan',
    executionTaskId: 'task',
    goalId: 'goal',
    goalVersion: 1,
    goalContract: experience.goal,
    definition: experience.workflow,
    confirmationStatus: 'confirmed',
    attemptCount: 1,
    createdAt: timestamp,
  };
  const invocation: McpInvocation = {
    invocationId: 'included',
    serverId: 'local',
    toolName: 'read',
    arguments: { id: 'a' },
    taskId: 'task',
    executionMode: 'live',
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'allowed',
      source: 'mcp_declared',
    },
    status: 'succeeded',
    result: { content: [], structuredContent: true, isError: false },
    startedAt: timestamp,
    completedAt: '2026-10-11T00:00:00.500Z',
    durationMs: 500,
  };
  let reads = 0;
  const reader = new PostgresBackedSkillRecordingReader({
    executions: { findInstance: () => Promise.resolve(instance) },
    plans: { findPlan: () => Promise.resolve(plan) },
    mcp: {
      listInvocationsByTask: () => {
        reads++;
        return Promise.resolve([
          invocation,
          { ...invocation, invocationId: 'outside', completedAt: '2026-10-11T00:00:02.000Z' },
          { ...invocation, invocationId: 'peer', taskId: 'peer' },
        ]);
      },
    },
  });
  return { reader, plan, instance, experience, invocation, reads: () => reads };
}
