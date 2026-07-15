import type { SkillVersion, WorkflowPlanRecord } from '../../domain/src/index.js';

import type { McpToolPlanningMetadata } from './mcp-tool-enhancer.js';
import type {
  Clock,
  JsonSchemaValidator,
  SkillCallWorkflowRepository,
  SkillRepository,
} from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';
import type { WorkflowPlannerService } from './workflow-planner.js';
import type { WorkflowValidator } from './workflow-validator.js';

export const MAX_SKILL_CALL_DEPTH = 8;

export class SkillCallWorkflowService {
  readonly #skills: SkillRepository;
  readonly #planner: Pick<WorkflowPlannerService, 'plan'>;
  readonly #validator: Pick<WorkflowValidator, 'validate'>;
  readonly #execution: Pick<WorkflowExecutionService, 'confirm' | 'execute'>;
  readonly #records: SkillCallWorkflowRepository;
  readonly #schemas: JsonSchemaValidator;
  readonly #toolPlanningMetadata: (
    skill: SkillVersion,
  ) => Promise<readonly McpToolPlanningMetadata[]>;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      skills: SkillRepository;
      planner: Pick<WorkflowPlannerService, 'plan'>;
      validator: Pick<WorkflowValidator, 'validate'>;
      execution: Pick<WorkflowExecutionService, 'confirm' | 'execute'>;
      records: SkillCallWorkflowRepository;
      schemas: JsonSchemaValidator;
      loadToolPlanningMetadata: (
        skill: SkillVersion,
      ) => Promise<readonly McpToolPlanningMetadata[]>;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#planner = dependencies.planner;
    this.#validator = dependencies.validator;
    this.#execution = dependencies.execution;
    this.#records = dependencies.records;
    this.#schemas = dependencies.schemas;
    this.#toolPlanningMetadata = dependencies.loadToolPlanningMetadata;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async execute(
    input: Readonly<{
      skillId: string;
      value: unknown;
      parentInstanceId: string;
      parentNodeId: string;
      parentGoalId: string;
      parentGoalVersion: number;
      signal?: AbortSignal;
    }>,
  ): Promise<unknown> {
    const skill = await this.#skills.findCurrentVersion(input.skillId);
    if (skill?.status !== 'enabled') throw new Error('WORKFLOW_SKILL_NOT_ENABLED');
    const inputValidation = this.#schemas.validate(skill.inputSchema, input.value);
    if (!inputValidation.valid)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_INPUT_INVALID',
        `Resolved input does not satisfy ${skill.skillId}@${String(skill.version)}: ${inputValidation.errors.join('; ')}`,
      );

    const callId = this.#nextId();
    const childPlanId = `plan-skill-call-${callId}`;
    const childInstanceId = `instance-skill-call-${callId}`;
    const childWorkflowDefinitionId = `workflow-skill-${skill.skillId}-${String(skill.version)}-${callId}`;
    const createdAt = this.#clock.now();
    const toolPlanningMetadata = await this.#toolPlanningMetadata(skill);
    const plan = await this.#planner.plan({
      planId: childPlanId,
      workflowDefinitionId: childWorkflowDefinitionId,
      workflowVersion: skill.version,
      goalId: input.parentGoalId,
      goalVersion: input.parentGoalVersion,
      planningInstruction: childPlanningInstruction(
        skill,
        input.value,
        toolPlanningMetadata,
        childWorkflowDefinitionId,
        input.parentGoalId,
        input.parentGoalVersion,
      ),
    });
    const definition = await this.#requireValidatedDefinition(plan);

    // v1.0.2 preserves the accepted parent-covered confirmation behavior. The complete
    // transitive nested-confirmation policy is intentionally finalized by v1.0.5.
    await this.#execution.confirm(childPlanId);
    const child = await this.#execution.execute({
      instanceId: childInstanceId,
      planId: childPlanId,
      input: input.value,
      skillIds: [skill.skillId],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (child.status !== 'succeeded') {
      await this.#records.save({
        parentInstanceId: input.parentInstanceId,
        parentNodeId: input.parentNodeId,
        childInstanceId,
        childPlanId,
        skillId: skill.skillId,
        skillVersion: skill.version,
        status: child.status === 'canceled' ? 'canceled' : 'failed',
        evaluationSummary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} ended with ${child.status}.`,
        createdAt,
        completedAt: child.completedAt ?? this.#clock.now(),
      });
      throw new SkillCallWorkflowError(
        child.status === 'canceled'
          ? 'WORKFLOW_SKILL_CHILD_CANCELED'
          : 'WORKFLOW_SKILL_CHILD_FAILED',
        `Skill child Workflow ended with ${child.status}.`,
      );
    }

    const outputValidation = this.#schemas.validate(skill.outputSchema, child.result);
    if (!outputValidation.valid) {
      await this.#records.save({
        parentInstanceId: input.parentInstanceId,
        parentNodeId: input.parentNodeId,
        childInstanceId,
        childPlanId,
        skillId: skill.skillId,
        skillVersion: skill.version,
        status: 'failed',
        evaluationSummary: `Skill output failed ${skill.skillId}@${String(skill.version)} schema validation: ${outputValidation.errors.join('; ')}`,
        createdAt,
        completedAt: child.completedAt ?? this.#clock.now(),
      });
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_OUTPUT_INVALID',
        `Child result does not satisfy ${skill.skillId}@${String(skill.version)}: ${outputValidation.errors.join('; ')}`,
      );
    }

    await this.#records.save({
      parentInstanceId: input.parentInstanceId,
      parentNodeId: input.parentNodeId,
      childInstanceId,
      childPlanId,
      skillId: skill.skillId,
      skillVersion: skill.version,
      status: 'succeeded',
      evaluationSummary: `Skill output passed ${skill.skillId}@${String(skill.version)} schema validation after executing ${definition.workflowDefinitionId}@${String(definition.version)}.`,
      createdAt,
      completedAt: child.completedAt ?? this.#clock.now(),
    });
    return child.result;
  }

  async #requireValidatedDefinition(plan: WorkflowPlanRecord) {
    if (plan.definition === undefined)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CHILD_PLAN_INVALID',
        'Child Workflow planner returned no executable definition.',
      );
    const validation = await this.#validator.validate(plan.definition);
    if (!validation.valid || validation.definition === undefined)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CHILD_PLAN_INVALID',
        `Child Workflow failed validation: ${validation.errors.map((error) => `${error.code} at ${error.path}`).join('; ')}`,
      );
    return validation.definition;
  }
}

export function nextSkillCallAncestry(
  ancestry: readonly string[],
  skillId: string,
): readonly string[] {
  if (ancestry.includes(skillId))
    throw new SkillCallWorkflowError(
      'WORKFLOW_SKILL_RECURSION_INVALID',
      `Recursive Skill call detected for ${skillId}: ${[...ancestry, skillId].join(' -> ')}.`,
    );
  if (ancestry.length >= MAX_SKILL_CALL_DEPTH)
    throw new SkillCallWorkflowError(
      'WORKFLOW_SKILL_DEPTH_EXCEEDED',
      `Skill call depth exceeds the maximum of ${String(MAX_SKILL_CALL_DEPTH)}.`,
    );
  return Object.freeze([...ancestry, skillId]);
}

function childPlanningInstruction(
  skill: SkillVersion,
  resolvedInput: unknown,
  toolPlanningMetadata: readonly McpToolPlanningMetadata[],
  workflowDefinitionId: string,
  goalId: string,
  goalVersion: number,
): string {
  return JSON.stringify({
    operation: 'skill_call_child_plan',
    workflowIdentity: {
      workflowDefinitionId,
      version: skill.version,
      goalId,
      goalVersion,
    },
    selectedSkill: {
      skillId: skill.skillId,
      version: skill.version,
      name: skill.name,
      description: skill.description,
      workflowGuidance: skill.workflowGuidance,
      inputSchema: skill.inputSchema,
      outputSchema: skill.outputSchema,
      toolPolicy: skill.toolPolicy,
      runtimePolicy: skill.runtimePolicy,
    },
    resolvedInput,
    toolPlanningMetadata,
    constraints: [
      'Use only the restricted Workflow DSL and the listed current MCP Tool contracts.',
      'Bind runtime input or node outputs with exact {op:"ref",path:[...]} values.',
      'Return a result that satisfies the selected Skill outputSchema.',
    ],
  });
}

export type SkillCallWorkflowErrorCode =
  | 'WORKFLOW_SKILL_INPUT_INVALID'
  | 'WORKFLOW_SKILL_OUTPUT_INVALID'
  | 'WORKFLOW_SKILL_CHILD_PLAN_INVALID'
  | 'WORKFLOW_SKILL_CHILD_FAILED'
  | 'WORKFLOW_SKILL_CHILD_CANCELED'
  | 'WORKFLOW_SKILL_RECURSION_INVALID'
  | 'WORKFLOW_SKILL_DEPTH_EXCEEDED';

export class SkillCallWorkflowError extends Error {
  readonly code: SkillCallWorkflowErrorCode;

  constructor(code: SkillCallWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'SkillCallWorkflowError';
    this.code = code;
  }
}
