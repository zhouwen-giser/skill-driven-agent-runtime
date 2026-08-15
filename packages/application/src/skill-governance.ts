import { createHash } from 'node:crypto';

import type { SkillPackageImportCandidate, SkillVersion } from '../../domain/src/index.js';

import type { SkillRegistryService } from './skill-registry.js';

export type GovernedSkillStatus =
  'draft' | 'validated' | 'published' | 'suspended' | 'deprecated' | 'retired';

export interface GovernedSkillVersionView {
  readonly skillId: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly status: GovernedSkillStatus;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly usageSpecification?: Readonly<Record<string, unknown>>;
  readonly outcomeSpecification?: Readonly<Record<string, unknown>>;
  readonly evidencePolicy?: Readonly<Record<string, unknown>>;
  readonly providerPolicy?: Readonly<Record<string, unknown>>;
  readonly checksum: string;
  readonly createdAt: string;
  readonly governanceRevision: number;
}

export interface SkillGovernanceMutation {
  readonly operation: 'publish' | 'suspend' | 'deprecate';
  readonly skillId: string;
  readonly version: number;
  readonly expectedRevision: number;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
  readonly actorId: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface SkillGovernanceMutationResult {
  readonly skill: SkillVersion;
  readonly status: GovernedSkillStatus;
  readonly governanceRevision: number;
  readonly replayed: boolean;
}

export interface SkillGovernanceImportMutation {
  readonly packageRoot: string;
  readonly packageChecksum: string;
  readonly fileChecksums: Readonly<Record<string, string>>;
  readonly skillId: string;
  readonly version: number;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
  readonly actorId: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface SkillGovernanceImportResult {
  readonly skill: SkillVersion;
  readonly replayed: boolean;
}

export interface SkillExactVersionGovernanceRepository {
  findGovernance(
    skillId: string,
    version: number,
  ): Promise<Readonly<{ status: GovernedSkillStatus; revision: number }> | undefined>;
  transition(input: SkillGovernanceMutation): Promise<SkillGovernanceMutationResult>;
  importPackage(
    input: SkillGovernanceImportMutation,
    importValidatedPackage: () => Promise<SkillVersion>,
  ): Promise<SkillGovernanceImportResult>;
}

export class RuntimeSkillGovernanceService {
  readonly #skills: Pick<
    SkillRegistryService,
    | 'importPackage'
    | 'listCurrentVersions'
    | 'listVersions'
    | 'readExactVersion'
    | 'validatePackage'
  >;
  readonly #governance: SkillExactVersionGovernanceRepository;
  readonly #afterCatalogChanged: (() => Promise<void>) | undefined;

  constructor(
    dependencies: Readonly<{
      skills: Pick<
        SkillRegistryService,
        | 'importPackage'
        | 'listCurrentVersions'
        | 'listVersions'
        | 'readExactVersion'
        | 'validatePackage'
      >;
      governance: SkillExactVersionGovernanceRepository;
      afterCatalogChanged?(): Promise<void>;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#governance = dependencies.governance;
    this.#afterCatalogChanged = dependencies.afterCatalogChanged;
  }

  async list(): Promise<readonly GovernedSkillVersionView[]> {
    return Object.freeze(
      await Promise.all(
        (await this.#skills.listCurrentVersions()).map((skill) => this.#view(skill)),
      ),
    );
  }

  async listVersions(skillId: string): Promise<readonly GovernedSkillVersionView[]> {
    return Object.freeze(
      await Promise.all(
        (await this.#skills.listVersions(skillId)).map((skill) => this.#view(skill)),
      ),
    );
  }

  async get(skillId: string, version: number): Promise<GovernedSkillVersionView> {
    return this.#view(await this.#skills.readExactVersion(skillId, version));
  }

  async validatePackage(packageRoot: string) {
    return this.#skills.validatePackage(packageRoot);
  }

  async importPackage(
    input: Readonly<{
      packageRoot: string;
      idempotencyKeyHash: string;
      requestHash: string;
      actorId: string;
      reason: string;
      occurredAt: string;
    }>,
  ): Promise<GovernedSkillVersionView> {
    const candidate = await this.#skills.validatePackage(input.packageRoot);
    const result = await this.#governance.importPackage(importMutation(input, candidate), () =>
      this.#skills.importPackage(candidate),
    );
    return this.#view(result.skill);
  }

  async transition(input: SkillGovernanceMutation): Promise<GovernedSkillVersionView> {
    const result = await this.#governance.transition(input);
    if (!result.replayed) await this.#afterCatalogChanged?.();
    return projectSkill(result.skill, result.status, result.governanceRevision);
  }

  async #view(skill: SkillVersion): Promise<GovernedSkillVersionView> {
    const governance = await this.#governance.findGovernance(skill.skillId, skill.version);
    return projectSkill(
      skill,
      governance?.status ?? statusFromRuntime(skill),
      governance?.revision ?? 0,
    );
  }
}

function importMutation(
  input: Readonly<{
    packageRoot: string;
    idempotencyKeyHash: string;
    requestHash: string;
    actorId: string;
    reason: string;
    occurredAt: string;
  }>,
  candidate: SkillPackageImportCandidate,
): SkillGovernanceImportMutation {
  return Object.freeze({
    packageRoot: input.packageRoot,
    packageChecksum: candidate.packageChecksum,
    fileChecksums: candidate.fileChecksums,
    skillId: candidate.skillVersion.skillId,
    version: candidate.skillVersion.version,
    idempotencyKeyHash: input.idempotencyKeyHash,
    requestHash: input.requestHash,
    actorId: input.actorId,
    reason: input.reason,
    occurredAt: input.occurredAt,
  });
}

function projectSkill(
  skill: SkillVersion,
  status: GovernedSkillStatus,
  governanceRevision: number,
): GovernedSkillVersionView {
  const inputSchema = objectSchema(skill.inputSchema, 'inputSchema');
  const outputSchema = objectSchema(skill.outputSchema, 'outputSchema');
  const usageSpecification = record(skill.usageSpecification);
  const outcomeSpecification = record(skill.outcomeSpecification);
  const content = {
    skillId: skill.skillId,
    version: String(skill.version),
    name: skill.name,
    description: skill.description,
    status,
    inputSchema,
    outputSchema,
    ...(usageSpecification === undefined ? {} : { usageSpecification }),
    ...(outcomeSpecification === undefined ? {} : { outcomeSpecification }),
    evidencePolicy: Object.freeze({
      requiredEvidence: skill.outcomeSpecification?.evidence ?? Object.freeze([]),
    }),
    providerPolicy: Object.freeze({
      requiredTools: skill.toolPolicy.required,
      optionalTools: skill.toolPolicy.optional,
      forbiddenTools: skill.toolPolicy.forbidden,
    }),
    createdAt: skill.createdAt,
    governanceRevision,
  };
  return Object.freeze({
    ...content,
    checksum: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  });
}

function statusFromRuntime(skill: SkillVersion): GovernedSkillStatus {
  if (skill.status === 'enabled') return 'published';
  if (skill.status === 'disabled') return 'suspended';
  if (skill.status === 'deprecated') return 'deprecated';
  if (skill.validationPassed) return 'validated';
  return 'draft';
}

function objectSchema(value: unknown, field: string): Readonly<Record<string, unknown>> {
  const found = record(value);
  if (found === undefined)
    throw new SkillGovernanceError('SKILL_SCHEMA_INVALID', `${field} must be an object.`);
  return found;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.freeze(structuredClone(value as Record<string, unknown>))
    : undefined;
}

export class SkillGovernanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = 'SkillGovernanceError';
    this.code = code;
    this.status = status;
  }
}
