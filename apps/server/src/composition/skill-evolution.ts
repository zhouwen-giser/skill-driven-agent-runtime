import type { EvolutionExperience } from '../../../../packages/domain/src/index.js';
import type {
  McpRegistryRepository,
  WorkflowExecutionRepository,
  WorkflowPlanRepository,
} from '../../../../packages/application/src/ports.js';
import { canonicalHash } from '../../../../packages/application/src/mcp-task-readiness.js';
import { SkillEvolutionValidationError } from '../../../../packages/application/src/skill-evolution-authority.js';
import type {
  SkillCandidateRecordingReader,
  SkillValidationExecutorFactory,
} from '../../../../packages/application/src/recorded-skill-candidate-validator.js';
import { LangGraphWorkflowExecutor } from '../../../../packages/langgraph-runtime/src/index.js';
import { randomUUID } from 'node:crypto';
import { DeferredSkillEvolutionService } from '../../../../packages/application/src/deferred-skill-evolution.js';
import { VerifiedSkillEvolutionService } from '../../../../packages/application/src/verified-skill-evolution.js';
import { RecordedSkillCandidateValidator } from '../../../../packages/application/src/recorded-skill-candidate-validator.js';

export type SkillEvolutionOperations = Pick<
  VerifiedSkillEvolutionService,
  'get' | 'listCorrections' | 'evaluateAndPublish' | 'correctAndRevalidate'
> &
  Readonly<{ enhanceAutomatic(candidateId: string): Promise<void> }>;

export function composeSkillEvolution(
  input: Readonly<{
    restrictedProfile: boolean;
    application: Omit<
      ConstructorParameters<typeof VerifiedSkillEvolutionService>[0],
      'runner' | 'nextCorrectionId'
    >;
    validation: Omit<
      ConstructorParameters<typeof RecordedSkillCandidateValidator>[0],
      'recordings' | 'executor' | 'nextId'
    >;
    recording: ConstructorParameters<typeof PostgresBackedSkillRecordingReader>[0];
  }>,
): SkillEvolutionOperations {
  const runner = new RecordedSkillCandidateValidator({
    ...input.validation,
    executor: recordedSkillValidationExecutor,
    recordings: new PostgresBackedSkillRecordingReader(input.recording),
    nextId: randomUUID,
  });
  const service = input.restrictedProfile
    ? new DeferredSkillEvolutionService(input.application.temporarySkills)
    : new VerifiedSkillEvolutionService({
        ...input.application,
        runner,
        nextCorrectionId: () => `skill-correction-${randomUUID()}`,
      });
  return {
    get: (id) => service.get(id),
    listCorrections: (id) => service.listCorrections(id),
    evaluateAndPublish: (id) => service.evaluateAndPublish(id),
    correctAndRevalidate: (id, correction) => service.correctAndRevalidate(id, correction),
    async enhanceAutomatic(id) {
      if (input.restrictedProfile) await service.get(id);
      else await service.evaluateAndPublish(id);
    },
  };
}

/** No live broker, Task writer, continuation service or network transport is reachable here. */
export const recordedSkillValidationExecutor: SkillValidationExecutorFactory = {
  create(io) {
    return new LangGraphWorkflowExecutor(
      {
        callMcpTool: async (request) => {
          if (request.taskExecution !== undefined)
            io.rejectUnsupported('remote_task_fixture_unavailable');
          return {
            kind: 'immediate',
            result: await io.callTool(request.tool, request.arguments, request.executionContext),
          };
        },
        executeLlm: () => io.rejectUnsupported('llm_execution_recording_unavailable'),
        executeSkill: () => io.rejectUnsupported('child_skill_recording_unavailable'),
        executeSubworkflow: () => io.rejectUnsupported('subworkflow_recording_unavailable'),
        requestHumanConfirmation: () =>
          io.rejectUnsupported('human_confirmation_recording_unavailable'),
        decideExecutionError: () => io.rejectUnsupported('error_decision_recording_unavailable'),
        now: () => new Date().toISOString(),
        nowMilliseconds: () => Date.now(),
      },
      { llm: 0, mcp: 0, skill: 0, subworkflow: 0 },
    );
  },
};

export class PostgresBackedSkillRecordingReader implements SkillCandidateRecordingReader {
  constructor(
    private readonly dependencies: Readonly<{
      executions: Pick<WorkflowExecutionRepository, 'findInstance'>;
      plans: Pick<WorkflowPlanRepository, 'findPlan'>;
      mcp: Pick<McpRegistryRepository, 'listInvocationsByTask'>;
    }>,
  ) {}

  async read(experience: EvolutionExperience) {
    const instance = await this.dependencies.executions.findInstance(experience.instanceId);
    if (
      experience.taskId === undefined ||
      instance?.completedAt === undefined ||
      !['succeeded', 'failed'].includes(instance.status) ||
      (instance.status === 'succeeded') !== experience.successful ||
      canonicalHash(instance.input) !== canonicalHash(experience.input) ||
      canonicalHash({ result: instance.result }) !== canonicalHash({ result: experience.result }) ||
      canonicalHash(instance.errors) !== canonicalHash(experience.errors)
    )
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_SOURCE_INSTANCE_MISMATCH');
    const plan = await this.dependencies.plans.findPlan(instance.planId);
    if (
      plan?.definition === undefined ||
      plan.executionTaskId !== experience.taskId ||
      plan.goalId !== experience.goal.goalId ||
      plan.goalVersion !== experience.goal.version ||
      canonicalHash(plan.definition) !== canonicalHash(experience.workflow)
    )
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_SOURCE_PLAN_MISMATCH');
    const started = Date.parse(instance.startedAt);
    const completed = Date.parse(instance.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started)
      throw new SkillEvolutionValidationError('SKILL_EVOLUTION_SOURCE_TIME_RANGE_INVALID');
    return (await this.dependencies.mcp.listInvocationsByTask(experience.taskId)).filter(
      (invocation) =>
        invocation.taskId === experience.taskId &&
        Date.parse(invocation.startedAt) >= started &&
        Date.parse(invocation.completedAt) <= completed,
    );
  }
}
