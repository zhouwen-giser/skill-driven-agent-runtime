import { describe, expect, it, vi } from 'vitest';

import {
  RemoteTaskContinuationService,
  WorkflowExecutionService,
  WorkflowPlannerService,
  WorkflowValidator,
  canonicalHash,
  createMcpProviderDispatchHash,
  ugvGovernedControlConfirmationId,
  type Clock,
  type ContextSerialGate,
  type GovernedControlConfirmation,
  type RemoteTaskContinuationJob,
  type RemoteTaskLifecycleEvidence,
  type RemoteTaskRepository,
  type SkillRepository,
  type StructuredModelProvider,
  type WorkflowContinuationRepository,
  type WorkflowExecutionRepository,
  type WorkflowPlanRepository,
} from '../../../packages/application/src/index.js';
import {
  createRemoteTaskBinding,
  transitionWorkflowContinuationLifecycle,
  type InternalToolResult,
  type McpInvocation,
  type RemoteTaskBinding,
  type RemoteTaskControlEvent,
  type SelectedTaskOperation,
  type SkillVersion,
  type WorkflowContinuationAttempt,
  type WorkflowContinuationAttemptStatus,
  type WorkflowContinuationLifecycle,
  type WorkflowContinuationSnapshot,
  type WorkflowInstance,
  type WorkflowNodeEvent,
  type WorkflowPlanAttempt,
  type WorkflowPlanRecord,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  LangGraphWorkflowExecutor,
  type WorkflowRuntimePorts,
} from '../../../packages/langgraph-runtime/src/index.js';
import {
  projectUgvMoveWorkflowEvidence,
  verifyUgvMoveTerminalWorkflowEvidence,
} from '../src/ugv-move-workflow-evidence.js';
import {
  UGV_MOVE_WORKFLOW_NODE_IDS,
  UgvMoveWorkflowCandidateGuard,
  prepareUgvMoveWorkflowPlan,
} from '../src/ugv-move-workflow.js';

import {
  UGV_WORKFLOW_GOAL,
  UGV_WORKFLOW_IDENTITY,
  UGV_WORKFLOW_NOW,
  ugvWorkflowPlanningFixture,
} from './ugv-move-workflow-test-fixture.js';

const CONTEXT_ID = 'context-uap-p2-b03';
const INSTANCE_ID = 'workflow-instance-uap-p2-b03';
const WORKFLOW_CONTROL_ID = 'workflow-control-uap-p2-b03';
const BINDING_ID = 'remote-binding-invocation-navigate';
const REMOTE_TASK_ID = 'provider-task-1';
const INITIAL_INVOCATION_ID = 'invocation-initial';
const NAVIGATE_INVOCATION_ID = 'invocation-navigate';
const FINAL_INVOCATION_ID = 'invocation-final';
const CONTROL_EVENT_ID = 'remote-control-provider-task-1-completed';
const CAPABILITY_ATTEMPT_ID = 'capability-attempt-uap-p2-b03';
const TERMINAL_AT = '2026-08-21T12:00:09.900Z';
const CLAIMED_AT = '2026-08-21T12:00:09.950Z';
const FINAL_STARTED_AT = '2026-08-21T12:00:10.000Z';
const FINAL_COMPLETED_AT = '2026-08-21T12:00:10.500Z';
const INITIAL_POSITION = Object.freeze({ longitude: 111.999, latitude: 28 });
const TARGET_POSITION = Object.freeze({ longitude: 112, latitude: 28 });
const FORBIDDEN_OPERATIONS = new Set([
  'vehicle_area_recon',
  'vehicle_track_target',
  'vehicle_control_gimbal',
  'vehicle_fire_weapon',
  'vehicle_emergency_stop',
]);

describe('UGV move Planner-to-persisted-continuation integration', () => {
  it('confirms once, reconstructs from the frontier, and proves final position without replay', async () => {
    const fixture = await ugvWorkflowPlanningFixture();
    const prepared = prepareUgvMoveWorkflowPlan({
      ...fixture,
      goalContract: UGV_WORKFLOW_GOAL,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      selectedTaskOperation: fixture.selected,
    });
    const clock = new MutableClock(UGV_WORKFLOW_NOW);
    const plans = new MemoryWorkflowPlanRepository();
    const skills = skillRepository(fixture.skill);
    const validator = workflowValidator(skills);
    const model = new NeverModel();
    const planner = new WorkflowPlannerService({
      model,
      validator,
      repository: plans,
      workflowSchema: { type: 'object' },
      clock,
      maxAttempts: 1,
      candidateGuard: new UgvMoveWorkflowCandidateGuard({
        selectedTaskOperation: prepared.selectedTaskOperation,
        skillUsagePolicy: prepared.policy,
        ...UGV_WORKFLOW_IDENTITY,
        workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
        clock: { now: () => '2026-08-21T12:01:00.000Z' },
      }),
    });
    const plan = await planner.plan({
      planId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      goalId: UGV_WORKFLOW_IDENTITY.goalId,
      goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
      goalContract: UGV_WORKFLOW_GOAL,
      planningInstruction: prepared.planningInstruction,
      taskId: UGV_WORKFLOW_IDENTITY.taskId,
      skillUsagePolicy: prepared.policy,
      deterministicDefinition: prepared.deterministicDefinition,
      deterministicOnly: true,
    });
    const instances = new MemoryWorkflowExecutionRepository();
    const remoteTasks = new MemoryRemoteTaskRepository();
    const continuations = new MemoryWorkflowContinuationRepository(remoteTasks);
    const mcp = new UgvMcpHarness({
      selected: prepared.selectedTaskOperation,
      plans,
      continuations,
      remoteTasks,
      clock,
    });
    const initialExecution = executionService({
      generation: 'initial',
      plans,
      instances,
      continuations,
      skills,
      validator,
      mcp,
      clock,
    });

    expect(plan.confirmationStatus).toBe('awaiting_confirmation');
    expect(plan.definition).toEqual(prepared.deterministicDefinition);
    expect(plans.attempts).toEqual([expect.objectContaining({ valid: true })]);
    expect(model.generateStructured).not.toHaveBeenCalled();
    expect(mcp.calls).toHaveLength(0);
    await expect(initialExecution.execute(executionInput())).rejects.toMatchObject({
      code: 'WORKFLOW_PLAN_NOT_CONFIRMED',
    });
    expect(mcp.calls).toHaveLength(0);

    clock.set('2026-08-21T11:59:50.000Z');
    await expect(
      initialExecution.confirm(UGV_WORKFLOW_IDENTITY.workflowPlanId, UGV_WORKFLOW_IDENTITY.taskId),
    ).resolves.toMatchObject({
      confirmationStatus: 'confirmed',
      confirmationTaskId: UGV_WORKFLOW_IDENTITY.taskId,
    });
    expect(mcp.calls).toHaveLength(0);

    clock.set('2026-08-21T11:59:58.500Z');
    const waiting = await initialExecution.execute(executionInput());
    const frontier = await continuations.findCurrent(INSTANCE_ID);

    expect(waiting).toMatchObject({ status: 'waiting_external', budgetUsage: { mcpCalls: 2 } });
    expect(frontier).toMatchObject({
      lifecycle: 'active',
      workflowInstanceId: INSTANCE_ID,
      waitingNodeRuns: [
        {
          waitId: BINDING_ID,
          kind: 'remote_task',
          sourceId: BINDING_ID,
          nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.navigate,
          nodeRunId: `${INSTANCE_ID}~${UGV_MOVE_WORKFLOW_NODE_IDS.navigate}~1`,
        },
      ],
      nodeRunCounts: {
        [UGV_MOVE_WORKFLOW_NODE_IDS.initialState]: 1,
        [UGV_MOVE_WORKFLOW_NODE_IDS.currentPosition]: 1,
        [UGV_MOVE_WORKFLOW_NODE_IDS.resourceState]: 1,
        [UGV_MOVE_WORKFLOW_NODE_IDS.permissionContext]: 1,
        [UGV_MOVE_WORKFLOW_NODE_IDS.navigate]: 1,
      },
    });
    expect(frontier?.outputs).toHaveProperty(UGV_MOVE_WORKFLOW_NODE_IDS.initialState);
    expect(frontier?.outputs).not.toHaveProperty(UGV_MOVE_WORKFLOW_NODE_IDS.navigate);
    expect(mcp.operationCount('vehicle_get_state')).toBe(1);
    expect(mcp.operationCount('vehicle_navigate')).toBe(1);
    expect(mcp.calls.filter((call) => FORBIDDEN_OPERATIONS.has(call.toolName))).toHaveLength(0);
    expect(mcp.calls.find((call) => call.toolName === 'vehicle_navigate')).toMatchObject({
      generation: 'initial',
      taskExecution: { protocolMode: 'frozen_v1', availabilityCheck: 'required' },
    });

    const terminal = mcp.publishTerminalControl();
    clock.set(CLAIMED_AT);
    const restartedExecution = executionService({
      generation: 'restart',
      plans,
      instances,
      continuations,
      skills,
      validator,
      mcp,
      clock,
    });
    const failTask = vi.fn(() => Promise.resolve());
    const terminalCallback = vi.fn(
      async (input: Readonly<{ instance: WorkflowInstance; continuationAttemptId: string }>) => {
        expect(input.continuationAttemptId).toBe('continuation-attempt-provider-task-1');
        expect(continuations.requiredAttempt()).toMatchObject({ status: 'succeeded' });
        expect(continuations.requiredControl()).toMatchObject({ status: 'claimed' });
        await expect(remoteTasks.findById(BINDING_ID)).resolves.toMatchObject({
          localState: 'terminal_event_claimed',
        });
        await expect(mcp.verifyTerminalEvidence(input.instance)).resolves.toMatchObject({
          assessment: { status: 'completed' },
          skillResult: input.instance.result,
        });
      },
    );
    const continuation = new RemoteTaskContinuationService({
      continuations,
      remoteTasks,
      execution: restartedExecution,
      serial: immediateSerialGate(),
      clock,
      ids: {
        nextClaimToken: () => 'continuation-claim-provider-task-1',
        nextAttemptId: () => 'continuation-attempt-provider-task-1',
      },
      failTask,
      onContinued: terminalCallback,
    });

    const continued = await continuation.process(terminal);

    expect(continued).toMatchObject({
      disposition: 'continued',
      workflowControlId: WORKFLOW_CONTROL_ID,
      instance: {
        status: 'succeeded',
        result: {
          resourceId: 'vehicle:ugv1',
          status: 'completed',
          finalPosition: { x: 112, y: 28, frame: 'EPSG:4326' },
        },
        budgetUsage: { mcpCalls: 3 },
      },
    });
    expect(mcp.projectorBoundary).toEqual({
      bindingState: 'terminal_event_claimed',
      controlStatus: 'claimed',
      attemptStatus: 'running',
      assessmentStatus: 'completed',
    });
    expect(mcp.operationCount('vehicle_get_state')).toBe(2);
    expect(mcp.operationCount('vehicle_navigate')).toBe(1);
    expect(mcp.calls.filter((call) => FORBIDDEN_OPERATIONS.has(call.toolName))).toHaveLength(0);
    expect(mcp.calls.filter((call) => call.generation === 'restart')).toEqual([
      expect.objectContaining({
        nodeId: UGV_MOVE_WORKFLOW_NODE_IDS.finalState,
        toolName: 'vehicle_get_state',
      }),
    ]);
    expect(failTask).not.toHaveBeenCalled();
    expect(terminalCallback).toHaveBeenCalledOnce();
    expect(await continuations.findCurrent(INSTANCE_ID)).toBeUndefined();
    expect(continuations.requiredAttempt()).toMatchObject({ status: 'succeeded' });
    expect(continuations.requiredControl()).toMatchObject({
      status: 'processed',
      processedAt: FINAL_COMPLETED_AT,
    });
    expect(await remoteTasks.findById(BINDING_ID)).toMatchObject({ localState: 'reentered' });
    expect(
      instances.events.filter(
        (event) =>
          event.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.navigate &&
          event.eventType === 'node_started',
      ),
    ).toHaveLength(1);
    expect(
      instances.events.filter(
        (event) =>
          event.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.finalPosition &&
          event.eventType === 'node_succeeded',
      ),
    ).toHaveLength(1);

    await expect(continuation.process(terminal)).resolves.toEqual({ disposition: 'not_claimed' });
    expect(mcp.operationCount('vehicle_get_state')).toBe(2);
    expect(mcp.operationCount('vehicle_navigate')).toBe(1);
  });
});

function executionInput() {
  return {
    instanceId: INSTANCE_ID,
    planId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
    input: {
      resourceId: 'vehicle:ugv1',
      target: { x: 112, y: 28, frame: 'WGS84' },
    },
    skillIds: ['embodied.move_to'],
    executionContext: { mode: 'simulation' as const, simulationId: 'sim-uap-p2-b03' },
    continuationAuthority: {
      agentTaskId: UGV_WORKFLOW_IDENTITY.taskId,
      contextId: CONTEXT_ID,
      workflowControlId: WORKFLOW_CONTROL_ID,
    },
  };
}

function workflowValidator(skills: SkillRepository): WorkflowValidator {
  return new WorkflowValidator({
    tools: {
      exists: () => Promise.resolve(true),
      getInputSchema: () => Promise.resolve({ type: 'object' }),
    },
    skills,
    schemas: new AjvJsonSchemaValidator(),
  });
}

function executionService(
  input: Readonly<{
    generation: 'initial' | 'restart';
    plans: WorkflowPlanRepository;
    instances: WorkflowExecutionRepository;
    continuations: WorkflowContinuationRepository;
    skills: SkillRepository;
    validator: WorkflowValidator;
    mcp: UgvMcpHarness;
    clock: MutableClock;
  }>,
): WorkflowExecutionService {
  let event = 0;
  let snapshot = 0;
  return new WorkflowExecutionService({
    plans: input.plans,
    instances: input.instances,
    continuations: input.continuations,
    skills: input.skills,
    validator: input.validator,
    executor: new LangGraphWorkflowExecutor(
      runtimePorts(input.mcp, input.generation, input.clock),
      { llm: 0, mcp: 0, skill: 0, subworkflow: 0 },
    ),
    clock: input.clock,
    ids: { nextEventId: () => `${input.generation}-event-${String(++event)}` },
    continuationIds: {
      nextSnapshotId: () => `${input.generation}-snapshot-${String(++snapshot)}`,
      nextContinuationId: () => `${input.generation}-continuation-${String(snapshot)}`,
    },
    systemBudgetDefaults: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 4,
      maxMcpCalls: 8,
      maxCost: 100,
    },
  });
}

function runtimePorts(
  mcp: UgvMcpHarness,
  generation: 'initial' | 'restart',
  clock: Clock,
): WorkflowRuntimePorts {
  return {
    executeLlm: vi.fn(() => Promise.reject(new Error('UGV_LLM_NODE_FORBIDDEN'))),
    callMcpTool: (input) => mcp.call(generation, input),
    executeSkill: vi.fn(() => Promise.reject(new Error('UGV_SKILL_CALL_NODE_FORBIDDEN'))),
    executeSubworkflow: vi.fn(() => Promise.reject(new Error('UGV_SUBWORKFLOW_NODE_FORBIDDEN'))),
    requestHumanConfirmation: vi.fn(() =>
      Promise.reject(new Error('UGV_IN_GRAPH_CONFIRMATION_FORBIDDEN')),
    ),
    decideExecutionError: vi.fn(() =>
      Promise.reject(new Error('UGV_ERROR_HANDLER_NODE_FORBIDDEN')),
    ),
    now: () => clock.now(),
    nowMilliseconds: () => Date.parse(clock.now()),
  };
}

function skillRepository(skill: SkillVersion): SkillRepository {
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: (skillId) => Promise.resolve(skillId === skill.skillId ? skill : undefined),
    findVersion: (skillId, version) =>
      Promise.resolve(skillId === skill.skillId && version === skill.version ? skill : undefined),
    listVersions: (skillId) => Promise.resolve(skillId === skill.skillId ? [skill] : []),
    listEnabledVersions: () => Promise.resolve([skill]),
    listCurrentVersions: () => Promise.resolve([skill]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}

function immediateSerialGate(): ContextSerialGate {
  return { run: (_contextId, operation) => operation() };
}

class MutableClock implements Clock {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  now(): string {
    return this.#value;
  }

  set(value: string): void {
    this.#value = value;
  }
}

class NeverModel implements StructuredModelProvider {
  readonly generateStructured = vi.fn<StructuredModelProvider['generateStructured']>(() =>
    Promise.reject(new Error('UGV_DETERMINISTIC_PLAN_MUST_NOT_CALL_MODEL')),
  );
}

class MemoryWorkflowPlanRepository implements WorkflowPlanRepository {
  readonly attempts: WorkflowPlanAttempt[] = [];
  readonly plans = new Map<string, WorkflowPlanRecord>();

  findPlan(planId: string): Promise<WorkflowPlanRecord | undefined> {
    return Promise.resolve(this.plans.get(planId));
  }

  findConfirmedDefinition(
    workflowDefinitionId: string,
    workflowVersion: number,
  ): Promise<WorkflowPlanRecord | undefined> {
    return Promise.resolve(
      [...this.plans.values()].find(
        (plan) =>
          plan.confirmationStatus === 'confirmed' &&
          plan.definition?.workflowDefinitionId === workflowDefinitionId &&
          plan.definition.version === workflowVersion,
      ),
    );
  }

  confirmPlan(
    planId: string,
    correlation: Readonly<{ taskId?: string; confirmedAt: string }>,
  ): Promise<void> {
    const plan = this.plans.get(planId);
    if (plan !== undefined)
      this.plans.set(planId, {
        ...plan,
        confirmationStatus: 'confirmed',
        confirmedAt: correlation.confirmedAt,
        ...(correlation.taskId === undefined ? {} : { confirmationTaskId: correlation.taskId }),
      });
    return Promise.resolve();
  }

  saveAttempt(attempt: WorkflowPlanAttempt): Promise<void> {
    this.attempts.push(attempt);
    return Promise.resolve();
  }

  savePlan(plan: WorkflowPlanRecord): Promise<void> {
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }

  savePlanAndSupersede(plan: WorkflowPlanRecord, sourcePlanId: string): Promise<void> {
    const source = this.plans.get(sourcePlanId);
    if (source !== undefined)
      this.plans.set(sourcePlanId, { ...source, confirmationStatus: 'superseded' });
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }
}

class MemoryWorkflowExecutionRepository implements WorkflowExecutionRepository {
  readonly instances = new Map<string, WorkflowInstance>();
  readonly events: WorkflowNodeEvent[] = [];

  findInstance(instanceId: string): Promise<WorkflowInstance | undefined> {
    return Promise.resolve(this.instances.get(instanceId));
  }

  findActiveByPlanId(planId: string): Promise<WorkflowInstance | undefined> {
    return Promise.resolve(
      [...this.instances.values()].find(
        (instance) => instance.planId === planId && active(instance.status),
      ),
    );
  }

  findLatestByPlanId(planId: string): Promise<WorkflowInstance | undefined> {
    return Promise.resolve(
      [...this.instances.values()].find((instance) => instance.planId === planId),
    );
  }

  listActiveByGoalId(goalId: string): Promise<readonly WorkflowInstance[]> {
    return Promise.resolve(
      [...this.instances.values()].filter(
        (instance) => instance.goalId === goalId && active(instance.status),
      ),
    );
  }

  countNodeEvents(instanceId: string): Promise<number> {
    return Promise.resolve(this.events.filter((event) => event.instanceId === instanceId).length);
  }

  listNodeEvents(instanceId: string): Promise<readonly WorkflowNodeEvent[]> {
    return Promise.resolve(this.events.filter((event) => event.instanceId === instanceId));
  }

  saveInstance(instance: WorkflowInstance): Promise<void> {
    this.instances.set(instance.instanceId, instance);
    return Promise.resolve();
  }

  saveNodeEvents(events: readonly WorkflowNodeEvent[]): Promise<void> {
    this.events.push(...events);
    return Promise.resolve();
  }
}

function active(status: WorkflowInstance['status']): boolean {
  return status === 'running' || status === 'paused' || status === 'waiting_external';
}

class MemoryRemoteTaskRepository implements Pick<RemoteTaskRepository, 'findById'> {
  #binding: RemoteTaskBinding | undefined;

  put(binding: RemoteTaskBinding): void {
    this.#binding = binding;
  }

  publishTerminal(resultSnapshot: InternalToolResult): void {
    const binding = this.required();
    this.#binding = Object.freeze({
      ...binding,
      protocolStatus: 'completed' as const,
      runtimeRevision: 'runtime-revision-7',
      providerRevision: 'provider-revision-101',
      remoteRevision: 'provider-task-revision-101',
      localState: 'terminal_event_pending' as const,
      lastProviderUpdatedAt: TERMINAL_AT,
      resultSnapshot,
      terminalAt: TERMINAL_AT,
      updatedAt: TERMINAL_AT,
      version: binding.version + 1,
    });
  }

  markClaimed(claimedAt: string): void {
    const binding = this.required();
    this.#binding = Object.freeze({
      ...binding,
      localState: 'terminal_event_claimed' as const,
      updatedAt: claimedAt,
      version: binding.version + 1,
    });
  }

  markReentered(processedAt: string): void {
    const binding = this.required();
    this.#binding = Object.freeze({
      ...binding,
      localState: 'reentered' as const,
      updatedAt: processedAt,
      version: binding.version + 1,
    });
  }

  findById(bindingId: string): Promise<RemoteTaskBinding | undefined> {
    return Promise.resolve(this.#binding?.bindingId === bindingId ? this.#binding : undefined);
  }

  required(): RemoteTaskBinding {
    if (this.#binding === undefined) throw new Error('UGV_REMOTE_BINDING_MISSING');
    return this.#binding;
  }
}

class MemoryWorkflowContinuationRepository implements WorkflowContinuationRepository {
  readonly snapshots: WorkflowContinuationSnapshot[] = [];
  readonly attempts: WorkflowContinuationAttempt[] = [];
  readonly #controls = new Map<string, RemoteTaskControlEvent>();
  readonly #claimTokens = new Map<string, string>();
  readonly #remoteTasks: MemoryRemoteTaskRepository;

  constructor(remoteTasks: MemoryRemoteTaskRepository) {
    this.#remoteTasks = remoteTasks;
  }

  addControl(event: RemoteTaskControlEvent): void {
    this.#controls.set(event.eventId, event);
  }

  requiredControl(): RemoteTaskControlEvent {
    const control = this.#controls.get(CONTROL_EVENT_ID);
    if (control === undefined) throw new Error('UGV_REMOTE_CONTROL_MISSING');
    return control;
  }

  requiredAttempt(): WorkflowContinuationAttempt {
    const attempt = this.attempts.at(-1);
    if (attempt === undefined) throw new Error('UGV_CONTINUATION_ATTEMPT_MISSING');
    return attempt;
  }

  saveSnapshot(snapshot: WorkflowContinuationSnapshot): Promise<void> {
    if (snapshot.predecessorSnapshotId !== undefined) {
      const predecessorIndex = this.snapshots.findIndex(
        (candidate) => candidate.snapshotId === snapshot.predecessorSnapshotId,
      );
      const predecessor = this.snapshots[predecessorIndex];
      if (predecessor?.lifecycle === 'active')
        this.snapshots[predecessorIndex] = transitionWorkflowContinuationLifecycle(
          predecessor,
          'superseded',
          snapshot.updatedAt,
        );
    }
    this.snapshots.push(snapshot);
    return Promise.resolve();
  }

  transitionLifecycle(
    snapshotId: string,
    expected: WorkflowContinuationLifecycle,
    next: WorkflowContinuationLifecycle,
    updatedAt: string,
  ): Promise<WorkflowContinuationSnapshot> {
    const index = this.snapshots.findIndex((snapshot) => snapshot.snapshotId === snapshotId);
    const snapshot = this.snapshots[index];
    if (snapshot?.lifecycle !== expected)
      return Promise.reject(new Error('UGV_CONTINUATION_LIFECYCLE_CAS_FAILED'));
    const transitioned = transitionWorkflowContinuationLifecycle(snapshot, next, updatedAt);
    this.snapshots[index] = transitioned;
    return Promise.resolve(transitioned);
  }

  findById(snapshotId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(this.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId));
  }

  findCurrent(workflowInstanceId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.workflowInstanceId === workflowInstanceId && snapshot.lifecycle === 'active',
        ),
    );
  }

  findLatestForWait(
    workflowInstanceId: string,
    wait: Readonly<{
      kind: 'remote_task' | 'child_workflow';
      sourceId: string;
      nodeId: string;
    }>,
  ): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.workflowInstanceId === workflowInstanceId &&
            snapshot.waitingNodeRuns.some(
              (candidate) =>
                candidate.kind === wait.kind &&
                candidate.sourceId === wait.sourceId &&
                candidate.nodeId === wait.nodeId,
            ),
        ),
    );
  }

  findCurrentByBinding(bindingId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.lifecycle === 'active' &&
            snapshot.waitingNodeRuns.some(
              (wait) => wait.kind === 'remote_task' && wait.sourceId === bindingId,
            ),
        ),
    );
  }

  listInbox(
    _now: string,
    limit: number,
    afterEventId?: string,
  ): Promise<readonly RemoteTaskControlEvent[]> {
    const controls = [...this.#controls.values()]
      .filter(
        (event) =>
          event.status === 'pending' &&
          (afterEventId === undefined || event.eventId.localeCompare(afterEventId) > 0),
      )
      .slice(0, limit);
    return Promise.resolve(controls);
  }

  claimControl(
    input: Parameters<WorkflowContinuationRepository['claimControl']>[0],
  ): Promise<RemoteTaskControlEvent | undefined> {
    const control = this.#controls.get(input.eventId);
    if (control?.status !== 'pending') return Promise.resolve(undefined);
    const claimed = Object.freeze({
      ...control,
      status: 'claimed' as const,
      claimedAt: input.claimedAt,
    });
    this.#controls.set(control.eventId, claimed);
    this.#claimTokens.set(control.eventId, input.claimToken);
    this.#remoteTasks.markClaimed(input.claimedAt);
    return Promise.resolve(claimed);
  }

  finishControl(
    input: Parameters<WorkflowContinuationRepository['finishControl']>[0],
  ): Promise<void> {
    const control = this.#controls.get(input.eventId);
    if (control?.status !== 'claimed' || this.#claimTokens.get(input.eventId) !== input.claimToken)
      return Promise.reject(new Error('UGV_REMOTE_CONTROL_CLAIM_STALE'));
    this.#controls.set(
      input.eventId,
      Object.freeze({
        ...control,
        status: input.status,
        processedAt: input.processedAt,
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      }),
    );
    if (input.bindingDisposition === 'reentered')
      this.#remoteTasks.markReentered(input.processedAt);
    return Promise.resolve();
  }

  deferControl(
    input: Parameters<WorkflowContinuationRepository['deferControl']>[0],
  ): Promise<void> {
    const control = this.#controls.get(input.eventId);
    if (control?.status !== 'claimed' || this.#claimTokens.get(input.eventId) !== input.claimToken)
      return Promise.reject(new Error('UGV_REMOTE_CONTROL_CLAIM_STALE'));
    this.#controls.set(
      input.eventId,
      Object.freeze({ ...control, status: 'pending' as const, errorCode: input.errorCode }),
    );
    this.#claimTokens.delete(input.eventId);
    return Promise.resolve();
  }

  saveAttempt(attempt: WorkflowContinuationAttempt): Promise<void> {
    this.attempts.push(attempt);
    return Promise.resolve();
  }

  updateAttempt(
    attempt: WorkflowContinuationAttempt,
    expectedStatus: WorkflowContinuationAttemptStatus,
  ): Promise<void> {
    const index = this.attempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
    if (index < 0 || this.attempts[index]?.status !== expectedStatus)
      return Promise.reject(new Error('UGV_CONTINUATION_ATTEMPT_CAS_FAILED'));
    this.attempts[index] = attempt;
    return Promise.resolve();
  }

  findLatestAttemptByEvent(eventId: string): Promise<WorkflowContinuationAttempt | undefined> {
    return Promise.resolve(
      [...this.attempts].reverse().find((attempt) => attempt.eventId === eventId),
    );
  }

  listAttempts(workflowInstanceId: string): Promise<readonly WorkflowContinuationAttempt[]> {
    return Promise.resolve(
      this.attempts.filter((attempt) => attempt.workflowInstanceId === workflowInstanceId),
    );
  }
}

type RuntimeMcpCall = Parameters<WorkflowRuntimePorts['callMcpTool']>[0];

interface RecordedCall {
  readonly generation: 'initial' | 'restart';
  readonly nodeId: string;
  readonly toolName: string;
  readonly taskExecution?: RuntimeMcpCall['taskExecution'];
}

class UgvMcpHarness {
  readonly calls: RecordedCall[] = [];
  readonly invocations: McpInvocation[] = [];
  projectorBoundary:
    | Readonly<{
        bindingState: RemoteTaskBinding['localState'];
        controlStatus: RemoteTaskControlEvent['status'];
        attemptStatus: WorkflowContinuationAttempt['status'];
        assessmentStatus: string;
      }>
    | undefined;
  readonly #selected: SelectedTaskOperation;
  readonly #plans: MemoryWorkflowPlanRepository;
  readonly #continuations: MemoryWorkflowContinuationRepository;
  readonly #remoteTasks: MemoryRemoteTaskRepository;
  readonly #clock: MutableClock;
  #confirmation: GovernedControlConfirmation | undefined;

  constructor(
    input: Readonly<{
      selected: SelectedTaskOperation;
      plans: MemoryWorkflowPlanRepository;
      continuations: MemoryWorkflowContinuationRepository;
      remoteTasks: MemoryRemoteTaskRepository;
      clock: MutableClock;
    }>,
  ) {
    this.#selected = input.selected;
    this.#plans = input.plans;
    this.#continuations = input.continuations;
    this.#remoteTasks = input.remoteTasks;
    this.#clock = input.clock;
  }

  async verifyTerminalEvidence(instance: WorkflowInstance) {
    const attempt = this.#continuations.requiredAttempt();
    const snapshot = await this.#continuations.findById(attempt.snapshotId);
    if (snapshot === undefined || this.#confirmation === undefined)
      throw new Error('UGV_TERMINAL_CALLBACK_AUTHORITY_MISSING');
    return verifyUgvMoveTerminalWorkflowEvidence({
      taskId: UGV_WORKFLOW_IDENTITY.taskId,
      selectedTaskOperation: this.#selected,
      confirmation: this.#confirmation,
      invocations: this.invocations,
      remoteTaskLifecycle: [this.#lifecycle(snapshot)],
      continuationAttempt: attempt,
      workflowResult: instance.result,
      policy: { toleranceM: 2, minimumDisplacementM: 10, maxFinalStateAgeMs: 3_000 },
    });
  }

  async call(
    generation: 'initial' | 'restart',
    input: RuntimeMcpCall,
  ): ReturnType<WorkflowRuntimePorts['callMcpTool']> {
    this.calls.push(
      Object.freeze({
        generation,
        nodeId: input.workflowNodeId,
        toolName: input.tool.toolName,
        ...(input.taskExecution === undefined ? {} : { taskExecution: input.taskExecution }),
      }),
    );
    if (FORBIDDEN_OPERATIONS.has(input.tool.toolName))
      throw new Error('UGV_FORBIDDEN_OPERATION_CALLED');
    if (input.workflowNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.initialState)
      return this.#initialState(generation, input);
    if (input.workflowNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.navigate)
      return this.#navigate(generation, input);
    if (input.workflowNodeId === UGV_MOVE_WORKFLOW_NODE_IDS.finalState)
      return this.#finalState(generation, input);
    throw new Error('UGV_UNEXPECTED_MCP_NODE');
  }

  operationCount(toolName: string): number {
    return this.calls.filter((call) => call.toolName === toolName).length;
  }

  publishTerminalControl(): RemoteTaskContinuationJob {
    if (this.operationCount('vehicle_navigate') !== 1)
      throw new Error('UGV_NAVIGATE_DISPATCH_CARDINALITY_INVALID');
    const result = terminalNavigateResult();
    this.#remoteTasks.publishTerminal(result);
    const payload = completedRemoteTaskSnapshot(result);
    const event: RemoteTaskControlEvent = Object.freeze({
      eventId: CONTROL_EVENT_ID,
      bindingId: BINDING_ID,
      type: 'task.completed',
      remoteRevision: 'provider-task-revision-101',
      runtimeRevision: 'runtime-revision-7',
      resultHash: canonicalHash(payload),
      payload,
      status: 'pending',
      createdAt: TERMINAL_AT,
    });
    this.#continuations.addControl(event);
    return Object.freeze({
      eventId: event.eventId,
      bindingId: event.bindingId,
      eventType: event.type,
    });
  }

  async #initialState(
    generation: 'initial' | 'restart',
    input: RuntimeMcpCall,
  ): ReturnType<WorkflowRuntimePorts['callMcpTool']> {
    if (generation !== 'initial' || this.operationCount('vehicle_get_state') !== 1)
      throw new Error('UGV_INITIAL_STATE_REPLAYED');
    const result = stateResult({
      observedAt: '2026-08-21T11:59:59.000Z',
      revision: 'state-revision-100',
      cursor: 100,
      position: INITIAL_POSITION,
    });
    this.invocations.push(
      invocation({
        invocationId: INITIAL_INVOCATION_ID,
        toolName: input.tool.toolName,
        arguments: record(input.arguments),
        result,
        startedAt: '2026-08-21T11:59:58.500Z',
        completedAt: '2026-08-21T11:59:59.000Z',
        semantics: this.#selected.finalStateRead.executionSemantics,
      }),
    );
    this.#clock.set('2026-08-21T11:59:59.000Z');
    return Promise.resolve({ kind: 'immediate', result });
  }

  async #navigate(
    generation: 'initial' | 'restart',
    input: RuntimeMcpCall,
  ): ReturnType<WorkflowRuntimePorts['callMcpTool']> {
    if (generation !== 'initial' || this.operationCount('vehicle_navigate') !== 1)
      throw new Error('UGV_NAVIGATE_REPLAYED');
    const plan = await this.#plans.findPlan(UGV_WORKFLOW_IDENTITY.workflowPlanId);
    if (plan?.confirmationStatus !== 'confirmed' || plan.definition === undefined)
      throw new Error('UGV_OUTER_PLAN_CONFIRMATION_REQUIRED');
    if (
      input.taskExecution?.protocolMode !== 'frozen_v1' ||
      input.taskExecution.availabilityCheck !== 'required'
    )
      throw new Error('UGV_NAVIGATE_TASK_REQUIRED_MISSING');
    this.#clock.set('2026-08-21T12:00:00.000Z');
    this.#confirmation = governedConfirmation(this.#selected, plan);
    const result = Object.freeze({
      remoteTask: Object.freeze({ remoteTaskId: REMOTE_TASK_ID, status: 'working' as const }),
    });
    this.invocations.push(
      invocation({
        invocationId: NAVIGATE_INVOCATION_ID,
        toolName: input.tool.toolName,
        arguments: record(input.arguments),
        result,
        startedAt: '2026-08-21T12:00:00.000Z',
        completedAt: '2026-08-21T12:00:00.100Z',
        semantics: this.#selected.operation.executionSemantics,
        confirmation: this.#confirmation,
      }),
    );
    this.#remoteTasks.put(remoteTaskBinding(this.#selected, input));
    this.#clock.set('2026-08-21T12:00:00.100Z');
    const wait = Object.freeze({
      waitId: BINDING_ID,
      kind: 'remote_task' as const,
      sourceId: BINDING_ID,
      nodeId: input.workflowNodeId,
      nodeRunId: input.workflowNodeRunId,
      state: 'waiting' as const,
    });
    await input.prepareExternalWait(wait);
    return Object.freeze({ kind: 'waiting_external' as const, wait });
  }

  async #finalState(
    generation: 'initial' | 'restart',
    input: RuntimeMcpCall,
  ): ReturnType<WorkflowRuntimePorts['callMcpTool']> {
    if (generation !== 'restart' || this.operationCount('vehicle_get_state') !== 2)
      throw new Error('UGV_FINAL_STATE_SEQUENCE_INVALID');
    const finalToolResult = stateResult({
      observedAt: '2026-08-21T12:00:10.400Z',
      revision: 'state-revision-102',
      cursor: 102,
      position: TARGET_POSITION,
    });
    this.invocations.push(
      invocation({
        invocationId: FINAL_INVOCATION_ID,
        toolName: input.tool.toolName,
        arguments: record(input.arguments),
        result: finalToolResult,
        startedAt: FINAL_STARTED_AT,
        completedAt: FINAL_COMPLETED_AT,
        semantics: this.#selected.finalStateRead.executionSemantics,
      }),
    );
    const snapshot = await this.#continuations.findById(
      this.#continuations.requiredAttempt().snapshotId,
    );
    if (snapshot === undefined || this.#confirmation === undefined)
      throw new Error('UGV_FINAL_EVIDENCE_AUTHORITY_MISSING');
    const lifecycle = this.#lifecycle(snapshot);
    const attempt = this.#continuations.requiredAttempt();
    const projected = projectUgvMoveWorkflowEvidence({
      taskId: UGV_WORKFLOW_IDENTITY.taskId,
      selectedTaskOperation: this.#selected,
      confirmation: this.#confirmation,
      invocations: this.invocations,
      remoteTaskLifecycle: [lifecycle],
      continuationAttempt: attempt,
      finalToolResult,
      assessedAt: '2026-08-21T12:00:11.000Z',
      policy: { toleranceM: 2, minimumDisplacementM: 10, maxFinalStateAgeMs: 3_000 },
    });
    this.projectorBoundary = Object.freeze({
      bindingState: lifecycle.binding.localState,
      controlStatus: lifecycle.controls[0]?.status ?? 'failed',
      attemptStatus: attempt.status,
      assessmentStatus: projected.assessment.status,
    });
    this.#clock.set(FINAL_COMPLETED_AT);
    return Object.freeze({ kind: 'immediate' as const, result: projected.result });
  }

  #lifecycle(snapshot: WorkflowContinuationSnapshot): RemoteTaskLifecycleEvidence {
    const binding = this.#remoteTasks.required();
    const control = this.#continuations.requiredControl();
    const wait = snapshot.waitingNodeRuns[0];
    if (wait === undefined) throw new Error('UGV_CONTINUATION_WAIT_MISSING');
    return Object.freeze({
      binding,
      observations: Object.freeze([]),
      controls: Object.freeze([control]),
      protocolAttempts: Object.freeze([]),
      continuations: Object.freeze([
        Object.freeze({
          snapshotId: snapshot.snapshotId,
          continuationId: snapshot.continuationId,
          stateVersion: snapshot.stateVersion,
          lifecycle: snapshot.lifecycle,
          waitId: wait.sourceId,
          waitState: wait.state,
          nodeId: wait.nodeId,
          nodeRunId: wait.nodeRunId,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
        }),
      ]),
      inputRounds: Object.freeze([]),
      cancellations: Object.freeze([]),
    });
  }
}

function remoteTaskBinding(
  selected: SelectedTaskOperation,
  input: RuntimeMcpCall,
): RemoteTaskBinding {
  const endpoint = 'http://ugv-runtime.invalid/mcp';
  const credentialRevision = '2026-08-21T11:55:00.000Z';
  return createRemoteTaskBinding({
    bindingId: BINDING_ID,
    serverId: selected.server.serverId,
    operationName: selected.operation.operationName,
    remoteTaskId: REMOTE_TASK_ID,
    agentTaskId: UGV_WORKFLOW_IDENTITY.taskId,
    contextId: CONTEXT_ID,
    goalId: UGV_WORKFLOW_IDENTITY.goalId,
    goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
    workflowPlanId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
    workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
    workflowDefinitionVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
    workflowInstanceId: INSTANCE_ID,
    workflowNodeId: input.workflowNodeId,
    workflowNodeRunId: input.workflowNodeRunId,
    mcpInvocationId: NAVIGATE_INVOCATION_ID,
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'smpp-tasks/1.0',
    protocolContract: Object.freeze({
      mode: 'frozen_v1' as const,
      protocolVersion: '2026-07-28',
      baselineSha256: 'd'.repeat(64),
      taskExecutionProfileVersion: '1.0',
      evidenceProfileVersion: '1.0',
      serverDiscoverySnapshotId: selected.server.discoverySnapshotId,
    }),
    taskBehavior: 'task_required',
    taskCancellation: selected.operation.executionSemantics.cancellation,
    runtimeRevision: 'runtime-revision-7',
    providerRevision: 'provider-revision-100',
    remoteRevision: 'provider-task-revision-100',
    executionContext: { mode: 'simulation', simulationId: selected.execution.simulationId },
    authoritySnapshot: Object.freeze({
      schemaVersion: '1.0' as const,
      capturedAt: '2026-08-21T12:00:00.000Z',
      runtime: Object.freeze({
        serverId: selected.server.serverId,
        endpoint,
        serverUpdatedAt: credentialRevision,
        toolRevision: selected.server.toolRevision,
        protocolSnapshotId: selected.server.discoverySnapshotId,
        catalogRevision: selected.server.catalogRevision,
        catalogChecksum: selected.server.catalogChecksum,
        operationCount: 2,
      }),
      providerBinding: Object.freeze({
        bindingId: selected.providerBinding.bindingId,
        revision: selected.providerBinding.revision,
        originType: 'direct' as const,
        providerId: selected.provider.providerId,
        endpointRef: endpoint,
        catalogRevision: selected.server.catalogRevision,
        catalogChecksum: selected.server.catalogChecksum,
        operationCount: 2,
        availabilityValidUntil: selected.availability.validUntil,
        observedAt: '2026-08-21T11:59:59.000Z',
      }),
    }),
    credentialRevision,
    sessionRevision: '2026-07-28/smpp-tasks/1.0',
    lastProviderUpdatedAt: '2026-08-21T12:00:00.100Z',
    pollIntervalMs: 1_000,
    createdAt: '2026-08-21T12:00:00.100Z',
  });
}

function governedConfirmation(
  selected: SelectedTaskOperation,
  plan: WorkflowPlanRecord,
): GovernedControlConfirmation {
  if (plan.definition === undefined || plan.confirmedAt === undefined)
    throw new Error('UGV_CONFIRMED_PLAN_DEFINITION_MISSING');
  const consumedDispatchHash = createMcpProviderDispatchHash({
    invocationId: NAVIGATE_INVOCATION_ID,
    taskId: UGV_WORKFLOW_IDENTITY.taskId,
    contextId: CONTEXT_ID,
    providerBindingId: selected.providerBinding.bindingId,
    providerId: selected.provider.providerId,
    serverId: selected.server.serverId,
    toolName: selected.operation.operationName,
    arguments: selected.resolvedArguments,
  });
  const issue = Object.freeze({
    taskId: UGV_WORKFLOW_IDENTITY.taskId,
    capabilityBindingId: 'capability-binding-uap-p2-b03',
    capabilityId: selected.task.semanticTaskType,
    capabilityVersion: 2,
    capabilityAttemptId: CAPABILITY_ATTEMPT_ID,
    planId: plan.planId,
    planHash: canonicalHash(plan.definition),
    skillId: selected.skill.skillId,
    skillVersion: selected.skill.version,
    providerBindingId: selected.providerBinding.bindingId,
    serverId: selected.server.serverId,
    toolName: selected.operation.operationName,
    argumentsHash: selected.argumentsHash.slice('sha256:'.length),
    actorId: 'operator-uap-p2-b03',
    actorKind: 'human' as const,
    authenticationMethod: 'bearer',
    actorRoles: Object.freeze(['physical_control_approver']),
    reason: 'Confirm the exact simulated UGV point-navigation plan.',
    expiresAt: '2026-08-21T12:10:00.000Z',
    selectedTaskOperationSnapshotHash: selected.snapshotHash,
  });
  return Object.freeze({
    ...issue,
    confirmationId: ugvGovernedControlConfirmationId(issue),
    confirmedAt: plan.confirmedAt,
    consumedInvocationId: NAVIGATE_INVOCATION_ID,
    consumedDispatchHash,
    consumedAt: '2026-08-21T12:00:00.010Z',
  });
}

function invocation(
  input: Readonly<{
    invocationId: string;
    toolName: string;
    arguments: Readonly<Record<string, unknown>>;
    result: unknown;
    startedAt: string;
    completedAt: string;
    semantics: McpInvocation['executionSemantics'];
    confirmation?: GovernedControlConfirmation;
  }>,
): McpInvocation {
  return Object.freeze({
    invocationId: input.invocationId,
    taskId: UGV_WORKFLOW_IDENTITY.taskId,
    ...(input.confirmation === undefined
      ? {}
      : {
          capabilityAttemptId: input.confirmation.capabilityAttemptId,
          controlConfirmationId: input.confirmation.confirmationId,
          controlProviderBindingId: input.confirmation.providerBindingId,
          controlArgumentsHash: input.confirmation.argumentsHash,
          controlDispatchHash: input.confirmation.consumedDispatchHash,
        }),
    contextId: CONTEXT_ID,
    executionMode: 'simulation',
    simulationId: 'sim-uap-p2-b03',
    serverId: 'ugv-runtime-1',
    toolName: input.toolName,
    executionSemantics: input.semantics,
    arguments: input.arguments,
    result: input.result,
    status: 'succeeded',
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: Date.parse(input.completedAt) - Date.parse(input.startedAt),
  });
}

function completedRemoteTaskSnapshot(result: InternalToolResult) {
  return Object.freeze({
    protocolMode: 'frozen_v1' as const,
    remoteTaskId: REMOTE_TASK_ID,
    status: 'completed' as const,
    createdAt: '2026-08-21T12:00:00.100Z',
    lastUpdatedAt: TERMINAL_AT,
    ttlMs: 60_000,
    pollIntervalMs: 1_000,
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'smpp-tasks/1.0',
    runtimeRevision: 'runtime-revision-7',
    providerRevision: 'provider-revision-101',
    providerObservation: Object.freeze({
      revision: '1.0' as const,
      remoteRevision: 'provider-task-revision-101',
      observedAt: TERMINAL_AT,
    }),
    result,
  });
}

function terminalNavigateResult(): InternalToolResult {
  return Object.freeze({
    content: Object.freeze([]),
    structuredContent: Object.freeze({
      resourceId: 'vehicle:ugv1',
      status: 'completed',
      observedAt: TERMINAL_AT,
      snapshotRevision: 'provider-snapshot-101',
      correlationStrength: 'STRICT_CORRELATED',
      observationAuthority: 'post_dispatch',
      positionAuthority: Object.freeze({
        field: 'chassis.position.geodetic',
        topic: '/ugv/gnss',
        observedAt: TERMINAL_AT,
        timeAuthority: 'source',
        cursor: providerCursor(101, TERMINAL_AT),
      }),
    }),
    isError: false,
  });
}

function stateResult(
  input: Readonly<{
    observedAt: string;
    revision: string;
    cursor: number;
    position: Readonly<{ longitude: number; latitude: number }>;
  }>,
): InternalToolResult {
  return Object.freeze({
    content: Object.freeze([]),
    structuredContent: Object.freeze({
      identity: Object.freeze({
        providerId: 'isr.vehicle.ugv.ugv1',
        resourceId: 'vehicle:ugv1',
        vehicleType: 'ugv',
        executionMode: 'simulation',
      }),
      connectivity: Object.freeze({ mqttConnected: true, deviceMcpConnected: true }),
      observedAt: input.observedAt,
      freshness: Object.freeze({ chassisObservedAt: input.observedAt }),
      revision: input.revision,
      mqttIngressSequence: input.cursor,
      chassis: Object.freeze({ position: input.position }),
    }),
    isError: false,
  });
}

function providerCursor(sequence: number, observedAt: string): string {
  return `oc1.${Buffer.from(
    JSON.stringify({
      version: 1,
      kind: 'field',
      field: 'chassis.position.geodetic',
      topic: '/ugv/gnss',
      observedAt,
      timeAuthority: 'source',
      ingestSequence: sequence,
      payloadHash: 'e'.repeat(64),
    }),
  ).toString('base64url')}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('UGV_MCP_ARGUMENTS_NOT_OBJECT');
  return value as Readonly<Record<string, unknown>>;
}
