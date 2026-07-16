import { DomainError } from './errors.js';

export type RuntimeExecutionMode = 'live' | 'simulation' | 'historical-replay';

export interface RuntimeExecutionContext {
  readonly mode: RuntimeExecutionMode;
  readonly simulationId?: string;
}

export const MAX_RUNTIME_SIMULATION_ID_CHARACTERS = 256;
const SAFE_HEADER_ID = /^[\x21-\x7E]+$/u;

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
  if (
    simulationId.length > MAX_RUNTIME_SIMULATION_ID_CHARACTERS ||
    !SAFE_HEADER_ID.test(simulationId)
  )
    throw new DomainError(
      'RUNTIME_EXECUTION_CONTEXT_INVALID',
      `Simulation identity must contain 1-${String(MAX_RUNTIME_SIMULATION_ID_CHARACTERS)} visible ASCII characters.`,
    );
  return Object.freeze({ mode: input.mode, simulationId });
}
