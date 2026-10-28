import { createHash, randomUUID } from 'node:crypto';
import {
  GovernedControlConfirmationService,
  type TaskPlanConfirmationAuthority,
} from '../../../packages/application/src/index.js';
import type { PostgresGovernedControlAuthorityRepository } from '../../../packages/persistence-postgres/src/governed-control-authority-repository.js';
import {
  isGovernedPatrol,
  ZMQ_PATROL_SKILL,
  ZMQ_PATROL_CHILDREN,
  zmqPatrolChildInput,
  assertZmqPatrolDeadline,
  zmqPatrolNavigationSucceeded,
} from '../../../packages/domain/src/zmq-area-patrol.js';
import { SkillSelectionService } from '../../../packages/application/src/skill-selection.js';
import type { GovernedChildTaskPort } from '../../../packages/application/src/governed-child-task.js';
import type {
  GoalService,
  SkillInputResolutionService,
  RuntimeTaskCapabilityService,
  TaskService,
  WorkflowExecutionService,
  WorkflowControllerService,
  SkillUsageCandidateAssessor,
} from '../../../packages/application/src/index.js';
import {
  createGoalExecutionContract,
  type AgentTask,
  type SkillUsageSelectionContext,
  type GoalExecutionContract,
} from '../../../packages/domain/src/index.js';
import type {
  PostgresAgentTaskRepository,
  PostgresSkillRepository,
  PostgresSkillGraphRepository,
  PostgresSkillSelectionRepository,
  PostgresWorkflowPlanRepository,
  PostgresSkillInputResolutionRepository,
  PostgresMcpRegistryRepository,
  PostgresAgentTaskCommandContext,
  PostgresSkillCallWorkflowRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';
import { resolveUgvMoveSkillUsageContext } from '../../../packages/ugv-profile/src/ugv-move-skill-usage.js';

type Dependencies = Readonly<{
  service: TaskService;
  goals: GoalService;
  tasks: PostgresAgentTaskRepository;
  capabilities: RuntimeTaskCapabilityService;
  plans: PostgresWorkflowPlanRepository;
  inputs: SkillInputResolutionService;
  inputRecords: PostgresSkillInputResolutionRepository;
  skills: PostgresSkillRepository;
  graph: PostgresSkillGraphRepository;
  selections: PostgresSkillSelectionRepository;
  usage: Pick<SkillUsageCandidateAssessor, 'assess'>;
  mcp: PostgresMcpRegistryRepository;
  execution: WorkflowExecutionService;
  controller: WorkflowControllerService;
  usageContext(goal: GoalExecutionContract, task: AgentTask): Promise<SkillUsageSelectionContext>;
  clock: Readonly<{ now(): string }>;
  commands: PostgresAgentTaskCommandContext;
  calls: PostgresSkillCallWorkflowRepository;
  confirmations: PostgresGovernedControlAuthorityRepository;
}>;
const METADATA = 'io.sdar/governedChildTask';

/** Uses native services and existing stores; metadata is correlation, never execution authority. */
export function createGovernedPatrolChildTasks(dependencies: Dependencies): GovernedChildTaskPort {
  const {
    service,
    goals,
    tasks,
    capabilities,
    plans,
    inputs,
    skills,
    graph,
    selections,
    usage,
    mcp,
    execution,
    controller,
    clock,
  } = dependencies;
  const exactSelection = new SkillSelectionService({
    skills,
    graph,
    records: selections,
    usage,
    mcpWarnings: mcp,
    clock,
    retriever: {
      score: (_goal, candidates) =>
        Promise.resolve(Object.fromEntries(candidates.map((candidate) => [candidate.skillId, 1]))),
    },
    decider: {
      decide: ({ candidates }) => {
        const candidate = candidates[0];
        if (candidates.length !== 1 || !candidate)
          throw Error('COMPOSED_CHILD_CANDIDATE_NOT_EXACT');
        return Promise.resolve({
          selectedSkillId: candidate.skillId,
          decisionSummary:
            'Selected the only exact child admitted by the immutable parent Capability and composition policy.',
        });
      },
    },
    ids: {
      nextSelectionId: () => 'selection-child-' + randomUUID(),
      nextReplacementPlanId: () => 'replacement-child-' + randomUUID(),
    },
  });
  async function nativeTask(planId: string) {
    const task = await tasks.findByPlanId(planId);
    const link = record(task?.requestMetadata[METADATA]);
    if (!task || !link) return undefined;
    if (typeof link['parentInstanceId'] !== 'string' || typeof link['parentNodeRunId'] !== 'string')
      throw Error('COMPOSED_CHILD_LINK_INVALID');
    const call = await dependencies.calls.find(link['parentInstanceId'], link['parentNodeRunId']);
    if (
      call?.childPlanId !== planId ||
      call.parentPlanId !== link['parentPlanId'] ||
      call.skillId !== task.selectedSkillId ||
      call.skillVersion !== task.selectedSkillVersion
    )
      throw Error('COMPOSED_CHILD_NATIVE_LINK_MISSING');
    return task;
  }
  async function assertParent(task: AgentTask) {
    const link = record(task.requestMetadata[METADATA]);
    if (
      !link ||
      typeof link['parentTaskId'] !== 'string' ||
      typeof link['parentPlanId'] !== 'string'
    )
      throw Error('COMPOSED_CHILD_PARENT_AUTHORITY_MISSING');
    const parent = await tasks.findById(link['parentTaskId']);
    const plan = await plans.findPlan(link['parentPlanId']);
    if (
      !parent ||
      !plan ||
      !['executing', 'awaiting_plan_confirmation', 'paused'].includes(parent.phase) ||
      parent.planId !== plan.planId ||
      parent.goalId !== plan.goalId ||
      parent.goalVersion !== plan.goalVersion ||
      plan.confirmationStatus !== 'confirmed' ||
      !isGovernedPatrol(
        plan.definition?.skillUsagePolicy?.skill.skillId,
        plan.definition?.skillUsagePolicy?.skill.skillVersion,
      )
    )
      throw Error('COMPOSED_CHILD_PARENT_AUTHORITY_STALE');
    if (parent.selectedSkillId === ZMQ_PATROL_SKILL) {
      const binding = await capabilities.findBinding(parent.taskId);
      assertZmqPatrolDeadline(binding?.inputSnapshot, clock.now());
    }
    return { parent, plan, link };
  }
  async function parentConfirmationScope(parent: AgentTask) {
    const plan = parent.planId && (await plans.findPlan(parent.planId));
    const binding = await capabilities.findBinding(parent.taskId);
    const attempt = (await capabilities.listAttempts(parent.taskId)).at(-1);
    if (
      parent.selectedSkillId !== ZMQ_PATROL_SKILL ||
      !plan ||
      plan.confirmationStatus !== 'confirmed' ||
      !plan.definition ||
      !binding ||
      attempt?.planId !== plan.planId ||
      !['prepared', 'running', 'waiting'].includes(attempt.status)
    )
      throw Error('ZMQ_PATROL_PARENT_CONFIRMATION_SCOPE_INVALID');
    const timing = assertZmqPatrolDeadline(binding.inputSnapshot, clock.now());
    const composition = binding.constraintSnapshot.filter(
      (c) => c['type'] === 'composition_authority_policy',
    );
    const provider = binding.constraintSnapshot.filter(
      (c) => c['type'] === 'provider_binding_policy',
    );
    if (
      composition.length !== 1 ||
      provider.length !== 1 ||
      !provider[0] ||
      typeof provider[0]['mcpProviderBindingId'] !== 'string' ||
      typeof provider[0]['localServerId'] !== 'string'
    )
      throw Error('ZMQ_PATROL_PARENT_CONFIRMATION_SCOPE_INVALID');
    const childInputs = ZMQ_PATROL_CHILDREN.map((id) => ({
      skillId: id,
      input: zmqPatrolChildInput(binding.inputSnapshot, id),
    }));
    return {
      scope: {
        taskId: parent.taskId,
        capabilityBindingId: binding.bindingId,
        capabilityId: binding.requestedCapabilityId,
        capabilityVersion: binding.capabilityVersion,
        capabilityAttemptId: attempt.attemptId,
        planId: plan.planId,
        planHash: canonicalHash(plan.definition),
        skillId: ZMQ_PATROL_SKILL,
        skillVersion: parent.selectedSkillVersion ?? 0,
        providerBindingId: provider[0]['mcpProviderBindingId'],
        serverId: provider[0]['localServerId'],
        toolName: 'composition.zmq.area_patrol',
        argumentsHash: canonicalHash({
          bindingHash: binding.bindingHash,
          composition: composition[0],
          childInputs,
        }),
      },
      deadline: Date.parse(
        String(record(record(binding.inputSnapshot)?.['timeWindow'])?.['deadline']),
      ),
      timing,
    };
  }
  return {
    async recordParentConfirmation(parent, authority) {
      const principal = authority.principal;
      if (principal.kind !== 'human' || !principal.permissions.has('physical_control.confirm'))
        throw Error('ZMQ_PATROL_TRUSTED_HUMAN_CONFIRMATION_REQUIRED');
      const { scope, deadline } = await parentConfirmationScope(parent);
      const service = new GovernedControlConfirmationService({
        clock,
        store: {
          saveConfirmation: async (confirmation) =>
            (await dependencies.confirmations.issueOnce(confirmation)).confirmation,
          revokeConfirmation: (...args) => dependencies.confirmations.revokeConfirmation(...args),
        },
        ids: {
          nextConfirmationId: () =>
            'native-patrol-' + canonicalHash({ ...scope, actorId: principal.actorId }),
        },
      });
      await service.issue({
        ...scope,
        actorId: principal.actorId,
        actorKind: 'human',
        authenticationMethod: principal.authenticationMethod,
        actorRoles: ['physical_control_approver'],
        reason:
          'The human confirmed this immutable two-child native patrol scope; it grants no unrelated device action.',
        expiresAt: new Date(
          Math.min(deadline, Date.parse(clock.now()) + 15 * 60 * 1000),
        ).toISOString(),
      });
    },
    async confirmInherited(planId) {
      const task = await nativeTask(planId);
      if (!task) return false;
      const { parent } = await assertParent(task);
      if (parent.selectedSkillId !== ZMQ_PATROL_SKILL) return false;
      const { scope } = await parentConfirmationScope(parent);
      const matches = (await dependencies.confirmations.listByTask(parent.taskId))
        .map((r) => r.confirmation)
        .filter(
          (c) =>
            !c.revokedAt &&
            Date.parse(c.expiresAt) > Date.parse(clock.now()) &&
            Object.entries(scope).every(([key, value]) => c[key as keyof typeof c] === value),
        );
      if (matches.length !== 1 || !matches[0])
        throw Error('ZMQ_PATROL_PARENT_CONFIRMATION_EXPIRED_OR_CONFLICTED');
      const confirmed = matches[0];
      const authority: TaskPlanConfirmationAuthority = {
        principal: {
          actorId: confirmed.actorId,
          kind: 'human',
          authenticationMethod: confirmed.authenticationMethod,
          permissions: new Set(['physical_control.confirm']),
          requestId: confirmed.confirmationId,
        },
      };
      await execution.confirm(planId, task.taskId);
      await service.authorizePreparedCompositionTask(task.taskId, authority);
      return true;
    },
    async prepare(input) {
      const policy = input.parentPlan.definition?.skillUsagePolicy;
      if (!policy || !isGovernedPatrol(policy.skill.skillId, policy.skill.skillVersion))
        return undefined;
      const parent =
        input.parentTaskId === undefined
          ? await tasks.findByPlanId(input.parentPlan.planId)
          : await tasks.findById(input.parentTaskId);
      if (
        parent?.phase !== 'executing' ||
        parent.planId !== input.parentPlan.planId ||
        input.parentPlan.confirmationStatus !== 'confirmed'
      )
        throw Error('COMPOSED_PARENT_TASK_NOT_EXACT');
      const binding = await capabilities.findBinding(parent.taskId);
      const composition = binding?.constraintSnapshot.filter(
        (constraint) => constraint['type'] === 'composition_authority_policy',
      );
      const children = composition?.length === 1 ? composition[0]?.['children'] : undefined;
      const child = Array.isArray(children)
        ? children
            .map(record)
            .find(
              (candidate) =>
                candidate?.['skillId'] === input.skill.skillId &&
                candidate['skillVersion'] === input.skill.version,
            )
        : undefined;
      const declared = policy.childPolicies.filter(
        (candidate) =>
          candidate.child.skillId === input.skill.skillId &&
          candidate.child.skillVersion === input.skill.version,
      );
      const node = input.parentPlan.definition.nodes.find(
        (candidate) => candidate.nodeId === input.parentNodeId,
      );
      if (
        !child ||
        declared.length !== 1 ||
        node?.type !== 'skill_call' ||
        node.skillId !== input.skill.skillId ||
        typeof child['exposureId'] !== 'string' ||
        !Number.isSafeInteger(child['exposureVersion'])
      )
        throw Error('COMPOSED_CHILD_CAPABILITY_NOT_ADMITTED');
      const parentInstance = await execution.get(input.parentInstanceId);
      const parentInput = record(parentInstance?.input)?.['skillInput'];
      if (parentInstance?.planId !== input.parentPlan.planId || !record(parentInput))
        throw Error('COMPOSED_PARENT_INPUT_AUTHORITY_MISSING');
      const nativePatrol = policy.skill.skillId === ZMQ_PATROL_SKILL;
      const mapped: Record<string, unknown> = nativePatrol
        ? zmqPatrolChildInput(parentInput, input.skill.skillId)
        : {};
      const declaration = declared[0];
      if (!declaration) throw Error('COMPOSED_CHILD_MAPPING_UNSUPPORTED');
      for (const mapping of nativePatrol ? [] : declaration.inputMappings) {
        let source: unknown = parentInput;
        for (const field of mapping.sourcePath.split('.')) source = record(source)?.[field];
        if (source === undefined || mapping.targetPath.includes('.'))
          throw Error('COMPOSED_CHILD_MAPPING_UNSUPPORTED');
        mapped[mapping.targetPath] = source;
      }
      if (canonicalHash(mapped) !== canonicalHash(input.value))
        throw Error('COMPOSED_CHILD_INPUT_MAPPING_MISMATCH');
      if (nativePatrol) {
        assertZmqPatrolDeadline(parentInput, clock.now());
        if (input.skill.skillId === ZMQ_PATROL_CHILDREN[1]) {
          const previous = (
            await tasks.listGovernedChildren(parent.taskId, input.parentPlan.planId)
          ).filter((task) => task.selectedSkillId === ZMQ_PATROL_CHILDREN[0]);
          const navigation = previous[0];
          const admitted = Array.isArray(children)
            ? children.map(record).find((c) => c?.['skillId'] === ZMQ_PATROL_CHILDREN[0])
            : undefined;
          const navigationBinding =
            navigation && (await capabilities.findBinding(navigation.taskId));
          const attempts = navigation && (await capabilities.listAttempts(navigation.taskId));
          if (
            previous.length !== 1 ||
            navigation?.phase !== 'completed' ||
            !admitted ||
            !navigationBinding ||
            navigation.selectedSkillVersion !== admitted['skillVersion'] ||
            navigationBinding.requestedCapabilityId !== admitted['capabilityId'] ||
            navigationBinding.capabilityVersion !== admitted['capabilityVersion'] ||
            attempts?.at(-1)?.status !== 'succeeded' ||
            navigation.deviceOwnership?.deviceId !== parent.deviceOwnership?.deviceId ||
            !navigation.planId ||
            !(await nativeTask(navigation.planId)) ||
            canonicalHash(navigationBinding.inputSnapshot) !==
              canonicalHash(zmqPatrolChildInput(parentInput, ZMQ_PATROL_CHILDREN[0])) ||
            !zmqPatrolNavigationSucceeded(
              navigation.output?.structured,
              String(record(parentInput)?.['resourceId']),
            )
          )
            throw Error('ZMQ_PATROL_NAVIGATION_NOT_CONFIRMED');
        }
      }
      const idempotencyKey =
        'child-' +
        createHash('sha256')
          .update(
            JSON.stringify([
              parent.taskId,
              input.parentPlan.planId,
              input.parentNodeRunId,
              input.skill.skillId,
              input.skill.version,
              canonicalHash(input.value),
            ]),
          )
          .digest('hex');
      const submitted = await service.submitDeterministic({
        userId: parent.userId,
        messageText: `Execute the exact admitted ${input.skill.skillId}@${String(input.skill.version)} child of ${parent.taskId}.`,
        capabilityInput: input.value,
        initialAdmission: { idempotencyKey },
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: child['exposureId'],
            versionConstraint: String(child['exposureVersion']),
            requestId: idempotencyKey,
          },
          structured_input: input.value,
          [METADATA]: {
            parentTaskId: parent.taskId,
            parentPlanId: input.parentPlan.planId,
            parentInstanceId: input.parentInstanceId,
            parentNodeId: input.parentNodeId,
            parentNodeRunId: input.parentNodeRunId,
            skillId: input.skill.skillId,
            skillVersion: input.skill.version,
          },
        },
        ...(parent.deviceOwnership === undefined
          ? {}
          : { deviceOwnership: parent.deviceOwnership }),
      });
      const childBinding = await capabilities.findBinding(submitted.task.taskId);
      const currentParent = await tasks.findById(parent.taskId);
      if (
        currentParent?.phase !== 'executing' ||
        currentParent.planId !== parent.planId ||
        currentParent.goalVersion !== parent.goalVersion
      ) {
        await service.cancel(submitted.task.taskId);
        throw Error('COMPOSED_PARENT_CHANGED_DURING_ADMISSION');
      }
      if (
        !childBinding ||
        childBinding.requestedCapabilityId !== child['capabilityId'] ||
        childBinding.capabilityVersion !== child['capabilityVersion'] ||
        childBinding.initialImplementationRefs.length !== 1 ||
        childBinding.initialImplementationRefs[0] !==
          `skill:${input.skill.skillId}:${String(input.skill.version)}` ||
        canonicalHash(childBinding.inputSnapshot) !== canonicalHash(input.value)
      )
        throw Error('COMPOSED_CHILD_BINDING_NOT_EXACT');
      const goalId = 'goal-child-' + idempotencyKey;
      let goal;
      try {
        goal = await goals.get(goalId);
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'GOAL_NOT_FOUND')
          throw error;
        goal = await goals.create({
          goalId,
          contextId: submitted.context.contextId,
          title: input.skill.name,
          description: `Return the source-qualified report of ${input.skill.skillId} for this admitted child.`,
          constraints: [...input.parentPlan.goalContract.constraints],
          successCriteria: [
            'Preserve native Task identity, explicit physical confirmation, terminal evidence and an honest complete or degraded report.',
          ],
        });
      }
      if (submitted.task.phase === 'queued') {
        const authority = await capabilities.resolveSkillUsageAuthority(submitted.task.taskId);
        if (!authority) throw Error('COMPOSED_CHILD_USAGE_AUTHORITY_REQUIRED');
        const context =
          input.skill.skillId === 'embodied.move_to'
            ? resolveUgvMoveSkillUsageContext({ authority, binding: childBinding })
            : authority.context;
        // Authority projected by the Capability reader is assessed through the existing native usage service.
        const selection = await exactSelection.selectFromCandidates(
          createGoalExecutionContract(goal),
          [input.skill],
          context,
        );
        const prepared = await service.prepareDeterministicExecution(submitted.task.taskId, {
          goalId,
          goalVersion: goal.version,
          skillId: input.skill.skillId,
          skillVersion: input.skill.version,
          selectionId: selection.selectionId,
        });
        const resolution = await inputs.resolveExact({
          task: prepared,
          goal,
          skill: input.skill,
          supplementaryInputs: [],
          structuredInput: input.value,
          sourceRef: `task-capability-binding:${childBinding.bindingId}:hash:${childBinding.bindingHash}:input-snapshot`,
        });
        if (
          resolution.status !== 'resolved' ||
          canonicalHash(resolution.structuredInput) !== canonicalHash(input.value)
        )
          throw Error('COMPOSED_CHILD_INPUT_NOT_RESOLVED');
      } else if (submitted.task.phase !== 'planning')
        throw Error('COMPOSED_CHILD_ADMISSION_NOT_REPLAYABLE');
      return { taskId: submitted.task.taskId, goalContract: createGoalExecutionContract(goal) };
    },
    async attach({ taskId, plan, skill, value }) {
      const resolution = await dependencies.inputRecords.findLatest(
        taskId,
        skill.skillId,
        skill.version,
        plan.goalVersion,
      );
      if (
        resolution?.status !== 'resolved' ||
        canonicalHash(resolution.structuredInput) !== canonicalHash(value)
      )
        throw Error('COMPOSED_CHILD_INPUT_AUTHORITY_INVALID');
      await service.attachPlan(taskId, {
        planId: plan.planId,
        goalId: plan.goalId,
        goalVersion: plan.goalVersion,
        skillInputResolutionId: resolution.resolutionId,
      });
      await service.awaitPreparedCompositionPlan(taskId);
    },
    async confirm(planId, authority) {
      const task = await nativeTask(planId);
      if (!task) return false;
      await assertParent(task);
      if (!authority) throw Error('COMPOSED_CHILD_HUMAN_CONFIRMATION_REQUIRED');
      await execution.confirm(planId, task.taskId);
      await service.authorizePreparedCompositionTask(task.taskId, authority);
      return true;
    },
    async execute(input) {
      const task = await nativeTask(input.childPlanId);
      if (!task) return undefined;
      await assertParent(task);
      if (task.phase !== 'executing') throw Error('COMPOSED_CHILD_NOT_CONFIRMED');
      const { parent } = await assertParent(task);
      if (parent.phase !== 'executing') throw Error('COMPOSED_PARENT_NOT_EXECUTING');
      const controlId = 'control-task-' + task.taskId;
      if (!task.goalId || !task.goalVersion) throw Error('COMPOSED_CHILD_GOAL_REQUIRED');
      await controller.start({
        controlId,
        contextId: task.contextId,
        goalId: task.goalId,
        goalVersion: task.goalVersion,
        taskId: task.taskId,
        initialPlanId: input.childPlanId,
        initialInstanceId: input.childInstanceId,
        input: input.value,
        skillIds: [input.skill.skillId],
        planningInstruction:
          'The immutable parent permits only this exact child; automatic physical redispatch and replanning are forbidden.',
        onStarted: input.onStarted,
      });
      const instance = await execution.get(input.childInstanceId);
      if (!instance) throw Error('COMPOSED_CHILD_INSTANCE_NOT_PERSISTED');
      return instance;
    },
    async reject(planId) {
      const task = await nativeTask(planId);
      const link = record(task?.requestMetadata[METADATA]);
      if (
        task &&
        typeof link?.['parentTaskId'] === 'string' &&
        typeof link['parentPlanId'] === 'string'
      )
        await dependencies.commands.runGovernedChildCancellation(
          {
            parentTaskId: link['parentTaskId'],
            parentPlanId: link['parentPlanId'],
            childTaskId: task.taskId,
          },
          () => service.cancel(task.taskId),
        );
    },
    async cancelChildren(parentTaskId, parentPlanId) {
      const parent = await tasks.findById(parentTaskId);
      const plan = await plans.findPlan(parentPlanId);
      if (
        !isGovernedPatrol(
          plan?.definition?.skillUsagePolicy?.skill.skillId,
          plan?.definition?.skillUsagePolicy?.skill.skillVersion,
        )
      )
        return;
      if (parent?.planId !== parentPlanId)
        throw Error('COMPOSED_PARENT_CANCELLATION_AUTHORITY_INVALID');
      for (const child of await tasks.listGovernedChildren(parentTaskId, parentPlanId)) {
        if (
          child.deviceOwnership?.deviceId !== parent.deviceOwnership?.deviceId ||
          child.deviceOwnership?.bindingId !== parent.deviceOwnership?.bindingId ||
          child.deviceOwnership?.sdarServiceKey !== parent.deviceOwnership?.sdarServiceKey
        )
          throw Error('COMPOSED_CHILD_DEVICE_AUTHORITY_INVALID');
        await dependencies.commands.runGovernedChildCancellation(
          { parentTaskId, parentPlanId, childTaskId: child.taskId },
          () => service.cancel(child.taskId),
        );
      }
    },
    async controlChildren(parentTaskId, parentPlanId, action) {
      const parent = await tasks.findById(parentTaskId);
      const plan = await plans.findPlan(parentPlanId);
      if (parent?.selectedSkillId !== ZMQ_PATROL_SKILL) return;
      if (parent.planId !== parentPlanId || plan?.confirmationStatus !== 'confirmed')
        throw Error('COMPOSED_PARENT_CONTROL_AUTHORITY_INVALID');
      for (const child of await tasks.listGovernedChildren(parentTaskId, parentPlanId)) {
        if (['completed', 'failed', 'canceled'].includes(child.phase)) continue;
        if (
          child.deviceOwnership?.deviceId !== parent.deviceOwnership?.deviceId ||
          child.deviceOwnership?.bindingId !== parent.deviceOwnership?.bindingId ||
          child.deviceOwnership?.sdarServiceKey !== parent.deviceOwnership?.sdarServiceKey
        )
          throw Error('COMPOSED_CHILD_DEVICE_AUTHORITY_INVALID');
        if (dependencies.commands.current())
          await dependencies.commands.recordEffect(
            'governed_child_lifecycle_intent',
            child.taskId,
            { parentTaskId, parentPlanId, childTaskId: child.taskId, action },
          );
        await dependencies.commands.runGovernedChildLifecycle(
          { parentTaskId, parentPlanId, childTaskId: child.taskId },
          action,
          () =>
            service.followUp({
              taskId: child.taskId,
              action,
              messageText: `Parent patrol requested ${action} for its current exact child.`,
            }),
        );
      }
    },
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
