import { describe, expect, it } from 'vitest';

import type { TaskAvailabilityCheckResult } from '../../../packages/domain/src/index.js';
import { UGV_UNKNOWN_AVAILABILITY_POLICY } from '../src/ugv-unknown-availability-policy.js';

describe('UGV unknown availability policy', () => {
  it.each([
    'UGV_TOOL_RECOVERING',
    'UGV_GNSS_STALE',
    'UGV_POSITION_UNHEALTHY',
    'UGV_RESOURCE_UNCORRELATED',
  ])('rejects explicit not-ready reason %s', (reasonCode) => {
    expect(UGV_UNKNOWN_AVAILABILITY_POLICY.decide(unknownResult(reasonCode))).toBe(
      'explicitly_not_ready',
    );
  });

  it.each([undefined, 'UGV_NO_FORECAST', 'PROVIDER_BUSY_STATE_UNKNOWN'])(
    'allows an otherwise unqualified unknown reason %s',
    (reasonCode) => {
      expect(UGV_UNKNOWN_AVAILABILITY_POLICY.decide(unknownResult(reasonCode))).toBe(
        'allowed_by_default',
      );
    },
  );
});

function unknownResult(reasonCode: string | undefined): TaskAvailabilityCheckResult {
  return Object.freeze({
    nodeId: 'navigate',
    operationName: 'vehicle_navigate',
    availability: 'unknown',
    riskLevel: 'medium',
    ...(reasonCode === undefined ? {} : { reasonCode }),
    validUntil: '2026-09-02T10:00:01.000Z',
    nextAvailableWindows: Object.freeze([]),
    reservationMode: 'none',
    possibleEffects: Object.freeze([]),
  });
}
