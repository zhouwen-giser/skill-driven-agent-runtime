import { WorkflowChildCallError } from '../../domain/src/index.js';
import type {
  RuntimeExecutionContext,
  WorkflowChildExecutionResult,
} from '../../domain/src/index.js';
import type { Clock, WorkflowChildCallRepository, WorkflowPlanRepository } from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';
import { canonicalHash } from './mcp-task-readiness.js';

export interface SubworkflowExecutionInput {
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly parentInstanceId: string;
  readonly parentNodeId: string;
  readonly parentNodeRunId: string;
  readonly input: unknown;
  readonly signal?: AbortSignal;
  readonly resumeChild?: boolean;
  readonly executionContext: RuntimeExecutionContext;
  readonly continuationAuthority?: Readonly<{
    agentTaskId: string;
    contextId: string;
    workflowControlId: string;
  }>;
}

/** Creates ordinary children through the same persistent execution service as root/Skill calls. */
export class SubworkflowExecutionService {
  readonly #inFlight = new Map<
    string,
    { inputHash: string; promise: Promise<WorkflowChildExecutionResult> }
  >();
  constructor(
    private readonly dependencies: Readonly<{
      calls: WorkflowChildCallRepository;
      plans: Pick<WorkflowPlanRepository, 'findConfirmedDefinition' | 'findPlan'>;
      execution: Pick<WorkflowExecutionService, 'execute' | 'get' | 'resumeHumanConfirmation'>;
      clock: Clock;
    }>,
  ) {}

  execute(input: SubworkflowExecutionInput): Promise<WorkflowChildExecutionResult> {
    const key = canonicalHash([input.parentInstanceId, input.parentNodeRunId]);
    const inputHash = canonicalHash([
      input.workflowDefinitionId,
      input.workflowVersion,
      input.input,
    ]);
    const existing = this.#inFlight.get(key);
    if (existing !== undefined) {
      if (existing.inputHash !== inputHash)
        return Promise.reject(new WorkflowChildCallError('WORKFLOW_CHILD_CALL_INPUT_CONFLICT'));
      return existing.promise;
    }
    const promise = this.#execute(input, key).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, { inputHash, promise });
    return promise;
  }

  async #execute(
    input: SubworkflowExecutionInput,
    key: string,
  ): Promise<WorkflowChildExecutionResult> {
    input.signal?.throwIfAborted();
    const { calls, plans, execution, clock } = this.dependencies;
    const parent = await execution.get(input.parentInstanceId);
    if (parent === undefined || !['running', 'paused', 'waiting_external'].includes(parent.status))
      throw new WorkflowChildCallError('WORKFLOW_CHILD_PARENT_NOT_ACTIVE');
    const existing = await calls.find(input.parentInstanceId, input.parentNodeRunId);
    const plan =
      existing === undefined
        ? await plans.findConfirmedDefinition(input.workflowDefinitionId, input.workflowVersion)
        : await plans.findPlan(existing.childPlanId);
    if (
      plan?.confirmationStatus !== 'confirmed' ||
      plan.definition?.workflowDefinitionId !== input.workflowDefinitionId ||
      plan.definition.version !== input.workflowVersion
    )
      throw new WorkflowChildCallError('WORKFLOW_SUBWORKFLOW_NOT_CONFIRMED');
    if (
      existing !== undefined &&
      (existing.kind !== 'subworkflow' || existing.parentNodeId !== input.parentNodeId)
    )
      throw new WorkflowChildCallError('WORKFLOW_CHILD_CALL_IDENTITY_CONFLICT');
    const link =
      existing ??
      (await calls.save({
        callId: `workflow-child-call-${key}`,
        kind: 'subworkflow',
        parentInstanceId: input.parentInstanceId,
        parentNodeRunId: input.parentNodeRunId,
        parentNodeId: input.parentNodeId,
        childPlanId: plan.planId,
        createdAt: clock.now(),
      }));
    const childInstanceId = link.childInstanceId ?? `instance-${link.callId}`;
    let child = await execution.get(childInstanceId);
    if (child !== undefined && canonicalHash(child.input) !== canonicalHash(input.input))
      throw new WorkflowChildCallError('WORKFLOW_CHILD_CALL_INPUT_CONFLICT');
    if (child === undefined) {
      if (existing !== undefined)
        throw new WorkflowChildCallError('WORKFLOW_CHILD_STATE_UNAVAILABLE');
      child = await execution.execute({
        instanceId: childInstanceId,
        planId: link.childPlanId,
        input: input.input,
        executionContext: input.executionContext,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.continuationAuthority === undefined
          ? {}
          : { continuationAuthority: input.continuationAuthority }),
        onStarted: async () => {
          await calls.save({ ...link, childInstanceId });
        },
      });
    } else if (child.status === 'paused' && input.resumeChild !== undefined) {
      child = await execution.resumeHumanConfirmation({
        instanceId: childInstanceId,
        confirmed: input.resumeChild,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.continuationAuthority === undefined
          ? {}
          : { continuationAuthority: input.continuationAuthority }),
      });
    }
    if (child.status === 'succeeded') return { status: 'completed', output: child.result };
    if (child.status === 'paused')
      return {
        status: 'paused',
        childInstanceId,
        prompt: child.pendingConfirmation?.prompt ?? 'Confirm child Workflow continuation.',
      };
    if (child.status === 'waiting_external')
      return {
        status: 'waiting_external',
        wait: {
          waitId: `child-workflow-${childInstanceId}`,
          kind: 'child_workflow',
          sourceId: childInstanceId,
          nodeId: input.parentNodeId,
          nodeRunId: input.parentNodeRunId,
          state: 'waiting',
        },
      };
    const error = Object.values(child.errors)[0];
    return {
      status: child.status === 'canceled' ? 'canceled' : 'failed',
      code: error?.code ?? 'WORKFLOW_SUBWORKFLOW_FAILED',
      message: error?.message ?? `Child Workflow ended in ${child.status}; it cannot be replayed.`,
    };
  }
}
