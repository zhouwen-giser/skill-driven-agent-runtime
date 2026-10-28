import {
  buildZmqPatrolSkill,
  zmqPatrolConstraints,
  ZMQ_PATROL_SUCCESS_CRITERIA,
  ZMQ_PATROL_REQUIRED_EVIDENCE,
} from '../../domain/src/zmq-patrol-contract.js';
import {
  ZMQ_PATROL_SKILL,
  ZMQ_PATROL_CAPABILITY,
  ZMQ_PATROL_CHILDREN,
} from '../../domain/src/zmq-area-patrol.js';
import {
  createNodeCapabilityDefinition,
  type CapabilityImplementationBinding,
  type JsonObject,
} from '../../node-control-domain/src/index.js';
import {
  snapshotSkillUsageCompositionPlan,
  type SkillUsageCandidateSnapshot,
  type SkillModeInterpretation,
} from '../../domain/src/index.js';
export const patrolNow = '2026-10-28T00:00:00.000Z';
export function patrolFixture() {
  const resourceId = 'vehicle:ugv1';
  const input = {
    resourceId,
    area: {
      crs: 'OGC:CRS84',
      searchStrategy: 'recognize',
      vertices: [
        { longitude: 106, latitude: 29, ellipsoidHeightM: 250 },
        { longitude: 106.01, latitude: 29, ellipsoidHeightM: 250 },
        { longitude: 106.01, latitude: 29.01, ellipsoidHeightM: 251 },
        { longitude: 106, latitude: 29.01, ellipsoidHeightM: 251 },
      ],
    },
    entryPoint: { longitude: 106.005, latitude: 29.005 },
    speedLimitMps: 1,
    obstacleAvoidance: true,
    timeWindow: { earliestStart: patrolNow, deadline: '2026-10-28T00:10:00.000Z' },
  };
  const children = ZMQ_PATROL_CHILDREN.map((skillId) => ({
    skillId,
    skillVersion: 2,
    capabilityId: `vehicle.ugv.zmq.${skillId.slice('ugv.zmq.'.length)}`,
    capabilityVersion: 2,
    exposureId: `a2a.vehicle.ugv.zmq.${skillId.slice('ugv.zmq.'.length)}`,
    exposureVersion: 2,
  }));
  const provider = {
    type: 'provider_binding_policy',
    mcpProviderBindingId: 'site-binding',
    localServerId: 'site-native',
    mcpToolName: 'vehicle_zmq_inspect_area',
    allowedResourceIds: [resourceId],
    bindingRevision: 1,
    catalogRevision: 'catalog-1',
    catalogChecksum: 'a'.repeat(64),
    requiredStatus: 'active',
    requiredAvailabilityStatus: 'available',
    requiredFreshness: 'unexpired',
    fallback: 'deny',
  };
  const skill = buildZmqPatrolSkill(resourceId, 1, provider, children);
  const definition = createNodeCapabilityDefinition({
    capabilityId: ZMQ_PATROL_CAPABILITY,
    version: 1,
    domain: 'vehicle.ugv.zmq',
    name: skill.name,
    description: skill.summary,
    inputSchema: skill.inputSchema as JsonObject,
    outputSchema: skill.outputSchema as JsonObject,
    effects: ['effect.patrol_reported'],
    artifacts: [],
    successCriteria: [...ZMQ_PATROL_SUCCESS_CRITERIA] as JsonObject[],
    requiredEvidence: [...ZMQ_PATROL_REQUIRED_EVIDENCE] as JsonObject[],
    constraints: zmqPatrolConstraints(resourceId, 1, provider, children) as JsonObject[],
    supportedModes: ['plan_confirmed', 'composition'],
    riskLevel: 'high',
    status: 'published',
    createdBy: 'unit-test',
    createdAt: patrolNow,
  });
  const implementation: CapabilityImplementationBinding = {
    bindingId: 'native-patrol-impl',
    capabilityId: ZMQ_PATROL_CAPABILITY,
    capabilityVersion: 1,
    implementationType: 'skill',
    implementationId: ZMQ_PATROL_SKILL,
    implementationVersion: '1',
    role: 'primary',
    priority: 0,
    providerPolicyOverride: {
      selection: 'required',
      mcpProviderBindingId: 'site-binding',
      localServerId: 'site-native',
      mcpToolName: 'vehicle_zmq_inspect_area',
      allowedResourceIds: [resourceId],
      requireActive: true,
      requireAvailable: true,
      requireUnexpiredFreshness: true,
      denyFallback: true,
    },
    status: 'active',
    revision: 1,
  };
  const candidate: SkillUsageCandidateSnapshot = {
    skillId: skill.skillId,
    skillVersion: skill.version,
    applicability: {
      skillId: skill.skillId,
      skillVersion: skill.version,
      status: 'satisfied',
      reasonCodes: [],
      context: {
        requirements: [],
        satisfied: 2,
        total: 2,
        complete: true,
        inputRequiredIds: [],
        unsatisfiedIds: [],
        unknownIds: [],
      },
      readiness: { overall: 'ready', bindings: [] },
    },
    modeDecision: {
      decision: 'selected',
      mode: 'procedure',
      confirmationRequired: true,
      confirmationSatisfied: false,
      reasonCodes: ['confirmation_pending'],
    },
  };
  const root = { skillId: skill.skillId, skillVersion: skill.version };
  const composition = snapshotSkillUsageCompositionPlan({
    root,
    expandedSkills: [
      root,
      ...children.map(({ skillId, skillVersion }) => ({ skillId, skillVersion })),
    ],
    edges: (skill.usageSpecification?.composition?.fixedDependencies ?? []).map((dependency) => ({
      edgeId: dependency.dependencyId,
      kind: 'fixed_dependency',
      declarationId: dependency.dependencyId,
      parent: root,
      child: { skillId: dependency.skillId, skillVersion: dependency.skillVersion ?? 0 },
      candidateSet: [{ skillId: dependency.skillId, skillVersion: dependency.skillVersion ?? 0 }],
      failurePolicy: dependency.failurePolicy,
      inputMappings: dependency.inputMappings ?? [],
      outputMappings: dependency.outputMappings ?? [],
      depth: 1,
    })),
    maxDepth: 2,
    consumedDepth: 1,
    consumedSkills: 3,
    consumedNodes: 2,
  });
  const interpretation: SkillModeInterpretation = {
    kind: 'procedure',
    apiVersion: 'sdar.io/v1alpha1',
    skill: root,
    instructions: [],
    steps: [],
    composition,
  };
  return {
    input,
    children,
    provider,
    skill,
    definition,
    implementation,
    planning: {
      skill,
      candidate,
      interpretation,
      goalContract: {
        goalId: 'patrol-goal',
        version: 1,
        title: '巡逻',
        description: '巡逻',
        constraints: [],
        successCriteria: ['Retain the actual report.'],
      },
      workflowDefinitionId: 'native-patrol-workflow',
      workflowVersion: 1,
    },
  };
}
