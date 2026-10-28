import { createHash } from 'node:crypto';
import { z } from 'zod';

import { hashCanonicalEvidenceJson } from './evidence/canonical-evidence.js';
import { hashSourceArtifactJson } from './evidence/source-artifact-ref.js';
import type { EvidenceJsonValue } from './evidence/canonical-evidence.js';
import type { ArtifactRef } from './evidence/canonical-evidence.js';
import type { RemoteTaskBinding } from './remote-task.js';
import {
  assessTaskBusinessOutcome,
  summarizeTaskBusinessGeometry,
  taskBusinessArtifactRefSchema,
  type TaskBusinessGeometrySummary,
  type TaskBusinessOutcome,
  type TaskBusinessEvidencePolicy,
} from './task-business-evidence.js';

const refSchema = z
  .object({
    kind: z.enum(['artifact', 'action', 'input_request', 'intervention']),
    id: z.string().min(1).max(512),
    revision: z.number().int().positive(),
  })
  .strict();
const identitySchema = z
  .object({
    taskId: z.string().min(1),
    executionId: z.string().min(1),
    providerId: z.string().min(1),
    resourceId: z.string().min(1),
    operationName: z.string().min(1),
    correlationId: z.string().optional(),
    simulationId: z.string().optional(),
  })
  .strict();
export const taskBusinessIdentitySchema = identitySchema;
const record = z.record(z.string(), z.unknown());
const contextSchema = z
  .object({
    schemaVersion: z.literal('sdar.task-business-context/1.0-rc2'),
    identity: identitySchema,
    contextRevision: z.number().int().nonnegative(),
    effectivePlanRevision: z.number().int().nonnegative(),
    summary: z
      .object({
        status: z.enum(['in_progress', 'finalized']),
        properties: record.optional(),
        resultCode: z.string().optional(),
      })
      .loose(),
    activeRefs: z.record(z.string(), refSchema),
    artifactRefs: z.array(refSchema),
    actionRefs: z.array(refSchema),
    requiredInputRefs: z.array(refSchema),
    interventionRefs: z.array(refSchema),
    updatedAt: z.iso.datetime({ offset: true }),
    finalizedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .loose();
const objectSchema = z
  .object({
    kind: refSchema.shape.kind,
    value: z.object({ identity: identitySchema, revision: z.number().int().positive() }).loose(),
  })
  .strict();
const viewSchema = z
  .object({
    context: contextSchema,
    objects: z.array(objectSchema).max(1024),
    resumeFrom: z
      .object({
        streamId: z.string().min(1),
        afterSequence: z.string().regex(/^(0|[1-9][0-9]*)$/u),
      })
      .strict(),
  })
  .loose();

export type TaskBusinessRef = z.infer<typeof refSchema>;
export type TaskBusinessIdentity = z.infer<typeof identitySchema>;
export type TaskBusinessObject = z.infer<typeof objectSchema>;
export type TaskBusinessView = z.infer<typeof viewSchema>;

export interface TaskBusinessQuality {
  readonly currentStateComplete: boolean;
  readonly historyContinuous: boolean;
  readonly requiredObjectsResolved: boolean;
  readonly trajectoryTimeComplete: boolean;
  readonly gaps: readonly string[];
}
export interface TaskBusinessObjectResolution {
  readonly ref: TaskBusinessRef;
  readonly resolution: 'resolved' | 'unresolved';
  readonly digest?: string | undefined;
  readonly contentRef?: string | undefined;
  readonly artifactRef?: ArtifactRef;
}
export interface TaskBusinessProjection {
  readonly schemaVersion: 'sdar.task-business-projection/v1';
  readonly bindingId: string;
  readonly taskId: string;
  readonly identity: TaskBusinessIdentity;
  readonly contextRevision: number;
  readonly effectivePlanRevision: number;
  readonly projectionRevision: number;
  readonly status: 'current' | 'history';
  readonly executionSummary: Readonly<Record<string, unknown>>;
  readonly objects: readonly TaskBusinessObjectResolution[];
  readonly interactionRequests: readonly Readonly<Record<string, unknown>>[];
  readonly allowedInterventions: readonly Readonly<Record<string, unknown>>[];
  readonly snapshotWatermark: TaskBusinessView['resumeFrom'];
  readonly appliedEvent?:
    | Readonly<{
        inboxId: string;
        eventId: string;
        streamId: string;
        sequence: string;
      }>
    | undefined;
  readonly quality: TaskBusinessQuality;
  readonly sourceTime?: string | undefined;
  readonly sourceTimeBasis?: 'provider_received_at' | undefined;
  readonly sourceTimeFieldPath?: string | undefined;
  readonly deviceReportedAt?: string | undefined;
  readonly sdarReceivedAt: string;
  readonly projectedAt: string;
  readonly contextDigest: string;
  readonly geometry?: readonly TaskBusinessGeometrySummary[];
  readonly businessOutcome?: TaskBusinessOutcome;
  readonly skillSuccessCondition?: TaskBusinessEvidencePolicy['skillSuccess'];
}

export interface TaskBusinessContent {
  readonly ref: TaskBusinessRef;
  readonly identity: TaskBusinessIdentity;
  readonly digest: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly bytes: Uint8Array;
}

const projectionSchema = z
  .object({
    schemaVersion: z.literal('sdar.task-business-projection/v1'),
    bindingId: z.string(),
    taskId: z.string(),
    identity: identitySchema,
    contextRevision: z.number().int().nonnegative(),
    effectivePlanRevision: z.number().int().nonnegative(),
    projectionRevision: z.number().int().positive(),
    status: z.enum(['current', 'history']),
    executionSummary: record,
    objects: z.array(
      z
        .object({
          ref: refSchema,
          resolution: z.enum(['resolved', 'unresolved']),
          digest: z.string().optional(),
          contentRef: z.string().optional(),
          artifactRef: taskBusinessArtifactRefSchema.optional(),
        })
        .strict(),
    ),
    interactionRequests: z.array(record),
    allowedInterventions: z.array(record),
    snapshotWatermark: viewSchema.shape.resumeFrom,
    appliedEvent: z
      .object({
        inboxId: z.string(),
        eventId: z.string(),
        streamId: z.string(),
        sequence: z.string(),
      })
      .strict()
      .optional(),
    quality: z
      .object({
        currentStateComplete: z.boolean(),
        historyContinuous: z.boolean(),
        requiredObjectsResolved: z.boolean(),
        trajectoryTimeComplete: z.boolean(),
        gaps: z.array(z.string()),
      })
      .strict(),
    sourceTime: z.string().optional(),
    sourceTimeBasis: z.literal('provider_received_at').optional(),
    sourceTimeFieldPath: z.string().optional(),
    deviceReportedAt: z.string().optional(),
    sdarReceivedAt: z.string(),
    projectedAt: z.string(),
    contextDigest: z.string(),
    geometry: z
      .array(
        z
          .object({
            ref: refSchema,
            artifactType: z.string(),
            role: z.enum([
              'requested_target',
              'planned_route',
              'adopted_route',
              'actual_trajectory',
              'observation_area',
              'measured_coverage',
              'estimated_fov',
              'other',
            ]),
            semantics: z.string(),
            crs: z.string().optional(),
            geometryType: z.string().optional(),
            retainedCoordinateCount: z.number().int().nonnegative().optional(),
            providerSampleCount: z.number().int().nonnegative().optional(),
            coordinateOrder: z.enum(['longitude_latitude', 'unspecified']),
            sampleOrder: z.literal('provider_retained_order').optional(),
            rawContentComplete: z.boolean(),
            current: z.boolean(),
            validUntil: z.string().optional(),
            perSampleSourceTimeComplete: z.literal(false),
            displayDerived: z.literal(true),
            gaps: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    businessOutcome: z
      .object({
        protocolStatus: z.enum(['working', 'input_required', 'completed', 'failed', 'cancelled']),
        businessStatus: z.enum(['in_progress', 'success', 'failure', 'partial', 'unknown']),
        reasonCode: z.string().optional(),
        policySatisfied: z.boolean(),
        missingRequiredRoles: z.array(
          z.enum([
            'requested_target',
            'planned_route',
            'adopted_route',
            'actual_trajectory',
            'observation_area',
            'measured_coverage',
            'estimated_fov',
            'other',
          ]),
        ),
        gaps: z.array(z.string()),
      })
      .strict()
      .optional(),
    skillSuccessCondition: z
      .object({
        jsonPointer: z.string(),
        equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
      .strict()
      .optional(),
  })
  .strict();

export function parseTaskBusinessProjection(raw: unknown): TaskBusinessProjection {
  return JSON.parse(JSON.stringify(projectionSchema.parse(raw))) as TaskBusinessProjection;
}

export const TASK_BUSINESS_LIMITS = Object.freeze({
  artifactBytes: 8 * 1_048_576,
  refreshBytes: 16 * 1_048_576,
  objects: 1024,
  summaryBytes: 32_768,
  chunkBytes: 49_152,
});

/** Own domain validation after the frozen adapter; no SDK types or authority in business data. */
export function normalizeTaskBusinessView(
  raw: unknown,
  expected: Omit<TaskBusinessIdentity, 'executionId'> & Readonly<{ executionId?: string }>,
): TaskBusinessView {
  const parsed = viewSchema.safeParse(raw);
  if (!parsed.success) throw new TaskBusinessError('TASK_BUSINESS_SCHEMA_INVALID');
  const view = parsed.data;
  assertTaskBusinessIdentity(view.context.identity, expected);
  const seen = new Map<string, string>();
  for (const object of view.objects) {
    assertTaskBusinessIdentity(object.value.identity, view.context.identity);
    const ref = taskBusinessObjectRef(object);
    const key = taskBusinessRefKey(ref);
    const hash = hashSourceArtifactJson(object as unknown as EvidenceJsonValue);
    if (seen.has(key) && seen.get(key) !== hash)
      throw new TaskBusinessError('TASK_BUSINESS_OBJECT_CONFLICT');
    seen.set(key, hash);
  }
  return view;
}

export function assertTaskBusinessIdentity(
  actual: TaskBusinessIdentity,
  expected: Omit<TaskBusinessIdentity, 'executionId'> & Readonly<{ executionId?: string }>,
): void {
  for (const key of ['taskId', 'providerId', 'resourceId', 'operationName'] as const)
    if (actual[key] !== expected[key])
      throw new TaskBusinessError('TASK_BUSINESS_IDENTITY_CONFLICT');
  if (expected.executionId !== undefined && actual.executionId !== expected.executionId)
    throw new TaskBusinessError('TASK_BUSINESS_EXECUTION_CONFLICT');
}

export function taskBusinessObjectRef(object: TaskBusinessObject): TaskBusinessRef {
  const key = {
    artifact: 'artifactId',
    action: 'actionId',
    input_request: 'requestId',
    intervention: 'interventionId',
  }[object.kind];
  const parsed = refSchema.safeParse({
    kind: object.kind,
    id: object.value[key],
    revision: object.value.revision,
  });
  if (!parsed.success) throw new TaskBusinessError('TASK_BUSINESS_OBJECT_REF_INVALID');
  return parsed.data;
}
export function taskBusinessRefKey(ref: TaskBusinessRef): string {
  return JSON.stringify([ref.kind, ref.id, ref.revision]);
}
export function taskBusinessContentDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
export function taskBusinessContentRef(bindingId: string, digest: string): string {
  return `sdar-task-business://${encodeURIComponent(bindingId)}/${digest}`;
}

export function projectTaskBusiness(
  input: Readonly<{
    bindingId: string;
    taskId: string;
    view: TaskBusinessView;
    contents: readonly TaskBusinessContent[];
    receivedAt: string;
    projectedAt: string;
    previous?: TaskBusinessProjection;
    historyContinuous: boolean;
    sourceTimeQualified?: boolean;
    bindingOutcome?: Pick<RemoteTaskBinding, 'protocolStatus' | 'resultSnapshot' | 'errorSnapshot'>;
    evidencePolicy?: TaskBusinessEvidencePolicy;
    appliedEvent?: TaskBusinessProjection['appliedEvent'];
  }>,
): TaskBusinessProjection {
  const { context } = input.view;
  const refs = new Map<string, TaskBusinessRef>();
  for (const ref of [
    ...context.artifactRefs,
    ...context.actionRefs,
    ...context.requiredInputRefs,
    ...context.interventionRefs,
    ...Object.values(context.activeRefs),
  ])
    refs.set(taskBusinessRefKey(ref), ref);
  const objects = [...refs].map(([key, ref]): TaskBusinessObjectResolution => {
    const content = input.contents.find((candidate) => taskBusinessRefKey(candidate.ref) === key);
    return content === undefined
      ? { ref, resolution: 'unresolved' }
      : {
          ref,
          resolution: 'resolved',
          digest: content.digest,
          contentRef: taskBusinessContentRef(input.bindingId, content.digest),
        };
  });
  const requiredKeys = new Set(
    [
      ...context.requiredInputRefs,
      ...context.interventionRefs,
      ...Object.values(context.activeRefs),
    ].map(taskBusinessRefKey),
  );
  const requiredObjectsResolved = objects
    .filter((item) => requiredKeys.has(taskBusinessRefKey(item.ref)))
    .every((item) => item.resolution === 'resolved');
  const allResolved = objects.every((item) => item.resolution === 'resolved');
  const gaps = [
    ...(!input.historyContinuous ? ['business_event_history_gap'] : []),
    ...(!allResolved ? ['unresolved_object_content'] : []),
  ];
  const trajectory = input.view.objects.some(
    (object) =>
      object.kind === 'artifact' && object.value['artifactType'] === 'navigation.trajectory',
  );
  if (trajectory)
    gaps.push(
      'provider_trajectory_has_no_per_sample_receive_time',
      'provider_retained_samples_may_be_sampled',
    );
  const properties = context.summary.properties ?? {};
  const last = properties['trajectoryLast'];
  const source = isRecord(last) ? last['observedAt'] : undefined;
  const time =
    input.sourceTimeQualified === true &&
    typeof source === 'string' &&
    z.iso.datetime({ offset: true }).safeParse(source).success
      ? source
      : undefined;
  if (time === undefined) gaps.push('provider_receive_time_unavailable');
  if (time !== undefined && Date.parse(time) > Date.parse(input.receivedAt))
    gaps.push('source_time_in_future');
  if (
    time !== undefined &&
    input.previous?.sourceTime !== undefined &&
    Date.parse(time) < Date.parse(input.previous.sourceTime)
  )
    gaps.push('source_time_reversed');
  const summary = JSON.parse(JSON.stringify(context.summary)) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(summary)) > TASK_BUSINESS_LIMITS.summaryBytes)
    throw new TaskBusinessError('TASK_BUSINESS_SUMMARY_LIMIT');
  const active = new Set(Object.values(context.activeRefs).map(taskBusinessRefKey));
  const geometry = input.contents
    .filter((item) => item.ref.kind === 'artifact')
    .map((item) => summarizeTaskBusinessGeometry(item, input.view, input.projectedAt));
  const quality: TaskBusinessQuality = {
    currentStateComplete: allResolved,
    historyContinuous: input.historyContinuous,
    requiredObjectsResolved,
    trajectoryTimeComplete: !trajectory,
    gaps,
  };
  const candidates = (kind: 'input_request' | 'intervention', state: string) =>
    input.view.objects
      .filter(
        (object) =>
          object.kind === kind &&
          object.value['state'] === state &&
          active.has(taskBusinessRefKey(taskBusinessObjectRef(object))),
      )
      .map((object) => Object.freeze({ ...object.value }));
  return Object.freeze({
    schemaVersion: 'sdar.task-business-projection/v1',
    bindingId: input.bindingId,
    taskId: input.taskId,
    identity: context.identity,
    contextRevision: context.contextRevision,
    effectivePlanRevision: context.effectivePlanRevision,
    projectionRevision: (input.previous?.projectionRevision ?? 0) + 1,
    status: 'current',
    executionSummary: summary,
    objects,
    interactionRequests:
      context.summary.status === 'in_progress' ? candidates('input_request', 'pending') : [],
    allowedInterventions:
      context.summary.status === 'in_progress' ? candidates('intervention', 'available') : [],
    snapshotWatermark: input.view.resumeFrom,
    ...(input.appliedEvent === undefined ? {} : { appliedEvent: input.appliedEvent }),
    quality,
    geometry,
    ...(input.bindingOutcome === undefined
      ? {}
      : {
          businessOutcome: assessTaskBusinessOutcome({
            binding: input.bindingOutcome,
            operationName: context.identity.operationName,
            geometry,
            quality,
            ...(input.evidencePolicy === undefined ? {} : { policy: input.evidencePolicy }),
          }),
        }),
    ...(input.evidencePolicy === undefined
      ? {}
      : { skillSuccessCondition: input.evidencePolicy.skillSuccess }),
    ...(time === undefined
      ? {}
      : {
          sourceTime: time,
          sourceTimeBasis: 'provider_received_at',
          sourceTimeFieldPath: '/context/summary/properties/trajectoryLast/observedAt',
        }),
    sdarReceivedAt: input.receivedAt,
    projectedAt: input.projectedAt,
    contextDigest: taskBusinessContextDigest(context),
  });
}

/** Native effect Context is an untrusted source document; its private identity hash stays
 * in retained source content, never relaxed into the Canonical Evidence field allowlist. */
export function taskBusinessContextDigest(
  context: TaskBusinessView['context'],
): `sha256:${string}` {
  const properties = context.summary.properties ?? {};
  const result = properties['executionResult'];
  if (
    context.identity.operationName === 'simulation_apply_effect' &&
    properties['schemaVersion'] === 'ugv.zmq-context-summary/1' &&
    isRecord(result) &&
    result['schemaVersion'] === 'ugv.zmq-effect-result/2' &&
    result['qualification'] === 'site_control'
  )
    return hashSourceArtifactJson(context as unknown as EvidenceJsonValue);
  return hashCanonicalEvidenceJson(context);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export class TaskBusinessError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'TaskBusinessError';
  }
}
