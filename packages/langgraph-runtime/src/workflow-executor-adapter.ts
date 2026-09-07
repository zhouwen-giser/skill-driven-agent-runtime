import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import type { WorkflowExecutor } from '../../application/src/ports.js';
import type {
  RuntimeExecutionContext,
  WorkflowExternalWaitResolution,
  WorkflowBudgetLimits,
  WorkflowDefinition,
  WorkflowRuntimeContinuationState,
  WorkflowConfirmationResume,
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
  readonly #compilerOptions: Readonly<{ maxSupersteps?: number }>;
  readonly #executions = new Map<string, CompiledWorkflow>();
  constructor(
    ports: WorkflowRuntimePorts,
    callCosts: WorkflowCallCosts,
    compilerOptions: Readonly<{ maxSupersteps?: number }> = {},
  ) {
    this.#ports = ports;
    this.#callCosts = callCosts;
    this.#compilerOptions = Object.freeze({ ...compilerOptions });
  }

  async execute(
    definition: WorkflowDefinition,
    input: unknown,
    budgetLimits: WorkflowBudgetLimits,
    signal?: AbortSignal,
    executionId?: string,
    executionContext?: RuntimeExecutionContext,
    prepareExternalWait?: Parameters<WorkflowExecutor['execute']>[6],
  ): ReturnType<WorkflowExecutor['execute']> {
    const compiled = compileWorkflow(definition, 'confirmed', this.#ports, this.#compilerOptions);
    if (executionId !== undefined) this.#executions.set(executionId, compiled);
    let result;
    try {
      result = await inWorkflowSession(() =>
        compiled.invoke(
          input,
          budgetLimits,
          this.#callCosts,
          signal,
          executionId,
          executionContext,
          prepareExternalWait,
        ),
      );
    } catch (error: unknown) {
      if (executionId !== undefined) this.#executions.delete(executionId);
      throw error;
    }
    if (
      executionId !== undefined &&
      result.status !== 'paused' &&
      result.status !== 'waiting_external'
    )
      this.#executions.delete(executionId);
    return mapResult(result);
  }

  async resumeHumanConfirmation(
    executionId: string,
    confirmed: WorkflowConfirmationResume,
    signal?: AbortSignal,
    prepareExternalWait?: Parameters<NonNullable<WorkflowExecutor['resumeHumanConfirmation']>>[3],
  ): ReturnType<WorkflowExecutor['execute']> {
    const compiled = this.#executions.get(executionId);
    if (compiled === undefined)
      throw new WorkflowCompilerError(
        'WORKFLOW_CHECKPOINT_NOT_AVAILABLE',
        'Workflow checkpoint is unavailable and cannot be recovered or retried.',
      );
    let result;
    try {
      result = await inWorkflowSession(() =>
        compiled.resume(executionId, confirmed, signal, prepareExternalWait),
      );
    } catch (error: unknown) {
      this.#executions.delete(executionId);
      throw error;
    }
    if (result.status !== 'paused' && result.status !== 'waiting_external')
      this.#executions.delete(executionId);
    return mapResult(result);
  }

  async continueExternal(
    definition: WorkflowDefinition,
    executionId: string,
    continuation: WorkflowRuntimeContinuationState,
    resolution: WorkflowExternalWaitResolution,
    continuationAttemptId: string,
    signal?: AbortSignal,
    prepareExternalWait?: Parameters<NonNullable<WorkflowExecutor['continueExternal']>>[6],
  ): ReturnType<WorkflowExecutor['execute']> {
    const compiled = compileWorkflow(definition, 'confirmed', this.#ports, this.#compilerOptions);
    this.#executions.set(executionId, compiled);
    let result;
    try {
      result = await inWorkflowSession(() =>
        compiled.continueExternal(
          executionId,
          continuation,
          resolution,
          this.#callCosts,
          signal,
          continuationAttemptId,
          prepareExternalWait,
        ),
      );
    } catch (error: unknown) {
      this.#executions.delete(executionId);
      throw error;
    }
    if (result.status !== 'paused' && result.status !== 'waiting_external')
      this.#executions.delete(executionId);
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

/** A persistent child is an independent graph session, not an implicit SDK nested subgraph. */
function inWorkflowSession<T>(operation: () => Promise<T>): Promise<T> {
  return AsyncLocalStorageProviderSingleton.runWithConfig({}, operation, true);
}
