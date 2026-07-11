import type { WorkflowExecutor } from '../../application/src/ports.js';
import type { WorkflowDefinition } from '../../domain/src/index.js';
import { compileWorkflow, type WorkflowRuntimePorts } from './workflow-compiler.js';

export class LangGraphWorkflowExecutor implements WorkflowExecutor {
  readonly #ports: WorkflowRuntimePorts;
  constructor(ports: WorkflowRuntimePorts) {
    this.#ports = ports;
  }

  async execute(definition: WorkflowDefinition, input: unknown, signal?: AbortSignal) {
    const result = await compileWorkflow(definition, 'confirmed', this.#ports).invoke(
      input,
      signal,
    );
    return {
      status: result.status,
      ...(result.result === undefined ? {} : { result: result.result }),
      errors: result.errors,
      events: result.events,
    };
  }
}
