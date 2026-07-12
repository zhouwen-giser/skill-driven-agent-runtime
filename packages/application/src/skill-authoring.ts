import { z } from 'zod';

import type {
  SkillDraft,
  SkillRuntimePolicy,
  SkillToolPolicy,
  SkillVersion,
} from '../../domain/src/index.js';

import type {
  Clock,
  JsonSchemaValidator,
  SkillDraftRepository,
  StructuredModelProvider,
} from './ports.js';
import type { SkillRegistryService } from './skill-registry.js';

const JsonSchemaObject = z.record(z.string(), z.unknown());
const GeneratedSkillMetadataSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  workflowGuidance: z.string().min(1),
  outputInstruction: z.string().min(1),
  inputSchema: JsonSchemaObject,
  outputSchema: JsonSchemaObject,
});

export interface AuthorSkillInput {
  readonly skillId: string;
  readonly naturalLanguageDescription: string;
  readonly toolPolicy: SkillToolPolicy;
  readonly runtimePolicy: SkillRuntimePolicy;
  readonly status: 'draft' | 'enabled' | 'disabled';
  readonly sourceKind: 'admin' | 'a2a_draft';
}

export class SkillAuthoringService {
  readonly #model: StructuredModelProvider;
  readonly #schemas: JsonSchemaValidator;
  readonly #registry: SkillRegistryService;
  readonly #maxAttempts: number;
  readonly #drafts: SkillDraftRepository;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      schemas: JsonSchemaValidator;
      registry: SkillRegistryService;
      maxAttempts: number;
      drafts: SkillDraftRepository;
      clock: Clock;
    }>,
  ) {
    if (!Number.isInteger(dependencies.maxAttempts) || dependencies.maxAttempts < 1) {
      throw new SkillAuthoringError(
        'SKILL_AUTHORING_ATTEMPTS_INVALID',
        'maxAttempts must be positive.',
      );
    }
    this.#model = dependencies.model;
    this.#schemas = dependencies.schemas;
    this.#registry = dependencies.registry;
    this.#maxAttempts = dependencies.maxAttempts;
    this.#drafts = dependencies.drafts;
    this.#clock = dependencies.clock;
  }

  async authorAndRegister(input: AuthorSkillInput): Promise<SkillVersion> {
    if (input.sourceKind === 'a2a_draft')
      throw new SkillAuthoringError(
        'SKILL_A2A_DRAFT_MANAGEMENT_PUBLICATION_REQUIRED',
        'A2A Skill drafts must be published from their persisted draft through management.',
      );
    return this.#authorAndRegister(input);
  }

  async publishDraft(
    draftId: string,
    input: Readonly<{
      actor: string;
      skillId: string;
      toolPolicy: SkillToolPolicy;
      runtimePolicy: SkillRuntimePolicy;
      status: 'enabled' | 'disabled';
    }>,
  ): Promise<Readonly<{ draft: SkillDraft; skill: SkillVersion }>> {
    const draft = await this.#drafts.findById(draftId);
    if (draft === undefined)
      throw new SkillAuthoringError('SKILL_DRAFT_NOT_FOUND', 'Skill draft was not found.');
    if (draft.status !== 'draft')
      throw new SkillAuthoringError('SKILL_DRAFT_ALREADY_PUBLISHED', 'Skill draft is not pending.');
    const actor = input.actor.trim();
    if (actor.length === 0)
      throw new SkillAuthoringError('SKILL_DRAFT_PUBLISHER_REQUIRED', 'Publisher is required.');
    const skill = await this.#authorAndRegister({
      skillId: input.skillId,
      naturalLanguageDescription: draft.requestText,
      toolPolicy: input.toolPolicy,
      runtimePolicy: input.runtimePolicy,
      status: input.status,
      sourceKind: 'a2a_draft',
    });
    const publishedDraft = await this.#drafts.markPublished(draftId, {
      skillId: skill.skillId,
      version: skill.version,
      publishedBy: actor,
      publishedAt: this.#clock.now(),
    });
    return { draft: publishedDraft, skill };
  }

  getDraft(draftId: string): Promise<SkillDraft | undefined> {
    return this.#drafts.findById(draftId);
  }

  async #authorAndRegister(input: AuthorSkillInput): Promise<SkillVersion> {
    const description = input.naturalLanguageDescription.trim();
    if (description.length < 20) {
      throw new SkillAuthoringError(
        'SKILL_DESCRIPTION_INSUFFICIENT',
        'Provide a more explicit Skill description including inputs, outputs, and expected behavior.',
      );
    }
    let correctionErrors: readonly string[] = [];
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const raw = await this.#model.generateStructured({
        stage: 'skill_authoring',
        instruction: description,
        responseSchema: generatedSkillResponseSchema,
        correctionErrors,
      });
      const parsed = GeneratedSkillMetadataSchema.safeParse(raw);
      correctionErrors = parsed.success
        ? schemaErrors(this.#schemas, parsed.data.inputSchema, parsed.data.outputSchema)
        : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      if (parsed.success && correctionErrors.length === 0) {
        return this.#registry.register({
          skillId: input.skillId,
          ...parsed.data,
          toolPolicy: input.toolPolicy,
          runtimePolicy: input.runtimePolicy,
          status: input.status,
          sourceKind: input.sourceKind,
          validationPassed: true,
        });
      }
    }
    throw new SkillAuthoringError(
      'SKILL_SCHEMA_GENERATION_FAILED',
      'The model could not produce sufficiently explicit valid JSON Schemas; provide more detail.',
      correctionErrors,
    );
  }
}

const generatedSkillResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'summary',
    'description',
    'capabilities',
    'workflowGuidance',
    'outputInstruction',
    'inputSchema',
    'outputSchema',
  ],
  properties: {
    name: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    capabilities: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    workflowGuidance: { type: 'string', minLength: 1 },
    outputInstruction: { type: 'string', minLength: 1 },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  },
} as const;

function schemaErrors(
  validator: JsonSchemaValidator,
  inputSchema: Readonly<Record<string, unknown>>,
  outputSchema: Readonly<Record<string, unknown>>,
): readonly string[] {
  const errors: string[] = [];
  for (const [label, schema] of [
    ['input', inputSchema],
    ['output', outputSchema],
  ] as const) {
    const result = validator.checkSchema(schema);
    if (!result.valid) errors.push(...result.errors.map((error) => `${label}: ${error}`));
    if (
      schema['type'] !== 'object' ||
      typeof schema['properties'] !== 'object' ||
      schema['properties'] === null
    ) {
      errors.push(`${label}: top-level type object with explicit properties is required`);
    }
  }
  return errors;
}

export type SkillAuthoringErrorCode =
  | 'SKILL_AUTHORING_ATTEMPTS_INVALID'
  | 'SKILL_DESCRIPTION_INSUFFICIENT'
  | 'SKILL_SCHEMA_GENERATION_FAILED'
  | 'SKILL_A2A_DRAFT_MANAGEMENT_PUBLICATION_REQUIRED'
  | 'SKILL_DRAFT_ALREADY_PUBLISHED'
  | 'SKILL_DRAFT_NOT_FOUND'
  | 'SKILL_DRAFT_PUBLISHER_REQUIRED';

export class SkillAuthoringError extends Error {
  readonly code: SkillAuthoringErrorCode;
  readonly details: readonly string[];
  constructor(code: SkillAuthoringErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = 'SkillAuthoringError';
    this.code = code;
    this.details = details;
  }
}
