import { randomBytes } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { TaskService } from '../../application/src/index.js';
import { Aes256GcmSecretCipher } from '../../crypto-adapter/src/index.js';
import {
  PostgresAgentTaskRepository,
  PostgresConversationContextRepository,
  PostgresExternalTaskProjectionRepository,
  PostgresMcpRegistryRepository,
  PostgresModelRuntimeRepository,
  PostgresMemoryRepository,
  PostgresMemoryRetentionPolicyRepository,
  PostgresPromptRepository,
  PostgresProcessedResultRepository,
  PostgresRuntimeTerminalOutcomeRepository,
  PostgresWorkflowPlanRepository,
  PostgresWorkflowTemplateRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowControlRepository,
  PostgresGoalRepository,
  PostgresGoalCancellationRepository,
  PostgresGoalInputInferenceRepository,
  PostgresGoalPatchRepository,
  PostgresRuntimeEventPublisher,
  PostgresRuntimeRecoveryRepository,
  PostgresSkillDraftRepository,
  PostgresSkillGraphRepository,
  PostgresSkillEmbeddingRepository,
  PostgresSkillSelectionRepository,
  PostgresSkillExecutionRepository,
  PostgresSkillInputResolutionRepository,
  PostgresSkillQualityRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresTemporarySkillRepository,
  PostgresTaskWaitPolicyRepository,
  PostgresSkillRepository,
  PostgresEvolutionExperienceRepository,
  PostgresEvolutionPolicyRepository,
  PostgresImplicitFeedbackRepository,
  PostgresTaskQualityReportRepository,
  PostgresEvaluationInfluenceRepository,
  PostgresEvaluationAnalyticsRepository,
  PostgresTaskInputRepository,
  PostgresRemoteTaskRepository,
  PostgresWorkflowContinuationRepository,
} from '../src/index.js';
import {
  bindTaskGoal,
  createAgentTask,
  createTaskExecutionAttempt,
  createTaskInputRequest,
  createRemoteTaskBinding,
  createWorkflowContinuationSnapshot,
  createSkillVersion,
  createSkillUsageSpecification,
  createSkillExecutionEvent,
  createSkillExecutionRecord,
  createSkillExecutionReference,
  snapshotSkillUsageCompositionPlan,
  snapshotSkillUsagePlanPolicy,
  DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
  recordTaskCapabilityGap,
  transitionTask,
} from '../../domain/src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });

function testGoalContract(goalId: string, version = 1) {
  return {
    goalId,
    version,
    title: `Test Goal ${goalId}`,
    description: `Exercise ${goalId}.`,
    constraints: ['test-only'],
    successCriteria: ['verified'],
  } as const;
}

function testCompositionContext() {
  const skillSnapshot = (skillId: string, version: number) => ({
    skillId,
    version,
    name: skillId,
    summary: `Summary for ${skillId}.`,
    description: `Description for ${skillId}.`,
    capabilities: [`capability:${skillId}`],
    workflowGuidance: `Use ${skillId}.`,
    outputInstruction: 'Return a verified result.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    createdAt: '2026-07-12T00:00:00.000Z',
  });
  const selectedSkill = skillSnapshot('skill.root.db', 2);
  return {
    selectedSkill: {
      ...selectedSkill,
      usageSpecification: createSkillUsageSpecification({
        apiVersion: 'sdar.io/v1alpha1',
        visibility: { userSelectable: true, composable: true, internalOnly: false },
        normative: {
          constraints: ['Use the verified provider.'],
          forbiddenActions: [],
          requiredConfirmations: [],
          noApplicableSkill: 'reject',
        },
        adaptive: {
          instructions: ['Prefer the shortest verified path.'],
          optimizationHints: [],
          allowPreferredProviderFallback: false,
        },
        contextRequirements: [],
        modes: {
          supported: ['guidance'],
          defaultMode: 'guidance',
          guidance: { summary: 'Guide the workflow.', instructions: ['Use verified inputs.'] },
        },
        taskBindings: [],
        evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
      }),
    },
    relatedSkills: [skillSnapshot('skill.child.db', 3)],
    relations: [
      {
        relationId: 'relation.composition.db',
        sourceSkillId: 'skill.root.db',
        targetSkillId: 'skill.child.db',
        relationType: 'composition' as const,
        metadata: { reason: 'verified schema bridge' },
        createdAt: '2026-07-12T00:00:01.000Z',
      },
    ],
    allowedChildSkillIds: ['skill.child.db'],
    decisionSummary: 'Bounded composition context for persistence verification.',
  };
}

function testUsagePlanPolicy() {
  const composition = snapshotSkillUsageCompositionPlan({
    root: { skillId: 'skill.root.db', skillVersion: 2 },
    expandedSkills: [{ skillId: 'skill.root.db', skillVersion: 2 }],
    edges: [],
    maxDepth: 3,
    consumedDepth: 0,
    consumedSkills: 1,
    consumedNodes: 0,
  });
  return snapshotSkillUsagePlanPolicy({
    skill: composition.root,
    mode: 'guidance',
    modeDecision: {
      decision: 'selected',
      mode: 'guidance',
      confirmationRequired: true,
      confirmationSatisfied: false,
      reasonCodes: ['plan_confirmation_required'],
    },
    constraints: ['Use the exact plan authority.'],
    forbiddenActions: [],
    adaptiveInstructions: ['Plan safely.'],
    requiredConfirmations: ['confirm-plan'],
    requiredContextIds: [],
    allowedTools: [],
    taskOperations: [],
    childPolicies: [],
    evidenceRequirements: [],
    rejectSuccessWithoutRequiredEvidence: false,
    composition,
    context: {
      requirements: [],
      satisfied: 0,
      total: 0,
      complete: true,
      inputRequiredIds: [],
      unsatisfiedIds: [],
      unknownIds: [],
    },
    readiness: { overall: 'ready', bindings: [] },
  });
}

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});
beforeEach(async () => {
  await pool.query(
    `UPDATE memory_retention_policy SET review_after_days=90,archive_after_days=365,
       delete_after_days=730,automatic_archive_enabled=false,automatic_delete_enabled=false,
       updated_at=CURRENT_TIMESTAMP WHERE singleton=true`,
  );
  await pool.query(
    'TRUNCATE skill_execution_reference, skill_execution_event, skill_execution_record, skill_package_import_audit, skill_input_resolution, runtime_terminal_outcome, mcp_management_operation, task_quality_report, memory_status_transition, workflow_template_use, workflow_template, workflow_template_occurrence, skill_quality_warning, skill_quality_observation, evolution_trigger, evolution_experience, goal_input_inference, memory_item, skill_call_workflow, workflow_control_round, workflow_control, workflow_node_event, workflow_instance, workflow_plan_attempt, workflow_plan, model_invocation, stage_model_route, model_provider, prompt_version, prompt, skill_embedding, skill_formalization_candidate, temporary_skill_experience, temporary_skill, skill_replacement_plan, skill_selection_record, skill_performance_metrics, skill_relation, mcp_invocation, mcp_dependency_warning, mcp_tool, mcp_server, skill_version, skill, external_task_projection, runtime_event, agent_task, goal, conversation_context CASCADE',
  );
  await pool.query(
    'UPDATE evolution_policy SET success_threshold=2,updated_at=$1 WHERE singleton=true',
    ['2026-07-12T00:00:00.000Z'],
  );
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL protocol-domain repositories', () => {
  it('persists low-confidence feedback and finds the previous terminal Task', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const feedback = new PostgresImplicitFeedbackRepository(pool);
    await contexts.save({
      contextId: 'context.feedback.db',
      userId: 'anonymous',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    });
    const previous = createAgentTask({
      taskId: 'task.feedback.previous',
      contextId: 'context.feedback.db',
      userId: 'anonymous',
      requestText: 'Inspect the device.',
      requestMetadata: {},
      timestamp: '2026-07-13T00:00:00.000Z',
    });
    const current = createAgentTask({
      taskId: 'task.feedback.current',
      contextId: 'context.feedback.db',
      userId: 'anonymous',
      requestText: 'Continue.',
      requestMetadata: {},
      timestamp: '2026-07-13T00:01:00.000Z',
    });
    await tasks.save(previous);
    await pool.query("UPDATE agent_task SET phase='completed',updated_at=$2 WHERE task_id=$1", [
      previous.taskId,
      '2026-07-13T00:00:30.000Z',
    ]);
    await tasks.save(current);

    await expect(
      feedback.findPreviousTerminal('context.feedback.db', current.taskId),
    ).resolves.toMatchObject({ taskId: previous.taskId, phase: 'completed' });
    await feedback.save({
      feedbackId: 'feedback.db.1',
      kind: 'accepted_result',
      sourceTaskId: previous.taskId,
      triggerTaskId: current.taskId,
      contextId: 'context.feedback.db',
      confidence: 0.35,
      evidenceSummary: 'A successor followed the terminal Task.',
      createdAt: '2026-07-13T00:01:00.000Z',
    });
    await expect(feedback.listByTask(previous.taskId)).resolves.toEqual([
      expect.objectContaining({
        feedbackId: 'feedback.db.1',
        kind: 'accepted_result',
        confidence: 0.35,
      }),
    ]);
  });

  it('collects conversation evidence and replays an explainable input inference', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    await contexts.save({
      contextId: 'context.inference.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    for (const [taskId, requestText] of [
      ['task.inference.source', 'The device is device-17.'],
      ['task.inference.current', 'Inspect it.'],
    ] as const)
      await tasks.save(
        createAgentTask({
          taskId,
          contextId: 'context.inference.db',
          userId: 'operator',
          requestText,
          requestMetadata: {},
          timestamp: taskId.endsWith('source')
            ? '2026-07-12T00:00:00.000Z'
            : '2026-07-12T00:00:01.000Z',
        }),
      );
    const repository = new PostgresGoalInputInferenceRepository(pool);
    const evidence = await repository.collect('context.inference.db', 'task.inference.current', 10);
    expect(evidence.conversationHistory).toMatchObject([
      { sourceId: 'task:task.inference.source', kind: 'conversation_history' },
    ]);
    await repository.save({
      inferenceId: 'inference.db',
      taskId: 'task.inference.current',
      contextId: 'context.inference.db',
      outcome: 'inferred',
      decisionSummary: 'The prior request identifies device-17.',
      usedSources: evidence.conversationHistory,
      inferredGoal: {
        title: 'Inspect device',
        description: 'Inspect device-17.',
        constraints: [],
        successCriteria: ['Inspected'],
      },
      createdAt: '2026-07-12T00:00:02.000Z',
    });
    await expect(repository.listByTask('task.inference.current')).resolves.toMatchObject([
      {
        outcome: 'inferred',
        usedSources: [{ sourceId: 'task:task.inference.source' }],
        inferredGoal: { description: 'Inspect device-17.' },
      },
    ]);
  });
  it('persists source-linked global memory and ranks active pgvector matches', async () => {
    const repository = new PostgresMemoryRepository(pool);
    await repository.save(
      {
        memoryId: 'memory.global.db',
        type: 'fact',
        content: { deviceId: 'device-17', ownerUserId: 'user-a' },
        summary: 'The target device is device-17.',
        status: 'active',
        sourceRefs: ['task.user-a'],
        supersedes: [],
        confidence: 0.9,
        durability: 'durable',
        authority: 'admin',
        durabilityReason: 'An operator supplied a stable target identifier.',
        createdAt: '2026-07-12T00:00:00.000Z',
      },
      { providerId: 'embedding.db', vector: [1, 0, 0] },
    );
    await repository.save(
      {
        memoryId: 'memory.global.db.unknown',
        type: 'fact',
        content: { state: 'unclassified' },
        summary: 'Unclassified durability.',
        status: 'active',
        sourceRefs: ['legacy:unknown'],
        supersedes: [],
        confidence: 0.5,
        durability: 'unknown',
        authority: 'model_inferred',
        durabilityReason: 'The legacy evidence has not been reviewed.',
        createdAt: '2026-07-12T00:00:05.000Z',
      },
      { providerId: 'embedding.db', vector: [1, 0, 0] },
    );
    await expect(
      repository.search({ providerId: 'embedding.db', vector: [1, 0, 0], limit: 5 }),
    ).resolves.toMatchObject([
      {
        item: {
          memoryId: 'memory.global.db',
          sourceRefs: ['task.user-a'],
          content: { deviceId: 'device-17' },
        },
        score: 1,
      },
    ]);
    const vector8 = [1, 0, 0, 0, 0, 0, 0, 0];
    const vector1536 = [1, ...Array<number>(1535).fill(0)];
    await repository.save(
      {
        memoryId: 'memory.global.db.8',
        type: 'workflow_pattern',
        content: { dimensions: 8 },
        summary: 'Eight-dimensional provider memory.',
        status: 'active',
        sourceRefs: ['skill-experience:8'],
        supersedes: [],
        confidence: 0.9,
        durability: 'durable',
        authority: 'skill_experience',
        durabilityReason: 'The workflow pattern is reusable.',
        createdAt: '2026-07-12T00:00:10.000Z',
      },
      { providerId: 'embedding.db', vector: vector8 },
    );
    await repository.save(
      {
        memoryId: 'memory.global.db.1536',
        type: 'skill_learning',
        content: { dimensions: 1536 },
        summary: 'Large provider memory.',
        status: 'active',
        sourceRefs: ['skill-experience:1536'],
        supersedes: [],
        confidence: 0.95,
        durability: 'durable',
        authority: 'skill_experience',
        durabilityReason: 'The Skill lesson is reusable.',
        createdAt: '2026-07-12T00:00:20.000Z',
      },
      { providerId: 'embedding.large', vector: vector1536 },
    );
    await expect(
      repository.search({ providerId: 'embedding.db', vector: vector8, limit: 5 }),
    ).resolves.toMatchObject([{ item: { memoryId: 'memory.global.db.8' }, score: 1 }]);
    await expect(
      repository.search({ providerId: 'embedding.large', vector: vector1536, limit: 5 }),
    ).resolves.toMatchObject([{ item: { memoryId: 'memory.global.db.1536' }, score: 1 }]);
    await expect(
      repository.search({ providerId: 'embedding.other', vector: vector8, limit: 5 }),
    ).resolves.toEqual([]);
    const replacement = {
      memoryId: 'memory.global.db.v2',
      type: 'fact' as const,
      content: { deviceId: 'device-18' },
      summary: 'The target device is device-18.',
      status: 'active' as const,
      sourceRefs: ['task.user-b'],
      supersedes: ['memory.global.db'],
      confidence: 0.95,
      durability: 'durable' as const,
      authority: 'admin' as const,
      durabilityReason: 'New operator evidence replaces the target identifier.',
      createdAt: '2026-07-12T00:01:00.000Z',
    };
    await repository.saveAndSupersede(
      replacement,
      { providerId: 'embedding.db', vector: [1, 0, 0] },
      [
        {
          transitionId: 'memory-transition.supersede.db',
          memoryId: 'memory.global.db',
          fromStatus: 'active',
          toStatus: 'superseded',
          replacementMemoryId: replacement.memoryId,
          actor: 'operator.test',
          reason: 'New evidence identifies a replacement target.',
          createdAt: '2026-07-12T00:01:00.000Z',
        },
      ],
    );
    await expect(repository.find('memory.global.db')).resolves.toMatchObject({
      status: 'superseded',
      content: { deviceId: 'device-17' },
    });
    await expect(repository.listTransitions('memory.global.db')).resolves.toMatchObject([
      { toStatus: 'superseded', replacementMemoryId: replacement.memoryId },
    ]);
    await repository.invalidate({
      transitionId: 'memory-transition.invalid.db',
      memoryId: replacement.memoryId,
      fromStatus: 'active',
      toStatus: 'invalid',
      actor: 'operator.test',
      reason: 'Evidence was retracted.',
      createdAt: '2026-07-12T00:02:00.000Z',
    });
    await expect(
      repository.search({ providerId: 'embedding.db', vector: [1, 0, 0], limit: 5 }),
    ).resolves.toEqual([]);
  });
  it('persists Memory retention fields without enabling or executing cleanup', async () => {
    const repository = new PostgresMemoryRetentionPolicyRepository(pool);
    await expect(repository.get()).resolves.toMatchObject({
      reviewAfterDays: 90,
      archiveAfterDays: 365,
      deleteAfterDays: 730,
      automaticArchiveEnabled: false,
      automaticDeleteEnabled: false,
    });
    await repository.update({
      reviewAfterDays: 30,
      archiveAfterDays: null,
      deleteAfterDays: null,
      automaticArchiveEnabled: false,
      automaticDeleteEnabled: false,
      updatedAt: '2026-07-12T00:03:00.000Z',
    });
    await expect(repository.get()).resolves.toMatchObject({
      reviewAfterDays: 30,
      archiveAfterDays: null,
      deleteAfterDays: null,
      automaticArchiveEnabled: false,
      automaticDeleteEnabled: false,
    });
  });
  it('persists every Workflow planning attempt and immutable validated plan', async () => {
    const repository = new PostgresWorkflowPlanRepository(pool);
    const toolExecutionSemantics = [
      {
        reference: { serverId: 'mcp.devices', toolName: 'status' },
        executionSemantics: {
          effect: 'read_only' as const,
          execution: 'synchronous' as const,
          cancellation: 'cooperative' as const,
          idempotency: 'client_request_key' as const,
          replay: 'allowed' as const,
          source: 'mcp_declared' as const,
        },
      },
    ];
    const mcpProtocolContract = {
      mode: 'frozen_v1' as const,
      protocolVersion: '2026-07-28',
      baselineSha256: 'a'.repeat(64),
      tasksSchemaSha256: 'b'.repeat(64),
      taskExecutionProfileVersion: '1.0' as const,
      evidenceProfileVersion: '1.0' as const,
      serverDiscoverySnapshotId: 'snapshot.workflow.db',
    };
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
      skillUsagePolicy: testUsagePlanPolicy(),
    };
    await repository.saveAttempt({
      planId: 'plan.db',
      goalContract: testGoalContract('goal.db'),
      compositionContext: testCompositionContext(),
      capabilityGapSkillIds: ['skill.gap.db'],
      toolExecutionSemantics,
      mcpProtocolContract,
      attempt: 1,
      candidate: { invalid: true },
      validationErrors: [{ code: 'INVALID', path: 'nodes', message: 'Invalid.' }],
      valid: false,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    await repository.saveAttempt({
      planId: 'plan.db',
      goalContract: testGoalContract('goal.db'),
      compositionContext: testCompositionContext(),
      capabilityGapSkillIds: ['skill.gap.db'],
      toolExecutionSemantics,
      mcpProtocolContract,
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
      goalContract: testGoalContract('goal.db'),
      compositionContext: testCompositionContext(),
      capabilityGapSkillIds: ['skill.gap.db'],
      toolExecutionSemantics,
      mcpProtocolContract,
      definition,
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 2,
      createdAt: '2026-07-12T00:01:00.000Z',
    });
    await expect(repository.findPlan('plan.db')).resolves.toEqual(
      expect.objectContaining({
        definition,
        goalContract: testGoalContract('goal.db'),
        compositionContext: testCompositionContext(),
        capabilityGapSkillIds: ['skill.gap.db'],
        toolExecutionSemantics,
        mcpProtocolContract,
        attemptCount: 2,
        confirmationStatus: 'awaiting_confirmation',
      }),
    );
    await pool.query(
      `UPDATE workflow_plan
       SET definition_json=jsonb_set(
         definition_json,
         '{skillUsagePolicy,skill,skillVersion}',
         '999'::jsonb
       )
       WHERE plan_id=$1`,
      ['plan.db'],
    );
    await expect(repository.findPlan('plan.db')).rejects.toMatchObject({
      code: 'SKILL_USAGE_PLAN_POLICY_INVALID',
    });
    await pool.query('UPDATE workflow_plan SET definition_json=$2::jsonb WHERE plan_id=$1', [
      'plan.db',
      JSON.stringify(definition),
    ]);
    const attempts = await pool.query<{
      count: number;
      contracts: unknown[];
      compositionContexts: unknown[];
      capabilityGaps: unknown[];
      toolSemantics: unknown[];
      protocolContracts: unknown[];
    }>(
      `SELECT COUNT(*)::int count,
              jsonb_agg(goal_contract_json ORDER BY attempt) contracts,
              jsonb_agg(composition_context_json ORDER BY attempt) "compositionContexts",
              jsonb_agg(capability_gap_skill_ids_json ORDER BY attempt) "capabilityGaps",
              jsonb_agg(tool_execution_semantics_json ORDER BY attempt) "toolSemantics",
              jsonb_agg(mcp_protocol_contract_json ORDER BY attempt) "protocolContracts"
       FROM workflow_plan_attempt WHERE plan_id=$1`,
      ['plan.db'],
    );
    expect(attempts.rows[0]?.count).toBe(2);
    expect(attempts.rows[0]?.contracts).toEqual([
      testGoalContract('goal.db'),
      testGoalContract('goal.db'),
    ]);
    expect(attempts.rows[0]?.compositionContexts).toEqual([
      testCompositionContext(),
      testCompositionContext(),
    ]);
    expect(attempts.rows[0]?.capabilityGaps).toEqual([['skill.gap.db'], ['skill.gap.db']]);
    expect(attempts.rows[0]?.toolSemantics).toEqual([
      toolExecutionSemantics,
      toolExecutionSemantics,
    ]);
    expect(attempts.rows[0]?.protocolContracts).toEqual([mcpProtocolContract, mcpProtocolContract]);
    await expect(
      pool.query(
        `UPDATE workflow_plan SET capability_gap_skill_ids_json='{}'::jsonb WHERE plan_id=$1`,
        ['plan.db'],
      ),
    ).rejects.toMatchObject({ constraint: 'workflow_plan_capability_gap_array_check' });
    await expect(
      repository.savePlan({
        planId: 'plan.invalid-contract.db',
        goalId: 'goal.db',
        goalVersion: 1,
        goalContract: testGoalContract('goal.other.db'),
        definition,
        confirmationStatus: 'awaiting_confirmation',
        attemptCount: 1,
        createdAt: '2026-07-12T00:01:00.000Z',
      }),
    ).rejects.toMatchObject({ constraint: 'workflow_plan_goal_contract_identity_check' });
    await repository.confirmPlan('plan.db', { confirmedAt: '2026-07-12T00:02:00.000Z' });
    await expect(repository.findConfirmedDefinition('workflow.db', 1)).resolves.toMatchObject({
      planId: 'plan.db',
      confirmationStatus: 'confirmed',
      confirmedAt: '2026-07-12T00:02:00.000Z',
    });
    const templates = new PostgresWorkflowTemplateRepository(pool);
    const template = {
      templateId: 'template.db',
      version: 1,
      goalKey: 'inspect device',
      structureKey: 'structure.db',
      workflow: definition,
      sourceExperienceIds: ['experience-1', 'experience-2', 'experience-3'],
      sourceSuccessCount: 3,
      useCount: 0,
      successfulUseCount: 0,
      averageUseDurationMs: 0,
      status: 'enabled' as const,
      createdAt: '2026-07-12T00:01:00.000Z',
    };
    await templates.saveTemplate(template);
    await templates.saveUse({
      useId: 'template-use.db',
      templateId: template.templateId,
      templateVersion: 1,
      planId: 'plan.db',
      workflowDefinitionId: definition.workflowDefinitionId,
      workflowVersion: 1,
      status: 'planned',
      createdAt: '2026-07-12T00:02:00.000Z',
    });
    const plannedUse = await templates.findPlannedUse(definition.workflowDefinitionId, 1);
    if (plannedUse === undefined) throw new Error('EXPECTED_TEMPLATE_USE');
    await templates.completeUse(
      {
        ...plannedUse,
        status: 'succeeded',
        durationMs: 25,
        completedAt: '2026-07-12T00:03:00.000Z',
      },
      { ...template, useCount: 1, successfulUseCount: 1, averageUseDurationMs: 25 },
    );
    await expect(templates.listTemplates()).resolves.toMatchObject([
      { templateId: 'template.db', useCount: 1, successfulUseCount: 1 },
    ]);
    await expect(templates.listUses('template.db')).resolves.toMatchObject([
      { useId: 'template-use.db', status: 'succeeded', durationMs: 25 },
    ]);
    const validComposition = testCompositionContext();
    const admitted = validComposition.relatedSkills[0];
    if (admitted === undefined) throw new Error('EXPECTED_COMPOSITION_CHILD');
    const disconnected = {
      ...admitted,
      skillId: 'skill.disconnected.db',
    };
    await pool.query(
      `UPDATE workflow_plan SET composition_context_json=$2::jsonb WHERE plan_id=$1`,
      [
        'plan.db',
        JSON.stringify({
          ...validComposition,
          relatedSkills: [...validComposition.relatedSkills, disconnected],
          allowedChildSkillIds: [...validComposition.allowedChildSkillIds, disconnected.skillId],
        }),
      ],
    );
    await expect(repository.findPlan('plan.db')).rejects.toMatchObject({
      code: 'SKILL_COMPOSITION_CONTEXT_INVALID',
    });

    await pool.query(
      `UPDATE workflow_plan
       SET composition_context_json=jsonb_set(
         composition_context_json,
         '{selectedSkill,usageSpecification,apiVersion}',
         '"unsupported/v1"'::jsonb
       )
       WHERE plan_id=$1`,
      ['plan.db'],
    );
    await expect(repository.findPlan('plan.db')).rejects.toMatchObject({
      code: 'SKILL_USAGE_SPEC_INVALID',
    });
  });
  it('round-trips structured Task capability-gap evidence', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    await contexts.save({
      contextId: 'context.capability-gap.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    let task = createAgentTask({
      taskId: 'task.capability-gap.db',
      contextId: 'context.capability-gap.db',
      userId: 'operator',
      requestText: 'Read pressure.',
      requestMetadata: {},
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
      'evaluating',
    ] as const)
      task = transitionTask(task, phase, phase, '2026-07-12T00:00:01.000Z');
    task = recordTaskCapabilityGap(
      task,
      {
        evaluationSummary: 'No registered tool can read pressure.',
        missingCapability: 'Read device pressure.',
        suggestedToolContract: {
          name: 'read_pressure',
          description: 'Read pressure for one device.',
          inputSchema: { type: 'object', required: ['deviceId'] },
        },
      },
      '2026-07-12T00:00:02.000Z',
    );
    const tasks = new PostgresAgentTaskRepository(pool);
    await tasks.save(task);

    await expect(tasks.findById(task.taskId)).resolves.toMatchObject({
      phase: 'capability_gap',
      errorCode: 'CAPABILITY_GAP',
      capabilityGap: {
        missingCapability: 'Read device pressure.',
        suggestedToolContract: { name: 'read_pressure' },
      },
    });
    await expect(
      tasks.save({ ...task, phase: 'skill_resolution', phaseMessage: 'Stale Worker resumed.' }),
    ).rejects.toThrow('TASK_TERMINAL_MUTATION_FORBIDDEN');
    await expect(tasks.findById(task.taskId)).resolves.toMatchObject({
      phase: 'capability_gap',
      errorCode: 'CAPABILITY_GAP',
    });
    await pool.query('UPDATE agent_task SET capability_gap_json=NULL WHERE task_id=$1', [
      task.taskId,
    ]);
    await expect(tasks.findById(task.taskId)).rejects.toThrow(
      'TASK_CAPABILITY_GAP_TERMINAL_EVIDENCE_INVALID',
    );
  });
  it('atomically supersedes a plan when persisting its immutable revision', async () => {
    const repository = new PostgresWorkflowPlanRepository(pool);
    const sourceDefinition = {
      workflowDefinitionId: 'workflow.revision.db',
      version: 1,
      goalId: 'goal.revision.db',
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
    await repository.savePlan({
      planId: 'plan.revision.source',
      goalId: 'goal.revision.db',
      goalVersion: 1,
      goalContract: testGoalContract('goal.revision.db'),
      definition: sourceDefinition,
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    await repository.savePlanAndSupersede(
      {
        planId: 'plan.revision.next',
        goalId: 'goal.revision.db',
        goalVersion: 1,
        goalContract: testGoalContract('goal.revision.db'),
        definition: { ...sourceDefinition, version: 2 },
        sourcePlanId: 'plan.revision.source',
        revisionKind: 'admin_dsl',
        confirmationStatus: 'awaiting_confirmation',
        attemptCount: 1,
        createdAt: '2026-07-12T00:01:00.000Z',
      },
      'plan.revision.source',
    );

    await expect(repository.findPlan('plan.revision.source')).resolves.toMatchObject({
      confirmationStatus: 'superseded',
    });
    await expect(repository.findPlan('plan.revision.next')).resolves.toMatchObject({
      sourcePlanId: 'plan.revision.source',
      revisionKind: 'admin_dsl',
      confirmationStatus: 'awaiting_confirmation',
    });
    await expect(
      repository.savePlanAndSupersede(
        {
          planId: 'plan.revision.invalid',
          goalId: 'goal.revision.db',
          goalVersion: 1,
          goalContract: testGoalContract('goal.revision.db'),
          definition: { ...sourceDefinition, version: 3 },
          sourcePlanId: 'plan.revision.source',
          revisionKind: 'admin_dsl',
          confirmationStatus: 'awaiting_confirmation',
          attemptCount: 1,
          createdAt: '2026-07-12T00:02:00.000Z',
        },
        'plan.revision.source',
      ),
    ).rejects.toThrow('WORKFLOW_REVISION_SOURCE_NOT_ACTIVE');
    await expect(repository.findPlan('plan.revision.invalid')).resolves.toBeUndefined();
  });
  it('persists Workflow instance transitions and ordered node events', async () => {
    const plans = new PostgresWorkflowPlanRepository(pool);
    await plans.savePlan({
      planId: 'plan.execution.db',
      goalId: 'goal.execution.db',
      goalVersion: 1,
      goalContract: testGoalContract('goal.execution.db'),
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
        durationMs: 1000,
        summary: 'result node succeeded.',
      },
    ]);
    await executions.saveInstance({
      ...running,
      status: 'paused',
      pendingConfirmation: {
        nodeId: 'next',
        prompt: 'Task paused.',
        kind: 'task_pause',
        pausedAt: '2026-07-12T00:01:02.000Z',
      },
    });
    await expect(executions.findInstance('instance.db')).resolves.toMatchObject({
      status: 'paused',
      pendingConfirmation: { nodeId: 'next', kind: 'task_pause' },
    });
    await expect(executions.findActiveByPlanId('plan.execution.db')).resolves.toMatchObject({
      instanceId: 'instance.db',
      status: 'paused',
    });
    await expect(executions.findLatestByPlanId('plan.execution.db')).resolves.toMatchObject({
      instanceId: 'instance.db',
      status: 'paused',
    });
    await expect(executions.countNodeEvents('instance.db')).resolves.toBe(2);
    await expect(executions.listNodeEvents('instance.db')).resolves.toEqual([
      expect.objectContaining({ sequence: 1, nodeId: 'result', eventType: 'node_started' }),
      expect.objectContaining({
        sequence: 2,
        nodeId: 'result',
        eventType: 'node_succeeded',
        durationMs: 1000,
      }),
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
    const events = await pool.query<{
      sequence: number;
      event_type: string;
      duration_ms: number | null;
    }>(
      'SELECT sequence,event_type,duration_ms FROM workflow_node_event WHERE instance_id=$1 ORDER BY sequence',
      ['instance.db'],
    );
    expect(events.rows).toEqual([
      { sequence: 1, event_type: 'node_started', duration_ms: null },
      { sequence: 2, event_type: 'node_succeeded', duration_ms: 1000 },
    ]);
  });
  it('persists an independently traceable Skill-call child Workflow and actual Skill version', async () => {
    const skills = new PostgresSkillRepository(pool);
    const skill = createSkillVersion({
      skillId: 'skill.child.db',
      version: 1,
      name: 'Child Skill',
      summary: 'Child execution.',
      description: 'Runs as a child Workflow.',
      capabilities: ['child'],
      workflowGuidance: 'Return status.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    await skills.saveVersionAndSetCurrent(skill, skill.createdAt);
    const plans = new PostgresWorkflowPlanRepository(pool);
    const executions = new PostgresWorkflowExecutionRepository(pool);
    const definition = (id: string) => ({
      workflowDefinitionId: id,
      version: 1,
      goalId: 'goal.skill-call.db',
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
    });
    for (const [planId, workflowId] of [
      ['plan.parent.db', 'workflow.parent.db'],
      ['plan.child.db', 'workflow.child.db'],
      ['plan.child-second.db', 'workflow.child-second.db'],
    ] as const)
      await plans.savePlan({
        planId,
        goalId: 'goal.skill-call.db',
        goalVersion: 1,
        goalContract: testGoalContract('goal.skill-call.db'),
        definition: definition(workflowId),
        confirmationStatus: 'confirmed',
        attemptCount: 1,
        createdAt: '2026-07-12T00:00:00.000Z',
      });
    const instance = (instanceId: string, planId: string, workflowDefinitionId: string) => ({
      instanceId,
      planId,
      workflowDefinitionId,
      workflowVersion: 1,
      goalId: 'goal.skill-call.db',
      goalVersion: 1,
      skillVersions: [{ skillId: skill.skillId, version: skill.version }],
      budgetLimits: {
        maxReplans: 1,
        maxDurationSeconds: 60,
        maxLlmCalls: 2,
        maxMcpCalls: 0,
        maxCost: 10,
      },
      budgetUsage: { replanCount: 0, durationMs: 5, llmCalls: 1, mcpCalls: 0, cost: 1 },
      status: 'succeeded' as const,
      input: {},
      result: { status: 'online' },
      errors: {},
      startedAt: '2026-07-12T00:00:01.000Z',
      completedAt: '2026-07-12T00:00:02.000Z',
    });
    await executions.saveInstance(
      instance('instance.parent.db', 'plan.parent.db', 'workflow.parent.db'),
    );
    await executions.saveInstance(
      instance('instance.child.db', 'plan.child.db', 'workflow.child.db'),
    );
    await executions.saveInstance(
      instance('instance.child-second.db', 'plan.child-second.db', 'workflow.child-second.db'),
    );
    const repository = new PostgresSkillCallWorkflowRepository(pool);
    await repository.save({
      callId: 'skill-call.db.1',
      parentPlanId: 'plan.parent.db',
      parentInstanceId: 'instance.parent.db',
      parentNodeId: 'child',
      childInstanceId: 'instance.child.db',
      childPlanId: 'plan.child.db',
      skillId: skill.skillId,
      skillVersion: skill.version,
      confirmationStatus: 'confirmed',
      status: 'succeeded',
      evaluationSummary: 'Output Schema passed.',
      createdAt: '2026-07-12T00:00:01.000Z',
      completedAt: '2026-07-12T00:00:02.000Z',
    });
    await repository.save({
      callId: 'skill-call.db.2',
      parentPlanId: 'plan.parent.db',
      parentInstanceId: 'instance.parent.db',
      parentNodeId: 'child',
      childPlanId: 'plan.child-second.db',
      skillId: skill.skillId,
      skillVersion: skill.version,
      confirmationStatus: 'awaiting_confirmation',
      status: 'awaiting_confirmation',
      evaluationSummary: 'Independent child confirmation required.',
      createdAt: '2026-07-12T00:00:03.000Z',
    });
    await repository.save({
      callId: 'skill-call.db.2',
      parentPlanId: 'plan.parent.db',
      parentInstanceId: 'instance.parent.db',
      parentNodeId: 'child',
      childInstanceId: 'instance.child-second.db',
      childPlanId: 'plan.child-second.db',
      skillId: skill.skillId,
      skillVersion: skill.version,
      confirmationStatus: 'confirmed',
      status: 'succeeded',
      evaluationSummary: 'Repeated output Schema passed.',
      createdAt: '2026-07-12T00:00:03.000Z',
      completedAt: '2026-07-12T00:00:04.000Z',
    });
    await expect(repository.listByParent('instance.parent.db')).resolves.toEqual([
      expect.objectContaining({
        callId: 'skill-call.db.1',
        childInstanceId: 'instance.child.db',
        skillId: 'skill.child.db',
        skillVersion: 1,
        evaluationSummary: 'Output Schema passed.',
      }),
      expect.objectContaining({
        callId: 'skill-call.db.2',
        childInstanceId: 'instance.child-second.db',
        parentNodeId: 'child',
        evaluationSummary: 'Repeated output Schema passed.',
      }),
    ]);
    await expect(repository.find('instance.parent.db', 'child')).resolves.toMatchObject({
      callId: 'skill-call.db.2',
      childInstanceId: 'instance.child-second.db',
    });
    await expect(repository.findByChildInstanceId('instance.child.db')).resolves.toMatchObject({
      callId: 'skill-call.db.1',
      parentInstanceId: 'instance.parent.db',
      parentNodeId: 'child',
    });
    await expect(repository.findByChildInstanceId('instance.missing.db')).resolves.toBeUndefined();
  });

  it('atomically fails interrupted Tasks and Workflow instances without reconstructing execution', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    await contexts.save({
      contextId: 'context.interrupted.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    let task = createAgentTask({
      taskId: 'task.interrupted.db',
      contextId: 'context.interrupted.db',
      userId: 'operator',
      requestText: 'Run once.',
      requestMetadata: {},
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
      'executing',
    ] as const)
      task = transitionTask(task, phase, phase, '2026-07-12T00:00:01.000Z');
    const tasks = new PostgresAgentTaskRepository(pool);
    await tasks.save(task);
    const taskInputs = new PostgresTaskInputRepository(pool);
    await taskInputs.createInitialAttempt(
      createTaskExecutionAttempt({
        attemptId: 'attempt.interrupted.db',
        taskId: task.taskId,
        contextId: task.contextId,
        reason: 'initial',
        createdAt: '2026-07-12T00:00:00.000Z',
      }),
    );
    await taskInputs.updateAttempt('attempt.interrupted.db', 'running', '2026-07-12T00:00:01.000Z');
    const plans = new PostgresWorkflowPlanRepository(pool);
    await plans.savePlan({
      planId: 'plan.interrupted.db',
      goalId: 'goal.interrupted.db',
      goalVersion: 1,
      goalContract: testGoalContract('goal.interrupted.db'),
      definition: {
        workflowDefinitionId: 'workflow.interrupted.db',
        version: 1,
        goalId: 'goal.interrupted.db',
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
      instanceId: 'instance.interrupted.db',
      planId: 'plan.interrupted.db',
      workflowDefinitionId: 'workflow.interrupted.db',
      workflowVersion: 1,
      goalId: 'goal.interrupted.db',
      goalVersion: 1,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 3,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 4, llmCalls: 0, mcpCalls: 1, cost: 1 },
      status: 'paused',
      input: {},
      errors: {},
      startedAt: '2026-07-12T00:00:01.000Z',
      pendingConfirmation: { nodeId: 'confirm', prompt: 'Continue?' },
    });

    const recoveryNotifications: ReturnType<typeof createAgentTask>[] = [];
    await expect(
      new PostgresRuntimeRecoveryRepository(pool, (recoveredTask) => {
        recoveryNotifications.push(recoveredTask);
      }).failInterrupted('2026-07-12T00:01:00.000Z'),
    ).resolves.toEqual({ tasks: 1, workflowInstances: 1, taskAttempts: 1 });
    expect(recoveryNotifications).toEqual([
      expect.objectContaining({ taskId: task.taskId, phase: 'failed' }),
    ]);
    await expect(tasks.findById(task.taskId)).resolves.toMatchObject({
      phase: 'failed',
      errorCode: 'PROCESS_EXECUTION_LOST',
    });
    await expect(executions.findInstance('instance.interrupted.db')).resolves.toMatchObject({
      status: 'failed',
      errors: { runtime: { code: 'PROCESS_EXECUTION_LOST' } },
      completedAt: '2026-07-12T00:01:00.000Z',
    });
    await expect(taskInputs.findAttempt('attempt.interrupted.db')).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESS_EXECUTION_LOST',
      completedAt: '2026-07-12T00:01:00.000Z',
    });
  });
  it('persists Goal authority and replayable outer-control rounds', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    await contexts.save({
      contextId: 'context.control.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const tasks = new PostgresAgentTaskRepository(pool);
    const task = createAgentTask({
      taskId: 'task.control.db',
      contextId: 'context.control.db',
      userId: 'operator',
      requestText: 'Exercise the outer controller.',
      requestMetadata: {},
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    await tasks.save(task);
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
      goalContract: testGoalContract('goal.control.db'),
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
      taskId: task.taskId,
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
        decision: 'replace_skill',
        summary: 'One criterion remains.',
        actionInstruction: 'Select the ranked replacement Skill.',
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
          decision: 'replace_skill',
          summary: 'One criterion remains.',
          actionInstruction: 'Select the ranked replacement Skill.',
        },
      }),
    ]);
    const runningControl = await controls.find('control.db');
    if (runningControl === undefined) throw new Error('WORKFLOW_CONTROL_NOT_FOUND');
    await controls.save({
      ...runningControl,
      status: 'capability_gap',
      roundCount: 1,
      finalInstanceId: 'instance.control.db',
      updatedAt: '2026-07-12T00:00:03.000Z',
    });
    await expect(
      controls.saveRound({
        controlId: 'control.db',
        roundIndex: 1,
        planId: 'plan.control.db',
        instanceId: 'instance.control.db',
        workflowVersion: 1,
        evaluation: {
          decision: 'adjust_plan',
          summary: 'A stale Worker attempted another round.',
          actionInstruction: 'This must not persist.',
        },
        createdAt: '2026-07-12T00:00:04.000Z',
      }),
    ).rejects.toThrow('WORKFLOW_CONTROL_TERMINAL_STATE_CONFLICT');
    await expect(controls.listRounds('control.db')).resolves.toHaveLength(1);
    const experiences = new PostgresEvolutionExperienceRepository(pool);
    const experience = {
      experienceId: 'evolution-experience-db-1',
      controlId: 'control.db',
      roundIndex: 0,
      taskId: task.taskId,
      contextId: 'context.control.db',
      goal: {
        goalId: 'goal.control.db',
        version: 1,
        title: 'Control Goal',
        description: 'Exercise the outer controller.',
        constraints: ['local-only'],
        successCriteria: ['completed'],
      },
      workflow: {
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
            type: 'result' as const,
            value: { op: 'literal' as const, value: true },
          },
        ],
        edges: [],
      },
      instanceId: 'instance.control.db',
      skillVersions: [],
      tools: [{ serverId: 'mcp.history', toolName: 'replay' }],
      input: {},
      result: true,
      errors: {},
      evaluation: {
        decision: 'replace_skill' as const,
        summary: 'One criterion remains.',
        actionInstruction: 'Select the ranked replacement Skill.',
      },
      successful: false,
      durationMs: 1000,
      createdAt: '2026-07-12T00:00:02.000Z',
    };
    await experiences.save(experience);
    await expect(experiences.find(experience.experienceId)).resolves.toEqual(experience);
    await expect(experiences.listByGoal('goal.control.db')).resolves.toEqual([experience]);
    await expect(
      experiences.listByTool({ serverId: 'mcp.history', toolName: 'replay' }),
    ).resolves.toEqual([experience]);
    await expect(experiences.findByInstance('instance.control.db')).resolves.toEqual(experience);
    const processedResults = new PostgresProcessedResultRepository(pool);
    await processedResults.save({
      resultId: 'processed.control.db',
      taskId: task.taskId,
      skillId: 'temporary.control.db',
      skillVersion: 1,
      normalized: {
        data: true,
        errors: [],
        originalSize: 4,
        contextValue: true,
        contextTruncated: false,
        summary: 'Completed.',
      },
      output: { text: 'Completed.', structured: true },
      facts: [],
      valuable: false,
      valueSummary: 'No durable fact.',
      memoryCandidates: [],
      createdAt: '2026-07-12T00:00:02.000Z',
    });
    const qualityReports = new PostgresTaskQualityReportRepository(pool);
    await qualityReports.save({
      reportId: 'quality.control.db',
      taskId: task.taskId,
      goalId: 'goal.control.db',
      goalVersion: 1,
      workflowInstanceId: 'instance.control.db',
      processedResultId: 'processed.control.db',
      assessments: [
        {
          component: 'workflow',
          score: 0.4,
          summary: 'Needs improvement.',
          findings: ['One criterion remains.'],
          evidenceRefs: ['experience:evolution-experience-db-1'],
        },
      ],
      overallScore: 0.4,
      status: 'failed',
      createdAt: '2026-07-12T00:00:03.000Z',
    });
    const influences = new PostgresEvaluationInfluenceRepository(pool);
    await influences.save({
      influenceId: 'influence.control.db',
      reportId: 'quality.control.db',
      taskId: task.taskId,
      experienceId: experience.experienceId,
      workflowDisposition: 'rejected_low_quality',
      promptDisposition: 'not_required',
      createdAt: '2026-07-12T00:00:04.000Z',
    });
    await expect(influences.findByReport('quality.control.db')).resolves.toMatchObject({
      experienceId: experience.experienceId,
      workflowDisposition: 'rejected_low_quality',
      promptDisposition: 'not_required',
    });
    const mcpRuntime = new PostgresMcpRegistryRepository(pool);
    await mcpRuntime.saveInvocation({
      invocationId: 'mcp-invocation.analytics.db',
      taskId: task.taskId,
      contextId: task.contextId,
      executionMode: 'historical-replay',
      simulationId: 'analytics-replay-1',
      serverId: 'mcp.history',
      toolName: 'replay',
      executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
      arguments: {},
      result: { replayed: true },
      status: 'succeeded',
      startedAt: '2026-07-12T00:00:02.000Z',
      completedAt: '2026-07-12T00:00:02.010Z',
      durationMs: 10,
    });
    const modelRuntime = new PostgresModelRuntimeRepository(pool);
    await modelRuntime.saveProvider({
      configuration: {
        providerId: 'provider.analytics.db',
        name: 'Analytics provider',
        kind: 'local',
        apiStyle: 'openai_chat_completions',
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'model.analytics.db',
        enabled: true,
        timeoutMs: 1000,
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      encryptedCredential: 'encrypted-test-only',
    });
    await modelRuntime.saveInvocation({
      invocationId: 'model-invocation.analytics.db',
      taskId: task.taskId,
      stage: 'evaluation',
      providerId: 'provider.analytics.db',
      model: 'model.analytics.db',
      operation: 'structured_generation',
      request: {},
      context: {},
      durationMs: 5,
      status: 'succeeded',
      createdAt: '2026-07-12T00:00:03.000Z',
    });
    const analytics = new PostgresEvaluationAnalyticsRepository(pool);
    await expect(
      analytics.query({
        providerId: 'provider.analytics.db',
        model: 'model.analytics.db',
        serverId: 'mcp.history',
        toolName: 'replay',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        experienceId: experience.experienceId,
        taskId: task.taskId,
        successful: false,
        durationMs: 1000,
        cost: 0,
        failureCodes: ['goal_evaluation:replace_skill'],
        mcpInvocations: [expect.objectContaining({ serverId: 'mcp.history', toolName: 'replay' })],
        modelInvocations: [
          expect.objectContaining({
            providerId: 'provider.analytics.db',
            model: 'model.analytics.db',
          }),
        ],
        qualityReport: expect.objectContaining({ reportId: 'quality.control.db' }),
      }),
    ]);
  });
  it('atomically persists related and unrelated Goal history decisions', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const goals = new PostgresGoalRepository(pool);
    await contexts.save({
      contextId: 'context.goal-history.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const previous = {
      goalId: 'goal.history.previous',
      contextId: 'context.goal-history.db',
      version: 1,
      title: 'Inspect',
      description: 'Inspect the device.',
      constraints: [],
      successCriteria: ['inspected'],
      status: 'achieved' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:01:00.000Z',
    };
    await goals.save(previous);
    const successor = {
      ...previous,
      goalId: 'goal.history.successor',
      title: 'Summarize',
      description: 'Summarize the inspection.',
      status: 'active' as const,
      previousGoalId: previous.goalId,
      createdAt: '2026-07-12T00:02:00.000Z',
      updatedAt: '2026-07-12T00:02:00.000Z',
    };
    await goals.save(successor, {
      transitionId: 'goal-transition.db',
      contextId: successor.contextId,
      fromGoalId: previous.goalId,
      toGoalId: successor.goalId,
      relationship: 'related_successor',
      decisionSummary: 'The summary is the next phase.',
      requestText: 'Summarize it.',
      createdAt: successor.createdAt,
    });

    await expect(goals.findLatestByContextId(successor.contextId)).resolves.toMatchObject({
      goalId: successor.goalId,
      previousGoalId: previous.goalId,
    });
    await expect(goals.listByContextId(successor.contextId)).resolves.toHaveLength(2);
    await expect(goals.listTransitions(successor.contextId)).resolves.toEqual([
      expect.objectContaining({
        fromGoalId: previous.goalId,
        toGoalId: successor.goalId,
        relationship: 'related_successor',
      }),
    ]);
    await goals.save({
      ...successor,
      status: 'achieved',
      updatedAt: '2026-07-12T00:03:00.000Z',
    });
    const unrelated = {
      ...successor,
      goalId: 'goal.history.unrelated',
      title: 'Book travel',
      description: 'Book an unrelated trip.',
      status: 'active' as const,
      createdAt: '2026-07-12T00:04:00.000Z',
      updatedAt: '2026-07-12T00:04:00.000Z',
    };
    const { previousGoalId: ignoredPreviousGoalId, ...unrelatedWithoutPrevious } = unrelated;
    void ignoredPreviousGoalId;
    await goals.save(unrelatedWithoutPrevious, {
      transitionId: 'goal-transition-unrelated.db',
      contextId: unrelated.contextId,
      fromGoalId: successor.goalId,
      toGoalId: unrelated.goalId,
      relationship: 'unrelated_new',
      decisionSummary: 'The travel request is unrelated.',
      requestText: 'Book travel.',
      createdAt: unrelated.createdAt,
    });
    await expect(goals.listTransitions(successor.contextId)).resolves.toEqual([
      expect.objectContaining({ relationship: 'related_successor' }),
      expect.objectContaining({ relationship: 'unrelated_new' }),
    ]);
  });
  it('atomically cancels a Goal and all nonterminal Task, plan, and instance state', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const goals = new PostgresGoalRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const plans = new PostgresWorkflowPlanRepository(pool);
    const executions = new PostgresWorkflowExecutionRepository(pool);
    await contexts.save({
      contextId: 'context.goal-cancel.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const goalToCancel = {
      goalId: 'goal.cancel.db',
      contextId: 'context.goal-cancel.db',
      version: 1,
      title: 'Cancel',
      description: 'Cancel all work.',
      constraints: [],
      successCriteria: [],
      status: 'active' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    await goals.save(goalToCancel);
    let task = createAgentTask({
      taskId: 'task.goal-cancel.db',
      contextId: goalToCancel.contextId,
      userId: 'operator',
      requestText: 'Run.',
      requestMetadata: {},
      timestamp: goalToCancel.createdAt,
    });
    task = transitionTask(task, 'context_loading', 'Loaded.', task.updatedAt);
    task = transitionTask(task, 'goal_deliberation', 'Goal.', task.updatedAt);
    task = bindTaskGoal(task, {
      goalId: goalToCancel.goalId,
      goalVersion: 1,
      timestamp: task.updatedAt,
    });
    task = transitionTask(task, 'skill_resolution', 'Skill.', task.updatedAt);
    task = transitionTask(task, 'planning', 'Plan.', task.updatedAt);
    task = transitionTask(task, 'awaiting_plan_confirmation', 'Confirm.', task.updatedAt);
    await tasks.save(task);
    await plans.savePlan({
      planId: 'plan.goal-cancel.db',
      goalId: goalToCancel.goalId,
      goalVersion: 1,
      goalContract: testGoalContract(goalToCancel.goalId),
      definition: {
        workflowDefinitionId: 'workflow.goal-cancel.db',
        version: 1,
        goalId: goalToCancel.goalId,
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
      createdAt: goalToCancel.createdAt,
    });
    await executions.saveInstance({
      instanceId: 'instance.goal-cancel.db',
      planId: 'plan.goal-cancel.db',
      workflowDefinitionId: 'workflow.goal-cancel.db',
      workflowVersion: 1,
      goalId: goalToCancel.goalId,
      goalVersion: 1,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 1,
        maxDurationSeconds: 60,
        maxLlmCalls: 2,
        maxMcpCalls: 2,
        maxCost: 2,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 1 },
      status: 'canceled',
      input: {},
      errors: { cancellation: { code: 'WORKFLOW_CANCELED', message: 'Canceled.' } },
      startedAt: goalToCancel.createdAt,
      completedAt: '2026-07-12T00:00:01.000Z',
    });
    const controls = new PostgresWorkflowControlRepository(pool);
    await controls.save({
      controlId: 'control.goal-cancel.db',
      contextId: goalToCancel.contextId,
      goalId: goalToCancel.goalId,
      goalVersion: goalToCancel.version,
      taskId: task.taskId,
      status: 'awaiting_confirmation',
      currentPlanId: 'plan.goal-cancel.db',
      input: {},
      skillIds: [],
      planningInstruction: 'Cancel this Goal.',
      roundCount: 0,
      replanCount: 0,
      finalInstanceId: 'instance.goal-cancel.db',
      createdAt: goalToCancel.createdAt,
      updatedAt: goalToCancel.updatedAt,
    });
    const cancellationNotifications: ReturnType<typeof createAgentTask>[] = [];
    const cancellations = new PostgresGoalCancellationRepository(pool, (canceledTask) => {
      cancellationNotifications.push(canceledTask);
    });
    await expect(
      cancellations.cancel({
        cancellationId: 'goal-cancellation.db',
        goalId: goalToCancel.goalId,
        goalVersion: 1,
        reason: 'Operator canceled.',
        warnings: ['No automatic compensation ran.'],
        createdAt: '2026-07-12T00:01:00.000Z',
      }),
    ).resolves.toMatchObject({
      canceledTaskIds: ['task.goal-cancel.db'],
      invalidatedPlanIds: ['plan.goal-cancel.db'],
      canceledInstanceIds: ['instance.goal-cancel.db'],
    });
    expect(cancellationNotifications).toEqual([
      expect.objectContaining({ taskId: task.taskId, phase: 'canceled' }),
    ]);
    await expect(goals.findById(goalToCancel.goalId)).resolves.toMatchObject({
      status: 'canceled',
    });
    await expect(tasks.findById(task.taskId)).resolves.toMatchObject({
      phase: 'canceled',
      errorCode: 'GOAL_CANCELED',
    });
    await expect(tasks.save(task)).rejects.toThrow('TASK_TERMINAL_MUTATION_FORBIDDEN');
    await expect(plans.findPlan('plan.goal-cancel.db')).resolves.toMatchObject({
      confirmationStatus: 'invalidated',
    });
    await expect(controls.find('control.goal-cancel.db')).resolves.toMatchObject({
      status: 'canceled',
      terminalOutcomeId: 'terminal-outcome-control-control.goal-cancel.db',
    });
    await expect(
      new PostgresRuntimeTerminalOutcomeRepository(pool).findByControl('control.goal-cancel.db'),
    ).resolves.toMatchObject({
      kind: 'canceled',
      taskId: task.taskId,
      goalId: goalToCancel.goalId,
      controlStatus: 'canceled',
    });
    await expect(cancellations.listByGoal(goalToCancel.goalId)).resolves.toHaveLength(1);
  });
  it('atomically versions a Goal and invalidates its old plans and instances', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const goals = new PostgresGoalRepository(pool);
    const plans = new PostgresWorkflowPlanRepository(pool);
    const executions = new PostgresWorkflowExecutionRepository(pool);
    const patchNotifications: ReturnType<typeof createAgentTask>[] = [];
    const patches = new PostgresGoalPatchRepository(pool, (patchedTask) => {
      patchNotifications.push(patchedTask);
    });
    const beforeGoal = {
      goalId: 'goal.patch.db',
      contextId: 'context.patch.db',
      version: 1,
      title: 'Inspect device',
      description: 'Inspect the device.',
      constraints: ['local-only'],
      successCriteria: ['inspection complete'],
      status: 'active' as const,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    await contexts.save({
      contextId: beforeGoal.contextId,
      userId: 'operator',
      createdAt: beforeGoal.createdAt,
      updatedAt: beforeGoal.updatedAt,
    });
    await goals.save(beforeGoal);
    const tasks = new PostgresAgentTaskRepository(pool);
    const queuedTriggeringTask = createAgentTask({
      taskId: 'task.patch.db',
      contextId: beforeGoal.contextId,
      userId: 'operator',
      requestText: 'Also record temperature.',
      requestMetadata: {},
      timestamp: beforeGoal.createdAt,
    });
    const loadingTriggeringTask = transitionTask(
      queuedTriggeringTask,
      'context_loading',
      'Loading context.',
      beforeGoal.createdAt,
    );
    const triggeringTask = bindTaskGoal(
      transitionTask(
        loadingTriggeringTask,
        'goal_deliberation',
        'Deliberating Goal.',
        beforeGoal.createdAt,
      ),
      { goalId: beforeGoal.goalId, goalVersion: 1, timestamp: beforeGoal.createdAt },
    );
    await tasks.save(triggeringTask);
    let terminalSibling = createAgentTask({
      taskId: 'task.patch.capability-gap.db',
      contextId: beforeGoal.contextId,
      userId: 'operator',
      requestText: 'Read pressure.',
      requestMetadata: {},
      timestamp: beforeGoal.createdAt,
    });
    terminalSibling = transitionTask(
      terminalSibling,
      'context_loading',
      'Loading context.',
      beforeGoal.createdAt,
    );
    terminalSibling = bindTaskGoal(
      transitionTask(
        terminalSibling,
        'goal_deliberation',
        'Continuing active Goal.',
        beforeGoal.createdAt,
      ),
      { goalId: beforeGoal.goalId, goalVersion: 1, timestamp: beforeGoal.createdAt },
    );
    terminalSibling = transitionTask(
      terminalSibling,
      'skill_resolution',
      'Resolving capability.',
      beforeGoal.createdAt,
    );
    terminalSibling = recordTaskCapabilityGap(
      terminalSibling,
      {
        evaluationSummary: 'Pressure Tool is unavailable.',
        missingCapability: 'Read pressure.',
        suggestedToolContract: {
          name: 'read_pressure',
          description: 'Read device pressure.',
          inputSchema: { type: 'object' },
        },
      },
      '2026-07-12T00:00:02.000Z',
    );
    await tasks.save(terminalSibling);
    await plans.savePlan({
      planId: 'plan.patch.db',
      goalId: beforeGoal.goalId,
      goalVersion: 1,
      goalContract: testGoalContract(beforeGoal.goalId),
      definition: {
        workflowDefinitionId: 'workflow.patch.db',
        version: 1,
        goalId: beforeGoal.goalId,
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
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 1,
      createdAt: beforeGoal.createdAt,
    });
    await plans.confirmPlan('plan.patch.db', {
      taskId: triggeringTask.taskId,
      confirmedAt: '2026-07-12T00:00:00.500Z',
    });
    await executions.saveInstance({
      instanceId: 'instance.patch.db',
      planId: 'plan.patch.db',
      workflowDefinitionId: 'workflow.patch.db',
      workflowVersion: 1,
      goalId: beforeGoal.goalId,
      goalVersion: 1,
      skillVersions: [],
      budgetLimits: {
        maxReplans: 1,
        maxDurationSeconds: 60,
        maxLlmCalls: 2,
        maxMcpCalls: 2,
        maxCost: 2,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'succeeded',
      input: {},
      result: true,
      errors: {},
      startedAt: beforeGoal.createdAt,
      completedAt: '2026-07-12T00:00:01.000Z',
    });
    const afterGoal = {
      ...beforeGoal,
      version: 2,
      successCriteria: ['inspection complete', 'temperature recorded'],
      updatedAt: '2026-07-12T00:01:00.000Z',
    };

    await expect(
      patches.apply(
        {
          patchId: 'patch.db',
          goalId: beforeGoal.goalId,
          fromVersion: 1,
          toVersion: 2,
          instruction: 'Also record temperature.',
          changes: { successCriteria: afterGoal.successCriteria },
          decisionSummary: 'Temperature is now required.',
          compensationWarnings: ['No automatic compensation was attempted.'],
          newPlanId: 'plan.patch.db.v2',
          beforeGoal,
          afterGoal,
          createdAt: afterGoal.updatedAt,
        },
        triggeringTask.taskId,
      ),
    ).resolves.toMatchObject({
      invalidatedPlanIds: ['plan.patch.db'],
      invalidatedInstanceIds: ['instance.patch.db'],
    });
    expect(patchNotifications).toEqual([
      expect.objectContaining({ taskId: triggeringTask.taskId, phase: 'planning' }),
    ]);
    await expect(goals.findById(beforeGoal.goalId)).resolves.toMatchObject({
      version: 2,
      successCriteria: afterGoal.successCriteria,
    });
    await expect(tasks.findById(terminalSibling.taskId)).resolves.toMatchObject({
      phase: 'capability_gap',
      goalVersion: 1,
      errorCode: 'CAPABILITY_GAP',
    });
    await expect(plans.findPlan('plan.patch.db')).resolves.toMatchObject({
      confirmationStatus: 'invalidated',
      confirmationTaskId: triggeringTask.taskId,
      confirmedAt: '2026-07-12T00:00:00.500Z',
    });
    await expect(executions.findInstance('instance.patch.db')).resolves.toMatchObject({
      status: 'invalidated',
      errors: { goalPatch: { code: 'GOAL_PATCH_INVALIDATED' } },
    });
    await expect(patches.listByGoal(beforeGoal.goalId)).resolves.toEqual([
      expect.objectContaining({
        patchId: 'patch.db',
        triggeringTaskId: triggeringTask.taskId,
        fromVersion: 1,
        toVersion: 2,
      }),
    ]);
  });
  it('invalidates active continuations and every old-Goal remote binding on patch and cancellation', async () => {
    const cancellation = await createGoalContinuationInvalidationFixture('cancel');
    await new PostgresGoalCancellationRepository(pool).cancel({
      cancellationId: 'continuation-invalidation-cancel',
      goalId: cancellation.goalId,
      goalVersion: 1,
      reason: 'Cancel remote continuation.',
      warnings: ['Provider state remains authoritative.'],
      createdAt: '2026-07-16T09:01:00.000Z',
    });
    await expectContinuationInvalidated(
      cancellation,
      '2026-07-16T09:01:00.000Z',
      'cancel_observing',
    );

    const patch = await createGoalContinuationInvalidationFixture('patch');
    const beforeGoal = await new PostgresGoalRepository(pool).findById(patch.goalId);
    if (beforeGoal === undefined) throw new Error('CONTINUATION_PATCH_GOAL_MISSING');
    const afterGoal = {
      ...beforeGoal,
      version: 2,
      successCriteria: [...beforeGoal.successCriteria, 'patched continuation verified'],
      updatedAt: '2026-07-16T09:02:00.000Z',
    };
    await new PostgresGoalPatchRepository(pool).apply({
      patchId: 'continuation-invalidation-patch',
      goalId: patch.goalId,
      fromVersion: 1,
      toVersion: 2,
      instruction: 'Patch while remote work is outstanding.',
      changes: { successCriteria: afterGoal.successCriteria },
      decisionSummary: 'The active Goal changed.',
      compensationWarnings: ['Remote Provider cancellation is not assumed.'],
      newPlanId: 'continuation-invalidation-plan-patch-v2',
      beforeGoal,
      afterGoal,
      createdAt: afterGoal.updatedAt,
    });
    await expectContinuationInvalidated(patch, '2026-07-16T09:02:00.000Z');
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
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const cipher = new Aes256GcmSecretCipher(randomBytes(32).toString('base64'));
    const modelCredential = { Authorization: 'Bearer model-db-secret' };
    const encryptedCredential = cipher.encrypt(modelCredential);
    const configuration = {
      providerId: 'provider.db',
      name: 'DB Provider',
      kind: 'openai_compatible' as const,
      apiStyle: 'openai_chat_completions' as const,
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'model-db',
      enabled: true,
      timeoutMs: 5000,
      createdAt: '2026-07-11T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
    };
    await contexts.save({
      contextId: 'context.model.db',
      userId: 'operator',
      createdAt: configuration.createdAt,
      updatedAt: configuration.updatedAt,
    });
    await tasks.save(
      createAgentTask({
        taskId: 'task-db',
        contextId: 'context.model.db',
        userId: 'operator',
        requestText: 'Invoke the configured model.',
        requestMetadata: {},
        timestamp: configuration.createdAt,
      }),
    );
    await repository.saveProvider({ configuration, encryptedCredential });
    await repository.saveStageRoute(
      'tool_enhancement',
      configuration.providerId,
      configuration.updatedAt,
    );
    await repository.saveInvocation({
      invocationId: 'model-invocation-db-1',
      taskId: 'task-db',
      stage: 'tool_enhancement',
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

    await expect(repository.findProviderForStage('tool_enhancement')).resolves.toEqual({
      configuration,
      encryptedCredential,
    });
    await expect(repository.listProviders()).resolves.toEqual([configuration]);
    await expect(repository.listStageRoutes()).resolves.toEqual([
      {
        stage: 'tool_enhancement',
        providerId: configuration.providerId,
        updatedAt: configuration.updatedAt,
      },
    ]);
    await expect(repository.listInvocations('tool_enhancement')).resolves.toEqual([
      expect.objectContaining({
        invocationId: 'model-invocation-db-1',
        inputTokens: 11,
        outputTokens: 4,
      }),
    ]);
    await expect(repository.listInvocationsByTask('task-db')).resolves.toEqual([
      expect.objectContaining({ invocationId: 'model-invocation-db-1', taskId: 'task-db' }),
    ]);
    const raw = await pool.query<{ encrypted_credential: string }>(
      'SELECT encrypted_credential FROM model_provider',
    );
    expect(raw.rows[0]?.encrypted_credential).not.toContain('model-db-secret');
    expect(cipher.decrypt(raw.rows[0]?.encrypted_credential ?? '')).toEqual(modelCredential);
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
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    await contexts.save({
      contextId: active.contextId,
      userId: 'anonymous',
      createdAt: active.createdAt,
      updatedAt: active.createdAt,
    });
    await tasks.save({
      ...createAgentTask({
        taskId: active.taskId,
        contextId: active.contextId,
        userId: 'anonymous',
        requestText: 'Use the Temporary Skill.',
        requestMetadata: {},
        timestamp: active.createdAt,
      }),
      phase: 'skill_resolution',
      temporarySkillId: active.temporarySkillId,
    });
    const boundTask = await tasks.findById(active.taskId);
    expect(boundTask).toMatchObject({ temporarySkillId: active.temporarySkillId });
    expect(boundTask?.selectedSkillId).toBeUndefined();
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
    const evolutionPolicy = new PostgresEvolutionPolicyRepository(pool);
    await evolutionPolicy.update({
      successThreshold: 3,
      updatedAt: '2026-07-11T10:01:30.000Z',
    });
    await expect(evolutionPolicy.get()).resolves.toEqual({
      successThreshold: 3,
      updatedAt: '2026-07-11T10:01:30.000Z',
    });
    await evolutionPolicy.saveTrigger({
      triggerId: 'trigger-db-1',
      capabilityFingerprint: active.capabilityFingerprint,
      experienceId: experience.experienceId,
      successfulExperienceCount: 1,
      configuredThreshold: 3,
      decision: 'below_threshold',
      createdAt: '2026-07-11T10:01:30.000Z',
    });
    await expect(evolutionPolicy.listTriggers(active.capabilityFingerprint)).resolves.toMatchObject(
      [{ triggerId: 'trigger-db-1', configuredThreshold: 3, decision: 'below_threshold' }],
    );
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
    const evolvedCandidate = {
      candidateId: 'candidate-db-1',
      capabilityFingerprint: active.capabilityFingerprint,
      successfulExperienceCount: 2,
      requiredSuccessThreshold: 2,
      sourceExperienceIds: ['experience-db-0', experience.experienceId],
      status: 'validation_failed' as const,
      inductionReport: {
        consistent: true,
        stable: true,
        generalizable: true,
        duplicateScore: 0,
        evolutionKind: 'new_skill' as const,
        targetSkillId: 'skill.evolved.db',
        boundaryDecisionSummary: 'The capability boundary is distinct.',
        decisionSummary: 'Repeated executions are stable.',
      },
      validationReport: {
        allPassed: false,
        cases: [
          {
            caseId: 'boundary-1',
            kind: 'boundary' as const,
            input: {},
            expectedOutcome: 'failure' as const,
            passed: false,
            summary: 'Unexpected success.',
          },
        ],
        decisionSummary: 'Draft remains unpublished.',
      },
      proposedSkill: {
        skillId: 'skill.evolved.db',
        name: 'Evolved Skill',
        summary: 'Evolved summary.',
        description: 'Evolved from repeated Temporary Skill success.',
        capabilities: ['device-status'],
        workflowGuidance: 'Call the Tool.',
        outputInstruction: 'Return status.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        tools: active.tools,
      },
      createdAt: expired.expiredAt,
      evaluatedAt: '2026-07-11T10:02:00.000Z',
    };
    await repository.saveFormalizationCandidate(evolvedCandidate);
    await expect(repository.findFormalizationCandidateById('candidate-db-1')).resolves.toEqual(
      evolvedCandidate,
    );
    const correctedSkill = {
      ...evolvedCandidate.proposedSkill,
      workflowGuidance: 'Validate the input before calling the Tool.',
    };
    await repository.saveCorrectionExperience({
      correctionId: 'correction-db-1',
      candidateId: evolvedCandidate.candidateId,
      capabilityFingerprint: evolvedCandidate.capabilityFingerprint,
      actor: 'operator@example.test',
      summary: 'Correct boundary handling.',
      beforeSkill: evolvedCandidate.proposedSkill,
      afterSkill: correctedSkill,
      diff: [
        {
          path: '/workflowGuidance',
          before: evolvedCandidate.proposedSkill.workflowGuidance,
          after: correctedSkill.workflowGuidance,
        },
      ],
      validationReport: evolvedCandidate.validationReport,
      outcome: 'validation_failed',
      createdAt: '2026-07-11T10:03:00.000Z',
    });
    await expect(repository.listCorrectionExperiences('candidate-db-1')).resolves.toMatchObject([
      {
        correctionId: 'correction-db-1',
        actor: 'operator@example.test',
        diff: [{ path: '/workflowGuidance' }],
        outcome: 'validation_failed',
      },
    ]);
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
        name: version.name,
        summary: version.summary,
        capabilities: version.capabilities,
        inputSchemaSummary: {
          type: 'object',
          requiredFields: [],
          propertyNames: [],
          allowsAdditionalProperties: 'unspecified' as const,
        },
        outputSchemaSummary: {
          type: 'object',
          requiredFields: [],
          propertyNames: [],
          allowsAdditionalProperties: 'unspecified' as const,
        },
        toolPolicy: version.toolPolicy,
        workflowGuidanceSummary: version.workflowGuidance,
        runtimePolicy: version.runtimePolicy,
        usageSummary: {
          source: 'native' as const,
          apiVersion: 'sdar.io/v1alpha1' as const,
          visibility: { userSelectable: true, composable: true, internalOnly: false },
          supportedModes: ['guidance' as const],
          defaultMode: 'guidance' as const,
          taskTypes: [],
          hasComposition: false,
          requiredContextCount: 0,
          requiredEvidenceCount: 0,
        },
        usageCandidate: {
          skillId: version.skillId,
          skillVersion: version.version,
          applicability: {
            skillId: version.skillId,
            skillVersion: version.version,
            status: 'satisfied' as const,
            reasonCodes: ['all_requirements_satisfied'],
            context: {
              requirements: [],
              satisfied: 0,
              total: 0,
              complete: true,
              inputRequiredIds: [],
              unsatisfiedIds: [],
              unknownIds: [],
            },
            readiness: { overall: 'ready' as const, bindings: [] },
          },
          modeDecision: {
            decision: 'selected' as const,
            mode: 'guidance' as const,
            confirmationRequired: false,
            confirmationSatisfied: true,
            reasonCodes: ['default_or_preferred_mode'],
          },
        },
        activeMcpDependencyWarnings: [],
        autoConfirmPlan: false,
        createdAt: version.createdAt,
        semanticScore: 0.8,
        metrics,
      },
    ];
    const selection = {
      selectionId: 'selection-db-1',
      goalContract: testGoalContract('goal.selection.db'),
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
      goalContract: selection.goalContract,
      failedSkillId: version.skillId,
      candidates,
      replacementSkillId: version.skillId,
      replacementSkillVersion: 1,
      decisionSummary: 'Await confirmation.',
      status: 'awaiting_confirmation',
      createdAt: version.createdAt,
    });
    await expect(repository.findSelection(selection.selectionId)).resolves.toMatchObject({
      goalContract: selection.goalContract,
      candidates: [
        expect.objectContaining({
          toolPolicy: version.toolPolicy,
          workflowGuidanceSummary: version.workflowGuidance,
          runtimePolicy: version.runtimePolicy,
        }),
      ],
    });

    await expect(repository.findMetrics(version.skillId)).resolves.toEqual(metrics);
    const quality = new PostgresSkillQualityRepository(pool);
    await quality.saveObservation({
      observationId: 'quality-observation-db-1',
      skillId: version.skillId,
      skillVersion: version.version,
      evaluationRef: 'evaluation-db-1',
      score: 0.2,
      successful: false,
      createdAt: '2026-07-11T10:01:00.000Z',
    });
    await quality.saveWarning({
      warningId: 'quality-warning-db-1',
      skillId: version.skillId,
      skillVersion: version.version,
      kind: 'consecutive_low_score',
      observationIds: ['quality-observation-db-1'],
      observedValue: 0.2,
      threshold: 0.4,
      summary: 'Low scores.',
      status: 'active',
      skillStatusAtCreation: 'enabled',
      createdAt: '2026-07-11T10:01:00.000Z',
    });
    await expect(
      quality.listRecentObservations(version.skillId, version.version, 3),
    ).resolves.toMatchObject([{ observationId: 'quality-observation-db-1', score: 0.2 }]);
    await expect(quality.listWarnings(version.skillId)).resolves.toMatchObject([
      { warningId: 'quality-warning-db-1', skillStatusAtCreation: 'enabled' },
    ]);
    await expect(repository.findSelection(selection.selectionId)).resolves.toEqual(selection);
    const persisted = await pool.query<{ status: string }>(
      'SELECT status FROM skill_replacement_plan WHERE replacement_plan_id = $1',
      ['replacement-db-1'],
    );
    expect(persisted.rows[0]?.status).toBe('awaiting_confirmation');
  });

  it('persists immutable top-level Skill input decisions and context result evidence', async () => {
    const timestamp = '2026-07-16T01:00:00.000Z';
    const contexts = new PostgresConversationContextRepository(pool);
    await contexts.save({
      contextId: 'context.skill-input.db',
      userId: 'operator',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const goals = new PostgresGoalRepository(pool);
    await goals.save({
      goalId: 'goal.skill-input.db',
      contextId: 'context.skill-input.db',
      version: 1,
      title: 'Inspect device',
      description: 'Inspect one device.',
      constraints: [],
      successCriteria: ['Return status'],
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const skills = new PostgresSkillRepository(pool);
    const skill = createSkillVersion({
      skillId: 'skill.input.db',
      version: 1,
      name: 'Input Skill',
      summary: 'Read a device.',
      description: 'Read a device by ID.',
      capabilities: ['device-status'],
      workflowGuidance: 'Read once.',
      outputInstruction: 'Return status.',
      inputSchema: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
      },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: timestamp,
    });
    await skills.saveVersionAndSetCurrent(skill, timestamp);
    const tasks = new PostgresAgentTaskRepository(pool);
    const currentTask = createAgentTask({
      taskId: 'task.skill-input.db',
      contextId: 'context.skill-input.db',
      userId: 'operator',
      requestText: 'Inspect the device.',
      requestMetadata: {},
      timestamp,
    });
    await tasks.save(currentTask);
    await tasks.save({
      ...createAgentTask({
        taskId: 'task.skill-input.prior.db',
        contextId: 'context.skill-input.db',
        userId: 'operator',
        requestText: 'Prior task.',
        requestMetadata: {},
        timestamp,
      }),
      phase: 'completed',
      phaseMessage: 'Completed.',
      output: { text: 'Online.', structured: { deviceId: 'device-prior' } },
    });
    await new PostgresProcessedResultRepository(pool).save({
      resultId: 'processed-result.skill-input.prior.db',
      taskId: 'task.skill-input.prior.db',
      skillId: skill.skillId,
      skillVersion: skill.version,
      normalized: {
        data: { deviceId: 'device-prior' },
        errors: [],
        originalSize: 27,
        contextValue: { deviceId: 'device-prior' },
        contextTruncated: false,
        summary: 'Prior device result.',
      },
      output: { text: 'Online.', structured: { deviceId: 'device-prior' } },
      facts: [],
      valuable: true,
      valueSummary: 'Useful prior result.',
      memoryCandidates: [],
      createdAt: '2026-07-16T01:00:01.000Z',
    });

    const repository = new PostgresSkillInputResolutionRepository(pool);
    await repository.save({
      resolutionId: 'skill-input-resolution.db.1',
      taskId: currentTask.taskId,
      goalId: 'goal.skill-input.db',
      goalVersion: 1,
      skillId: skill.skillId,
      skillVersion: skill.version,
      structuredInput: {},
      unresolvedFields: ['deviceId'],
      sourceRefs: ['task:task.skill-input.db:request-text'],
      decisionSummary: 'Device ID is missing.',
      status: 'input_required',
      createdAt: '2026-07-16T01:00:02.000Z',
    });
    const resolved = {
      resolutionId: 'skill-input-resolution.db.2',
      taskId: currentTask.taskId,
      goalId: 'goal.skill-input.db',
      goalVersion: 1,
      skillId: skill.skillId,
      skillVersion: skill.version,
      structuredInput: { deviceId: 'device-22' },
      unresolvedFields: [],
      sourceRefs: ['task-input-response:response.db.1'],
      decisionSummary: 'Supplementary input supplied device-22.',
      status: 'resolved' as const,
      createdAt: '2026-07-16T01:00:03.000Z',
    };
    await repository.save(resolved);

    await tasks.save({
      ...currentTask,
      goalId: 'goal.skill-input.db',
      goalVersion: 1,
      selectedSkillId: skill.skillId,
      selectedSkillVersion: skill.version,
      skillInputResolutionId: resolved.resolutionId,
    });

    await expect(
      repository.findLatest(currentTask.taskId, skill.skillId, skill.version, 1),
    ).resolves.toEqual(resolved);
    await expect(repository.listByTask(currentTask.taskId)).resolves.toHaveLength(2);
    await expect(tasks.findById(currentTask.taskId)).resolves.toMatchObject({
      skillInputResolutionId: resolved.resolutionId,
    });
    const foreignTask = createAgentTask({
      taskId: 'task.skill-input.foreign.db',
      contextId: currentTask.contextId,
      userId: 'operator',
      requestText: 'Another Task.',
      requestMetadata: {},
      timestamp,
    });
    await tasks.save(foreignTask);
    await expect(
      tasks.save({
        ...foreignTask,
        goalId: 'goal.skill-input.db',
        goalVersion: 1,
        selectedSkillId: skill.skillId,
        selectedSkillVersion: skill.version,
        skillInputResolutionId: resolved.resolutionId,
      }),
    ).rejects.toThrow();
    await expect(
      repository.listProcessedDataByContext(currentTask.contextId, currentTask.taskId, 5),
    ).resolves.toEqual([
      {
        sourceRef: 'processed-result:processed-result.skill-input.prior.db',
        value: { deviceId: 'device-prior' },
      },
    ]);
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
    await expect(graph.listRelationsFrom('skill.graph.a', ['composition'], 10)).resolves.toEqual([
      relation,
    ]);
    await expect(graph.listRelationsFrom('skill.graph.a', ['alternative'], 10)).resolves.toEqual(
      [],
    );
    await expect(graph.listRelationsFrom('skill.graph.b', ['composition'], 10)).resolves.toEqual(
      [],
    );
    await graph.deleteRelation(relation.relationId);
    await expect(graph.listRelations()).resolves.toEqual([]);
  });

  it('stores encrypted MCP credentials and atomically replaces discovered Tool definitions', async () => {
    const repository = new PostgresMcpRegistryRepository(pool);
    const cipher = new Aes256GcmSecretCipher(randomBytes(32).toString('base64'));
    const mcpCredential = { Authorization: 'Bearer mcp-db-secret' };
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
      encryptedCredential: cipher.encrypt(mcpCredential),
    };
    const declaredSemantics = {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'cooperative',
      idempotency: 'client_request_key',
      replay: 'allowed',
      source: 'mcp_declared',
    } as const;
    await repository.saveServerAndReplaceTools(record, [
      {
        serverId: 'mcp.devices',
        toolName: 'status',
        inputSchema: { type: 'object' },
        taskExecutionProfile: frozenTaskExecutionProfile(),
        executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
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
          taskExecutionProfile: frozenTaskExecutionProfile(),
          declaredExecutionSemantics: declaredSemantics,
          executionSemantics: declaredSemantics,
          discoveredAt: '2026-07-11T10:01:00.000Z',
        },
      ],
      [{ toolName: 'status', reason: 'removed' }],
    );
    await repository.saveInvocation({
      invocationId: 'invocation-1',
      taskId: 'task-1',
      contextId: 'context-1',
      executionMode: 'live',
      serverId: 'mcp.devices',
      toolName: 'inspect',
      executionSemantics: declaredSemantics,
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
    const adminOverride = {
      effect: 'side_effecting',
      execution: 'unknown',
      cancellation: 'unknown',
      idempotency: 'none',
      replay: 'forbidden',
      source: 'admin_override',
    } as const;
    const semanticsOperation = {
      operationId: 'mcp-operation-2',
      serverId: 'mcp.devices',
      operationType: 'tool_semantics_override',
      actor: 'anonymous-management',
      target: 'inspect',
      summary: { effectiveSource: 'mcp_declared', retainedForRefresh: true },
      occurredAt: '2026-07-11T10:04:00.000Z',
    } as const;
    await expect(
      repository.updateToolExecutionSemantics(
        'mcp.devices',
        'inspect',
        adminOverride,
        declaredSemantics,
        semanticsOperation,
      ),
    ).resolves.toBe(true);
    await repository.saveManagementOperation({
      operationId: 'mcp-operation-1',
      serverId: 'mcp.devices',
      operationType: 'credentials_update',
      actor: 'anonymous-management',
      summary: { headerNames: ['Authorization'] },
      occurredAt: '2026-07-11T10:03:00.000Z',
    });
    const replacementOverride = {
      ...adminOverride,
      replay: 'allowed',
    } as const;
    await expect(
      repository.updateToolExecutionSemantics(
        'mcp.devices',
        'inspect',
        replacementOverride,
        declaredSemantics,
        semanticsOperation,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(repository.listTools('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        adminExecutionSemanticsOverride: expect.objectContaining({ replay: 'forbidden' }),
      }),
    ]);
    await expect(
      repository.updateToolExecutionSemantics(
        'mcp.devices',
        'missing',
        adminOverride,
        declaredSemantics,
        { ...semanticsOperation, operationId: 'mcp-operation-phantom', target: 'missing' },
      ),
    ).resolves.toBe(false);

    await expect(repository.findServer('mcp.devices')).resolves.toMatchObject({
      server: { toolRevision: 2 },
      encryptedCredential: record.encryptedCredential,
    });
    await expect(repository.listTools('mcp.devices')).resolves.toEqual([
      expect.objectContaining({
        toolName: 'inspect',
        enhancement: expect.objectContaining({ purpose: 'Inspect device', tags: ['device'] }),
        declaredExecutionSemantics: declaredSemantics,
        adminExecutionSemanticsOverride: expect.objectContaining({
          source: 'admin_override',
          replay: 'forbidden',
        }),
        executionSemantics: declaredSemantics,
      }),
    ]);
    const raw = await pool.query<{ encrypted_credential: string }>(
      'SELECT encrypted_credential FROM mcp_server WHERE server_id = $1',
      ['mcp.devices'],
    );
    expect(raw.rows[0]?.encrypted_credential).not.toContain('Bearer');
    expect(cipher.decrypt(raw.rows[0]?.encrypted_credential ?? '')).toEqual(mcpCredential);
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
        executionSemantics: declaredSemantics,
      }),
    ]);
    await expect(repository.listInvocationsByTask('task-1')).resolves.toEqual([
      expect.objectContaining({ invocationId: 'invocation-1', taskId: 'task-1' }),
    ]);
    await expect(repository.listManagementOperations('mcp.devices')).resolves.toEqual([
      {
        operationId: 'mcp-operation-1',
        serverId: 'mcp.devices',
        operationType: 'credentials_update',
        actor: 'anonymous-management',
        summary: { headerNames: ['Authorization'] },
        occurredAt: '2026-07-11T10:03:00.000Z',
      },
      {
        operationId: 'mcp-operation-2',
        serverId: 'mcp.devices',
        operationType: 'tool_semantics_override',
        actor: 'anonymous-management',
        target: 'inspect',
        summary: { effectiveSource: 'mcp_declared', retainedForRefresh: true },
        occurredAt: '2026-07-11T10:04:00.000Z',
      },
    ]);
    await pool.query(
      `UPDATE mcp_invocation
       SET execution_semantics_json = $2
       WHERE invocation_id = $1`,
      [
        'invocation-1',
        JSON.stringify({
          effect: 'read_only',
          execution: 'unknown',
          cancellation: 'unknown',
          idempotency: 'unknown',
          replay: 'unknown',
          source: 'default_unknown',
        }),
      ],
    );
    await expect(repository.listInvocations('mcp.devices')).rejects.toMatchObject({
      code: 'MCP_TOOL_EXECUTION_SEMANTICS_INVALID',
    });
  });

  it('persists Frozen MCP discovery snapshots and Tool profiles without Legacy translation', async () => {
    const repository = new PostgresMcpRegistryRepository(pool);
    const profile = {
      profileVersion: '1.0' as const,
      taskBehavior: 'task_required' as const,
      availability: 'dynamic' as const,
      supportsScheduling: true,
      supportsMaxElapsed: true,
      supportsObservations: true,
      supportsInputRequired: true,
      idempotency: 'client_request_key' as const,
    };
    const snapshot = {
      snapshotId: 'snapshot.frozen.db.1',
      serverId: 'mcp.frozen.db',
      protocolMode: 'frozen_v1' as const,
      protocolVersion: '2026-07-28',
      baselineSha256: 'a'.repeat(64),
      supportedVersions: ['2026-07-28'],
      capabilities: { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } },
      serverInfo: { name: 'Frozen Provider', version: '1.0.0' },
      taskNotifications: true,
      discoveredAt: '2026-07-18T00:00:00.000Z',
      validUntil: '2026-07-18T01:00:00.000Z',
      toolRevision: 1,
    };
    await repository.saveFrozenServerAndReplaceTools(
      {
        server: {
          serverId: 'mcp.frozen.db',
          name: 'Frozen Provider',
          endpoint: 'https://frozen.example.test/mcp',
          transport: 'streamable_http',
          status: 'enabled',
          toolRevision: 1,
          protocolMode: 'frozen_v1',
          currentProtocolSnapshotId: snapshot.snapshotId,
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
        encryptedCredential: 'encrypted-frozen-credential',
      },
      [
        {
          serverId: 'mcp.frozen.db',
          toolName: 'embodied.move',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object', required: ['status'] },
          protocolMode: 'frozen_v1',
          taskExecutionProfile: profile,
          executionSemantics: DEFAULT_MCP_TOOL_EXECUTION_SEMANTICS,
          discoveredAt: '2026-07-18T00:00:00.000Z',
        },
      ],
      snapshot,
    );

    await expect(repository.findCurrentProtocolSnapshot('mcp.frozen.db')).resolves.toEqual(
      snapshot,
    );
    await expect(repository.findServer('mcp.frozen.db')).resolves.toMatchObject({
      server: {
        protocolMode: 'frozen_v1',
        currentProtocolSnapshotId: 'snapshot.frozen.db.1',
      },
    });
    await expect(repository.listTools('mcp.frozen.db')).resolves.toEqual([
      expect.objectContaining({
        toolName: 'embodied.move',
        protocolMode: 'frozen_v1',
        outputSchema: { type: 'object', required: ['status'] },
        taskExecutionProfile: profile,
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

  it('atomically persists native Skill Usage and checksum-bound package import audit', async () => {
    const repository = new PostgresSkillRepository(pool);
    const version = createSkillVersion({
      skillId: 'embodied.move-to.db',
      version: 1,
      name: 'Move To',
      summary: 'Move safely.',
      description: 'Moves one resource to a target.',
      capabilities: ['embodied.move'],
      workflowGuidance: 'Move safely.',
      outputInstruction: 'Return the final position.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-17T11:00:00.000Z',
      usageSpecification: createSkillUsageSpecification({
        apiVersion: 'sdar.io/v1alpha1',
        visibility: { userSelectable: true, composable: true, internalOnly: false },
        normative: {
          constraints: ['Stay safe.'],
          forbiddenActions: [],
          requiredConfirmations: [],
          noApplicableSkill: 'reject',
        },
        adaptive: {
          instructions: ['Prefer a safe route.'],
          optimizationHints: [],
          allowPreferredProviderFallback: false,
        },
        contextRequirements: [],
        modes: {
          supported: ['guidance'],
          defaultMode: 'guidance',
          guidance: { summary: 'Guide.', instructions: ['Guide safely.'] },
        },
        taskBindings: [],
        evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
      }),
    });
    await repository.saveVersionAndSetCurrent(version, version.createdAt, {
      skillId: version.skillId,
      skillVersion: version.version,
      packageChecksum: 'a'.repeat(64),
      packageRoot: '/reviewed/embodied.move_to',
      fileChecksums: { 'manifest.json': 'b'.repeat(64), 'SKILL.md': 'c'.repeat(64) },
      validatedAt: '2026-07-17T10:59:00.000Z',
      importedAt: version.createdAt,
    });

    const stored = await repository.findCurrentVersion(version.skillId);
    expect(stored).toEqual(version);
    expect(Object.isFrozen(stored?.usageSpecification)).toBe(true);
    const audit = await pool.query<{
      package_checksum: string;
      file_checksums_json: Record<string, string>;
    }>(
      'SELECT package_checksum,file_checksums_json FROM skill_package_import_audit WHERE skill_id=$1 AND skill_version=$2',
      [version.skillId, version.version],
    );
    expect(audit.rows[0]).toEqual({
      package_checksum: 'a'.repeat(64),
      file_checksums_json: { 'manifest.json': 'b'.repeat(64), 'SKILL.md': 'c'.repeat(64) },
    });
    await expect(
      repository.saveVersionAndSetCurrent(version, version.createdAt, {
        skillId: version.skillId,
        skillVersion: 2,
        packageChecksum: 'd'.repeat(64),
        packageRoot: '/wrong-version',
        fileChecksums: { 'manifest.json': 'e'.repeat(64) },
        validatedAt: version.createdAt,
        importedAt: version.createdAt,
      }),
    ).rejects.toThrow();
  });

  it('persists TaskService context/task/event and reads domain values back', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const taskNotifications: ReturnType<typeof createAgentTask>[] = [];
    const tasks = new PostgresAgentTaskRepository(pool, (savedTask) => {
      taskNotifications.push(savedTask);
    });
    const events = new PostgresRuntimeEventPublisher(pool);
    const service = new TaskService({
      contexts,
      tasks,
      events,
      skillDrafts: new PostgresSkillDraftRepository(pool),
      taskInputs: new PostgresTaskInputRepository(pool),
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
    expect(taskNotifications).toEqual([submitted.task]);
    expect(eventResult.rows[0]?.count).toBe('1');
    await expect(events.listByTask(submitted.task.taskId)).resolves.toEqual([
      expect.objectContaining({ taskId: submitted.task.taskId, eventType: 'task.created' }),
    ]);
    const goals = new PostgresGoalRepository(pool);
    const plans = new PostgresWorkflowPlanRepository(pool);
    await goals.save({
      goalId: 'goal.task-link.db',
      contextId: submitted.task.contextId,
      version: 1,
      title: 'Task link Goal',
      description: 'Provide authoritative Task query links.',
      constraints: [],
      successCriteria: ['Task links are queryable.'],
      status: 'active',
      createdAt: submitted.task.createdAt,
      updatedAt: submitted.task.updatedAt,
    });
    await plans.savePlan({
      planId: 'plan.task-link.db',
      goalId: 'goal.task-link.db',
      goalVersion: 1,
      goalContract: testGoalContract('goal.task-link.db'),
      definition: {
        workflowDefinitionId: 'workflow.task-link.db',
        version: 1,
        goalId: 'goal.task-link.db',
        goalVersion: 1,
        entryNodeId: 'result',
        exitNodeIds: ['result'],
        nodes: [
          {
            nodeId: 'result',
            name: 'Result',
            type: 'result',
            value: { op: 'literal', value: 'done' },
          },
        ],
        edges: [],
      },
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 1,
      createdAt: submitted.task.createdAt,
    });
    await tasks.save({
      ...submitted.task,
      phase: 'planning',
      phaseMessage: 'Planning.',
      planId: 'plan.task-link.db',
      goalId: 'goal.task-link.db',
      goalVersion: 1,
      selectedSkillId: 'skill.task-link.db',
      selectedSkillVersion: 1,
    });
    await expect(tasks.findByPlanId('plan.task-link.db')).resolves.toMatchObject({
      taskId: submitted.task.taskId,
      planId: 'plan.task-link.db',
    });
    await expect(
      tasks.list({
        contextId: submitted.task.contextId,
        phase: 'planning',
        planId: 'plan.task-link.db',
        goalId: 'goal.task-link.db',
        skillId: 'skill.task-link.db',
        limit: 10,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.task.taskId,
        phase: 'planning',
        goalId: 'goal.task-link.db',
        selectedSkillId: 'skill.task-link.db',
      }),
    ]);
  });

  it('answers a persisted waiting request after service restart and creates a new attempt', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const inputNotifications: ReturnType<typeof createAgentTask>[] = [];
    const taskInputs = new PostgresTaskInputRepository(pool, (continuedTask) => {
      inputNotifications.push(continuedTask);
    });
    const events = new PostgresRuntimeEventPublisher(pool);
    const ids = sequenceIds();
    const queued: unknown[] = [];
    const dependencies = {
      contexts,
      tasks,
      taskInputs,
      events,
      skillDrafts: new PostgresSkillDraftRepository(pool),
      queue: {
        enqueue: (input: unknown) => {
          queued.push(input);
          return Promise.resolve();
        },
      },
      clock: { now: () => '2026-07-15T10:00:00.000Z' },
      ids,
    };
    const firstService = new TaskService(dependencies);
    const submitted = await firstService.submit({ messageText: 'Inspect it.', metadata: {} });
    let task = submitted.task;
    task = transitionTask(task, 'context_loading', 'loaded', task.updatedAt);
    task = transitionTask(task, 'goal_deliberation', 'deliberating', task.updatedAt);
    await tasks.save(task);
    await firstService.requestInput(task.taskId, 'Which device?', {
      source: 'goal_deliberation',
    });
    const pending = await taskInputs.findPendingByTask(task.taskId);
    if (pending === undefined) throw new Error('PERSISTED_INPUT_REQUEST_MISSING');

    const restartedService = new TaskService(dependencies);
    await restartedService.followUp({
      taskId: task.taskId,
      action: 'provide_input',
      inputRequestId: pending.inputRequestId,
      messageText: 'device-17',
    });

    await expect(taskInputs.findRequest(pending.inputRequestId)).resolves.toMatchObject({
      status: 'answered',
      answeredAt: '2026-07-15T10:00:00.000Z',
    });
    await expect(taskInputs.listResponses(task.taskId)).resolves.toEqual([
      expect.objectContaining({ content: 'device-17', inputRequestId: pending.inputRequestId }),
    ]);
    expect(queued).toEqual([
      expect.objectContaining({ mode: 'initial', attemptId: 'attempt-1' }),
      expect.objectContaining({ mode: 'continue_after_input', attemptId: 'attempt-2' }),
    ]);
    await expect(taskInputs.findAttempt('attempt-2')).resolves.toMatchObject({
      reason: 'input_response',
      status: 'queued',
      inputRequestId: pending.inputRequestId,
    });
    await expect(taskInputs.listQueuedAttempts(10)).resolves.toEqual([
      expect.objectContaining({ attemptId: 'attempt-1', reason: 'initial' }),
      expect.objectContaining({ attemptId: 'attempt-2', reason: 'input_response' }),
    ]);
    await expect(tasks.findById(task.taskId)).resolves.toMatchObject({
      phase: 'goal_deliberation',
      phaseMessage: 'Supplementary input saved; continuation queued.',
    });
    expect(inputNotifications).toEqual([
      expect.objectContaining({ taskId: task.taskId, phase: 'goal_deliberation' }),
    ]);
  });
  it('persists normalized result, facts, value assessment, and memory candidates', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    await contexts.save({
      contextId: 'context.result.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    await tasks.save(
      createAgentTask({
        taskId: 'task.result.db',
        contextId: 'context.result.db',
        userId: 'operator',
        requestText: 'Inspect.',
        requestMetadata: {},
        timestamp: '2026-07-12T00:00:00.000Z',
      }),
    );
    const results = new PostgresProcessedResultRepository(pool);
    await results.save({
      resultId: 'processed-result.db',
      taskId: 'task.result.db',
      skillId: 'skill.result.db',
      skillVersion: 2,
      normalized: {
        data: { status: 'online' },
        errors: [],
        originalSize: 19,
        contextValue: { status: 'online' },
        contextTruncated: false,
        summary: 'Successful result with 19 JSON characters.',
      },
      output: { text: 'Online.', structured: { status: 'online' } },
      facts: [{ name: 'status', value: 'online', confidence: 1 }],
      valuable: true,
      valueSummary: 'Current state.',
      memoryCandidates: [{ kind: 'fact', content: 'Device was online.', confidence: 0.9 }],
      createdAt: '2026-07-12T00:00:01.000Z',
    });
    await expect(results.find('processed-result.db')).resolves.toMatchObject({
      output: { text: 'Online.', structured: { status: 'online' } },
      facts: [{ name: 'status', value: 'online', confidence: 1 }],
      memoryCandidates: [{ kind: 'fact', confidence: 0.9 }],
    });
    await expect(results.listByTask('task.result.db')).resolves.toHaveLength(1);
  });
  it('atomically cancels both confirmation and input waits using the managed timeout', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const tasks = new PostgresAgentTaskRepository(pool);
    const waitNotifications: ReturnType<typeof createAgentTask>[] = [];
    const waits = new PostgresTaskWaitPolicyRepository(pool, (expiredTask) => {
      waitNotifications.push(expiredTask);
    });
    await contexts.save({
      contextId: 'context.wait.db',
      userId: 'operator',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    const base = createAgentTask({
      taskId: 'task.wait.db',
      contextId: 'context.wait.db',
      userId: 'operator',
      requestText: 'Wait for confirmation.',
      requestMetadata: {},
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    const loading = transitionTask(base, 'context_loading', 'Loaded.', base.updatedAt);
    const deliberating = transitionTask(loading, 'goal_deliberation', 'Goal.', base.updatedAt);
    const resolving = transitionTask(deliberating, 'skill_resolution', 'Skill.', base.updatedAt);
    const planning = transitionTask(resolving, 'planning', 'Plan.', base.updatedAt);
    await tasks.save(
      transitionTask(
        planning,
        'awaiting_plan_confirmation',
        'Confirm.',
        '2026-07-12T00:01:00.000Z',
      ),
    );
    const inputBase = createAgentTask({
      taskId: 'task.wait.input.db',
      contextId: 'context.wait.db',
      userId: 'operator',
      requestText: 'Wait for input.',
      requestMetadata: {},
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    const inputLoading = transitionTask(
      inputBase,
      'context_loading',
      'Loaded.',
      inputBase.updatedAt,
    );
    const inputDeliberating = transitionTask(
      inputLoading,
      'goal_deliberation',
      'Goal.',
      inputBase.updatedAt,
    );
    await tasks.save(
      transitionTask(
        inputDeliberating,
        'awaiting_user_input',
        'Which device?',
        '2026-07-12T00:01:00.000Z',
      ),
    );
    const gapBase = createAgentTask({
      taskId: 'task.wait.gap.db',
      contextId: 'context.wait.db',
      userId: 'operator',
      requestText: 'Read pressure.',
      requestMetadata: {},
      timestamp: '2026-07-12T00:00:00.000Z',
    });
    let gapTask = transitionTask(gapBase, 'context_loading', 'Loaded.', '2026-07-12T00:00:00.000Z');
    gapTask = transitionTask(gapTask, 'goal_deliberation', 'Goal.', '2026-07-12T00:00:00.000Z');
    gapTask = transitionTask(gapTask, 'skill_resolution', 'Skill.', '2026-07-12T00:00:00.000Z');
    await tasks.save(
      recordTaskCapabilityGap(
        gapTask,
        {
          evaluationSummary: 'No Tool is registered.',
          missingCapability: 'Read pressure.',
          suggestedToolContract: {
            name: 'read_pressure',
            description: 'Read pressure.',
            inputSchema: { type: 'object' },
          },
        },
        '2026-07-12T00:00:30.000Z',
      ),
    );
    const taskInputs = new PostgresTaskInputRepository(pool);
    await taskInputs.createRequest(
      createTaskInputRequest({
        inputRequestId: 'input-request.wait.db',
        taskId: 'task.wait.input.db',
        contextId: 'context.wait.db',
        source: 'goal_deliberation',
        question: 'Which device?',
        createdAt: '2026-07-12T00:01:00.000Z',
      }),
    );
    await waits.update({ timeoutSeconds: 60, updatedAt: '2026-07-12T00:02:00.000Z' });

    await expect(
      waits.expireWaiting('2026-07-12T00:01:00.000Z', '2026-07-12T00:02:00.000Z'),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: 'task.wait.db',
          phase: 'canceled',
          errorCode: 'TASK_WAIT_TIMEOUT',
        }),
        expect.objectContaining({
          taskId: 'task.wait.input.db',
          phase: 'canceled',
          errorCode: 'TASK_WAIT_TIMEOUT',
        }),
      ]),
    );
    expect(waitNotifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: 'task.wait.db', phase: 'canceled' }),
        expect.objectContaining({ taskId: 'task.wait.input.db', phase: 'canceled' }),
      ]),
    );
    await expect(tasks.findById('task.wait.db')).resolves.toMatchObject({
      phase: 'canceled',
      errorCode: 'TASK_WAIT_TIMEOUT',
    });
    await expect(taskInputs.findRequest('input-request.wait.db')).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(tasks.findById('task.wait.gap.db')).resolves.toMatchObject({
      phase: 'capability_gap',
      errorCode: 'CAPABILITY_GAP',
    });
    const event = await pool.query<{ summary: string }>(
      "SELECT summary FROM runtime_event WHERE task_id='task.wait.db'",
    );
    expect(event.rows).toEqual([{ summary: 'Task canceled after the unified wait timeout.' }]);
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
      taskInputs: new PostgresTaskInputRepository(pool),
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
      taskInputs: new PostgresTaskInputRepository(pool),
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
      taskInputs: new PostgresTaskInputRepository(pool),
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
    await expect(
      drafts.markPublished(`draft-${submitted.task.taskId}`, {
        skillId: 'skill.a2a.published',
        version: 1,
        publishedBy: 'operator@example.test',
        publishedAt: '2026-07-11T10:01:00.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'published',
      publishedSkillId: 'skill.a2a.published',
      publishedSkillVersion: 1,
      publishedBy: 'operator@example.test',
    });
  });

  it('keeps the v1.2.2 clean baseline idempotent without replaying historical migrations', async () => {
    await expect(applyRuntimeMigrations(pool)).resolves.toBeUndefined();
    const marker = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migration WHERE version='v1.2.2_clean_slate_baseline'",
    );
    expect(marker.rows[0]?.count).toBe('1');
  });
  it('atomically commits and idempotently replays an achieved runtime outcome', async () => {
    const fixture = await createTerminalOutcomeFixture('achieved');

    const first = await fixture.outcomes.commitAchieved(fixture.achievedInput);
    const repeated = await fixture.outcomes.commitAchieved(fixture.achievedInput);

    expect(repeated).toEqual(first);
    expect(fixture.outcomeNotifications).toEqual([
      expect.objectContaining({ taskId: fixture.taskId, phase: 'completed' }),
    ]);
    await expect(fixture.tasks.findById(fixture.taskId)).resolves.toMatchObject({
      phase: 'completed',
      output: { text: 'Terminal result.', structured: { ok: true } },
    });
    await expect(fixture.goals.findById(fixture.goalId)).resolves.toMatchObject({
      status: 'achieved',
    });
    await expect(fixture.controls.find(fixture.controlId)).resolves.toMatchObject({
      status: 'achieved',
      roundCount: 1,
      terminalOutcomeId: fixture.achievedInput.outcomeId,
    });
    await expect(fixture.controls.listRounds(fixture.controlId)).resolves.toEqual([
      expect.objectContaining({
        roundIndex: 0,
        terminalOutcomeId: fixture.achievedInput.outcomeId,
      }),
    ]);
    const counts = await terminalOutcomeCounts(fixture);
    expect(counts).toEqual({ outcomes: 1, results: 1, events: 1, rounds: 1 });

    const warning = {
      source: 'result_memory' as const,
      code: 'MEMORY_WRITE_FAILED',
      message: 'Injected post-commit Memory failure.',
      occurredAt: '2026-07-16T00:00:05.000Z',
    };
    await fixture.outcomes.recordEnhancementWarning(first.outcomeId, warning);
    await fixture.outcomes.recordEnhancementWarning(first.outcomeId, warning);
    await expect(fixture.outcomes.find(first.outcomeId)).resolves.toMatchObject({
      enhancementWarnings: [warning],
    });
  });

  it('atomically commits unachievable and canceled terminal projections', async () => {
    const unachievable = await createTerminalOutcomeFixture('unachievable');
    await unachievable.outcomes.commitUnachievable({
      outcomeId: `terminal-outcome-${unachievable.taskId}`,
      taskId: unachievable.taskId,
      goalId: unachievable.goalId,
      goalVersion: 1,
      controlId: unachievable.controlId,
      controlStatus: 'unachievable',
      round: {
        ...unachievable.achievedInput.round,
        evaluation: { decision: 'unachievable', summary: 'No valid route remains.' },
      },
      summary: 'No valid route remains.',
      eventId: `event-terminal-${unachievable.taskId}`,
      committedAt: '2026-07-16T00:00:04.000Z',
    });
    await expect(unachievable.tasks.findById(unachievable.taskId)).resolves.toMatchObject({
      phase: 'failed',
      errorCode: 'GOAL_UNACHIEVABLE',
    });
    await expect(unachievable.goals.findById(unachievable.goalId)).resolves.toMatchObject({
      status: 'unachievable',
    });

    const canceled = await createTerminalOutcomeFixture('canceled');
    const waitingControl = await canceled.controls.find(canceled.controlId);
    if (waitingControl === undefined) throw new Error('TERMINAL_CONTROL_FIXTURE_MISSING');
    await canceled.controls.save({
      ...waitingControl,
      status: 'awaiting_confirmation',
      updatedAt: '2026-07-16T00:00:03.500Z',
    });
    await pool.query(
      `UPDATE agent_task SET phase='awaiting_plan_confirmation',
         phase_message='Waiting for confirmation.' WHERE task_id=$1`,
      [canceled.taskId],
    );
    const canceledInputs = new PostgresTaskInputRepository(pool);
    await canceledInputs.createRequest({
      inputRequestId: `input-request-${canceled.taskId}`,
      taskId: canceled.taskId,
      contextId: canceled.contextId,
      source: 'workflow',
      question: 'Confirm execution?',
      status: 'waiting',
      controlId: canceled.controlId,
      controlRoundIndex: 0,
      createdAt: '2026-07-16T00:00:03.500Z',
    });
    await canceled.outcomes.commitCanceled({
      outcomeId: `terminal-outcome-${canceled.taskId}`,
      taskId: canceled.taskId,
      goalId: canceled.goalId,
      goalVersion: 1,
      controlId: canceled.controlId,
      finalInstanceId: canceled.instanceId,
      summary: 'Operator canceled execution.',
      eventId: `event-terminal-${canceled.taskId}`,
      committedAt: '2026-07-16T00:00:04.000Z',
    });
    await expect(canceled.tasks.findById(canceled.taskId)).resolves.toMatchObject({
      phase: 'canceled',
      errorCode: 'RUNTIME_CANCELED',
    });
    await expect(canceled.controls.find(canceled.controlId)).resolves.toMatchObject({
      status: 'canceled',
      roundCount: 0,
      finalInstanceId: canceled.instanceId,
    });
    await expect(
      canceledInputs.findRequest(`input-request-${canceled.taskId}`),
    ).resolves.toMatchObject({ status: 'canceled' });
  });

  it.each([
    ['before_processed_result', 'processed_result', 'BEFORE', 'INSERT'],
    ['after_task', 'agent_task', 'AFTER', 'UPDATE'],
    ['after_goal', 'goal', 'AFTER', 'UPDATE'],
    ['after_control', 'workflow_control', 'AFTER', 'UPDATE'],
    ['runtime_event', 'runtime_event', 'BEFORE', 'INSERT'],
  ] as const)(
    'rolls back every authoritative write when fault %s is injected',
    async (suffix, table, timing, operation) => {
      const fixture = await createTerminalOutcomeFixture(`fault-${suffix}`);
      await installTerminalOutcomeFault(table, timing, operation);
      try {
        await expect(fixture.outcomes.commitAchieved(fixture.achievedInput)).rejects.toThrow(
          'INJECTED_RUNTIME_TERMINAL_FAULT',
        );
      } finally {
        await removeTerminalOutcomeFault(table);
      }

      const task = await fixture.tasks.findById(fixture.taskId);
      expect(task).toMatchObject({ phase: 'evaluating' });
      expect(task?.output).toBeUndefined();
      await expect(fixture.goals.findById(fixture.goalId)).resolves.toMatchObject({
        status: 'active',
      });
      const control = await fixture.controls.find(fixture.controlId);
      expect(control).toMatchObject({
        status: 'running',
        roundCount: 0,
      });
      expect(control?.terminalOutcomeId).toBeUndefined();
      expect(fixture.outcomeNotifications).toEqual([]);
      expect(await terminalOutcomeCounts(fixture)).toEqual({
        outcomes: 0,
        results: 0,
        events: 0,
        rounds: 0,
      });
    },
  );

  it('prevents stale workers and conflicting retries from reviving committed terminal state', async () => {
    const fixture = await createTerminalOutcomeFixture('stale');
    const staleTask = await fixture.tasks.findById(fixture.taskId);
    const staleGoal = await fixture.goals.findById(fixture.goalId);
    const staleControl = await fixture.controls.find(fixture.controlId);
    if (staleTask === undefined || staleGoal === undefined || staleControl === undefined)
      throw new Error('TERMINAL_FIXTURE_INCOMPLETE');
    await fixture.outcomes.commitAchieved(fixture.achievedInput);

    await expect(fixture.tasks.save(staleTask)).rejects.toThrow('TASK_TERMINAL_MUTATION_FORBIDDEN');
    await expect(fixture.goals.save(staleGoal)).rejects.toThrow('GOAL_TERMINAL_STATE_CONFLICT');
    await expect(
      fixture.controls.save({
        ...staleControl,
        status: 'failed',
        updatedAt: '2026-07-16T00:00:06.000Z',
      }),
    ).rejects.toThrow('WORKFLOW_CONTROL_TERMINAL_STATE_CONFLICT');
    await expect(
      fixture.outcomes.commitAchieved({
        ...fixture.achievedInput,
        outcomeId: `${fixture.achievedInput.outcomeId}-conflict`,
      }),
    ).rejects.toThrow('RUNTIME_TERMINAL_OUTCOME_CONFLICT');
    await expect(fixture.tasks.findById(fixture.taskId)).resolves.toMatchObject({
      phase: 'completed',
    });
    await expect(fixture.goals.findById(fixture.goalId)).resolves.toMatchObject({
      status: 'achieved',
    });
    await expect(fixture.controls.find(fixture.controlId)).resolves.toMatchObject({
      status: 'achieved',
    });
    const committedTask = await fixture.tasks.findById(fixture.taskId);
    const committedGoal = await fixture.goals.findById(fixture.goalId);
    const committedControl = await fixture.controls.find(fixture.controlId);
    if (
      committedTask === undefined ||
      committedGoal === undefined ||
      committedControl === undefined
    )
      throw new Error('COMMITTED_TERMINAL_FIXTURE_MISSING');
    await expect(
      fixture.tasks.save({
        ...committedTask,
        output: { text: 'Forged stale output.', structured: false },
      }),
    ).rejects.toThrow('TASK_TERMINAL_MUTATION_FORBIDDEN');
    await expect(
      fixture.goals.save({ ...committedGoal, title: 'Forged stale Goal.' }),
    ).rejects.toThrow('GOAL_TERMINAL_STATE_CONFLICT');
    await expect(fixture.controls.save({ ...committedControl, roundCount: 99 })).rejects.toThrow(
      'WORKFLOW_CONTROL_TERMINAL_STATE_CONFLICT',
    );
  });

  it('rejects a terminal Round that does not belong to the locked Control plan', async () => {
    const wrongControl = await createTerminalOutcomeFixture('wrong-round-control');
    await expect(
      wrongControl.outcomes.commitAchieved({
        ...wrongControl.achievedInput,
        round: { ...wrongControl.achievedInput.round, controlId: 'control.other' },
      }),
    ).rejects.toThrow('RUNTIME_TERMINAL_EXPECTED_STATE_CONFLICT');
    expect(await terminalOutcomeCounts(wrongControl)).toEqual({
      outcomes: 0,
      results: 0,
      events: 0,
      rounds: 0,
    });

    const wrongPlan = await createTerminalOutcomeFixture('wrong-round-plan');
    await expect(
      wrongPlan.outcomes.commitAchieved({
        ...wrongPlan.achievedInput,
        round: { ...wrongPlan.achievedInput.round, planId: 'plan.other' },
      }),
    ).rejects.toThrow('RUNTIME_TERMINAL_EXPECTED_STATE_CONFLICT');
    expect(await terminalOutcomeCounts(wrongPlan)).toEqual({
      outcomes: 0,
      results: 0,
      events: 0,
      rounds: 0,
    });

    const wrongDecision = await createTerminalOutcomeFixture('wrong-round-decision');
    await expect(
      wrongDecision.outcomes.commitAchieved({
        ...wrongDecision.achievedInput,
        round: {
          ...wrongDecision.achievedInput.round,
          evaluation: { decision: 'unachievable', summary: 'Contradictory decision.' },
        },
      }),
    ).rejects.toThrow('RUNTIME_TERMINAL_DECISION_MISMATCH');
    expect(await terminalOutcomeCounts(wrongDecision)).toEqual({
      outcomes: 0,
      results: 0,
      events: 0,
      rounds: 0,
    });

    const wrongInstance = await createTerminalOutcomeFixture('wrong-final-instance');
    const foreignInstance = await createTerminalOutcomeFixture('foreign-final-instance');
    await expect(
      wrongInstance.outcomes.commitCanceled({
        outcomeId: `terminal-outcome-${wrongInstance.taskId}`,
        taskId: wrongInstance.taskId,
        goalId: wrongInstance.goalId,
        goalVersion: 1,
        controlId: wrongInstance.controlId,
        finalInstanceId: foreignInstance.instanceId,
        summary: 'Canceled with unrelated instance evidence.',
        eventId: `event-terminal-${wrongInstance.taskId}`,
        committedAt: '2026-07-16T00:00:04.000Z',
      }),
    ).rejects.toThrow('RUNTIME_TERMINAL_EXPECTED_STATE_CONFLICT');
    expect(await terminalOutcomeCounts(wrongInstance)).toEqual({
      outcomes: 0,
      results: 0,
      events: 0,
      rounds: 0,
    });
  });

  it('persists append-only Skill execution status and thin evidence links', async () => {
    const timestamp = '2026-07-17T12:00:00.000Z';
    await new PostgresConversationContextRepository(pool).save({
      contextId: 'context.skill-execution.db',
      userId: 'operator',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await new PostgresAgentTaskRepository(pool).save(
      createAgentTask({
        taskId: 'task.skill-execution.db',
        contextId: 'context.skill-execution.db',
        userId: 'operator',
        requestText: 'Execute the selected Skill.',
        requestMetadata: {},
        timestamp,
      }),
    );
    const skillVersion = createSkillVersion({
      skillId: 'skill.root.db',
      version: 2,
      name: 'Execution evidence Skill',
      summary: 'Persists execution evidence.',
      description: 'A Skill used to verify execution evidence persistence.',
      capabilities: ['evidence'],
      workflowGuidance: 'Record bounded evidence.',
      outputInstruction: 'Return the evidence reference.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: timestamp,
    });
    await new PostgresSkillRepository(pool).saveVersionAndSetCurrent(skillVersion, timestamp);
    const policy = testUsagePlanPolicy();
    await new PostgresWorkflowPlanRepository(pool).savePlan({
      planId: 'plan.skill-execution.db',
      goalId: 'goal.skill-execution.db',
      goalVersion: 1,
      goalContract: testGoalContract('goal.skill-execution.db'),
      definition: {
        workflowDefinitionId: 'workflow.skill-execution.db',
        version: 1,
        goalId: 'goal.skill-execution.db',
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
        skillUsagePolicy: policy,
      },
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 1,
      createdAt: timestamp,
    });
    const executionId = 'skill-execution.db';
    const repository = new PostgresSkillExecutionRepository(pool);
    await repository.create(
      createSkillExecutionRecord({
        executionId,
        taskId: 'task.skill-execution.db',
        goalId: 'goal.skill-execution.db',
        goalVersion: 1,
        skillId: 'skill.root.db',
        skillVersion: 2,
        selectionRef: 'selection.skill-execution.db',
        applicabilityStatus: 'satisfied',
        usagePolicy: policy,
        workflowPlanId: 'plan.skill-execution.db',
        workflowDefinitionId: 'workflow.skill-execution.db',
        workflowDefinitionVersion: 1,
        createdAt: timestamp,
      }),
      [
        createSkillExecutionEvent({
          eventId: 'event.skill-execution.selected',
          executionId,
          eventType: 'skill.selected',
          statusAfter: 'selected',
          summary: 'Selected.',
          details: {},
          occurredAt: timestamp,
        }),
        createSkillExecutionEvent({
          eventId: 'event.skill-execution.planning',
          executionId,
          eventType: 'skill.plan_generated',
          statusAfter: 'planning',
          summary: 'Planned.',
          details: {},
          occurredAt: timestamp,
        }),
      ],
      [
        createSkillExecutionReference({
          linkId: 'link.skill-execution.evidence',
          executionId,
          kind: 'evidence',
          referenceId: 'evidence.skill-execution.db',
          referenceType: 'inspection.result',
          sourceSystem: 'test-provider',
          uri: 'urn:sdar:evidence:skill-execution-db',
          checksum: 'a'.repeat(64),
          producedAt: timestamp,
          producerRefs: ['provider.test'],
          metadata: { bounded: true },
          createdAt: timestamp,
        }),
      ],
    );
    for (const [eventId, eventType, status] of [
      ['started', 'skill.execution_started', 'executing'],
      ['waiting', 'skill.execution_waiting_external', 'waiting_external'],
      ['resumed', 'skill.execution_started', 'executing'],
      ['degraded', 'skill.execution_degraded', 'degraded'],
    ] as const)
      await repository.appendEvent(
        createSkillExecutionEvent({
          eventId: `event.skill-execution.${eventId}`,
          executionId,
          eventType,
          statusAfter: status,
          summary: eventId,
          details: {},
          occurredAt: timestamp,
        }),
      );

    await expect(repository.findByPlan('plan.skill-execution.db')).resolves.toMatchObject({
      executionId,
      status: 'degraded',
      events: expect.arrayContaining([
        expect.objectContaining({ eventType: 'skill.execution_waiting_external' }),
      ]),
      references: [expect.objectContaining({ referenceId: 'evidence.skill-execution.db' })],
    });
    await expect(
      repository.appendEvent(
        createSkillExecutionEvent({
          eventId: 'event.skill-execution.after-terminal',
          executionId,
          eventType: 'skill.execution_started',
          statusAfter: 'executing',
          summary: 'Must fail.',
          details: {},
          occurredAt: timestamp,
        }),
      ),
    ).rejects.toMatchObject({ code: 'SKILL_EXECUTION_RECORD_INVALID' });
  });
});

async function createTerminalOutcomeFixture(suffix: string) {
  const contextId = `context.terminal.${suffix}`;
  const taskId = `task.terminal.${suffix}`;
  const goalId = `goal.terminal.${suffix}`;
  const planId = `plan.terminal.${suffix}`;
  const instanceId = `instance.terminal.${suffix}`;
  const controlId = `control.terminal.${suffix}`;
  const contexts = new PostgresConversationContextRepository(pool);
  const tasks = new PostgresAgentTaskRepository(pool);
  const goals = new PostgresGoalRepository(pool);
  const plans = new PostgresWorkflowPlanRepository(pool);
  const executions = new PostgresWorkflowExecutionRepository(pool);
  const controls = new PostgresWorkflowControlRepository(pool);
  const outcomeNotifications: ReturnType<typeof createAgentTask>[] = [];
  const outcomes = new PostgresRuntimeTerminalOutcomeRepository(pool, (terminalTask) => {
    outcomeNotifications.push(terminalTask);
  });
  await contexts.save({
    contextId,
    userId: 'operator',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  });
  await tasks.save(
    createAgentTask({
      taskId,
      contextId,
      userId: 'operator',
      requestText: 'Commit one authoritative terminal outcome.',
      requestMetadata: {},
      timestamp: '2026-07-16T00:00:00.000Z',
    }),
  );
  await goals.save({
    goalId,
    contextId,
    version: 1,
    title: 'Terminal outcome',
    description: 'Commit all authoritative terminal projections together.',
    constraints: [],
    successCriteria: ['All projections agree'],
    status: 'active',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  });
  await plans.savePlan({
    planId,
    goalId,
    goalVersion: 1,
    goalContract: testGoalContract(goalId),
    definition: {
      workflowDefinitionId: `workflow.terminal.${suffix}`,
      version: 1,
      goalId,
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
    createdAt: '2026-07-16T00:00:01.000Z',
  });
  await executions.saveInstance({
    instanceId,
    planId,
    workflowDefinitionId: `workflow.terminal.${suffix}`,
    workflowVersion: 1,
    goalId,
    goalVersion: 1,
    skillVersions: [{ skillId: 'skill.terminal', version: 1 }],
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 2,
      maxMcpCalls: 2,
      maxCost: 1,
    },
    budgetUsage: { replanCount: 0, durationMs: 10, llmCalls: 1, mcpCalls: 0, cost: 0.01 },
    status: 'succeeded',
    input: {},
    result: { ok: true },
    errors: {},
    startedAt: '2026-07-16T00:00:01.000Z',
    completedAt: '2026-07-16T00:00:02.000Z',
  });
  await pool.query(
    `UPDATE agent_task SET phase='evaluating',phase_message='Evaluating.',goal_id=$2,
       goal_version=1,plan_id=$3,updated_at='2026-07-16T00:00:03.000Z'
     WHERE task_id=$1`,
    [taskId, goalId, planId],
  );
  await controls.save({
    controlId,
    contextId,
    goalId,
    goalVersion: 1,
    taskId,
    status: 'running',
    currentPlanId: planId,
    input: {},
    skillIds: ['skill.terminal'],
    planningInstruction: 'Complete atomically.',
    roundCount: 0,
    replanCount: 0,
    createdAt: '2026-07-16T00:00:01.000Z',
    updatedAt: '2026-07-16T00:00:03.000Z',
  });
  const round = {
    controlId,
    roundIndex: 0,
    planId,
    instanceId,
    workflowVersion: 1,
    evaluation: { decision: 'achieved' as const, summary: 'All criteria are satisfied.' },
    createdAt: '2026-07-16T00:00:03.000Z',
  };
  const processedResult = {
    resultId: `processed-result-terminal-${taskId}`,
    taskId,
    skillId: 'skill.terminal',
    skillVersion: 1,
    normalized: {
      data: { ok: true },
      errors: [],
      originalSize: 11,
      contextValue: { ok: true },
      contextTruncated: false,
      summary: 'Successful result with 11 JSON characters.',
    },
    output: { text: 'Terminal result.', structured: { ok: true } },
    facts: [],
    valuable: true,
    valueSummary: 'Authoritative Task output.',
    memoryCandidates: [],
    createdAt: '2026-07-16T00:00:03.000Z',
  };
  return {
    contextId,
    taskId,
    goalId,
    planId,
    instanceId,
    controlId,
    tasks,
    goals,
    controls,
    outcomes,
    outcomeNotifications,
    achievedInput: {
      outcomeId: `terminal-outcome-${taskId}`,
      taskId,
      goalId,
      goalVersion: 1,
      controlId,
      round,
      processedResult,
      summary: 'All criteria are satisfied.',
      eventId: `event-terminal-${taskId}`,
      committedAt: '2026-07-16T00:00:04.000Z',
    },
  };
}

async function terminalOutcomeCounts(
  fixture: Awaited<ReturnType<typeof createTerminalOutcomeFixture>>,
) {
  const result = await pool.query<{
    outcomes: number;
    results: number;
    events: number;
    rounds: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM runtime_terminal_outcome WHERE control_id=$1) AS outcomes,
       (SELECT count(*)::integer FROM processed_result WHERE task_id=$2) AS results,
       (SELECT count(*)::integer FROM runtime_event WHERE task_id=$2) AS events,
       (SELECT count(*)::integer FROM workflow_control_round WHERE control_id=$1) AS rounds`,
    [fixture.controlId, fixture.taskId],
  );
  const counts = result.rows[0];
  if (counts === undefined) throw new Error('TERMINAL_OUTCOME_COUNT_FAILED');
  return counts;
}

interface GoalContinuationInvalidationFixture {
  readonly prefix: string;
  readonly goalId: string;
  readonly snapshotId: string;
  readonly bindingIds: readonly [string, string];
}

async function createGoalContinuationInvalidationFixture(
  prefix: 'cancel' | 'patch',
): Promise<GoalContinuationInvalidationFixture> {
  const timestamp = '2026-07-16T09:00:00.000Z';
  const contextId = `continuation-invalidation-context-${prefix}`;
  const goalId = `continuation-invalidation-goal-${prefix}`;
  const taskId = `continuation-invalidation-task-${prefix}`;
  const planId = `continuation-invalidation-plan-${prefix}`;
  const instanceId = `continuation-invalidation-instance-${prefix}`;
  const controlId = `continuation-invalidation-control-${prefix}`;
  const serverId = `continuation-invalidation-server-${prefix}`;
  const snapshotId = `continuation-invalidation-snapshot-${prefix}`;
  const bindingIds = [
    `continuation-invalidation-binding-${prefix}-mapped`,
    `continuation-invalidation-binding-${prefix}-orphan`,
  ] as const;
  await new PostgresConversationContextRepository(pool).save({
    contextId,
    userId: 'operator',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await new PostgresGoalRepository(pool).save({
    goalId,
    contextId,
    version: 1,
    title: `Continuation invalidation ${prefix}`,
    description: 'Verify durable external waits are invalidated atomically.',
    constraints: ['test-only'],
    successCriteria: ['old Goal continuation invalidated'],
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  let task = createAgentTask({
    taskId,
    contextId,
    userId: 'operator',
    requestText: 'Run remote work.',
    requestMetadata: {},
    timestamp,
  });
  task = transitionTask(task, 'context_loading', 'Context loaded.', timestamp);
  task = transitionTask(task, 'goal_deliberation', 'Goal active.', timestamp);
  task = bindTaskGoal(task, { goalId, goalVersion: 1, timestamp });
  task = transitionTask(task, 'skill_resolution', 'Skill selected.', timestamp);
  task = transitionTask(task, 'planning', 'Plan prepared.', timestamp);
  task = transitionTask(task, 'awaiting_plan_confirmation', 'Plan confirmed.', timestamp);
  await new PostgresAgentTaskRepository(pool).save(task);
  const plans = new PostgresWorkflowPlanRepository(pool);
  await plans.savePlan({
    planId,
    goalId,
    goalVersion: 1,
    goalContract: testGoalContract(goalId),
    definition: {
      workflowDefinitionId: `continuation-invalidation-workflow-${prefix}`,
      version: 1,
      goalId,
      goalVersion: 1,
      entryNodeId: 'remote-node',
      exitNodeIds: ['remote-node'],
      nodes: [
        {
          nodeId: 'remote-node',
          name: 'Remote node',
          type: 'result',
          value: { op: 'literal', value: true },
        },
      ],
      edges: [],
    },
    confirmationStatus: 'confirmed',
    attemptCount: 1,
    createdAt: timestamp,
  });
  await new PostgresWorkflowExecutionRepository(pool).saveInstance({
    instanceId,
    planId,
    workflowDefinitionId: `continuation-invalidation-workflow-${prefix}`,
    workflowVersion: 1,
    goalId,
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 2,
      maxMcpCalls: 2,
      maxCost: 2,
    },
    budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 0 },
    status: 'running',
    input: {},
    errors: {},
    startedAt: timestamp,
  });
  await new PostgresWorkflowControlRepository(pool).save({
    controlId,
    contextId,
    goalId,
    goalVersion: 1,
    taskId,
    status: 'running',
    currentPlanId: planId,
    input: {},
    skillIds: [],
    planningInstruction: 'Run remote continuation fixture.',
    roundCount: 0,
    replanCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await pool.query(
    `INSERT INTO mcp_server(
       server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
       created_at,updated_at)
     VALUES($1,$2,'http://127.0.0.1:1','streamable_http','enabled',1,
            'encrypted-test-value',$3,$3)`,
    [serverId, `Continuation invalidation ${prefix}`, timestamp],
  );
  const remoteTasks = new PostgresRemoteTaskRepository(pool);
  for (const [index, bindingId] of bindingIds.entries()) {
    const sequence = index + 1;
    const invocationId = `continuation-invalidation-invocation-${prefix}-${String(sequence)}`;
    await pool.query(
      `INSERT INTO mcp_invocation(
         invocation_id,task_id,context_id,server_id,tool_name,arguments_json,result_json,
         status,started_at,completed_at,duration_ms,execution_mode,simulation_id)
       VALUES($1,$2,$3,$4,'remote_operation','{}'::jsonb,'{"kind":"remote_task"}'::jsonb,
              'succeeded',$5,$5,0,'live',NULL)`,
      [invocationId, taskId, contextId, serverId, timestamp],
    );
    await remoteTasks.admit(
      createRemoteTaskBinding({
        bindingId,
        serverId,
        operationName: 'remote_operation',
        remoteTaskId: `provider-${prefix}-${String(sequence)}`,
        agentTaskId: taskId,
        contextId,
        goalId,
        goalVersion: 1,
        workflowPlanId: planId,
        workflowDefinitionId: `continuation-invalidation-workflow-${prefix}`,
        workflowDefinitionVersion: 1,
        workflowInstanceId: instanceId,
        workflowNodeId: `remote-node-${String(sequence)}`,
        workflowNodeRunId: `remote-node-${String(sequence)}:1`,
        mcpInvocationId: invocationId,
        protocolStatus: 'working',
        protocolRevision: '2026-07-28',
        tasksSchemaRevision: 'tasks-schema-revision-1',
        protocolContract: {
          mode: 'frozen_v1',
          protocolVersion: '2026-07-28',
          baselineSha256: 'a'.repeat(64),
        },
        taskBehavior: 'server_directed',
        runtimeRevision: '1',
        executionContext: { mode: 'live' },
        credentialRevision: 'credential-revision-1',
        sessionRevision: 'session-revision-1',
        lastProviderUpdatedAt: timestamp,
        pollIntervalMs: 100,
        createdAt: timestamp,
      }),
      `continuation-invalidation-observation-${prefix}-${String(sequence)}`,
    );
  }
  await new PostgresWorkflowContinuationRepository(pool).saveSnapshot(
    createWorkflowContinuationSnapshot({
      schemaVersion: '1.0',
      snapshotId,
      continuationId: `continuation-invalidation-${prefix}`,
      stateVersion: 1,
      lifecycle: 'active',
      agentTaskId: taskId,
      contextId,
      workflowControlId: controlId,
      goalId,
      goalVersion: 1,
      workflowPlanId: planId,
      workflowDefinitionId: `continuation-invalidation-workflow-${prefix}`,
      workflowDefinitionVersion: 1,
      workflowDefinitionHash: 'd'.repeat(64),
      inputHash: 'e'.repeat(64),
      workflowInstanceId: instanceId,
      input: {},
      waitingNodeRuns: [
        {
          waitId: `continuation-invalidation-wait-${prefix}`,
          kind: 'remote_task',
          sourceId: bindingIds[0],
          nodeId: 'remote-node-1',
          nodeRunId: 'remote-node-1:1',
          state: 'waiting',
        },
      ],
      runnableFrontier: [],
      completedNodeRunIds: [],
      nodeRunCounts: { 'remote-node-1': 1 },
      outputs: {},
      errors: {},
      routes: {},
      loopCounts: {},
      recoveryCounts: {},
      parallelJoinState: [],
      failed: false,
      executionContext: { mode: 'live' },
      budgetLimits: {
        maxReplans: 1,
        maxDurationSeconds: 60,
        maxLlmCalls: 2,
        maxMcpCalls: 2,
        maxCost: 2,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 0 },
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  return { prefix, goalId, snapshotId, bindingIds };
}

async function expectContinuationInvalidated(
  fixture: GoalContinuationInvalidationFixture,
  invalidatedAt: string,
  bindingState: 'closed' | 'cancel_observing' = 'closed',
): Promise<void> {
  const snapshot = await pool.query<{ lifecycle: string; updated_at: Date | string }>(
    'SELECT lifecycle,updated_at FROM workflow_continuation_snapshot WHERE snapshot_id=$1',
    [fixture.snapshotId],
  );
  expect(snapshot.rows).toEqual([expect.objectContaining({ lifecycle: 'invalidated' })]);
  expect(new Date(snapshot.rows[0]?.updated_at ?? 0).toISOString()).toBe(invalidatedAt);
  const bindings = await pool.query<{
    binding_id: string;
    local_state: string;
    invalidated_at: Date | string | null;
    next_poll_at: Date | string | null;
  }>(
    `SELECT binding_id,local_state,invalidated_at,next_poll_at
     FROM remote_task_binding WHERE binding_id=ANY($1::text[]) ORDER BY binding_id`,
    [[...fixture.bindingIds]],
  );
  expect(bindings.rows).toHaveLength(2);
  for (const binding of bindings.rows) {
    expect(binding.local_state).toBe(bindingState);
    if (bindingState === 'closed') {
      expect(binding.next_poll_at).toBeNull();
      expect(new Date(binding.invalidated_at ?? 0).toISOString()).toBe(invalidatedAt);
    } else {
      expect(new Date(binding.next_poll_at ?? 0).toISOString()).toBe(invalidatedAt);
      expect(binding.invalidated_at).toBeNull();
    }
  }
}

async function installTerminalOutcomeFault(
  table: 'processed_result' | 'agent_task' | 'goal' | 'workflow_control' | 'runtime_event',
  timing: 'BEFORE' | 'AFTER',
  operation: 'INSERT' | 'UPDATE',
): Promise<void> {
  await pool.query(
    `CREATE OR REPLACE FUNCTION sdar_test_terminal_outcome_fault()
     RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'INJECTED_RUNTIME_TERMINAL_FAULT';
     END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER sdar_test_terminal_outcome_fault
     ${timing} ${operation} ON ${table}
     FOR EACH ROW EXECUTE FUNCTION sdar_test_terminal_outcome_fault()`,
  );
}

async function removeTerminalOutcomeFault(
  table: 'processed_result' | 'agent_task' | 'goal' | 'workflow_control' | 'runtime_event',
): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS sdar_test_terminal_outcome_fault ON ${table}`);
  await pool.query('DROP FUNCTION IF EXISTS sdar_test_terminal_outcome_fault()');
}

function frozenTaskExecutionProfile() {
  return {
    profileVersion: '1.0' as const,
    taskBehavior: 'synchronous_only' as const,
    availability: 'not_supported' as const,
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsObservations: false,
    supportsInputRequired: false,
    idempotency: 'client_request_key' as const,
  };
}

function sequenceIds(): Readonly<{
  nextId(
    kind: 'context' | 'task' | 'event' | 'input-request' | 'input-response' | 'attempt',
  ): string;
}> {
  const counters = {
    context: 0,
    task: 0,
    event: 0,
    'input-request': 0,
    'input-response': 0,
    attempt: 0,
  };
  return {
    nextId: (kind) => `${kind}-${String(++counters[kind])}`,
  };
}
