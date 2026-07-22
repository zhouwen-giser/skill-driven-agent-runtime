import { describe, expect, it } from 'vitest';
import { resolveMcpTaskExecution } from '../src/index.js';

describe('MCP Task execution resolver protocol isolation', () => {
  it('resolves and freezes the sole Frozen execution contract', () => {
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
    expect(Object.isFrozen(frozen)).toBe(true);
  });
});
