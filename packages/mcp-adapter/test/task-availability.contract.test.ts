import { describe, expect, it } from 'vitest';

import {
  parseTaskOperationSemantics,
  taskAvailabilityResponseSchema,
  toTaskAvailabilityResults,
} from '../src/index.js';

const request = {
  nodeId: 'patrol',
  operationName: 'vehicle_patrol',
  arguments: { unresolved: false as const, value: { route: 'A' } },
};

describe('MCP Task availability frozen contract', () => {
  it('rejects unknown Tool metadata revision, enum, and fields', () => {
    for (const value of [
      { execution: 'task_required', revision: '2.0' },
      {
        execution: 'task_required',
        availability: 'dynamic',
        supportsScheduling: true,
        supportsMaxElapsed: true,
        supportsObservations: true,
        cancellation: 'magic',
        revision: '1.0',
      },
      {
        execution: 'task_required',
        availability: 'dynamic',
        supportsScheduling: true,
        supportsMaxElapsed: true,
        supportsObservations: true,
        cancellation: 'task_cancel',
        revision: '1.0',
        code: 'unregistered-dynamic-source',
      },
    ])
      expect(() => parseTaskOperationSemantics({ 'io.sdar/taskExecution': value })).toThrow(
        expect.objectContaining({ code: 'MCP_TASK_AVAILABILITY_RESPONSE_INVALID' }),
      );
  });

  it.each([
    [
      'guaranteed without reservationRef',
      {
        nodeId: 'patrol',
        operationName: 'vehicle_patrol',
        availability: 'restricted',
        riskLevel: 'high',
        validUntil: '2026-07-16T22:10:00.000Z',
        earliestStartTime: '2026-07-16T22:02:00.000Z',
        reservationMode: 'guaranteed',
      },
    ],
    [
      'overlapping windows',
      {
        nodeId: 'patrol',
        operationName: 'vehicle_patrol',
        availability: 'restricted',
        riskLevel: 'high',
        reservationMode: 'best_effort',
        nextAvailableWindows: [
          { startTime: '2026-07-16T22:02:00.000Z', endTime: '2026-07-16T22:05:00.000Z' },
          { startTime: '2026-07-16T22:04:00.000Z', endTime: '2026-07-16T22:06:00.000Z' },
        ],
      },
    ],
    [
      'mismatched correlation',
      {
        nodeId: 'other',
        operationName: 'vehicle_patrol',
        availability: 'available',
        riskLevel: 'low',
        reservationMode: 'none',
      },
    ],
  ])('fails closed for %s', (_label, result) => {
    const wire = taskAvailabilityResponseSchema.parse({ revision: '1.0', results: [result] });
    expect(() => toTaskAvailabilityResults(wire, [request])).toThrow(
      expect.objectContaining({
        code: expect.stringMatching(/^MCP_TASK_AVAILABILITY_/u),
      }),
    );
  });
});
