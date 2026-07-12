import {
  createTemporarySkill,
  expireTemporarySkill,
  type SkillFormalizationCandidate,
  type TemporarySkill,
  type TemporarySkillExperience,
  type ToolReference,
} from '../../domain/src/index.js';

import type {
  Clock,
  JsonSchemaValidator,
  McpToolCatalog,
  TemporarySkillRepository,
  EvolutionPolicyRepository,
} from './ports.js';

export interface CreateTemporarySkillInput {
  readonly taskId: string;
  readonly contextId: string;
  readonly name: string;
  readonly description: string;
  readonly tools: readonly ToolReference[];
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

export class TemporarySkillService {
  readonly #repository: TemporarySkillRepository;
  readonly #tools: McpToolCatalog;
  readonly #schemas: JsonSchemaValidator;
  readonly #clock: Clock;
  readonly #ids: Readonly<{
    nextTemporarySkillId(): string;
    nextExperienceId(): string;
    nextFormalizationCandidateId(): string;
    nextEvolutionTriggerId(): string;
  }>;
  readonly #fingerprint: (canonical: string) => string;
  readonly #evolutionPolicy: Pick<EvolutionPolicyRepository, 'get' | 'saveTrigger'>;

  constructor(
    dependencies: Readonly<{
      repository: TemporarySkillRepository;
      tools: McpToolCatalog;
      schemas: JsonSchemaValidator;
      clock: Clock;
      ids: Readonly<{
        nextTemporarySkillId(): string;
        nextExperienceId(): string;
        nextFormalizationCandidateId(): string;
        nextEvolutionTriggerId(): string;
      }>;
      fingerprint(canonical: string): string;
      evolutionPolicy: Pick<EvolutionPolicyRepository, 'get' | 'saveTrigger'>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#tools = dependencies.tools;
    this.#schemas = dependencies.schemas;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#fingerprint = dependencies.fingerprint;
    this.#evolutionPolicy = dependencies.evolutionPolicy;
  }

  async create(input: CreateTemporarySkillInput): Promise<TemporarySkill> {
    assertSchema(this.#schemas, input.inputSchema, 'input');
    assertSchema(this.#schemas, input.outputSchema, 'output');
    const tools = canonicalTools(input.tools);
    for (const tool of tools) {
      if (!(await this.#tools.exists(tool))) {
        throw new TemporarySkillError(
          'TEMPORARY_SKILL_TOOL_NOT_FOUND',
          `MCP Tool ${tool.serverId}/${tool.toolName} was not found.`,
        );
      }
    }
    const canonical = stableStringify({
      description: input.description.trim(),
      tools,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
    });
    const skill = createTemporarySkill({
      temporarySkillId: this.#ids.nextTemporarySkillId(),
      ...input,
      tools,
      capabilityFingerprint: this.#fingerprint(canonical),
      status: 'active',
      createdAt: this.#clock.now(),
    });
    await this.#repository.save(skill);
    return skill;
  }

  async complete(
    temporarySkillId: string,
    successful: boolean,
    outcomeSummary: string,
  ): Promise<
    Readonly<{
      skill: TemporarySkill;
      experience: TemporarySkillExperience;
      formalizationCandidate?: SkillFormalizationCandidate;
    }>
  > {
    const current = await this.#repository.find(temporarySkillId);
    if (current === undefined) {
      throw new TemporarySkillError('TEMPORARY_SKILL_NOT_FOUND', 'Temporary Skill was not found.');
    }
    const summary = outcomeSummary.trim();
    if (summary === '') {
      throw new TemporarySkillError(
        'TEMPORARY_SKILL_OUTCOME_REQUIRED',
        'Outcome summary is required.',
      );
    }
    const timestamp = this.#clock.now();
    const skill = expireTemporarySkill(current, timestamp);
    const experience: TemporarySkillExperience = {
      experienceId: this.#ids.nextExperienceId(),
      temporarySkillId,
      taskId: skill.taskId,
      contextId: skill.contextId,
      capabilityFingerprint: skill.capabilityFingerprint,
      successful,
      outcomeSummary: summary,
      createdAt: timestamp,
    };
    await this.#repository.expireAndSaveExperience(skill, experience);
    if (!successful) return { skill, experience };

    const experiences = await this.#repository.listSuccessfulExperiences(
      skill.capabilityFingerprint,
    );
    const policy = await this.#evolutionPolicy.get();
    if (experiences.length < policy.successThreshold) {
      await this.#saveTrigger(
        skill.capabilityFingerprint,
        experience.experienceId,
        experiences.length,
        policy.successThreshold,
        'below_threshold',
        timestamp,
      );
      return { skill, experience };
    }
    const existing = await this.#repository.findFormalizationCandidate(skill.capabilityFingerprint);
    if (existing !== undefined) {
      await this.#saveTrigger(
        skill.capabilityFingerprint,
        experience.experienceId,
        experiences.length,
        policy.successThreshold,
        'candidate_existing',
        timestamp,
        existing.candidateId,
      );
      return { skill, experience, formalizationCandidate: existing };
    }
    const formalizationCandidate: SkillFormalizationCandidate = {
      candidateId: this.#ids.nextFormalizationCandidateId(),
      capabilityFingerprint: skill.capabilityFingerprint,
      successfulExperienceCount: experiences.length,
      requiredSuccessThreshold: policy.successThreshold,
      sourceExperienceIds: experiences.map((item) => item.experienceId),
      status: 'awaiting_simulation',
      createdAt: timestamp,
    };
    await this.#repository.saveFormalizationCandidate(formalizationCandidate);
    await this.#saveTrigger(
      skill.capabilityFingerprint,
      experience.experienceId,
      experiences.length,
      policy.successThreshold,
      'candidate_created',
      timestamp,
      formalizationCandidate.candidateId,
    );
    return { skill, experience, formalizationCandidate };
  }

  listByTask(taskId: string): Promise<readonly TemporarySkill[]> {
    return this.#repository.listByTask(taskId);
  }

  #saveTrigger(
    capabilityFingerprint: string,
    experienceId: string,
    successfulExperienceCount: number,
    configuredThreshold: number,
    decision: 'below_threshold' | 'candidate_created' | 'candidate_existing',
    createdAt: string,
    candidateId?: string,
  ): Promise<void> {
    return this.#evolutionPolicy.saveTrigger({
      triggerId: this.#ids.nextEvolutionTriggerId(),
      capabilityFingerprint,
      experienceId,
      successfulExperienceCount,
      configuredThreshold,
      decision,
      ...(candidateId === undefined ? {} : { candidateId }),
      createdAt,
    });
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertSchema(validator: JsonSchemaValidator, schema: unknown, label: string): void {
  const result = validator.checkSchema(schema);
  if (!result.valid) {
    throw new TemporarySkillError(
      'TEMPORARY_SKILL_SCHEMA_INVALID',
      `Temporary Skill ${label} schema is invalid.`,
      result.errors,
    );
  }
}

function canonicalTools(tools: readonly ToolReference[]): readonly ToolReference[] {
  const unique = new Map(tools.map((tool) => [`${tool.serverId}/${tool.toolName}`, tool]));
  return [...unique.values()].sort((left, right) =>
    `${left.serverId}/${left.toolName}`.localeCompare(`${right.serverId}/${right.toolName}`),
  );
}

export type TemporarySkillErrorCode =
  | 'TEMPORARY_SKILL_NOT_FOUND'
  | 'TEMPORARY_SKILL_OUTCOME_REQUIRED'
  | 'TEMPORARY_SKILL_SCHEMA_INVALID'
  | 'TEMPORARY_SKILL_TOOL_NOT_FOUND';

export class TemporarySkillError extends Error {
  readonly code: TemporarySkillErrorCode;
  readonly details: readonly string[];
  constructor(code: TemporarySkillErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'TemporarySkillError';
    this.code = code;
    this.details = details;
  }
}
