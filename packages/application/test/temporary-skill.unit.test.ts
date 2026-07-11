import { describe, expect, it } from 'vitest';

import type {
  SkillFormalizationCandidate,
  TemporarySkill,
  TemporarySkillExperience,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { TemporarySkillService, type TemporarySkillRepository } from '../src/index.js';

describe('TemporarySkillService', () => {
  it('expires at task completion, saves experience, and never formalizes a single success', async () => {
    const repository = new MemoryTemporarySkillRepository();
    const service = createService(repository);
    const skill = await service.create(input('task-1'));
    const result = await service.complete(skill.temporarySkillId, true, 'Device inspected.');

    expect(result.skill).toMatchObject({ status: 'expired', taskId: 'task-1' });
    expect(result.experience).toMatchObject({
      successful: true,
      outcomeSummary: 'Device inspected.',
    });
    expect(result.formalizationCandidate).toBeUndefined();
    expect(repository.candidate).toBeUndefined();
  });

  it('creates only an awaiting-simulation candidate after the repeated-success threshold', async () => {
    const repository = new MemoryTemporarySkillRepository();
    const service = createService(repository);
    const first = await service.create(input('task-1'));
    await service.complete(first.temporarySkillId, true, 'First success.');
    const second = await service.create(input('task-2'));
    const result = await service.complete(second.temporarySkillId, true, 'Second success.');

    expect(result.formalizationCandidate).toEqual(
      expect.objectContaining({
        successfulExperienceCount: 2,
        requiredSuccessThreshold: 2,
        status: 'awaiting_simulation',
        sourceExperienceIds: ['experience-1', 'experience-2'],
      }),
    );
  });

  it('rejects unknown Tools and a second completion of an expired Temporary Skill', async () => {
    const repository = new MemoryTemporarySkillRepository();
    const service = createService(repository);
    await expect(
      service.create({
        ...input('task-missing'),
        tools: [{ serverId: 'mcp.devices', toolName: 'missing' }],
      }),
    ).rejects.toMatchObject({ code: 'TEMPORARY_SKILL_TOOL_NOT_FOUND' });
    const skill = await service.create(input('task-1'));
    await service.complete(skill.temporarySkillId, false, 'Failed safely.');
    await expect(service.complete(skill.temporarySkillId, true, 'Retry.')).rejects.toMatchObject({
      code: 'TEMPORARY_SKILL_ALREADY_EXPIRED',
    });
  });

  it('canonicalizes JSON object keys before capability fingerprinting', async () => {
    const repository = new MemoryTemporarySkillRepository();
    const service = createService(repository, (canonical) => canonical);
    const first = await service.create({
      ...input('task-order-1'),
      inputSchema: {
        type: 'object',
        properties: { alpha: { type: 'string' }, beta: { type: 'number' } },
      },
    });
    const second = await service.create({
      ...input('task-order-2'),
      inputSchema: {
        properties: { beta: { type: 'number' }, alpha: { type: 'string' } },
        type: 'object',
      },
    });

    expect(second.capabilityFingerprint).toBe(first.capabilityFingerprint);
  });
});

function createService(
  repository: TemporarySkillRepository,
  fingerprint: (canonical: string) => string = () => 'fingerprint-device-status',
): TemporarySkillService {
  let skillSequence = 0;
  let experienceSequence = 0;
  return new TemporarySkillService({
    repository,
    tools: {
      exists: (reference) => Promise.resolve(reference.toolName === 'device_status'),
    },
    schemas: new AjvJsonSchemaValidator(),
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
    ids: {
      nextTemporarySkillId: () => `temporary-${String(++skillSequence)}`,
      nextExperienceId: () => `experience-${String(++experienceSequence)}`,
      nextFormalizationCandidateId: () => 'candidate-1',
    },
    fingerprint,
    successThreshold: 2,
  });
}

function input(taskId: string) {
  return {
    taskId,
    contextId: `context-${taskId}`,
    name: 'Temporary device status',
    description: 'Use the available Tool for this task only.',
    tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  };
}

class MemoryTemporarySkillRepository implements TemporarySkillRepository {
  readonly skills = new Map<string, TemporarySkill>();
  experiences: readonly TemporarySkillExperience[] = [];
  candidate: SkillFormalizationCandidate | undefined;
  find(temporarySkillId: string) {
    return Promise.resolve(this.skills.get(temporarySkillId));
  }
  listByTask(taskId: string) {
    return Promise.resolve([...this.skills.values()].filter((skill) => skill.taskId === taskId));
  }
  save(skill: TemporarySkill) {
    this.skills.set(skill.temporarySkillId, skill);
    return Promise.resolve();
  }
  expireAndSaveExperience(skill: TemporarySkill, experience: TemporarySkillExperience) {
    this.skills.set(skill.temporarySkillId, skill);
    this.experiences = [...this.experiences, experience];
    return Promise.resolve();
  }
  listSuccessfulExperiences(fingerprint: string) {
    return Promise.resolve(
      this.experiences.filter(
        (item) => item.capabilityFingerprint === fingerprint && item.successful,
      ),
    );
  }
  findFormalizationCandidate(fingerprint: string) {
    return Promise.resolve(
      this.candidate?.capabilityFingerprint === fingerprint ? this.candidate : undefined,
    );
  }
  saveFormalizationCandidate(candidate: SkillFormalizationCandidate) {
    this.candidate = candidate;
    return Promise.resolve();
  }
}
