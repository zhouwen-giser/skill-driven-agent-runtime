import { describe, expect, it } from 'vitest';

import type {
  EvaluationInfluenceRecord,
  EvolutionExperience,
  PromptVersion,
  SkillQualityObservation,
  TaskQualityReport,
} from '../../domain/src/index.js';
import {
  EvaluationInfluenceService,
  type EvaluationInfluenceRepository,
  type TaskQualityInfluenceSink,
} from '../src/index.js';

const timestamp = '2026-07-13T01:00:00.000Z';

describe('EvaluationInfluenceService', () => {
  it('links a passing report to Skill evolution and a quality-gated Workflow occurrence', async () => {
    const harness = createHarness();
    await harness.service.apply(input(report('passed', 0.9)));

    expect(harness.skillInputs).toEqual([
      expect.objectContaining({
        evaluationRef: 'task-quality-report:report-1',
        score: 0.9,
        successful: true,
      }),
    ]);
    expect(harness.templateReports).toEqual(['report-1']);
    expect(harness.promptStages).toEqual([]);
    expect(harness.saved).toMatchObject({
      reportId: 'report-1',
      experienceId: 'experience-1',
      skillObservationId: 'observation-1',
      workflowDisposition: 'quality_occurrence_recorded',
      workflowTemplateId: 'template-1',
      workflowTemplateVersion: 2,
      promptDisposition: 'not_required',
    });
  });

  it('rejects low-quality template evidence and creates an inactive candidate for the weakest stage', async () => {
    const harness = createHarness();
    const base = report('failed', 0.3);
    const low: TaskQualityReport = {
      ...base,
      assessments: base.assessments.map((assessment) =>
        assessment.component === 'workflow' ? { ...assessment, score: 0.1 } : assessment,
      ),
    };
    await harness.service.apply(input(low));

    expect(harness.promptStages).toEqual(['workflow_planning']);
    expect(harness.saved).toMatchObject({
      workflowDisposition: 'rejected_low_quality',
      promptDisposition: 'candidate_created',
      promptId: 'prompt-workflow_planning',
      promptVersion: 4,
      promptStage: 'workflow_planning',
    });
    await expect(harness.service.getByReport('report-1')).resolves.toEqual(harness.saved);
  });
});

function createHarness() {
  const repository = new MemoryInfluences();
  const skillInputs: unknown[] = [];
  const templateReports: string[] = [];
  const promptStages: string[] = [];
  const service = new EvaluationInfluenceService({
    repository,
    experiences: { findByInstance: () => Promise.resolve(experience()) },
    skillQuality: {
      record: (value) => {
        skillInputs.push(value);
        const observation: SkillQualityObservation = {
          observationId: 'observation-1',
          skillId: value.skillId,
          skillVersion: value.skillVersion,
          evaluationRef: value.evaluationRef,
          score: value.score,
          successful: value.successful,
          createdAt: timestamp,
        };
        return Promise.resolve({ observation, warnings: [] });
      },
    },
    templates: {
      observe: (_experience, quality) => {
        templateReports.push(quality.reportId);
        return Promise.resolve(
          quality.status === 'passed'
            ? {
                templateId: 'template-1',
                version: 2,
                goalKey: 'inspect',
                structureKey: 'structure',
                workflow: experience().workflow,
                sourceExperienceIds: ['experience-1'],
                sourceSuccessCount: 3,
                useCount: 0,
                successfulUseCount: 0,
                averageUseDurationMs: 0,
                status: 'enabled' as const,
                createdAt: timestamp,
              }
            : undefined,
        );
      },
    },
    prompts: {
      createEvaluationCandidate: (stage, content) => {
        promptStages.push(stage);
        const prompt: PromptVersion = {
          promptId: `prompt-${stage}`,
          stage,
          version: 4,
          previousVersion: 3,
          content,
          status: 'candidate',
          source: 'auto_candidate',
          createdAt: timestamp,
        };
        return Promise.resolve(prompt);
      },
    },
    model: {
      generateStructured: () =>
        Promise.resolve({ content: 'Improve the weak stage. {{instruction}}' }),
    },
    clock: { now: () => timestamp },
    nextId: () => 'influence-1',
  });
  return {
    service,
    skillInputs,
    templateReports,
    promptStages,
    get saved() {
      return repository.saved;
    },
  };
}

function report(status: TaskQualityReport['status'], score: number): TaskQualityReport {
  return {
    reportId: 'report-1',
    taskId: 'task-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowInstanceId: 'instance-1',
    processedResultId: 'result-1',
    assessments: ['goal', 'workflow', 'skill', 'result_quality', 'tool_call'].map((component) => ({
      component: component as TaskQualityReport['assessments'][number]['component'],
      score,
      summary: `${component} summary`,
      findings: [`${component} finding`],
      evidenceRefs: [`${component}:1`],
    })),
    overallScore: score,
    status,
    createdAt: timestamp,
  };
}

function input(quality: TaskQualityReport): Parameters<TaskQualityInfluenceSink['apply']>[0] {
  const value = experience();
  return {
    report: quality,
    taskId: 'task-1',
    goal: {
      ...value.goal,
      contextId: 'context-1',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    goalEvaluation: value.evaluation,
    workflow: value.workflow,
    instance: {
      instanceId: 'instance-1',
      planId: 'plan-1',
      workflowDefinitionId: value.workflow.workflowDefinitionId,
      workflowVersion: 1,
      goalId: 'goal-1',
      goalVersion: 1,
      skillVersions: [{ skillId: 'skill-1', version: 1 }],
      budgetLimits: {
        maxReplans: 1,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 10,
      },
      budgetUsage: { replanCount: 0, durationMs: 10, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'succeeded',
      input: {},
      result: {},
      errors: {},
      startedAt: timestamp,
      completedAt: timestamp,
    },
    skill: { skillId: 'skill-1', version: 1, inputSchema: {}, outputSchema: {} },
    processedResult: {
      resultId: 'result-1',
      taskId: 'task-1',
      skillId: 'skill-1',
      skillVersion: 1,
      normalized: {
        data: {},
        errors: [],
        originalSize: 2,
        contextValue: {},
        contextTruncated: false,
        summary: 'Done.',
      },
      output: { text: 'Done.', structured: {} },
      facts: [],
      valuable: false,
      valueSummary: 'No durable fact.',
      memoryCandidates: [],
      createdAt: timestamp,
    },
    isTemporarySkill: false,
  };
}

function experience(): EvolutionExperience {
  return {
    experienceId: 'experience-1',
    controlId: 'control-1',
    roundIndex: 0,
    taskId: 'task-1',
    contextId: 'context-1',
    goal: {
      goalId: 'goal-1',
      version: 1,
      title: 'Inspect',
      description: 'Inspect.',
      constraints: [],
      successCriteria: ['Done'],
    },
    workflow: {
      workflowDefinitionId: 'workflow-1',
      version: 1,
      goalId: 'goal-1',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'literal', value: true },
        },
      ],
      edges: [],
    },
    instanceId: 'instance-1',
    skillVersions: [{ skillId: 'skill-1', version: 1 }],
    tools: [],
    input: {},
    result: {},
    errors: {},
    evaluation: { decision: 'achieved', summary: 'Done.' },
    successful: true,
    durationMs: 10,
    createdAt: timestamp,
  };
}

class MemoryInfluences implements EvaluationInfluenceRepository {
  saved: EvaluationInfluenceRecord | undefined;
  save(record: EvaluationInfluenceRecord): Promise<void> {
    this.saved = record;
    return Promise.resolve();
  }
  findByReport(reportId: string): Promise<EvaluationInfluenceRecord | undefined> {
    return Promise.resolve(this.saved?.reportId === reportId ? this.saved : undefined);
  }
}
