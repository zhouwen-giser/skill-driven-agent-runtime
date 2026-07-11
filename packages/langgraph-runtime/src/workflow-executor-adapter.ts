import type { WorkflowExecutor } from '../../application/src/ports.js';
import type { WorkflowBudgetLimits, WorkflowDefinition } from '../../domain/src/index.js';
import {
  compileWorkflow,
  type WorkflowCallCosts,
  type WorkflowRuntimePorts,
} from './workflow-compiler.js';

export class LangGraphWorkflowExecutor implements WorkflowExecutor {
  readonly #ports: WorkflowRuntimePorts;
  readonly #callCosts: WorkflowCallCosts;
  constructor(ports: WorkflowRuntimePorts, callCosts: WorkflowCallCosts) {
    this.#ports = ports;
    this.#callCosts = callCosts;
  }

  async execute(
    definition: WorkflowDefinition,
    input: unknown,
    budgetLimits: WorkflowBudgetLimits,
    signal?: AbortSignal,
  ) {
    const result = await compileWorkflow(definition, 'confirmed', this.#ports).invoke(
      input,
      budgetLimits,
      this.#callCosts,
      signal,
    );
    return {
      status: result.status,
      ...(result.result === undefined ? {} : { result: result.result }),
      errors: result.errors,
      budgetUsage: result.budgetUsage,
      ...(result.terminationReason === undefined
        ? {}
        : { terminationReason: result.terminationReason }),
      events: result.events,
    };
  }
}
