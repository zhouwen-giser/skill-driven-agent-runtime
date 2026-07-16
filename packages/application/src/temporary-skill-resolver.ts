import { z } from 'zod';

import {
  snapshotGoalExecutionContract,
  type AgentTask,
  type GoalExecutionContract,
  type TemporarySkill,
} from '../../domain/src/index.js';

import type { McpRegistryRepository, StructuredModelProvider } from './ports.js';
import type { TemporarySkillService } from './temporary-skill.js';

const DecisionSchema = z.object({
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  outputSchema: z.unknown(),
  decisionSummary: z.string().min(1),
});

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['serverId', 'toolName', 'name', 'description', 'outputSchema', 'decisionSummary'],
  properties: {
    serverId: { type: 'string', minLength: 1 },
    toolName: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    outputSchema: {},
    decisionSummary: { type: 'string', minLength: 1 },
  },
} as const;

export class TemporarySkillResolver {
  readonly #mcp: Pick<McpRegistryRepository, 'listServers' | 'listTools'>;
  readonly #model: StructuredModelProvider;
  readonly #temporarySkills: Pick<TemporarySkillService, 'create'>;

  constructor(
    dependencies: Readonly<{
      mcp: Pick<McpRegistryRepository, 'listServers' | 'listTools'>;
      model: StructuredModelProvider;
      temporarySkills: Pick<TemporarySkillService, 'create'>;
    }>,
  ) {
    this.#mcp = dependencies.mcp;
    this.#model = dependencies.model;
    this.#temporarySkills = dependencies.temporarySkills;
  }

  async resolve(
    goalContract: GoalExecutionContract,
    task: AgentTask,
  ): Promise<
    Readonly<{
      skill: TemporarySkill;
      decisionSummary: string;
    }>
  > {
    const contractSnapshot = snapshotGoalExecutionContract(goalContract);
    const servers = (await this.#mcp.listServers()).filter((server) => server.status === 'enabled');
    const tools = (
      await Promise.all(
        servers.map(async (server) =>
          (await this.#mcp.listTools(server.serverId)).map((tool) => ({
            serverId: tool.serverId,
            toolName: tool.toolName,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        ),
      )
    ).flat();
    if (tools.length === 0) throw new Error('TEMPORARY_SKILL_NO_ENABLED_MCP_TOOL');
    const decision = DecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'skill_authoring',
        instruction: JSON.stringify({
          operation: 'resolve_temporary_skill',
          goalContract: contractSnapshot,
          tools,
        }),
        responseSchema,
        correctionErrors: [],
      }),
    );
    const selected = tools.find(
      (tool) => tool.serverId === decision.serverId && tool.toolName === decision.toolName,
    );
    if (selected === undefined) throw new Error('TEMPORARY_SKILL_MODEL_SELECTED_UNKNOWN_TOOL');
    const skill = await this.#temporarySkills.create({
      taskId: task.taskId,
      contextId: task.contextId,
      name: decision.name,
      description: decision.description,
      tools: [{ serverId: selected.serverId, toolName: selected.toolName }],
      inputSchema: selected.inputSchema,
      outputSchema: decision.outputSchema,
    });
    return { skill, decisionSummary: decision.decisionSummary };
  }
}
