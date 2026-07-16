import { describe, expect, it } from 'vitest';

import type { SkillVersion } from '../../domain/src/index.js';
import { PersistedSkillSemanticRetriever, type SkillEmbeddingRepository } from '../src/index.js';

describe('PersistedSkillSemanticRetriever', () => {
  it('persists rebuildable candidate projections and delegates scoring to pgvector repository', async () => {
    const repository = new MemoryEmbeddingRepository();
    const retriever = new PersistedSkillSemanticRetriever({
      embeddings: {
        embed: (text) =>
          Promise.resolve({
            providerId: 'embedding.test.v1',
            vector: text.includes('device') ? [1, 0] : [0, 1],
          }),
      },
      repository,
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
    });

    await expect(retriever.score(goalContract, [skill()])).resolves.toEqual({
      'skill.device': 0.92,
    });
    expect(repository.saved[0]).toMatchObject({
      skillId: 'skill.device',
      skillVersion: 2,
      providerId: 'embedding.test.v1',
    });
    expect(repository.saved[0]?.searchableText).toContain('Device inspection');
  });

  it('rejects provider drift within one retrieval', async () => {
    let calls = 0;
    const retriever = new PersistedSkillSemanticRetriever({
      embeddings: {
        embed: () =>
          Promise.resolve({ providerId: calls++ === 0 ? 'provider-a' : 'provider-b', vector: [1] }),
      },
      repository: new MemoryEmbeddingRepository(),
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
    });
    await expect(retriever.score(goalContract, [skill()])).rejects.toMatchObject({
      code: 'SKILL_EMBEDDING_INCONSISTENT',
    });
  });
});

const goalContract = {
  goalId: 'goal-1',
  version: 1,
  title: 'Inspect device',
  description: 'inspect device',
  constraints: ['read-only'],
  successCriteria: ['status returned'],
} as const;

function skill(): SkillVersion {
  return {
    skillId: 'skill.device',
    version: 2,
    previousVersion: 1,
    name: 'Device inspection',
    summary: 'Inspect devices.',
    description: 'Read current device state.',
    capabilities: ['device-inspection'],
    workflowGuidance: 'Read then report.',
    outputInstruction: 'Return status.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-11T10:00:00.000Z',
  };
}

class MemoryEmbeddingRepository implements SkillEmbeddingRepository {
  saved: Parameters<SkillEmbeddingRepository['upsert']>[0][] = [];
  upsert(input: Parameters<SkillEmbeddingRepository['upsert']>[0]) {
    this.saved.push(input);
    return Promise.resolve();
  }
  cosineScores() {
    return Promise.resolve({ 'skill.device': 0.92 });
  }
}
