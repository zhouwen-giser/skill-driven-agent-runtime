import {
  prepareSkillUsagePlan,
  type WorkflowCandidateGuard,
  type WorkflowCandidateGuardError,
} from '../../../packages/application/src/index.js';
import {
  createSelectedTaskOperation,
  hashCanonicalEvidenceJson,
  snapshotSkillUsagePlanPolicy,
  type GoalExecutionContract,
  type SelectedTaskOperation,
  type SkillModeInterpretation,
  type SkillUsageCandidateSnapshot,
  type SkillUsagePlanPolicy,
  type SkillVersion,
  type WorkflowDefinition,
  type WorkflowBoundValue,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../../packages/domain/src/index.js';
import type { Clock } from '../../../packages/application/src/ports.js';
import type { SkillCompositionRoot } from '../../../packages/application/src/skill-composition.js';

import { hasExactUgvMoveSkillUsageContextEvidence } from './ugv-move-skill-usage.js';

export const UGV_MOVE_WORKFLOW_NODE_IDS = Object.freeze({
  initialState: 'ugv_initial_state',
  currentPosition: 'ugv_context_current_position',
  resourceState: 'ugv_context_resource_state',
  permissionContext: 'ugv_context_permission',
  navigate: 'ugv_navigate',
  finalState: 'ugv_final_state',
  finalPosition: 'ugv_evidence_final_position',
  success: 'ugv_success',
  failure: 'ugv_failure',
} as const);

const UGV_MOVE_SKILL = Object.freeze({ skillId: 'embodied.move_to', skillVersion: 1 } as const);
const REQUIRED_CONTEXT_IDS = Object.freeze([
  'current-position',
  'resource-state',
  'permission-context',
] as const);
const REQUIRED_CONSTRAINTS = Object.freeze([
  'Use only the selected resource and authorized target.',
  'Preserve Provider authority for reservation, live resource state, and terminal execution state.',
  'Retain the last authoritative position when cancellation or failure is uncertain.',
] as const);
const REQUIRED_FORBIDDEN_ACTIONS = Object.freeze([
  'Enter a forbidden area.',
  'Bypass resource or permission checks.',
  'Report completion without required final-position evidence.',
] as const);
const REQUIRED_CONFIRMATIONS = Object.freeze([
  'Confirm movement when existing plan or refreshed Provider risk policy requires it.',
] as const);
const NAVIGATE_OPERATION = 'vehicle_navigate';
const STATE_OPERATION = 'vehicle_get_state';
const FORBIDDEN_OPERATIONS = Object.freeze([
  'vehicle_area_recon',
  'vehicle_track_target',
  'vehicle_control_gimbal',
  'vehicle_fire_weapon',
  'vehicle_emergency_stop',
] as const);
const FORBIDDEN_OPERATION_NAMES: ReadonlySet<string> = new Set(FORBIDDEN_OPERATIONS);
const FORBIDDEN_NODE_TYPES = new Set([
  'human_confirmation',
  'llm',
  'skill_call',
  'subworkflow',
  'loop',
  'parallel',
  'error_handler',
]);

export interface PrepareUgvMoveWorkflowInput {
  readonly skill: SkillVersion;
  readonly candidate: SkillUsageCandidateSnapshot;
  readonly interpretation: SkillModeInterpretation;
  readonly goalContract: GoalExecutionContract;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly selectedTaskOperation: SelectedTaskOperation;
}

export interface PreparedUgvMoveWorkflowPlan {
  readonly policy: SkillUsagePlanPolicy;
  readonly planningInstruction: string;
  readonly deterministicDefinition: WorkflowDefinition;
  readonly selectedTaskOperation: SelectedTaskOperation;
}

export type UgvMoveWorkflowErrorCode =
  | 'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID'
  | 'UGV_MOVE_WORKFLOW_SELECTED_OPERATION_INVALID'
  | 'UGV_MOVE_WORKFLOW_SELECTED_OPERATION_STALE'
  | 'UGV_MOVE_WORKFLOW_IDENTITY_INVALID'
  | 'UGV_MOVE_WORKFLOW_TOPOLOGY_INVALID'
  | 'UGV_MOVE_WORKFLOW_CONTEXT_GATE_INVALID'
  | 'UGV_MOVE_WORKFLOW_TOOL_BINDING_INVALID'
  | 'UGV_MOVE_WORKFLOW_TASK_EXECUTION_INVALID'
  | 'UGV_MOVE_WORKFLOW_FORBIDDEN_NODE'
  | 'UGV_MOVE_WORKFLOW_FORBIDDEN_OPERATION'
  | 'UGV_MOVE_WORKFLOW_EVIDENCE_GATE_INVALID'
  | 'UGV_MOVE_WORKFLOW_RESULT_MAPPING_INVALID';

export class UgvMoveWorkflowError extends Error {
  constructor(
    readonly code: UgvMoveWorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveWorkflowError';
  }
}

/** Adds the authority-frozen state read to the complete formal Skill Usage tool policy. */
export function prepareUgvMoveWorkflowPlan(
  input: PrepareUgvMoveWorkflowInput,
): PreparedUgvMoveWorkflowPlan {
  const selected = rebuildSelectedTaskOperation(input.selectedTaskOperation);
  assertExactSkillVersion(input.skill, selected);
  const prepared = prepareSkillUsagePlan({
    skill: input.skill,
    candidate: input.candidate,
    interpretation: input.interpretation,
    goalContract: input.goalContract,
    workflowDefinitionId: input.workflowDefinitionId,
    workflowVersion: input.workflowVersion,
  });
  assertExactBasePolicy(prepared.policy, selected);
  if (prepared.deterministicDefinition === undefined)
    invalid(
      'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID',
      'UGV movement requires a formal template or procedure interpretation.',
    );

  const policy = snapshotSkillUsagePlanPolicy({
    ...prepared.policy,
    allowedTools: Object.freeze([
      ...prepared.policy.allowedTools,
      Object.freeze({
        serverId: selected.finalStateRead.serverId,
        toolName: selected.finalStateRead.operationName,
      }),
    ]),
  });
  const deterministicDefinition = buildUgvMoveWorkflowDefinition({
    goalContract: input.goalContract,
    workflowDefinitionId: input.workflowDefinitionId,
    workflowVersion: input.workflowVersion,
    policy,
    selected,
  });
  const planning = parsePlanningInstruction(prepared.planningInstruction);
  const planningInstruction = JSON.stringify({
    ...planning,
    skillUsagePolicy: policy,
    ugvProfileAuthority: {
      profileId: selected.profileId,
      selectedTaskOperationHash: selected.snapshotHash,
      navigateArgumentsHash: selected.argumentsHash,
      finalStateArgumentsHash: selected.finalStateRead.argumentsHash,
      instruction:
        'Use only the supplied deterministic Workflow definition through WorkflowPlannerService.',
    },
  });
  return Object.freeze({
    policy,
    planningInstruction,
    deterministicDefinition,
    selectedTaskOperation: selected,
  });
}

export interface UgvMoveWorkflowCandidateGuardInput {
  readonly selectedTaskOperation: SelectedTaskOperation;
  readonly skillUsagePolicy: SkillUsagePlanPolicy;
  readonly taskId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly clock: Clock;
}

/** Profile-only admission. The generic catalog/Planner matching rules remain unchanged. */
export class UgvMoveWorkflowCandidateGuard implements WorkflowCandidateGuard {
  readonly #selected: SelectedTaskOperation;
  readonly #policy: SkillUsagePlanPolicy;
  readonly #taskId: string;
  readonly #workflowDefinitionId: string;
  readonly #workflowVersion: number;
  readonly #goalId: string;
  readonly #goalVersion: number;
  readonly #clock: Clock;

  constructor(input: UgvMoveWorkflowCandidateGuardInput) {
    this.#selected = rebuildSelectedTaskOperation(input.selectedTaskOperation);
    this.#policy = snapshotSkillUsagePlanPolicy(input.skillUsagePolicy);
    this.#taskId = nonEmpty(input.taskId, 'Task ID');
    this.#workflowDefinitionId = nonEmpty(input.workflowDefinitionId, 'Workflow definition ID');
    this.#workflowVersion = positiveInteger(input.workflowVersion, 'Workflow version');
    this.#goalId = nonEmpty(input.goalId, 'Goal ID');
    this.#goalVersion = positiveInteger(input.goalVersion, 'Goal version');
    this.#clock = input.clock;
    assertExactDerivedPolicy(this.#policy, this.#selected);
  }

  validate(
    input: Readonly<{
      definition: WorkflowDefinition;
      taskId?: string;
      skillUsagePolicy?: SkillUsagePlanPolicy;
      compositionRoot?: SkillCompositionRoot;
    }>,
  ): readonly WorkflowCandidateGuardError[] {
    try {
      const now = timestamp(this.#clock.now(), 'guard time');
      if (Date.parse(this.#selected.availability.validUntil) <= Date.parse(now))
        invalid(
          'UGV_MOVE_WORKFLOW_SELECTED_OPERATION_STALE',
          'The selected UGV operation expired before Workflow admission.',
        );
      if (input.taskId !== this.#taskId)
        invalid(
          'UGV_MOVE_WORKFLOW_IDENTITY_INVALID',
          'The Workflow candidate is not bound to the exact Task.',
        );
      if (
        input.definition.workflowDefinitionId !== this.#workflowDefinitionId ||
        input.definition.version !== this.#workflowVersion ||
        input.definition.goalId !== this.#goalId ||
        input.definition.goalVersion !== this.#goalVersion
      )
        invalid(
          'UGV_MOVE_WORKFLOW_IDENTITY_INVALID',
          'The Workflow identity does not match the immutable planning request.',
        );
      if (
        input.compositionRoot !== undefined &&
        (input.compositionRoot.skillId !== UGV_MOVE_SKILL.skillId ||
          input.compositionRoot.skillVersion !== UGV_MOVE_SKILL.skillVersion)
      )
        invalid(
          'UGV_MOVE_WORKFLOW_IDENTITY_INVALID',
          'The composition root does not match embodied.move_to@1.',
        );
      if (
        input.skillUsagePolicy === undefined ||
        !sameJson(input.skillUsagePolicy, this.#policy) ||
        !sameJson(input.definition.skillUsagePolicy, this.#policy)
      )
        invalid(
          'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID',
          'The candidate replaced or omitted its exact Skill Usage authority.',
        );
      assertUgvMoveWorkflowContract(input.definition, this.#selected);
      return Object.freeze([]);
    } catch (error: unknown) {
      if (error instanceof UgvMoveWorkflowError)
        return Object.freeze([
          Object.freeze({ code: error.code, path: 'definition', message: error.message }),
        ]);
      throw error;
    }
  }
}

export function assertUgvMoveWorkflowContract(
  definition: WorkflowDefinition,
  selectedInput: SelectedTaskOperation,
): void {
  const selected = rebuildSelectedTaskOperation(selectedInput);
  const nodes = definition.nodes;
  const edges = definition.edges;
  if (
    nodes.some((node) => FORBIDDEN_NODE_TYPES.has(node.type)) ||
    nodes.some((node) => node.type === 'human_confirmation')
  )
    invalid(
      'UGV_MOVE_WORKFLOW_FORBIDDEN_NODE',
      'The UGV Workflow cannot contain a second confirmation, model, composition, or control node.',
    );
  const forbidden = nodes.find(
    (node) => node.type === 'mcp_tool' && FORBIDDEN_OPERATION_NAMES.has(node.tool.toolName),
  );
  if (forbidden !== undefined)
    invalid(
      'UGV_MOVE_WORKFLOW_FORBIDDEN_OPERATION',
      'The UGV Workflow contains an operation outside point navigation and evidence reads.',
    );
  if (
    nodes.length !== 9 ||
    definition.entryNodeId !== UGV_MOVE_WORKFLOW_NODE_IDS.initialState ||
    !sameJson(definition.exitNodeIds, [
      UGV_MOVE_WORKFLOW_NODE_IDS.success,
      UGV_MOVE_WORKFLOW_NODE_IDS.failure,
    ]) ||
    !sameJson(edges, expectedEdges())
  )
    invalid(
      'UGV_MOVE_WORKFLOW_TOPOLOGY_INVALID',
      'The UGV Workflow must preserve initial read, three gates, one Task, final read and evidence gate.',
    );
  assertContextGates(nodes);
  assertToolBindings(nodes, selected);
  assertEvidenceAndResults(nodes);
}

function buildUgvMoveWorkflowDefinition(
  input: Readonly<{
    goalContract: GoalExecutionContract;
    workflowDefinitionId: string;
    workflowVersion: number;
    policy: SkillUsagePlanPolicy;
    selected: SelectedTaskOperation;
  }>,
): WorkflowDefinition {
  const node = UGV_MOVE_WORKFLOW_NODE_IDS;
  const stateTool = Object.freeze({
    serverId: input.selected.finalStateRead.serverId,
    toolName: input.selected.finalStateRead.operationName,
  });
  const nodes: readonly WorkflowNode[] = Object.freeze([
    Object.freeze({
      nodeId: node.initialState,
      name: 'Read authoritative initial UGV state',
      type: 'mcp_tool' as const,
      tool: stateTool,
      arguments: input.selected.finalStateRead.resolvedArguments as WorkflowBoundValue,
    }),
    contextNode(node.currentPosition, 'Require current-position context', 'current-position'),
    contextNode(node.resourceState, 'Require resource-state context', 'resource-state'),
    contextNode(node.permissionContext, 'Require permission context', 'permission-context'),
    Object.freeze({
      nodeId: node.navigate,
      name: 'Dispatch exactly one governed point-navigation Task',
      type: 'mcp_tool' as const,
      tool: Object.freeze({
        serverId: input.selected.server.serverId,
        toolName: input.selected.operation.operationName,
      }),
      arguments: input.selected.resolvedArguments as WorkflowBoundValue,
      taskExecution: Object.freeze({
        protocolMode: 'frozen_v1' as const,
        availabilityCheck: 'required' as const,
        ...(input.selected.availability.reservationRef === undefined
          ? {}
          : { reservationRef: input.selected.availability.reservationRef }),
      }),
    }),
    Object.freeze({
      nodeId: node.finalState,
      name: 'Read authoritative final UGV state after continuation',
      type: 'mcp_tool' as const,
      tool: stateTool,
      arguments: input.selected.finalStateRead.resolvedArguments as WorkflowBoundValue,
    }),
    Object.freeze({
      nodeId: node.finalPosition,
      name: 'Require verified final-position evidence',
      type: 'condition' as const,
      expression: Object.freeze({
        op: 'exists' as const,
        path: Object.freeze(['evidence', 'position.observation']),
      }),
    }),
    Object.freeze({
      nodeId: node.success,
      name: 'Return schema-valid UGV Skill result after final-position evidence',
      type: 'result' as const,
      value: Object.freeze({
        op: 'ref' as const,
        path: Object.freeze([
          'nodes',
          UGV_MOVE_WORKFLOW_NODE_IDS.finalState,
          'data',
          'metadata',
          'ugvSkillResult',
        ]),
      }),
    }),
    Object.freeze({
      nodeId: node.failure,
      name: 'Fail the governed UGV move',
      type: 'result' as const,
      value: Object.freeze({ op: 'literal' as const, value: false }),
    }),
  ]);
  return Object.freeze({
    workflowDefinitionId: input.workflowDefinitionId,
    version: input.workflowVersion,
    goalId: input.goalContract.goalId,
    goalVersion: input.goalContract.version,
    entryNodeId: node.initialState,
    exitNodeIds: Object.freeze([node.success, node.failure]),
    nodes,
    edges: Object.freeze(expectedEdges()),
    skillUsagePolicy: input.policy,
  });
}

function contextNode(nodeId: string, name: string, requirementId: string): WorkflowNode {
  return Object.freeze({
    nodeId,
    name,
    type: 'condition' as const,
    expression: Object.freeze({
      op: 'ref' as const,
      path: Object.freeze(['context', requirementId]),
    }),
  });
}

function expectedEdges(): readonly WorkflowEdge[] {
  const node = UGV_MOVE_WORKFLOW_NODE_IDS;
  return [
    { sourceNodeId: node.initialState, targetNodeId: node.currentPosition },
    { sourceNodeId: node.currentPosition, targetNodeId: node.resourceState, outcome: 'true' },
    { sourceNodeId: node.currentPosition, targetNodeId: node.failure, outcome: 'false' },
    { sourceNodeId: node.resourceState, targetNodeId: node.permissionContext, outcome: 'true' },
    { sourceNodeId: node.resourceState, targetNodeId: node.failure, outcome: 'false' },
    { sourceNodeId: node.permissionContext, targetNodeId: node.navigate, outcome: 'true' },
    { sourceNodeId: node.permissionContext, targetNodeId: node.failure, outcome: 'false' },
    { sourceNodeId: node.navigate, targetNodeId: node.finalState },
    { sourceNodeId: node.finalState, targetNodeId: node.finalPosition },
    { sourceNodeId: node.finalPosition, targetNodeId: node.success, outcome: 'true' },
    { sourceNodeId: node.finalPosition, targetNodeId: node.failure, outcome: 'false' },
  ];
}

function assertContextGates(nodes: readonly WorkflowNode[]): void {
  const expected = [
    [UGV_MOVE_WORKFLOW_NODE_IDS.currentPosition, 'current-position'],
    [UGV_MOVE_WORKFLOW_NODE_IDS.resourceState, 'resource-state'],
    [UGV_MOVE_WORKFLOW_NODE_IDS.permissionContext, 'permission-context'],
  ] as const;
  if (
    expected.some(([nodeId, requirementId]) => {
      const node = nodes.find((candidate) => candidate.nodeId === nodeId);
      return (
        node?.type !== 'condition' ||
        !sameJson(node.expression, { op: 'ref', path: ['context', requirementId] })
      );
    })
  )
    invalid(
      'UGV_MOVE_WORKFLOW_CONTEXT_GATE_INVALID',
      'All three exact embodied.move_to@1 context requirements must fail to the common failure exit.',
    );
}

function assertToolBindings(nodes: readonly WorkflowNode[], selected: SelectedTaskOperation): void {
  const tools = nodes.filter(
    (node): node is Extract<WorkflowNode, { type: 'mcp_tool' }> => node.type === 'mcp_tool',
  );
  const initial = tools.find((node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.initialState);
  const navigate = tools.find((node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.navigate);
  const final = tools.find((node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.finalState);
  if (
    tools.length !== 3 ||
    initial === undefined ||
    navigate === undefined ||
    final === undefined ||
    initial.tool.serverId !== selected.finalStateRead.serverId ||
    initial.tool.toolName !== STATE_OPERATION ||
    initial.taskExecution !== undefined ||
    hashCanonicalEvidenceJson(initial.arguments) !== selected.finalStateRead.argumentsHash ||
    final.tool.serverId !== selected.finalStateRead.serverId ||
    final.tool.toolName !== STATE_OPERATION ||
    final.taskExecution !== undefined ||
    hashCanonicalEvidenceJson(final.arguments) !== selected.finalStateRead.argumentsHash ||
    navigate.tool.serverId !== selected.server.serverId ||
    navigate.tool.toolName !== NAVIGATE_OPERATION ||
    hashCanonicalEvidenceJson(navigate.arguments) !== selected.argumentsHash
  )
    invalid(
      'UGV_MOVE_WORKFLOW_TOOL_BINDING_INVALID',
      'The UGV Workflow requires two exact state reads around one authority-frozen point Task.',
    );
  const expectedTaskExecution = {
    protocolMode: 'frozen_v1',
    availabilityCheck: 'required',
    ...(selected.availability.reservationRef === undefined
      ? {}
      : { reservationRef: selected.availability.reservationRef }),
  };
  if (!sameJson(navigate.taskExecution, expectedTaskExecution))
    invalid(
      'UGV_MOVE_WORKFLOW_TASK_EXECUTION_INVALID',
      'The navigation node must preserve exact TASK_REQUIRED frozen-v1 execution authority.',
    );
  const argumentsValue = record(navigate.arguments);
  const mission = record(argumentsValue?.['mission']);
  if (
    argumentsValue?.['resourceId'] !== selected.resource.resourceId ||
    argumentsValue['stopOnObstacle'] !== true ||
    mission?.['type'] !== 'point'
  )
    invalid(
      'UGV_MOVE_WORKFLOW_TOOL_BINDING_INVALID',
      'The navigation node must preserve exact resource, point mission and stop-on-obstacle input.',
    );
}

function assertEvidenceAndResults(nodes: readonly WorkflowNode[]): void {
  const gate = nodes.find((node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.finalPosition);
  if (
    gate?.type !== 'condition' ||
    !sameJson(gate.expression, { op: 'exists', path: ['evidence', 'position.observation'] })
  )
    invalid(
      'UGV_MOVE_WORKFLOW_EVIDENCE_GATE_INVALID',
      'UGV success requires the exact position.observation hard gate after the final read.',
    );
  const success = nodes.find((node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.success);
  const failure = nodes.find((node) => node.nodeId === UGV_MOVE_WORKFLOW_NODE_IDS.failure);
  if (
    success?.type !== 'result' ||
    !sameJson(success.value, {
      op: 'ref',
      path: ['nodes', UGV_MOVE_WORKFLOW_NODE_IDS.finalState, 'data', 'metadata', 'ugvSkillResult'],
    }) ||
    failure?.type !== 'result' ||
    !sameJson(failure.value, { op: 'literal', value: false })
  )
    invalid(
      'UGV_MOVE_WORKFLOW_RESULT_MAPPING_INVALID',
      'UGV results must return the schema-valid final-state projection or the single failure value.',
    );
}

function assertExactBasePolicy(
  policy: SkillUsagePlanPolicy,
  selected: SelectedTaskOperation,
): void {
  const task = policy.taskOperations[0];
  const evidence = policy.evidenceRequirements[0];
  const readiness = policy.readiness.bindings[0];
  if (
    policy.skill.skillId !== UGV_MOVE_SKILL.skillId ||
    policy.skill.skillVersion !== UGV_MOVE_SKILL.skillVersion ||
    (policy.mode !== 'template' && policy.mode !== 'procedure') ||
    !policy.modeDecision.confirmationRequired ||
    policy.modeDecision.confirmationSatisfied ||
    !sameJson(policy.constraints, REQUIRED_CONSTRAINTS) ||
    !sameJson(policy.forbiddenActions, REQUIRED_FORBIDDEN_ACTIONS) ||
    !sameJson(policy.requiredConfirmations, REQUIRED_CONFIRMATIONS) ||
    !sameJson(policy.requiredContextIds, REQUIRED_CONTEXT_IDS) ||
    !hasExactUgvMoveSkillUsageContextEvidence(policy.context) ||
    policy.allowedTools.length !== 1 ||
    policy.allowedTools[0]?.serverId !== selected.server.serverId ||
    policy.allowedTools[0].toolName !== selected.operation.operationName ||
    policy.taskOperations.length !== 1 ||
    task?.bindingId !== selected.task.skillBindingId ||
    task.taskType !== selected.task.semanticTaskType ||
    task.providerId !== selected.server.serverId ||
    task.operationName !== selected.operation.operationName ||
    policy.childPolicies.length !== 0 ||
    policy.evidenceRequirements.length !== 1 ||
    evidence?.requirementId !== 'final-position' ||
    evidence.evidenceType !== 'position.observation' ||
    !evidence.required ||
    !evidence.hardGate ||
    !policy.rejectSuccessWithoutRequiredEvidence ||
    policy.readiness.overall !== 'ready' ||
    policy.readiness.bindings.length !== 1 ||
    readiness?.bindingId !== selected.task.skillBindingId ||
    readiness.disposition !== 'ready' ||
    readiness.selectedProviderId !== selected.server.serverId ||
    readiness.selectedOperationName !== selected.operation.operationName
  )
    invalid(
      'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID',
      'UGV planning requires the exact selected embodied.move_to@1 Usage authority.',
    );
}

function assertExactSkillVersion(skill: SkillVersion, selected: SelectedTaskOperation): void {
  const usage = skill.usageSpecification;
  const binding = usage?.taskBindings[0];
  const providerPolicy = binding?.providerPolicy;
  const evidence = usage?.evidencePolicy.requirements[0];
  const outcome = skill.outcomeSpecification;
  if (
    skill.skillId !== UGV_MOVE_SKILL.skillId ||
    skill.version !== UGV_MOVE_SKILL.skillVersion ||
    skill.skillId !== selected.skill.skillId ||
    skill.version !== selected.skill.version ||
    skill.status !== 'enabled' ||
    !skill.validationPassed ||
    skill.toolPolicy.required.length !== 0 ||
    skill.toolPolicy.optional.length !== 0 ||
    skill.toolPolicy.forbidden.length !== 0 ||
    skill.runtimePolicy.autoConfirmPlan ||
    skill.runtimePolicy.maxMcpCalls !== 8 ||
    usage === undefined ||
    !sameJson(usage.normative.constraints, REQUIRED_CONSTRAINTS) ||
    !sameJson(usage.normative.forbiddenActions, REQUIRED_FORBIDDEN_ACTIONS) ||
    !sameJson(usage.normative.requiredConfirmations, REQUIRED_CONFIRMATIONS) ||
    usage.contextRequirements.length !== 3 ||
    !exactContextRequirement(usage.contextRequirements[0], 'current-position', [
      'authoritative_context',
      'read_only_query',
    ]) ||
    !exactContextRequirement(usage.contextRequirements[1], 'resource-state', [
      'authoritative_context',
      'read_only_query',
    ]) ||
    !exactContextRequirement(usage.contextRequirements[2], 'permission-context', [
      'authoritative_context',
      'user_input',
    ]) ||
    usage.taskBindings.length !== 1 ||
    binding?.bindingId !== selected.task.skillBindingId ||
    binding.taskType !== selected.task.semanticTaskType ||
    providerPolicy?.selection !== 'dynamic' ||
    providerPolicy.preferredProviderIds.length !== 0 ||
    providerPolicy.requiredProviderId !== undefined ||
    providerPolicy.forbiddenProviderIds.length !== 0 ||
    !sameJson(providerPolicy.requiredAttributes, ['observations', 'task_notifications']) ||
    usage.adaptive.allowPreferredProviderFallback ||
    usage.evidencePolicy.requirements.length !== 1 ||
    evidence?.requirementId !== 'final-position' ||
    evidence.evidenceType !== 'position.observation' ||
    !evidence.required ||
    !evidence.hardGate ||
    !usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    outcome?.effects.length !== 1 ||
    outcome.effects[0] !== 'effect.final_position' ||
    outcome.evidence.length !== 1 ||
    outcome.evidence[0] !== 'evidence.final_position'
  )
    invalid(
      'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID',
      'Workflow preparation requires the exact enabled embodied.move_to@1 package contract.',
    );
}

function exactContextRequirement(
  value: NonNullable<SkillVersion['usageSpecification']>['contextRequirements'][number] | undefined,
  requirementId: string,
  sourceOrder: readonly string[],
): boolean {
  return (
    value?.requirementId === requirementId &&
    value.required &&
    sameJson(value.sourceOrder, sourceOrder)
  );
}

function assertExactDerivedPolicy(
  policy: SkillUsagePlanPolicy,
  selected: SelectedTaskOperation,
): void {
  const { allowedTools, ...base } = policy;
  assertExactBasePolicy(
    {
      ...base,
      allowedTools: [
        { serverId: selected.server.serverId, toolName: selected.operation.operationName },
      ],
    },
    selected,
  );
  if (
    allowedTools.length !== 2 ||
    allowedTools[0]?.serverId !== selected.server.serverId ||
    allowedTools[0].toolName !== selected.operation.operationName ||
    allowedTools[1]?.serverId !== selected.finalStateRead.serverId ||
    allowedTools[1].toolName !== selected.finalStateRead.operationName
  )
    invalid(
      'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID',
      'UGV derived policy must preserve the selected Task operation and exact state-read operation.',
    );
}

function rebuildSelectedTaskOperation(value: SelectedTaskOperation): SelectedTaskOperation {
  const { snapshotHash, ...draft } = value;
  let rebuilt: SelectedTaskOperation;
  try {
    rebuilt = createSelectedTaskOperation(draft);
  } catch {
    return invalid(
      'UGV_MOVE_WORKFLOW_SELECTED_OPERATION_INVALID',
      'The Workflow requires a valid immutable SelectedTaskOperation.',
    );
  }
  if (rebuilt.snapshotHash !== snapshotHash)
    invalid(
      'UGV_MOVE_WORKFLOW_SELECTED_OPERATION_INVALID',
      'The SelectedTaskOperation self-hash does not match its payload.',
    );
  return rebuilt;
}

function parsePlanningInstruction(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    const result = record(parsed);
    if (result !== undefined) return result;
  } catch {
    // The formal Skill Usage planner currently emits JSON; fail closed if that authority changes.
  }
  return invalid(
    'UGV_MOVE_WORKFLOW_SKILL_USAGE_INVALID',
    'The formal Skill Usage planning instruction is not a JSON object.',
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return hashCanonicalEvidenceJson(left) === hashCanonicalEvidenceJson(right);
}

function timestamp(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds))
    invalid('UGV_MOVE_WORKFLOW_IDENTITY_INVALID', `${label} must be an RFC 3339 timestamp.`);
  return new Date(milliseconds).toISOString();
}

function nonEmpty(value: string, label: string): string {
  const result = value.trim();
  if (result === '') invalid('UGV_MOVE_WORKFLOW_IDENTITY_INVALID', `${label} must be non-empty.`);
  return result;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    invalid('UGV_MOVE_WORKFLOW_IDENTITY_INVALID', `${label} must be a positive integer.`);
  return value;
}

function invalid(code: UgvMoveWorkflowErrorCode, message: string): never {
  throw new UgvMoveWorkflowError(code, message);
}
