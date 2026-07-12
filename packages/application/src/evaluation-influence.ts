import { z } from 'zod';

import type {
  EvaluationInfluenceRecord,
  ModelStage,
  TaskQualityAssessment,
} from '../../domain/src/index.js';
import type { Clock, EvaluationInfluenceRepository, StructuredModelProvider } from './ports.js';
import type { EvolutionExperienceService } from './evolution-experience.js';
import type { PromptService } from './prompt-service.js';
import type { SkillQualityService } from './skill-quality.js';
import type { TaskQualityInfluenceSink } from './task-quality.js';
import type { WorkflowTemplateService } from './workflow-template.js';

const PromptCandidateSchema = z
  .object({ content: z.string().min(1).includes('{{instruction}}') })
  .strict();
const promptCandidateResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['content'],
  properties: { content: { type: 'string', minLength: 1, pattern: '\\{\\{instruction\\}\\}' } },
} as const;

export class EvaluationInfluenceService implements TaskQualityInfluenceSink {
  readonly #repository: EvaluationInfluenceRepository;
  readonly #experiences: Pick<EvolutionExperienceService, 'findByInstance'>;
  readonly #skillQuality: Pick<SkillQualityService, 'record'>;
  readonly #templates: Pick<WorkflowTemplateService, 'observe'>;
  readonly #prompts: Pick<PromptService, 'createEvaluationCandidate'>;
  readonly #model: StructuredModelProvider;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      repository: EvaluationInfluenceRepository;
      experiences: Pick<EvolutionExperienceService, 'findByInstance'>;
      skillQuality: Pick<SkillQualityService, 'record'>;
      templates: Pick<WorkflowTemplateService, 'observe'>;
      prompts: Pick<PromptService, 'createEvaluationCandidate'>;
      model: StructuredModelProvider;
      clock: Clock;
      nextId(): string;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#experiences = dependencies.experiences;
    this.#skillQuality = dependencies.skillQuality;
    this.#templates = dependencies.templates;
    this.#prompts = dependencies.prompts;
    this.#model = dependencies.model;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async apply(input: Parameters<TaskQualityInfluenceSink['apply']>[0]): Promise<void> {
    if ((await this.#repository.findByReport(input.report.reportId)) !== undefined) return;
    const experience = await this.#experiences.findByInstance(input.instance.instanceId);
    if (experience === undefined) throw new Error('EVALUATION_INFLUENCE_EXPERIENCE_NOT_FOUND');

    const skillObservation = input.isTemporarySkill
      ? undefined
      : (
          await this.#skillQuality.record({
            skillId: input.skill.skillId,
            skillVersion: input.skill.version,
            evaluationRef: `task-quality-report:${input.report.reportId}`,
            score:
              input.report.assessments.find((item) => item.component === 'skill')?.score ??
              input.report.overallScore,
            successful: input.report.status === 'passed',
          })
        ).observation;
    const template = await this.#templates.observe(experience, input.report);
    const prompt =
      input.report.status === 'passed'
        ? undefined
        : await this.#createPromptCandidate(input.report);
    const record: EvaluationInfluenceRecord = {
      influenceId: this.#nextId(),
      reportId: input.report.reportId,
      taskId: input.taskId,
      experienceId: experience.experienceId,
      ...(skillObservation === undefined
        ? {}
        : { skillObservationId: skillObservation.observationId }),
      workflowDisposition:
        input.report.status === 'passed' ? 'quality_occurrence_recorded' : 'rejected_low_quality',
      ...(template === undefined
        ? {}
        : { workflowTemplateId: template.templateId, workflowTemplateVersion: template.version }),
      promptDisposition: prompt === undefined ? 'not_required' : 'candidate_created',
      ...(prompt === undefined
        ? {}
        : { promptId: prompt.promptId, promptVersion: prompt.version, promptStage: prompt.stage }),
      createdAt: this.#clock.now(),
    };
    await this.#repository.save(record);
  }

  async getByReport(reportId: string): Promise<EvaluationInfluenceRecord> {
    const record = await this.#repository.findByReport(reportId);
    if (record === undefined) throw new Error('EVALUATION_INFLUENCE_NOT_FOUND');
    return record;
  }

  async #createPromptCandidate(report: Parameters<TaskQualityInfluenceSink['apply']>[0]['report']) {
    const weakest = [...report.assessments].sort(
      (left, right) => left.score - right.score || left.component.localeCompare(right.component),
    )[0];
    if (weakest === undefined) throw new Error('EVALUATION_INFLUENCE_ASSESSMENT_REQUIRED');
    const stage = targetStage(weakest);
    const generated = PromptCandidateSchema.parse(
      await this.#model.generateStructured({
        stage: 'evaluation',
        instruction: JSON.stringify({
          operation: 'generate_prompt_candidate_from_quality_report',
          targetStage: stage,
          reportId: report.reportId,
          assessment: weakest,
          instruction:
            'Return an improved displayable Prompt containing the literal {{instruction}} placeholder. Do not include private reasoning or executable code.',
        }),
        responseSchema: promptCandidateResponseSchema,
        correctionErrors: [],
        taskId: report.taskId,
      }),
    );
    return this.#prompts.createEvaluationCandidate(stage, generated.content);
  }
}

function targetStage(assessment: TaskQualityAssessment): ModelStage {
  const mapping: Readonly<Record<TaskQualityAssessment['component'], ModelStage>> = {
    goal: 'goal',
    workflow: 'workflow_planning',
    skill: 'skill_selection',
    result_quality: 'result_processing',
    tool_call: 'execution_decision',
  };
  return mapping[assessment.component];
}
