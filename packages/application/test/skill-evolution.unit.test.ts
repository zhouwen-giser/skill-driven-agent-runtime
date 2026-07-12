import { describe, expect, it } from 'vitest';

import type {
  SkillFormalizationCandidate,
  SkillEvolutionCorrectionExperience,
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
      publishedSkillId: 'skill.existing.device',
      publishedSkillVersion: 2,
      inductionReport: {
        consistent: true,
        stable: true,
        generalizable: true,
        duplicateSkillId: 'skill.existing.device',
        duplicateScore: 0.4,
        evolutionKind: 'new_version',
        targetSkillId: 'skill.existing.device',
        boundaryDecisionSummary: 'The capability boundary is unchanged; execution improved.',
        decisionSummary: 'Two stable experiences define a reusable capability.',
      },
      validationReport: { allPassed: true },
    });
    expect(result.validationReport?.cases.map((item) => item.kind)).toEqual([
      'static_validation',
      'source_experience',
      'source_experience',
      'historical_replay',
      'historical_replay',
      'normal',
      'boundary',
      'exception',
    ]);
    expect(fixture.published).toMatchObject({
      skillId: 'skill.existing.device',
      status: 'enabled',
      sourceKind: 'experience_evolution',
      validationPassed: true,
    });
    expect(fixture.modelInstruction).toMatchObject({
      operation: 'induce_skill_from_experience',
      currentSkills: [
        {
          skillId: 'skill.existing.device',
          name: 'Existing device Skill',
          capabilities: ['device-status'],
        },
      ],
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
    expect(fixture.currentSkillVersion).toBe(1);
    expect(fixture.repository.candidate).toEqual(result);
  });

  it('rejects a new-Skill decision that targets an existing capability owner', async () => {
    const fixture = setup(true, {
      ...decision(),
      evolutionKind: 'new_skill',
      targetSkillId: 'skill.existing.device',
    });
    await expect(fixture.service.evaluateAndPublish('candidate-1')).rejects.toThrow(
      'SKILL_EVOLUTION_NEW_SKILL_ALREADY_EXISTS',
    );
    expect(fixture.published).toBeUndefined();
  });

  it('creates a new Skill when the model reports a distinct capability boundary', async () => {
    const fixture = setup(true, {
      ...decision(),
      duplicateSkillId: undefined,
      duplicateScore: 0,
      evolutionKind: 'new_skill',
      targetSkillId: 'skill.evolved.device',
      boundaryDecisionSummary: 'The capability boundary is distinct.',
    });
    await expect(fixture.service.evaluateAndPublish('candidate-1')).resolves.toMatchObject({
      status: 'published',
      publishedSkillId: 'skill.evolved.device',
      publishedSkillVersion: 1,
    });
    expect(fixture.published).toMatchObject({ skillId: 'skill.evolved.device' });
  });

  it('revalidates an administrator correction and persists it as evolution experience', async () => {
    const fixture = setup(false);
    const failed = await fixture.service.evaluateAndPublish('candidate-1');
    if (failed.proposedSkill === undefined) throw new Error('EXPECTED_PROPOSED_SKILL');

    const result = await fixture.service.correctAndRevalidate('candidate-1', {
      actor: 'operator@example.test',
      summary: 'Correct the execution guidance for the boundary case.',
      proposedSkill: {
        ...failed.proposedSkill,
        workflowGuidance: 'Corrected guidance validates boundary inputs before the Tool call.',
      },
    });

    expect(result.candidate).toMatchObject({
      status: 'published',
      publishedSkillId: 'skill.existing.device',
      publishedSkillVersion: 2,
      validationReport: { allPassed: true },
    });
    expect(result.correction).toMatchObject({
      correctionId: 'correction-1',
      actor: 'operator@example.test',
      outcome: 'published',
      diff: [
        {
          path: '/workflowGuidance',
          before: 'Call the required Tool once and return its result.',
          after: 'Corrected guidance validates boundary inputs before the Tool call.',
        },
      ],
    });
    await expect(fixture.service.listCorrections('candidate-1')).resolves.toEqual([
      result.correction,
    ]);
  });
});

function setup(allPass: boolean, modelDecision: unknown = decision()) {
  const repository = new MemoryRepository();
  let published: Omit<SkillVersion, 'version' | 'previousVersion' | 'createdAt'> | undefined;
  let currentSkillVersion = 1;
  let modelInstruction: unknown;
  const service = new SkillEvolutionService({
    temporarySkills: repository,
    model: {
      generateStructured: (input) => {
        modelInstruction = JSON.parse(input.instruction) as unknown;
        return Promise.resolve(modelDecision);
      },
    },
    schemas: new AjvJsonSchemaValidator(),
    tools: {
      exists: () => Promise.resolve(true),
      getInputSchema: () => Promise.resolve({ type: 'object' }),
    },
    skills: {
      listCurrentVersions: () => Promise.resolve([existingSkill()]),
      register: (input) => {
        published = input;
        currentSkillVersion = input.skillId === 'skill.existing.device' ? 2 : 1;
        return Promise.resolve({
          ...input,
          version: input.skillId === 'skill.existing.device' ? 2 : 1,
          ...(input.skillId === 'skill.existing.device' ? { previousVersion: 1 } : {}),
          createdAt: timestamp,
        });
      },
    },
    experiences: { listByTool: () => Promise.resolve([history(true), history(false)]) },
    runner: {
      run: ({ proposedSkill, case_ }) =>
        Promise.resolve({
          passed:
            allPass ||
            proposedSkill.workflowGuidance.startsWith('Corrected') ||
            case_.kind !== 'boundary',
          summary:
            allPass ||
            proposedSkill.workflowGuidance.startsWith('Corrected') ||
            case_.kind !== 'boundary'
              ? 'Passed.'
              : 'Boundary failed.',
        }),
      replay: ({ experience }) =>
        Promise.resolve({
          succeeded: experience.successful,
          summary: `Replayed expected ${experience.successful ? 'success' : 'failure'}.`,
        }),
    },
    clock: { now: () => timestamp },
    nextCorrectionId: () => 'correction-1',
  });
  return {
    service,
    repository,
    get published() {
      return published;
    },
    get modelInstruction() {
      return modelInstruction;
    },
    get currentSkillVersion() {
      return currentSkillVersion;
    },
  };
}

const timestamp = '2026-07-12T12:00:00.000Z';

function decision() {
  return {
    consistent: true,
    stable: true,
    generalizable: true,
    duplicateSkillId: 'skill.existing.device',
    duplicateScore: 0.4,
    evolutionKind: 'new_version',
    targetSkillId: 'skill.existing.device',
    boundaryDecisionSummary: 'The capability boundary is unchanged; execution improved.',
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

function existingSkill(): SkillVersion {
  return {
    skillId: 'skill.existing.device',
    version: 1,
    name: 'Existing device Skill',
    summary: 'Reads device state.',
    description: 'Read current device state from the registered service.',
    capabilities: ['device-status'],
    workflowGuidance: 'Call the device Tool.',
    outputInstruction: 'Return device state.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: timestamp,
  };
}

function history(successful: boolean) {
  return {
    experienceId: successful ? 'history-success' : 'history-failure',
    controlId: successful ? 'control-success' : 'control-failure',
    roundIndex: 0,
    contextId: 'context-history',
    goal: {
      goalId: successful ? 'goal-success' : 'goal-failure',
      version: 1,
      title: 'Historical device Goal',
      description: 'Read device state.',
      constraints: [],
      successCriteria: ['State observed'],
    },
    workflow: {
      workflowDefinitionId: successful ? 'workflow-success' : 'workflow-failure',
      version: 1,
      goalId: successful ? 'goal-success' : 'goal-failure',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'result',
          name: 'Historical result',
          type: 'result' as const,
          value: { op: 'literal' as const, value: successful },
        },
      ],
      edges: [],
    },
    instanceId: successful ? 'instance-success' : 'instance-failure',
    skillVersions: [],
    tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
    input: { deviceId: 'device-history' },
    ...(successful ? { result: { status: 'online' } } : {}),
    errors: successful ? {} : { tool: { code: 'HISTORICAL_FAILURE', message: 'Failed.' } },
    evaluation: successful
      ? ({ decision: 'achieved', summary: 'Succeeded.' } as const)
      : ({ decision: 'unachievable', summary: 'Failed.' } as const),
    successful,
    durationMs: 10,
    createdAt: timestamp,
  };
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
  readonly corrections: SkillEvolutionCorrectionExperience[] = [];
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
  saveCorrectionExperience(correction: SkillEvolutionCorrectionExperience) {
    this.corrections.push(correction);
    return Promise.resolve();
  }
  listCorrectionExperiences() {
    return Promise.resolve(this.corrections);
  }
}
