import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TaskService } from '../../application/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresExternalTaskProjectionRepository,
  PostgresMcpRegistryRepository,
  PostgresModelRuntimeRepository,
  PostgresPromptRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowControlRepository,
  PostgresGoalRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillDraftRepository,
  PostgresSkillGraphRepository,
  PostgresSkillEmbeddingRepository,
  PostgresSkillSelectionRepository,
  PostgresTemporarySkillRepository,
  PostgresSkillRepository,
} from '../src/index.js';
import { createSkillVersion } from '../../domain/src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:54329/sdar';
const pool = new Pool({ connectionString, max: 4 });

beforeAll(async () => {
  const migration = await readFile(
    new URL('../../../infra/postgres/migrations/0002_protocol_domain.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(migration);
  const projectionMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0003_external_task_projection.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(projectionMigration);
  const taskRequestMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0004_task_request.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskRequestMigration);
  const projectionDecouplingMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0005_projection_decoupling.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(projectionDecouplingMigration);
  const skillDraftMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0006_skill_draft.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillDraftMigration);
  const skillRegistryMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0007_skill_registry.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillRegistryMigration);
  const mcpRegistryMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0008_mcp_registry.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(mcpRegistryMigration);
  const mcpAuditMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0009_mcp_audit.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(mcpAuditMigration);
  const skillGraphMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0010_skill_graph.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillGraphMigration);
  const skillSelectionMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0011_skill_selection.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillSelectionMigration);
  const temporarySkillMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0012_temporary_skill.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(temporarySkillMigration);
  const skillEmbeddingMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0013_skill_embedding.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillEmbeddingMigration);
  const modelRuntimeMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0014_model_runtime.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(modelRuntimeMigration);
  const promptRuntimeMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0015_prompt_runtime.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(promptRuntimeMigration);
  const workflowPlanningMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0016_workflow_planning.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(workflowPlanningMigration);
  const workflowExecutionMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0017_workflow_execution.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(workflowExecutionMigration);
  const workflowBudgetMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0018_workflow_budget.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(workflowBudgetMigration);
  const workflowControlMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0019_workflow_control.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(workflowControlMigration);
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE workflow_control_round, workflow_control, workflow_node_event, workflow_instance, workflow_plan_attempt, workflow_plan, model_invocation, stage_model_route, model_provider, prompt_version, prompt, skill_embedding, skill_formalization_candidate, temporary_skill_experience, temporary_skill, skill_replacement_plan, skill_selection_record, skill_performance_metrics, skill_relation, mcp_invocation, mcp_dependency_warning, mcp_tool, mcp_server, skill_version, skill, external_task_projection, runtime_event, agent_task, goal, conversation_context CASCADE',
  );
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL protocol-domain repositories', () => {
  it('persists every Workflow planning attempt and immutable validated plan', async () => {
    const repository = new PostgresWorkflowPlanRepository(pool);
    const definition = {
      workflowDefinitionId: 'workflow.db',
      version: 1,
      goalId: 'goal.db',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        {
          nodeId: 'result',
          name: 'Result',
          type: 'result' as const,
          value: { op: 'literal' as const, value: true },
        },
      ],
      edges: [],
    };
    await repository.saveAttempt({
      planId: 'plan.db',
      attempt: 1,
      candidate: { invalid: true },
      validationErrors: [{ code: 'INVALID', path: 'nodes', message: 'Invalid.' }],
      valid: false,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    await repository.saveAttempt({
      planId: 'plan.db',
      attempt: 2,
      candidate: definition,
      validationErrors: [],
      valid: true,
      createdAt: '2026-07-12T00:01:00.000Z',
    });
    await repository.savePlan({
      planId: 'plan.db',
      goalId: 'goal.db',
      goalVersion: 1,
      definition,
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 2,
      createdAt: '2026-07-12T00:01:00.000Z',
    });
    await expect(repository.findPlan('plan.db')).resolves.toEqual(
      expect.objectContaining({
        definition,
        attemptCount: 2,
        confirmationStatus: 'awaiting_confirmation',
      }),
    );
    const attempts = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int count FROM workflow_plan_attempt WHERE plan_id=$1',
      ['plan.db'],
    );
    expect(attempts.rows[0]?.count).toBe(2);
    await repository.confirmPlan('plan.db');
    await expect(repository.findConfirmedDefinition('workflow.db', 1)).resolves.toMatchObject({
      planId: 'plan.db',
      confirmationStatus: 'confirmed',
    });
  });
  it('persists Workflow instance transitions and ordered node events', async () => {
    const plans = new PostgresWorkflowPlanRepository(pool);
    await plans.savePlan({
      planId: 'plan.execution.db',
      goalId: 'goal.execution.db',
      goalVersion: 1,
      definition: {
        workflowDefinitionId: 'workflow.execution.db',
        version: 1,
        goalId: 'goal.execution.db',
        goalVersion: 1,
        entryNodeId: 'result',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: 'ok' },
          },
        ],
        edges: [],
      },
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const executions = new PostgresWorkflowExecutionRepository(pool);
    const running = {
      instanceId: 'instance.db',
      planId: 'plan.execution.db',
      workflowDefinitionId: 'workflow.execution.db',
      workflowVersion: 1,
      goalId: 'goal.execution.db',
      goalVersion: 1,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 3,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 0, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'running' as const,
      input: { request: 'run' },
      errors: {},
      startedAt: '2026-07-12T00:01:00.000Z',
    };
    await executions.saveInstance(running);
    await executions.saveNodeEvents([
      {
        eventId: 'workflow-event-1',
        instanceId: 'instance.db',
        sequence: 1,
        nodeId: 'result',
        eventType: 'node_started',
        timestamp: '2026-07-12T00:01:01.000Z',
        summary: 'result node started.',
      },
      {
        eventId: 'workflow-event-2',
        instanceId: 'instance.db',
        sequence: 2,
        nodeId: 'result',
        eventType: 'node_succeeded',
        timestamp: '2026-07-12T00:01:02.000Z',
        summary: 'result node succeeded.',
      },
    ]);
    await executions.saveInstance({
      ...running,
      status: 'succeeded',
      result: 'ok',
      completedAt: '2026-07-12T00:01:03.000Z',
    });

    await expect(executions.findInstance('instance.db')).resolves.toMatchObject({
      status: 'succeeded',
      result: 'ok',
      errors: {},
      skillVersions: [],
      budgetLimits: { maxDurationSeconds: 60, maxLlmCalls: 10, maxMcpCalls: 10 },
      budgetUsage: { replanCount: 0, llmCalls: 0, mcpCalls: 0, cost: 0 },
    });
    const events = await pool.query<{ sequence: number; event_type: string }>(
      'SELECT sequence,event_type FROM workflow_node_event WHERE instance_id=$1 ORDER BY sequence',
      ['instance.db'],
    );
    expect(events.rows).toEqual([
      { sequence: 1, event_type: 'node_started' },
      { sequence: 2, event_type: 'node_succeeded' },
    ]);
  });
  it('persists Goal authority and replayable outer-control rounds', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    await contexts.save({
      contextId: 'context.control.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const goals = new PostgresGoalRepository(pool);
    await goals.save({
      goalId: 'goal.control.db',
      contextId: 'context.control.db',
      version: 1,
      title: 'Control Goal',
      description: 'Exercise the outer controller.',
      constraints: ['local-only'],
      successCriteria: ['completed'],
      status: 'active',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const plans = new PostgresWorkflowPlanRepository(pool);
    await plans.savePlan({
      planId: 'plan.control.db',
      goalId: 'goal.control.db',
      goalVersion: 1,
      definition: {
        workflowDefinitionId: 'workflow.control.db',
        version: 1,
        goalId: 'goal.control.db',
        goalVersion: 1,
        entryNodeId: 'result',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: true },
          },
        ],
        edges: [],
      },
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const executions = new PostgresWorkflowExecutionRepository(pool);
    await executions.saveInstance({
      instanceId: 'instance.control.db',
      planId: 'plan.control.db',
      workflowDefinitionId: 'workflow.control.db',
      workflowVersion: 1,
      goalId: 'goal.control.db',
      goalVersion: 1,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 2,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'succeeded',
      input: {},
      result: true,
      errors: {},
      startedAt: '2026-07-12T00:00:00.000Z',
      completedAt: '2026-07-12T00:00:01.000Z',
    });
    const controls = new PostgresWorkflowControlRepository(pool);
    await controls.save({
      controlId: 'control.db',
      contextId: 'context.control.db',
      goalId: 'goal.control.db',
      goalVersion: 1,
      status: 'running',
      currentPlanId: 'plan.control.db',
      input: { request: 'run' },
      skillIds: [],
      planningInstruction: 'Complete.',
      roundCount: 0,
      replanCount: 0,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    await controls.saveRound({
      controlId: 'control.db',
      roundIndex: 0,
      planId: 'plan.control.db',
      instanceId: 'instance.control.db',
      workflowVersion: 1,
      evaluation: {
        decision: 'replan',
        summary: 'One criterion remains.',
        replanInstruction: 'Collect another result.',
      },
      createdAt: '2026-07-12T00:00:02.000Z',
    });

    await expect(goals.findActiveByContextId('context.control.db')).resolves.toMatchObject({
      goalId: 'goal.control.db',
      status: 'active',
    });
    await expect(controls.find('control.db')).resolves.toMatchObject({
      currentPlanId: 'plan.control.db',
      replanCount: 0,
    });
    await expect(controls.listRounds('control.db')).resolves.toEqual([
      expect.objectContaining({
        roundIndex: 0,
        evaluation: {
          decision: 'replan',
          summary: 'One criterion remains.',
          replanInstruction: 'Collect another result.',
        },
      }),
    ]);
  });
  it('keeps Prompt candidates inactive, publishes immutable versions, and aggregates invocation effects', async () => {
    const prompts = new PostgresPromptRepository(pool);
    await prompts.saveVersion(
      {
        promptId: 'prompt.db',
        stage: 'skill_authoring',
        version: 1,
        content: 'Candidate {{instruction}}',
        status: 'candidate',
        source: 'auto_candidate',
        createdAt: '2026-07-12T00:00:00.000Z',
      },
      false,
    );
    await expect(prompts.findCurrent('skill_authoring')).resolves.toBeUndefined();
    await prompts.saveVersion(
      {
        promptId: 'prompt.db',
        stage: 'skill_authoring',
        version: 2,
        previousVersion: 1,
        content: 'Published {{instruction}}',
        status: 'enabled',
        source: 'admin',
        createdAt: '2026-07-12T00:01:00.000Z',
      },
      true,
    );
    await expect(prompts.findCurrent('skill_authoring')).resolves.toMatchObject({
      version: 2,
      status: 'enabled',
    });
    await expect(prompts.effect('prompt.db', 2)).resolves.toEqual({
      promptId: 'prompt.db',
      version: 2,
      invocationCount: 0,
      successCount: 0,
      failureCount: 0,
      averageDurationMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  });
  it('persists encrypted Model Providers, fixed stage routes, and displayable invocation audits', async () => {
    const repository = new PostgresModelRuntimeRepository(pool);
    const configuration = {
      providerId: 'provider.db',
      name: 'DB Provider',
      kind: 'openai_compatible' as const,
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'model-db',
      enabled: true,
      timeoutMs: 5000,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    await repository.saveProvider({ configuration, encryptedCredential: 'aes-gcm-envelope' });
    await repository.saveStageRoute(
      'workflow_planning',
      configuration.providerId,
      configuration.updatedAt,
    );
    await repository.saveInvocation({
      invocationId: 'model-invocation-db-1',
      stage: 'workflow_planning',
      providerId: configuration.providerId,
      model: configuration.model,
      operation: 'structured_generation',
      request: { prompt: 'visible' },
      context: { taskId: 'task-db' },
      rawResponse: { choices: [] },
      structuredResult: { nodes: [] },
      inputTokens: 11,
      outputTokens: 4,
      durationMs: 25,
      status: 'succeeded',
      createdAt: configuration.createdAt,
    });

    await expect(repository.findProviderForStage('workflow_planning')).resolves.toEqual({
      configuration,
      encryptedCredential: 'aes-gcm-envelope',
    });
    await expect(repository.listInvocations('workflow_planning')).resolves.toEqual([
      expect.objectContaining({
        invocationId: 'model-invocation-db-1',
        inputTokens: 11,
        outputTokens: 4,
      }),
    ]);
    const raw = await pool.query<{ encrypted_credential: string }>(
      'SELECT encrypted_credential FROM model_provider',
    );
    expect(raw.rows[0]?.encrypted_credential).toBe('aes-gcm-envelope');
  });
  it('stores rebuildable Skill vectors and scores only matching provider dimensions with pgvector', async () => {
    const skills = new PostgresSkillRepository(pool);
    for (const [skillId, name] of [
      ['skill.vector.device', 'Device inspection'],
      ['skill.vector.invoice', 'Invoice review'],
    ] as const) {
      await skills.saveVersionAndSetCurrent(
        createSkillVersion({
          skillId,
          version: 1,
          name,
          summary: name,
          description: `${name} capability.`,
          capabilities: [name],
          workflowGuidance: 'Perform the capability.',
          outputInstruction: 'Return a result.',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          toolPolicy: { required: [], optional: [], forbidden: [] },
          runtimePolicy: { autoConfirmPlan: false },
          status: 'enabled',
          sourceKind: 'admin',
          validationPassed: true,
          createdAt: '2026-07-11T10:00:00.000Z',
        }),
        '2026-07-11T10:00:00.000Z',
      );
    }
    const repository = new PostgresSkillEmbeddingRepository(pool);
    await repository.upsert({
      skillId: 'skill.vector.device',
      skillVersion: 1,
      providerId: 'embedding.test.v1',
      searchableText: 'device inspection',
      vector: [1, 0, 0],
      updatedAt: '2026-07-11T10:00:00.000Z',
    });
    await repository.upsert({
      skillId: 'skill.vector.invoice',
      skillVersion: 1,
      providerId: 'embedding.test.v1',
      searchableText: 'invoice review',
      vector: [0, 1, 0],
      updatedAt: '2026-07-11T10:00:00.000Z',
    });

    const scores = await repository.cosineScores({
      skillIds: ['skill.vector.device', 'skill.vector.invoice'],
      providerId: 'embedding.test.v1',
      vector: [1, 0, 0],
    });
    expect(scores['skill.vector.device']).toBeCloseTo(1);
    expect(scores['skill.vector.invoice']).toBeCloseTo(0.5);
    await expect(
      repository.cosineScores({
        skillIds: ['skill.vector.device'],
        providerId: 'other-provider',
        vector: [1, 0, 0],
      }),
    ).resolves.toEqual({});
  });
  it('expires Temporary Skills atomically into experience without inserting a formal Skill', async () => {
    const repository = new PostgresTemporarySkillRepository(pool);
    const active = {
      temporarySkillId: 'temporary-db-1',
      taskId: 'task-db-1',
      contextId: 'context-db-1',
      name: 'Temporary',
      description: 'Task-only capability.',
      tools: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      capabilityFingerprint: 'fingerprint-db',
      status: 'active' as const,
      createdAt: '2026-07-11T10:00:00.000Z',
    };
    await repository.save(active);
    const expired = {
      ...active,
      status: 'expired' as const,
      expiredAt: '2026-07-11T10:01:00.000Z',
    };
    const experience = {
      experienceId: 'experience-db-1',
      temporarySkillId: active.temporarySkillId,
      taskId: active.taskId,
      contextId: active.contextId,
      capabilityFingerprint: active.capabilityFingerprint,
      successful: true,
      outcomeSummary: 'Succeeded.',
      createdAt: expired.expiredAt,
    };
    await repository.expireAndSaveExperience(expired, experience);
    await repository.saveFormalizationCandidate({
      candidateId: 'candidate-db-1',
      capabilityFingerprint: active.capabilityFingerprint,
      successfulExperienceCount: 2,
      requiredSuccessThreshold: 2,
      sourceExperienceIds: ['experience-db-0', experience.experienceId],
      status: 'awaiting_simulation',
      createdAt: expired.expiredAt,
    });

    await expect(repository.find(active.temporarySkillId)).resolves.toEqual(expired);
    await expect(
      repository.listSuccessfulExperiences(active.capabilityFingerprint),
    ).resolves.toEqual([experience]);
    await expect(
      repository.findFormalizationCandidate(active.capabilityFingerprint),
    ).resolves.toMatchObject({
      status: 'awaiting_simulation',
      successfulExperienceCount: 2,
    });
    const formalSkills = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM skill',
    );
    expect(formalSkills.rows[0]?.count).toBe('0');
  });

  it('persists Skill metrics, selection snapshots, and confirmation-bound replacement plans', async () => {
    const skills = new PostgresSkillRepository(pool);
    const version = createSkillVersion({
      skillId: 'skill.selection',
      version: 1,
      name: 'Selection',
      summary: 'Candidate.',
      description: 'Selection candidate Skill.',
      capabilities: ['selection'],
      workflowGuidance: 'Select.',
      outputInstruction: 'Return result.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-11T10:00:00.000Z',
    });
    await skills.saveVersionAndSetCurrent(version, version.createdAt);
    const repository = new PostgresSkillSelectionRepository(pool);
    const metrics = {
      sampleCount: 4,
      successRate: 0.75,
      averageDurationMs: 80,
      averageCost: 0.01,
      failureCount: 1,
      stabilityScore: 0.9,
    };
    await repository.saveMetrics(version.skillId, metrics, version.createdAt);
    const candidates = [
      {
        skillId: version.skillId,
        skillVersion: 1,
        semanticScore: 0.8,
        metrics,
      },
    ];
    const selection = {
      selectionId: 'selection-db-1',
      goalDescription: 'Select a Skill.',
      candidates,
      selectedSkillId: version.skillId,
      selectedSkillVersion: 1,
      decisionSummary: 'Selected from complete metrics.',
      createdAt: version.createdAt,
    };
    await repository.saveSelection(selection);
    await repository.saveReplacementPlan({
      replacementPlanId: 'replacement-db-1',
      selectionId: selection.selectionId,
      failedSkillId: version.skillId,
      candidates,
      replacementSkillId: version.skillId,
      replacementSkillVersion: 1,
      decisionSummary: 'Await confirmation.',
      status: 'awaiting_confirmation',
      createdAt: version.createdAt,
    });

    await expect(repository.findMetrics(version.skillId)).resolves.toEqual(metrics);
    await expect(repository.findSelection(selection.selectionId)).resolves.toEqual(selection);
    const persisted = await pool.query<{ status: string }>(
      'SELECT status FROM skill_replacement_plan WHERE replacement_plan_id = $1',
      ['replacement-db-1'],
    );
    expect(persisted.rows[0]?.status).toBe('awaiting_confirmation');
  });

  it('persists and deletes typed Skill graph relations with metadata', async () => {
    const skills = new PostgresSkillRepository(pool);
    for (const skillId of ['skill.graph.a', 'skill.graph.b']) {
      const version = createSkillVersion({
        skillId,
        version: 1,
        name: skillId,
        summary: 'Graph node.',
        description: 'Graph node Skill description.',
        capabilities: ['graph'],
        workflowGuidance: 'Use relation.',
        outputInstruction: 'Return output.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
        sourceKind: 'admin',
        validationPassed: true,
        createdAt: '2026-07-11T10:00:00.000Z',
      });
      await skills.saveVersionAndSetCurrent(version, version.createdAt);
    }
    const graph = new PostgresSkillGraphRepository(pool);
    const relation = {
      relationId: 'relation-1',
      sourceSkillId: 'skill.graph.a',
      targetSkillId: 'skill.graph.b',
      relationType: 'composition' as const,
      metadata: { order: 1 },
      createdAt: '2026-07-11T10:01:00.000Z',
    };
    await graph.saveRelation(relation);
    await expect(graph.listRelations()).resolves.toEqual([relation]);
    await graph.deleteRelation(relation.relationId);
    await expect(graph.listRelations()).resolves.toEqual([]);
  });

  it('stores encrypted MCP credentials and atomically replaces discovered Tool definitions', async () => {
    const repository = new PostgresMcpRegistryRepository(pool);
    const record = {
      server: {
        serverId: 'mcp.devices',
        name: 'Devices',
        endpoint: 'https://mcp.example.test/mcp',
        transport: 'streamable_http' as const,
        status: 'enabled' as const,
        toolRevision: 1,
        createdAt: '2026-07-11T10:00:00.000Z',
        updatedAt: '2026-07-11T10:00:00.000Z',
      },
      encryptedCredential: '{"v":1,"ciphertext":"not-plaintext"}',
    };
    await repository.saveServerAndReplaceTools(record, [
      {
        serverId: 'mcp.devices',
        toolName: 'status',
        inputSchema: { type: 'object' },
        discoveredAt: '2026-07-11T10:00:00.000Z',
      },
    ]);
    const skills = new PostgresSkillRepository(pool);
    const dependentSkill = createSkillVersion({
      skillId: 'skill.mcp-dependent',
      version: 1,
      name: 'MCP dependent',
      summary: 'Uses MCP status.',
      description: 'Uses the registered status Tool.',
      capabilities: ['status'],
      workflowGuidance: 'Call status.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: {
        required: [{ serverId: 'mcp.devices', toolName: 'status' }],
        optional: [],
        forbidden: [],
      },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-11T10:00:30.000Z',
    });
    await skills.saveVersionAndSetCurrent(dependentSkill, dependentSkill.createdAt);
    await repository.saveServerAndReplaceTools(
      {
        ...record,
        server: { ...record.server, toolRevision: 2, updatedAt: '2026-07-11T10:01:00.000Z' },
      },
      [
        {
          serverId: 'mcp.devices',
          toolName: 'inspect',
          inputSchema: { type: 'object' },
          discoveredAt: '2026-07-11T10:01:00.000Z',
        },
      ],
      [{ toolName: 'status', reason: 'removed' }],
    );
    await repository.saveInvocation({
      invocationId: 'invocation-1',
      taskId: 'task-1',
      contextId: 'context-1',
      serverId: 'mcp.devices',
      toolName: 'inspect',
      arguments: { deviceId: 'device-1' },
      result: { status: 'online' },
      status: 'succeeded',
      startedAt: '2026-07-11T10:02:00.000Z',
      completedAt: '2026-07-11T10:02:00.025Z',
      durationMs: 25,
    });
    await repository.updateToolEnhancement('mcp.devices', 'inspect', {
      purpose: 'Inspect device',
      scenarios: ['maintenance'],
      constraints: ['read-only'],
      returnDescription: 'Inspection result',
      commonErrors: ['offline'],
      tags: ['device'],
    });

    await expect(repository.findServer('mcp.devices')).resolves.toMatchObject({
      server: { toolRevision: 2 },
      encryptedCredential: record.encryptedCredential,
    });
    await expect(repository.listTools('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        toolName: 'inspect',
        enhancement: expect.objectContaining({ purpose: 'Inspect device', tags: ['device'] }),
      }),
    ]);
    const raw = await pool.query<{ encrypted_credential: string }>(
      'SELECT encrypted_credential FROM mcp_server WHERE server_id = $1',
      ['mcp.devices'],
    );
    expect(raw.rows[0]?.encrypted_credential).not.toContain('Bearer');
    await expect(repository.listDependencyWarnings('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        toolName: 'status',
        reason: 'removed',
        skillId: 'skill.mcp-dependent',
        skillVersion: 1,
      }),
    ]);
    await expect(repository.listInvocations('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        invocationId: 'invocation-1',
        status: 'succeeded',
        durationMs: 25,
        arguments: { deviceId: 'device-1' },
        result: { status: 'online' },
      }),
    ]);
  });

  it('atomically stores immutable Skill versions and publishes only the enabled current version', async () => {
    const repository = new PostgresSkillRepository(pool);
    const first = createSkillVersion({
      skillId: 'skill.inspect',
      version: 1,
      name: 'Inspect',
      summary: 'Inspect devices.',
      description: 'Inspects a device using registered tools.',
      capabilities: ['inspection'],
      workflowGuidance: 'Inspect safely.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-11T10:00:00.000Z',
    });
    await repository.saveVersionAndSetCurrent(first, first.createdAt);
    const second = createSkillVersion({
      ...first,
      version: 2,
      previousVersion: 1,
      status: 'disabled',
      createdAt: '2026-07-11T10:01:00.000Z',
    });
    await repository.saveVersionAndSetCurrent(second, second.createdAt);

    await expect(repository.findVersion(first.skillId, 1)).resolves.toEqual(first);
    await expect(repository.findCurrentVersion(first.skillId)).resolves.toEqual(second);
    await expect(repository.listEnabledVersions()).resolves.toEqual([]);
  });

  it('persists TaskService context/task/event and reads domain values back', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const events = new PostgresRuntimeEventPublisher(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events,
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });

    const submitted = await service.submit({
      userId: 'user-1',
      messageText: 'Inspect device status.',
      metadata: {},
    });
    const storedContext = await contexts.findById(submitted.context.contextId);
    const storedTask = await tasks.findById(submitted.task.taskId);
    const eventResult = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM runtime_event WHERE task_id = $1',
      [submitted.task.taskId],
    );

    expect(storedContext).toEqual(submitted.context);
    expect(storedTask).toEqual(submitted.task);
    expect(eventResult.rows[0]?.count).toBe('1');
  });

  it('updates task state without creating a duplicate system-of-record row', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const events = new PostgresRuntimeEventPublisher(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events,
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });
    const submitted = await service.submit({ messageText: 'Inspect.', metadata: {} });
    const canceled = await service.cancel(submitted.task.taskId);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM agent_task WHERE task_id = $1',
      [submitted.task.taskId],
    );

    expect(await tasks.findById(canceled.taskId)).toEqual(canceled);
    expect(count.rows[0]?.count).toBe('1');
  });

  it('persists and filters rebuildable external task projections', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events: new PostgresRuntimeEventPublisher(pool),
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });
    const submitted = await service.submit({ messageText: 'Project this task.', metadata: {} });
    const projections = new PostgresExternalTaskProjectionRepository(pool);
    await projections.save({
      protocol: 'a2a-v1',
      taskId: submitted.task.taskId,
      contextId: submitted.context.contextId,
      state: 'TASK_STATE_SUBMITTED',
      statusTimestamp: submitted.task.updatedAt,
      document: { id: submitted.task.taskId },
    });

    expect(await projections.find('a2a-v1', submitted.task.taskId)).toMatchObject({
      taskId: submitted.task.taskId,
      state: 'TASK_STATE_SUBMITTED',
    });
    await expect(
      projections.list({
        protocol: 'a2a-v1',
        contextId: submitted.context.contextId,
        state: 'TASK_STATE_SUBMITTED',
        offset: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({ total: 1 });
  });

  it('persists Skill requests only as drafts', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const drafts = new PostgresSkillDraftRepository(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events: new PostgresRuntimeEventPublisher(pool),
      skillDrafts: drafts,
      queue: { enqueue: () => Promise.resolve() },
      clock: { now: () => '2026-07-11T10:00:00.000Z' },
      ids: sequenceIds(),
    });
    const submitted = await service.submit({
      messageText: 'Create a read-only Skill.',
      metadata: {},
      skillDraftIntent: 'create',
    });

    await expect(drafts.listByContextId(submitted.context.contextId)).resolves.toEqual([
      expect.objectContaining({ status: 'draft', intent: 'create' }),
    ]);
  });

  it('applies the migration idempotently', async () => {
    const migration = await readFile(
      new URL('../../../infra/postgres/migrations/0002_protocol_domain.up.sql', import.meta.url),
      'utf8',
    );
    await expect(pool.query(migration)).resolves.toBeDefined();
    const marker = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migration WHERE version = '0002_protocol_domain'",
    );
    expect(marker.rows[0]?.count).toBe('1');
  });
});

function sequenceIds(): Readonly<{ nextId(kind: 'context' | 'task' | 'event'): string }> {
  const counters = { context: 0, task: 0, event: 0 };
  return {
    nextId: (kind) => `${kind}-${String(++counters[kind])}`,
  };
}
