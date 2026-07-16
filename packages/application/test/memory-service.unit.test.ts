import { describe, expect, it } from 'vitest';

import type {
  MemoryItem,
  MemorySearchHit,
  MemoryStatusTransition,
  ProcessedResultRecord,
} from '../../domain/src/index.js';
import type { MemoryRepository } from '../src/ports.js';
import { MemoryService } from '../src/memory-service.js';

describe('MemoryService', () => {
  it('atomically supersedes active Memory and records one-way invalidation history', async () => {
    const repository = new MemoryRepositoryFake();
    repository.item = memoryItem('fact');
    let transitionSequence = 0;
    const service = new MemoryService({
      repository,
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] }) },
      model: {
        generateStructured: () =>
          Promise.resolve({
            type: 'fact',
            content: { target: 'device-18' },
            summary: 'The target is device-18.',
            confidence: 0.95,
            durability: 'durable',
            authority: 'admin',
            durabilityReason: 'An operator identified a stable target.',
          }),
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'memory-replacement',
      nextTransitionId: () => `transition-${String(++transitionSequence)}`,
    });
    const replacement = await service.supersede(repository.item.memoryId, {
      type: 'fact',
      content: { raw: 'device 18' },
      summary: 'new target',
      sourceRefs: ['task:new-evidence'],
      confidence: 0.8,
      actor: 'operator.test',
      reason: 'New evidence.',
    });
    expect(replacement).toMatchObject({
      memoryId: 'memory-replacement',
      supersedes: ['memory-fact'],
      status: 'active',
    });
    expect(repository.transitions).toMatchObject([
      {
        memoryId: 'memory-fact',
        toStatus: 'superseded',
        replacementMemoryId: 'memory-replacement',
      },
    ]);
    await service.invalidate(replacement.memoryId, 'operator.test', 'Retracted evidence.');
    await expect(service.get(replacement.memoryId)).resolves.toMatchObject({ status: 'invalid' });
    expect(repository.transitions.at(-1)).toMatchObject({
      memoryId: 'memory-replacement',
      toStatus: 'invalid',
    });
    await expect(
      service.invalidate(replacement.memoryId, 'operator.test', 'Again.'),
    ).rejects.toMatchObject({ code: 'MEMORY_STATUS_CONFLICT' });
  });

  it('uses stage-specific query templates and filters memory types', async () => {
    const repository = new MemoryRepositoryFake();
    let queryText = '';
    const service = new MemoryService({
      repository,
      embeddings: {
        embed: (text) => {
          queryText = text;
          return Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] });
        },
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'memory-stage',
    });
    repository.item = memoryItem('skill_learning');
    await expect(service.searchForStage('intent', 'Inspect device')).resolves.toEqual([]);
    expect(queryText).toBe('Intent recognition evidence for request: Inspect device');
    await expect(
      service.searchForStage('skill_selection', 'Inspect device'),
    ).resolves.toMatchObject([{ item: { type: 'skill_learning' } }]);
    expect(queryText).toBe('Skill selection outcomes and lessons for Goal: Inspect device');
  });

  it('admits valuable structured candidates with sources and deduplicates them', async () => {
    const repository = new MemoryRepositoryFake();
    let sequence = 0;
    const service = new MemoryService({
      repository,
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] }) },
      model: {
        generateStructured: () =>
          Promise.resolve({
            type: 'fact',
            content: { lesson: 'Use the stable inspection procedure.' },
            summary: 'Use the stable inspection procedure.',
            confidence: 0.9,
            durability: 'durable',
            authority: 'skill_experience',
            durabilityReason: 'The procedure is reusable across executions.',
          }),
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => `memory-${String(++sequence)}`,
    });
    const result = processedResult();
    await expect(service.admitProcessedResult(result)).resolves.toMatchObject({
      admitted: [
        {
          type: 'fact',
          summary: 'Use the stable inspection procedure.',
          sourceRefs: ['task:task-1', 'processed-result:result-1'],
        },
      ],
      duplicateMemoryIds: [],
    });
    await expect(service.admitProcessedResult(result)).resolves.toEqual({
      admitted: [],
      duplicateMemoryIds: ['memory-1'],
      rejected: [],
    });
  });

  it('requires Schema-constrained model refinement for externally submitted candidates', async () => {
    const repository = new MemoryRepositoryFake();
    const service = new MemoryService({
      repository,
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] }) },
      model: {
        generateStructured: (request) => {
          expect(request.stage).toBe('result_processing');
          expect(request.instruction).toContain('refine_memory');
          return Promise.resolve({
            type: 'fact',
            content: { deviceId: 'device-17' },
            summary: 'The target device is device-17.',
            confidence: 0.95,
            durability: 'durable',
            authority: 'admin',
            durabilityReason: 'The operator supplied a stable device identity.',
          });
        },
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'memory-refined',
    });
    await expect(
      service.refine({
        type: 'fact',
        content: { raw: 'device 17' },
        summary: 'raw candidate',
        sourceRefs: ['task:task-1'],
        confidence: 0.5,
      }),
    ).resolves.toMatchObject({
      memoryId: 'memory-refined',
      summary: 'The target device is device-17.',
      sourceRefs: ['task:task-1'],
      durability: 'durable',
      authority: 'admin',
    });

    const incomplete = new MemoryService({
      repository: new MemoryRepositoryFake(),
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] }) },
      model: {
        generateStructured: () =>
          Promise.resolve({
            type: 'fact',
            content: { deviceId: 'device-17' },
            summary: 'Missing production fields.',
            confidence: 0.5,
          }),
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'memory-incomplete',
    });
    await expect(
      incomplete.refine({
        type: 'fact',
        content: {},
        summary: 'Incomplete.',
        sourceRefs: ['task:task-1'],
        confidence: 0.5,
      }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('rejects volatile device state and unknown durability while admitting durable Skill experience', async () => {
    const repository = new MemoryRepositoryFake();
    let sequence = 0;
    const service = new MemoryService({
      repository,
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] }) },
      model: {
        generateStructured: (request) => {
          const input = JSON.parse(request.instruction) as {
            candidate: {
              type: MemoryItem['type'];
              content: Readonly<Record<string, unknown>>;
              summary: string;
              confidence: number;
              authorityHint: MemoryItem['authority'];
            };
          };
          const dynamic = input.candidate.summary.includes('online');
          const uncertain = input.candidate.summary.includes('uncertain');
          return Promise.resolve({
            type: input.candidate.type,
            content: input.candidate.content,
            summary: input.candidate.summary,
            confidence: input.candidate.confidence,
            durability: dynamic ? 'volatile' : uncertain ? 'unknown' : 'durable',
            authority: dynamic ? 'mcp' : input.candidate.authorityHint,
            durabilityReason: dynamic
              ? 'Online status changes and must be queried again.'
              : uncertain
                ? 'The evidence does not establish stability.'
                : 'The Skill lesson is reusable across executions.',
          });
        },
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => `memory-${String(++sequence)}`,
    });

    await expect(service.admitProcessedResult(processedResult())).resolves.toMatchObject({
      admitted: [],
      rejected: [{ durability: 'volatile', authority: 'mcp' }],
    });
    await expect(
      service.refine({
        type: 'fact',
        content: { observation: 'uncertain' },
        summary: 'uncertain state',
        sourceRefs: ['task:task-1'],
        confidence: 0.5,
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_DURABILITY_NOT_ADMITTED' });
    await expect(
      service.recordEvolution({
        kind: 'skill_correction',
        sourceRef: 'skill-correction:1',
        summary: 'Reuse the validated inspection boundary.',
        content: { rule: 'validate before execution' },
        confidence: 0.95,
      }),
    ).resolves.toMatchObject({
      durability: 'durable',
      authority: 'skill_experience',
      status: 'active',
    });
  });

  it('creates source-linked global memory and retrieves it semantically', async () => {
    const repository = new MemoryRepositoryFake();
    const service = new MemoryService({
      repository,
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1, 0, 0] }) },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'memory-1',
    });
    await expect(
      service.create({
        type: 'fact',
        content: { deviceId: 'device-17' },
        summary: 'The target device is device-17.',
        sourceRefs: ['task-source'],
        confidence: 0.9,
        durability: 'durable',
        authority: 'admin',
        durabilityReason: 'An operator supplied a stable target identifier.',
      }),
    ).resolves.toMatchObject({ memoryId: 'memory-1', status: 'active' });
    await expect(service.search('target device', 5)).resolves.toMatchObject([
      { item: { memoryId: 'memory-1' }, score: 1 },
    ]);
  });

  it('supports provider dimensions 3, 8, and 1536 and rejects empty or non-finite vectors', async () => {
    const repository = new MemoryRepositoryFake();
    let dimensions = 3;
    let vector = Array<number>(dimensions).fill(0.5);
    let sequence = 0;
    const service = new MemoryService({
      repository,
      embeddings: {
        embed: () => Promise.resolve({ providerId: 'embed-v1', vector }),
      },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => `memory-${String(++sequence)}`,
    });
    await expect(
      service.create({
        type: 'fact',
        content: {},
        summary: 'No source.',
        sourceRefs: [],
        confidence: 1,
        durability: 'durable',
        authority: 'admin',
        durabilityReason: 'Stable.',
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_SOURCE_REQUIRED' });
    for (dimensions of [3, 8, 1536]) {
      vector = Array<number>(dimensions).fill(0.5);
      await expect(
        service.create({
          type: 'fact',
          content: { dimensions },
          summary: `Embedding with ${String(dimensions)} dimensions.`,
          sourceRefs: [`task-${String(dimensions)}`],
          confidence: 1,
          durability: 'durable',
          authority: 'admin',
          durabilityReason: 'Stable test evidence.',
        }),
      ).resolves.toMatchObject({ status: 'active' });
    }
    const invalidEmbedding = () =>
      service.create({
        type: 'fact',
        content: {},
        summary: 'Has source.',
        sourceRefs: ['task-1'],
        confidence: 1,
        durability: 'durable',
        authority: 'admin',
        durabilityReason: 'Stable.',
      });
    vector = [];
    await expect(invalidEmbedding()).rejects.toMatchObject({ code: 'MEMORY_EMBEDDING_INVALID' });
    vector = [Number.NaN];
    await expect(invalidEmbedding()).rejects.toMatchObject({ code: 'MEMORY_EMBEDDING_INVALID' });
  });
});

class MemoryRepositoryFake implements MemoryRepository {
  item?: MemoryItem;
  readonly transitions: MemoryStatusTransition[] = [];
  save(item: MemoryItem) {
    this.item = item;
    return Promise.resolve();
  }
  find(memoryId: string) {
    return Promise.resolve(this.item?.memoryId === memoryId ? this.item : undefined);
  }
  search(): Promise<readonly MemorySearchHit[]> {
    return Promise.resolve(this.item === undefined ? [] : [{ item: this.item, score: 1 }]);
  }
  saveAndSupersede(
    replacement: MemoryItem,
    _embedding: Readonly<{ providerId: string; vector: readonly number[] }>,
    transitions: readonly MemoryStatusTransition[],
  ) {
    this.item = replacement;
    this.transitions.push(...transitions);
    return Promise.resolve();
  }
  invalidate(transition: MemoryStatusTransition) {
    if (this.item !== undefined) this.item = { ...this.item, status: 'invalid' };
    this.transitions.push(transition);
    return Promise.resolve();
  }
  listTransitions(memoryId: string) {
    return Promise.resolve(this.transitions.filter((item) => item.memoryId === memoryId));
  }
}

function processedResult(): ProcessedResultRecord {
  return {
    resultId: 'result-1',
    taskId: 'task-1',
    skillId: 'skill-1',
    skillVersion: 1,
    normalized: {
      data: { status: 'online' },
      errors: [],
      originalSize: 19,
      contextValue: { status: 'online' },
      contextTruncated: false,
      summary: 'Successful result.',
    },
    output: { text: 'Online.', structured: { status: 'online' } },
    facts: [],
    valuable: true,
    valueSummary: 'Useful.',
    memoryCandidates: [{ kind: 'fact', content: '  Device 17  was online. ', confidence: 0.9 }],
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}

function memoryItem(type: MemoryItem['type']): MemoryItem {
  return {
    memoryId: `memory-${type}`,
    type,
    content: { lesson: 'Use the inspection Skill.' },
    summary: 'Inspection lesson.',
    status: 'active',
    sourceRefs: ['task:task-1'],
    supersedes: [],
    confidence: 0.9,
    durability: 'durable',
    authority: 'skill_experience',
    durabilityReason: 'The lesson is reusable across executions.',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}
