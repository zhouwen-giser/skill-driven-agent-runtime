import {
  ZMQ_PATROL_CAPABILITY,
  parseZmqPatrolInput,
} from '../../../packages/domain/src/zmq-area-patrol.js';
import {
  GoalServiceError,
  userGoalCompletionContractFor,
  type GoalService,
  type RuntimeTaskCapabilityService,
  type UserGoalPlanningService,
  type UserGoalPlanningRepository,
  type TaskCapabilityUserGoalPlanAuthorityResolver,
} from '../../../packages/application/src/index.js';
import {
  createUserGoalPlan,
  hashCanonicalEvidenceJson,
  validateUserGoalPlan,
  type AgentTask,
} from '../../../packages/domain/src/index.js';
import { parseAreaInspectionInput } from '../../../packages/domain/src/area-inspection.js';
import { parseAreaPatrolInput } from '../../../packages/domain/src/area-patrol.js';
import {
  nativeZmqDispatchInput,
  zmqToolForCapability,
  ZMQ_NATIVE_CONTROLS,
} from '../../../packages/domain/src/zmq-capability.js';

/** A frozen explicit area Capability enters the existing Goal/Skill scheduler without model input inference. */
export function createAreaReportInitialAdmission(
  dependencies: Readonly<{
    capabilities: Pick<RuntimeTaskCapabilityService, 'findBinding' | 'resolveSkillUsageAuthority'>;
    goals: GoalService;
    authority: TaskCapabilityUserGoalPlanAuthorityResolver;
    planning: UserGoalPlanningService;
    plans: UserGoalPlanningRepository;
    clock: Readonly<{ now(): string }>;
  }>,
) {
  return {
    async admit(task: AgentTask) {
      const binding = await dependencies.capabilities.findBinding(task.taskId);
      if (
        !binding ||
        (!['embodied.inspect_area', 'embodied.area_patrol', ZMQ_PATROL_CAPABILITY].includes(
          binding.requestedCapabilityId,
        ) &&
          zmqToolForCapability(binding.requestedCapabilityId) === undefined)
      )
        return undefined;
      const raw = binding.inputSnapshot;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw Error('AREA_REPORT_INPUT_AUTHORITY_INVALID');
      const input = raw as Record<string, unknown>;
      if (binding.requestedCapabilityId === ZMQ_PATROL_CAPABILITY) parseZmqPatrolInput(raw);
      else if (binding.requestedCapabilityId === 'embodied.area_patrol') parseAreaPatrolInput(raw);
      if (zmqToolForCapability(binding.requestedCapabilityId) !== undefined)
        nativeZmqDispatchInput(binding);
      else if (binding.requestedCapabilityId !== ZMQ_PATROL_CAPABILITY)
        parseAreaInspectionInput({
          resourceId: input['resourceId'],
          area: input['area'],
          timeWindow: input['timeWindow'],
        });
      const usage = await dependencies.capabilities.resolveSkillUsageAuthority(task.taskId);
      const authority = await dependencies.authority.resolve(task.taskId);
      if (!usage || !authority) throw Error('AREA_REPORT_INITIAL_AUTHORITY_INVALID');
      const goalId = 'goal-area-report-' + task.taskId,
        planId = 'user-goal-area-report-' + task.taskId;
      const fields = {
        title: 'Produce the governed area report',
        description: `Return the source-qualified ${binding.requestedCapabilityId} report for the exact admitted resource and region; retain complete, degraded, failed and canceled outcomes.`,
        constraints: [
          `authority.task-capability-binding-hash=sha256:${binding.bindingHash}`,
          ...(zmqToolForCapability(binding.requestedCapabilityId) !== undefined &&
          !ZMQ_NATIVE_CONTROLS.has(zmqToolForCapability(binding.requestedCapabilityId) ?? '')
            ? ['policy.side_effect=read_only']
            : ['policy.confirmation=required']),
          'physical_replay=forbidden',
        ],
        successCriteria: [
          'Return the confirmed native Task report, including actual coverage and trajectory evidence for complete patrol and every missing source or subregion for degraded patrol.',
        ],
      };
      let goal;
      try {
        goal = await dependencies.goals.get(goalId);
      } catch (error) {
        if (!(error instanceof GoalServiceError) || error.code !== 'GOAL_NOT_FOUND') throw error;
        goal = await dependencies.goals.create({ goalId, contextId: task.contextId, ...fields });
      }
      if (
        goal.contextId !== task.contextId ||
        goal.version !== 1 ||
        goal.status !== 'active' ||
        goal.description !== fields.description ||
        hashCanonicalEvidenceJson(goal.constraints) !==
          hashCanonicalEvidenceJson(fields.constraints)
      )
        throw Error('AREA_REPORT_GOAL_AUTHORITY_CONFLICT');
      const contract = userGoalCompletionContractFor(goal);
      const skillGoals = [
        {
          skillGoalId: planId + ':skill-goal:1',
          requiredResult: fields.description,
          capabilityNeeds: authority.capabilityNeeds,
          coveredCriterionIds: contract.criteria
            .filter((c) => c.required)
            .map((c) => c.criterionId),
          requiredEffectRefs: authority.requiredEffectRefs,
          evidenceRequirements: authority.evidenceRequirements,
          artifactRequirements: authority.artifactRequirements,
          assumptions: [],
          constraints: fields.constraints,
          status: 'pending' as const,
        },
      ];
      const contentHash = hashCanonicalEvidenceJson({
        schemaVersion: '1.0',
        goalId,
        goalVersion: goal.version,
        revision: 1,
        skillGoals: skillGoals.map(({ status, ...value }) => {
          void status;
          return value;
        }),
        dependencies: [],
      });
      const plan = validateUserGoalPlan(
        contract,
        createUserGoalPlan({
          schemaVersion: '1.0',
          planId,
          goalId,
          goalVersion: goal.version,
          revision: 1,
          revisionKind: 'initial',
          status: 'validated',
          contractHash: hashCanonicalEvidenceJson(contract),
          contentHash,
          skillGoals,
          dependencies: [],
          inheritedCompletedEffectIds: [],
          forbiddenReplayFingerprints: [],
          createdAt: dependencies.clock.now(),
        }),
      );
      const existing = await dependencies.plans.findPlan(planId);
      if (existing && existing.contentHash !== plan.contentHash)
        throw Error('AREA_REPORT_INITIAL_PLAN_CONFLICT');
      if (!existing) await dependencies.planning.commitCandidate({ contract, plan });
      return {
        goal,
        userGoalPlanId: planId,
        summary: 'Admitted the immutable area Capability to the native Goal and Skill scheduler.',
      };
    },
  };
}

export type AreaReportInitialAdmission = ReturnType<typeof createAreaReportInitialAdmission>;
