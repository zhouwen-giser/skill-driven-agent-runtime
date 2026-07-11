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
  });
});
