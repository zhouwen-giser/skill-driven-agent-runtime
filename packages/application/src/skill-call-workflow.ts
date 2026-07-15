import type { WorkflowPlanRecord } from '../../domain/src/index.js';

import type {
  Clock,
  JsonSchemaValidator,
  SkillCallWorkflowRepository,
  SkillRepository,
  WorkflowPlanRepository,
} from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';

export class SkillCallWorkflowService {
  readonly #skills: SkillRepository;
  readonly #plans: WorkflowPlanRepository;
  readonly #execution: Pick<WorkflowExecutionService, 'execute'>;
  readonly #records: SkillCallWorkflowRepository;
  readonly #clock: Clock;
  readonly #nextId: () => string;
  readonly #schemas: JsonSchemaValidator;

  constructor(
    dependencies: Readonly<{
      skills: SkillRepository;
      plans: WorkflowPlanRepository;
      execution: Pick<WorkflowExecutionService, 'execute'>;
      records: SkillCallWorkflowRepository;
      schemas: JsonSchemaValidator;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#plans = dependencies.plans;
    this.#execution = dependencies.execution;
    this.#records = dependencies.records;
    this.#schemas = dependencies.schemas;
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
    const createdAt = this.#clock.now();
    const plan: WorkflowPlanRecord = {
      planId: childPlanId,
      goalId: input.parentGoalId,
      goalVersion: input.parentGoalVersion,
      definition: {
        workflowDefinitionId: `workflow-skill-${skill.skillId}-${String(skill.version)}`,
        version: skill.version,
        goalId: input.parentGoalId,
        goalVersion: input.parentGoalVersion,
        entryNodeId: 'execute',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'execute',
            name: `Execute ${skill.name}`,
            type: 'llm',
            instruction: `${skill.workflowGuidance}\nInput: ${JSON.stringify(input.value)}`,
            responseSchema: skill.outputSchema,
          },
          {
            nodeId: 'result',
            name: `${skill.name} result`,
            type: 'result',
            value: { op: 'ref', path: ['nodes', 'execute'] },
          },
        ],
        edges: [{ sourceNodeId: 'execute', targetNodeId: 'result' }],
      },
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt,
    };
    await this.#plans.savePlan(plan);
    const child = await this.#execution.execute({
      instanceId: childInstanceId,
      planId: childPlanId,
      input: input.value,
      skillIds: [skill.skillId],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const status =
      child.status === 'succeeded'
        ? 'succeeded'
        : child.status === 'canceled'
          ? 'canceled'
          : 'failed';
    await this.#records.save({
      parentInstanceId: input.parentInstanceId,
      parentNodeId: input.parentNodeId,
      childInstanceId,
      childPlanId,
      skillId: skill.skillId,
      skillVersion: skill.version,
      status,
      evaluationSummary:
        status === 'succeeded'
          ? `Skill output passed ${skill.skillId}@${String(skill.version)} schema validation.`
          : `Skill child Workflow ended with ${child.status}.`,
      createdAt,
      completedAt: child.completedAt ?? this.#clock.now(),
    });
    if (child.status !== 'succeeded') throw new Error('WORKFLOW_SKILL_CHILD_FAILED');
    return child.result;
  }
}

export class SkillCallWorkflowError extends Error {
  readonly code: 'WORKFLOW_SKILL_INPUT_INVALID';

  constructor(code: 'WORKFLOW_SKILL_INPUT_INVALID', message: string) {
    super(message);
    this.name = 'SkillCallWorkflowError';
    this.code = code;
  }
}
