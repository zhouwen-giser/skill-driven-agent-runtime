import { inspectionReportComplete, parseAreaInspectionInput } from './area-inspection.js';
import { normalizeTaskTimestamp, type ResolvedMcpTaskExecution } from './mcp-task-availability.js';

export interface PatrolChildEvidence {
  readonly taskId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly phase: 'completed' | 'failed' | 'canceled' | 'unavailable';
  readonly result?: Readonly<Record<string, unknown>>;
  readonly trajectory?: readonly Readonly<{
    resourceId: string;
    position: Readonly<{ x: number; y: number; frame: string }>;
  }>[];
  readonly trajectorySourceRefs?: readonly string[];
  readonly missingEvidence: readonly string[];
}

export function parseAreaPatrolInput(value: unknown) {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['resourceId', 'area', 'timeWindow', 'target'].includes(key))
  )
    throw Error('PATROL_INPUT_INVALID');
  const input = parseAreaInspectionInput({
    resourceId: value['resourceId'],
    area: value['area'],
    timeWindow: value['timeWindow'],
  });
  const target = value['target'];
  if (
    !record(target) ||
    Object.keys(target).length !== 3 ||
    target['frame'] !== 'WGS84' ||
    typeof target['x'] !== 'number' ||
    !Number.isFinite(target['x']) ||
    typeof target['y'] !== 'number' ||
    !Number.isFinite(target['y']) ||
    !patrolPointInArea(input.area, { x: target['x'], y: target['y'] })
  )
    throw Error('PATROL_TARGET_OUTSIDE_AREA');
  return { ...input, target: { x: target['x'], y: target['y'], frame: 'WGS84' as const } };
}

/** Navigation inherits the parent window; the 300-second scan limit belongs to inspection. */
export function patrolNavigationTaskExecution(
  value: unknown,
  now: string,
): ResolvedMcpTaskExecution {
  const input = parseAreaPatrolInput(value);
  const start = Math.max(
    Date.parse(normalizeTaskTimestamp(now)),
    Date.parse(input.timeWindow.earliestStart),
  );
  const remaining = Date.parse(input.timeWindow.deadline) - start;
  if (!Number.isSafeInteger(remaining) || remaining <= 0) throw Error('PATROL_DEADLINE_EXPIRED');
  return {
    protocolMode: 'frozen_v1',
    availabilityCheck: 'required',
    timing: {
      start: {
        mode: 'scheduled',
        scheduledAt: new Date(start).toISOString(),
        startToleranceMs: Math.min(30000, remaining - 1),
      },
      maxElapsedMs: remaining,
    },
  };
}

export function patrolPointInArea(
  area: Readonly<Record<string, unknown>>,
  point: Readonly<{ x: number; y: number }>,
): boolean {
  const ring = area['boundary'];
  if (!Array.isArray(ring) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as { x: number; y: number },
      b = ring[j] as { x: number; y: number };
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (
      cross === 0 &&
      point.x >= Math.min(a.x, b.x) &&
      point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) &&
      point.y <= Math.max(a.y, b.y)
    )
      return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** Input is supplied by the native Task evidence reader, never the caller's proposed report. */
export function aggregateAreaPatrol(
  inputValue: unknown,
  children: readonly PatrolChildEvidence[],
): Readonly<Record<string, unknown>> {
  if (!record(inputValue)) throw Error('PATROL_INPUT_INVALID');
  const input = parseAreaPatrolInput(inputValue);
  const inspections = children.filter((child) => child.skillId === 'embodied.inspect_area');
  const movements = children.filter((child) => child.skillId === 'embodied.move_to');
  if (inspections.length > 1 || movements.length > 1) throw Error('PATROL_CHILD_IDENTITY_CONFLICT');
  const inspection = inspections[0],
    movement = movements[0];
  const missing = new Set<string>(children.flatMap((child) => child.missingEvidence));
  const inspectionComplete =
    inspection?.phase === 'completed' &&
    inspection.result?.['resourceId'] === input.resourceId &&
    inspectionReportComplete(inspection.result);
  const trajectory =
    movement?.trajectory?.filter((point) => point.resourceId === input.resourceId) ?? [];
  const trajectoryComplete =
    movement?.phase === 'completed' &&
    movement.result?.['resourceId'] === input.resourceId &&
    movement.result['status'] === 'completed' &&
    trajectory.length >= 2 &&
    trajectory.every(
      (point) =>
        ['WGS84', 'EPSG:4326'].includes(point.position.frame) &&
        patrolPointInArea(input.area, point.position),
    ) &&
    (movement.trajectorySourceRefs?.length ?? 0) > 0;
  if (!inspectionComplete) missing.add('subregion-1:patrol.inspection');
  if (!trajectoryComplete) missing.add('subregion-1:patrol.trajectory');
  if (inspection && Array.isArray(inspection.result?.['missingEvidence']))
    for (const reason of inspection.result['missingEvidence'])
      if (typeof reason === 'string') missing.add('subregion-1:' + reason);
  const inlineAnomalies = Array.isArray(inspection?.result?.['anomalies'])
    ? [...(inspection.result['anomalies'] as unknown[])].slice(0, 256)
    : [];
  let inlineBytes = Buffer.byteLength(
    JSON.stringify({ trajectory, anomalies: inlineAnomalies }),
    'utf8',
  );
  while (inlineBytes > 192 * 1024) {
    if (trajectory.length > 2) {
      const removed = trajectory.splice(trajectory.length - 2, 1)[0];
      inlineBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8') + 1;
    } else if (inlineAnomalies.length) {
      const comma = inlineAnomalies.length > 1 ? 1 : 0;
      const removed: unknown = inlineAnomalies.pop();
      inlineBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8') + comma;
    } else break;
    missing.add('PATROL_REPORT_INLINE_TRUNCATED');
  }
  const complete = inspectionComplete && trajectoryComplete && missing.size === 0;
  const canceled = children.some((child) => child.phase === 'canceled');
  const failed = !canceled && children.some((child) => child.phase === 'failed');
  return {
    resourceId: input.resourceId,
    status: canceled ? 'cancelled' : failed ? 'failed' : complete ? 'completed' : 'degraded',
    coveredSubregions: complete ? ['subregion-1'] : [],
    missingSubregions: complete ? [] : ['subregion-1'],
    trajectory,
    anomalies: inlineAnomalies,
    missingEffects: complete ? [] : ['effect.area_patrolled'],
    missingEvidence: [...missing].sort(),
    childTasks: children.map((child) => ({
      taskId: child.taskId,
      skillId: child.skillId,
      skillVersion: child.skillVersion,
      status: child.phase,
      missingEvidence: child.missingEvidence,
    })),
    inspectionReports: inspection?.result
      ? [
          {
            subregionId: 'subregion-1',
            taskId: inspection.taskId,
            report: inspection.result['inspectionReport'] ?? null,
            missingEvidence: inspection.result['missingEvidence'] ?? [],
          },
        ]
      : [],
    trajectorySourceRefs: movement?.trajectorySourceRefs ?? [],
  };
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
