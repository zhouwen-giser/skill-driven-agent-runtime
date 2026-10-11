import { z } from 'zod';
import type { ArtifactRef, EvidenceJsonValue } from './evidence/canonical-evidence.js';
import { buildRuntimeSourceArtifact } from './evidence/source-artifact-ref.js';
import { classifyProviderBusinessOutcome } from './provider-business-outcome.js';
import type { RemoteTaskBinding } from './remote-task.js';
import {
  TaskBusinessError,
  taskBusinessContentDigest,
  taskBusinessRefKey,
  TASK_BUSINESS_LIMITS,
  taskBusinessIdentitySchema,
  type TaskBusinessContent,
  type TaskBusinessRef,
  type TaskBusinessQuality,
  type TaskBusinessView,
} from './task-business.js';

export const TASK_BUSINESS_GEOMETRY_ROLES = [
  'requested_target',
  'planned_route',
  'adopted_route',
  'actual_trajectory',
  'observation_area',
  'measured_coverage',
  'estimated_fov',
  'other',
] as const;
export type TaskBusinessGeometryRole = (typeof TASK_BUSINESS_GEOMETRY_ROLES)[number];
const predicate = z
  .object({
    jsonPointer: z
      .string()
      .regex(/^(?:\/(?:[^~]|~[01])*)*$/u)
      .max(512),
    equals: z.union([z.string().max(512), z.boolean(), z.number(), z.null()]),
  })
  .strict();
export const taskBusinessEvidencePolicySchema = z
  .object({
    schemaVersion: z.literal('sdar.task-business-evidence-policy/v1'),
    operationName: z.enum(['vehicle_navigate', 'vehicle_area_recon']),
    providerSuccess: predicate,
    skillSuccess: predicate,
    requiredGeometryRoles: z.array(z.enum(TASK_BUSINESS_GEOMETRY_ROLES)).max(8),
    requireHistoryContinuity: z.boolean(),
    requireTrajectoryTime: z.boolean(),
  })
  .strict();
export type TaskBusinessEvidencePolicy = z.infer<typeof taskBusinessEvidencePolicySchema>;
export interface TaskBusinessGeometrySummary {
  readonly ref: TaskBusinessRef;
  readonly artifactType: string;
  readonly role: TaskBusinessGeometryRole;
  readonly semantics: string;
  readonly crs?: string;
  readonly geometryType?: string;
  readonly retainedCoordinateCount?: number;
  readonly providerSampleCount?: number;
  readonly coordinateOrder: 'longitude_latitude' | 'unspecified';
  readonly sampleOrder?: 'provider_retained_order';
  readonly rawContentComplete: boolean;
  readonly current: boolean;
  readonly validUntil?: string;
  readonly perSampleSourceTimeComplete: false;
  readonly displayDerived: true;
  readonly gaps: readonly string[];
}
export interface TaskBusinessOutcome {
  readonly protocolStatus: RemoteTaskBinding['protocolStatus'];
  readonly businessStatus: 'in_progress' | 'success' | 'failure' | 'partial' | 'unknown';
  readonly reasonCode?: string;
  readonly policySatisfied: boolean;
  readonly missingRequiredRoles: readonly TaskBusinessGeometryRole[];
  readonly gaps: readonly string[];
}

export function summarizeTaskBusinessGeometry(
  content: TaskBusinessContent,
  view: TaskBusinessView,
  projectedAt = view.context.updatedAt,
): TaskBusinessGeometrySummary {
  const metadata = content.metadata;
  const type = typeof metadata['artifactType'] === 'string' ? metadata['artifactType'] : 'unknown';
  const semantics = typeof metadata['semantics'] === 'string' ? metadata['semantics'] : 'unknown';
  const effective = z
    .object({
      routeRef: z.object({
        kind: z.literal('artifact'),
        id: z.string(),
        revision: z.number().int(),
      }),
    })
    .loose()
    .safeParse(view.context.summary.properties?.['effectiveNavigation']);
  const adopted =
    effective.success &&
    taskBusinessRefKey(effective.data.routeRef) === taskBusinessRefKey(content.ref);
  const role: TaskBusinessGeometryRole =
    type === 'navigation.route'
      ? adopted
        ? 'adopted_route'
        : 'planned_route'
      : type === 'navigation.trajectory'
        ? 'actual_trajectory'
        : type === 'navigation.destination' &&
            record(metadata['properties'])?.['intent'] === 'requested'
          ? 'requested_target'
          : type === 'navigation.waypoints'
            ? 'planned_route'
            : type === 'recon.area'
              ? 'observation_area'
              : type === 'recon.covered_area' && semantics === 'observed'
                ? 'measured_coverage'
                : type === 'recon.current_footprint' &&
                    record(metadata['properties'])?.['quality'] !== 'observed'
                  ? 'estimated_fov'
                  : 'other';
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(content.bytes).toString('utf8'));
  } catch {
    throw new TaskBusinessError('TASK_BUSINESS_ARTIFACT_JSON_INVALID');
  }
  const root = record(raw);
  const geometry = record(root?.['geometry']) ?? root;
  const kind = geometry?.['type'];
  const declaredCrs = record(metadata['content'])?.['crs'];
  const contentCrs = root?.['crs'];
  const crs = contentCrs ?? declaredCrs;
  const crsConflict =
    typeof declaredCrs === 'string' && typeof contentCrs === 'string' && declaredCrs !== contentCrs;
  const validUntil =
    typeof metadata['validUntil'] === 'string' ? metadata['validUntil'] : undefined;
  const expired = validUntil !== undefined && Date.parse(validUntil) <= Date.parse(projectedAt);
  const coordinateCount = countCoordinates(geometry?.['coordinates']);
  const samples = record(metadata['properties'])?.['sampleCount'];
  const gaps =
    role === 'actual_trajectory'
      ? [
          'provider_trajectory_has_no_per_sample_receive_time',
          'provider_retained_samples_may_be_sampled',
        ]
      : [];
  if (semantics === 'estimated') gaps.push('estimated_geometry_is_not_measured_coverage');
  if (role === 'estimated_fov') gaps.push('estimated_geometry_is_not_measured_coverage');
  if (type === 'recon.covered_area' && semantics === 'derived')
    gaps.push('derived_coverage_has_no_measured_quality');
  if (coordinateCount === undefined) gaps.push('geometry_coordinates_unavailable');
  if (crsConflict) gaps.push('geometry_crs_conflict_no_conversion_performed');
  if (expired) gaps.push('geometry_validity_expired');
  return {
    ref: content.ref,
    artifactType: type,
    role,
    semantics,
    ...(typeof crs === 'string' ? { crs } : {}),
    ...(typeof kind === 'string' ? { geometryType: kind } : {}),
    ...(coordinateCount === undefined ? {} : { retainedCoordinateCount: coordinateCount }),
    ...(typeof samples === 'number' && Number.isInteger(samples) && samples >= 0
      ? { providerSampleCount: samples }
      : {}),
    coordinateOrder:
      crs === 'OGC:CRS84' || crs === 'EPSG:4326' ? 'longitude_latitude' : 'unspecified',
    sampleOrder: 'provider_retained_order',
    rawContentComplete: true,
    current: !expired && metadata['lifecycle'] === 'active',
    ...(validUntil === undefined ? {} : { validUntil }),
    perSampleSourceTimeComplete: false,
    displayDerived: true,
    gaps,
  };
}
export function assessTaskBusinessOutcome(
  input: Readonly<{
    binding: Pick<RemoteTaskBinding, 'protocolStatus' | 'resultSnapshot' | 'errorSnapshot'>;
    policy?: TaskBusinessEvidencePolicy;
    operationName: string;
    geometry: readonly TaskBusinessGeometrySummary[];
    quality: TaskBusinessQuality;
  }>,
): TaskBusinessOutcome {
  const protocolStatus = input.binding.protocolStatus;
  const required = input.policy?.requiredGeometryRoles ?? [];
  const missingRequiredRoles = required.filter(
    (role) =>
      !input.geometry.some(
        (item) =>
          item.role === role &&
          item.rawContentComplete &&
          item.current &&
          !item.gaps.includes('geometry_coordinates_unavailable') &&
          !item.gaps.includes('geometry_crs_conflict_no_conversion_performed'),
      ),
  );
  const base = { protocolStatus, missingRequiredRoles, policySatisfied: false };
  if (protocolStatus === 'failed' || protocolStatus === 'cancelled')
    return {
      ...base,
      businessStatus: 'failure',
      reasonCode:
        input.binding.errorSnapshot === undefined
          ? `PROTOCOL_${protocolStatus.toUpperCase()}`
          : String(input.binding.errorSnapshot.code),
      gaps: [],
    };
  if (protocolStatus !== 'completed') return { ...base, businessStatus: 'in_progress', gaps: [] };
  const result = input.binding.resultSnapshot;
  if (result?.isError === true) {
    const failure = classifyProviderBusinessOutcome(result);
    return {
      ...base,
      businessStatus: failure.outcome === 'partial_completion' ? 'partial' : 'failure',
      reasonCode: failure.reasonCode,
      gaps: [],
    };
  }
  const gaps = [
    ...(input.policy === undefined ? ['published_skill_business_evidence_policy_absent'] : []),
    ...(missingRequiredRoles.length > 0 ? ['required_geometry_missing'] : []),
    ...(!input.quality.requiredObjectsResolved ? ['required_object_content_unresolved'] : []),
    ...(input.policy?.requireHistoryContinuity && !input.quality.historyContinuous
      ? ['business_event_history_gap']
      : []),
    // The frozen profile publishes no per-sample trajectory clocks.
    ...(input.policy?.requireTrajectoryTime === true ? ['trajectory_source_time_gap'] : []),
  ];
  const satisfied =
    input.policy?.operationName === input.operationName &&
    result !== undefined &&
    taskBusinessPredicateMatches(result.structuredContent, input.policy.providerSuccess) &&
    gaps.length === 0;
  return {
    ...base,
    policySatisfied: satisfied,
    businessStatus: satisfied ? 'success' : 'unknown',
    gaps: satisfied ? [] : [...gaps, 'protocol_completion_does_not_prove_skill_success'],
  };
}
export function taskBusinessPredicateMatches(
  value: unknown,
  condition: TaskBusinessEvidencePolicy['skillSuccess'],
): boolean {
  let current = value;
  for (const raw of condition.jsonPointer === '' ? [] : condition.jsonPointer.slice(1).split('/')) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    current = Array.isArray(current) ? current[Number(key)] : record(current)?.[key];
  }
  return current === condition.equals;
}
export function buildTaskBusinessSourceArtifact(
  observationId: string,
  content: TaskBusinessContent,
) {
  if (taskBusinessContentDigest(content.bytes) !== content.digest)
    throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INVALID');
  const value = {
    schemaVersion: 'sdar.task-business-source-artifact/v1',
    ref: content.ref,
    identity: content.identity,
    metadata: content.metadata,
    rawSha256: `sha256:${content.digest}`,
    rawByteSize: content.bytes.byteLength,
    encoding: 'base64',
    bytes: Buffer.from(content.bytes).toString('base64'),
  };
  // The canonical builder validates JSON recursively at this internal serialization boundary.
  return buildRuntimeSourceArtifact({
    sourceTable: 'remote_task_observation',
    sourceRecordId: observationId,
    sourceVersion: 1,
    value: value as EvidenceJsonValue,
  });
}
export function taskBusinessContentFromStoredObject(
  object: unknown,
  chunks: readonly unknown[],
): TaskBusinessContent {
  const stored = z
    .object({
      recordType: z.literal('task_business.object'),
      refKey: z.string(),
      digest: z.string().regex(/^[a-f0-9]{64}$/u),
      metadata: z.record(z.string(), z.unknown()),
    })
    .loose()
    .parse(object);
  const tuple = z
    .tuple([
      z.enum(['artifact', 'action', 'input_request', 'intervention']),
      z.string(),
      z.number().int().positive(),
    ])
    .parse(JSON.parse(stored.refKey));
  const identity = taskBusinessIdentitySchema.parse(stored.metadata['identity']);
  let offset = 0;
  let total: number | undefined;
  const buffers: Buffer[] = [];
  if (chunks.length > 172) throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INVALID');
  for (const raw of chunks) {
    const chunk = z
      .object({
        recordType: z.literal('task_business.content'),
        digest: z.string(),
        offset: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
        bytes: z.string(),
      })
      .loose()
      .parse(raw);
    const bytes = Buffer.from(chunk.bytes, 'base64');
    if (
      chunk.digest !== stored.digest ||
      chunk.offset !== offset ||
      bytes.toString('base64') !== chunk.bytes ||
      bytes.byteLength > TASK_BUSINESS_LIMITS.chunkBytes ||
      (total !== undefined && total !== chunk.totalBytes) ||
      chunk.totalBytes > TASK_BUSINESS_LIMITS.artifactBytes
    )
      throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INVALID');
    offset += bytes.byteLength;
    total = chunk.totalBytes;
    buffers.push(bytes);
  }
  const bytes = Buffer.concat(buffers);
  if (chunks.length === 0 || offset !== total || taskBusinessContentDigest(bytes) !== stored.digest)
    throw new TaskBusinessError('TASK_BUSINESS_CONTENT_INCOMPLETE');
  return {
    ref: { kind: tuple[0], id: tuple[1], revision: tuple[2] },
    identity,
    digest: stored.digest,
    metadata: stored.metadata,
    bytes,
  };
}
export const taskBusinessArtifactRefSchema = z
  .object({
    artifactId: z.string(),
    version: z.number().int().positive(),
    uri: z.string(),
    sha256: z
      .templateLiteral(['sha256:', z.string()])
      .refine((value) => /^sha256:[a-f0-9]{64}$/u.test(value)),
    mediaType: z.string(),
    byteSize: z.number().int().nonnegative(),
  })
  .strict();
export function parseTaskBusinessArtifactRef(raw: unknown): ArtifactRef {
  return taskBusinessArtifactRefSchema.parse(raw);
}
function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
function countCoordinates(value: unknown, depth = 0): number | undefined {
  if (!Array.isArray(value) || depth > 5) return undefined;
  if (value.length >= 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item)))
    return 1;
  let count = 0;
  for (const item of value) {
    const nested = countCoordinates(item, depth + 1);
    if (nested === undefined) return undefined;
    count += nested;
  }
  return count;
}
