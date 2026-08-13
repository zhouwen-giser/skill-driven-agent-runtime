import { z } from 'zod';

export const UGV_REQUIRED_MODEL_ROUTES = Object.freeze([
  'task_understanding',
  'goal_contract_generation',
  'goal_planning',
  'skill_selection',
  'skill_input_resolution',
  'workflow_planning',
  'result_processing',
  'goal_evaluation',
  'goal',
  'evaluation',
] as const);

export const UGV_STRUCTURED_MODEL_STAGES = Object.freeze(
  UGV_REQUIRED_MODEL_ROUTES.filter((stage) => stage !== 'goal'),
);

export const UGV_EMBEDDING_MODEL_STAGES = Object.freeze(['goal', 'skill_selection'] as const);

export const UgvModelProviderEvidenceSchema = z
  .object({
    providerId: z.string().min(1),
    model: z.string().min(1),
    apiStyle: z.enum(['openai_chat_completions', 'anthropic_messages']),
    connectivity: z.literal('passed'),
    credentialsRedacted: z.literal(true),
  })
  .strict();

export const UgvModelStageConformanceSchema = z
  .object({
    schemaVersion: z.literal('sdar.ugv-smpp-model-stage-conformance/v1'),
    status: z.literal('passed'),
    evidenceClass: z.literal('real_model_provider'),
    observedAt: z.iso.datetime({ offset: true }),
    provider: UgvModelProviderEvidenceSchema,
    embeddingPrerequisite: z
      .object({
        status: z.literal('passed'),
        provider: UgvModelProviderEvidenceSchema,
        stages: z.array(
          z
            .object({
              stage: z.enum(UGV_EMBEDDING_MODEL_STAGES),
              status: z.literal('passed'),
              finiteVectorValidated: z.literal(true),
              dimensions: z.number().int().positive(),
              boundedTimeout: z.literal(true),
            })
            .strict(),
        ),
      })
      .strict(),
    correctionPath: z
      .object({
        exercised: z.literal(true),
        invalidFirstResponseRejected: z.literal(true),
        rejectionKind: z.literal('application_schema_validation'),
        correctedStructuredResponseValidated: z.literal(true),
      })
      .strict(),
    stages: z.array(
      z
        .object({
          stage: z.enum(UGV_STRUCTURED_MODEL_STAGES),
          status: z.literal('passed'),
          structuredOutputValidated: z.literal(true),
          boundedTimeout: z.literal(true),
          promptPublished: z.literal(true),
        })
        .strict(),
    ),
  })
  .strict();

export type UgvModelStageConformanceReport = z.infer<typeof UgvModelStageConformanceSchema>;
