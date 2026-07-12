import { describe, expect, it } from 'vitest';

import type { MemoryItem, MemorySearchHit, ProcessedResultRecord } from '../../domain/src/index.js';
import type { MemoryRepository } from '../src/ports.js';
import { MemoryService } from '../src/memory-service.js';

describe('MemoryService', () => {
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
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => `memory-${String(++sequence)}`,
    });
    const result = processedResult();
    await expect(service.admitProcessedResult(result)).resolves.toMatchObject({
      admitted: [
        {
          type: 'fact',
          summary: 'Device 17 was online.',
          sourceRefs: ['task:task-1', 'processed-result:result-1'],
        },
      ],
      duplicateMemoryIds: [],
    });
    await expect(service.admitProcessedResult(result)).resolves.toEqual({
      admitted: [],
      duplicateMemoryIds: ['memory-1'],
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
      }),
    ).resolves.toMatchObject({ memoryId: 'memory-1', status: 'active' });
    await expect(service.search('target device', 5)).resolves.toMatchObject([
      { item: { memoryId: 'memory-1' }, score: 1 },
    ]);
  });

  it('rejects memories without traceable sources and invalid embedding dimensions', async () => {
    const repository = new MemoryRepositoryFake();
    const service = new MemoryService({
      repository,
      embeddings: { embed: () => Promise.resolve({ providerId: 'embed-v1', vector: [1] }) },
      clock: { now: () => '2026-07-12T00:00:00.000Z' },
      nextId: () => 'memory-1',
    });
    await expect(
      service.create({
        type: 'fact',
        content: {},
        summary: 'No source.',
        sourceRefs: [],
        confidence: 1,
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_SOURCE_REQUIRED' });
    await expect(
      service.create({
        type: 'fact',
        content: {},
        summary: 'Has source.',
        sourceRefs: ['task-1'],
        confidence: 1,
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_EMBEDDING_INVALID' });
  });
});

class MemoryRepositoryFake implements MemoryRepository {
  item?: MemoryItem;
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
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}
