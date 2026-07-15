import { describe, expect, it } from 'vitest';

import {
  createRuntimeExecutionContext,
  LIVE_RUNTIME_EXECUTION_CONTEXT,
  MAX_RUNTIME_SIMULATION_ID_CHARACTERS,
} from '../src/index.js';

describe('RuntimeExecutionContext', () => {
  it('normalizes live execution and requires a stable identity for non-live modes', () => {
    expect(createRuntimeExecutionContext({ mode: 'live' })).toBe(LIVE_RUNTIME_EXECUTION_CONTEXT);
    expect(
      createRuntimeExecutionContext({ mode: 'simulation', simulationId: ' simulation-1 ' }),
    ).toEqual({ mode: 'simulation', simulationId: 'simulation-1' });
    expect(() => createRuntimeExecutionContext({ mode: 'historical-replay' })).toThrow(
      expect.objectContaining({ code: 'RUNTIME_EXECUTION_CONTEXT_INVALID' }),
    );
    expect(() => createRuntimeExecutionContext({ mode: 'live', simulationId: 'not-live' })).toThrow(
      expect.objectContaining({ code: 'RUNTIME_EXECUTION_CONTEXT_INVALID' }),
    );
    expect(
      createRuntimeExecutionContext({
        mode: 'simulation',
        simulationId: 'x'.repeat(MAX_RUNTIME_SIMULATION_ID_CHARACTERS),
      }),
    ).toEqual({
      mode: 'simulation',
      simulationId: 'x'.repeat(MAX_RUNTIME_SIMULATION_ID_CHARACTERS),
    });
    for (const simulationId of [
      'line\nbreak',
      'contains space',
      'x'.repeat(MAX_RUNTIME_SIMULATION_ID_CHARACTERS + 1),
    ])
      expect(() => createRuntimeExecutionContext({ mode: 'simulation', simulationId })).toThrow(
        expect.objectContaining({ code: 'RUNTIME_EXECUTION_CONTEXT_INVALID' }),
      );
  });
});
