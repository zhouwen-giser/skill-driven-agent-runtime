import { describe, expect, it } from 'vitest';

import type { GoalInputInferenceRecord } from '../../domain/src/index.js';
import type { GoalInputInferenceRepository, StructuredModelProvider } from '../src/ports.js';
import { GoalInputInferenceService } from '../src/goal-input-inference.js';

describe('GoalInputInferenceService', () => {
  it('passes all three evidence classes to the fixed model and persists selected sources', async () => {
    const repository = new InferenceRepository();
    const model = new FixedModel({
      outcome: 'inferred',
      decisionSummary: 'All evidence identifies device-17.',
      usedSourceIds: ['task:prior', 'memory:global', 'result:prior'],
      inferredGoal: {
        title: 'Inspect device',
        description: 'Inspect device-17.',
        constraints: [],
        successCriteria: ['Inspection returned'],
      },
    });
    const service = new GoalInputInferenceService({
      repository,
      memories: {
        search: () =>
          Promise.resolve([
            {
              item: {
                memoryId: 'global',
                type: 'fact',
                content: { deviceId: 'device-17' },
                summary: 'Global target device.',
                status: 'active',
                sourceRefs: ['task:source'],
                supersedes: [],
                confidence: 0.9,
                createdAt: '2026-07-12T00:00:00.000Z',
              },
              score: 1,
            },
          ]),
      },
      model,
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'inference-1',
    });

    await expect(
      service.resolve({
        taskId: 'task-current',
        contextId: 'context-1',
        requestText: 'Inspect it.',
      }),
    ).resolves.toMatchObject({ outcome: 'inferred', usedSources: [{}, {}, {}] });
    expect(model.instruction).toContain('conversation_history');
    expect(model.instruction).toContain('global_memory');
    expect(model.instruction).toContain('existing_data');
    expect(repository.saved?.usedSources.map((source) => source.sourceId)).toEqual([
      'task:prior',
      'memory:global',
      'result:prior',
    ]);
  });

  it('rejects unsupported source IDs and inferred decisions without evidence', async () => {
    const create = (usedSourceIds: string[]) =>
      new GoalInputInferenceService({
        repository: new InferenceRepository(),
        memories: { search: () => Promise.resolve([]) },
        model: new FixedModel({
          outcome: 'inferred',
          decisionSummary: 'Guess.',
          usedSourceIds,
          inferredGoal: {
            title: 'Guess',
            description: 'Guess.',
            constraints: [],
            successCriteria: [],
          },
        }),
        clock: { now: () => '2026-07-12T00:00:00.000Z' },
        nextId: () => 'inference-1',
      });
    await expect(
      create(['unknown']).resolve({ taskId: 'current', contextId: 'context', requestText: 'it' }),
    ).rejects.toMatchObject({ code: 'GOAL_INFERENCE_SOURCE_INVALID' });
    const emptyRepository = new InferenceRepository();
    emptyRepository.empty = true;
    const service = new GoalInputInferenceService({
      repository: emptyRepository,
      memories: { search: () => Promise.resolve([]) },
      model: new FixedModel({
        outcome: 'inferred',
        decisionSummary: 'Guess.',
        usedSourceIds: [],
        inferredGoal: {
          title: 'Guess',
          description: 'Guess.',
          constraints: [],
          successCriteria: [],
        },
      }),
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'inference-1',
    });
    await expect(
      service.resolve({ taskId: 'current', contextId: 'context', requestText: 'it' }),
    ).rejects.toMatchObject({ code: 'GOAL_INFERENCE_SOURCE_REQUIRED' });
  });
});

class InferenceRepository implements GoalInputInferenceRepository {
  saved?: GoalInputInferenceRecord;
  empty = false;
  collect() {
    return Promise.resolve(
      this.empty
        ? { conversationHistory: [], existingData: [] }
        : {
            conversationHistory: [
              {
                sourceId: 'task:prior',
                kind: 'conversation_history' as const,
                summary: 'Prior task.',
                content: { deviceId: 'device-17' },
              },
            ],
            existingData: [
              {
                sourceId: 'result:prior',
                kind: 'existing_data' as const,
                summary: 'Prior result.',
                content: { deviceId: 'device-17' },
              },
            ],
          },
    );
  }
  save(record: GoalInputInferenceRecord) {
    this.saved = record;
    return Promise.resolve();
  }
  listByTask() {
    return Promise.resolve(this.saved === undefined ? [] : [this.saved]);
  }
}

class FixedModel implements StructuredModelProvider {
  instruction = '';
  readonly #output: unknown;
  constructor(output: unknown) {
    this.#output = output;
  }
  generateStructured(input: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    this.instruction = input.instruction;
    return Promise.resolve(this.#output);
  }
}
