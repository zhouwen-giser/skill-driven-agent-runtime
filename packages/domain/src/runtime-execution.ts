import { DomainError } from './errors.js';

export type RuntimeExecutionMode = 'live' | 'simulation' | 'historical-replay';

export interface RuntimeExecutionContext {
  readonly mode: RuntimeExecutionMode;
  readonly simulationId?: string;
}

export const LIVE_RUNTIME_EXECUTION_CONTEXT: RuntimeExecutionContext = Object.freeze({
  mode: 'live',
});

export function createRuntimeExecutionContext(
  input: RuntimeExecutionContext,
): RuntimeExecutionContext {
  const simulationId = input.simulationId?.trim();
  if (input.mode === 'live') {
    if (simulationId !== undefined && simulationId !== '')
      throw new DomainError(
        'RUNTIME_EXECUTION_CONTEXT_INVALID',
        'Live execution cannot carry a simulation identity.',
      );
    return LIVE_RUNTIME_EXECUTION_CONTEXT;
  }
  if (simulationId === undefined || simulationId === '')
    throw new DomainError(
      'RUNTIME_EXECUTION_CONTEXT_INVALID',
      'Simulation and historical replay require a stable simulation identity.',
    );
  return Object.freeze({ mode: input.mode, simulationId });
}
