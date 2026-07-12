import type {
  EvolutionExperience,
  Goal,
  GoalEvaluationResult,
  ToolReference,
  WorkflowDefinition,
  WorkflowInstance,
} from '../../domain/src/index.js';

import type { EvolutionExperienceRepository } from './ports.js';

export class EvolutionExperienceService {
  readonly #repository: EvolutionExperienceRepository;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: EvolutionExperienceRepository;
      nextId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#nextId = dependencies.nextId;
  }

  async record(
    input: Readonly<{
      controlId: string;
      roundIndex: number;
      taskId?: string;
      contextId: string;
      goal: Goal;
      workflow: WorkflowDefinition;
      instance: WorkflowInstance;
      evaluation: GoalEvaluationResult;
      createdAt: string;
    }>,
  ): Promise<EvolutionExperience> {
    const experience: EvolutionExperience = {
      experienceId: this.#nextId(),
      controlId: input.controlId,
      roundIndex: input.roundIndex,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      contextId: input.contextId,
      goal: {
        goalId: input.goal.goalId,
        version: input.goal.version,
        title: input.goal.title,
        description: input.goal.description,
        constraints: input.goal.constraints,
        successCriteria: input.goal.successCriteria,
      },
      workflow: input.workflow,
      instanceId: input.instance.instanceId,
      skillVersions: input.instance.skillVersions,
      tools: workflowTools(input.workflow),
      input: input.instance.input,
      ...(input.instance.result === undefined ? {} : { result: input.instance.result }),
      errors: input.instance.errors,
      evaluation: input.evaluation,
      successful: input.instance.status === 'succeeded' && input.evaluation.decision === 'achieved',
      durationMs: elapsed(input.instance.startedAt, input.instance.completedAt ?? input.createdAt),
      createdAt: input.createdAt,
    };
    await this.#repository.save(experience);
    return experience;
  }

  get(experienceId: string): Promise<EvolutionExperience | undefined> {
    return this.#repository.find(experienceId);
  }

  listByGoal(goalId: string): Promise<readonly EvolutionExperience[]> {
    return this.#repository.listByGoal(goalId);
  }

  listBySkill(skillId: string): Promise<readonly EvolutionExperience[]> {
    return this.#repository.listBySkill(skillId);
  }
}

function workflowTools(workflow: WorkflowDefinition): readonly ToolReference[] {
  const unique = new Map<string, ToolReference>();
  for (const node of workflow.nodes)
    if (node.type === 'mcp_tool')
      unique.set(`${node.tool.serverId}/${node.tool.toolName}`, node.tool);
  return [...unique.values()];
}

function elapsed(start: string, end: string): number {
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}
