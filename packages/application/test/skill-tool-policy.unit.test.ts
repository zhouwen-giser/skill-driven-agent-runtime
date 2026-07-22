import { describe, expect, it } from 'vitest';

import { createSkillVersion, type WorkflowDefinition } from '../../domain/src/index.js';
import { validateSkillToolPolicies } from '../src/skill-tool-policy.js';

describe('validateSkillToolPolicies', () => {
  it('reports missing required Tools and used forbidden Tools with the exact Skill version', () => {
    const required = { serverId: 'mcp.device', toolName: 'required_read' };
    const forbidden = { serverId: 'mcp.device', toolName: 'delete_device' };
    const skill = createSkillVersion({
      skillId: 'skill.policy',
      version: 4,
      name: 'Policy Skill',
      summary: 'Policy.',
      description: 'Tool policy validation.',
      capabilities: ['policy'],
      workflowGuidance: 'Follow policy.',
      outputInstruction: 'Return result.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [required], optional: [], forbidden: [forbidden] },
      runtimePolicy: { autoConfirmPlan: false },
      outcomeSpecification: {
        schemaVersion: '1.0',
        skillId: 'skill.policy',
        skillVersion: 4,
        specificationHash: `sha256:${'d'.repeat(64)}`,
        effects: ['effect.test'],
        evidence: ['evidence.test'],
        artifacts: [],
        taskGoalPolicy: {},
        confidencePolicy: {},
        sideEffectPolicy: {},
      },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const definition: WorkflowDefinition = {
      workflowDefinitionId: 'workflow.policy',
      version: 1,
      goalId: 'goal.policy',
      goalVersion: 1,
      entryNodeId: 'forbidden',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'forbidden',
          name: 'Forbidden',
          type: 'mcp_tool',
          tool: forbidden,
          arguments: {},
        },
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'literal', value: true },
        },
      ],
      edges: [{ sourceNodeId: 'forbidden', targetNodeId: 'result' }],
    };

    expect(validateSkillToolPolicies(definition, [skill])).toEqual([
      {
        code: 'SKILL_REQUIRED_TOOL_MISSING',
        skillId: 'skill.policy',
        skillVersion: 4,
        tool: required,
      },
      {
        code: 'SKILL_FORBIDDEN_TOOL_USED',
        skillId: 'skill.policy',
        skillVersion: 4,
        tool: forbidden,
      },
    ]);
  });
});
