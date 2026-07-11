import { createSkillVersion, type SkillStatus, type SkillVersion } from '../../domain/src/index.js';

import type { Clock, JsonSchemaValidator, SkillRepository } from './ports.js';
import { ResultProcessingError } from './result-processor.js';

export type RegisterSkillVersionInput = Omit<
  SkillVersion,
  'version' | 'previousVersion' | 'createdAt'
>;

export class SkillRegistryService {
  readonly #skills: SkillRepository;
  readonly #validator: JsonSchemaValidator;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      skills: SkillRepository;
      validator: JsonSchemaValidator;
      clock: Clock;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#validator = dependencies.validator;
    this.#clock = dependencies.clock;
  }

  async register(input: RegisterSkillVersionInput): Promise<SkillVersion> {
    this.#assertSchema(input.inputSchema, 'input');
    this.#assertSchema(input.outputSchema, 'output');
    const current = await this.#skills.findCurrentVersion(input.skillId);
    const version = createSkillVersion({
      ...input,
      version: (current?.version ?? 0) + 1,
      ...(current === undefined ? {} : { previousVersion: current.version }),
      createdAt: this.#clock.now(),
    });
    await this.#skills.saveVersionAndSetCurrent(version, this.#clock.now());
    return version;
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillVersion> {
    const current = await this.#requireCurrent(skillId);
    return this.#copyAsNewVersion(current, enabled ? 'enabled' : 'disabled');
  }

  async rollback(skillId: string, targetVersion: number): Promise<SkillVersion> {
    const current = await this.#requireCurrent(skillId);
    const target = await this.#skills.findVersion(skillId, targetVersion);
    if (target === undefined)
      throw new SkillRegistryError('SKILL_VERSION_NOT_FOUND', 'Skill version was not found.');
    return this.#copyAsNewVersion({ ...target, previousVersion: current.version }, target.status);
  }

  async getOutputSchema(skillId: string): Promise<unknown> {
    const current = await this.#requireCurrent(skillId);
    if (current.status !== 'enabled') {
      throw new SkillRegistryError('SKILL_NOT_ENABLED', 'Skill is not enabled.');
    }
    return current.outputSchema;
  }

  async #copyAsNewVersion(current: SkillVersion, status: SkillStatus): Promise<SkillVersion> {
    return this.register({
      ...current,
      status,
      validationPassed: current.validationPassed,
      sourceKind: 'manual_correction',
    });
  }

  async #requireCurrent(skillId: string): Promise<SkillVersion> {
    const current = await this.#skills.findCurrentVersion(skillId);
    if (current === undefined)
      throw new SkillRegistryError('SKILL_NOT_FOUND', 'Skill was not found.');
    return current;
  }

  #assertSchema(schema: unknown, label: string): void {
    const result = this.#validator.checkSchema(schema);
    if (!result.valid) {
      throw new ResultProcessingError(
        'RESULT_SCHEMA_INVALID',
        `Skill ${label} schema is invalid.`,
        result.errors,
      );
    }
  }
}

export type SkillRegistryErrorCode =
  'SKILL_NOT_ENABLED' | 'SKILL_NOT_FOUND' | 'SKILL_VERSION_NOT_FOUND';
export class SkillRegistryError extends Error {
  readonly code: SkillRegistryErrorCode;
  constructor(code: SkillRegistryErrorCode, message: string) {
    super(message);
    this.name = 'SkillRegistryError';
    this.code = code;
  }
}
