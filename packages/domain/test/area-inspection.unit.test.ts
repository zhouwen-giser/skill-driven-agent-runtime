import { describe, expect, it } from 'vitest';
import contract from '../src/area-inspection-tool-contract.json' with { type: 'json' };
import {
  assertInspectionToolContract,
  capabilityDispatchInput,
  inspectionReportComplete,
  inspectionTaskExecution,
  inspectionToolArguments,
  parseAreaInspectionInput,
  projectInspectionResult,
  unwrapInspectionResultSchema,
} from '../src/area-inspection.js';

const now = '2026-10-14T00:00:00.000Z';
const input = {
  resourceId: 'vehicle:ugv1',
  area: {
    boundary: [
      { x: 116, y: 39 },
      { x: 117, y: 39 },
      { x: 117, y: 40 },
    ],
  },
  timeWindow: { earliestStart: now, deadline: '2026-10-14T00:10:00.000Z' },
};
const report = {
  resourceId: input.resourceId,
  status: 'completed',
  observedAt: now,
  anomalies: [],
  inspectionReport: {
    version: '1.0',
    completion: 'complete',
    targetReportObservedAt: now,
    targetReportComplete: true,
    coverageState: 'full',
    findingCount: 0,
    truncated: false,
    artifactRefs: [],
  },
  coverage: { coveragePercent: 100, incomplete: false },
  correlationStrength: 'STRICT_CORRELATED',
  missingEvidence: [],
};
const profile = {
  profileVersion: '1.0',
  taskBehavior: 'task_required',
  supportsScheduling: true,
  supportsMaxElapsed: true,
  supportsCancellation: true,
  supportsPauseResume: true,
  supportsObservations: true,
  idempotency: 'server_managed',
};
function tool() {
  const value = structuredClone(contract);
  value.input.properties.resourceId.const = input.resourceId;
  value.result.properties.resourceId.const = input.resourceId;
  return {
    inputSchema: value.input,
    outputSchema: value.result,
    taskExecutionProfile: { ...profile },
  };
}

describe('governed WGS84 inspection contract', () => {
  it('keeps x=longitude, y=latitude and sends only strict Provider arguments', () => {
    expect(inspectionToolArguments(input)).toEqual({
      resourceId: input.resourceId,
      area: input.area,
    });
    expect(parseAreaInspectionInput(input).timeWindow).toEqual(input.timeWindow);
  });
  it.each([
    { area: { ...input.area, frame: 'map' } },
    { area: { ...input.area, excludedZones: ['unresolved'] } },
    {
      area: {
        boundary: [
          { x: 116, y: 39 },
          { x: 117, y: 40 },
          { x: 118, y: 41 },
        ],
      },
    },
    {
      area: {
        boundary: [
          { x: 181, y: 39 },
          { x: 117, y: 39 },
          { x: 117, y: 40 },
        ],
      },
    },
    { timeWindow: { earliestStart: now, deadline: now } },
    { timeWindow: { earliestStart: '2026-10-14 00:00:00', deadline: input.timeWindow.deadline } },
  ])('rejects illegal area or deadline before transport: %j', (patch) => {
    expect(() => inspectionToolArguments({ ...input, ...patch })).toThrow();
  });
  it('takes the minimum of the parent remaining deadline and 300 seconds at dispatch', () => {
    expect(inspectionTaskExecution(input, now).timing).toEqual({
      start: { mode: 'scheduled', scheduledAt: now, startToleranceMs: 30000 },
      maxElapsedMs: 300000,
    });
    expect(inspectionTaskExecution(input, '2026-10-14T00:09:59.000Z').timing?.maxElapsedMs).toBe(
      1000,
    );
    const future = {
      ...input,
      timeWindow: {
        earliestStart: '2026-10-14T00:09:30.000Z',
        deadline: input.timeWindow.deadline,
      },
    };
    expect(inspectionTaskExecution(future, now).timing).toEqual({
      start: {
        mode: 'scheduled',
        scheduledAt: future.timeWindow.earliestStart,
        startToleranceMs: 29999,
      },
      maxElapsedMs: 30000,
    });
    expect(() => inspectionTaskExecution(input, input.timeWindow.deadline)).toThrow(
      'INSPECTION_DEADLINE_EXPIRED',
    );
  });
  it('requires the exact reviewed wire schema and native Task Profile', () => {
    expect(() => {
      assertInspectionToolContract(tool());
    }).not.toThrow();
    const axis = tool();
    axis.inputSchema.properties.area.properties.boundary.items.properties.x.maximum = 90;
    expect(() => {
      assertInspectionToolContract(axis);
    }).toThrow('INSPECTION_TOOL_CONTRACT_INVALID');
    const lifecycle = tool();
    lifecycle.taskExecutionProfile.supportsPauseResume = false;
    expect(() => {
      assertInspectionToolContract(lifecycle);
    }).toThrow('INSPECTION_TASK_PROFILE_INVALID');
    const identity = tool();
    identity.outputSchema.properties.resourceId.const = 'vehicle:other';
    expect(() => {
      assertInspectionToolContract(identity);
    }).toThrow('INSPECTION_TOOL_CONTRACT_INVALID');
  });
  it('uses an explicitly frozen adapter in the physical confirmation hash', () => {
    const binding = {
      requestedCapabilityId: 'embodied.inspect_area',
      inputSnapshot: input,
      constraintSnapshot: [
        {
          type: 'inspection_input_adapter',
          version: 1,
          toolName: 'vehicle_inspect_area',
          maxElapsedMs: 300000,
        },
      ],
    };
    expect(capabilityDispatchInput(binding)).toEqual(inspectionToolArguments(input));
    expect(() => capabilityDispatchInput({ ...binding, constraintSnapshot: [] })).toThrow(
      'INSPECTION_ADAPTER_AUTHORITY_INVALID',
    );
    expect(capabilityDispatchInput({ ...binding, requestedCapabilityId: 'another' })).toEqual(
      input,
    );
  });
  it('accepts only the frozen public Task error envelope around the reviewed success schema', () => {
    const error = {
      type: 'object',
      properties: {
        outcome: { type: 'string', minLength: 1 },
        reasonCode: { type: 'string', minLength: 1 },
        retryable: { type: 'boolean' },
        completedAt: { type: 'string', format: 'date-time' },
      },
      required: ['outcome', 'reasonCode', 'retryable', 'completedAt'],
      additionalProperties: true,
    };
    const base = tool();
    const wrapped = { type: 'object', anyOf: [base.outputSchema, error] };
    expect(unwrapInspectionResultSchema(wrapped)).toEqual(base.outputSchema);
    expect(() => {
      assertInspectionToolContract({ ...base, outputSchema: wrapped });
    }).not.toThrow();
    for (const envelope of [
      { ...wrapped, additionalProperties: true },
      { ...wrapped, anyOf: [base.outputSchema, { ...error, required: [] }] },
      { ...wrapped, anyOf: [base.outputSchema, error, {}] },
    ])
      expect(() => {
        assertInspectionToolContract({ ...base, outputSchema: envelope });
      }).toThrow('INSPECTION_TOOL_CONTRACT_INVALID');
  });
  it('accepts an observed empty report and explicitly degrades missing source, coverage or truncated reports', () => {
    expect(inspectionReportComplete(report)).toBe(true);
    expect(projectInspectionResult(report)).toMatchObject({
      status: 'completed',
      providerStatus: 'completed',
      anomalies: [],
    });
    for (const [completion, code, patch] of [
      [
        'unavailable',
        'INSPECTION_TARGET_REPORT_MISSING',
        { targetReportComplete: false, targetReportObservedAt: null },
      ],
      ['partial', 'INSPECTION_COVERAGE_INCOMPLETE', { coverageState: 'partial' }],
      ['partial', 'INSPECTION_INLINE_REPORT_TRUNCATED', { truncated: true, findingCount: 260 }],
    ] as const) {
      const incomplete = {
        ...report,
        inspectionReport: { ...report.inspectionReport, ...patch, completion },
        missingEvidence: [code],
      };
      expect(inspectionReportComplete(incomplete)).toBe(false);
      expect(projectInspectionResult(incomplete)).toMatchObject({
        status: 'degraded',
        providerStatus: 'completed',
        missingEvidence: [code],
      });
    }
    expect(() => projectInspectionResult({ ...report, coverage: null })).toThrow(
      'INSPECTION_REPORT_INCONSISTENT',
    );
  });
});
