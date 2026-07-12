import { z } from 'zod';

import type {
  Goal,
  GoalEvaluationResult,
  ProcessedResultRecord,
  TaskQualityAssessment,
  TaskQualityComponent,
  TaskQualityReport,
  WorkflowDefinition,
  WorkflowInstance,
} from '../../domain/src/index.js';
import type { Clock, StructuredModelProvider, TaskQualityReportRepository } from './ports.js';

const components: readonly TaskQualityComponent[] = [
  'goal',
  'workflow',
  'skill',
  'result_quality',
  'tool_call',
];
const AssessmentSchema = z
  .object({
    score: z.number().min(0).max(1),
    summary: z.string().min(1),
    findings: z.array(z.string().min(1)),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })
  .strict();
const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'summary', 'findings', 'evidenceRefs'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 1 },
    summary: { type: 'string', minLength: 1 },
    findings: { type: 'array', items: { type: 'string', minLength: 1 } },
    evidenceRefs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  },
} as const;

export class TaskQualityEvaluationService {
  readonly #model: StructuredModelProvider;
  readonly #repository: TaskQualityReportRepository;
  readonly #clock: Clock;
  readonly #nextId: () => string;
  readonly #influences: TaskQualityInfluenceSink | undefined;
  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      repository: TaskQualityReportRepository;
      clock: Clock;
      nextId(): string;
      influences?: TaskQualityInfluenceSink;
    }>,
  ) {
    this.#model = dependencies.model;
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
    this.#influences = dependencies.influences;
  }

  async evaluate(
    input: Readonly<{
      taskId: string;
      goal: Goal;
      goalEvaluation: GoalEvaluationResult;
      workflow: WorkflowDefinition;
      instance: WorkflowInstance;
      skill: Readonly<{
        skillId: string;
        version: number;
        inputSchema: unknown;
        outputSchema: unknown;
      }>;
      processedResult: ProcessedResultRecord;
      isTemporarySkill: boolean;
    }>,
  ): Promise<TaskQualityReport> {
    const evidence = {
      taskId: input.taskId,
      goal: input.goal,
      goalEvaluation: input.goalEvaluation,
      workflow: input.workflow,
      instance: input.instance,
      skill: {
        skillId: input.skill.skillId,
        version: input.skill.version,
        inputSchema: input.skill.inputSchema,
        outputSchema: input.skill.outputSchema,
      },
      processedResult: input.processedResult,
    };
    const assessments: TaskQualityAssessment[] = [];
    for (const component of components) {
      const decision = AssessmentSchema.parse(
        await this.#model.generateStructured({
          stage: 'evaluation',
          instruction: JSON.stringify({
            operation: 'evaluate_task_component',
            component,
            evidence,
            instruction:
              'Return displayable findings and source references, never private reasoning.',
          }),
          responseSchema,
          correctionErrors: [],
        }),
      );
      assessments.push({ component, ...decision });
    }
    const overallScore = assessments.reduce((sum, item) => sum + item.score, 0) / components.length;
    const report: TaskQualityReport = {
      reportId: this.#nextId(),
      taskId: input.taskId,
      goalId: input.goal.goalId,
      goalVersion: input.goal.version,
      workflowInstanceId: input.instance.instanceId,
      processedResultId: input.processedResult.resultId,
      assessments,
      overallScore,
      status: overallScore >= 0.8 ? 'passed' : overallScore >= 0.5 ? 'warning' : 'failed',
      createdAt: this.#clock.now(),
    };
    await this.#repository.save(report);
    await this.#influences?.apply({ report, ...input });
    return report;
  }

  async getByTask(taskId: string): Promise<TaskQualityReport> {
    const report = await this.#repository.findByTask(taskId);
    if (report === undefined) throw new Error('TASK_QUALITY_REPORT_NOT_FOUND');
    return report;
  }
}

export interface TaskQualityInfluenceSink {
  apply(
    input: Readonly<{
      report: TaskQualityReport;
      taskId: string;
      goal: Goal;
      goalEvaluation: GoalEvaluationResult;
      workflow: WorkflowDefinition;
      instance: WorkflowInstance;
      skill: Readonly<{
        skillId: string;
        version: number;
        inputSchema: unknown;
        outputSchema: unknown;
      }>;
      processedResult: ProcessedResultRecord;
      isTemporarySkill: boolean;
    }>,
  ): Promise<void>;
}
