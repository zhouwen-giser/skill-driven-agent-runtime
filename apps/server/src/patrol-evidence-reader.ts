import {
  isGovernedPatrol,
  isPatrolCapability,
  ZMQ_PATROL_SKILL,
  ZMQ_PATROL_CAPABILITY,
  ZMQ_PATROL_CHILDREN,
  zmqPatrolChildInput,
  aggregateZmqPatrol,
} from '../../../packages/domain/src/zmq-area-patrol.js';
import { createHash } from 'node:crypto';
import { projectSiteZmqResult } from '../../../packages/domain/src/zmq-site-capability.js';
import {
  aggregateAreaPatrol,
  type PatrolChildEvidence,
} from '../../../packages/domain/src/area-patrol.js';
import { canonicalHash } from '../../../packages/application/src/mcp-task-readiness.js';
import { projectInspectionResult } from '../../../packages/domain/src/area-inspection.js';
import type {
  PostgresAgentTaskRepository,
  PostgresTaskCapabilityRepository,
  PostgresWorkflowPlanRepository,
  PostgresTaskBusinessRepository,
  PostgresSkillCallWorkflowRepository,
} from '../../../packages/persistence-postgres/src/index.js';
import type {
  TaskCapabilityBinding,
  TaskBusinessProjection,
} from '../../../packages/domain/src/index.js';

/** Reads only admitted child Tasks and their retained, digest-verified native business content. */
export class PatrolEvidenceReader {
  constructor(
    readonly dependencies: Readonly<{
      tasks: PostgresAgentTaskRepository;
      bindings: PostgresTaskCapabilityRepository;
      plans: PostgresWorkflowPlanRepository;
      business: PostgresTaskBusinessRepository;
      calls: PostgresSkillCallWorkflowRepository;
    }>,
  ) {}
  async read(taskId: string, binding: TaskCapabilityBinding, planId: string) {
    const { tasks, bindings, plans, business } = this.dependencies;
    const parent = await tasks.findById(taskId),
      plan = await plans.findPlan(planId);
    const policy = plan?.definition?.skillUsagePolicy;
    if (
      parent?.planId !== planId ||
      parent.goalId !== plan?.goalId ||
      parent.goalVersion !== plan?.goalVersion ||
      parent.selectedSkillId !== policy?.skill.skillId ||
      parent.selectedSkillVersion !== policy?.skill.skillVersion ||
      plan?.confirmationStatus !== 'confirmed' ||
      !policy ||
      !isGovernedPatrol(policy.skill.skillId, policy.skill.skillVersion) ||
      !isPatrolCapability(binding.requestedCapabilityId) ||
      (policy.skill.skillId === ZMQ_PATROL_SKILL) !==
        (binding.requestedCapabilityId === ZMQ_PATROL_CAPABILITY)
    )
      throw Error('PATROL_PARENT_AUTHORITY_INVALID');
    const authority = binding.constraintSnapshot.filter(
      (constraint) => constraint['type'] === 'composition_authority_policy',
    );
    if (authority.length !== 1 || !Array.isArray(authority[0]?.['children']))
      throw Error('PATROL_COMPOSITION_AUTHORITY_INVALID');
    const expected = authority[0]['children'].map(record);
    if (
      expected.length !== 2 ||
      new Set(expected.map((spec) => spec?.['skillId'])).size !== 2 ||
      !expected.some(
        (spec) =>
          spec?.['skillId'] ===
          (policy.skill.skillId === ZMQ_PATROL_SKILL ? ZMQ_PATROL_CHILDREN[0] : 'embodied.move_to'),
      ) ||
      !expected.some(
        (spec) =>
          spec?.['skillId'] ===
          (policy.skill.skillId === ZMQ_PATROL_SKILL
            ? ZMQ_PATROL_CHILDREN[1]
            : 'embodied.inspect_area'),
      )
    )
      throw Error('PATROL_CHILD_SET_INVALID');
    const reports: PatrolChildEvidence[] = [];
    for (const child of await tasks.listGovernedChildren(taskId, planId)) {
      const link = record(child.requestMetadata['io.sdar/governedChildTask']);
      const specification = expected.find(
        (candidate) =>
          candidate !== undefined &&
          candidate['skillId'] === child.selectedSkillId &&
          candidate['skillVersion'] === child.selectedSkillVersion,
      );
      const childBinding = await bindings.findBinding(child.taskId);
      if (
        link?.['parentTaskId'] !== taskId ||
        link['parentPlanId'] !== planId ||
        child.deviceOwnership?.deviceId !== parent.deviceOwnership?.deviceId ||
        child.deviceOwnership?.bindingId !== parent.deviceOwnership?.bindingId ||
        child.deviceOwnership?.sdarServiceKey !== parent.deviceOwnership?.sdarServiceKey ||
        !specification ||
        !childBinding ||
        childBinding.requestedCapabilityId !== specification['capabilityId'] ||
        childBinding.capabilityVersion !== specification['capabilityVersion'] ||
        childBinding.initialImplementationRefs.length !== 1 ||
        childBinding.initialImplementationRefs[0] !==
          `skill:${String(child.selectedSkillId)}:${String(child.selectedSkillVersion)}`
      )
        throw Error('PATROL_CHILD_AUTHORITY_INVALID');
      if (
        typeof link['parentInstanceId'] !== 'string' ||
        typeof link['parentNodeRunId'] !== 'string'
      )
        throw Error('PATROL_CHILD_LINK_INVALID');
      const call = await this.dependencies.calls.find(
        link['parentInstanceId'],
        link['parentNodeRunId'],
      );
      if (
        call?.parentPlanId !== planId ||
        call.childPlanId !== child.planId ||
        call.skillId !== child.selectedSkillId ||
        call.skillVersion !== child.selectedSkillVersion
      )
        throw Error('PATROL_CHILD_NATIVE_LINK_MISSING');
      const childPlan = await plans.findPlan(child.planId);
      const declaredNode = plan.definition.nodes.find(
        (node) => node.nodeId === link['parentNodeId'],
      );
      if (
        !childPlan ||
        (childPlan.executionTaskId !== undefined && childPlan.executionTaskId !== child.taskId) ||
        childPlan.goalId !== child.goalId ||
        childPlan.goalVersion !== child.goalVersion ||
        declaredNode?.type !== 'skill_call' ||
        declaredNode.skillId !== child.selectedSkillId ||
        (child.phase === 'completed' && childPlan.confirmationStatus !== 'confirmed')
      )
        throw Error('PATROL_CHILD_PLAN_AUTHORITY_INVALID');
      const original = record(binding.inputSnapshot);
      const mappings = policy.childPolicies.find(
        (candidate) =>
          candidate.child.skillId === child.selectedSkillId &&
          candidate.child.skillVersion === child.selectedSkillVersion,
      )?.inputMappings;
      if (!original || mappings === undefined)
        throw Error('PATROL_CHILD_MAPPING_AUTHORITY_INVALID');
      const nativePatrol = policy.skill.skillId === ZMQ_PATROL_SKILL;
      const mapped: Record<string, unknown> = nativePatrol
        ? zmqPatrolChildInput(original, child.selectedSkillId ?? '')
        : {};
      for (const mapping of nativePatrol ? [] : mappings) {
        let value: unknown = original;
        for (const field of mapping.sourcePath.split('.')) value = record(value)?.[field];
        mapped[mapping.targetPath] = value;
      }
      if (canonicalHash(mapped) !== canonicalHash(childBinding.inputSnapshot))
        throw Error('PATROL_CHILD_INPUT_CONFLICT');
      const missingEvidence: string[] = [];
      const projections = await business.listByTask(child.taskId);
      const remoteTasks = projections
        .filter(
          (p) =>
            p.taskId === child.taskId &&
            p.status === 'current' &&
            p.identity.resourceId === original['resourceId'] &&
            p.identity.operationName === child.selectedSkillId?.slice('ugv.zmq.'.length),
        )
        .map((p) => ({
          taskId: p.identity.taskId,
          executionId: p.identity.executionId,
          providerId: p.identity.providerId,
          operationName: p.identity.operationName,
        }));
      if (remoteTasks.length > 8) throw Error('PATROL_CHILD_REMOTE_TASK_IDENTITY_CONFLICT');
      const phase =
        child.phase === 'completed'
          ? 'completed'
          : child.phase === 'canceled'
            ? 'canceled'
            : child.phase === 'failed'
              ? 'failed'
              : 'unavailable';
      const attempts = await bindings.listAttempts(child.taskId);
      if (phase === 'completed' && attempts.at(-1)?.status !== 'succeeded')
        throw Error('PATROL_CHILD_TERMINAL_PROOF_MISSING');
      let result = record(child.output?.structured);
      if (!result && nativePatrol) {
        const name =
          child.selectedSkillId === ZMQ_PATROL_CHILDREN[0]
            ? 'vehicle_zmq_navigate'
            : 'vehicle_zmq_inspect_area';
        for (const projection of projections)
          result =
            readRetainedZmqPatrolChildResult(
              projection,
              child.taskId,
              original['resourceId'],
              name,
            ) ?? result;
      }
      if (!result && child.selectedSkillId === 'embodied.inspect_area') {
        for (const projection of projections) {
          result =
            readRetainedInspectionResult(projection, child.taskId, original['resourceId']) ??
            result;
        }
        if (!result) missingEvidence.push('subregion-1:INSPECTION_CHILD_REPORT_UNAVAILABLE');
      }
      const trajectory: NonNullable<PatrolChildEvidence['trajectory']>[number][] = [];
      const trajectorySourceRefs: string[] = [];
      if (
        ['embodied.move_to', ZMQ_PATROL_CHILDREN[0]].includes(child.selectedSkillId ?? '') &&
        phase === 'completed'
      ) {
        for (const projection of projections) {
          if (
            projection.identity.operationName !==
              (nativePatrol ? 'vehicle_zmq_navigate' : 'vehicle_navigate') ||
            projection.identity.resourceId !== original['resourceId'] ||
            projection.taskId !== child.taskId ||
            projection.status !== 'current'
          )
            continue;
          for (const geometry of projection.geometry ?? []) {
            if (
              geometry.role !== 'actual_trajectory' ||
              geometry.coordinateOrder !== 'longitude_latitude' ||
              !geometry.current ||
              !geometry.rawContentComplete ||
              (geometry.providerSampleCount ?? 0) < 2 ||
              !['LineString', 'MultiLineString'].includes(geometry.geometryType ?? '')
            )
              continue;
            const object = projection.objects.find(
              (candidate) =>
                candidate.ref.id === geometry.ref.id &&
                candidate.ref.revision === geometry.ref.revision &&
                candidate.resolution === 'resolved',
            );
            // The current trajectory is a complete, scoped snapshot. Event replay
            // continuity and unavailable unrelated objects do not invalidate its
            // individually restored and digest-verified spatial content.
            if (!object?.digest || !object.artifactRef) continue;
            const bytes = await business.readContent(projection.bindingId, object.digest);
            if (!bytes || createHash('sha256').update(bytes).digest('hex') !== object.digest)
              throw Error('PATROL_TRAJECTORY_DIGEST_CONFLICT');
            const content: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
            const geo = record(record(content)?.['geometry']) ?? record(content);
            const coordinates = geo?.['coordinates'];
            const lines =
              geo?.['type'] === 'LineString'
                ? [coordinates]
                : geo?.['type'] === 'MultiLineString' && Array.isArray(coordinates)
                  ? coordinates
                  : [];
            for (const line of lines)
              if (Array.isArray(line))
                for (const point of line) {
                  if (
                    !Array.isArray(point) ||
                    typeof point[0] !== 'number' ||
                    !Number.isFinite(point[0]) ||
                    Math.abs(point[0]) > 180 ||
                    typeof point[1] !== 'number' ||
                    !Number.isFinite(point[1]) ||
                    Math.abs(point[1]) > 90
                  )
                    throw Error('PATROL_TRAJECTORY_COORDINATES_INVALID');
                  trajectory.push({
                    resourceId: original['resourceId'],
                    position: { x: point[0], y: point[1], frame: 'EPSG:4326' },
                  });
                }
            trajectorySourceRefs.push(`task-business:${projection.bindingId}:${object.digest}`);
          }
        }
        if (trajectory.length > 4096) {
          trajectory.length = 4096;
          missingEvidence.push('subregion-1:PATROL_TRAJECTORY_INLINE_TRUNCATED');
        }
      }
      reports.push({
        taskId: child.taskId,
        skillId: child.selectedSkillId ?? '',
        skillVersion: child.selectedSkillVersion ?? 0,
        phase,
        ...(result === undefined ? {} : { result }),
        trajectory,
        trajectorySourceRefs,
        missingEvidence,
        remoteTasks,
      });
    }
    return policy.skill.skillId === ZMQ_PATROL_SKILL
      ? aggregateZmqPatrol(binding.inputSnapshot, reports)
      : aggregateAreaPatrol(binding.inputSnapshot, reports);
  }
}
export function readRetainedZmqPatrolChildResult(
  projection: TaskBusinessProjection,
  taskId: string,
  resourceId: unknown,
  toolName: 'vehicle_zmq_navigate' | 'vehicle_zmq_inspect_area',
) {
  if (
    typeof resourceId !== 'string' ||
    projection.taskId !== taskId ||
    projection.status !== 'current' ||
    projection.identity.resourceId !== resourceId ||
    projection.identity.operationName !== toolName
  )
    return undefined;
  const raw = record(record(projection.executionSummary['properties'])?.['executionResult']);
  if (!raw) return undefined;
  if (
    (raw['resourceId'] !== undefined && raw['resourceId'] !== resourceId) ||
    raw['schemaVersion'] !==
      (toolName === 'vehicle_zmq_navigate'
        ? 'ugv.zmq-control-result/2'
        : 'ugv.zmq-inspection-result/2')
  )
    throw Error('ZMQ_PATROL_RETAINED_REPORT_IDENTITY_INVALID');
  return projectSiteZmqResult(toolName, raw, resourceId, 'zmq_v1_2_0_site_control_13');
}
export function readRetainedInspectionResult(
  projection: TaskBusinessProjection,
  taskId: string,
  resourceId: unknown,
) {
  if (
    projection.taskId !== taskId ||
    projection.status !== 'current' ||
    projection.identity.operationName !== 'vehicle_inspect_area' ||
    projection.identity.resourceId !== resourceId
  )
    return undefined;
  const retained = record(record(projection.executionSummary['properties'])?.['inspectionResult']);
  const raw = record(retained?.['structuredContent']) ?? retained;
  return raw && ['failed', 'cancelled', 'timeout'].includes(String(raw['status']))
    ? projectInspectionResult(raw)
    : undefined;
}
function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}
