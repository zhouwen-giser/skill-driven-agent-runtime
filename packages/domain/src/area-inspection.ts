import inspectionContract from './area-inspection-tool-contract.json' with { type: 'json' };
import { normalizeTaskTimestamp } from './mcp-task-availability.js';
import type { ResolvedMcpTaskExecution } from './mcp-task-availability.js';

export const AREA_INSPECTION_SKILL_ID = 'embodied.inspect_area';
export const AREA_INSPECTION_TOOL_NAME = 'vehicle_inspect_area';
export const AREA_INSPECTION_MAX_ELAPSED_MS = 300_000;

export interface AreaInspectionInput {
  readonly resourceId: string;
  readonly area: Readonly<Record<string, unknown>>;
  readonly timeWindow: Readonly<{ earliestStart: string; deadline: string }>;
}

export function parseAreaInspectionInput(value: unknown): AreaInspectionInput {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['resourceId', 'area', 'timeWindow'].includes(key))
  )
    invalid('INSPECTION_INPUT_INVALID');
  const resourceId = value['resourceId'],
    area = value['area'],
    window = value['timeWindow'];
  if (typeof resourceId !== 'string' || !resourceId.trim() || !record(area) || !record(window))
    invalid('INSPECTION_INPUT_INVALID');
  if (Object.keys(area).some((key) => !['boundary', 'frame', 'excludedZones'].includes(key)))
    invalid('INSPECTION_AREA_INVALID');
  if (area['frame'] !== undefined && area['frame'] !== 'WGS84' && area['frame'] !== 'EPSG:4326')
    invalid('INSPECTION_CRS_UNSUPPORTED');
  if (
    area['excludedZones'] !== undefined &&
    (!Array.isArray(area['excludedZones']) || area['excludedZones'].length !== 0)
  )
    invalid('INSPECTION_EXCLUSIONS_UNRESOLVED');
  const boundary = area['boundary'];
  if (!Array.isArray(boundary) || boundary.length < 3 || boundary.length > 257)
    invalid('INSPECTION_AREA_INVALID');
  const points = boundary.map((point) => {
    if (
      !record(point) ||
      Object.keys(point).some((key) => !['x', 'y'].includes(key)) ||
      typeof point['x'] !== 'number' ||
      !Number.isFinite(point['x']) ||
      Math.abs(point['x']) > 180 ||
      typeof point['y'] !== 'number' ||
      !Number.isFinite(point['y']) ||
      Math.abs(point['y']) > 90
    )
      invalid('INSPECTION_AREA_INVALID');
    return { x: point['x'], y: point['y'] };
  });
  const pointAt = (index: number) => {
    const point = points[index];
    if (!point) invalid('INSPECTION_AREA_INVALID');
    return point;
  };
  if (points.length > 3 && same(pointAt(0), pointAt(points.length - 1))) points.pop();
  if (
    points.length < 3 ||
    points.length > 256 ||
    new Set(points.map((p) => `${String(p.x)},${String(p.y)}`)).size !== points.length
  )
    invalid('INSPECTION_AREA_INVALID');
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = pointAt(i),
      b = pointAt((i + 1) % points.length);
    if (Math.abs(a.x - b.x) > 180) invalid('INSPECTION_AREA_INVALID');
    twiceArea += cross(pointAt(0), a, b);
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, pointAt(j), pointAt((j + 1) % points.length)))
        invalid('INSPECTION_AREA_INVALID');
    }
  }
  if (twiceArea === 0) invalid('INSPECTION_AREA_INVALID');
  if (
    Object.keys(window).some((key) => !['earliestStart', 'deadline'].includes(key)) ||
    typeof window['earliestStart'] !== 'string' ||
    typeof window['deadline'] !== 'string'
  )
    invalid('INSPECTION_TIME_WINDOW_INVALID');
  let earliestStart: string, deadline: string;
  try {
    earliestStart = normalizeTaskTimestamp(window['earliestStart']);
    deadline = normalizeTaskTimestamp(window['deadline']);
  } catch {
    invalid('INSPECTION_TIME_WINDOW_INVALID');
  }
  if (Date.parse(deadline) <= Date.parse(earliestStart)) invalid('INSPECTION_TIME_WINDOW_INVALID');
  // Preserve the exact admitted area bytes in the dispatch hash; SMPP performs canonical geometry conversion.
  return { resourceId, area: structuredClone(area), timeWindow: { earliestStart, deadline } };
}

/** Only these two fields enter the strict Provider input contract. */
export function inspectionToolArguments(value: unknown): Readonly<Record<string, unknown>> {
  const input = parseAreaInspectionInput(value);
  return { resourceId: input.resourceId, area: input.area };
}

/** Recomputed immediately before readiness/dispatch, including time spent awaiting confirmation. */
export function inspectionTaskExecution(value: unknown, now: string): ResolvedMcpTaskExecution {
  const input = parseAreaInspectionInput(value);
  const current = Date.parse(normalizeTaskTimestamp(now));
  const start = Math.max(current, Date.parse(input.timeWindow.earliestStart));
  const remaining = Date.parse(input.timeWindow.deadline) - start;
  if (!Number.isSafeInteger(remaining) || remaining <= 0) invalid('INSPECTION_DEADLINE_EXPIRED');
  return {
    protocolMode: 'frozen_v1',
    availabilityCheck: 'required',
    timing: {
      // The Provider anchors maxElapsed to scheduledAt, so transport/ACK delay
      // cannot move the parent deadline. Leave the normal 30s admission window.
      start: {
        mode: 'scheduled',
        scheduledAt: new Date(start).toISOString(),
        startToleranceMs: Math.min(30_000, remaining - 1),
      },
      maxElapsedMs: Math.min(remaining, AREA_INSPECTION_MAX_ELAPSED_MS),
    },
  };
}

export function capabilityDispatchInput(
  binding: Readonly<{
    requestedCapabilityId?: string;
    capabilityId?: string;
    inputSnapshot: unknown;
    constraintSnapshot: readonly Readonly<Record<string, unknown>>[];
  }>,
): unknown {
  const adapters = binding.constraintSnapshot.filter(
    (item) => item['type'] === 'inspection_input_adapter',
  );
  if ((binding.requestedCapabilityId ?? binding.capabilityId) !== AREA_INSPECTION_SKILL_ID)
    return binding.inputSnapshot;
  if (
    adapters.length !== 1 ||
    adapters[0]?.['version'] !== 1 ||
    adapters[0]['toolName'] !== AREA_INSPECTION_TOOL_NAME ||
    adapters[0]['maxElapsedMs'] !== AREA_INSPECTION_MAX_ELAPSED_MS
  )
    invalid('INSPECTION_ADAPTER_AUTHORITY_INVALID');
  return inspectionToolArguments(binding.inputSnapshot);
}

export function inspectionReportComplete(value: unknown): boolean {
  if (!record(value) || !record(value['inspectionReport'])) return false;
  const report = value['inspectionReport'];
  const coverage = value['coverage'];
  return (
    value['status'] === 'completed' &&
    report['version'] === '1.0' &&
    report['completion'] === 'complete' &&
    report['targetReportComplete'] === true &&
    typeof report['targetReportObservedAt'] === 'string' &&
    Number.isFinite(Date.parse(report['targetReportObservedAt'])) &&
    report['coverageState'] === 'full' &&
    report['truncated'] === false &&
    Array.isArray(value['anomalies']) &&
    value['anomalies'].length <= 256 &&
    report['findingCount'] === value['anomalies'].length &&
    Array.isArray(value['missingEvidence']) &&
    value['missingEvidence'].length === 0 &&
    ['STRICT_CORRELATED', 'INFERRED_CURRENT_EXECUTION'].includes(
      String(value['correlationStrength']),
    ) &&
    record(coverage) &&
    coverage['incomplete'] !== true &&
    (coverage['coveragePercent'] === 100 ||
      (typeof coverage['totalCount'] === 'number' &&
        coverage['totalCount'] > 0 &&
        coverage['coveredCount'] === coverage['totalCount']))
  );
}

/** Keeps the full Provider report and makes the native Skill outcome explicit. */
export function projectInspectionResult(value: unknown): Readonly<Record<string, unknown>> {
  if (
    !record(value) ||
    !record(value['inspectionReport']) ||
    value['inspectionReport']['version'] !== '1.0' ||
    !Array.isArray(value['anomalies']) ||
    !Array.isArray(value['missingEvidence'])
  )
    invalid('INSPECTION_REPORT_INVALID');
  const complete = inspectionReportComplete(value);
  if (value['status'] === 'completed' && !complete && value['missingEvidence'].length === 0)
    invalid('INSPECTION_REPORT_INCONSISTENT');
  return {
    ...structuredClone(value),
    providerStatus: value['status'],
    status: value['status'] === 'completed' && !complete ? 'degraded' : value['status'],
  };
}

export function inspectionSkillInputSchema(
  toolInput: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const properties = toolInput['properties'];
  if (!record(properties) || !record(properties['resourceId']) || !record(properties['area']))
    invalid('INSPECTION_TOOL_CONTRACT_INVALID');
  return {
    ...toolInput,
    required: ['resourceId', 'area', 'timeWindow'],
    properties: {
      ...properties,
      timeWindow: {
        type: 'object',
        additionalProperties: false,
        required: ['earliestStart', 'deadline'],
        properties: {
          earliestStart: { type: 'string', format: 'date-time' },
          deadline: { type: 'string', format: 'date-time' },
        },
      },
    },
  };
}

export function inspectionSkillOutputSchema(
  wireOutput: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const toolOutput = unwrapInspectionResultSchema(wireOutput);
  const properties = toolOutput['properties'];
  if (!record(properties) || !Array.isArray(toolOutput['required']))
    invalid('INSPECTION_TOOL_CONTRACT_INVALID');
  return {
    ...toolOutput,
    required: [
      ...toolOutput['required'].map((key: unknown) => {
        if (typeof key !== 'string') invalid('INSPECTION_TOOL_CONTRACT_INVALID');
        return key;
      }),
      'providerStatus',
    ],
    properties: {
      ...properties,
      providerStatus: properties['status'],
      status: { type: 'string', enum: ['completed', 'degraded', 'failed', 'cancelled', 'timeout'] },
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export class AreaInspectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AreaInspectionError';
  }
}
function invalid(code: string): never {
  throw new AreaInspectionError(code);
}
type Point = Readonly<{ x: number; y: number }>;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const on = (a: Point, b: Point, p: Point) =>
  cross(a, b, p) === 0 &&
  p.x >= Math.min(a.x, b.x) &&
  p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) &&
  p.y <= Math.max(a.y, b.y);
function intersects(a: Point, b: Point, c: Point, d: Point) {
  return (
    (Math.sign(cross(a, b, c)) !== Math.sign(cross(a, b, d)) &&
      Math.sign(cross(c, d, a)) !== Math.sign(cross(c, d, b))) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}

/** Compare the complete reviewed wire schemas; only the exact public resource constant varies. */
export function assertInspectionToolContract(
  tool: Readonly<{
    inputSchema: unknown;
    outputSchema?: unknown;
    taskExecutionProfile: Readonly<Record<string, unknown>>;
    executionSemantics?: Readonly<Record<string, unknown>>;
  }>,
): void {
  const input = normalizeResource(tool.inputSchema),
    output = normalizeResource(tool.outputSchema);
  if (
    input.resource !== output.resource ||
    canonical(input.schema) !== canonical(inspectionContract.input) ||
    canonical(output.schema) !== canonical(inspectionContract.result)
  )
    invalid('INSPECTION_TOOL_CONTRACT_INVALID');
  const profile = tool.taskExecutionProfile;
  if (
    profile['profileVersion'] !== '1.0' ||
    profile['taskBehavior'] !== 'task_required' ||
    profile['supportsScheduling'] !== true ||
    profile['supportsMaxElapsed'] !== true ||
    profile['supportsCancellation'] !== true ||
    profile['supportsPauseResume'] !== true ||
    profile['supportsObservations'] !== true ||
    profile['idempotency'] !== 'server_managed'
  )
    invalid('INSPECTION_TASK_PROFILE_INVALID');
}
function normalizeResource(value: unknown): { resource: string; schema: Record<string, unknown> } {
  if (!record(value)) invalid('INSPECTION_TOOL_CONTRACT_INVALID');
  const schema = structuredClone(unwrapInspectionResultSchema(value)),
    properties = schema['properties'];
  if (
    !record(properties) ||
    !record(properties['resourceId']) ||
    typeof properties['resourceId']['const'] !== 'string'
  )
    invalid('INSPECTION_TOOL_CONTRACT_INVALID');
  const resource = properties['resourceId']['const'];
  properties['resourceId']['const'] = '__RESOURCE_ID__';
  return { resource, schema };
}

/** SMPP adds this exact frozen Task error alternative to every Task-required success schema. */
export function unwrapInspectionResultSchema(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (value['anyOf'] === undefined) return value;
  const choices = value['anyOf'];
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
  if (
    value['type'] !== 'object' ||
    Object.keys(value).some((k) => !['type', 'anyOf'].includes(k)) ||
    !Array.isArray(choices) ||
    choices.length !== 2 ||
    !record(choices[0]) ||
    canonical(choices[1]) !== canonical(error)
  )
    invalid('INSPECTION_TOOL_CONTRACT_INVALID');
  return choices[0];
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
