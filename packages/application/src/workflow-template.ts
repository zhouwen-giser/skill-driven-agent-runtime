import { createHash } from 'node:crypto';

import type {
  EvolutionExperience,
  WorkflowDefinition,
  WorkflowTemplate,
  WorkflowTemplateOccurrence,
} from '../../domain/src/index.js';

import type { Clock, WorkflowTemplateRepository } from './ports.js';

const INDUCTION_THRESHOLD = 3;

export class WorkflowTemplateService {
  readonly #repository: WorkflowTemplateRepository;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextTemplateId(): string; nextUseId(): string }>;

  constructor(
    dependencies: Readonly<{
      repository: WorkflowTemplateRepository;
      clock: Clock;
      ids: Readonly<{ nextTemplateId(): string; nextUseId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async observe(experience: EvolutionExperience): Promise<WorkflowTemplate | undefined> {
    if (!experience.successful) return undefined;
    const goalKey = normalizeGoal(experience.goal.description);
    const structureKey = workflowStructureKey(experience.workflow);
    const occurrence: WorkflowTemplateOccurrence = {
      experienceId: experience.experienceId,
      goalKey,
      structureKey,
      workflow: experience.workflow,
      durationMs: experience.durationMs,
      createdAt: experience.createdAt,
    };
    await this.#repository.saveOccurrence(occurrence);
    const occurrences = await this.#repository.listOccurrences(goalKey, structureKey);
    if (occurrences.length < INDUCTION_THRESHOLD) return undefined;
    const current = await this.#repository.findPreferred(goalKey);
    if (current?.structureKey === structureKey) return current;
    const sources = occurrences.slice(-INDUCTION_THRESHOLD);
    const template: WorkflowTemplate = {
      templateId: current?.templateId ?? this.#ids.nextTemplateId(),
      version: (current?.version ?? 0) + 1,
      goalKey,
      structureKey,
      workflow: sources.at(-1)?.workflow ?? experience.workflow,
      sourceExperienceIds: sources.map((item) => item.experienceId),
      sourceSuccessCount: occurrences.length,
      useCount: 0,
      successfulUseCount: 0,
      averageUseDurationMs: 0,
      status: 'enabled',
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveTemplate(template);
    return template;
  }

  async findPreferred(goalDescription: string): Promise<WorkflowTemplate | undefined> {
    const goalKey = normalizeGoal(goalDescription);
    const candidates = await this.#repository.listTemplates();
    return candidates
      .map((template) => ({ template, similarity: goalSimilarity(goalKey, template.goalKey) }))
      .filter((candidate) => candidate.similarity >= 0.6)
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          right.template.successfulUseCount - left.template.successfulUseCount ||
          right.template.version - left.template.version,
      )[0]?.template;
  }

  async recordUse(template: WorkflowTemplate, planId: string, workflow: WorkflowDefinition) {
    const use = {
      useId: this.#ids.nextUseId(),
      templateId: template.templateId,
      templateVersion: template.version,
      planId,
      workflowDefinitionId: workflow.workflowDefinitionId,
      workflowVersion: workflow.version,
      status: 'planned' as const,
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveUse(use);
    return use;
  }

  async recordOutcome(experience: EvolutionExperience): Promise<void> {
    const use = await this.#repository.findPlannedUse(
      experience.workflow.workflowDefinitionId,
      experience.workflow.version,
    );
    if (use === undefined) return;
    const template = (await this.#repository.listTemplates()).find(
      (item) => item.templateId === use.templateId && item.version === use.templateVersion,
    );
    if (template === undefined) throw new Error('WORKFLOW_TEMPLATE_USE_TEMPLATE_MISSING');
    const useCount = template.useCount + 1;
    const successfulUseCount = template.successfulUseCount + (experience.successful ? 1 : 0);
    const updated: WorkflowTemplate = {
      ...template,
      useCount,
      successfulUseCount,
      averageUseDurationMs:
        (template.averageUseDurationMs * template.useCount + experience.durationMs) / useCount,
    };
    await this.#repository.completeUse(
      {
        ...use,
        status: experience.successful ? 'succeeded' : 'failed',
        durationMs: experience.durationMs,
        completedAt: experience.createdAt,
      },
      updated,
    );
  }

  listTemplates(): Promise<readonly WorkflowTemplate[]> {
    return this.#repository.listTemplates();
  }

  listUses(templateId: string) {
    return this.#repository.listUses(templateId);
  }
}

export function normalizeGoal(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

export function goalSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftTerms = new Set(left.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const rightTerms = new Set(right.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const union = new Set([...leftTerms, ...rightTerms]);
  if (union.size === 0) return 0;
  let intersectionSize = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) intersectionSize += 1;
  return intersectionSize / union.size;
}

function workflowStructureKey(workflow: WorkflowDefinition): string {
  const shape = {
    nodes: workflow.nodes.map((node) => ({
      type: node.type,
      ...(node.type === 'mcp_tool' ? { tool: node.tool } : {}),
      ...(node.type === 'skill_call' ? { skillId: node.skillId } : {}),
    })),
    edges: workflow.edges.map((edge) => ({ source: edge.sourceNodeId, target: edge.targetNodeId })),
  };
  return createHash('sha256').update(JSON.stringify(shape)).digest('hex');
}
