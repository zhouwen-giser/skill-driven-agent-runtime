import { describe, expect, it } from 'vitest';
import {
  aggregateAreaPatrol,
  parseAreaPatrolInput,
  patrolNavigationTaskExecution,
  type PatrolChildEvidence,
} from '../src/area-patrol.js';
const input = {
  resourceId: 'vehicle:ugv1',
  target: { x: 116.5, y: 39.5, frame: 'WGS84' },
  area: {
    boundary: [
      { x: 116, y: 39 },
      { x: 117, y: 39 },
      { x: 117, y: 40 },
      { x: 116, y: 40 },
    ],
  },
  timeWindow: { earliestStart: '2026-10-14T00:00:00Z', deadline: '2026-10-14T00:05:00Z' },
};
const report = {
  resourceId: input.resourceId,
  status: 'completed',
  observedAt: '2026-10-14T00:01:00Z',
  anomalies: [],
  inspectionReport: {
    version: '1.0',
    completion: 'complete',
    targetReportObservedAt: '2026-10-14T00:01:00Z',
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
function children(): PatrolChildEvidence[] {
  return [
    {
      taskId: 'move',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      phase: 'completed',
      result: {
        resourceId: input.resourceId,
        status: 'completed',
        finalPosition: { x: 116.5, y: 39.5 },
      },
      trajectory: [
        { resourceId: input.resourceId, position: { x: 116, y: 39, frame: 'EPSG:4326' } },
        { resourceId: input.resourceId, position: { x: 116.5, y: 39.5, frame: 'EPSG:4326' } },
      ],
      trajectorySourceRefs: ['task-business:move:digest'],
      missingEvidence: [],
    },
    {
      taskId: 'inspect',
      skillId: 'embodied.inspect_area',
      skillVersion: 1,
      phase: 'completed',
      result: structuredClone(report),
      missingEvidence: [],
    },
  ];
}
describe('Source-qualified patrol aggregation', () => {
  it('allows navigation longer than five minutes while preserving the parent deadline', () => {
    const long = {
      ...input,
      timeWindow: { ...input.timeWindow, deadline: '2026-10-14T01:00:00Z' },
    };
    expect(patrolNavigationTaskExecution(long, '2026-10-14T00:01:00Z').timing).toEqual({
      start: {
        mode: 'scheduled',
        scheduledAt: '2026-10-14T00:01:00.000Z',
        startToleranceMs: 30000,
      },
      maxElapsedMs: 3540000,
    });
    expect(patrolNavigationTaskExecution(long, '2026-10-14T00:59:59Z').timing).toMatchObject({
      start: { startToleranceMs: 999 },
      maxElapsedMs: 1000,
    });
    expect(() => patrolNavigationTaskExecution(long, long.timeWindow.deadline)).toThrow(
      'PATROL_DEADLINE_EXPIRED',
    );
    const future = {
      ...long,
      timeWindow: { ...long.timeWindow, earliestStart: '2026-10-14T00:10:00Z' },
    };
    expect(
      patrolNavigationTaskExecution(future, input.timeWindow.earliestStart).timing,
    ).toMatchObject({
      start: { scheduledAt: '2026-10-14T00:10:00.000Z' },
      maxElapsedMs: 3000000,
    });
  });
  it('rejects an outside or unsupported target before child admission', () => {
    expect(() =>
      parseAreaPatrolInput({ ...input, target: { x: 118, y: 39.5, frame: 'WGS84' } }),
    ).toThrow('PATROL_TARGET_OUTSIDE_AREA');
    expect(() =>
      parseAreaPatrolInput({ ...input, target: { ...input.target, frame: 'carla_world' } }),
    ).toThrow('PATROL_TARGET_OUTSIDE_AREA');
  });
  it('bounds the inline report while retaining source references and honest truncation', () => {
    const data = children();
    data[0] = {
      ...requiredChild(data, 0),
      trajectory: Array.from({ length: 4096 }, () => ({
        resourceId: input.resourceId,
        position: { x: 116.5, y: 39.5, frame: 'EPSG:4326' },
      })),
    };
    const result = aggregateAreaPatrol(input, data);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(220 * 1024);
    expect(result).toMatchObject({
      status: 'degraded',
      trajectorySourceRefs: ['task-business:move:digest'],
    });
    expect(result['missingEvidence']).toContain('PATROL_REPORT_INLINE_TRUNCATED');
  });
  it('requires real scoped trajectory and coverage for complete success', () => {
    expect(aggregateAreaPatrol(input, children())).toMatchObject({
      status: 'completed',
      coveredSubregions: ['subregion-1'],
      missingSubregions: [],
      missingEvidence: [],
    });
    const data = children();
    data[0] = { ...requiredChild(data, 0), trajectory: [], trajectorySourceRefs: [] };
    expect(aggregateAreaPatrol(input, data)).toMatchObject({
      status: 'degraded',
      coveredSubregions: [],
      missingSubregions: ['subregion-1'],
      trajectory: [],
      missingEvidence: ['subregion-1:patrol.trajectory'],
    });
  });
  it('preserves partial inspection findings and every missing source', () => {
    const data = children();
    data[1] = {
      ...requiredChild(data, 1),
      result: {
        ...report,
        status: 'degraded',
        anomalies: [{ targetId: 'target-1' }],
        inspectionReport: { ...report.inspectionReport, completion: 'partial' },
        missingEvidence: ['INSPECTION_TARGET_REPORT_MISSING'],
      },
    };
    expect(aggregateAreaPatrol(input, data)).toMatchObject({
      status: 'degraded',
      anomalies: [{ targetId: 'target-1' }],
      missingEvidence: [
        'subregion-1:INSPECTION_TARGET_REPORT_MISSING',
        'subregion-1:patrol.inspection',
      ],
    });
  });
  it('keeps failed and canceled child outcomes instead of claiming success', () => {
    const partial = children();
    partial[1] = {
      ...requiredChild(partial, 1),
      phase: 'failed',
      result: {
        ...report,
        status: 'failed',
        anomalies: [{ targetId: 'observed-before-failure' }],
        missingEvidence: ['INSPECTION_SCAN_NOT_COMPLETED'],
      },
    };
    expect(aggregateAreaPatrol(input, partial)).toMatchObject({
      status: 'failed',
      anomalies: [{ targetId: 'observed-before-failure' }],
      trajectorySourceRefs: ['task-business:move:digest'],
      missingEvidence: [
        'subregion-1:INSPECTION_SCAN_NOT_COMPLETED',
        'subregion-1:patrol.inspection',
      ],
    });
    expect(
      aggregateAreaPatrol(
        input,
        children().map((c) => ({ ...c, phase: 'failed' })),
      ),
    ).toMatchObject({ status: 'failed', missingSubregions: ['subregion-1'] });
    expect(
      aggregateAreaPatrol(
        input,
        children().map((c) => ({ ...c, phase: 'canceled' })),
      ),
    ).toMatchObject({ status: 'cancelled', missingSubregions: ['subregion-1'] });
    expect(aggregateAreaPatrol(input, [])).toMatchObject({
      status: 'degraded',
      missingEvidence: ['subregion-1:patrol.inspection', 'subregion-1:patrol.trajectory'],
    });
  });
  it('rejects duplicate children and ignores another resource as coverage', () => {
    const data = children();
    expect(() => aggregateAreaPatrol(input, [...data, requiredChild(data, 1)])).toThrow(
      'PATROL_CHILD_IDENTITY_CONFLICT',
    );
    data[1] = { ...requiredChild(data, 1), result: { ...report, resourceId: 'vehicle:other' } };
    expect(aggregateAreaPatrol(input, data)['status']).toBe('degraded');
  });
});

function requiredChild(data: readonly PatrolChildEvidence[], index: number): PatrolChildEvidence {
  const child = data[index];
  if (!child) throw Error('TEST_CHILD_REQUIRED');
  return child;
}
