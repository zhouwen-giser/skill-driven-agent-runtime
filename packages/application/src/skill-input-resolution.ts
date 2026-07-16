import { z } from 'zod';

import {
  createSkillInputResolutionRecord,
  type AgentTask,
  type Goal,
  type MemorySearchHit,
  type SkillInputResolutionRecord,
  type SkillVersion,
  type TaskInputResponse,
} from '../../domain/src/index.js';
import type {
  Clock,
  JsonSchemaValidator,
  SkillInputResolutionRepository,
  StructuredModelProvider,
} from './ports.js';
import type { MemoryService } from './memory-service.js';

const DecisionSchema = z
  .object({
    structuredInput: z.unknown().optional(),
    unresolvedFields: z.array(z.string()),
    sourceRefs: z.array(z.string()),
    decisionSummary: z.string().min(1),
  })
  .strict();

export const skillInputResolutionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['unresolvedFields', 'sourceRefs', 'decisionSummary'],
  properties: {
    structuredInput: {},
    unresolvedFields: { type: 'array', items: { type: 'string' } },
    sourceRefs: { type: 'array', items: { type: 'string' } },
    decisionSummary: { type: 'string', minLength: 1 },
  },
} as const;

export interface ResolveTopLevelSkillInput {
  readonly task: AgentTask;
  readonly goal: Goal;
  readonly skill: SkillVersion;
  readonly supplementaryInputs: readonly TaskInputResponse[];
}

export class SkillInputResolutionService {
  readonly #model: StructuredModelProvider;
  readonly #schemas: JsonSchemaValidator;
  readonly #records: SkillInputResolutionRepository;
  readonly #memories: Pick<MemoryService, 'searchForStage'> | undefined;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      schemas: JsonSchemaValidator;
      records: SkillInputResolutionRepository;
      memories?: Pick<MemoryService, 'searchForStage'>;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#model = dependencies.model;
    this.#schemas = dependencies.schemas;
    this.#records = dependencies.records;
    this.#memories = dependencies.memories;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async resolve(input: ResolveTopLevelSkillInput): Promise<SkillInputResolutionRecord> {
    if (input.skill.status !== 'enabled')
      throw new SkillInputResolutionError(
        'SKILL_INPUT_SKILL_NOT_ENABLED',
        'Top-level input can be resolved only for an enabled Skill version.',
      );
    const resolutionId = this.#nextId();
    const explicit = explicitStructuredInput(input.task.requestMetadata);
    const contextData = await this.#records.listProcessedDataByContext(
      input.task.contextId,
      input.task.taskId,
      5,
    );
    const memories = await this.#memories?.searchForStage(
      'skill_input_resolution',
      `${input.goal.description}\n${input.task.requestText}`,
      5,
    );
    const sources = resolutionSources(input, explicit, contextData, memories ?? []);
    try {
      const decision = DecisionSchema.parse(
        await this.#model.generateStructured({
          stage: 'skill_input_resolution',
          taskId: input.task.taskId,
          instruction: JSON.stringify({
            operation: 'resolve_top_level_skill_input',
            taskId: input.task.taskId,
            skill: {
              skillId: input.skill.skillId,
              version: input.skill.version,
              inputSchema: input.skill.inputSchema,
            },
            sourcePriority: [
              'a2a_metadata_structured_input',
              'task_request_text',
              'goal_contract',
              'context_processed_data',
              'supplementary_input',
              'long_term_memory_evidence',
            ],
            sources,
            rules: [
              'Return data only; never return executable source.',
              'Resolve conflicts strictly by sourcePriority.',
              'Do not treat long-term Memory as authoritative live device state.',
              'List every unresolved required field and only cite supplied sourceRefs.',
            ],
          }),
          responseSchema: skillInputResolutionResponseSchema,
          correctionErrors: [],
        }),
      );
      const candidate = overlayExplicit(decision.structuredInput ?? {}, explicit?.value);
      const validation = this.#schemas.validate(input.skill.inputSchema, candidate);
      const unresolvedFields = normalizeStrings([
        ...decision.unresolvedFields.filter((field) => !hasResolvedField(candidate, field)),
        ...missingRequiredFields(input.skill.inputSchema, candidate),
        ...validationErrorFields(validation.errors),
      ]);
      const status =
        validation.valid && unresolvedFields.length === 0 ? 'resolved' : 'input_required';
      const allowedRefs = new Set(sources.map((source) => source.sourceRef));
      const sourceRefs = normalizeStrings([
        ...decision.sourceRefs.filter((sourceRef) => allowedRefs.has(sourceRef)),
        ...(explicit === undefined ? [] : [explicit.sourceRef]),
      ]);
      const record = createSkillInputResolutionRecord({
        resolutionId,
        taskId: input.task.taskId,
        goalId: input.goal.goalId,
        goalVersion: input.goal.version,
        skillId: input.skill.skillId,
        skillVersion: input.skill.version,
        structuredInput: candidate,
        unresolvedFields,
        sourceRefs,
        decisionSummary:
          status === 'resolved'
            ? decision.decisionSummary
            : `${decision.decisionSummary} Schema validation: ${validation.errors.join('; ') || 'unresolved fields remain'}.`,
        status,
        createdAt: this.#clock.now(),
      });
      await this.#records.save(record);
      return record;
    } catch (error: unknown) {
      const failed = createSkillInputResolutionRecord({
        resolutionId,
        taskId: input.task.taskId,
        goalId: input.goal.goalId,
        goalVersion: input.goal.version,
        skillId: input.skill.skillId,
        skillVersion: input.skill.version,
        unresolvedFields: [],
        sourceRefs: [],
        decisionSummary: `Skill input resolution failed with ${errorCode(error)}.`,
        status: 'failed',
        createdAt: this.#clock.now(),
      });
      try {
        await this.#records.save(failed);
      } catch (persistenceError: unknown) {
        throw new AggregateError(
          [error, persistenceError],
          'Skill input resolution and failed-decision persistence both failed.',
          { cause: persistenceError },
        );
      }
      throw new SkillInputResolutionError(
        'SKILL_INPUT_RESOLUTION_FAILED',
        'Structured top-level Skill input resolution failed.',
        error,
      );
    }
  }

  get(resolutionId: string): Promise<SkillInputResolutionRecord | undefined> {
    return this.#records.find(resolutionId);
  }

  list(taskId: string): Promise<readonly SkillInputResolutionRecord[]> {
    return this.#records.listByTask(taskId);
  }
}

export function skillInputResolutionQuestion(record: SkillInputResolutionRecord): string {
  return `Additional Skill input is required for: ${record.unresolvedFields.join(', ')}.`;
}

interface ResolutionSource {
  readonly sourceRef: string;
  readonly kind:
    | 'a2a_metadata_structured_input'
    | 'task_request_text'
    | 'goal_contract'
    | 'context_processed_data'
    | 'supplementary_input'
    | 'long_term_memory_evidence';
  readonly value: unknown;
  readonly authority: 'authoritative_request' | 'task_evidence' | 'non_authoritative_evidence';
}

function resolutionSources(
  input: ResolveTopLevelSkillInput,
  explicit: Readonly<{ sourceRef: string; value: unknown }> | undefined,
  contextData: readonly Readonly<{ sourceRef: string; value: unknown }>[],
  memories: readonly MemorySearchHit[],
): readonly ResolutionSource[] {
  return [
    ...(explicit === undefined
      ? []
      : [
          {
            sourceRef: explicit.sourceRef,
            kind: 'a2a_metadata_structured_input' as const,
            value: explicit.value,
            authority: 'authoritative_request' as const,
          },
        ]),
    {
      sourceRef: `task:${input.task.taskId}:request-text`,
      kind: 'task_request_text',
      value: input.task.requestText,
      authority: 'authoritative_request',
    },
    {
      sourceRef: `goal:${input.goal.goalId}:v${String(input.goal.version)}`,
      kind: 'goal_contract',
      value: {
        title: input.goal.title,
        description: input.goal.description,
        constraints: input.goal.constraints,
        successCriteria: input.goal.successCriteria,
      },
      authority: 'task_evidence',
    },
    ...contextData.map((evidence) => ({
      sourceRef: evidence.sourceRef,
      kind: 'context_processed_data' as const,
      value: evidence.value,
      authority: 'task_evidence' as const,
    })),
    ...input.supplementaryInputs.map((response) => ({
      sourceRef: `task-input-response:${response.inputResponseId}`,
      kind: 'supplementary_input' as const,
      value: response.content,
      authority: 'authoritative_request' as const,
    })),
    ...memories.map((hit) => ({
      sourceRef: `memory:${hit.item.memoryId}`,
      kind: 'long_term_memory_evidence' as const,
      value: {
        summary: hit.item.summary,
        content: hit.item.content,
        confidence: hit.item.confidence,
        score: hit.score,
      },
      authority: 'non_authoritative_evidence' as const,
    })),
  ];
}

function explicitStructuredInput(
  metadata: Readonly<Record<string, unknown>>,
): Readonly<{ sourceRef: string; value: unknown }> | undefined {
  if ('structured_input' in metadata)
    return {
      sourceRef: 'a2a-metadata:structured_input',
      value: metadata['structured_input'],
    };
  if ('sdar_structured_input' in metadata)
    return {
      sourceRef: 'a2a-metadata:sdar_structured_input',
      value: metadata['sdar_structured_input'],
    };
  return undefined;
}

function overlayExplicit(modelValue: unknown, explicitValue: unknown): unknown {
  if (explicitValue === undefined) return modelValue;
  if (!isRecord(modelValue) || !isRecord(explicitValue)) return explicitValue;
  const merged: Record<string, unknown> = { ...modelValue };
  for (const [key, value] of Object.entries(explicitValue))
    merged[key] =
      isRecord(merged[key]) && isRecord(value) ? overlayExplicit(merged[key], value) : value;
  return merged;
}

function missingRequiredFields(schema: unknown, value: unknown): readonly string[] {
  if (!isRecord(schema) || !Array.isArray(schema['required'])) return [];
  const record = isRecord(value) ? value : {};
  return schema['required'].filter(
    (field): field is string => typeof field === 'string' && !(field in record),
  );
}

function validationErrorFields(errors: readonly string[]): readonly string[] {
  return errors.flatMap((error) => {
    const path = /^\/([^ /]+)/u.exec(error)?.[1];
    if (path !== undefined) return [path.replaceAll('~1', '/').replaceAll('~0', '~')];
    const required = /must have required property ['"]?([^'"\s]+)['"]?/u.exec(error)?.[1];
    return [required ?? '$'];
  });
}

function hasResolvedField(value: unknown, field: string): boolean {
  if (!isRecord(value)) return false;
  const normalized = field.startsWith('/') ? field.slice(1) : field;
  const topLevel = normalized.split(/[./]/u, 1)[0];
  return topLevel !== undefined && topLevel !== '' && topLevel in value;
}

function normalizeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : error instanceof z.ZodError
      ? 'SKILL_INPUT_MODEL_RESPONSE_INVALID'
      : 'SKILL_INPUT_RESOLUTION_ERROR';
}

export type SkillInputResolutionErrorCode =
  'SKILL_INPUT_RESOLUTION_FAILED' | 'SKILL_INPUT_SKILL_NOT_ENABLED';

export class SkillInputResolutionError extends Error {
  readonly code: SkillInputResolutionErrorCode;
  override readonly cause: unknown;

  constructor(code: SkillInputResolutionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'SkillInputResolutionError';
    this.code = code;
    this.cause = cause;
  }
}
