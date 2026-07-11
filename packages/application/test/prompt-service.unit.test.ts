import { describe, expect, it } from 'vitest';
import type { ModelStage, PromptEffectSummary, PromptVersion } from '../../domain/src/index.js';
import { PromptService, type PromptRepository } from '../src/index.js';

describe('PromptService', () => {
  it('keeps automatic candidates inactive until administrator publication', async () => {
    const repository = new MemoryPromptRepository();
    const service = createService(repository);
    const candidate = await service.create({
      promptId: 'prompt.skill',
      stage: 'skill_authoring',
      content: 'Candidate {{instruction}}',
      source: 'auto_candidate',
      publish: false,
    });
    expect(candidate.status).toBe('candidate');
    expect(repository.current).toBeUndefined();
    await expect(
      service.create({
        promptId: 'prompt.skill',
        stage: 'skill_authoring',
        content: 'Unsafe {{instruction}}',
        source: 'auto_candidate',
        publish: true,
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_AUTO_PUBLISH_FORBIDDEN' });
    const published = await service.publish(candidate.promptId, candidate.version);
    expect(published).toMatchObject({
      version: 2,
      previousVersion: 1,
      status: 'enabled',
      source: 'admin',
    });
    await expect(service.disable(candidate.promptId)).resolves.toMatchObject({
      version: 3,
      status: 'disabled',
    });
  });
  it('rolls back by creating a new enabled immutable version', async () => {
    const repository = new MemoryPromptRepository();
    const service = createService(repository);
    await service.create({
      promptId: 'prompt.plan',
      stage: 'workflow_planning',
      content: 'First {{instruction}}',
      source: 'admin',
      publish: true,
    });
    await service.create({
      promptId: 'prompt.plan',
      stage: 'workflow_planning',
      content: 'Second {{instruction}}',
      source: 'admin',
      publish: true,
    });
    await expect(service.rollback('prompt.plan', 1)).resolves.toMatchObject({
      version: 3,
      previousVersion: 2,
      content: 'First {{instruction}}',
      source: 'rollback',
    });
  });
});
function createService(repository: PromptRepository) {
  return new PromptService({ repository, clock: { now: () => '2026-07-12T00:00:00.000Z' } });
}
class MemoryPromptRepository implements PromptRepository {
  versions: PromptVersion[] = [];
  current: PromptVersion | undefined;
  findCurrent(stage: ModelStage) {
    return Promise.resolve(
      this.current?.stage === stage && this.current.status === 'enabled' ? this.current : undefined,
    );
  }
  findVersion(promptId: string, version: number) {
    return Promise.resolve(
      this.versions.find((item) => item.promptId === promptId && item.version === version),
    );
  }
  listVersions(promptId: string) {
    return Promise.resolve(this.versions.filter((item) => item.promptId === promptId));
  }
  saveVersion(version: PromptVersion, setCurrent: boolean) {
    this.versions.push(version);
    if (setCurrent) this.current = version;
    return Promise.resolve();
  }
  effect(promptId: string, version: number): Promise<PromptEffectSummary> {
    return Promise.resolve({
      promptId,
      version,
      invocationCount: 0,
      successCount: 0,
      failureCount: 0,
      averageDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  }
}
