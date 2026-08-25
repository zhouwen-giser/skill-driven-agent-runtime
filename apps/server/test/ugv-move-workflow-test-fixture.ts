import {
  createSelectedTaskOperation,
  hashCanonicalEvidenceJson,
  snapshotSkillUsageCompositionPlan,
  type GoalExecutionContract,
  type McpTaskExecutionProfile,
  type SelectedTaskOperation,
  type SkillModeInterpretation,
  type SkillUsageCandidateSnapshot,
  type SkillVersion,
} from '../../../packages/domain/src/index.js';

import { loadExactUgvProfileSkill } from './ugv-agent-profile-test-fixture.js';

export const UGV_WORKFLOW_NOW = '2026-08-21T12:00:00.000Z';
export const UGV_WORKFLOW_VALID_UNTIL = '2026-08-21T12:05:00.000Z';
export const UGV_WORKFLOW_IDENTITY = Object.freeze({
  taskId: 'task-uap-p2-b03',
  workflowPlanId: 'plan-uap-p2-b03',
  workflowDefinitionId: 'workflow-uap-p2-b03',
  workflowDefinitionVersion: 1,
  goalId: 'goal-uap-p2-b03',
  goalVersion: 1,
  skillId: 'embodied.move_to' as const,
  skillVersion: 1 as const,
});

export const UGV_WORKFLOW_GOAL: GoalExecutionContract = Object.freeze({
  goalId: UGV_WORKFLOW_IDENTITY.goalId,
  version: UGV_WORKFLOW_IDENTITY.goalVersion,
  title: 'Move the simulated UGV to the authorized point',
  description: 'Use exact governed point navigation and prove final position.',
  constraints: Object.freeze(['Use only vehicle:ugv1.']),
  successCriteria: Object.freeze(['Verified final position is within tolerance.']),
});

export function selectedUgvTaskOperation(): SelectedTaskOperation {
  const navigateArguments = Object.freeze({
    resourceId: 'vehicle:ugv1',
    mission: Object.freeze({
      type: 'point' as const,
      target: Object.freeze({ longitude: 112, latitude: 28 }),
    }),
    stopOnObstacle: true as const,
  });
  const stateArguments = Object.freeze({
    resourceId: 'vehicle:ugv1',
    include: Object.freeze(['chassis', 'health']),
  });
  const navigateInputSchema = Object.freeze({ type: 'object', additionalProperties: false });
  const navigateOutputSchema = Object.freeze({
    type: 'object',
    properties: Object.freeze({ positionAuthority: Object.freeze({ type: 'object' }) }),
  });
  const stateInputSchema = Object.freeze({ type: 'object', additionalProperties: false });
  const stateOutputSchema = Object.freeze({
    type: 'object',
    properties: Object.freeze({ chassis: Object.freeze({ type: 'object' }) }),
  });
  const navigateProfile: McpTaskExecutionProfile = Object.freeze({
    profileVersion: '1.0',
    taskBehavior: 'task_required',
    availability: 'dynamic',
    supportsScheduling: true,
    supportsMaxElapsed: true,
    supportsCancellation: true,
    supportsPauseResume: true,
    supportsObservations: true,
    supportsInputRequired: false,
    idempotency: 'server_managed',
  });
  const stateProfile: McpTaskExecutionProfile = Object.freeze({
    profileVersion: '1.0',
    taskBehavior: 'synchronous_only',
    availability: 'dynamic',
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsCancellation: false,
    supportsPauseResume: false,
    supportsObservations: false,
    supportsInputRequired: false,
    idempotency: 'server_managed',
  });
  return createSelectedTaskOperation({
    profileId: 'ugv-agent-profile',
    selectedAt: UGV_WORKFLOW_NOW,
    skill: Object.freeze({
      skillId: 'embodied.move_to',
      version: 1,
      packageChecksum: 'a'.repeat(64),
    }),
    task: Object.freeze({
      semanticTaskType: 'embodied.move',
      operationAlias: 'vehicle_navigate',
      aliasRevision: 'ugv-agent-profile/embodied.move/v1',
      semanticBindingId: 'ugv-agent-profile/move-resource',
      skillBindingId: 'move-resource',
      bindingId: 'binding-ugv-runtime-1',
    }),
    providerBinding: Object.freeze({ bindingId: 'binding-ugv-runtime-1', revision: 7 }),
    provider: Object.freeze({
      providerId: 'isr.vehicle.ugv.ugv1',
      providerType: 'isr.vehicle.ugv',
      providerVersion: '1.0.0',
      manifestHash: 'b'.repeat(64),
    }),
    server: Object.freeze({
      serverId: 'ugv-runtime-1',
      protocolMode: 'frozen_v1',
      discoverySnapshotId: 'snapshot-ugv-runtime-1',
      toolRevision: 9,
      catalogRevision: 'catalog-revision-9',
      catalogChecksum: 'c'.repeat(64),
    }),
    resource: Object.freeze({ resourceId: 'vehicle:ugv1', resourceType: 'vehicle' }),
    operation: Object.freeze({
      operationName: 'vehicle_navigate',
      inputSchema: navigateInputSchema,
      inputSchemaHash: hashCanonicalEvidenceJson(navigateInputSchema),
      outputSchema: navigateOutputSchema,
      outputSchemaHash: hashCanonicalEvidenceJson(navigateOutputSchema),
      executionSemantics: Object.freeze({
        effect: 'side_effecting',
        execution: 'task_required',
        cancellation: 'task_cancel',
        idempotency: 'server_managed',
        replay: 'simulation_only',
        source: 'mcp_declared',
      }),
      taskExecutionProfile: navigateProfile,
      taskNotifications: true,
    }),
    finalStateRead: Object.freeze({
      operationName: 'vehicle_get_state',
      serverId: 'ugv-runtime-1',
      providerId: 'isr.vehicle.ugv.ugv1',
      resourceId: 'vehicle:ugv1',
      catalogChecksum: 'c'.repeat(64),
      inputSchema: stateInputSchema,
      inputSchemaHash: hashCanonicalEvidenceJson(stateInputSchema),
      outputSchema: stateOutputSchema,
      outputSchemaHash: hashCanonicalEvidenceJson(stateOutputSchema),
      executionSemantics: Object.freeze({
        effect: 'read_only',
        execution: 'synchronous',
        cancellation: 'unsupported',
        idempotency: 'server_managed',
        replay: 'allowed',
        source: 'mcp_declared',
      }),
      taskExecutionProfile: stateProfile,
      resolvedArguments: stateArguments,
      argumentsHash: hashCanonicalEvidenceJson(stateArguments),
    }),
    resolvedArguments: navigateArguments,
    argumentsHash: hashCanonicalEvidenceJson(navigateArguments),
    availability: Object.freeze({
      protocolRevision: 'smpp-task-execution/1.0',
      schemaRevision: 'smpp-availability/1.0',
      checkedAt: UGV_WORKFLOW_NOW,
      validUntil: UGV_WORKFLOW_VALID_UNTIL,
      disposition: 'ready',
      riskLevel: 'medium',
      reservationMode: 'none',
      possibleEffects: Object.freeze(['task_pause', 'partial_completion'] as const),
    }),
    execution: Object.freeze({
      mode: 'simulation',
      simulationId: 'sim-uap-p2-b03',
      confirmation: 'existing_outer_plan_confirmation',
      confirmationRequired: true,
    }),
  });
}

/** Shared exact B03 authority fixture for Workflow and terminal-evidence component tests. */
export const createUgvSelectedTaskOperationFixture = selectedUgvTaskOperation;

export async function ugvWorkflowPlanningFixture(): Promise<
  Readonly<{
    skill: SkillVersion;
    candidate: SkillUsageCandidateSnapshot;
    interpretation: SkillModeInterpretation;
    selected: SelectedTaskOperation;
  }>
> {
  const skill = await loadExactUgvProfileSkill();
  const selected = selectedUgvTaskOperation();
  const composition = snapshotSkillUsageCompositionPlan({
    root: { skillId: skill.skillId, skillVersion: skill.version },
    expandedSkills: [{ skillId: skill.skillId, skillVersion: skill.version }],
    edges: [],
    maxDepth: 3,
    consumedDepth: 0,
    consumedSkills: 1,
    consumedNodes: 0,
  });
  const requirements = [
    ['current-position', 'authoritative_context'],
    ['resource-state', 'authoritative_context'],
    ['permission-context', 'authoritative_context'],
  ] as const;
  const providerContextHash = `sha256:${'a'.repeat(64)}`;
  const providerContextPrefix = `task-capability-binding:capability-binding-1:hash:${'b'.repeat(64)}:provider-context-hash:${providerContextHash}:workflow-read:vehicle_get_state:context:`;
  const contextEvidenceRefs = Object.freeze({
    'current-position': `${providerContextPrefix}current-position`,
    'resource-state': `${providerContextPrefix}resource-state`,
    'permission-context': `task-capability-binding:capability-binding-1:hash:${'b'.repeat(64)}:policy-id:ugv-agent-profile/explicit-wgs84-target:revision:2:policy-hash:sha256:${'c'.repeat(64)}:context:permission-context`,
  });
  const candidate: SkillUsageCandidateSnapshot = {
    skillId: skill.skillId,
    skillVersion: skill.version,
    applicability: {
      skillId: skill.skillId,
      skillVersion: skill.version,
      status: 'satisfied',
      reasonCodes: [],
      context: {
        requirements: requirements.map(([requirementId, source]) => ({
          requirementId,
          required: true,
          status: 'satisfied' as const,
          source,
          evidenceRef: contextEvidenceRefs[requirementId],
          attemptedSources: ['authoritative_context'] as const,
        })),
        satisfied: 3,
        total: 3,
        complete: true,
        inputRequiredIds: [],
        unsatisfiedIds: [],
        unknownIds: [],
      },
      readiness: {
        overall: 'ready',
        bindings: [
          {
            bindingId: 'move-resource',
            taskType: 'embodied.move',
            disposition: 'ready',
            confirmationRequired: true,
            reasonCodes: [],
            selectedProviderId: selected.server.serverId,
            selectedOperationName: selected.operation.operationName,
            selectedProtocolMode: 'frozen_v1',
            candidates: [
              {
                providerId: selected.server.serverId,
                operationName: selected.operation.operationName,
                protocolMode: 'frozen_v1',
                attributes: ['task_behavior:task_required'],
                disposition: 'ready',
                riskLevel: selected.availability.riskLevel,
                validUntil: selected.availability.validUntil,
                nextAvailableWindows: [],
                reservationMode: selected.availability.reservationMode,
                possibleEffects: selected.availability.possibleEffects,
                selected: true,
                reasonCodes: [],
              },
            ],
          },
        ],
      },
    },
    modeDecision: {
      decision: 'selected',
      mode: 'template',
      confirmationRequired: true,
      confirmationSatisfied: false,
      reasonCodes: ['outer_plan_confirmation_pending'],
    },
  };
  const interpretation: SkillModeInterpretation = {
    kind: 'template',
    skill: { skillId: skill.skillId, skillVersion: skill.version },
    templateId: 'ugv-agent-profile/embodied.move_to@1',
    instructions: skill.usageSpecification?.modes.template?.instructions ?? [],
    parameterMappings: [],
    outputMappings: [],
    composition,
  };
  return Object.freeze({ skill, candidate, interpretation, selected });
}
