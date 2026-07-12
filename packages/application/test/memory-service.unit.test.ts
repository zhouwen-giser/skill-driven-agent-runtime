import { describe, expect, it } from 'vitest';

import type { MemoryItem, MemorySearchHit } from '../../domain/src/index.js';
import type { MemoryRepository } from '../src/ports.js';
import { MemoryService } from '../src/memory-service.js';

describe('MemoryService', () => {
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
