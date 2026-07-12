import type { SkillVersion, ToolReference, WorkflowDefinition } from '../../domain/src/index.js';

export interface SkillToolPolicyViolation {
  readonly code: 'SKILL_REQUIRED_TOOL_MISSING' | 'SKILL_FORBIDDEN_TOOL_USED';
  readonly skillId: string;
  readonly skillVersion: number;
  readonly tool: ToolReference;
}

export function validateSkillToolPolicies(
  definition: WorkflowDefinition,
  skills: readonly SkillVersion[],
): readonly SkillToolPolicyViolation[] {
  const used = new Set(
    definition.nodes.filter((node) => node.type === 'mcp_tool').map((node) => toolKey(node.tool)),
  );
  const violations: SkillToolPolicyViolation[] = [];
  for (const skill of skills) {
    for (const tool of skill.toolPolicy.required)
      if (!used.has(toolKey(tool)))
        violations.push({
          code: 'SKILL_REQUIRED_TOOL_MISSING',
          skillId: skill.skillId,
          skillVersion: skill.version,
          tool,
        });
    for (const tool of skill.toolPolicy.forbidden)
      if (used.has(toolKey(tool)))
        violations.push({
          code: 'SKILL_FORBIDDEN_TOOL_USED',
          skillId: skill.skillId,
          skillVersion: skill.version,
          tool,
        });
  }
  return violations;
}

function toolKey(tool: ToolReference): string {
  return `${tool.serverId}\u0000${tool.toolName}`;
}
