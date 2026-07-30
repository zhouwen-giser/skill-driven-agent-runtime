import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  createModelCascadeRun,
  createModelRouteDecision,
  type CaseAdaptationInput,
  type CaseAdaptationResult,
  type CaseRetrievalInput,
  type ModelRouteContext,
} from '../../domain/src/index.js';
import {
  CaseModelRuntimePersistenceError,
  PostgresCaseModelRuntimeRepository,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-30T00:00:00.000Z';

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE model_cascade_step,model_cascade_run,model_route_decision,
       case_runtime_adaptation,case_runtime_match,cognitive_runtime_outbox CASCADE`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('P11 PostgreSQL Case and Model Route evidence authority', () => {
  it('persists exact Case match/adaptation retries without P02 authority mutation', async () => {
    const repository = new PostgresCaseModelRuntimeRepository(pool);
    const request = caseRequest();
    const matchInput = {
      request,
      matches: [
        {
          caseRef: 'case-1:1',
          score: 0.9,
          applicability: 'requires_adaptation' as const,
          failureBoundaryStatus: 'clear' as const,
          reasonCodes: ['CASE_ACTIVE_MATCH'],
        },
      ],
      createdAt: NOW,
    };
    await repository.saveMatch(matchInput);
    await repository.saveMatch(matchInput);
    const adaptationInput = {
      adaptationId: 'adaptation-1',
      request: adaptationRequest(),
      result: adaptationResult(),
      artifactHash: HASH,
      activePointerVersion: 3,
      createdAt: NOW,
    };
    await repository.saveAdaptation(adaptationInput);
    await repository.saveAdaptation(adaptationInput);

    await expect(repository.findCaseAdaptation('adaptation-1')).resolves.toEqual(
      adaptationInput.result,
    );
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM case_runtime_match) AS matches,
           (SELECT count(*)::integer FROM case_runtime_adaptation) AS adaptations,
           (SELECT count(*)::integer FROM compiled_artifact
             WHERE artifact_id IN ('case-1','route-1')) AS artifact_mutations`,
      ),
    ).resolves.toMatchObject({
      rows: [{ matches: 1, adaptations: 1, artifact_mutations: 0 }],
    });
  });

  it('rejects immutable Case adaptation identifier drift', async () => {
    const repository = new PostgresCaseModelRuntimeRepository(pool);
    const input = {
      adaptationId: 'adaptation-1',
      request: adaptationRequest(),
      result: adaptationResult(),
      artifactHash: HASH,
      activePointerVersion: 3,
      createdAt: NOW,
    };
    await repository.saveAdaptation(input);
    await expect(
      repository.saveAdaptation({
        ...input,
        result: { ...input.result, confidence: 0.1 },
      }),
    ).rejects.toBeInstanceOf(CaseModelRuntimePersistenceError);
  });

  it('persists route, bounded cascade steps and transactional Outbox exactly once', async () => {
    const repository = new PostgresCaseModelRuntimeRepository(pool);
    const decision = createModelRouteDecision({
      route: 'local_small',
      reasonCodes: ['MODEL_ROUTE_SELECTED'],
      budget: { maxTokens: 100, maxLatencyMs: 500, maxCostUnits: 10 },
      fallbackRoutes: ['cloud_medium'],
      selectedProfileRefs: ['profile-small', 'profile-medium'],
    });
    const routeDecisionRef = `model-route-decision:${decision.decisionHash.slice(-24)}`;
    const routeInput = {
      routeDecisionRef,
      context: routeContext(),
      artifactRef: 'route-1:1',
      artifactHash: HASH,
      activePointerVersion: 2,
      decision,
      createdAt: NOW,
    };
    await repository.saveDecision(routeInput);
    await repository.saveDecision(routeInput);
    const steps = [
      {
        stepRef: 'step-1',
        profileRef: 'profile-small',
        attempt: 1,
        status: 'rejected' as const,
        reasonCode: 'SCHEMA_INVALID',
        inputTokens: 10,
        outputTokens: 5,
        costUnits: 1,
      },
      {
        stepRef: 'step-2',
        profileRef: 'profile-medium',
        attempt: 1,
        status: 'accepted' as const,
        reasonCode: 'MODEL_CASCADE_OUTPUT_ACCEPTED',
        inputTokens: 10,
        outputTokens: 5,
        costUnits: 2,
        outputRef: 'output-2',
      },
    ];
    const run = createModelCascadeRun({
      cascadeRunId: 'cascade-1',
      routeDecisionRef,
      status: 'completed',
      stepRefs: steps.map((step) => step.stepRef),
      selectedOutputRef: 'output-2',
      totalCostUnits: 3,
      totalInputTokens: 20,
      totalOutputTokens: 10,
      completedAt: '2026-07-30T00:00:01.000Z',
    });
    const cascadeInput = { run, decisionHash: decision.decisionHash, steps };
    await repository.saveCascade(cascadeInput);
    await repository.saveCascade(cascadeInput);

    await expect(repository.findCascade('cascade-1')).resolves.toMatchObject({
      run: { status: 'completed', selectedOutputRef: 'output-2' },
      steps: [{ stepRef: 'step-1' }, { stepRef: 'step-2' }],
    });
    await expect(
      pool.query(
        `SELECT
           (SELECT count(*)::integer FROM model_route_decision) AS decisions,
           (SELECT count(*)::integer FROM model_cascade_run) AS runs,
           (SELECT count(*)::integer FROM model_cascade_step) AS steps,
           (SELECT count(*)::integer FROM cognitive_runtime_outbox
             WHERE event_type IN ('model_route.selected','model_cascade.escalated')) AS events`,
      ),
    ).resolves.toMatchObject({
      rows: [{ decisions: 1, runs: 1, steps: 2, events: 2 }],
    });
  });
});

function caseRequest(): CaseRetrievalInput {
  return {
    runtimeRequestRef: 'gateway-1',
    goalContextRef: 'goal-1',
    taskTypeId: 'inspect-device',
    problemFingerprint: {
      goalFeatureHash: HASH,
      entityClasses: ['climate-device'],
      environmentClasses: ['home'],
      capabilityState: ['climate.read'],
      failureTypes: [],
    },
    tenantId: 'tenant-1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    runtimeSnapshotHash: HASH,
  };
}

function adaptationRequest(): CaseAdaptationInput {
  return {
    caseRef: 'case-1:1',
    goalContextRef: 'goal-1',
    parameterBindingRef: 'binding-1',
    policyDecisionRef: 'policy-1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    runtimeSnapshotHash: HASH,
  };
}

function adaptationResult(): CaseAdaptationResult {
  return {
    caseRef: 'case-1:1',
    parameterMappings: { room: 'office' },
    planPatchCandidate: { nodes: [{ capabilityId: 'climate.read' }] },
    confidence: 0.9,
    unknowns: [],
    validationRequired: true,
  };
}

function routeContext(): ModelRouteContext {
  return {
    requestRef: 'request-1',
    tenantId: 'tenant-1',
    taskTypeId: 'inspect-device',
    operationType: 'structured_generation',
    riskLevel: 'low',
    dataClassification: 'internal',
    requiredCapabilities: ['structured_output'],
    outputSchemaRef: 'schema:answer:v1',
    deadlineAt: '2026-07-30T00:01:00.000Z',
    budget: {
      maxCostUnits: 10,
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxInvocations: 2,
    },
    policySnapshotHash: HASH,
    providerProfileSnapshotHash: HASH,
  };
}
