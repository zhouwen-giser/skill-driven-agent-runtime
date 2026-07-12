import { describe, expect, it } from 'vitest';

import type {
  SkillQualityObservation,
  SkillQualityWarning,
  SkillVersion,
} from '../../domain/src/index.js';
import { SkillQualityService, type SkillQualityRepository } from '../src/index.js';

describe('SkillQualityService', () => {
  it('creates warnings for consecutive low scores and a rising failure rate without mutating Skill', async () => {
    const repository = new MemoryQualityRepository();
    const skill = enabledSkill();
    let sequence = 0;
    const service = new SkillQualityService({
      repository,
      skills: { findVersion: () => Promise.resolve(skill) },
      clock: { now: () => `2026-07-12T00:00:0${String(sequence)}.000Z` },
      ids: {
        nextObservationId: () => `observation-${String(++sequence)}`,
        nextWarningId: () => `warning-${String(++sequence)}`,
      },
    });
    for (const [index, sample] of [
      { score: 0.8, successful: true },
      { score: 0.8, successful: true },
      { score: 0.8, successful: true },
      { score: 0.3, successful: false },
      { score: 0.2, successful: false },
      { score: 0.1, successful: false },
    ].entries())
      await service.record({
        skillId: skill.skillId,
        skillVersion: skill.version,
        evaluationRef: `evaluation-${String(index + 1)}`,
        ...sample,
      });

    expect(repository.warnings.map((item) => item.kind).sort()).toEqual([
      'consecutive_low_score',
      'failure_rate_increase',
    ]);
    expect(repository.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'active', skillStatusAtCreation: 'enabled' }),
      ]),
    );
    expect(skill).toEqual(enabledSkill());
  });
});

class MemoryQualityRepository implements SkillQualityRepository {
  readonly observations: SkillQualityObservation[] = [];
  readonly warnings: SkillQualityWarning[] = [];
  saveObservation(observation: SkillQualityObservation) {
    this.observations.unshift(observation);
    return Promise.resolve();
  }
  listRecentObservations(skillId: string, skillVersion: number, limit: number) {
    return Promise.resolve(
      this.observations
        .filter((item) => item.skillId === skillId && item.skillVersion === skillVersion)
        .slice(0, limit),
    );
  }
  findActiveWarning(skillId: string, skillVersion: number, kind: SkillQualityWarning['kind']) {
    return Promise.resolve(
      this.warnings.find(
        (item) =>
          item.skillId === skillId && item.skillVersion === skillVersion && item.kind === kind,
      ),
    );
  }
  saveWarning(warning: SkillQualityWarning) {
    this.warnings.push(warning);
    return Promise.resolve();
  }
  listWarnings(skillId?: string) {
    return Promise.resolve(
      skillId === undefined
        ? this.warnings
        : this.warnings.filter((item) => item.skillId === skillId),
    );
  }
}

function enabledSkill(): SkillVersion {
  return {
    skillId: 'skill.quality',
    version: 1,
    name: 'Quality Skill',
    summary: 'Quality.',
    description: 'Quality monitored Skill.',
    capabilities: ['quality'],
    workflowGuidance: 'Execute.',
    outputInstruction: 'Return.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}
