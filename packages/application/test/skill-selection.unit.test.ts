import { describe, expect, it } from 'vitest';

import type {
  Skill,
  SkillPerformanceMetrics,
  SkillRelation,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillVersion,
} from '../../domain/src/index.js';
import {
  SkillSelectionService,
  type SkillGraphRepository,
  type SkillRepository,
  type SkillSelectionRepository,
} from '../src/index.js';

describe('SkillSelectionService', () => {
  it('persists an LLM-decided selection with all required metric snapshots', async () => {
    const records = new MemorySelectionRepository();
    const service = createService(records, [], 'skill.a');
    const selection = await service.select('Inspect the device safely.');

    expect(selection).toMatchObject({
      selectedSkillId: 'skill.a',
      selectedSkillVersion: 1,
      decisionSummary: 'Skill A balances semantic fit and operational history.',
    });
    expect(selection.candidates[0]).toEqual({
      skillId: 'skill.a',
      skillVersion: 1,
      name: 'skill.a',
      summary: 'Candidate.',
      capabilities: ['inspection'],
      createdAt: '2026-07-11T10:00:00.000Z',
      semanticScore: 0.9,
      metrics: expect.objectContaining({
        successRate: 0.8,
        averageDurationMs: 120,
        averageCost: 0.02,
        failureCount: 2,
        stabilityScore: 0.95,
      }),
    });
    expect(records.selection).toEqual(selection);
  });

  it('uses only enabled alternative graph targets and creates a confirmation-bound replacement plan', async () => {
    const records = new MemorySelectionRepository();
    const relations: readonly SkillRelation[] = [
      {
        relationId: 'alternative-1',
        sourceSkillId: 'skill.a',
        targetSkillId: 'skill.b',
        relationType: 'alternative',
        metadata: {},
        createdAt: '2026-07-11T10:00:00.000Z',
      },
    ];
    const initial = createService(records, relations, 'skill.a');
    const selection = await initial.select('Inspect the device safely.');
    const replacement = createService(records, relations, 'skill.b');
    const plan = await replacement.planReplacement(selection.selectionId, 'skill.a');

    expect(plan).toMatchObject({
      failedSkillId: 'skill.a',
      replacementSkillId: 'skill.b',
      replacementSkillVersion: 1,
      status: 'awaiting_confirmation',
    });
    expect(records.replacement).toEqual(plan);
  });

  it('rejects a decider result that is not one of the enabled candidates', async () => {
    const service = createService(new MemorySelectionRepository(), [], 'skill.missing');
    await expect(service.select('Inspect device.')).rejects.toMatchObject({
      code: 'SKILL_SELECTION_INVALID_DECISION',
    });
  });
});

function createService(
  records: SkillSelectionRepository,
  relations: readonly SkillRelation[],
  selectedSkillId: string,
): SkillSelectionService {
  return new SkillSelectionService({
    skills: new SelectionSkillRepository(),
    graph: new SelectionGraphRepository(relations),
    records,
    retriever: { score: () => Promise.resolve({ 'skill.a': 0.9, 'skill.b': 0.7 }) },
    decider: {
      decide: ({ mode }) =>
        Promise.resolve({
          selectedSkillId,
          decisionSummary:
            mode === 'initial'
              ? 'Skill A balances semantic fit and operational history.'
              : 'Skill B is the enabled declared alternative.',
        }),
    },
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
    ids: {
      nextSelectionId: () => 'selection-1',
      nextReplacementPlanId: () => 'replacement-1',
    },
  });
}

class MemorySelectionRepository implements SkillSelectionRepository {
  selection: SkillSelectionRecord | undefined;
  replacement: SkillReplacementPlan | undefined;
  findMetrics(skillId: string): Promise<SkillPerformanceMetrics | undefined> {
    return Promise.resolve(
      skillId === 'skill.a'
        ? {
            sampleCount: 10,
            successRate: 0.8,
            averageDurationMs: 120,
            averageCost: 0.02,
            failureCount: 2,
            stabilityScore: 0.95,
          }
        : undefined,
    );
  }
  saveMetrics(): Promise<void> {
    return Promise.resolve();
  }
  saveSelection(record: SkillSelectionRecord): Promise<void> {
    this.selection = record;
    return Promise.resolve();
  }
  findSelection(selectionId: string): Promise<SkillSelectionRecord | undefined> {
    return Promise.resolve(
      this.selection?.selectionId === selectionId ? this.selection : undefined,
    );
  }
  saveReplacementPlan(plan: SkillReplacementPlan): Promise<void> {
    this.replacement = plan;
    return Promise.resolve();
  }
}

class SelectionGraphRepository implements SkillGraphRepository {
  constructor(readonly relations: readonly SkillRelation[]) {}
  listRelations(): Promise<readonly SkillRelation[]> {
    return Promise.resolve(this.relations);
  }
  saveRelation(): Promise<void> {
    return Promise.resolve();
  }
  deleteRelation(): Promise<void> {
    return Promise.resolve();
  }
}

class SelectionSkillRepository implements SkillRepository {
  readonly versions = [skillVersion('skill.a'), skillVersion('skill.b')];
  find(skillId: string): Promise<Skill | undefined> {
    return Promise.resolve(
      this.versions.some((item) => item.skillId === skillId)
        ? {
            skillId,
            currentVersion: 1,
            createdAt: '2026-07-11T10:00:00.000Z',
            updatedAt: '2026-07-11T10:00:00.000Z',
          }
        : undefined,
    );
  }
  findCurrentVersion(skillId: string) {
    return Promise.resolve(this.versions.find((item) => item.skillId === skillId));
  }
  findVersion(skillId: string, version: number) {
    return Promise.resolve(
      this.versions.find((item) => item.skillId === skillId && item.version === version),
    );
  }
  listVersions(skillId: string) {
    return Promise.resolve(this.versions.filter((item) => item.skillId === skillId));
  }
  listEnabledVersions() {
    return Promise.resolve(this.versions);
  }
  listCurrentVersions() {
    return Promise.resolve(this.versions);
  }
  saveVersionAndSetCurrent(): Promise<void> {
    return Promise.resolve();
  }
}

function skillVersion(skillId: string): SkillVersion {
  return {
    skillId,
    version: 1,
    name: skillId,
    summary: 'Candidate.',
    description: 'Selection candidate.',
    capabilities: ['inspection'],
    workflowGuidance: 'Inspect.',
    outputInstruction: 'Return result.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-11T10:00:00.000Z',
  };
}
