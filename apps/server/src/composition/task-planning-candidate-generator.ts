import { randomUUID } from 'node:crypto';
import { zmqToolForSkill } from '../../../../packages/domain/src/zmq-capability.js';
import type {
  McpRegistryRepository,
  SkillCompositionPlanner,
  SkillRepository,
  SkillSelectionRepository,
  TemporarySkillRepository,
} from '../../../../packages/application/src/index.js';
import {
  buildMcpToolPlanningMetadata,
  prepareSkillUsagePlan,
  snapshotMcpToolPlanningExecutionSemantics,
  type SkillUsageSlotChoice,
} from '../../../../packages/application/src/index.js';
import { immutablePlanningSnapshot } from '../../../../packages/application/src/planning-candidate-snapshot.js';
import type {
  TaskPlanningProfilePolicy,
  TaskPlanPreparationInput,
} from '../../../../packages/application/src/task-planning-profile.js';
import type { WorkflowCandidateGenerator } from '../../../../packages/application/src/workflow-candidate-generator.js';
import {
  type AgentTask,
  type GoalExecutionContract,
  type SkillVersion,
} from '../../../../packages/domain/src/index.js';
import { resolveSkillUsageSelectionId } from './runtime-support.js';
export interface TaskPlanningCandidateDependencies {
  readonly skills: Pick<SkillRepository, 'findVersion'>;
  readonly temporarySkillRepository: Pick<TemporarySkillRepository, 'find'>;
  readonly skillSelectionRepository: Pick<SkillSelectionRepository, 'findSelection'>;
  readonly skillComposition: Pick<SkillCompositionPlanner, 'composeUsage' | 'interpretUsage'>;
  readonly resolveSkillUsageSlotChoices: (
    goalContract: GoalExecutionContract,
    skill: SkillVersion,
    value: unknown,
    task?: AgentTask,
  ) => Promise<readonly SkillUsageSlotChoice[]>;
  readonly mcpRepository: Pick<McpRegistryRepository, 'listTools'>;
  readonly profilePlanning: TaskPlanningProfilePolicy | undefined;
  readonly workflowCandidates: Pick<WorkflowCandidateGenerator, 'generate'>;
}
/** Candidate-only initial planning. No Task, plan, confirmation, or execution evidence writer. */
export class TaskPlanningCandidateGenerator {
  readonly #dependencies: TaskPlanningCandidateDependencies;
  constructor(dependencies: TaskPlanningCandidateDependencies) {
    this.#dependencies = dependencies;
  }
  async generate(input: TaskPlanPreparationInput) {
    const {
      skills,
      temporarySkillRepository,
      skillSelectionRepository,
      skillComposition,
      resolveSkillUsageSlotChoices,
      mcpRepository,
      workflowCandidates,
      profilePlanning,
    } = this.#dependencies;

    const skill =
      input.skillId === undefined || input.skillVersion === undefined
        ? undefined
        : await skills.findVersion(input.skillId, input.skillVersion);
    const temporary =
      input.temporarySkillId === undefined
        ? undefined
        : await temporarySkillRepository.find(input.temporarySkillId);
    if (skill?.status !== 'enabled' && temporary?.status !== 'active')
      throw new Error('SELECTED_SKILL_NOT_EXECUTABLE');
    if (skill?.status === 'enabled' && input.skillInputResolution === undefined)
      throw new Error('SELECTED_SKILL_INPUT_NOT_RESOLVED');
    const planId = `plan-task-${input.task.taskId}-${randomUUID()}`;
    const workflowDefinitionId = `workflow-task-${input.task.taskId}`;
    const usageSelectionId = resolveSkillUsageSelectionId({
      selectedSkill: skill !== undefined,
      skillSelectionConfigured: true,
      ...(input.task.skillSelectionId === undefined
        ? {}
        : { skillSelectionId: input.task.skillSelectionId }),
    });
    const preparedUsageEvidence =
      skill === undefined || usageSelectionId === undefined
        ? undefined
        : await (async () => {
            const selection = await skillSelectionRepository.findSelection(usageSelectionId);
            const candidate = selection?.candidates.find(
              (item) => item.skillId === skill.skillId && item.skillVersion === skill.version,
            )?.usageCandidate;
            if (candidate === undefined) throw new Error('SKILL_USAGE_SELECTION_EVIDENCE_REQUIRED');
            const composition = await skillComposition.composeUsage(
              {
                skillId: skill.skillId,
                skillVersion: skill.version,
              },
              await resolveSkillUsageSlotChoices(
                input.goalContract,
                skill,
                input.skillInputResolution?.structuredInput,
                input.task,
              ),
            );
            const interpretation = skillComposition.interpretUsage(
              skill,
              candidate.modeDecision,
              composition,
            );
            const profileEvidence = await profilePlanning?.prepareUsage({
              skill,
              candidate,
              interpretation,
              goalContract: input.goalContract,
              workflowDefinitionId,
              workflowVersion: 1,
              task: input,
            });
            if (profileEvidence !== undefined) return profileEvidence;
            return {
              applicabilityStatus: candidate.applicability.status,
              prepared: prepareSkillUsagePlan({
                skill,
                candidate,
                interpretation,
                goalContract: input.goalContract,
                workflowDefinitionId,
                workflowVersion: 1,
              }),
            } as const;
          })();
    const preparedUsage = preparedUsageEvidence?.prepared;
    const selectedTaskOperation =
      preparedUsageEvidence !== undefined && 'selectedTaskOperation' in preparedUsageEvidence
        ? preparedUsageEvidence.selectedTaskOperation
        : undefined;
    const executionContext =
      preparedUsageEvidence !== undefined && 'executionContext' in preparedUsageEvidence
        ? preparedUsageEvidence.executionContext
        : undefined;
    const planningToolPolicy =
      selectedTaskOperation === undefined
        ? (skill?.toolPolicy ?? {
            required: temporary?.tools ?? [],
            optional: [],
            forbidden: [],
          })
        : {
            required: [
              {
                serverId: selectedTaskOperation.finalStateRead.serverId,
                toolName: selectedTaskOperation.finalStateRead.operationName,
              },
              {
                serverId: selectedTaskOperation.server.serverId,
                toolName: selectedTaskOperation.operation.operationName,
              },
            ],
            optional: [],
            forbidden: skill?.toolPolicy.forbidden ?? [],
          };
    const toolPlanningMetadata = await buildMcpToolPlanningMetadata(
      planningToolPolicy,
      async (reference) =>
        (await mcpRepository.listTools(reference.serverId)).find(
          (tool) => tool.toolName === reference.toolName,
        ),
    );
    const planInput = {
      planId,
      workflowDefinitionId,
      workflowVersion: 1,
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      goalContract: input.goalContract,
      ...(input.skillGoalId === undefined ? {} : { skillGoalId: input.skillGoalId }),
      ...(input.skillAttemptId === undefined ? {} : { skillAttemptId: input.skillAttemptId }),
      toolExecutionSemantics: snapshotMcpToolPlanningExecutionSemantics(toolPlanningMetadata),
      ...(executionContext === undefined ? {} : { executionContext }),
      ...(skill === undefined
        ? {}
        : {
            compositionRoot: {
              skillId: skill.skillId,
              skillVersion: skill.version,
            },
          }),
      taskId: input.task.taskId,
      templateQuery: input.goalDescription,
      ...(selectedTaskOperation !== undefined ||
      (preparedUsage?.deterministicDefinition !== undefined &&
        ((skill?.skillId === 'embodied.inspect_area' && skill.version >= 1) ||
          (skill?.skillId === 'embodied.area_patrol' && skill.version >= 2) ||
          zmqToolForSkill(skill?.skillId ?? '') !== undefined))
        ? { deterministicOnly: true as const }
        : {}),
      ...(preparedUsage === undefined
        ? {}
        : {
            skillUsagePolicy: preparedUsage.policy,
            ...(preparedUsage.deterministicDefinition === undefined
              ? {}
              : { deterministicDefinition: preparedUsage.deterministicDefinition }),
          }),
      planningInstruction: JSON.stringify({
        operation: 'task_initial_plan',
        workflowIdentity: {
          workflowDefinitionId,
          version: 1,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
        },
        goalDescription: input.goalDescription,
        ...(preparedUsage === undefined
          ? {}
          : { skillUsagePlanning: JSON.parse(preparedUsage.planningInstruction) as unknown }),
        ...(skill === undefined
          ? {
              selectedTemporarySkill: {
                temporarySkillId: temporary?.temporarySkillId,
                description: temporary?.description,
                tools: temporary?.tools,
                toolPlanningMetadata,
                inputSchema: temporary?.inputSchema,
                outputSchema: temporary?.outputSchema,
              },
            }
          : {
              selectedSkill: {
                skillId: skill.skillId,
                version: skill.version,
                description: skill.description,
                toolPolicy: skill.toolPolicy,
                toolPlanningMetadata,
                workflowGuidance: skill.workflowGuidance,
                inputSchema: skill.inputSchema,
                resolvedInput: input.skillInputResolution,
                outputSchema: skill.outputSchema,
              },
            }),
      }),
    };
    const workflow = await (profilePlanning === undefined
      ? workflowCandidates.generate(planInput)
      : profilePlanning.generateCandidate(planInput, preparedUsageEvidence, () =>
          workflowCandidates.generate(planInput),
        ));
    return immutablePlanningSnapshot({
      request: planInput,
      workflow,
      data: { skill, preparedUsage, preparedUsageEvidence, selectedTaskOperation },
    });
  }
}
