import { z } from 'zod';
import { nativeZmqTaskExecution } from './zmq-capability.js';
import { patrolPointInArea, type PatrolChildEvidence } from './area-patrol.js';

export const ZMQ_PATROL_SKILL = 'ugv.zmq.area_patrol';
export const ZMQ_PATROL_CAPABILITY = 'vehicle.ugv.zmq.area_patrol';
export const ZMQ_PATROL_CHILDREN = [
  'ugv.zmq.vehicle_zmq_navigate',
  'ugv.zmq.vehicle_zmq_inspect_area',
] as const;
export function isGovernedPatrol(skillId: string | undefined, version: number | undefined) {
  return (
    (skillId === ZMQ_PATROL_SKILL && Number.isSafeInteger(version) && (version ?? 0) >= 1) ||
    (skillId === 'embodied.area_patrol' && (version ?? 0) >= 2)
  );
}
export function isPatrolCapability(capabilityId: string | undefined) {
  return capabilityId === 'embodied.area_patrol' || capabilityId === ZMQ_PATROL_CAPABILITY;
}
const position = z
  .object({
    longitude: z.number().min(-180).lt(180),
    latitude: z.number().min(-90).max(90),
  })
  .strict();
const inputSchema = z
  .object({
    resourceId: z.string().trim().min(1).max(256),
    area: z
      .object({
        crs: z.literal('OGC:CRS84'),
        vertices: z.array(position.extend({ ellipsoidHeightM: z.number() })).length(4),
        searchStrategy: z.enum(['recognize', 'track']),
      })
      .strict(),
    entryPoint: position,
    speedLimitMps: z.number().positive().max(30),
    obstacleAvoidance: z.boolean(),
    timeWindow: z
      .object({
        earliestStart: z.iso.datetime({ offset: true }),
        deadline: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();
export function zmqPatrolInputSchema(resourceId: string) {
  return z.toJSONSchema(inputSchema.extend({ resourceId: z.literal(resourceId) }));
}
export function parseZmqPatrolInput(value: unknown) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw Error('ZMQ_PATROL_INPUT_INVALID');
  const input = parsed.data;
  const points = input.area.vertices.map((p) => ({ x: p.longitude, y: p.latitude }));
  const at = (i: number) => points[i % 4] as { x: number; y: number };
  const signs = points.map((a, i) => {
    const b = at(i + 1),
      c = at(i + 2);
    if (Math.abs(b.x - a.x) > 180) throw Error('ZMQ_PATROL_AREA_INVALID');
    return Math.sign((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  });
  if (!signs.every((s) => s === 1) && !signs.every((s) => s === -1))
    throw Error('ZMQ_PATROL_AREA_INVALID');
  if (
    !patrolPointInArea(
      { boundary: points },
      { x: input.entryPoint.longitude, y: input.entryPoint.latitude },
    )
  )
    throw Error('ZMQ_PATROL_ENTRY_OUTSIDE_AREA');
  if (Date.parse(input.timeWindow.deadline) <= Date.parse(input.timeWindow.earliestStart))
    throw Error('ZMQ_PATROL_TIME_WINDOW_INVALID');
  return input;
}

/** A pure mapping used by compilation, child admission and report verification. */
export function zmqPatrolChildInput(value: unknown, childSkillId: string) {
  const input = parseZmqPatrolInput(value);
  const common = { resourceId: input.resourceId, timeWindow: input.timeWindow };
  if (childSkillId === ZMQ_PATROL_CHILDREN[0])
    return {
      ...common,
      operation: {
        name: 'navigation.point',
        params: {
          destination: input.entryPoint,
          speedLimitMps: input.speedLimitMps,
          obstacleAvoidance: input.obstacleAvoidance,
        },
      },
    };
  if (childSkillId === ZMQ_PATROL_CHILDREN[1]) return { ...common, area: input.area };
  throw Error('ZMQ_PATROL_CHILD_NOT_ADMITTED');
}
export function assertZmqPatrolDeadline(value: unknown, now: string) {
  return nativeZmqTaskExecution(parseZmqPatrolInput(value).timeWindow, now, 60000);
}
const record = (v: unknown): v is Readonly<Record<string, unknown>> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** MCP completion alone cannot unlock inspection. This reads the retained native outcome. */
export function zmqPatrolNavigationSucceeded(value: unknown, resourceId: string): boolean {
  if (
    !record(value) ||
    value['schemaVersion'] !== 'sdar.zmq-skill-report/2' ||
    value['catalogProfile'] !== 'zmq_v1_2_0_site_control_13' ||
    value['resourceId'] !== resourceId ||
    value['toolName'] !== 'vehicle_zmq_navigate' ||
    !['completed', 'degraded'].includes(String(value['status']))
  )
    return false;
  const native = value['providerResult'];
  return (
    record(native) &&
    native['schemaVersion'] === 'ugv.zmq-control-result/2' &&
    (native['resourceId'] === undefined || native['resourceId'] === resourceId) &&
    native['nativeOutcome'] === 'completed' &&
    native['stopConfirmed'] === true
  );
}

/** Only persisted, scoped child evidence may enter this aggregator. Requested routes are never evidence. */
export function aggregateZmqPatrol(value: unknown, children: readonly PatrolChildEvidence[]) {
  const input = parseZmqPatrolInput(value);
  if (
    children.length > 2 ||
    new Set(children.map((c) => c.skillId)).size !== children.length ||
    children.some((c) => !ZMQ_PATROL_CHILDREN.some((id) => id === c.skillId))
  )
    throw Error('ZMQ_PATROL_CHILD_IDENTITY_CONFLICT');
  const navigation = children.find((c) => c.skillId === ZMQ_PATROL_CHILDREN[0]);
  const inspection = children.find((c) => c.skillId === ZMQ_PATROL_CHILDREN[1]);
  const missing = new Set(children.flatMap((c) => c.missingEvidence));
  for (const child of children) {
    if (!child.remoteTasks?.length) missing.add('NATIVE_CHILD_MCP_TASK_REFERENCE_UNAVAILABLE');
    if (Array.isArray(child.result?.['missingEvidence']))
      for (const reason of child.result['missingEvidence'])
        if (typeof reason === 'string') missing.add(reason);
  }
  const navigationSucceeded =
    navigation?.phase === 'completed' &&
    zmqPatrolNavigationSucceeded(navigation.result, input.resourceId);
  if (!navigationSucceeded) missing.add('NAVIGATION_SUCCESS_AND_STOP_UNCONFIRMED');
  let native: Readonly<Record<string, unknown>> | undefined;
  if (inspection?.result) {
    const report = inspection.result;
    if (
      report['schemaVersion'] !== 'sdar.zmq-skill-report/2' ||
      report['catalogProfile'] !== 'zmq_v1_2_0_site_control_13' ||
      report['toolName'] !== 'vehicle_zmq_inspect_area' ||
      report['resourceId'] !== input.resourceId ||
      !record(report['providerResult'])
    )
      throw Error('ZMQ_PATROL_INSPECTION_IDENTITY_CONFLICT');
    native = report['providerResult'];
    if (native['resourceId'] !== undefined && native['resourceId'] !== input.resourceId)
      throw Error('ZMQ_PATROL_INSPECTION_IDENTITY_CONFLICT');
    for (const source of [report, native])
      if (Array.isArray(source['missingEvidence']))
        for (const item of source['missingEvidence'])
          if (typeof item === 'string') missing.add(item);
  }
  const inspectionExecuted =
    inspection?.phase === 'completed' &&
    ['completed', 'succeeded'].includes(String(native?.['nativeOutcome'])) &&
    native?.['stopConfirmed'] === true;
  if (!inspectionExecuted) missing.add('INSPECTION_EXECUTION_UNCONFIRMED');
  // Contract 1.2.0 has no attested producer epoch, coverage footprints or complete target stream.
  for (const reason of ['COVERAGE_FOOTPRINTS_UNAVAILABLE', 'SOURCE_STREAM_COMPLETENESS_UNVERIFIED'])
    missing.add(reason);
  const trajectory = [...(navigation?.trajectory ?? [])];
  if (
    trajectory.some(
      (p) =>
        p.resourceId !== input.resourceId ||
        !['WGS84', 'EPSG:4326'].includes(p.position.frame) ||
        !Number.isFinite(p.position.x) ||
        !Number.isFinite(p.position.y) ||
        Math.abs(p.position.x) > 180 ||
        Math.abs(p.position.y) > 90,
    )
  )
    throw Error('ZMQ_PATROL_TRAJECTORY_IDENTITY_CONFLICT');
  if (trajectory.length < 2 || !navigation?.trajectorySourceRefs?.length)
    missing.add('TASK_TRAJECTORY_EVIDENCE_UNAVAILABLE');
  const anomalies = Array.isArray(native?.['anomalies']) ? native['anomalies'].slice(0, 256) : [];
  if (Array.isArray(native?.['anomalies']) && native['anomalies'].length > anomalies.length)
    missing.add('PATROL_REPORT_INLINE_TRUNCATED');
  if (trajectory.length > 4096) {
    trajectory.length = 4096;
    missing.add('PATROL_REPORT_INLINE_TRUNCATED');
  }
  while (Buffer.byteLength(JSON.stringify({ trajectory, anomalies }), 'utf8') > 192 * 1024) {
    if (trajectory.length > 2) trajectory.splice(trajectory.length - 2, 1);
    else if (anomalies.length) anomalies.pop();
    else break;
    missing.add('PATROL_REPORT_INLINE_TRUNCATED');
  }
  const canceled = children.some(
    (c) => c.phase === 'canceled' || (c.phase !== 'failed' && c.result?.['status'] === 'cancelled'),
  );
  const failed = children.some((c) => c.phase === 'failed' || c.result?.['status'] === 'failed');
  return {
    schemaVersion: 'sdar.zmq-patrol-report/1',
    resourceId: input.resourceId,
    status: canceled ? 'cancelled' : failed ? 'failed' : 'degraded',
    navigationSucceeded,
    inspectionExecuted,
    coveredSubregions: [],
    missingSubregions: ['subregion-1'],
    missingEffects: ['effect.area_patrolled'],
    missingEvidence: [...missing].sort(),
    trajectory,
    trajectorySourceRefs: navigation?.trajectorySourceRefs ?? [],
    anomalies,
    childTasks: children.map((c) => ({
      taskId: c.taskId,
      skillId: c.skillId,
      skillVersion: c.skillVersion,
      status: c.phase,
      missingEvidence: c.missingEvidence,
      mcpTasks: c.remoteTasks ?? [],
      reportRef: `sdar-task:${c.taskId}:retained-report`,
    })),
    inspectionReports: native
      ? [
          {
            subregionId: 'subregion-1',
            taskId: inspection?.taskId,
            report: native['inspectionReport'] ?? null,
            coverageEvidence: native['coverageEvidence'] ?? null,
            fullReceivedReport: native['fullReceivedReport'] ?? null,
          },
        ]
      : [],
  } as const;
}
