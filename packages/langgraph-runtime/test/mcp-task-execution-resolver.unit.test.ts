import { describe, expect, it } from 'vitest';
import { resolveMcpTaskExecution } from '../src/index.js';

describe('MCP Task execution resolver protocol isolation', () => {
  it('preserves historical Legacy mode and emits no mode for Frozen execution', () => {
    expect(
      resolveMcpTaskExecution(
        { mode: 'require_task', availabilityCheck: 'required' },
        { input: {}, outputs: {}, errors: {}, loopCounts: {} },
      ),
    ).toEqual({ mode: 'require_task', availabilityCheck: 'required' });

    const frozen = resolveMcpTaskExecution(
      {
        protocolMode: 'frozen_v1',
        availabilityCheck: 'required',
        reservationRef: 'reservation-123',
      },
      { input: {}, outputs: {}, errors: {}, loopCounts: {} },
    );
    expect(frozen).toEqual({
      protocolMode: 'frozen_v1',
      availabilityCheck: 'required',
      reservationRef: 'reservation-123',
    });
    expect(frozen).not.toHaveProperty('mode');
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
