import { describe, it, expect } from 'vitest';
import { readRetainedInspectionResult } from '../src/patrol-evidence-reader.js';
import { readRetainedZmqPatrolChildResult } from '../src/patrol-evidence-reader.js';
import { projectTaskBusiness } from '../../../packages/domain/src/index.js';
import { taskBusinessFixture } from '../../../packages/domain/test/task-business-fixture.js';
import { areaReportChildExecutionStatus } from '../src/area-report-terminal.js';
const retained = {
  resourceId: 'vehicle:ugv1',
  status: 'failed',
  anomalies: [{ findingId: 'observed-7' }],
  inspectionReport: { version: '1.0', completion: 'partial' },
  missingEvidence: ['INSPECTION_SCAN_NOT_COMPLETED'],
};
function projection(wrapped = false) {
  const view = taskBusinessFixture({
    operationName: 'vehicle_inspect_area',
    resourceId: 'vehicle:ugv1',
  });
  return projectTaskBusiness({
    bindingId: 'bound-inspection',
    taskId: 'inspection-child',
    view: {
      ...view,
      context: {
        ...view.context,
        summary: {
          ...view.context.summary,
          properties: { inspectionResult: wrapped ? { structuredContent: retained } : retained },
        },
      },
    },
    contents: [],
    receivedAt: '2026-10-14T00:00:00Z',
    projectedAt: '2026-10-14T00:00:00Z',
    historyContinuous: false,
  });
}
describe('Retained native inspection reports', () => {
  it('retains scoped failed ZMQ discoveries and refuses another child or resource', () => {
    const raw = {
      schemaVersion: 'ugv.zmq-inspection-result/2',
      resourceId: 'vehicle:ugv1',
      nativeOutcome: 'failed',
      stopConfirmed: true,
      inspectionReport: { completion: 'partial', complete: false },
      anomalies: [{ entityId: 'seen-before-failure' }],
      missingEvidence: ['SCAN_FAILED'],
    };
    const view = taskBusinessFixture({
      operationName: 'vehicle_zmq_inspect_area',
      resourceId: 'vehicle:ugv1',
    });
    const p = projectTaskBusiness({
      bindingId: 'native-child-binding',
      taskId: 'native-child',
      view: {
        ...view,
        context: {
          ...view.context,
          summary: { ...view.context.summary, properties: { executionResult: raw } },
        },
      },
      contents: [],
      receivedAt: '2026-10-28T00:00:00Z',
      projectedAt: '2026-10-28T00:00:00Z',
      historyContinuous: false,
    });
    expect(
      readRetainedZmqPatrolChildResult(
        p,
        'native-child',
        'vehicle:ugv1',
        'vehicle_zmq_inspect_area',
      ),
    ).toMatchObject({
      status: 'failed',
      providerResult: { anomalies: raw.anomalies },
      missingEvidence: expect.arrayContaining(['SCAN_FAILED']),
    });
    expect(
      readRetainedZmqPatrolChildResult(
        p,
        'another-child',
        'vehicle:ugv1',
        'vehicle_zmq_inspect_area',
      ),
    ).toBeUndefined();
    expect(
      readRetainedZmqPatrolChildResult(
        p,
        'native-child',
        'other-resource',
        'vehicle_zmq_inspect_area',
      ),
    ).toBeUndefined();
    expect(
      readRetainedZmqPatrolChildResult(
        { ...p, status: 'history' },
        'native-child',
        'vehicle:ugv1',
        'vehicle_zmq_inspect_area',
      ),
    ).toBeUndefined();
  });
  it('keeps a successfully reported incomplete inspection degraded across child completion callbacks', () => {
    const child = {
      status: 'succeeded' as const,
      result: { status: 'degraded' },
      skillVersions: [{ skillId: 'embodied.inspect_area', version: 1 }],
    };
    expect(areaReportChildExecutionStatus(child, 'completed')).toBe('degraded');
    expect(areaReportChildExecutionStatus(child, 'failed')).toBe('failed');
    expect(areaReportChildExecutionStatus({ ...child, status: 'running' }, 'completed')).toBe(
      'completed',
    );
    expect(
      areaReportChildExecutionStatus({ ...child, result: { status: 'completed' } }, 'completed'),
    ).toBe('completed');
    expect(
      areaReportChildExecutionStatus(
        { ...child, skillVersions: [{ skillId: 'other.skill', version: 1 }] },
        'completed',
      ),
    ).toBe('completed');
  });
  it.each([false, true])('restores the actual scoped failed report with wrapping=%s', (wrapped) => {
    expect(
      readRetainedInspectionResult(projection(wrapped), 'inspection-child', 'vehicle:ugv1'),
    ).toMatchObject(retained);
  });
  it('rejects another Task, resource, operation or historical projection', () => {
    const original = projection();
    expect(readRetainedInspectionResult(original, 'old-child', 'vehicle:ugv1')).toBeUndefined();
    expect(
      readRetainedInspectionResult(original, 'inspection-child', 'vehicle:other'),
    ).toBeUndefined();
    expect(
      readRetainedInspectionResult(
        { ...original, status: 'history' },
        'inspection-child',
        'vehicle:ugv1',
      ),
    ).toBeUndefined();
    expect(
      readRetainedInspectionResult(
        { ...original, identity: { ...original.identity, operationName: 'vehicle_area_recon' } },
        'inspection-child',
        'vehicle:ugv1',
      ),
    ).toBeUndefined();
  });
});
