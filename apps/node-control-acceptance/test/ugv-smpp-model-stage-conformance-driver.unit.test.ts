import { describe, expect, it } from 'vitest';

import type { ModelProviderConfiguration } from '../../../packages/domain/src/index.js';
import {
  executeUgvModelStageConformance,
  type UgvModelStageConformanceConfiguration,
} from '../src/ugv-smpp-model-stage-conformance-driver.js';
import {
  UGV_EMBEDDING_MODEL_STAGES,
  UGV_STRUCTURED_MODEL_STAGES,
  UgvModelStageConformanceSchema,
} from '../src/ugv-smpp-model-stage-conformance-contract.js';

const NOW = '2026-08-12T09:00:00.000Z';
const STRUCTURED_PROVIDER_ID = 'provider.production-chat';
const EMBEDDING_PROVIDER_ID = 'provider.production-embedding';
const CONFIGURATION: UgvModelStageConformanceConfiguration = Object.freeze({
  structuredProviderId: STRUCTURED_PROVIDER_ID,
  structuredModel: 'production-chat-model',
  structuredApiStyle: 'openai_chat_completions',
  embeddingProviderId: EMBEDDING_PROVIDER_ID,
  embeddingModel: 'production-embedding-model',
  runId: 'model-conformance-run-1',
});

describe('UGV real-model stage conformance producer', () => {
  it('proves nine structured stages, application rejection/correction, and two embeddings', async () => {
    const correctionErrors: string[][] = [];
    const embeddedStages: string[] = [];
    const models = fixtureModels({ correctionErrors, embeddedStages });

    const report = await executeUgvModelStageConformance(CONFIGURATION, {
      models,
      now: () => NOW,
    });

    expect(UgvModelStageConformanceSchema.parse(report)).toEqual(report);
    expect(report.stages.map((item) => item.stage)).toEqual(UGV_STRUCTURED_MODEL_STAGES);
    expect(report.embeddingPrerequisite.stages.map((item) => item.stage)).toEqual(
      UGV_EMBEDDING_MODEL_STAGES,
    );
    expect(report.embeddingPrerequisite.provider.providerId).toBe(EMBEDDING_PROVIDER_ID);
    expect(report.correctionPath).toEqual({
      exercised: true,
      invalidFirstResponseRejected: true,
      rejectionKind: 'application_schema_validation',
      correctedStructuredResponseValidated: true,
    });
    expect(correctionErrors).toHaveLength(1);
    expect(correctionErrors[0]?.length).toBeGreaterThan(0);
    expect(embeddedStages).toEqual(UGV_EMBEDDING_MODEL_STAGES);
    expect(JSON.stringify(report)).not.toContain('https://');
    expect(JSON.stringify(report)).not.toContain('secret');
  });

  it('fails before invocation when an operation-aware embedding route is absent', async () => {
    const models = fixtureModels({ omitEmbeddingStage: 'skill_selection' });
    await expect(
      executeUgvModelStageConformance(CONFIGURATION, { models, now: () => NOW }),
    ).rejects.toMatchObject({ code: 'UGV_MODEL_ROUTE_INCOMPLETE' });
  });
});

function fixtureModels(options: {
  readonly correctionErrors?: string[][];
  readonly embeddedStages?: string[];
  readonly omitEmbeddingStage?: (typeof UGV_EMBEDDING_MODEL_STAGES)[number];
}) {
  let workflowCalls = 0;
  return {
    listProviders: () =>
      Promise.resolve([
        provider(STRUCTURED_PROVIDER_ID, 'production-chat-model'),
        provider(EMBEDDING_PROVIDER_ID, 'production-embedding-model'),
      ]),
    listStageRoutes: () =>
      Promise.resolve([
        ...UGV_STRUCTURED_MODEL_STAGES.map((stage) => ({
          stage,
          operation: 'structured_generation' as const,
          providerId: STRUCTURED_PROVIDER_ID,
          updatedAt: NOW,
        })),
        ...UGV_EMBEDDING_MODEL_STAGES.filter((stage) => stage !== options.omitEmbeddingStage).map(
          (stage) => ({
            stage,
            operation: 'embedding' as const,
            providerId: EMBEDDING_PROVIDER_ID,
            updatedAt: NOW,
          }),
        ),
      ]),
    generateStructured: (input: { stage: string; correctionErrors: readonly string[] }) => {
      if (input.stage !== 'workflow_planning')
        return Promise.resolve({
          stage: input.stage,
          evidence: 'real_model_provider',
          summary: 'validated',
        });
      workflowCalls += 1;
      if (workflowCalls === 1)
        return Promise.resolve({
          stage: 'workflow_planning',
          evidence: 'requires_application_correction',
          summary: 'first candidate',
        });
      options.correctionErrors?.push([...input.correctionErrors]);
      return Promise.resolve({
        stage: 'workflow_planning',
        evidence: 'real_model_provider',
        summary: 'corrected',
      });
    },
    embed: (stage: string) => {
      options.embeddedStages?.push(stage);
      return Promise.resolve({ providerId: EMBEDDING_PROVIDER_ID, vector: [0.25, -0.5, 0.75] });
    },
  };
}

function provider(providerId: string, model: string): ModelProviderConfiguration {
  return Object.freeze({
    providerId,
    name: providerId,
    kind: 'openai_compatible',
    apiStyle: 'openai_chat_completions',
    baseUrl: 'https://model.example.invalid/v1',
    model,
    enabled: true,
    timeoutMs: 10_000,
    createdAt: NOW,
    updatedAt: NOW,
  });
}
