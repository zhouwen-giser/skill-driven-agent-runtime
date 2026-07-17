import {
  createSkillCatalogVersionSnapshot,
  createSkillVersion,
  matchesSkillCatalogFilter,
  type SkillCatalogFilter,
  type SkillCatalogVersionSnapshot,
  type SkillPackageImportCandidate,
  type SkillStatus,
  type SkillVersion,
} from '../../domain/src/index.js';

import type { Clock, JsonSchemaValidator, SkillRepository } from './ports.js';
import { ResultProcessingError } from './result-processor.js';

export type RegisterSkillVersionInput = Omit<
  SkillVersion,
  'version' | 'previousVersion' | 'createdAt'
>;

export interface SkillVersionDiff {
  readonly skillId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly changedFields: readonly string[];
  readonly from: SkillVersion;
  readonly to: SkillVersion;
}

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

  async importPackage(candidate: SkillPackageImportCandidate): Promise<SkillVersion> {
    const input = candidate.skillVersion;
    if (input.usageSpecification === undefined)
      throw new SkillRegistryError(
        'SKILL_IMPORT_USAGE_REQUIRED',
        'Imported Skill packages require a native usage specification.',
      );
    this.#assertSchema(input.inputSchema, 'input');
    this.#assertSchema(input.outputSchema, 'output');
    const current = await this.#skills.findCurrentVersion(input.skillId);
    const expectedVersion = (current?.version ?? 0) + 1;
    if (
      input.version !== expectedVersion ||
      input.previousVersion !== (current === undefined ? undefined : current.version)
    )
      throw new SkillRegistryError(
        'SKILL_IMPORT_VERSION_CONFLICT',
        'Imported Skill package does not extend the exact current version.',
      );
    const version = createSkillVersion(input);
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

  async listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Object.freeze(
      (await this.#skills.listCurrentVersions()).map((version) => createSkillVersion(version)),
    );
  }

  async listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    return Object.freeze(
      (await this.#skills.listVersions(skillId)).map((version) => createSkillVersion(version)),
    );
  }

  async getCurrentSummary(skillId: string): Promise<SkillCatalogVersionSnapshot> {
    return createSkillCatalogVersionSnapshot(await this.#requireCurrent(skillId), true);
  }

  async getVersionSummary(skillId: string, version: number): Promise<SkillCatalogVersionSnapshot> {
    const exact = await this.#skills.findVersion(skillId, version);
    if (exact === undefined)
      throw new SkillRegistryError('SKILL_VERSION_NOT_FOUND', 'Skill version was not found.');
    const current = await this.#skills.findCurrentVersion(skillId);
    return createSkillCatalogVersionSnapshot(exact, current?.version === version);
  }

  async readExactVersion(skillId: string, version: number): Promise<SkillVersion> {
    const exact = await this.#skills.findVersion(skillId, version);
    if (exact === undefined)
      throw new SkillRegistryError('SKILL_VERSION_NOT_FOUND', 'Skill version was not found.');
    return createSkillVersion(exact);
  }

  async listCatalog(
    filter: SkillCatalogFilter = {},
  ): Promise<readonly SkillCatalogVersionSnapshot[]> {
    const versions = await this.#skills.listCurrentVersions();
    return Object.freeze(
      versions
        .map((version) => createSkillCatalogVersionSnapshot(version, true))
        .filter((snapshot) => matchesSkillCatalogFilter(snapshot, filter)),
    );
  }

  async diff(skillId: string, fromVersion: number, toVersion: number): Promise<SkillVersionDiff> {
    const foundFrom = await this.#skills.findVersion(skillId, fromVersion);
    const foundTo = await this.#skills.findVersion(skillId, toVersion);
    if (foundFrom === undefined || foundTo === undefined) {
      throw new SkillRegistryError('SKILL_VERSION_NOT_FOUND', 'Skill version was not found.');
    }
    const from = createSkillVersion(foundFrom);
    const to = createSkillVersion(foundTo);
    const fields: readonly (keyof SkillVersion)[] = [
      'name',
      'summary',
      'description',
      'capabilities',
      'workflowGuidance',
      'outputInstruction',
      'inputSchema',
      'outputSchema',
      'toolPolicy',
      'runtimePolicy',
      'status',
      'sourceKind',
      'validationPassed',
      'usageSpecification',
    ];
    return {
      skillId,
      fromVersion,
      toVersion,
      changedFields: fields.filter(
        (field) => JSON.stringify(from[field]) !== JSON.stringify(to[field]),
      ),
      from,
      to,
    };
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
    return createSkillVersion(current);
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
  | 'SKILL_IMPORT_USAGE_REQUIRED'
  | 'SKILL_IMPORT_VERSION_CONFLICT'
  | 'SKILL_NOT_ENABLED'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_VERSION_NOT_FOUND';
export class SkillRegistryError extends Error {
  readonly code: SkillRegistryErrorCode;
  constructor(code: SkillRegistryErrorCode, message: string) {
    super(message);
    this.name = 'SkillRegistryError';
    this.code = code;
  }
}
