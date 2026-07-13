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
  PostgresMemoryRepository,
  PostgresMemoryRetentionPolicyRepository,
  PostgresPromptRepository,
  PostgresProcessedResultRepository,
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
} from '../src/index.js';
import {
  bindTaskGoal,
  createAgentTask,
  createSkillVersion,
  recordTaskCapabilityGap,
  transitionTask,
} from '../../domain/src/index.js';

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
  const planRevisionMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0020_plan_revision.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(planRevisionMigration);
  const workflowInterruptMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0021_workflow_interrupt.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(workflowInterruptMigration);
  const modelApiStyleMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0022_model_api_style.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(modelApiStyleMigration);
  const goalPatchMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0023_goal_patch.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(goalPatchMigration);
  const taskWaitMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0024_task_wait_timeout.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskWaitMigration);
  const executionControlMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0025_workflow_execution_control.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(executionControlMigration);
  const goalContinuityMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0026_goal_continuity.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(goalContinuityMigration);
  const goalCancellationMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0027_goal_cancellation.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(goalCancellationMigration);
  const resultProcessingMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0028_result_processing.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(resultProcessingMigration);
  const goalEvaluationMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0029_goal_evaluation_decisions.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(goalEvaluationMigration);
  const taskCapabilityGapMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0030_task_capability_gap.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskCapabilityGapMigration);
  const globalMemoryMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0031_global_memory.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(globalMemoryMigration);
  const goalInputInferenceMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0032_goal_input_inference.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(goalInputInferenceMigration);
  const taskSelectedSkillMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0033_task_selected_skill.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskSelectedSkillMigration);
  const skillCallWorkflowMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0034_skill_call_workflow.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(skillCallWorkflowMigration);
  const taskSkillSelectionMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0035_task_skill_selection.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskSkillSelectionMigration);
  const taskTemporarySkillMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0036_task_temporary_skill.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskTemporarySkillMigration);
  const skillEvolutionMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0037_skill_evolution_simulation.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(skillEvolutionMigration);
  const evolutionExperienceMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0038_evolution_experience.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(evolutionExperienceMigration);
  const evolutionPolicyMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0039_evolution_policy.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(evolutionPolicyMigration);
  const evolutionCorrectionMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0040_skill_evolution_correction.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(evolutionCorrectionMigration);
  const skillDraftPublicationMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0041_skill_draft_publication.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(skillDraftPublicationMigration);
  const skillQualityWarningMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0042_skill_quality_warning.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(skillQualityWarningMigration);
  const workflowTemplateMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0043_workflow_template.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(workflowTemplateMigration);
  const memoryStatusMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0044_memory_status_transition.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(memoryStatusMigration);
  const memoryRetentionMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0045_memory_retention_policy.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(memoryRetentionMigration);
  const taskQualityMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0046_task_quality_report.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(taskQualityMigration);
  const implicitFeedbackMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0047_implicit_feedback.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(implicitFeedbackMigration);
  const evaluationInfluenceMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0048_evaluation_influence.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(evaluationInfluenceMigration);
  const evaluationAnalyticsMigration = await readFile(
    new URL('../../../infra/postgres/migrations/0049_evaluation_analytics.up.sql', import.meta.url),
    'utf8',
  );
  await pool.query(evaluationAnalyticsMigration);
  const mcpManagementOperationMigration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0050_mcp_management_operation.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pool.query(mcpManagementOperationMigration);
});

beforeEach(async () => {
  await pool.query(
    `UPDATE memory_retention_policy SET review_after_days=90,archive_after_days=365,
       delete_after_days=730,automatic_archive_enabled=false,automatic_delete_enabled=false,
       updated_at=CURRENT_TIMESTAMP WHERE singleton=true`,
  );
  await pool.query(
    'TRUNCATE mcp_management_operation, task_quality_report, memory_status_transition, workflow_template_use, workflow_template, workflow_template_occurrence, skill_quality_warning, skill_quality_observation, evolution_trigger, evolution_experience, goal_input_inference, memory_item, skill_call_workflow, workflow_control_round, workflow_control, workflow_node_event, workflow_instance, workflow_plan_attempt, workflow_plan, model_invocation, stage_model_route, model_provider, prompt_version, prompt, skill_embedding, skill_formalization_candidate, temporary_skill_experience, temporary_skill, skill_replacement_plan, skill_selection_record, skill_performance_metrics, skill_relation, mcp_invocation, mcp_dependency_warning, mcp_tool, mcp_server, skill_version, skill, external_task_projection, runtime_event, agent_task, goal, conversation_context CASCADE',
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
        createdAt: '2026-07-12T00:00:00.000Z',
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
    const replacement = {
      memoryId: 'memory.global.db.v2',
      type: 'fact' as const,
      content: { deviceId: 'device-18' },
      summary: 'The target device is device-18.',
      status: 'active' as const,
      sourceRefs: ['task.user-b'],
      supersedes: ['memory.global.db'],
      confidence: 0.95,
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
      capabilityGap: {
        missingCapability: 'Read device pressure.',
        suggestedToolContract: { name: 'read_pressure' },
      },
    });
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
      expect.objectContaining({ sequence: 2, nodeId: 'result', eventType: 'node_succeeded' }),
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
    ] as const)
      await plans.savePlan({
        planId,
        goalId: 'goal.skill-call.db',
        goalVersion: 1,
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
    const repository = new PostgresSkillCallWorkflowRepository(pool);
    await repository.save({
      parentInstanceId: 'instance.parent.db',
      parentNodeId: 'child',
      childInstanceId: 'instance.child.db',
      childPlanId: 'plan.child.db',
      skillId: skill.skillId,
      skillVersion: skill.version,
      status: 'succeeded',
      evaluationSummary: 'Output Schema passed.',
      createdAt: '2026-07-12T00:00:01.000Z',
      completedAt: '2026-07-12T00:00:02.000Z',
    });
    await expect(repository.listByParent('instance.parent.db')).resolves.toEqual([
      expect.objectContaining({
        childInstanceId: 'instance.child.db',
        skillId: 'skill.child.db',
        skillVersion: 1,
        evaluationSummary: 'Output Schema passed.',
      }),
    ]);
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
    const plans = new PostgresWorkflowPlanRepository(pool);
    await plans.savePlan({
      planId: 'plan.interrupted.db',
      goalId: 'goal.interrupted.db',
      goalVersion: 1,
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

    await expect(
      new PostgresRuntimeRecoveryRepository(pool).failInterrupted('2026-07-12T00:01:00.000Z'),
    ).resolves.toEqual({ tasks: 1, workflowInstances: 1 });
    await expect(tasks.findById(task.taskId)).resolves.toMatchObject({
      phase: 'failed',
      errorCode: 'PROCESS_EXECUTION_LOST',
    });
    await expect(executions.findInstance('instance.interrupted.db')).resolves.toMatchObject({
      status: 'failed',
      errors: { runtime: { code: 'PROCESS_EXECUTION_LOST' } },
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
    const cancellations = new PostgresGoalCancellationRepository(pool);
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
    await expect(cancellations.listByGoal(goalToCancel.goalId)).resolves.toHaveLength(1);
  });
  it('atomically versions a Goal and invalidates its old plans and instances', async () => {
    const contexts = new PostgresConversationContextRepository(pool);
    const goals = new PostgresGoalRepository(pool);
    const plans = new PostgresWorkflowPlanRepository(pool);
    const executions = new PostgresWorkflowExecutionRepository(pool);
    const patches = new PostgresGoalPatchRepository(pool);
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
    await plans.savePlan({
      planId: 'plan.patch.db',
      goalId: beforeGoal.goalId,
      goalVersion: 1,
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
      confirmationStatus: 'confirmed',
      attemptCount: 1,
      createdAt: beforeGoal.createdAt,
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
      patches.apply({
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
      }),
    ).resolves.toMatchObject({
      invalidatedPlanIds: ['plan.patch.db'],
      invalidatedInstanceIds: ['instance.patch.db'],
    });
    await expect(goals.findById(beforeGoal.goalId)).resolves.toMatchObject({
      version: 2,
      successCriteria: afterGoal.successCriteria,
    });
    await expect(plans.findPlan('plan.patch.db')).resolves.toMatchObject({
      confirmationStatus: 'invalidated',
    });
    await expect(executions.findInstance('instance.patch.db')).resolves.toMatchObject({
      status: 'invalidated',
      errors: { goalPatch: { code: 'GOAL_PATCH_INVALIDATED' } },
    });
    await expect(patches.listByGoal(beforeGoal.goalId)).resolves.toEqual([
      expect.objectContaining({ patchId: 'patch.db', fromVersion: 1, toVersion: 2 }),
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
      apiStyle: 'openai_chat_completions' as const,
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
      taskId: 'task-db',
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
    await expect(repository.listProviders()).resolves.toEqual([configuration]);
    await expect(repository.listStageRoutes()).resolves.toEqual([
      {
        stage: 'workflow_planning',
        providerId: configuration.providerId,
        updatedAt: configuration.updatedAt,
      },
    ]);
    await expect(repository.listInvocations('workflow_planning')).resolves.toEqual([
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
        autoConfirmPlan: false,
        createdAt: version.createdAt,
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
    await repository.saveManagementOperation({
      operationId: 'mcp-operation-1',
      serverId: 'mcp.devices',
      operationType: 'credentials_update',
      actor: 'anonymous-management',
      summary: { headerNames: ['Authorization'] },
      occurredAt: '2026-07-11T10:03:00.000Z',
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
    await expect(events.listByTask(submitted.task.taskId)).resolves.toEqual([
      expect.objectContaining({ taskId: submitted.task.taskId, eventType: 'task.created' }),
    ]);
    await tasks.save({
      ...submitted.task,
      phase: 'planning',
      phaseMessage: 'Planning.',
      planId: 'plan.task-link.db',
    });
    await expect(tasks.findByPlanId('plan.task-link.db')).resolves.toMatchObject({
      taskId: submitted.task.taskId,
      planId: 'plan.task-link.db',
    });
    await expect(
      tasks.list({ contextId: submitted.task.contextId, phase: 'planning', limit: 10 }),
    ).resolves.toEqual([
      expect.objectContaining({ taskId: submitted.task.taskId, phase: 'planning' }),
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
    const waits = new PostgresTaskWaitPolicyRepository(pool);
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
    await waits.update({ timeoutSeconds: 60, updatedAt: '2026-07-12T00:02:00.000Z' });

    await expect(
      waits.expireWaiting('2026-07-12T00:01:00.000Z', '2026-07-12T00:02:00.000Z'),
    ).resolves.toEqual([
      expect.objectContaining({
        taskId: 'task.wait.db',
        phase: 'canceled',
        errorCode: 'TASK_WAIT_TIMEOUT',
      }),
    ]);
    await expect(tasks.findById('task.wait.db')).resolves.toMatchObject({
      phase: 'canceled',
      errorCode: 'TASK_WAIT_TIMEOUT',
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
