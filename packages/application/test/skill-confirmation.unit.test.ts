import { describe, expect, it } from 'vitest';

import type { SkillRelation, SkillVersion, WorkflowDefinition } from '../../domain/src/index.js';
import { TransitiveSkillConfirmationEvaluator } from '../src/skill-confirmation.js';

describe('TransitiveSkillConfirmationEvaluator', () => {
  it('blocks top-level auto-confirm when a directly planned child opts out', async () => {
    const evaluator = confirmationEvaluator([
      skill('skill.parent', true),
      skill('skill.child', false),
    ]);

    await expect(evaluator.evaluate(['skill.parent'], workflow(['skill.child']))).resolves.toEqual({
      autoConfirm: false,
      skillVersions: [
        { skillId: 'skill.child', version: 1 },
        { skillId: 'skill.parent', version: 1 },
      ],
      blockingSkillIds: ['skill.child'],
    });
  });

  it('allows a child plan to auto-confirm even when its already-confirmed parent opted out', async () => {
    const evaluator = confirmationEvaluator([
      skill('skill.parent', false),
      skill('skill.child', true),
    ]);

    await expect(evaluator.evaluate(['skill.child'], workflow([]))).resolves.toMatchObject({
      autoConfirm: true,
      blockingSkillIds: [],
    });
  });

  it('conservatively traverses multi-level execution relations and ignores alternatives', async () => {
    const evaluator = confirmationEvaluator(
      [
        skill('skill.parent', true),
        skill('skill.child', true),
        skill('skill.grandchild', false),
        skill('skill.alternative', false),
      ],
      [
        relation('relation-1', 'skill.parent', 'skill.child', 'parent_child'),
        relation('relation-2', 'skill.child', 'skill.grandchild', 'composition'),
        relation('relation-3', 'skill.parent', 'skill.alternative', 'alternative'),
      ],
    );

    const result = await evaluator.evaluate(['skill.parent'], workflow([]));

    expect(result.autoConfirm).toBe(false);
    expect(result.blockingSkillIds).toEqual(['skill.grandchild']);
    expect(result.skillVersions.map(({ skillId }) => skillId)).not.toContain('skill.alternative');
  });

  it('fails closed for disabled or missing reachable Skills', async () => {
    const disabled = { ...skill('skill.disabled', true), status: 'disabled' as const };
    const evaluator = confirmationEvaluator([skill('skill.parent', true), disabled]);

    await expect(
      evaluator.evaluate(['skill.parent'], workflow(['skill.disabled', 'skill.missing'])),
    ).resolves.toMatchObject({
      autoConfirm: false,
      blockingSkillIds: ['skill.disabled', 'skill.missing'],
    });
  });
});

function confirmationEvaluator(
  skills: readonly SkillVersion[],
  relations: readonly SkillRelation[] = [],
) {
  const versions = new Map(skills.map((version) => [version.skillId, version]));
  return new TransitiveSkillConfirmationEvaluator({
    skills: {
      findCurrentVersion: (skillId: string) => Promise.resolve(versions.get(skillId)),
    } as never,
    graph: { listRelations: () => Promise.resolve(relations) } as never,
  });
}

function workflow(childSkillIds: readonly string[]): WorkflowDefinition {
  return {
    workflowDefinitionId: 'workflow.confirmation',
    version: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    entryNodeId: 'result',
    exitNodeIds: ['result'],
    nodes: [
      ...childSkillIds.map(
        (skillId, index) =>
          ({
            nodeId: `child-${String(index)}`,
            name: skillId,
            type: 'skill_call' as const,
            skillId,
            input: null,
          }) satisfies WorkflowDefinition['nodes'][number],
      ),
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result' as const,
        value: { op: 'literal', value: true },
      },
    ],
    edges: [],
  };
}

function skill(skillId: string, autoConfirmPlan: boolean): SkillVersion {
  return {
    skillId,
    version: 1,
    name: skillId,
    summary: skillId,
    description: skillId,
    capabilities: [skillId],
    workflowGuidance: 'Use the plan.',
    outputInstruction: 'Return JSON.',
    inputSchema: {},
    outputSchema: {},
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-16T00:00:00.000Z',
  };
}

function relation(
  relationId: string,
  sourceSkillId: string,
  targetSkillId: string,
  relationType: SkillRelation['relationType'],
): SkillRelation {
  return {
    relationId,
    sourceSkillId,
    targetSkillId,
    relationType,
    metadata: {},
    createdAt: '2026-07-16T00:00:00.000Z',
  };
}
