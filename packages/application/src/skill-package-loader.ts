import {
  createSkillUsageSpecification,
  createSkillVersion,
  type SkillPackageImportCandidate,
  type SkillPackageReadResult,
  type SkillUsageSpecification,
  type SkillVersion,
} from '../../domain/src/index.js';

import type { Clock, JsonSchemaValidator } from './ports.js';

export interface SkillPackageSourceReader {
  read(packageRoot: string): Promise<SkillPackageReadResult>;
}

export class SkillPackageValidator {
  readonly #schemas: JsonSchemaValidator;
  readonly #packageSchema: unknown;

  constructor(dependencies: Readonly<{ schemas: JsonSchemaValidator; packageSchema: unknown }>) {
    this.#schemas = dependencies.schemas;
    this.#packageSchema = dependencies.packageSchema;
    const schemaResult = this.#schemas.checkSchema(this.#packageSchema);
    if (!schemaResult.valid)
      throw new SkillPackageError(
        'SKILL_PACKAGE_SCHEMA_INVALID',
        'The configured Skill Package schema is invalid.',
        schemaResult.errors,
      );
  }

  validate(read: SkillPackageReadResult): SkillVersion {
    const result = this.#schemas.validate(this.#packageSchema, read.document);
    if (!result.valid)
      throw new SkillPackageError(
        'SKILL_PACKAGE_CONTRACT_INVALID',
        'Skill Package content does not match its JSON Schema.',
        result.errors,
      );
    const document = read.document;
    this.#assertSchema(document.manifest.skill.inputSchema, 'input');
    this.#assertSchema(document.manifest.skill.outputSchema, 'output');
    const usage: SkillUsageSpecification = {
      apiVersion: document.manifest.apiVersion,
      visibility: document.normative.visibility,
      normative: document.normative.normative,
      adaptive: document.adaptive.adaptive,
      ...(document.adaptive.observedProfile === undefined
        ? {}
        : { observedProfile: document.adaptive.observedProfile }),
      contextRequirements: document.normative.contextRequirements,
      modes: document.modes,
      taskBindings: document.normative.taskBindings,
      ...(document.composition === undefined ? {} : { composition: document.composition }),
      evidencePolicy: document.evidence,
    };
    return createSkillVersion({
      ...document.manifest.skill,
      usageSpecification: createSkillUsageSpecification(usage),
    });
  }

  #assertSchema(schema: unknown, label: string): void {
    const result = this.#schemas.checkSchema(schema);
    if (!result.valid)
      throw new SkillPackageError(
        'SKILL_PACKAGE_EMBEDDED_SCHEMA_INVALID',
        `Skill Package ${label} schema is invalid.`,
        result.errors,
      );
  }
}

export class SkillPackageImporter {
  readonly #reader: SkillPackageSourceReader;
  readonly #validator: SkillPackageValidator;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      reader: SkillPackageSourceReader;
      validator: SkillPackageValidator;
      clock: Clock;
    }>,
  ) {
    this.#reader = dependencies.reader;
    this.#validator = dependencies.validator;
    this.#clock = dependencies.clock;
  }

  async import(packageRoot: string): Promise<SkillPackageImportCandidate> {
    const read = await this.#reader.read(packageRoot);
    const skillVersion = this.#validator.validate(read);
    return Object.freeze({
      skillVersion,
      packageChecksum: read.packageChecksum,
      packageRoot: read.packageRoot,
      fileChecksums: Object.freeze({ ...read.fileChecksums }),
      skillMarkdown: read.document.skillMarkdown,
      validatedAt: this.#clock.now(),
    });
  }
}

export type SkillPackageErrorCode =
  | 'SKILL_PACKAGE_SCHEMA_INVALID'
  | 'SKILL_PACKAGE_CONTRACT_INVALID'
  | 'SKILL_PACKAGE_EMBEDDED_SCHEMA_INVALID'
  | 'SKILL_PACKAGE_PATH_INVALID'
  | 'SKILL_PACKAGE_FILE_INVALID'
  | 'SKILL_PACKAGE_FILE_TOO_LARGE'
  | 'SKILL_PACKAGE_TOTAL_TOO_LARGE'
  | 'SKILL_PACKAGE_UTF8_INVALID'
  | 'SKILL_PACKAGE_JSON_INVALID'
  | 'SKILL_PACKAGE_CHECKSUM_MISMATCH';

export class SkillPackageError extends Error {
  readonly code: SkillPackageErrorCode;
  readonly details: readonly string[];

  constructor(code: SkillPackageErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'SkillPackageError';
    this.code = code;
    this.details = Object.freeze([...details]);
  }
}
