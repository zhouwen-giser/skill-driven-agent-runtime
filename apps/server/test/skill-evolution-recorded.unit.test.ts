import { describe, expect, it } from 'vitest';
import type {
  EvolutionExperience,
  McpInvocation,
  McpTool,
  WorkflowDefinition,
} from '../../../packages/domain/src/index.js';
import { freezeEvolutionSkill } from '../../../packages/application/src/skill-evolution-authority.js';
import { RecordedSkillCandidateValidator } from '../../../packages/application/src/recorded-skill-candidate-validator.js';
import {
  budgetCeiling,
  evolutionAuthorityFixture,
  schemas,
  timestamp,
  tool,
} from '../../../packages/application/test/skill-evolution-fixture.js';
import { recordedSkillValidationExecutor } from '../src/composition/skill-evolution.js';

describe('recorded candidate validation through the real LangGraph executor', () => {
  it('plans the unpublished candidate and executes every recorded call before comparing its output', async () => {
    const fixture = setup();
    const result = await fixture.run();
    expect(result.passed, JSON.stringify(result)).toBe(true);
    expect(result.evidence).toMatchObject({
      status: 'succeeded',
      invocationIds: ['call-1', 'call-2'],
      modelInvocationIds: ['model-1'],
    });
    expect(result.evidence.definition?.workflowDefinitionId).not.toBe(
      fixture.experience.workflow.workflowDefinitionId,
    );
    expect(fixture.instructions[0]).toContain('Candidate-specific revised guidance');
    expect(fixture.target.status).toBe('draft');
    expect(fixture.target.validationPassed).toBe(false);
    expect(result.evidence.assertions.every((item) => item.passed)).toBe(true);
  });

  it('checks a recorded failure at the second call, without turning it into an unconditional pass', async () => {
    const fixture = setup({ failedSecond: true });
    const result = await fixture.run();
    expect(result.passed, JSON.stringify(result)).toBe(true);
    expect(result.evidence.status).toBe('failed');
    expect(result.evidence.errorCodes).toEqual(['DEVICE_OFFLINE']);
    expect(result.evidence.invocationIds).toEqual(['call-1', 'call-2']);
    const omitted = await setup({ failedSecond: true, omitSecond: true }).run();
    expect(omitted.passed).toBe(false);
    expect(omitted.evidence.assertions).toContainEqual({
      name: 'all_recorded_calls_consumed',
      passed: false,
    });
  });

  it.each(['arguments', 'output', 'confirmation', 'missing', 'forbidden'] as const)(
    'rejects %s drift without any live fallback',
    async (fault) => {
      const result = await setup({ fault }).run();
      expect(result.passed).toBe(false);
      expect(result.evidence.assertions.some((item) => !item.passed)).toBe(true);
      if (fault === 'missing' || fault === 'forbidden' || fault === 'arguments')
        expect(result.evidence.assertions).toContainEqual({
          name: 'no_missing_or_live_transport',
          passed: false,
        });
    },
  );
});

function setup(
  options: {
    failedSecond?: boolean;
    omitSecond?: boolean;
    fault?: 'arguments' | 'output' | 'confirmation' | 'missing' | 'forbidden';
  } = {},
) {
  const { proposed, base } = evolutionAuthorityFixture();
  const target = freezeEvolutionSkill({
    proposed: { ...proposed, workflowGuidance: 'Candidate-specific revised guidance' },
    base,
    sourceTools: [tool],
    budgetCeiling,
    schemas,
    timestamp,
  });
  const registered: McpTool = {
    ...tool,
    inputSchema: proposed.inputSchema,
    discoveredAt: timestamp,
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: options.fault === 'forbidden' ? 'forbidden' : 'allowed',
      source: 'mcp_declared',
    },
  };
  const recordings: McpInvocation[] = [1, 2].map((index) => ({
    ...tool,
    invocationId: `call-${String(index)}`,
    taskId: 'source-task',
    executionMode: 'live',
    executionSemantics: registered.executionSemantics,
    arguments: { id: 'normal' },
    status: index === 2 && options.failedSecond === true ? 'failed' : 'succeeded',
    ...(index === 2 && options.failedSecond === true
      ? { errorCode: 'DEVICE_OFFLINE', errorMessage: 'Source second call failed.' }
      : { result: { content: [], structuredContent: { status: 'online' }, isError: false } }),
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
  }));
  const original = definition('original-plan', {});
  const experience: EvolutionExperience = {
    experienceId: 'source-history',
    controlId: 'source-control',
    roundIndex: 0,
    taskId: 'source-task',
    contextId: 'source-context',
    goal: {
      goalId: 'goal',
      version: 1,
      title: 'Read status',
      description: 'Read status twice',
      constraints: [],
      successCriteria: ['Recorded status'],
    },
    workflow: original,
    instanceId: 'source-instance',
    skillVersions: [{ skillId: base.skillId, version: base.version }],
    tools: [tool],
    input: { id: 'normal' },
    ...(options.failedSecond === true ? {} : { result: { status: 'online' } }),
    errors:
      options.failedSecond === true
        ? { second: { code: 'DEVICE_OFFLINE', message: 'Source second call failed.' } }
        : {},
    evaluation:
      options.failedSecond === true
        ? { decision: 'unachievable', summary: 'Device offline' }
        : { decision: 'achieved', summary: 'Recorded status' },
    successful: options.failedSecond !== true,
    durationMs: 10,
    createdAt: timestamp,
  };
  const instructions: string[] = [];
  let sequence = 0;
  const validator = new RecordedSkillCandidateValidator({
    skills: {
      findCurrentVersion: () => Promise.resolve(base),
      findVersion: () => Promise.resolve(base),
      listEnabledVersions: () => Promise.resolve([base]),
    },
    graph: { listRelationsFrom: () => Promise.resolve([]) },
    schemas,
    model: {
      generateStructuredWithAudit: (request) => {
        instructions.push(request.instruction);
        const parsed = JSON.parse(request.instruction) as {
          usage: { workflowIdentity: { workflowDefinitionId: string } };
        };
        return Promise.resolve({
          structuredResult: definition(parsed.usage.workflowIdentity.workflowDefinitionId, options),
          invocationId: 'model-1',
        });
      },
    },
    executor: recordedSkillValidationExecutor,
    recordings: { read: () => Promise.resolve(options.fault === 'missing' ? [] : recordings) },
    workflowSchema: { type: 'object' },
    clock: { now: () => timestamp },
    nextId: () => String(++sequence),
    budgetCeiling,
  });
  return {
    target,
    experience,
    instructions,
    run: () => validator.validate({ caseId: 'case', target, experience, tools: [registered] }),
  };
}

function definition(
  id: string,
  options: { omitSecond?: boolean; fault?: string },
): WorkflowDefinition {
  const resultSource = options.omitSecond === true ? 'first' : 'second';
  const calls: WorkflowDefinition['nodes'] = [
    {
      nodeId: 'first',
      name: 'First read',
      type: 'mcp_tool',
      tool,
      arguments: {
        id: options.fault === 'arguments' ? 'unrecorded' : { op: 'ref', path: ['input', 'id'] },
      },
    },
    ...(options.omitSecond === true
      ? []
      : [
          {
            nodeId: 'second',
            name: 'Second read',
            type: 'mcp_tool' as const,
            tool,
            arguments: { id: { op: 'ref' as const, path: ['input', 'id'] } },
          },
        ]),
  ];
  return {
    executionSemanticsVersion: '2.0',
    workflowDefinitionId: id,
    version: 1,
    goalId: 'goal',
    goalVersion: 1,
    entryNodeId: 'first',
    exitNodeIds: ['result'],
    nodes: [
      ...calls,
      ...(options.fault === 'confirmation'
        ? [
            {
              nodeId: 'confirm',
              name: 'Confirm',
              type: 'human_confirmation' as const,
              prompt: 'Confirm test',
            },
          ]
        : []),
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result',
        value:
          options.fault === 'output'
            ? { op: 'literal', value: 'invalid-object-output' }
            : { op: 'ref', path: ['nodes', resultSource, 'data', 'structuredContent'] },
      },
    ],
    edges: [
      ...(options.omitSecond === true ? [] : [{ sourceNodeId: 'first', targetNodeId: 'second' }]),
      {
        sourceNodeId: resultSource,
        targetNodeId: options.fault === 'confirmation' ? 'confirm' : 'result',
      },
      ...(options.fault === 'confirmation'
        ? [{ sourceNodeId: 'confirm', targetNodeId: 'result' }]
        : []),
    ],
  };
}
