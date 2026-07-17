import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AjvJsonSchemaValidator } from '../src/index.js';

describe('Workflow DSL JSON Schema contract', () => {
  it('is valid draft 2020-12 and rejects executable or unbounded nodes', async () => {
    const schema = JSON.parse(
      await readFile(new URL('../../../schemas/workflow-dsl.schema.json', import.meta.url), 'utf8'),
    ) as unknown;
    const validator = new AjvJsonSchemaValidator();
    expect(validator.checkSchema(schema)).toEqual({ valid: true, errors: [] });
    const base = {
      workflowDefinitionId: 'workflow.test',
      version: 1,
      goalId: 'goal.test',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      edges: [],
    };
    expect(
      validator.validate(schema, {
        ...base,
        nodes: [
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
      }).valid,
    ).toBe(true);
    expect(
      validator.validate(schema, {
        ...base,
        entryNodeId: 'evil',
        exitNodeIds: ['evil'],
        nodes: [{ nodeId: 'evil', name: 'Evil', type: 'javascript', source: 'process.exit()' }],
      }).valid,
    ).toBe(false);
    expect(
      validator.validate(schema, {
        ...base,
        entryNodeId: 'child',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'child',
            name: 'Child',
            type: 'skill_call',
            skillId: 'skill.child',
            input: { op: 'ref', path: ['input'] },
          },
          {
            nodeId: 'handler',
            name: 'Recover child',
            type: 'error_handler',
            handledNodeId: 'child',
            strategy: 'goto',
            skillFailurePolicy: 'recoverable',
            gotoNodeId: 'result',
          },
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        edges: [{ sourceNodeId: 'child', targetNodeId: 'result' }],
      }).valid,
    ).toBe(true);
    expect(
      validator.validate(schema, {
        ...base,
        entryNodeId: 'loop',
        exitNodeIds: ['loop'],
        nodes: [
          {
            nodeId: 'loop',
            name: 'Loop',
            type: 'loop',
            condition: { op: 'literal', value: true },
            bodyEntryNodeId: 'loop',
            maxIterations: 0,
          },
        ],
      }).valid,
    ).toBe(false);

    const recoveryExample = JSON.parse(
      await readFile(
        new URL('../../../examples/workflow-mcp-recovery.json', import.meta.url),
        'utf8',
      ),
    ) as { nodes: { type: string; recoveryOptions?: { maxAttempts: number }[] }[] };
    expect(validator.validate(schema, recoveryExample).valid).toBe(true);
    const recoveryHandler = recoveryExample.nodes.find((node) => node.type === 'error_handler');
    if (recoveryHandler?.recoveryOptions === undefined)
      throw new Error('Recovery example is missing its error handler options.');
    const [firstRecovery, ...remainingRecoveries] = recoveryHandler.recoveryOptions;
    if (firstRecovery === undefined) throw new Error('Recovery example has no recovery options.');
    recoveryHandler.recoveryOptions = [
      { ...firstRecovery, maxAttempts: 11 },
      ...remainingRecoveries,
    ];
    expect(validator.validate(schema, recoveryExample).valid).toBe(false);
  });

  it('accepts recursive data bindings and rejects malformed or ambiguous references', async () => {
    const schema = JSON.parse(
      await readFile(new URL('../../../schemas/workflow-dsl.schema.json', import.meta.url), 'utf8'),
    ) as unknown;
    const validator = new AjvJsonSchemaValidator();
    const base = {
      workflowDefinitionId: 'workflow.binding',
      version: 1,
      goalId: 'goal.binding',
      goalVersion: 1,
      entryNodeId: 'llm',
      exitNodeIds: ['sub'],
      nodes: [
        {
          nodeId: 'llm',
          name: 'Structure input',
          type: 'llm',
          instruction: 'Structure the input.',
          context: {
            deviceId: { op: 'ref', path: ['input', 'deviceId'] },
            samples: [{ op: 'ref', path: ['input', 'samples', '0'] }],
          },
          responseSchema: { type: 'object' },
        },
        {
          nodeId: 'tool',
          name: 'Read device',
          type: 'mcp_tool',
          tool: { serverId: 'mcp.devices', toolName: 'device_status' },
          arguments: { deviceId: { op: 'ref', path: ['nodes', 'llm', 'deviceId'] } },
        },
        {
          nodeId: 'skill',
          name: 'Apply Skill',
          type: 'skill_call',
          skillId: 'skill.device',
          input: { payload: { op: 'ref', path: ['outputs', 'tool'] } },
        },
        {
          nodeId: 'sub',
          name: 'Run child',
          type: 'subworkflow',
          workflowDefinitionId: 'workflow.child',
          workflowVersion: 1,
          input: { op: 'ref', path: ['nodes', 'skill'] },
        },
      ],
      edges: [
        { sourceNodeId: 'llm', targetNodeId: 'tool' },
        { sourceNodeId: 'tool', targetNodeId: 'skill' },
        { sourceNodeId: 'skill', targetNodeId: 'sub' },
      ],
    };

    expect(validator.validate(schema, base).valid).toBe(true);
    for (const argumentsValue of [
      { op: 'ref', path: ['input'], extra: 'ambiguous' },
      { op: 'ref', path: [] },
      { op: 'ref', path: ['input', '$.deviceId'] },
    ]) {
      const candidate = structuredClone(base) as unknown as {
        nodes: Record<string, unknown>[];
      };
      const toolNode = candidate.nodes[1];
      if (toolNode === undefined) throw new Error('BINDING_TOOL_FIXTURE_MISSING');
      toolNode['arguments'] = argumentsValue;
      expect(validator.validate(schema, candidate).valid).toBe(false);
    }
    const missingInput = structuredClone(base) as unknown as {
      nodes: Record<string, unknown>[];
    };
    const subworkflowNode = missingInput.nodes[3];
    if (subworkflowNode === undefined) throw new Error('BINDING_SUBWORKFLOW_FIXTURE_MISSING');
    delete subworkflowNode['input'];
    expect(validator.validate(schema, missingInput).valid).toBe(false);

    const runtimeBindingExample = JSON.parse(
      await readFile(
        new URL('../../../examples/workflow-runtime-binding.json', import.meta.url),
        'utf8',
      ),
    ) as unknown;
    expect(validator.validate(schema, runtimeBindingExample)).toEqual({ valid: true, errors: [] });
  });

  it('strictly constrains MCP Task timing without adding an executable node kind', async () => {
    const schema = JSON.parse(
      await readFile(new URL('../../../schemas/workflow-dsl.schema.json', import.meta.url), 'utf8'),
    ) as unknown;
    const validator = new AjvJsonSchemaValidator();
    const candidate = {
      workflowDefinitionId: 'workflow.tasks',
      version: 1,
      goalId: 'goal.tasks',
      goalVersion: 1,
      entryNodeId: 'task',
      exitNodeIds: ['task'],
      nodes: [
        {
          nodeId: 'task',
          name: 'Scheduled Task',
          type: 'mcp_tool',
          tool: { serverId: 'provider', toolName: 'patrol' },
          arguments: { route: 'A' },
          taskExecution: {
            mode: 'require_task',
            availabilityCheck: 'required',
            timing: {
              start: {
                mode: 'scheduled',
                scheduledAt: { op: 'ref', path: ['input', 'scheduledAt'] },
                startToleranceMs: 0,
              },
              maxElapsedMs: null,
            },
          },
        },
      ],
      edges: [],
    };
    expect(validator.validate(schema, candidate)).toEqual({ valid: true, errors: [] });
    for (const mutate of [
      (node: Record<string, unknown>) => {
        node['source'] = 'globalThis';
      },
      (node: Record<string, unknown>) => {
        node['tool'] = { serverId: 'provider', toolName: 'patrol', source: 'evil' };
      },
      (node: Record<string, unknown>) => {
        node['taskExecution'] = { mode: 'require_task', extra: true };
      },
      (node: Record<string, unknown>) => {
        node['taskExecution'] = {
          mode: 'require_task',
          timing: {
            start: { mode: 'scheduled', scheduledAt: '$.input.time', startToleranceMs: -1 },
          },
        };
      },
      (node: Record<string, unknown>) => {
        node['taskExecution'] = {
          mode: 'require_task',
          timing: { start: { mode: 'immediate', startToleranceMs: 1 }, maxElapsedMs: 0 },
        };
      },
    ]) {
      const invalid = structuredClone(candidate) as { nodes: Record<string, unknown>[] };
      const node = invalid.nodes[0];
      if (node === undefined) throw new Error('TASK_NODE_FIXTURE_MISSING');
      mutate(node);
      expect(validator.validate(schema, invalid).valid).toBe(false);
    }
  });
});
