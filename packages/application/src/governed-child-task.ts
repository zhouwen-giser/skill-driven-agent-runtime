import type {
  GoalExecutionContract,
  SkillVersion,
  WorkflowInstance,
  WorkflowPlanRecord,
  RuntimeExecutionContext,
} from '../../domain/src/index.js';
import type { TaskPlanConfirmationAuthority } from './task-service.js';

/** A composed physical Skill gets its own native Task, Goal, binding, confirmation and continuation. */
export interface GovernedChildTaskPort {
  prepare(
    input: Readonly<{
      callId: string;
      childPlanId: string;
      parentPlan: WorkflowPlanRecord;
      parentInstanceId: string;
      parentNodeId: string;
      parentNodeRunId: string;
      parentTaskId?: string;
      skill: SkillVersion;
      value: unknown;
    }>,
  ): Promise<Readonly<{ taskId: string; goalContract: GoalExecutionContract }> | undefined>;
  attach(
    input: Readonly<{
      taskId: string;
      plan: WorkflowPlanRecord;
      skill: SkillVersion;
      value: unknown;
    }>,
  ): Promise<void>;
  confirm(
    childPlanId: string,
    authority: TaskPlanConfirmationAuthority | undefined,
  ): Promise<boolean>;
  execute(
    input: Readonly<{
      childPlanId: string;
      childInstanceId: string;
      value: unknown;
      skill: SkillVersion;
      executionContext?: RuntimeExecutionContext;
      signal?: AbortSignal;
      onStarted(instance: WorkflowInstance): Promise<void>;
    }>,
  ): Promise<WorkflowInstance | undefined>;
  reject(childPlanId: string): Promise<void>;
  cancelChildren(parentTaskId: string, parentPlanId: string): Promise<void>;
}
