import type { ModelStage, PromptEffectSummary, PromptVersion } from '../../domain/src/index.js';
import type { Clock, PromptRepository } from './ports.js';
import type { MemoryService } from './memory-service.js';

export class PromptService {
  readonly #repository: PromptRepository;
  readonly #clock: Clock;
  readonly #memories: Pick<MemoryService, 'recordEvolution'> | undefined;
  constructor(
    dependencies: Readonly<{
      repository: PromptRepository;
      clock: Clock;
      memories?: Pick<MemoryService, 'recordEvolution'>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#memories = dependencies.memories;
  }

  async create(
    input: Readonly<{
      promptId: string;
      stage: ModelStage;
      content: string;
      source: PromptVersion['source'];
      publish: boolean;
    }>,
  ): Promise<PromptVersion> {
    const content = validateContent(input.content);
    if (input.source === 'auto_candidate' && input.publish) {
      throw new PromptError(
        'PROMPT_AUTO_PUBLISH_FORBIDDEN',
        'Automatically generated Prompt candidates require administrator publication.',
      );
    }
    const versions = await this.#repository.listVersions(input.promptId);
    const latest = versions.at(-1);
    const version: PromptVersion = {
      promptId: input.promptId,
      stage: input.stage,
      version: (latest?.version ?? 0) + 1,
      ...(latest === undefined ? {} : { previousVersion: latest.version }),
      content,
      status: input.publish ? 'enabled' : 'candidate',
      source: input.source,
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveVersion(version, input.publish);
    if (version.source === 'manual_correction')
      await this.#memories?.recordEvolution({
        kind: 'prompt_correction',
        sourceRef: `prompt:${version.promptId}:${String(version.version)}`,
        summary: `Prompt ${version.promptId} version ${String(version.version)} was manually corrected for ${version.stage}.`,
        content: {
          promptId: version.promptId,
          version: version.version,
          stage: version.stage,
          previousVersion: version.previousVersion ?? null,
          status: version.status,
        },
        confidence: 1,
      });
    return version;
  }

  publish(promptId: string, candidateVersion: number): Promise<PromptVersion> {
    return this.#activate(promptId, candidateVersion, 'admin');
  }

  rollback(promptId: string, targetVersion: number): Promise<PromptVersion> {
    return this.#activate(promptId, targetVersion, 'rollback');
  }

  listVersions(promptId: string): Promise<readonly PromptVersion[]> {
    return this.#repository.listVersions(promptId);
  }
  effect(promptId: string, version: number): Promise<PromptEffectSummary> {
    return this.#repository.effect(promptId, version);
  }

  async disable(promptId: string): Promise<PromptVersion> {
    const versions = await this.#repository.listVersions(promptId);
    const latest = versions.at(-1);
    if (latest === undefined)
      throw new PromptError('PROMPT_VERSION_NOT_FOUND', 'Prompt version was not found.');
    const current = await this.#repository.findCurrent(latest.stage);
    if (current?.promptId !== promptId)
      throw new PromptError('PROMPT_VERSION_NOT_FOUND', 'Enabled Prompt was not found.');
    const disabled: PromptVersion = {
      ...current,
      version: latest.version + 1,
      previousVersion: latest.version,
      status: 'disabled',
      source: 'admin',
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveVersion(disabled, true);
    return disabled;
  }

  async #activate(
    promptId: string,
    targetVersion: number,
    source: 'admin' | 'rollback',
  ): Promise<PromptVersion> {
    const target = await this.#repository.findVersion(promptId, targetVersion);
    if (target === undefined)
      throw new PromptError('PROMPT_VERSION_NOT_FOUND', 'Prompt version was not found.');
    const versions = await this.#repository.listVersions(promptId);
    const latest = versions.at(-1);
    const activated: PromptVersion = {
      ...target,
      version: (latest?.version ?? 0) + 1,
      ...(latest === undefined ? {} : { previousVersion: latest.version }),
      status: 'enabled',
      source,
      createdAt: this.#clock.now(),
    };
    await this.#repository.saveVersion(activated, true);
    return activated;
  }
}

function validateContent(value: string): string {
  const content = value.trim();
  if (content === '' || !content.includes('{{instruction}}')) {
    throw new PromptError(
      'PROMPT_CONTENT_INVALID',
      'Prompt must include the {{instruction}} placeholder.',
    );
  }
  return content;
}

export type PromptErrorCode =
  'PROMPT_AUTO_PUBLISH_FORBIDDEN' | 'PROMPT_CONTENT_INVALID' | 'PROMPT_VERSION_NOT_FOUND';
export class PromptError extends Error {
  readonly code: PromptErrorCode;
  constructor(code: PromptErrorCode, message: string) {
    super(message);
    this.name = 'PromptError';
    this.code = code;
  }
}
