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
  it('persists exact schema-valid input without invoking the model', async () => {
    const repository = new MemoryRepository();
    const model = new DecisionModel(new Error('MODEL_MUST_NOT_BE_CALLED'));
    const service = resolutionService(repository, model);

    await expect(
      service.resolveExact({
        task: task(),
        goal,
        skill,
        supplementaryInputs: [],
        structuredInput: { deviceId: 'public-device-1' },
        sourceRef: 'node-control:binding-1:resource:public-device-1',
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      structuredInput: { deviceId: 'public-device-1' },
      sourceRefs: ['node-control:binding-1:resource:public-device-1'],
    });
    expect(model.calls).toHaveLength(0);
  });

  it('fails closed when exact deterministic input violates the Skill schema', async () => {
    await expect(
      resolutionService(
        new MemoryRepository(),
        new DecisionModel(new Error('MODEL_MUST_NOT_BE_CALLED')),
      ).resolveExact({
        task: task(),
        goal,
        skill,
        supplementaryInputs: [],
        structuredInput: { deviceId: 42 },
        sourceRef: 'node-control:binding-1:resource:public-device-1',
      }),
    ).rejects.toMatchObject({ code: 'SKILL_INPUT_EXACT_SCHEMA_MISMATCH' });
  });

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

  it('drops a stale model unresolved marker when authoritative metadata supplied the field', async () => {
    const result = await resolutionService(
      new MemoryRepository(),
      new DecisionModel({
        structuredInput: {},
        unresolvedFields: ['deviceId'],
        sourceRefs: ['task:task-1:request-text'],
        decisionSummary: 'The lower-priority request text omitted the device.',
      }),
    ).resolve({
      task: task({ structured_input: { deviceId: 'device-authoritative' } }),
      goal,
      skill,
      supplementaryInputs: [],
    });

    expect(result).toMatchObject({
      status: 'resolved',
      structuredInput: { deviceId: 'device-authoritative' },
      unresolvedFields: [],
    });
  });

  it('uses a stable root marker when schema validation fails without a field path', async () => {
    const rootInvalidValidator = {
      checkSchema: (): JsonSchemaValidationResult => ({ valid: true, errors: [] }),
      validate: (): JsonSchemaValidationResult => ({
        valid: false,
        errors: ['/ must be object'],
      }),
    };
    const result = await new SkillInputResolutionService({
      model: new DecisionModel({
        structuredInput: 'not-an-object',
        unresolvedFields: [],
        sourceRefs: ['task:task-1:request-text'],
        decisionSummary: 'The request produced an invalid root value.',
      }),
      schemas: rootInvalidValidator,
      records: new MemoryRepository(),
      clock: { now: () => timestamp },
      nextId: () => 'resolution-root-invalid',
    }).resolve({
      task: task(),
      goal,
      skill: { ...skill, inputSchema: { type: 'object' } },
      supplementaryInputs: [],
    });

    expect(result).toMatchObject({ status: 'input_required', unresolvedFields: ['$'] });
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
                durability: 'durable',
                authority: 'admin',
                durabilityReason: 'The historical identifier is stable.',
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

  it('does not let the model choose among multiple governed resource identifiers', async () => {
    const service = managedResourceResolutionService(
      new DecisionModel({
        structuredInput: { resourceId: 'vehicle:ugv-a' },
        unresolvedFields: [],
        sourceRefs: ['task:task-1:request-text'],
        decisionSummary: 'The model guessed one of two resources.',
      }),
    );

    await expect(
      service.resolve({
        task: task({}, 'Read the current vehicle state.'),
        goal,
        skill: managedResourceSkill(['vehicle:ugv-a', 'vehicle:ugv-b']),
        supplementaryInputs: [],
      }),
    ).resolves.toMatchObject({
      status: 'input_required',
      structuredInput: {},
      unresolvedFields: ['resourceId'],
    });
  });

  it('resolves a multi-resource enum only from an exact user value or structured input', async () => {
    const skillWithResources = managedResourceSkill(['vehicle:ugv-a', 'vehicle:ugv-b']);
    const fromText = await managedResourceResolutionService(
      new DecisionModel({
        structuredInput: { resourceId: 'vehicle:ugv-a' },
        unresolvedFields: [],
        sourceRefs: [],
        decisionSummary: 'Copied the exact requested resource.',
      }),
    ).resolve({
      task: task({}, 'Read state for vehicle:ugv-b.'),
      goal,
      skill: skillWithResources,
      supplementaryInputs: [],
    });
    expect(fromText).toMatchObject({
      status: 'resolved',
      structuredInput: { resourceId: 'vehicle:ugv-b' },
      sourceRefs: ['task:task-1:request-text'],
    });

    const fromMetadata = await managedResourceResolutionService(
      new DecisionModel({
        structuredInput: { resourceId: 'vehicle:ugv-a' },
        unresolvedFields: [],
        sourceRefs: [],
        decisionSummary: 'Structured input is authoritative.',
      }),
    ).resolve({
      task: task({ structured_input: { resourceId: 'vehicle:ugv-b' } }, 'Read the vehicle state.'),
      goal,
      skill: skillWithResources,
      supplementaryInputs: [],
    });
    expect(fromMetadata).toMatchObject({
      status: 'resolved',
      structuredInput: { resourceId: 'vehicle:ugv-b' },
      sourceRefs: ['a2a-metadata:structured_input'],
    });
  });

  it('selects the sole governed resource without asking the model to invent identity', async () => {
    await expect(
      managedResourceResolutionService(
        new DecisionModel({
          structuredInput: {},
          unresolvedFields: [],
          sourceRefs: [],
          decisionSummary: 'No resource was inferred.',
        }),
      ).resolve({
        task: task({}, 'Read the current vehicle state.'),
        goal,
        skill: managedResourceSkill(['vehicle:ugv-only']),
        supplementaryInputs: [],
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      structuredInput: { resourceId: 'vehicle:ugv-only' },
    });
  });

  it('treats a schema const as the sole governed resource', async () => {
    const constSkill = managedResourceSkill(['vehicle:ugv-only']);
    const inputSchema = constSkill.inputSchema as Readonly<Record<string, unknown>>;
    await expect(
      managedResourceResolutionService(
        new DecisionModel({
          structuredInput: {},
          unresolvedFields: [],
          sourceRefs: [],
          decisionSummary: 'No resource was inferred.',
        }),
      ).resolve({
        task: task({}, 'Read current state.'),
        goal,
        skill: {
          ...constSkill,
          inputSchema: {
            ...inputSchema,
            properties: { resourceId: { type: 'string', const: 'vehicle:ugv-only' } },
          },
        },
        supplementaryInputs: [],
      }),
    ).resolves.toMatchObject({
      status: 'resolved',
      structuredInput: { resourceId: 'vehicle:ugv-only' },
    });
  });

  it('does not replace an invalid explicit resource with the sole schema value', async () => {
    await expect(
      managedResourceResolutionService(
        new DecisionModel({
          structuredInput: {},
          unresolvedFields: [],
          sourceRefs: [],
          decisionSummary: 'Structured input is authoritative even when invalid.',
        }),
      ).resolve({
        task: task(
          { structured_input: { resourceId: 'vehicle:outside-authority' } },
          'Read current state.',
        ),
        goal,
        skill: managedResourceSkill(['vehicle:ugv-only']),
        supplementaryInputs: [],
      }),
    ).resolves.toMatchObject({
      status: 'input_required',
      structuredInput: { resourceId: 'vehicle:outside-authority' },
      unresolvedFields: ['resourceId'],
    });
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

function managedResourceResolutionService(model: DecisionModel) {
  return new SkillInputResolutionService({
    model,
    schemas: enumeratedResourceSchemaValidator,
    records: new MemoryRepository(),
    clock: { now: () => timestamp },
    nextId: () => 'resolution-managed-resource',
    policy: { resourceEnumeration: 'explicit_or_exact_text' },
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

const enumeratedResourceSchemaValidator = {
  checkSchema: (): JsonSchemaValidationResult => ({ valid: true, errors: [] }),
  validate: (schema: unknown, value: unknown): JsonSchemaValidationResult => {
    const schemaRecord = isRecord(schema) ? schema : {};
    const properties = isRecord(schemaRecord['properties']) ? schemaRecord['properties'] : {};
    const resourceDefinition = isRecord(properties['resourceId']) ? properties['resourceId'] : {};
    const allowed = Array.isArray(resourceDefinition['enum'])
      ? resourceDefinition['enum']
      : typeof resourceDefinition['const'] === 'string'
        ? [resourceDefinition['const']]
        : [];
    const resourceId = isRecord(value) ? value['resourceId'] : undefined;
    return typeof resourceId === 'string' && allowed.includes(resourceId)
      ? { valid: true, errors: [] }
      : {
          valid: false,
          errors: [
            resourceId === undefined
              ? "/ must have required property 'resourceId'"
              : '/resourceId must be equal to one of the allowed values',
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

function task(
  metadata: Readonly<Record<string, unknown>> = {},
  requestText = 'Inspect device-17.',
): AgentTask {
  return {
    taskId: 'task-1',
    contextId: 'context-1',
    userId: 'operator',
    requestText,
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

function managedResourceSkill(resources: readonly string[]): SkillVersion {
  return {
    ...skill,
    skillId: 'skill.vehicle.read-state',
    capabilities: ['vehicle.ugv.read-state'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId'],
      properties: {
        resourceId: { type: 'string', enum: [...resources] },
      },
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
