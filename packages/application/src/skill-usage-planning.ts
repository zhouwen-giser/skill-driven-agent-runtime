import {
  createLegacySkillUsageProjection,
  type GoalExecutionContract,
  type SkillModeInterpretation,
  type SkillUsageCandidateSnapshot,
  type SkillUsagePlanComplianceError,
  type SkillUsagePlanComplianceResult,
  type SkillUsagePlanPolicy,
  type SkillVersion,
  type WorkflowDefinition,
  type WorkflowBoundValue,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../domain/src/index.js';

export interface PreparedSkillUsagePlan {
  readonly policy: SkillUsagePlanPolicy;
  readonly planningInstruction: string;
  readonly deterministicDefinition?: WorkflowDefinition;
}

export function prepareSkillUsagePlan(
  input: Readonly<{
    skill: SkillVersion;
    candidate: SkillUsageCandidateSnapshot;
    interpretation: SkillModeInterpretation;
    goalContract: GoalExecutionContract;
    workflowDefinitionId: string;
    workflowVersion: number;
  }>,
): PreparedSkillUsagePlan {
  if (
    input.candidate.skillId !== input.skill.skillId ||
    input.candidate.skillVersion !== input.skill.version ||
    input.candidate.modeDecision.decision !== 'selected' ||
    input.interpretation.skill.skillId !== input.skill.skillId ||
    input.interpretation.skill.skillVersion !== input.skill.version ||
    input.interpretation.kind !== input.candidate.modeDecision.mode
  )
    throw planningError(
      'SKILL_USAGE_PLANNING_IDENTITY_INVALID',
      'Planning requires one selected mode and exact Skill version.',
    );
  const usage =
    input.skill.usageSpecification ??
    createLegacySkillUsageProjection({
      workflowGuidance: input.skill.workflowGuidance,
      autoConfirmPlan: input.skill.runtimePolicy.autoConfirmPlan,
    }).specification;
  const taskOperations = usage.taskBindings.map((binding) => {
    const readiness = input.candidate.applicability.readiness.bindings.find(
      (item) => item.bindingId === binding.bindingId,
    );
    if (
      readiness?.selectedProviderId === undefined ||
      readiness.selectedOperationName === undefined ||
      (readiness.disposition !== 'ready' && readiness.disposition !== 'restricted')
    )
      throw planningError(
        'SKILL_USAGE_PLANNING_TASK_UNRESOLVED',
        `Task binding ${binding.bindingId} has no admissible selected Provider operation.`,
      );
    return Object.freeze({
      bindingId: binding.bindingId,
      taskType: binding.taskType,
      providerId: readiness.selectedProviderId,
      operationName: readiness.selectedOperationName,
    });
  });
  const policy: SkillUsagePlanPolicy = Object.freeze({
    skill: Object.freeze({ skillId: input.skill.skillId, skillVersion: input.skill.version }),
    mode: input.interpretation.kind,
    modeDecision: Object.freeze({
      ...input.candidate.modeDecision,
      reasonCodes: Object.freeze([...input.candidate.modeDecision.reasonCodes]),
    }),
    constraints: Object.freeze([...usage.normative.constraints]),
    forbiddenActions: Object.freeze([...usage.normative.forbiddenActions]),
    adaptiveInstructions: Object.freeze([
      ...usage.adaptive.instructions,
      ...input.interpretation.instructions,
    ]),
    requiredConfirmations: Object.freeze([...usage.normative.requiredConfirmations]),
    requiredContextIds: Object.freeze(
      usage.contextRequirements.filter((item) => item.required).map((item) => item.requirementId),
    ),
    allowedTools: Object.freeze(
      [...input.skill.toolPolicy.required, ...input.skill.toolPolicy.optional].map((item) =>
        Object.freeze({ ...item }),
      ),
    ),
    taskOperations: Object.freeze(taskOperations),
    childPolicies: Object.freeze(
      input.interpretation.composition.edges.map((edge) =>
        Object.freeze({
          edgeId: edge.edgeId,
          child: Object.freeze({ ...edge.child }),
          failurePolicy: edge.failurePolicy,
          inputMappings: Object.freeze(
            edge.inputMappings.map((item) => Object.freeze({ ...item })),
          ),
          outputMappings: Object.freeze(
            edge.outputMappings.map((item) => Object.freeze({ ...item })),
          ),
        }),
      ),
    ),
    evidenceRequirements: Object.freeze(
      usage.evidencePolicy.requirements.map((item) => Object.freeze({ ...item })),
    ),
    rejectSuccessWithoutRequiredEvidence: usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence,
    composition: input.interpretation.composition,
    context: input.candidate.applicability.context,
    readiness: input.candidate.applicability.readiness,
  });
  const planningInstruction = JSON.stringify({
    operation: 'plan_with_skill_usage_policy',
    goalContract: input.goalContract,
    skillUsagePolicy: policy,
    instruction:
      'Produce only the existing Workflow DSL. Deterministic policy is authoritative; explanations cannot satisfy compliance.',
  });
  return Object.freeze({
    policy,
    planningInstruction,
    ...(input.interpretation.kind === 'guidance'
      ? {}
      : {
          deterministicDefinition: compileDeterministicDefinition({
            policy,
            goalContract: input.goalContract,
            workflowDefinitionId: input.workflowDefinitionId,
            workflowVersion: input.workflowVersion,
          }),
        }),
  });
}

export function checkSkillUsagePlanCompliance(
  definition: WorkflowDefinition,
  policy: SkillUsagePlanPolicy,
  admittedLegacyChildSkillIds: readonly string[] = [],
): SkillUsagePlanComplianceResult {
  const errors: SkillUsagePlanComplianceError[] = [];
  const allowedTools = new Set([
    ...policy.allowedTools.map(toolKey),
    ...policy.taskOperations.map((item) => `${item.providerId}/${item.operationName}`),
  ]);
  const toolNodes = definition.nodes.filter((node) => node.type === 'mcp_tool');
  for (const node of toolNodes)
    if (!allowedTools.has(toolKey(node.tool)))
      error(
        errors,
        'SKILL_USAGE_TASK_OPERATION_FORBIDDEN',
        `nodes.${node.nodeId}.tool`,
        'Workflow Tool is outside the exact Skill Tool/Task operation allowlist.',
      );
  for (const task of policy.taskOperations)
    if (
      !toolNodes.some(
        (node) =>
          node.tool.serverId === task.providerId && node.tool.toolName === task.operationName,
      )
    )
      error(
        errors,
        'SKILL_USAGE_TASK_BINDING_MISSING',
        `taskBindings.${task.bindingId}`,
        'Selected Task binding is absent from the Workflow.',
      );

  const skillNodes = definition.nodes.filter((node) => node.type === 'skill_call');
  // A legacy projection has no v1.2 composition declaration. Preserve the existing
  // exact-version Skill Graph authority in that case; native fixed/slot composition
  // remains closed to its explicit decisions.
  const legacyGraphChildIds = policy.childPolicies.length === 0 ? admittedLegacyChildSkillIds : [];
  const allowedChildIds = new Set([
    ...policy.childPolicies.map((item) => item.child.skillId),
    ...legacyGraphChildIds,
  ]);
  for (const node of skillNodes)
    if (!allowedChildIds.has(node.skillId))
      error(
        errors,
        'SKILL_USAGE_CHILD_FORBIDDEN',
        `nodes.${node.nodeId}.skillId`,
        'Workflow child is outside the exact composition candidate decision.',
      );
  const childNodeBudget =
    policy.childPolicies.length === 0
      ? new Set(legacyGraphChildIds).size
      : policy.composition.consumedNodes;
  if (skillNodes.length > childNodeBudget)
    error(
      errors,
      'SKILL_USAGE_RECURSION_BUDGET_EXCEEDED',
      'nodes',
      'Workflow exceeds the exact bounded Skill composition expansion.',
    );
  for (const child of policy.childPolicies) {
    const call = skillNodes.find((node) => node.skillId === child.child.skillId);
    if (call === undefined) {
      error(
        errors,
        'SKILL_USAGE_CHILD_MISSING',
        `composition.${child.edgeId}`,
        'An exact composed child is absent from the Workflow.',
      );
      continue;
    }
    const handler = definition.nodes.find(
      (node): node is Extract<WorkflowNode, { type: 'error_handler' }> =>
        node.type === 'error_handler' && node.handledNodeId === call.nodeId,
    );
    if (handler === undefined || !failureHandlerMatches(handler, child.failurePolicy))
      error(
        errors,
        'SKILL_USAGE_FAILURE_POLICY_MISMATCH',
        `nodes.${call.nodeId}`,
        `Child call does not preserve ${child.failurePolicy} propagation.`,
      );
  }

  for (const requirement of policy.evidenceRequirements.filter(
    (item) => item.required && (item.hardGate || policy.rejectSuccessWithoutRequiredEvidence),
  )) {
    const gate = definition.nodes.find(
      (node) =>
        node.type === 'condition' &&
        node.expression.op === 'ref' &&
        node.expression.path.join('.') === `evidence.${requirement.requirementId}`,
    );
    const falseEdge =
      gate === undefined
        ? undefined
        : definition.edges.find(
            (edge) => edge.sourceNodeId === gate.nodeId && edge.outcome === 'false',
          );
    const falseTarget = definition.nodes.find((node) => node.nodeId === falseEdge?.targetNodeId);
    if (
      gate === undefined ||
      falseTarget?.type !== 'result' ||
      falseTarget.value.op !== 'literal' ||
      falseTarget.value.value !== false
    )
      error(
        errors,
        'SKILL_USAGE_EVIDENCE_HARD_GATE_MISSING',
        `evidence.${requirement.requirementId}`,
        'Required evidence lacks a structural false-to-failure hard gate.',
      );
  }
  for (const requirementId of policy.requiredContextIds)
    if (!hasFalseToFailureGate(definition, `context.${requirementId}`))
      error(
        errors,
        'SKILL_USAGE_CONTEXT_GATE_MISSING',
        `context.${requirementId}`,
        'Required context lacks a structural gate.',
      );
  return Object.freeze({ compliant: errors.length === 0, errors: Object.freeze(errors) });
}

function hasFalseToFailureGate(definition: WorkflowDefinition, referencePath: string): boolean {
  const gate = definition.nodes.find(
    (node) =>
      node.type === 'condition' &&
      node.expression.op === 'ref' &&
      node.expression.path.join('.') === referencePath,
  );
  const falseEdge =
    gate === undefined
      ? undefined
      : definition.edges.find(
          (edge) => edge.sourceNodeId === gate.nodeId && edge.outcome === 'false',
        );
  const target = definition.nodes.find((node) => node.nodeId === falseEdge?.targetNodeId);
  return target?.type === 'result' && target.value.op === 'literal' && target.value.value === false;
}

function compileDeterministicDefinition(
  input: Readonly<{
    policy: SkillUsagePlanPolicy;
    goalContract: GoalExecutionContract;
    workflowDefinitionId: string;
    workflowVersion: number;
  }>,
): WorkflowDefinition {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const primary: WorkflowNode[] = [];
  input.policy.requiredContextIds.forEach((requirementId, index) =>
    primary.push({
      nodeId: `usage_context_${String(index)}`,
      name: `Require context ${requirementId}`,
      type: 'condition',
      expression: { op: 'ref', path: ['context', requirementId] },
    }),
  );
  input.policy.childPolicies.forEach((child, index) =>
    primary.push({
      nodeId: `usage_child_${String(index)}`,
      name: `Call ${child.child.skillId}@${String(child.child.skillVersion)}`,
      type: 'skill_call',
      skillId: child.child.skillId,
      input: boundInput(child.inputMappings),
    }),
  );
  input.policy.taskOperations.forEach((task, index) =>
    primary.push({
      nodeId: `usage_task_${String(index)}`,
      name: `Execute ${task.bindingId}`,
      type: 'mcp_tool',
      tool: { serverId: task.providerId, toolName: task.operationName },
      arguments: { op: 'ref', path: ['input', 'skillInput'] },
      taskExecution: { mode: 'require_task', availabilityCheck: 'required' },
    }),
  );
  input.policy.evidenceRequirements
    .filter(
      (item) =>
        item.required && (item.hardGate || input.policy.rejectSuccessWithoutRequiredEvidence),
    )
    .forEach((requirement, index) =>
      primary.push({
        nodeId: `usage_evidence_${String(index)}`,
        name: `Require evidence ${requirement.requirementId}`,
        type: 'condition',
        expression: { op: 'ref', path: ['evidence', requirement.requirementId] },
      }),
    );
  const resultSource = [...primary]
    .reverse()
    .find((node) => node.type === 'mcp_tool' || node.type === 'skill_call');
  primary.push({
    nodeId: 'usage_success',
    name: 'Skill usage succeeded',
    type: 'result',
    value:
      resultSource?.type === 'mcp_tool'
        ? {
            op: 'ref',
            path: ['nodes', resultSource.nodeId, 'data', 'structuredContent'],
          }
        : resultSource?.type === 'skill_call'
          ? { op: 'ref', path: ['nodes', resultSource.nodeId] }
          : { op: 'literal', value: true },
  });
  const failure: WorkflowNode = {
    nodeId: 'usage_failure',
    name: 'Skill usage policy failed',
    type: 'result',
    value: { op: 'literal', value: false },
  };
  const hasEvidenceGate = primary.some((node) => node.type === 'condition');
  nodes.push(...primary, ...(hasEvidenceGate ? [failure] : []));
  for (let index = 0; index < primary.length - 1; index += 1) {
    const current = primary[index];
    const next = primary[index + 1];
    if (current === undefined || next === undefined) continue;
    if (current.type === 'condition') {
      edges.push(
        { sourceNodeId: current.nodeId, targetNodeId: next.nodeId, outcome: 'true' },
        { sourceNodeId: current.nodeId, targetNodeId: failure.nodeId, outcome: 'false' },
      );
    } else edges.push({ sourceNodeId: current.nodeId, targetNodeId: next.nodeId });
  }
  input.policy.childPolicies.forEach((child, index) => {
    const handledNodeId = `usage_child_${String(index)}`;
    const handledIndex = primary.findIndex((node) => node.nodeId === handledNodeId);
    const next = primary[handledIndex + 1] ?? primary.at(-1) ?? failure;
    nodes.push({
      nodeId: `usage_child_handler_${String(index)}`,
      name: `${child.failurePolicy} ${child.edgeId}`,
      type: 'error_handler',
      handledNodeId,
      skillFailurePolicy: child.failurePolicy,
      strategy:
        child.failurePolicy === 'fail_fast'
          ? 'terminate'
          : child.failurePolicy === 'recoverable'
            ? 'goto'
            : 'continue',
      ...(child.failurePolicy === 'recoverable' ? { gotoNodeId: next.nodeId } : {}),
    });
  });
  return Object.freeze({
    workflowDefinitionId: input.workflowDefinitionId,
    version: input.workflowVersion,
    goalId: input.goalContract.goalId,
    goalVersion: input.goalContract.version,
    entryNodeId: primary[0]?.nodeId ?? failure.nodeId,
    exitNodeIds: Object.freeze([
      primary.at(-1)?.nodeId ?? failure.nodeId,
      ...(hasEvidenceGate ? [failure.nodeId] : []),
    ]),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

function boundInput(
  mappings: SkillUsagePlanPolicy['childPolicies'][number]['inputMappings'],
): WorkflowBoundValue {
  if (mappings.length === 0) return { op: 'ref', path: ['input'] };
  return Object.fromEntries(
    mappings.map((mapping) => {
      const source = mapping.sourcePath.split('.');
      const path =
        source[0] === 'context' || source[0] === 'evidence'
          ? source
          : ['input', 'skillInput', ...source];
      return [mapping.targetPath.split('.')[0] ?? mapping.targetPath, { op: 'ref', path }];
    }),
  );
}

function failureHandlerMatches(
  handler: Extract<WorkflowNode, { type: 'error_handler' }>,
  policy: SkillUsagePlanPolicy['childPolicies'][number]['failurePolicy'],
): boolean {
  if (handler.skillFailurePolicy !== policy) return false;
  if (policy === 'fail_fast') return handler.strategy === 'terminate';
  if (policy === 'recoverable') return handler.strategy === 'goto';
  return handler.strategy === 'continue';
}

function toolKey(tool: Readonly<{ serverId: string; toolName: string }>): string {
  return `${tool.serverId}/${tool.toolName}`;
}

function error(
  errors: SkillUsagePlanComplianceError[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push(Object.freeze({ code, path, message }));
}

function planningError(code: SkillUsagePlanningErrorCode, message: string) {
  return new SkillUsagePlanningError(code, message);
}

export type SkillUsagePlanningErrorCode =
  'SKILL_USAGE_PLANNING_IDENTITY_INVALID' | 'SKILL_USAGE_PLANNING_TASK_UNRESOLVED';

export class SkillUsagePlanningError extends Error {
  readonly code: SkillUsagePlanningErrorCode;
  constructor(code: SkillUsagePlanningErrorCode, message: string) {
    super(message);
    this.name = 'SkillUsagePlanningError';
    this.code = code;
  }
}
