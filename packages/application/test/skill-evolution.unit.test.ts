import { describe, expect, it } from 'vitest';

import type {
  SkillFormalizationCandidate,
  SkillVersion,
  TemporarySkill,
  TemporarySkillExperience,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { SkillEvolutionService } from '../src/index.js';

describe('SkillEvolutionService', () => {
  it('publishes an experience-evolution Skill only after every required gate passes', async () => {
    const fixture = setup(true);
    const result = await fixture.service.evaluateAndPublish('candidate-1');

    expect(result).toMatchObject({
      status: 'published',
      publishedSkillId: 'skill.evolved.device',
      publishedSkillVersion: 1,
      inductionReport: { consistent: true, stable: true, generalizable: true },
      validationReport: { allPassed: true },
    });
    expect(result.validationReport?.cases.map((item) => item.kind)).toEqual([
      'static_validation',
      'historical_replay',
      'historical_replay',
      'normal',
      'boundary',
      'exception',
    ]);
    expect(fixture.published).toMatchObject({
      skillId: 'skill.evolved.device',
      status: 'enabled',
      sourceKind: 'experience_evolution',
      validationPassed: true,
    });
  });

  it('persists a failed evolution draft and leaves the formal registry unchanged', async () => {
    const fixture = setup(false);
    const result = await fixture.service.evaluateAndPublish('candidate-1');

    expect(result).toMatchObject({
      status: 'validation_failed',
      validationReport: { allPassed: false },
    });
    expect(result.validationReport?.cases).toContainEqual(
      expect.objectContaining({ kind: 'boundary', passed: false }),
    );
    expect(fixture.published).toBeUndefined();
    expect(fixture.repository.candidate).toEqual(result);
  });
});

function setup(allPass: boolean) {
  const repository = new MemoryRepository();
  let published: Omit<SkillVersion, 'version' | 'previousVersion' | 'createdAt'> | undefined;
  const service = new SkillEvolutionService({
    temporarySkills: repository,
    model: { generateStructured: () => Promise.resolve(decision()) },
    schemas: new AjvJsonSchemaValidator(),
    tools: {
      exists: () => Promise.resolve(true),
      getInputSchema: () => Promise.resolve({ type: 'object' }),
    },
    skills: {
      listCurrentVersions: () => Promise.resolve([]),
      register: (input) => {
        published = input;
        return Promise.resolve({ ...input, version: 1, createdAt: timestamp });
      },
    },
    runner: {
      run: ({ case_ }) =>
        Promise.resolve({
          passed: allPass || case_.kind !== 'boundary',
          summary: allPass || case_.kind !== 'boundary' ? 'Passed.' : 'Boundary failed.',
        }),
    },
    clock: { now: () => timestamp },
  });
  return {
    service,
    repository,
    get published() {
      return published;
    },
  };
}

const timestamp = '2026-07-12T12:00:00.000Z';

function decision() {
  return {
    consistent: true,
    stable: true,
    generalizable: true,
    duplicateScore: 0,
    decisionSummary: 'Two stable experiences define a reusable capability.',
    proposedSkill: {
      skillId: 'skill.evolved.device',
      name: 'Evolved device status',
      summary: 'Read device status.',
      description: 'Read the current state of one registered device.',
      capabilities: ['device-status'],
      workflowGuidance: 'Call the required Tool once and return its result.',
      outputInstruction: 'Return the structured device state.',
      inputSchema: {
        type: 'object',
        properties: { deviceId: { type: 'string' } },
        required: ['deviceId'],
      },
      outputSchema: { type: 'object' },
      tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
    },
    supplementalCases: [
      {
        caseId: 'normal-1',
        kind: 'normal',
        input: { deviceId: 'device-1' },
        expectedOutcome: 'success',
      },
      {
        caseId: 'boundary-1',
        kind: 'boundary',
        input: { deviceId: '' },
        expectedOutcome: 'failure',
      },
      {
        caseId: 'exception-1',
        kind: 'exception',
        input: {},
        expectedOutcome: 'failure',
      },
    ],
  } as const;
}

class MemoryRepository {
  candidate: SkillFormalizationCandidate = {
    candidateId: 'candidate-1',
    capabilityFingerprint: 'fingerprint-1',
    successfulExperienceCount: 2,
    requiredSuccessThreshold: 2,
    sourceExperienceIds: ['experience-1', 'experience-2'],
    status: 'awaiting_simulation',
    createdAt: timestamp,
  };
  readonly skills: TemporarySkill[] = [1, 2].map((sequence) => ({
    temporarySkillId: `temporary-${String(sequence)}`,
    taskId: `task-${String(sequence)}`,
    contextId: `context-${String(sequence)}`,
    name: 'Temporary device status',
    description: 'Read device status for this Task.',
    tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    capabilityFingerprint: 'fingerprint-1',
    status: 'expired',
    createdAt: timestamp,
    expiredAt: timestamp,
  }));
  readonly experiences: TemporarySkillExperience[] = this.skills.map((skill, index) => ({
    experienceId: `experience-${String(index + 1)}`,
    temporarySkillId: skill.temporarySkillId,
    taskId: skill.taskId,
    contextId: skill.contextId,
    capabilityFingerprint: skill.capabilityFingerprint,
    successful: true,
    outcomeSummary: 'Device status was returned.',
    createdAt: timestamp,
  }));
  find(id: string) {
    return Promise.resolve(this.skills.find((item) => item.temporarySkillId === id));
  }
  listByTask(taskId: string) {
    return Promise.resolve(this.skills.filter((item) => item.taskId === taskId));
  }
  save() {
    return Promise.resolve();
  }
  expireAndSaveExperience() {
    return Promise.resolve();
  }
  listSuccessfulExperiences(fingerprint: string) {
    return Promise.resolve(
      this.experiences.filter((item) => item.capabilityFingerprint === fingerprint),
    );
  }
  findFormalizationCandidate(fingerprint: string) {
    return Promise.resolve(
      this.candidate.capabilityFingerprint === fingerprint ? this.candidate : undefined,
    );
  }
  findFormalizationCandidateById(candidateId: string) {
    return Promise.resolve(this.candidate.candidateId === candidateId ? this.candidate : undefined);
  }
  saveFormalizationCandidate(candidate: SkillFormalizationCandidate) {
    this.candidate = candidate;
    return Promise.resolve();
  }
}
