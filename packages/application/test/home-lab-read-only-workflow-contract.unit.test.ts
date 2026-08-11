import { describe, expect, it } from 'vitest';

import type { SkillUsagePlanPolicy, WorkflowDefinition } from '../../domain/src/index.js';
import { homeLabA2AModelDecision } from '../../../apps/node-control-acceptance/src/home-lab-a2a-model-contract.js';
import {
  HomeLabReadOnlyWorkflowCandidateGuard,
  assertHomeLabReadOnlyWorkflowContract,
} from '../src/index.js';

describe('home-lab read-only Workflow candidate contract', () => {
  it('accepts only the exact model candidate shared with the A2A driver', () => {
    const valid = workflow('valid');
    expect(() => {
      assertHomeLabReadOnlyWorkflowContract(valid);
    }).not.toThrow();
    for (const [mode, code] of [
      ['workflow_wrong_resource_ref', 'HOME_LAB_READ_ONLY_WORKFLOW_TOOL_BINDING_INVALID'],
      ['workflow_unreachable', 'HOME_LAB_READ_ONLY_WORKFLOW_TOPOLOGY_INVALID'],
      ['workflow_wrong_result_mapping', 'HOME_LAB_READ_ONLY_WORKFLOW_RESULT_MAPPING_INVALID'],
    ] as const) {
      expect(() => {
        assertHomeLabReadOnlyWorkflowContract(workflow(mode));
      }).toThrow(expect.objectContaining({ code }));
    }
  });

  it('requires the exact selected composite Skill policy for initial planning and replans', () => {
    const guard = new HomeLabReadOnlyWorkflowCandidateGuard();
    expect(
      guard.validate({
        definition: workflow('valid'),
        skillUsagePolicy: policy('home.living-room.get-state', 1),
        compositionRoot: { skillId: 'home.living-room.get-state', skillVersion: 1 },
      }),
    ).toEqual([]);
    expect(
      guard.validate({
        definition: workflow('valid'),
        skillUsagePolicy: policy('home.living-room.get-state', 1),
      }),
    ).toEqual([]);
    for (const mode of [
      'workflow_wrong_resource_ref',
      'workflow_unreachable',
      'workflow_wrong_result_mapping',
    ] as const)
      expect(
        guard.validate({
          definition: workflow(mode),
          skillUsagePolicy: policy('home.living-room.get-state', 1),
          compositionRoot: { skillId: 'home.living-room.get-state', skillVersion: 1 },
        }),
      ).toHaveLength(1);
    expect(
      guard.validate({
        definition: workflow('valid'),
        skillUsagePolicy: policy('unrelated.skill', 1),
        compositionRoot: { skillId: 'unrelated.skill', skillVersion: 1 },
      }),
    ).toHaveLength(1);
    expect(
      guard.validate({
        definition: workflow('valid'),
        skillUsagePolicy: policy('home.living-room.get-state', 1),
        compositionRoot: { skillId: 'unrelated.skill', skillVersion: 1 },
      }),
    ).toHaveLength(1);
    expect(guard.validate({ definition: workflow('valid') })).toHaveLength(1);
  });
});

function workflow(
  mode:
    | 'valid'
    | 'workflow_wrong_resource_ref'
    | 'workflow_unreachable'
    | 'workflow_wrong_result_mapping',
): WorkflowDefinition {
  return homeLabA2AModelDecision(
    JSON.stringify({
      operation: 'task_initial_plan',
      workflowIdentity: {
        workflowDefinitionId: 'workflow.g08',
        version: 1,
        goalId: 'goal.g08',
        goalVersion: 1,
      },
    }),
    mode,
  ).structuredResult as unknown as WorkflowDefinition;
}

function policy(skillId: string, skillVersion: number): SkillUsagePlanPolicy {
  return { skill: { skillId, skillVersion } } as unknown as SkillUsagePlanPolicy;
}
