import type { Goal } from './goal.js';
import type { ToolReference } from './skill.js';
import type { GoalEvaluationResult } from './workflow-control.js';
import type { WorkflowDefinition, WorkflowInstance } from './workflow.js';

export interface EvolutionExperience {
  readonly experienceId: string;
  readonly controlId: string;
  readonly roundIndex: number;
  readonly taskId?: string;
  readonly contextId: string;
  readonly goal: Pick<
    Goal,
    'goalId' | 'version' | 'title' | 'description' | 'constraints' | 'successCriteria'
  >;
  readonly workflow: WorkflowDefinition;
  readonly instanceId: string;
  readonly skillVersions: WorkflowInstance['skillVersions'];
  readonly tools: readonly ToolReference[];
  readonly input: unknown;
  readonly result?: unknown;
  readonly errors: WorkflowInstance['errors'];
  readonly evaluation: GoalEvaluationResult;
  readonly successful: boolean;
  readonly durationMs: number;
  readonly createdAt: string;
}
