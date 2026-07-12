import { describe, expect, it } from 'vitest';

import type {
  EvolutionExperience,
  TaskQualityReport,
  WorkflowTemplate,
  WorkflowTemplateOccurrence,
  WorkflowTemplateUse,
} from '../../domain/src/index.js';
import { WorkflowTemplateService, type WorkflowTemplateRepository } from '../src/index.js';

describe('WorkflowTemplateService', () => {
  it('induces at three successes and tracks adjusted-plan usage effect', async () => {
    const repository = new MemoryTemplateRepository();
    let templateSequence = 0;
    let useSequence = 0;
    const service = new WorkflowTemplateService({
      repository,
      clock: { now: () => '2026-07-12T00:10:00.000Z' },
      ids: {
        nextTemplateId: () => `template-${String(++templateSequence)}`,
        nextUseId: () => `use-${String(++useSequence)}`,
      },
    });
    await expect(service.observe(experience(1), qualityReport(1))).resolves.toBeUndefined();
    await expect(
      service.observe(experience(9), { ...qualityReport(9), status: 'warning' }),
    ).resolves.toBeUndefined();
    expect(repository.occurrences).toHaveLength(1);
    await expect(service.observe(experience(2), qualityReport(2))).resolves.toBeUndefined();
    const template = await service.observe(experience(3), qualityReport(3));
    expect(template).toMatchObject({ version: 1, sourceSuccessCount: 3, useCount: 0 });
    if (template === undefined) throw new Error('EXPECTED_TEMPLATE');
    await expect(service.findPreferred('Inspect current device status')).resolves.toMatchObject({
      templateId: template.templateId,
    });
    const adjusted = {
      ...experience(4).workflow,
      workflowDefinitionId: 'workflow-adjusted',
      goalId: 'goal-adjusted',
    };
    await service.recordUse(template, 'plan-adjusted', adjusted);
    await service.recordOutcome({ ...experience(4), workflow: adjusted, durationMs: 40 });
    await expect(service.listTemplates()).resolves.toMatchObject([
      {
        templateId: template.templateId,
        useCount: 1,
        successfulUseCount: 1,
        averageUseDurationMs: 40,
      },
    ]);
    await expect(service.listUses(template.templateId)).resolves.toMatchObject([
      { status: 'succeeded', durationMs: 40, workflowDefinitionId: 'workflow-adjusted' },
    ]);
  });
});

class MemoryTemplateRepository implements WorkflowTemplateRepository {
  readonly occurrences: WorkflowTemplateOccurrence[] = [];
  readonly templates: WorkflowTemplate[] = [];
  readonly uses: WorkflowTemplateUse[] = [];
  saveOccurrence(value: WorkflowTemplateOccurrence) {
    this.occurrences.push(value);
    return Promise.resolve();
  }
  listOccurrences(goalKey: string, structureKey: string) {
    return Promise.resolve(
      this.occurrences.filter(
        (item) => item.goalKey === goalKey && item.structureKey === structureKey,
      ),
    );
  }
  findPreferred(goalKey: string) {
    return Promise.resolve([...this.templates].reverse().find((item) => item.goalKey === goalKey));
  }
  saveTemplate(value: WorkflowTemplate) {
    this.templates.push(value);
    return Promise.resolve();
  }
  saveUse(value: WorkflowTemplateUse) {
    this.uses.push(value);
    return Promise.resolve();
  }
  findPlannedUse(workflowDefinitionId: string, workflowVersion: number) {
    return Promise.resolve(
      this.uses.find(
        (item) =>
          item.workflowDefinitionId === workflowDefinitionId &&
          item.workflowVersion === workflowVersion &&
          item.status === 'planned',
      ),
    );
  }
  completeUse(use: WorkflowTemplateUse, template: WorkflowTemplate) {
    this.uses.splice(
      this.uses.findIndex((item) => item.useId === use.useId),
      1,
      use,
    );
    this.templates.splice(
      this.templates.findIndex(
        (item) => item.templateId === template.templateId && item.version === template.version,
      ),
      1,
      template,
    );
    return Promise.resolve();
  }
  listTemplates() {
    return Promise.resolve(this.templates);
  }
  listUses(templateId: string) {
    return Promise.resolve(this.uses.filter((item) => item.templateId === templateId));
  }
}

function experience(sequence: number): EvolutionExperience {
  return {
    experienceId: `experience-${String(sequence)}`,
    controlId: `control-${String(sequence)}`,
    roundIndex: 0,
    contextId: `context-${String(sequence)}`,
    goal: {
      goalId: `goal-${String(sequence)}`,
      version: 1,
      title: 'Inspect device',
      description: 'Inspect the current device status',
      constraints: [],
      successCriteria: ['Status returned'],
    },
    workflow: {
      workflowDefinitionId: `workflow-${String(sequence)}`,
      version: 1,
      goalId: `goal-${String(sequence)}`,
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result',
          value: { op: 'literal', value: 'ok' },
        },
      ],
      edges: [],
    },
    instanceId: `instance-${String(sequence)}`,
    skillVersions: [],
    tools: [],
    input: {},
    result: { ok: true },
    errors: {},
    evaluation: { decision: 'achieved', summary: 'Done.' },
    successful: true,
    durationMs: 10,
    createdAt: `2026-07-12T00:00:0${String(sequence)}.000Z`,
  };
}

function qualityReport(sequence: number): TaskQualityReport {
  return {
    reportId: `quality-${String(sequence)}`,
    taskId: `task-${String(sequence)}`,
    goalId: `goal-${String(sequence)}`,
    goalVersion: 1,
    workflowInstanceId: `instance-${String(sequence)}`,
    processedResultId: `result-${String(sequence)}`,
    assessments: [],
    overallScore: 1,
    status: 'passed',
    createdAt: `2026-07-12T00:00:0${String(sequence)}.000Z`,
  };
}
