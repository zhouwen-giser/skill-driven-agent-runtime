import { describe, expect, it } from 'vitest';
import {
  isDevelopmentPreauthorizedPlan,
  developmentPreauthorizationPrincipal,
} from '../src/development-plan-confirmation.js';
import { prepareUgvMoveWorkflowPlan } from '../src/ugv-move-workflow.js';
import {
  ugvWorkflowPlanningFixture,
  UGV_WORKFLOW_GOAL,
  UGV_WORKFLOW_IDENTITY,
} from './ugv-move-workflow-test-fixture.js';

describe('development deployment preauthorization', () => {
  it('classifies the real frozen navigation DSL without changing Skill confirmation policy', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const definition = prepared.deterministicDefinition;
    expect(isDevelopmentPreauthorizedPlan('embodied.move_to', definition)).toBe(true);
    expect(isDevelopmentPreauthorizedPlan('ugv.fire-weapon', definition)).toBe(false);
    expect(
      isDevelopmentPreauthorizedPlan('embodied.move_to', {
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.type === 'mcp_tool'
            ? { ...node, tool: { ...node.tool, toolName: 'vehicle_fire_weapon' } }
            : node,
        ),
      }),
    ).toBe(false);
    expect(isDevelopmentPreauthorizedPlan('custom.unclassified', definition)).toBe(false);
  });
  it('records deployment-owner preauthorization rather than a fabricated interactive action', () => {
    const principal = developmentPreauthorizationPrincipal('human:owner', 'task-1', 'plan-2');
    expect(principal.authenticationMethod).toBe('deployment_preauthorized');
    expect(principal.requestId).toBe('development-preauthorization:task-1:plan-2');
    expect(principal.permissions.has('weapon_control.confirm')).toBe(false);
  });
});
