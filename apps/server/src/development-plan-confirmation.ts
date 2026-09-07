import type { GovernedControlPrincipal } from '../../../packages/application/src/index.js';
import type { WorkflowDefinition } from '../../../packages/domain/src/index.js';
import { UGV_AGENT_CAPABILITY_CATALOG } from './ugv-agent-profile-catalog.js';

const declarations = UGV_AGENT_CAPABILITY_CATALOG.filter((item) => item.kind !== 'weapon_control');
const tools: ReadonlySet<string> = new Set(declarations.map((item) => item.toolName));
const skills = new Set(declarations.map((item) => item.skillId));

/** Positive software-owned scope, not caller metadata. Unknown/custom plans remain manual. */
export function isDevelopmentPreauthorizedPlan(
  skillId: string,
  definition: WorkflowDefinition,
): boolean {
  return (
    skills.has(skillId) &&
    definition.nodes.every((node) => {
      if (node.type === 'mcp_tool') return tools.has(node.tool.toolName);
      // Nested plans are independently prepared/confirmed; never infer a child's tool scope here.
      if (node.type === 'skill_call') return false;
      return true;
    })
  );
}

export function developmentPreauthorizationPrincipal(
  actorId: string,
  taskId: string,
  planId: string,
): GovernedControlPrincipal {
  return Object.freeze({
    actorId,
    kind: 'human', // The configured deployment owner is the authorizer, not an interactive caller.
    authenticationMethod: 'deployment_preauthorized',
    permissions: new Set(['physical_control.confirm', 'physical_control.emergency_stop'] as const),
    requestId: `development-preauthorization:${taskId}:${planId}`,
  });
}
