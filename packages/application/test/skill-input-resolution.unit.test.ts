import { describe, expect, it } from 'vitest';

import type {
  AgentTask,
  Goal,
  SkillInputResolutionRecord,
  SkillVersion,
} from '../../domain/src/index.js';
import { SkillInputResolutionService, type JsonSchemaValidationResult } from '../src/index.js';

const timestamp = '2026-07-16T00:00:00.000Z';

describe('SkillInputResolutionService', () => {
  it('gives explicit A2A structured input precedence over conflicting model extraction', async () => {
    const repository = new MemoryRepository();
    const model = new DecisionModel({
      structuredInput: { deviceId: 'device-from-text', mode: 'model' },
      unresolvedFields: [],
      sourceRefs: ['task:task-1:request-text'],
      decisionSummary: 'Resolved conflicting candidates by priority.',
    });
    const service = resolutionService(repository, model);

    const result = await service.resolve({
      task: task({ structured_input: { deviceId: 'device-from-metadata' } }),
      goal,
      skill,
      supplementaryInputs: [],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      structuredInput: { deviceId: 'device-from-metadata', mode: 'model' },
      sourceRefs: expect.arrayContaining(['a2a-metadata:structured_input']),
    });
    expect(JSON.stringify(model.calls[0])).toContain('a2a_metadata_structured_input');
  });

  it('accepts a schema-valid value extracted from request text', async () => {
    const repository = new MemoryRepository();
    const service = resolutionService(
      repository,
      new DecisionModel({
        structuredInput: { deviceId: 'device-17' },
        unresolvedFields: [],
        sourceRefs: ['task:task-1:request-text'],
        decisionSummary: 'Extracted device-17 from request text.',
      }),
    );

    await expect(
      service.resolve({ task: task(), goal, skill, supplementaryInputs: [] }),
    ).resolves.toMatchObject({
      status: 'resolved',
      structuredInput: { deviceId: 'device-17' },
    });
  });

  it('persists input-required evidence for missing or illegal required fields', async () => {
    const missingRepository = new MemoryRepository();
    const missing = await resolutionService(
      missingRepository,
      new DecisionModel({
        structuredInput: {},
        unresolvedFields: ['deviceId'],
        sourceRefs: ['task:task-1:request-text'],
        decisionSummary: 'The request does not identify a device.',
      }),
    ).resolve({ task: task(), goal, skill, supplementaryInputs: [] });
    expect(missing).toMatchObject({ status: 'input_required', unresolvedFields: ['deviceId'] });

    const invalid = await resolutionService(
      new MemoryRepository(),
      new DecisionModel({
        structuredInput: { deviceId: 'model-valid' },
        unresolvedFields: [],
        sourceRefs: [],
        decisionSummary: 'The model found a candidate.',
      }),
    ).resolve({
      task: task({ structured_input: { deviceId: 42 } }),
      goal,
      skill,
      supplementaryInputs: [],
    });
    expect(invalid).toMatchObject({
      status: 'input_required',
      structuredInput: { deviceId: 42 },
      unresolvedFields: ['deviceId'],
    });
  });

  it('includes context and Memory only as bounded evidence and audits model failures', async () => {
    const repository = new MemoryRepository();
    repository.contextEvidence = [
      { sourceRef: 'processed-result:prior', value: { deviceId: 'old' } },
    ];
    const model = new DecisionModel(new Error('provider failed'));
    const service = new SkillInputResolutionService({
      model,
      schemas: deviceSchemaValidator,
      records: repository,
      memories: {
        searchForStage: () =>
          Promise.resolve([
            {
              item: {
                memoryId: 'memory-1',
                type: 'fact',
                content: { deviceId: 'remembered' },
                summary: 'Historical device identifier.',
                status: 'active',
                sourceRefs: ['task:old'],
                supersedes: [],
                confidence: 0.8,
                createdAt: timestamp,
              },
              score: 0.9,
            },
          ]),
      },
      clock: { now: () => timestamp },
      nextId: () => 'resolution-1',
    });

    await expect(
      service.resolve({ task: task(), goal, skill, supplementaryInputs: [] }),
    ).rejects.toMatchObject({ code: 'SKILL_INPUT_RESOLUTION_FAILED' });
    expect(repository.records).toContainEqual(
      expect.objectContaining({ status: 'failed', resolutionId: 'resolution-1' }),
    );
    expect(JSON.stringify(model.calls[0])).toContain('non_authoritative_evidence');
    expect(JSON.stringify(model.calls[0])).toContain('processed-result:prior');
  });
});

function resolutionService(repository: MemoryRepository, model: DecisionModel) {
  return new SkillInputResolutionService({
    model,
    schemas: deviceSchemaValidator,
    records: repository,
    clock: { now: () => timestamp },
    nextId: () => `resolution-${String(repository.records.length + 1)}`,
  });
}

const deviceSchemaValidator = {
  checkSchema: (): JsonSchemaValidationResult => ({ valid: true, errors: [] }),
  validate: (_schema: unknown, value: unknown): JsonSchemaValidationResult => {
    const deviceId =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)['deviceId']
        : undefined;
    return typeof deviceId === 'string' && deviceId !== ''
      ? { valid: true, errors: [] }
      : {
          valid: false,
          errors: [
            deviceId === undefined
              ? '/ must have required property deviceId'
              : '/deviceId must be string',
          ],
        };
  },
};

class DecisionModel {
  readonly calls: unknown[] = [];
  readonly #decision: unknown;

  constructor(decision: unknown) {
    this.#decision = decision;
  }

  generateStructured(input: unknown) {
    this.calls.push(input);
    return this.#decision instanceof Error
      ? Promise.reject(this.#decision)
      : Promise.resolve(this.#decision);
  }
}

class MemoryRepository {
  readonly records: SkillInputResolutionRecord[] = [];
  contextEvidence: readonly Readonly<{ sourceRef: string; value: unknown }>[] = [];

  save(record: SkillInputResolutionRecord) {
    this.records.push(record);
    return Promise.resolve();
  }

  find(resolutionId: string) {
    return Promise.resolve(this.records.find((record) => record.resolutionId === resolutionId));
  }

  findLatest(taskId: string, skillId: string, skillVersion: number, goalVersion: number) {
    return Promise.resolve(
      [...this.records]
        .reverse()
        .find(
          (record) =>
            record.taskId === taskId &&
            record.skillId === skillId &&
            record.skillVersion === skillVersion &&
            record.goalVersion === goalVersion,
        ),
    );
  }

  listByTask(taskId: string) {
    return Promise.resolve(this.records.filter((record) => record.taskId === taskId));
  }

  listProcessedDataByContext() {
    return Promise.resolve(this.contextEvidence);
  }
}

const goal: Goal = {
  goalId: 'goal-1',
  contextId: 'context-1',
  version: 1,
  title: 'Inspect device',
  description: 'Inspect the requested device.',
  constraints: ['read-only'],
  successCriteria: ['Return status'],
  status: 'active',
  createdAt: timestamp,
  updatedAt: timestamp,
};

const skill: SkillVersion = {
  skillId: 'skill.inspect',
  version: 1,
  name: 'Inspect device',
  summary: 'Inspect one device.',
  description: 'Read a device status.',
  capabilities: ['device-status'],
  workflowGuidance: 'Call the read Tool.',
  outputInstruction: 'Return status.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId'],
    properties: { deviceId: { type: 'string', minLength: 1 } },
  },
  outputSchema: { type: 'object' },
  toolPolicy: { required: [], optional: [], forbidden: [] },
  runtimePolicy: { autoConfirmPlan: false },
  status: 'enabled',
  sourceKind: 'admin',
  validationPassed: true,
  createdAt: timestamp,
};

function task(metadata: Readonly<Record<string, unknown>> = {}): AgentTask {
  return {
    taskId: 'task-1',
    contextId: 'context-1',
    userId: 'operator',
    requestText: 'Inspect device-17.',
    requestMetadata: metadata,
    phase: 'skill_resolution',
    phaseMessage: 'Skill selected.',
    goalId: goal.goalId,
    goalVersion: goal.version,
    selectedSkillId: skill.skillId,
    selectedSkillVersion: skill.version,
    skillSelectionId: 'selection-1',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
