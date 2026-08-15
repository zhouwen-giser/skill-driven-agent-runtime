import { afterEach, describe, expect, it } from 'vitest';

import { OpenAiCompatibleModelAdapter } from '../../../packages/model-provider-adapter/src/index.js';
import { assertCompositeReadOnlyPlan } from '../src/home-lab-a2a-read-only-driver.js';
import {
  HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
  homeLabA2AModelDecision,
} from '../src/home-lab-a2a-model-contract.js';
import {
  parseHomeLabA2AModelFixtureMode,
  startHomeLabA2AModelFixture,
  type HomeLabA2AModelFixtureHandle,
} from '../src/home-lab-a2a-model-fixture.js';

const token = 'home-lab-a2a-unit-token-0000000000000001';

describe('home-lab A2A structured Model fixture', () => {
  let fixture: HomeLabA2AModelFixtureHandle | undefined;
  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  it('uses the real OpenAI-compatible adapter wire for structured output and embeddings', async () => {
    fixture = await startHomeLabA2AModelFixture({ token });
    const adapter = new OpenAiCompatibleModelAdapter();
    const understanding = await adapter.generateStructured({
      configuration: configuration(fixture.baseUrl),
      credentialHeaders: { Authorization: `Bearer ${token}` },
      instruction: JSON.stringify({
        untrustedUserRequest: '查询客厅主灯和空调当前状态',
        taskTypeDefinitions: [
          {
            taskTypeId: 'task-type.home-lab-living-room-read-state',
            capabilityRequirements: ['home.living-room.read-state'],
          },
        ],
      }),
      responseSchema: { type: 'object' },
      correctionErrors: [],
      signal: AbortSignal.timeout(2_000),
    });
    expect(understanding.structuredResult).toMatchObject({
      interpretedObjective: '查询客厅主灯和空调当前状态',
      confidence: 1,
    });
    await expect(
      adapter.embed({
        configuration: configuration(fixture.baseUrl),
        credentialHeaders: { Authorization: `Bearer ${token}` },
        text: '客厅主灯和空调',
        signal: AbortSignal.timeout(2_000),
      }),
    ).resolves.toMatchObject({ vector: expect.arrayContaining([expect.any(Number)]) });
    await expect(
      adapter.embed({
        configuration: configuration(fixture.baseUrl),
        credentialHeaders: { Authorization: 'Bearer wrong-token-that-is-long-enough-0001' },
        text: 'must fail',
        signal: AbortSignal.timeout(2_000),
      }),
    ).rejects.toMatchObject({ code: 'MODEL_UPSTREAM_ERROR' });
  });

  it.each([
    'workflow_wrong_resource_ref',
    'workflow_unreachable',
    'workflow_wrong_result_mapping',
  ] as const)(
    'keeps malformed workflow mode %s observable and blocked before MCP',
    async (mode) => {
      fixture = await startHomeLabA2AModelFixture({ token, mode });
      const generated = await generateWorkflow(fixture.baseUrl);
      expect(() => {
        assertCompositeReadOnlyPlan({ definition: generated });
      }).toThrow(expect.objectContaining({ code: expect.stringMatching(/^A2A_PLAN_/u) }));
    },
  );

  it('extracts only two successful MCP structured results and rejects provider errors', () => {
    const instruction = resultInstruction(false);
    expect(homeLabA2AModelDecision(instruction).structuredResult).toMatchObject({
      structured: {
        mainLight: { resourceId: 'living-room-main-light' },
        climate: { resourceId: 'living-room-air-conditioner' },
      },
      memoryCandidates: [],
    });
    expect(() => homeLabA2AModelDecision(resultInstruction(true))).toThrow(
      'HOME_LAB_A2A_MODEL_RESULT_PROVIDER_ERROR',
    );
  });

  it('freezes exact SkillGoal refs and achieves only from two successful evidenced results', () => {
    const planned = plannedSkillGoal('goal-g08-first');
    expect(planned).toMatchObject({
      skillGoals: [
        {
          capabilityNeeds: ['home.living-room.read-state'],
          coveredCriterionIds: ['criterion-1'],
          requiredEffectRefs: ['effect.home.living-room.state_read'],
          evidenceRequirements: ['light.state.observation', 'climate.state.observation'],
          artifactRequirements: [],
        },
      ],
    });

    const replayed = plannedSkillGoal('goal-g08-first');
    const nextTask = plannedSkillGoal('goal-g08-second');
    expect(replayed.skillGoals).toEqual(planned.skillGoals);
    expect(nextTask.skillGoals[0]?.skillGoalId).not.toBe(planned.skillGoals[0]?.skillGoalId);

    expect(homeLabA2AModelDecision(goalEvaluationInstruction(true)).structuredResult).toEqual({
      decision: 'achieved',
      summary: 'Both exact public resource states were returned with Provider evidence.',
    });
    expect(() => homeLabA2AModelDecision(goalEvaluationInstruction(false))).toThrow(
      'HOME_LAB_A2A_MODEL_GOAL_PROVIDER_EVIDENCE_MISSING',
    );
  });

  it('emits the exact G09 human-confirmation route and governed main-light Tool contract', () => {
    const decision = homeLabA2AModelDecision(
      JSON.stringify({
        operation: 'task_initial_plan',
        workflowIdentity: {
          workflowDefinitionId: 'workflow.g09.main-light.control',
          version: 2,
          goalId: 'goal.g09',
          goalVersion: 1,
        },
        skillUsagePolicy: {
          skill: { skillId: 'home.light.set-power', skillVersion: 2 },
        },
      }),
    );
    expect(decision.structuredResult['entryNodeId']).toBe('confirmControl');
    expect(decision.structuredResult['nodes']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'setPower',
          type: 'mcp_tool',
          tool: { serverId: 'home-lab-light-mcp-g09', toolName: 'light_set_power' },
        }),
      ]),
    );
    expect(decision.structuredResult['edges']).toEqual(
      expect.arrayContaining([
        { sourceNodeId: 'confirmControl', targetNodeId: 'setPower', outcome: 'success' },
        { sourceNodeId: 'confirmControl', targetNodeId: 'failure', outcome: 'failure' },
      ]),
    );
  });

  it('returns safe auxiliary quality and durable evaluation-memory decisions', () => {
    expect(
      homeLabA2AModelDecision(
        JSON.stringify({
          operation: 'evaluate_task_component',
          component: 'workflow',
          evidence: {
            taskId: 'task-g08',
            goal: {},
            goalEvaluation: {},
            workflow: {},
            instance: {},
            processedResult: {},
          },
        }),
      ).structuredResult,
    ).toMatchObject({ score: 1, findings: [] });
    expect(
      homeLabA2AModelDecision(
        JSON.stringify({
          operation: 'refine_memory',
          candidate: {
            type: 'success_experience',
            content: { evolutionKind: 'evaluation_conclusion', decision: 'achieved' },
            summary: 'Both reads succeeded.',
            confidence: 1,
            authorityHint: 'skill_experience',
            sourceRefs: ['workflow-control-round:control-g08:0'],
          },
        }),
      ).structuredResult,
    ).toMatchObject({ durability: 'durable', authority: 'skill_experience' });
  });

  it('rejects unknown standalone modes instead of degrading to valid behavior', () => {
    expect(parseHomeLabA2AModelFixtureMode('valid')).toBe('valid');
    expect(() => parseHomeLabA2AModelFixtureMode('typo-valid')).toThrow(
      'HOME_LAB_A2A_MODEL_FIXTURE_MODE_INVALID',
    );
  });

  it('rejects non-loopback binding and non-JSON or extra chat fields', async () => {
    await expect(
      startHomeLabA2AModelFixture({ token, host: '0.0.0.0' as '127.0.0.1' }),
    ).rejects.toThrow('HOME_LAB_A2A_MODEL_FIXTURE_LOOPBACK_REQUIRED');
    fixture = await startHomeLabA2AModelFixture({ token });
    const noContentType = await fetch(`${fixture.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL, input: 'probe' }),
      redirect: 'manual',
    });
    expect(noContentType.status).toBe(415);
    const extraChatField = await fetch(`${fixture.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
        messages: [
          { role: 'system', content: 'JSON only.' },
          { role: 'user', content: '{}' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'probe', strict: true, schema: {} },
        },
        ungoverned: true,
      }),
      redirect: 'manual',
    });
    expect(extraChatField.status).toBe(400);
  });
});

function plannedSkillGoal(goalId: string) {
  return homeLabA2AModelDecision(
    JSON.stringify({
      operation: 'plan_user_goal_skill_goal_dag',
      contract: {
        goalId,
        criteria: [
          {
            criterionId: 'criterion-1',
            expectedEffectRefs: ['effect-1'],
            evidenceRequirements: ['evidence-1'],
            artifactRequirements: [],
          },
        ],
        constraints: ['Read only.'],
      },
    }),
  ).structuredResult as Readonly<{
    skillGoals: readonly Readonly<{ skillGoalId: string }>[];
  }>;
}

async function generateWorkflow(baseUrl: string): Promise<unknown> {
  const generated = await new OpenAiCompatibleModelAdapter().generateStructured({
    configuration: configuration(baseUrl),
    credentialHeaders: { Authorization: `Bearer ${token}` },
    instruction: JSON.stringify({
      operation: 'task_initial_plan',
      workflowIdentity: {
        workflowDefinitionId: 'workflow.g08',
        version: 1,
        goalId: 'goal.g08',
        goalVersion: 1,
      },
    }),
    responseSchema: { type: 'object' },
    correctionErrors: [],
    signal: AbortSignal.timeout(2_000),
  });
  return generated.structuredResult;
}

function configuration(baseUrl: string) {
  return {
    providerId: 'provider.home-lab-a2a-structured-fixture',
    name: 'Home-lab fixture',
    kind: 'local' as const,
    apiStyle: 'openai_chat_completions' as const,
    baseUrl,
    model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
    enabled: true,
    timeoutMs: 2_000,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  };
}

function resultInstruction(mainLightError: boolean): string {
  return JSON.stringify({
    operation: 'process_workflow_result',
    normalized: {
      errors: [],
      data: {
        mainLight: {
          data: {
            isError: mainLightError,
            structuredContent: { resourceId: 'living-room-main-light', power: 'on' },
          },
        },
        evidenceMainLight: true,
        climate: {
          data: {
            isError: false,
            structuredContent: {
              resourceId: 'living-room-air-conditioner',
              hvacMode: 'cool',
            },
          },
        },
        evidenceClimate: true,
      },
    },
  });
}

function goalEvaluationInstruction(evidencePresent: boolean): string {
  return JSON.stringify({
    goal: {},
    workflow: {
      status: 'succeeded',
      errors: {},
      result: {
        mainLight: {
          data: {
            isError: false,
            structuredContent: { resourceId: 'living-room-main-light', power: 'on' },
          },
        },
        evidenceMainLight: evidencePresent,
        climate: {
          data: {
            isError: false,
            structuredContent: {
              resourceId: 'living-room-air-conditioner',
              hvacMode: 'cool',
            },
          },
        },
        evidenceClimate: true,
      },
    },
  });
}
