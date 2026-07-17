import type { WorkflowExecutor } from '../../application/src/ports.js';
import type {
  RuntimeExecutionContext,
  WorkflowExternalWaitResolution,
  WorkflowBudgetLimits,
  WorkflowDefinition,
  WorkflowRuntimeContinuationState,
} from '../../domain/src/index.js';
import {
  compileWorkflow,
  WorkflowCompilerError,
  type WorkflowCallCosts,
  type CompiledWorkflow,
  type WorkflowRuntimePorts,
} from './workflow-compiler.js';

export class LangGraphWorkflowExecutor implements WorkflowExecutor {
  readonly #ports: WorkflowRuntimePorts;
  readonly #callCosts: WorkflowCallCosts;
  readonly #executions = new Map<string, CompiledWorkflow>();
  constructor(ports: WorkflowRuntimePorts, callCosts: WorkflowCallCosts) {
    this.#ports = ports;
    this.#callCosts = callCosts;
  }

  async execute(
    definition: WorkflowDefinition,
    input: unknown,
    budgetLimits: WorkflowBudgetLimits,
    signal?: AbortSignal,
    executionId?: string,
    executionContext?: RuntimeExecutionContext,
  ): ReturnType<WorkflowExecutor['execute']> {
    const compiled = compileWorkflow(definition, 'confirmed', this.#ports);
    if (executionId !== undefined) this.#executions.set(executionId, compiled);
    const result = await compiled.invoke(
      input,
      budgetLimits,
      this.#callCosts,
      signal,
      executionId,
      executionContext,
    );
    if (executionId !== undefined && result.status !== 'paused')
      this.#executions.delete(executionId);
    return mapResult(result);
  }

  async resumeHumanConfirmation(
    executionId: string,
    confirmed: boolean,
    signal?: AbortSignal,
  ): ReturnType<WorkflowExecutor['execute']> {
    const compiled = this.#executions.get(executionId);
    if (compiled === undefined)
      throw new WorkflowCompilerError(
        'WORKFLOW_CHECKPOINT_NOT_AVAILABLE',
        'Workflow checkpoint is unavailable and cannot be recovered or retried.',
      );
    const result = await compiled.resume(executionId, confirmed, signal);
    if (result.status !== 'paused') this.#executions.delete(executionId);
    return mapResult(result);
  }

  async continueExternal(
    definition: WorkflowDefinition,
    executionId: string,
    continuation: WorkflowRuntimeContinuationState,
    resolution: WorkflowExternalWaitResolution,
    continuationAttemptId: string,
    signal?: AbortSignal,
  ): ReturnType<WorkflowExecutor['execute']> {
    const compiled = compileWorkflow(definition, 'confirmed', this.#ports);
    const result = await compiled.continueExternal(
      executionId,
      continuation,
      resolution,
      this.#callCosts,
      signal,
      continuationAttemptId,
    );
    return mapResult(result);
  }

  requestPause(executionId: string): boolean {
    return this.#executions.get(executionId)?.requestPause(executionId) ?? false;
  }

  requestCancel(executionId: string, interruptCurrent: boolean): boolean {
    return this.#executions.get(executionId)?.requestCancel(executionId, interruptCurrent) ?? false;
  }
}

function mapResult(
  result: Awaited<ReturnType<CompiledWorkflow['invoke']>>,
): Awaited<ReturnType<WorkflowExecutor['execute']>> {
  return {
    status: result.status,
    ...(result.result === undefined ? {} : { result: result.result }),
    errors: result.errors,
    budgetUsage: result.budgetUsage,
    ...(result.terminationReason === undefined
      ? {}
      : { terminationReason: result.terminationReason }),
    events: result.events,
    ...(result.pendingConfirmation === undefined
      ? {}
      : { pendingConfirmation: result.pendingConfirmation }),
    ...(result.continuation === undefined ? {} : { continuation: result.continuation }),
  };
}
