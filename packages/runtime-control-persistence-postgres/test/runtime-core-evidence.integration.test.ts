import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  buildRuntimeSourceArtifact,
  canonicalizeEvidenceJson,
  canonicalizeSourceArtifactJson,
  createArtifactCounterexample,
  createArtifactLineage,
  createArtifactReplayCase,
  createArtifactValidationResult,
  createArtifactValidationRun,
  createCatalogEvidenceEnvelope,
  createCohortDefinition,
  createCompiledArtifact,
  createDiscoveredProcessPattern,
  createExperienceTrace,
  createFusedPattern,
  createGeneralizedPattern,
  createProcessVariant,
  createReplayDatasetManifest,
  createWorkflowPattern,
  hashCanonicalEvidenceJson,
  hashSourceArtifactJson,
  type ArtifactRef,
  type CanonicalEvidenceEnvelope,
  type EvidenceExportConfiguration,
  type EvidenceJsonValue,
  type EvidenceQualityIssue,
  type PlanTemplateArtifactDefinition,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  ExperienceReplayArtifactEvidenceProjector,
  McpCapabilityEvidenceProjector,
  RuntimeCoreEvidenceProjector,
  SkillEvidenceProjector,
} from '../../runtime-control-application/src/index.js';
import {
  PostgresEvidenceStore,
  PostgresExperienceReplayArtifactEvidenceSource,
  PostgresMcpCapabilityEvidenceSource,
  PostgresRuntimeSourceArtifactResolver,
  PostgresRuntimeCoreEvidenceSource,
  PostgresSkillEvidenceSource,
  type StoredEvidenceRecord,
} from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_v122_integration_gate';
const pool = new Pool({ connectionString, max: 4 });
const source = new PostgresRuntimeCoreEvidenceSource(pool);
const store = new PostgresEvidenceStore(pool);
const projector = new RuntimeCoreEvidenceProjector({
  source,
  writer: store,
  environment: 'integration',
  clock: { now: () => '2026-08-04T04:10:00.000Z' },
});
const skillSource = new PostgresSkillEvidenceSource(pool);
const skillProjector = new SkillEvidenceProjector({
  source: skillSource,
  writer: store,
  environment: 'integration',
  clock: { now: () => '2026-08-04T04:20:00.000Z' },
});
const mcpCapabilitySource = new PostgresMcpCapabilityEvidenceSource(pool);
const mcpCapabilityProjector = new McpCapabilityEvidenceProjector({
  source: {
    pendingTaskIds: (limit) => mcpCapabilitySource.pendingTaskIds(limit),
    load: async (taskId) => {
      const loaded = await mcpCapabilitySource.load(taskId);
      if (loaded === undefined) return undefined;
      return {
        ...loaded,
        definitions: [controlCapabilityDefinition()],
        implementationBindings: [controlCapabilityImplementation()],
      };
    },
  },
  writer: store,
  environment: 'integration',
  clock: { now: () => '2026-08-04T04:30:00.000Z' },
});
const experienceReplayArtifactSource = new PostgresExperienceReplayArtifactEvidenceSource(pool);
const experienceReplayArtifactProjector = new ExperienceReplayArtifactEvidenceProjector({
  source: experienceReplayArtifactSource,
  writer: store,
  environment: 'integration',
  clock: { now: () => '2026-08-04T04:40:00.000Z' },
});

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
  await seedRuntimeCoreEpisode();
  await seedMcpCapabilityFacts();
  await seedExperienceReplayArtifactFacts();
  await store.applyConfiguration(phase12EvidenceConfiguration(), '2026-08-04T03:59:00.000Z');
});

afterAll(async () => {
  await pool.end();
});

function phase12EvidenceConfiguration(): EvidenceExportConfiguration {
  return {
    exportId: 'phase12-runtime-core-evidence',
    revision: 1,
    endpointRef: 'https://evidence.example.test/v1/batches',
    sourceId: 'phase12-runtime-core',
    nodeId: 'node-phase12-runtime-core',
    credentialRef: 'env:PHASE12_EVIDENCE_TOKEN',
    includedFamilies: [
      'runtime',
      'skill',
      'mcp_task',
      'capability',
      'experience',
      'replay',
      'artifact',
      'node_control',
      'evidence',
    ],
    batchPolicy: { maxRecords: 1_000, maxBytes: 262_144, flushIntervalMs: 1_000 },
    retryPolicy: { baseDelayMs: 100, maxDelayMs: 10_000, maxAttempts: 5 },
    outboxPolicy: { maxPendingRecords: 100_000, retentionDays: 30 },
    redactionProfile: 'strict_internal_v1',
    artifactMode: 'reference',
  };
}

describe('Runtime core canonical Evidence vertical', { concurrent: false }, () => {
  it('projects real authoritative facts through a draft manifest with stable IDs, hashes, references and sequences', async () => {
    await expect(source.pendingTaskIds(10)).resolves.toEqual(['task-v141-runtime-core']);
    const first = await projector.projectTask('task-v141-runtime-core');
    const stored = await evidenceRecords();

    expect(stored).toHaveLength(19);
    expect(new Set(stored.map((record) => record.envelope.recordType)).size).toBe(18);
    expect(stored.map((record) => record.sequence)).toEqual(
      Array.from({ length: 19 }, (_, index) => String(index + 1)),
    );
    const recordIds = new Set(stored.map((record) => record.envelope.recordId));
    const skillExecutionRecordId = stored
      .find(({ envelope }) => envelope.recordType === 'runtime.action')
      ?.envelope.evidenceRefs.find((reference) => !recordIds.has(reference));
    expect(skillExecutionRecordId).toMatch(/^evidence_[0-9a-f]{64}$/u);
    const schemaValidator = new AjvJsonSchemaValidator({ strict: false });
    for (const { envelope } of stored) {
      expect(envelope.recordId).toMatch(/^evidence_[0-9a-f]{64}$/u);
      expect(envelope.payloadHash).toBe(hashCanonicalEvidenceJson(envelope.payload));
      const schema = JSON.parse(
        readFileSync(
          path.resolve('schemas/evidence/v1/records', `${envelope.recordType}.schema.json`),
          'utf8',
        ),
      ) as object;
      expect(schemaValidator.validate(schema, envelope), envelope.recordType).toEqual({
        valid: true,
        errors: [],
      });
      if (envelope.recordType !== 'runtime.episode') {
        expect(envelope.evidenceRefs.length).toBeGreaterThan(0);
      }
      for (const reference of envelope.evidenceRefs.filter((value) =>
        value.startsWith('evidence_'),
      )) {
        expect(recordIds.has(reference) || reference === skillExecutionRecordId).toBe(true);
      }
    }

    const oldPlan = stored.find(
      ({ envelope }) =>
        envelope.recordType === 'runtime.plan' && envelope.sourceRecordId === 'plan-v141-old',
    )?.envelope;
    const newPlan = stored.find(
      ({ envelope }) =>
        envelope.recordType === 'runtime.plan' &&
        envelope.sourceRecordId === 'plan-v141-runtime-core',
    )?.envelope;
    const patch = record(stored, 'runtime.goal_patch');
    expect(oldPlan).toBeDefined();
    expect(newPlan?.payload).toMatchObject({ sourcePlanId: 'plan-v141-old' });
    expect(patch.payload).toMatchObject({ invalidatedPlanIds: ['plan-v141-old'] });

    expect(record(stored, 'runtime.action').payload).toMatchObject({
      executionBasis: { executionMode: 'live', executionSemantics: { effect: 'read' } },
    });
    expect(record(stored, 'runtime.receipt').payload).toMatchObject({
      receiptLayers: { transport: 'recorded', executor: 'succeeded', business: 'not_asserted' },
    });
    expect(record(stored, 'runtime.run_seal').payload).toMatchObject({
      outcomeKind: 'achieved',
      taskStatus: 'completed',
      goalStatus: 'achieved',
      controlStatus: 'achieved',
      workflowStatus: 'succeeded',
      authority: 'user_goal_plan_controller',
    });

    await expect(
      pool.query(`SELECT 1 FROM episode_evidence_manifest WHERE episode_id=$1`, [
        'task-v141-runtime-core',
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      pool.query(`SELECT 1 FROM evidence_quality_issue WHERE episode_id=$1`, [
        'task-v141-runtime-core',
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });

    const second = await projector.projectTask('task-v141-runtime-core');
    expect(second.projectedRecordIds).toEqual(first.projectedRecordIds);
    await expect(evidenceRecords()).resolves.toHaveLength(19);
    await expect(source.pendingTaskIds(10)).resolves.toEqual([]);

    await expect(source.pendingTaskIds(10)).resolves.toEqual([]);
  });

  it('projects a terminal Task lifecycle even when no runtime terminal outcome was committed', async () => {
    const taskId = 'task-v141-terminal-without-outcome';
    await pool.query(
      `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
       VALUES('context-v141-terminal-without-outcome','user-v141-runtime-core',
         '2026-08-04T03:02:00.000Z','2026-08-04T03:03:00.000Z')
       ON CONFLICT(context_id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO agent_task(
         task_id,context_id,user_id,phase,phase_message,created_at,updated_at,
         request_text,request_metadata)
       VALUES($1,'context-v141-terminal-without-outcome','user-v141-runtime-core','failed',
         'Terminal failure before outcome authority','2026-08-04T03:02:00.000Z',
         '2026-08-04T03:03:00.000Z','Inspect failed Runtime lifecycle','{}'::jsonb)
       ON CONFLICT(task_id) DO NOTHING`,
      [taskId],
    );

    await expect(source.pendingTaskIds(10)).resolves.toContain(taskId);
    await projector.projectTask(taskId);
    const stored = await store.pending(`runtime-core:${taskId}`, 10, '2026-08-04T04:11:00.000Z');

    expect(stored.map(({ envelope }) => envelope.recordType)).toEqual([
      'runtime.episode',
      'runtime.request',
      'runtime.a2a_task',
    ]);
    await expect(
      pool.query(`SELECT 1 FROM runtime_terminal_outcome WHERE task_id=$1`, [taskId]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(source.pendingTaskIds(10)).resolves.not.toContain(taskId);
  });

  it('projects a reconstructable parent-child Skill tree with exact cross-family references and idempotent replay', async () => {
    await seedSkillPrerequisiteEvidence();
    await expect(skillSource.pendingTaskIds(10)).resolves.toEqual(['task-v141-runtime-core']);
    const authoritativeSnapshot = await skillSource.load('task-v141-runtime-core');
    expect(
      authoritativeSnapshot?.skillVersions.map((version) => ({
        skillId: version['skill_id'],
        version: version['version'],
        usage: version['usage_specification_json'],
      })),
    ).toEqual([
      expect.objectContaining({ skillId: 'skill-v141-child', version: 1 }),
      expect.objectContaining({ skillId: 'skill-v141-runtime-core', version: 1 }),
    ]);
    expect(
      authoritativeSnapshot?.existingEvidence.map((evidence) => evidence['record_type']),
    ).toContain('capability.definition');

    const first = await skillProjector.projectTask('task-v141-runtime-core');
    const stored = await store.pending(
      'skill:task-v141-runtime-core',
      200,
      '2026-08-04T04:21:00.000Z',
    );
    const skillIssues = await pool.query<{
      record_type: string;
      source_record_id: string;
      detail: unknown;
    }>(
      `SELECT record_type,source_record_id,detail
       FROM evidence_quality_issue WHERE episode_id=$1 ORDER BY created_at,issue_id`,
      ['task-v141-runtime-core'],
    );
    expect(skillIssues.rows).toEqual([]);
    const types = new Set(stored.map(({ envelope }) => envelope.recordType));
    expect(types).toEqual(
      new Set([
        'skill.usage_snapshot',
        'skill.candidate',
        'skill.applicability',
        'skill.context_resolution',
        'skill.selection',
        'skill.mode_selection',
        'skill.composition',
        'skill.composition_edge',
        'skill.capability_slot_resolution',
        'skill.procedure_compilation',
        'skill.plan_compliance',
        'skill.execution',
        'skill.execution_event',
        'skill.execution_reference',
        'skill.failure_propagation',
        'skill.evidence_requirement',
      ]),
    );
    const executionIds = new Map(
      stored
        .filter(({ envelope }) => envelope.recordType === 'skill.execution')
        .map(({ envelope }) => [envelope.sourceRecordId, envelope.recordId] as const),
    );
    expect(record(stored, 'skill.composition_edge').payload).toMatchObject({
      parentExecutionId: 'skill-execution-v141-runtime-core',
      childExecutionId: 'skill-execution-v141-child',
      failurePolicy: 'degraded',
    });
    expect(record(stored, 'skill.capability_slot_resolution').payload).toMatchObject({
      slotId: 'inspect-slot',
      capabilityId: 'capability.inspect-area',
    });
    expect(record(stored, 'skill.failure_propagation').payload).toMatchObject({
      failurePolicy: 'degraded',
      missingEffects: ['coverage.zone-b'],
      missingEvidence: ['image.zone-b'],
    });
    expect(
      new Set(
        stored
          .filter(({ envelope }) => envelope.recordType === 'skill.execution_reference')
          .map(({ envelope }) => jsonField(envelope.payload, 'kind')),
      ),
    ).toEqual(
      new Set([
        'provider',
        'resource',
        'remote_task_binding',
        'evidence',
        'hard_gate',
        'human_intervention',
        'outcome',
      ]),
    );
    expect(
      new Set(
        stored
          .filter(({ envelope }) => envelope.recordType === 'skill.plan_compliance')
          .map(({ envelope }) => jsonField(envelope.payload, 'complianceStatus')),
      ),
    ).toEqual(new Set(['passed', 'failed']));
    expect(
      stored
        .filter(({ envelope }) => envelope.recordType === 'skill.execution_event')
        .map(({ envelope }) => jsonField(envelope.payload, 'eventType')),
    ).toEqual(
      expect.arrayContaining(['skill.execution_waiting_external', 'skill.execution_started']),
    );
    expect(
      new Set(
        stored
          .filter(({ envelope }) => envelope.recordType === 'skill.usage_snapshot')
          .map(({ envelope }) =>
            jsonField(jsonField(envelope.payload, 'usageSpecificationSnapshot'), 'sourceFormat'),
          ),
      ),
    ).toEqual(new Set(['native', 'legacy']));
    for (const { envelope } of stored) {
      expect(envelope.payloadHash).toBe(hashCanonicalEvidenceJson(envelope.payload));
      if (envelope.recordType === 'skill.usage_snapshot')
        expect(envelope.evidenceRefs).toContain(executionIds.get(envelope.sourceRecordId));
    }
    await expect(
      pool.query(`SELECT 1 FROM evidence_quality_issue WHERE episode_id=$1`, [
        'task-v141-runtime-core',
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });

    const second = await skillProjector.projectTask('task-v141-runtime-core');
    expect(second.projectedRecordIds).toEqual(first.projectedRecordIds);
    await expect(
      store.pending('skill:task-v141-runtime-core', 200, '2026-08-04T04:21:00.000Z'),
    ).resolves.toHaveLength(stored.length);
    await expect(skillSource.pendingTaskIds(10)).resolves.toEqual([]);
    const retryIssue = {
      issueId: 'quality_skill_retry_v141',
      issueCode: 'reference_unresolved',
      severity: 'blocking',
      recordType: 'skill.capability_slot_resolution',
      episodeId: 'task-v141-runtime-core',
      sourceSystem: 'runtime',
      sourceTable: 'skill_execution_event',
      sourceRecordId: 'skill-event-v141-child',
      detail: { missingReference: 'capability.definition' },
      createdAt: '2026-08-04T04:22:00.000Z',
    } satisfies EvidenceQualityIssue;
    await store.recordQualityIssue(retryIssue);
    await expect(skillSource.pendingTaskIds(10)).resolves.toEqual(['task-v141-runtime-core']);
    await store.resolveQualityIssues({
      episodeId: 'task-v141-runtime-core',
      recordTypePrefix: 'skill.',
      retainedIssueIds: [],
      resolvedAt: '2026-08-04T04:23:00.000Z',
    });
    await expect(skillSource.pendingTaskIds(10)).resolves.toEqual([]);
  });

  it('projects all MCP Task and Capability families from PostgreSQL facts and replays idempotently', async () => {
    await expect(mcpCapabilitySource.pendingTaskIds(10)).resolves.toEqual([
      'task-v141-runtime-core',
    ]);
    const first = await mcpCapabilityProjector.projectTask('task-v141-runtime-core');
    const stored = await store.pending(
      'mcp-capability:task-v141-runtime-core',
      200,
      '2026-08-04T04:31:00.000Z',
    );
    expect(new Set(stored.map(({ envelope }) => envelope.recordType))).toEqual(
      new Set([
        'mcp_task.tool_call',
        'mcp_task.availability',
        'mcp_task.remote_binding',
        'mcp_task.observation',
        'mcp_task.control_event',
        'mcp_task.poll_attempt',
        'mcp_task.input_link',
        'mcp_task.cancel',
        'mcp_task.reconciliation',
        'mcp_task.continuation_snapshot',
        'mcp_task.continuation_attempt',
        'capability.definition',
        'capability.implementation_binding',
        'capability.readiness',
        'capability.task_binding',
        'capability.execution_attempt',
        'capability.a2a_exposure',
        'capability.agent_card_revision',
      ]),
    );
    expect(stored).toHaveLength(18);
    expect(record(stored, 'mcp_task.observation').payload).toMatchObject({
      workflowTrigger: false,
    });
    expect(record(stored, 'mcp_task.continuation_attempt').payload).toMatchObject({
      resumePosition: 'saved_continuation_not_start',
      completedSideEffectReplay: false,
    });
    expect(record(stored, 'capability.task_binding').payload).toMatchObject({
      inputSnapshot: { target: 'runtime' },
      successCriteriaSnapshot: ['inspection verified'],
      evidenceRequirementSnapshot: [expect.objectContaining({ requirementId: 'coverage' })],
      constraintSnapshot: [],
      initialImplementationRefs: ['skill-v141-runtime-core@1'],
      bindingHash: '9'.repeat(64),
    });
    const second = await mcpCapabilityProjector.projectTask('task-v141-runtime-core');
    expect(second.projectedRecordIds).toEqual(first.projectedRecordIds);
    await expect(
      store.pending('mcp-capability:task-v141-runtime-core', 200, '2026-08-04T04:31:00.000Z'),
    ).resolves.toHaveLength(18);
    await expect(mcpCapabilitySource.pendingTaskIds(10)).resolves.toEqual([]);
  });

  it('maps legal Experience, Replay and Artifact authorities without replacing the real P03-P04 vertical', async () => {
    const partitions = await experienceReplayArtifactSource.pendingPartitions(100);
    expect(partitions.map((partition) => partition.kind)).toEqual([
      'experience_task',
      'experience_pattern',
      'replay_case',
      'artifact',
      'replay_dataset',
      'validation',
      'retrieval',
      'usage',
      'feedback',
      'promotion',
    ]);
    const snapshot = await experienceReplayArtifactSource.load(
      requiredExperiencePartition(partitions, 'experience_task'),
    );
    const patternSnapshot = await experienceReplayArtifactSource.load(
      requiredExperiencePartition(partitions, 'experience_pattern'),
    );
    const artifactSnapshot = await experienceReplayArtifactSource.load(
      requiredExperiencePartition(partitions, 'artifact'),
    );
    const validationSnapshot = await experienceReplayArtifactSource.load(
      requiredExperiencePartition(partitions, 'validation'),
    );
    expect(snapshot?.traces[0]).toMatchObject({
      trace_id: 'trace-v141',
      source_episode_id: 'episode-v141',
    });
    expect(snapshot?.traces.map((trace) => trace['compilation_run_refs'])).toEqual([
      ['normalization-run-v141'],
      ['normalization-run-v141-secondary'],
    ]);
    expect(artifactSnapshot?.artifacts[0]).toMatchObject({
      artifact_id: 'artifact-v141',
      version: 1,
      workflow_pattern_refs: ['workflow-pattern-v141'],
      lineage: {
        source_pattern_refs: [
          'workflow-pattern-v141',
          'pattern-v141',
          'fused-pattern-v141',
          'generalized-pattern-v141',
        ],
      },
    });
    expect(validationSnapshot?.validationRuns[0]).toMatchObject({
      validation_run_id: 'validation-v141',
      artifact_id: 'artifact-v141',
    });
    expect(validationSnapshot?.caseResults[0]).toMatchObject({
      validation_run_id: 'validation-v141',
      replay_case_id: 'replay-case-v141',
    });
    expect(patternSnapshot?.patterns[0]?.['definition']).toMatchObject({
      workflowPattern: { workflowPatternId: 'workflow-pattern-v141' },
    });
    expect(patternSnapshot?.patterns[0]?.['compilation_run_refs']).toEqual([
      'process-mining-run-v141',
    ]);

    const first = await projectExperiencePartitions(partitions);
    const stored = await storedExperiencePartitions(partitions);
    expect(new Set(stored.map(({ envelope }) => envelope.recordType))).toEqual(
      new Set([
        'experience.episode',
        'experience.trace',
        'experience.trace_event',
        'experience.activity',
        'experience.process_variant',
        'experience.workflow_pattern',
        'experience.workflow_pattern_dependency',
        'experience.recovery_pattern',
        'experience.planning_correction',
        'experience.interaction_episode',
        'replay.dataset',
        'replay.case',
        'replay.run',
        'replay.case_result',
        'replay.metric_result',
        'replay.counterexample',
        'artifact.lifecycle',
        'artifact.validation',
        'artifact.retrieval',
        'artifact.usage',
        'artifact.feedback',
        'artifact.promotion',
      ]),
    );
    expect(stored).toHaveLength(35);
    const all = await pool.query<{ record_id: string }>('SELECT record_id FROM evidence_outbox');
    const allIds = new Set(all.rows.map((row) => row.record_id));
    for (const { envelope } of stored) {
      expect(envelope.evidenceRefs.length).toBeGreaterThan(0);
      for (const reference of envelope.evidenceRefs.filter((value) =>
        value.startsWith('evidence_'),
      ))
        expect(allIds.has(reference)).toBe(true);
    }
    expect(record(stored, 'experience.trace_event').payload).toMatchObject({
      concurrencyGroup: 'parallel-v141',
      branchRef: 'success-v141',
    });
    const traceEvents = stored.filter(
      ({ envelope }) =>
        envelope.recordType === 'experience.trace_event' &&
        jsonField(envelope.payload, 'traceId') === 'trace-v141',
    );
    expect(
      traceEvents.map(({ envelope }) => jsonField(envelope.payload, 'parentEventRefs')),
    ).toEqual([[], ['event-start-v141'], ['event-complete-v141']]);
    expect(
      stored.filter(({ envelope }) => envelope.recordType === 'experience.activity'),
    ).toHaveLength(6);
    expect(
      stored.filter(
        ({ envelope }) => envelope.recordType === 'experience.workflow_pattern_dependency',
      ),
    ).toHaveLength(2);
    expect(
      new Set(
        stored
          .filter(
            ({ envelope }) => envelope.recordType === 'experience.workflow_pattern_dependency',
          )
          .map(({ envelope }) => jsonField(envelope.payload, 'dependencyType')),
      ),
    ).toEqual(new Set(['direct_follows', 'parallel']));

    const taskScoped = record(stored, 'experience.trace');
    expect(taskScoped).toMatchObject({
      tenantId: 'tenant-v141',
      userScopeId: 'user-v141-runtime-core',
      taskId: 'task-v141-runtime-core',
      contextId: 'context-v141-runtime-core',
      episodeId: 'task-v141-runtime-core',
      runId: 'normalization-run-v141',
      goalId: 'goal-v141-runtime-core',
      goalVersion: 2,
      planId: 'plan-v141-runtime-core',
      planVersion: 2,
    });
    expect(taskScoped.payload).toMatchObject({
      traceBody: { schemaVersion: '1.2', outcomeStatus: 'succeeded' },
    });
    expect(record(stored, 'replay.case_result')).toMatchObject({
      tenantId: 'tenant-v141',
      userScopeId: 'user-v141-runtime-core',
      taskId: 'task-v141-runtime-core',
      contextId: 'context-v141-runtime-core',
      episodeId: 'task-v141-runtime-core',
      runId: 'validation-v141',
      goalId: 'goal-v141-runtime-core',
      goalVersion: 2,
      planId: 'plan-v141-runtime-core',
      planVersion: 2,
    });
    expect(record(stored, 'experience.workflow_pattern')).toMatchObject({
      tenantId: 'tenant-v141',
      runId: 'process-mining-run-v141',
    });
    for (const recordType of [
      'experience.workflow_pattern',
      'artifact.lifecycle',
      'replay.dataset',
      'artifact.validation',
      'artifact.promotion',
    ]) {
      const global = record(stored, recordType);
      expect(global.tenantId).toBe('tenant-v141');
      expect(global.taskId).toBeUndefined();
      expect(global.contextId).toBeUndefined();
      expect(global.episodeId).toBeUndefined();
      expect(global.userScopeId).toBeUndefined();
      expect(global.goalId).toBeUndefined();
      expect(global.planId).toBeUndefined();
    }

    const resolver = new PostgresRuntimeSourceArtifactResolver(pool);
    for (const recordType of ['replay.case', 'replay.dataset', 'artifact.lifecycle']) {
      const envelope = record(stored, recordType);
      const ref = payloadArtifactRef(envelope);
      expect(ref.uri).toMatch(/^artifact:\/\/runtime\/v1\//u);
      expect(envelope.artifactRefs).toEqual([ref.uri]);
      const resolved = await resolver.resolve(ref);
      expect(resolved.artifactRef).toEqual(ref);
    }
    for (const recordType of ['experience.process_variant', 'experience.workflow_pattern']) {
      const envelope = record(stored, recordType);
      const ref = payloadArtifactRef(envelope, 'patternDefinitionArtifactRef');
      expect(ref.uri).toBe('artifact://runtime/v1/pattern_candidate/pattern-v141/1/definition');
      expect(envelope.artifactRefs).toEqual([ref.uri]);
      const resolved = await resolver.resolve(ref);
      expect(resolved.artifactRef).toEqual(ref);
      expect(jsonField(resolved.value, 'schemaVersion')).toBe('1.2');
    }
    const artifactLifecycle = record(stored, 'artifact.lifecycle');
    const artifactLifecycleRef = payloadArtifactRef(artifactLifecycle);
    expect(artifactLifecycleRef.sha256).toBe(jsonField(artifactLifecycle.payload, 'contentHash'));
    expect(artifactLifecycle.payload).toMatchObject({ policyRefs: ['policy.read-only@1'] });

    const validation = record(stored, 'artifact.validation');
    expect(validation.payload).toMatchObject({
      artifactId: 'artifact-v141',
      artifactVersion: 1,
      validationRunId: 'validation-v141',
      validationType: 'replay',
      result: 'passed',
      validatorVersion: 'validator/1.2',
      metricCatalogVersion: 'metrics/1.2',
    });
    expect(record(stored, 'replay.run').payload).toMatchObject({
      datasetVersion: 1,
      replaySafetyStatus: 'verified',
      replaySafety: {
        provider: 'ReplayNoPhysicalProvider',
        physicalAdapterInvocationCount: 0,
        sideEffectAttemptCount: 0,
        deniedBeforePhysicalBoundaryCount: 0,
        denialEvidenceRefs: [],
        physicalOutcomeClaim: 'none',
      },
      noPhysicalSideEffects: true,
    });

    const retrieval = record(stored, 'artifact.retrieval');
    expect(retrieval.payload).toMatchObject({
      matchId: 'match-v141',
      candidateArtifactId: 'artifact-v141',
      artifactVersion: 1,
      decision: 'template_adapt',
    });
    expect(retrieval.evidenceRefs).toContain(artifactLifecycle.recordId);
    const usage = record(stored, 'artifact.usage');
    expect(usage.payload).toMatchObject({
      artifactId: 'artifact-v141',
      artifactVersion: 1,
      retrievalDecisionId: 'retrieval-decision-v141',
      retrievalMatchId: 'match-v141',
    });
    expect(usage.evidenceRefs).toEqual(
      expect.arrayContaining([artifactLifecycle.recordId, retrieval.recordId]),
    );

    const counterexampleContent = jsonField(
      record(stored, 'replay.counterexample').payload,
      'content',
    );
    if (counterexampleContent === undefined)
      throw new Error('Counterexample content missing from persisted Evidence.');
    const promotion = record(stored, 'artifact.promotion');
    expect(promotion.payload).toMatchObject({
      artifactId: 'artifact-v141',
      artifactVersion: 1,
      artifactRef: artifactLifecycleRef.uri,
      artifactHash: artifactLifecycleRef.sha256,
      validationSummaryRef: 'validation-v141',
      validationSummaryHash: jsonField(validation.payload, 'resultHash'),
      counterexampleSummaryRef: 'counterexample-v141',
      counterexampleSummaryHash: hashCanonicalEvidenceJson([counterexampleContent]),
      counterexampleRefs: ['counterexample-v141'],
    });
    expect(first).toHaveLength(35);

    const restartedSource = new PostgresExperienceReplayArtifactEvidenceSource(pool);
    const restartedProjector = new ExperienceReplayArtifactEvidenceProjector({
      source: restartedSource,
      writer: new PostgresEvidenceStore(pool),
      environment: 'integration',
      clock: { now: () => '2026-08-04T04:45:00.000Z' },
    });
    const restartedPartitions = await restartedSource.pendingPartitions(100);
    expect(restartedPartitions).toEqual([]);
    const second = await projectExperiencePartitions(partitions, restartedProjector);
    expect(second).toEqual([]);
    const restartedStored = await storedExperiencePartitions(partitions);
    expect(restartedStored).toHaveLength(35);
    expect(new Set(restartedStored.map(({ envelope }) => envelope.recordId))).toEqual(
      new Set(stored.map(({ envelope }) => envelope.recordId)),
    );

    await seedLateExperienceInteraction();
    const lateSource = new PostgresExperienceReplayArtifactEvidenceSource(pool);
    const lateProjector = new ExperienceReplayArtifactEvidenceProjector({
      source: lateSource,
      writer: new PostgresEvidenceStore(pool),
      environment: 'integration',
      clock: { now: () => '2026-08-04T04:50:00.000Z' },
    });
    const latePartitions = await lateSource.pendingPartitions(100);
    const lateTaskPartition = requiredExperiencePartition(latePartitions, 'experience_task');
    const late = await lateProjector.projectPartition(lateTaskPartition);
    expect(late.qualityIssueIds).toEqual([]);
    const afterLateArrival = await storedExperiencePartitions(
      partitions,
      '2026-08-04T04:51:00.000Z',
    );
    expect(afterLateArrival).toHaveLength(36);
    expect(
      afterLateArrival.some(
        ({ envelope }) =>
          envelope.recordType === 'experience.interaction_episode' &&
          envelope.sourceRecordId === 'interaction-late-v141',
      ),
    ).toBe(true);
    expect(
      first.every((recordId) =>
        afterLateArrival.some(({ envelope }) => envelope.recordId === recordId),
      ),
    ).toBe(true);
    const checkpoint = await pool.query<{
      last_occurred_at: Date;
      last_projected_at: Date;
      projector_version: string;
    }>(
      `SELECT last_occurred_at,last_projected_at,projector_version
       FROM evidence_source_checkpoint
       WHERE source_family='experience' AND source_partition=$1`,
      [lateTaskPartition.sourcePartition],
    );
    expect(checkpoint.rows).toHaveLength(1);
    expect(checkpoint.rows[0]?.last_occurred_at.toISOString()).toBe('2026-08-04T03:05:00.000Z');
    expect(checkpoint.rows[0]?.last_projected_at.toISOString()).toBe('2026-08-04T04:50:00.000Z');
    expect(checkpoint.rows[0]?.projector_version).toBe('1.4.1-phase8.2');

    const quality = await pool.query<{ issue_id: string; severity: string }>(
      `SELECT issue_id,severity FROM evidence_quality_issue
       WHERE source_system='runtime' AND resolved_at IS NULL
         AND (record_type LIKE 'experience.%' OR record_type LIKE 'replay.%'
           OR record_type LIKE 'artifact.%')
       ORDER BY issue_id`,
    );
    expect(quality.rows).toEqual([]);

    const schemaValidator = new AjvJsonSchemaValidator({ strict: false });
    for (const { envelope } of afterLateArrival) {
      const schema = JSON.parse(
        readFileSync(
          path.resolve('schemas/evidence/v1/records', `${envelope.recordType}.schema.json`),
          'utf8',
        ),
      ) as object;
      expect(schemaValidator.validate(schema, envelope), envelope.recordType).toEqual({
        valid: true,
        errors: [],
      });
    }
  });

  it(
    'loads, projects and resolves a real PostgreSQL 10k Pattern without hidden 4096/8192 truncation',
    { timeout: 180_000 },
    async () => {
      const large = await seedLargePatternFacts(10_000);
      const largeSource = new PostgresExperienceReplayArtifactEvidenceSource(pool);
      const partition = {
        kind: 'experience_pattern' as const,
        sourceFamily: 'experience' as const,
        sourcePartition: `v141:experience_pattern:${String(large.patternId.length)}:${large.patternId}`,
        sourceId: large.patternId,
      };

      const snapshot = await largeSource.load(partition);
      expect(snapshot?.patterns[0]?.['support_refs']).toHaveLength(10_000);
      expect(
        snapshot?.existingEvidence.filter((row) => row['record_type'] === 'experience.trace'),
      ).toHaveLength(10_000);
      const largeProjector = new ExperienceReplayArtifactEvidenceProjector({
        source: largeSource,
        writer: new PostgresEvidenceStore(pool),
        environment: 'integration',
        clock: { now: () => '2026-08-04T05:10:00.000Z' },
      });
      const projected = await largeProjector.projectPartition(partition);
      expect(projected.qualityIssueIds).toEqual([]);

      const stored = await store.pending(partition.sourcePartition, 10, '2026-08-04T05:11:00.000Z');
      expect(stored).toHaveLength(3);
      const variant = record(stored, 'experience.process_variant');
      const workflow = record(stored, 'experience.workflow_pattern');
      expect(variant.evidenceRefs).toEqual([]);
      expect(jsonField(variant.payload, 'traceRefs')).toMatchObject({
        artifactRefUri: large.artifact.artifactRef.uri,
        jsonPointer: '/variants/0/traceRefs',
        count: 10_000,
        sha256: hashSourceArtifactJson(large.traceIds),
      });
      expect(workflow.evidenceRefs).toEqual([variant.recordId]);
      expect(jsonField(workflow.payload, 'supportRefs')).toMatchObject({
        artifactRefUri: large.artifact.artifactRef.uri,
        jsonPointer: '/discoveredPattern/supportRefs',
        count: 10_000,
        sha256: hashSourceArtifactJson(large.traceIds),
      });

      const ref = payloadArtifactRef(workflow, 'patternDefinitionArtifactRef');
      const resolved = await new PostgresRuntimeSourceArtifactResolver(pool).resolve(ref);
      expect(resolved.artifactRef).toEqual(large.artifact.artifactRef);
      expect(Buffer.from(resolved.canonicalBytes)).toEqual(
        Buffer.from(large.artifact.canonicalBytes),
      );
      const resolvedDefinition = jsonField(resolved.value, 'workflowPattern');
      expect(jsonField(resolvedDefinition, 'sourceTraceRefs')).toHaveLength(10_000);

      const schemaValidator = new AjvJsonSchemaValidator({ strict: false });
      for (const { envelope } of stored) {
        const schema = JSON.parse(
          readFileSync(
            path.resolve('schemas/evidence/v1/records', `${envelope.recordType}.schema.json`),
            'utf8',
          ),
        ) as object;
        expect(schemaValidator.validate(schema, envelope), envelope.recordType).toEqual({
          valid: true,
          errors: [],
        });
      }
    },
  );
});

function requiredExperiencePartition(
  partitions: Awaited<ReturnType<typeof experienceReplayArtifactSource.pendingPartitions>>,
  kind: (typeof partitions)[number]['kind'],
) {
  const partition = partitions.find((candidate) => candidate.kind === kind);
  if (partition === undefined) throw new Error(`Missing ${kind} Evidence partition.`);
  return partition;
}

async function projectExperiencePartitions(
  partitions: Awaited<ReturnType<typeof experienceReplayArtifactSource.pendingPartitions>>,
  selectedProjector: ExperienceReplayArtifactEvidenceProjector = experienceReplayArtifactProjector,
) {
  const recordIds: string[] = [];
  for (const partition of partitions) {
    const result = await selectedProjector.projectPartition(partition);
    expect(result.qualityIssueIds, partition.sourcePartition).toEqual([]);
    recordIds.push(...result.projectedRecordIds);
  }
  return [...new Set(recordIds)].sort();
}

async function storedExperiencePartitions(
  partitions: Awaited<ReturnType<typeof experienceReplayArtifactSource.pendingPartitions>>,
  availableAt = '2026-08-04T04:41:00.000Z',
) {
  const rows: StoredEvidenceRecord[] = [];
  for (const partition of partitions)
    rows.push(...(await store.pending(partition.sourcePartition, 200, availableAt)));
  return rows;
}

async function evidenceRecords(): Promise<readonly StoredEvidenceRecord[]> {
  return store.pending('runtime-core:task-v141-runtime-core', 100, '2026-08-04T04:11:00.000Z');
}

function record(
  rows: readonly { sequence: string; envelope: CanonicalEvidenceEnvelope }[],
  recordType: string,
): CanonicalEvidenceEnvelope {
  const result = rows.find((row) => row.envelope.recordType === recordType)?.envelope;
  if (result === undefined) throw new Error(`Missing ${recordType}.`);
  return result;
}

function jsonField(value: unknown, field: string): EvidenceJsonValue | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
  const objectValue = value as Readonly<Record<string, EvidenceJsonValue>>;
  return objectValue[field];
}

function payloadArtifactRef(
  envelope: CanonicalEvidenceEnvelope,
  field = 'artifactRef',
): ArtifactRef {
  const value = jsonField(envelope.payload, field);
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${envelope.recordType} payload ArtifactRef is missing.`);
  }
  const ref = value as Readonly<Record<string, EvidenceJsonValue>>;
  if (
    typeof ref['artifactId'] !== 'string' ||
    typeof ref['version'] !== 'number' ||
    typeof ref['uri'] !== 'string' ||
    typeof ref['sha256'] !== 'string' ||
    typeof ref['mediaType'] !== 'string' ||
    typeof ref['byteSize'] !== 'number'
  ) {
    throw new Error(`${envelope.recordType} payload ArtifactRef is malformed.`);
  }
  return ref as unknown as ArtifactRef;
}

function controlCapabilityDefinition() {
  return Object.freeze({
    capability_id: 'capability.inspect-area',
    version: 1,
    domain: 'embodied',
    name: 'Inspect area',
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    success_criteria: ['inspection verified'],
    required_evidence: [{ requirementId: 'coverage' }],
    constraints: [],
    status: 'published',
    definition_hash: '7'.repeat(64),
    updated_at: '2026-08-04T03:00:00.000Z',
    node_control_revision_record_id: `evidence_${'8'.repeat(64)}`,
  });
}

function controlCapabilityImplementation() {
  return Object.freeze({
    binding_id: 'implementation-v141-runtime-core',
    revision: 1,
    capability_id: 'capability.inspect-area',
    capability_version: 1,
    implementation_type: 'skill',
    implementation_id: 'skill-v141-runtime-core',
    implementation_version: '1',
    role: 'primary',
    priority: 0,
    status: 'active',
    created_at: '2026-08-04T03:00:00.000Z',
  });
}

async function seedExperienceReplayArtifactFacts(): Promise<void> {
  const at = '2026-08-04T03:02:00.000Z';
  const hash = (character: string): string => `sha256:${character.repeat(64)}`;
  await pool.query(
    `TRUNCATE artifact_promotion_assessment,artifact_promotion_package,
       artifact_promotion_policy,artifact_feedback,artifact_execution,runtime_candidate_decision,
       artifact_match_log,artifact_counterexample,artifact_validation_failure,
       artifact_replay_case_result,artifact_validation_run,replay_dataset_case,
       replay_dataset_manifest,artifact_replay_case,compiled_artifact,artifact_lineage,
       generalized_pattern,fused_pattern,planning_correction_fact,planning_interaction_episode,compilation_run,
       pattern_candidate_support,pattern_candidate,experience_trace_source,experience_trace,
       goal_experience_episode_source,goal_experience_episode
     RESTART IDENTITY CASCADE`,
  );
  const trace = createExperienceTrace({
    traceId: 'trace-v141',
    sourceEpisodeId: 'episode-v141',
    taskTypeRefs: ['task-type-v141'],
    goalFingerprint: hash('3'),
    capabilityFingerprint: hash('4'),
    environmentFingerprint: hash('5'),
    trace: {
      schemaVersion: '1.2',
      tenantId: 'tenant-v141',
      events: [
        {
          eventId: 'event-start-v141',
          sequence: 0,
          occurredAt: at,
          eventType: 'skill_attempt_started',
          actorType: 'runtime',
          activity: {
            activityKey: 'inspect_runtime',
            activityKind: 'provider_operation',
            objectiveSummary: 'Inspect the Runtime through the exact Provider operation.',
            sourcePlanNodeRef: 'node-v141-runtime-core',
            sourceSkillGoalRef: 'step-v141-runtime-core',
            sourceAttemptRef: 'attempt-v141-runtime-core',
            operationRef: 'server-v141-runtime-core/inspect_runtime',
            capabilityRefs: ['capability.inspect-area'],
            effectRefs: ['effect-v141-runtime-core'],
          },
          capabilityRefs: ['capability.inspect-area'],
          authorityRefs: ['runtime-postgresql:mcp_invocation:invocation-v141-runtime-core'],
          parentEventRefs: [],
          concurrencyGroup: 'parallel-v141',
          branchRef: 'success-v141',
          payloadSummary: { lifecycle: 'started' },
        },
        {
          eventId: 'event-complete-v141',
          sequence: 1,
          occurredAt: '2026-08-04T03:02:01.000Z',
          eventType: 'skill_attempt_completed',
          actorType: 'provider',
          activity: {
            activityKey: 'inspect_runtime',
            activityKind: 'provider_operation',
            objectiveSummary: 'Preserve the repeated inspection activity and its self-loop.',
            sourcePlanNodeRef: 'node-v141-runtime-core',
            sourceSkillGoalRef: 'step-v141-runtime-core',
            sourceAttemptRef: 'attempt-v141-runtime-core',
            operationRef: 'server-v141-runtime-core/inspect_runtime',
            capabilityRefs: ['capability.inspect-area'],
            effectRefs: ['effect-v141-runtime-core'],
          },
          capabilityRefs: ['capability.inspect-area'],
          authorityRefs: ['runtime-postgresql:mcp_invocation:invocation-v141-runtime-core'],
          parentEventRefs: ['event-start-v141'],
          concurrencyGroup: 'parallel-v141',
          branchRef: 'success-v141',
          payloadSummary: { lifecycle: 'completed' },
        },
        {
          eventId: 'event-verify-v141',
          sequence: 2,
          occurredAt: '2026-08-04T03:02:02.000Z',
          eventType: 'business_event_observed',
          actorType: 'runtime',
          activity: {
            activityKey: 'verify_runtime',
            activityKind: 'verification',
            objectiveSummary: 'Verify the structured inspection evidence.',
            sourcePlanNodeRef: 'node-v141-runtime-core',
            sourceSkillGoalRef: 'step-v141-runtime-core',
            sourceAttemptRef: 'attempt-v141-runtime-core',
            capabilityRefs: ['capability.inspect-area'],
            effectRefs: ['effect-v141-runtime-core'],
          },
          capabilityRefs: ['capability.inspect-area'],
          authorityRefs: ['runtime-postgresql:completed_effect:effect-v141-runtime-core'],
          parentEventRefs: ['event-complete-v141'],
          concurrencyGroup: 'parallel-v141',
          branchRef: 'success-v141',
          payloadSummary: { verified: true },
        },
      ],
      correctionRefs: ['correction-v141'],
      outcomeRef: 'outcome-v141-runtime-core',
      outcomeStatus: 'succeeded',
      missingFactCodes: [],
      environmentClass: 'integration',
      deviceClass: 'server-runtime',
    },
    completeness: 1,
    dataClassification: 'user_scoped',
    normalizerVersion: 'sdar-experience-normalizer/1.2',
    sourceHash: hash('6'),
    createdAt: at,
  });
  const secondaryTrace = createExperienceTrace({
    ...trace,
    traceId: 'trace-v141-secondary',
    sourceHash: hash('e'),
    trace: {
      ...trace.trace,
      events: trace.trace.events.map((event, index) => ({
        ...event,
        eventId: `event-secondary-${String(index)}`,
        occurredAt: new Date(Date.parse(at) + 10_000 + index * 1_000).toISOString(),
        parentEventRefs: index === 0 ? [] : [`event-secondary-${String(index - 1)}`],
      })),
      deviceClass: 'server-runtime-secondary',
    },
  });
  const traceRefs = [trace.traceId, secondaryTrace.traceId] as const;

  await pool.query(
    `INSERT INTO goal_experience_episode(
       episode_id,goal_id,goal_version,task_id,context_id,episode_type,revision,
       terminal_outcome_ref,source_hash,episode_hash,completeness,status,data_classification,
       redaction_codes,snapshot,created_at,tenant_id,user_scope_id)
     VALUES('episode-v141','goal-v141-runtime-core',2,'task-v141-runtime-core',
       'context-v141-runtime-core','terminal',1,'outcome-v141-runtime-core',$1,$2,1,
       'complete','user_scoped','[]'::jsonb,$3::jsonb,$4,'tenant-v141','user-v141-runtime-core')`,
    [
      hash('1'),
      hash('2'),
      JSON.stringify({ missingFactCodes: [], terminalStatus: 'succeeded' }),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO goal_experience_episode_source(
       episode_id,source_ref_id,source_kind,source_id,source_revision,authority,
       data_classification,content_hash,captured_at)
     VALUES('episode-v141','source-task-v141','task_request','task-v141-runtime-core',1,
       'runtime_fact','user_scoped',$1,$2)`,
    [hash('0'), at],
  );
  await pool.query(
    `INSERT INTO experience_trace(
       trace_id,source_episode_id,task_type_refs,goal_fingerprint,capability_fingerprint,
       environment_fingerprint,trace,completeness,created_at)
     VALUES($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      trace.traceId,
      trace.sourceEpisodeId,
      JSON.stringify(trace.taskTypeRefs),
      trace.goalFingerprint,
      trace.capabilityFingerprint,
      trace.environmentFingerprint,
      JSON.stringify(trace.trace),
      trace.completeness,
      trace.createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO experience_trace(
       trace_id,source_episode_id,task_type_refs,goal_fingerprint,capability_fingerprint,
       environment_fingerprint,trace,completeness,created_at)
     VALUES($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8,$9)`,
    [
      secondaryTrace.traceId,
      secondaryTrace.sourceEpisodeId,
      JSON.stringify(secondaryTrace.taskTypeRefs),
      secondaryTrace.goalFingerprint,
      secondaryTrace.capabilityFingerprint,
      secondaryTrace.environmentFingerprint,
      JSON.stringify(secondaryTrace.trace),
      secondaryTrace.completeness,
      secondaryTrace.createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO experience_trace_source(
       trace_id,source_episode_id,tenant_id,user_scope_id,normalizer_version,source_hash,
       data_classification,redaction_codes,created_at)
     VALUES($1,$2,'tenant-v141','user-v141-runtime-core',$3,$4,'user_scoped','[]'::jsonb,$5)`,
    [trace.traceId, trace.sourceEpisodeId, trace.normalizerVersion, trace.sourceHash, at],
  );
  await pool.query(
    `INSERT INTO experience_trace_source(
       trace_id,source_episode_id,tenant_id,user_scope_id,normalizer_version,source_hash,
       data_classification,redaction_codes,created_at)
     VALUES($1,$2,'tenant-v141','user-v141-runtime-core',$3,$4,'user_scoped','[]'::jsonb,$5)`,
    [
      secondaryTrace.traceId,
      secondaryTrace.sourceEpisodeId,
      secondaryTrace.normalizerVersion,
      secondaryTrace.sourceHash,
      secondaryTrace.createdAt,
    ],
  );

  const cohort = createCohortDefinition({
    tenantId: 'tenant-v141',
    taskTypeId: 'task-type-v141',
    goalFingerprint: trace.goalFingerprint,
    capabilityFingerprint: trace.capabilityFingerprint,
    environmentClass: 'integration',
    minimumCompleteness: 1,
  });
  const variant = createProcessVariant({
    variantId: 'variant-v141',
    activitySequence: ['inspect_runtime', 'inspect_runtime', 'verify_runtime'],
    activityKindSequence: ['provider_operation', 'provider_operation', 'verification'],
    concurrencyGroups: [['inspect_runtime', 'verify_runtime']],
    branchSequence: ['success-v141'],
    occurrenceCount: 2,
    traceRefs,
    successCount: 2,
    failureCount: 0,
  });
  const quality = Object.freeze({
    supportCount: 2,
    totalTraceCount: 2,
    supportRate: 1,
    successRate: 1,
    traceCoverage: 1,
    fitness: 1,
    precisionProxy: 1,
    environmentCoverage: 1,
    contradictionRate: 0,
    generalization: 0.5,
    mandatoryThreshold: 0.8,
  });
  const recovery = Object.freeze({
    triggerActivityKey: 'verify_runtime',
    resumeActivityKey: 'inspect_runtime',
    activitySequence: ['verify_runtime', 'inspect_runtime'],
    requiredCapabilityRefs: ['capability.inspect-area'],
    supportRefs: traceRefs,
  });
  const discoveredPattern = createDiscoveredProcessPattern({
    patternId: 'pattern-v141',
    cohortFingerprint: hashCanonicalEvidenceJson(cohort),
    algorithmVersion: 'sdar-deterministic-process-miner/1.2',
    mandatoryActivities: ['inspect_runtime', 'verify_runtime'],
    optionalActivities: [],
    orderingConstraints: [
      {
        predecessorActivity: 'inspect_runtime',
        successorActivity: 'inspect_runtime',
        relation: 'direct_follows',
        supportRefs: traceRefs,
        contradictionRefs: [],
      },
      {
        predecessorActivity: 'inspect_runtime',
        successorActivity: 'verify_runtime',
        relation: 'precedes',
        supportRefs: traceRefs,
        contradictionRefs: [],
      },
    ],
    parallelCandidates: [
      {
        activityRefs: ['inspect_runtime', 'verify_runtime'],
        evidenceType: 'explicit_concurrency',
        supportRefs: traceRefs,
        contradictionRefs: [],
      },
    ],
    recoveryBranches: [recovery],
    failureVariants: [],
    supportRefs: traceRefs,
    contradictionRefs: [],
    environmentCoverage: ['integration'],
    quality,
  });
  const workflowPattern = createWorkflowPattern({
    workflowPatternId: 'workflow-pattern-v141',
    taskTypeId: 'task-type-v141',
    activityPatterns: [
      {
        activityKey: 'inspect_runtime',
        activityKind: 'provider_operation',
        objectiveSummary: 'Inspect the Runtime through the exact Provider operation.',
        required: true,
        supportCount: 2,
        supportRate: 1,
        capabilityRefs: ['capability.inspect-area'],
        effectRefs: ['effect-v141-runtime-core'],
        lifecycleEventTypes: ['skill_attempt_started', 'skill_attempt_completed'],
      },
      {
        activityKey: 'verify_runtime',
        activityKind: 'verification',
        objectiveSummary: 'Verify the structured inspection evidence.',
        required: true,
        supportCount: 2,
        supportRate: 1,
        capabilityRefs: ['capability.inspect-area'],
        effectRefs: ['effect-v141-runtime-core'],
        lifecycleEventTypes: ['business_event_observed'],
      },
    ],
    dependencyPatterns: [
      {
        predecessorActivityKey: 'inspect_runtime',
        successorActivityKey: 'inspect_runtime',
        relation: 'direct_follows',
        supportRefs: traceRefs,
        contradictionRefs: [],
      },
      {
        predecessorActivityKey: 'inspect_runtime',
        successorActivityKey: 'verify_runtime',
        relation: 'parallel',
        supportRefs: traceRefs,
        contradictionRefs: [],
      },
    ],
    recoveryPatterns: [recovery],
    sourcePatternRef: discoveredPattern.patternId,
    sourceTraceRefs: traceRefs,
    quality,
  });
  const patternDefinition = {
    schemaVersion: '1.2',
    cohort,
    variants: [variant],
    discoveredPattern,
    workflowPattern,
  };
  const serializedPattern = canonicalizeSourceArtifactJson(
    patternDefinition as unknown as EvidenceJsonValue,
  );
  const patternHash = `sha256:${createHash('sha256').update(serializedPattern).digest('hex')}`;
  const patternEnvelope = {
    schemaVersion: '1.2',
    encoding: 'br+base64',
    contentHash: patternHash,
    uncompressedBytes: Buffer.byteLength(serializedPattern),
    workflowPatternId: 'workflow-pattern-v141',
    supportCount: 2,
    contradictionCount: 0,
    payload: brotliCompressSync(serializedPattern).toString('base64'),
  };
  await pool.query(
    `INSERT INTO pattern_candidate(
       pattern_id,pattern_type,cohort_fingerprint,definition,support_refs,contradiction_refs,
       confidence,status,created_at)
     VALUES('pattern-v141','workflow_pattern',$1,$2::jsonb,$3::jsonb,
       '[]'::jsonb,0.95,'discovered',$4)`,
    [
      discoveredPattern.cohortFingerprint,
      JSON.stringify(patternEnvelope),
      JSON.stringify(traceRefs),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO pattern_candidate_support(pattern_id,trace_id,tenant_id,support_kind,created_at)
     VALUES
       ('pattern-v141','trace-v141','tenant-v141','support',$1),
       ('pattern-v141','trace-v141-secondary','tenant-v141','support',$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO compilation_run(
       run_id,run_type,source_episode_id,tenant_id,user_scope_id,cohort_fingerprint,status,
       attempt,max_attempts,available_at,idempotency_key,payload,result_ref,created_at,updated_at)
     VALUES
       ('normalization-run-v141','normalization','episode-v141','tenant-v141',
        'user-v141-runtime-core',NULL,'completed',1,5,$1,'normalization-run-v141',
        '{"normalizerVersion":"sdar-experience-normalizer/1.2"}'::jsonb,'trace-v141',$1,$1),
       ('normalization-run-v141-secondary','normalization','episode-v141','tenant-v141',
        'user-v141-runtime-core',NULL,'completed',1,5,$1,'normalization-run-v141-secondary',
        '{"normalizerVersion":"sdar-experience-normalizer/1.2"}'::jsonb,
        'trace-v141-secondary',$1,$1),
       ('process-mining-run-v141','process_mining',NULL,'tenant-v141',NULL,$2,'completed',1,5,$1,
        'process-mining-run-v141','{"algorithmVersion":"sdar-deterministic-process-miner/1.2"}'::jsonb,
        'workflow-pattern-v141',$1,$1)`,
    [at, discoveredPattern.cohortFingerprint],
  );
  const fusedPattern = createFusedPattern({
    fusedPatternId: 'fused-pattern-v141',
    sourceWorkflowPatternRef: workflowPattern.workflowPatternId,
    sourceProcessPatternRef: 'pattern-v141',
    sourceTraceRefs: traceRefs,
    structuralPattern: workflowPattern,
    semanticCandidate: {
      activityNames: {
        inspect_runtime: 'Inspect runtime',
        verify_runtime: 'Verify runtime',
      },
      parameterCandidates: [
        {
          parameterName: 'target',
          suggestedSchema: { type: 'string' },
          sourceField: 'request.target',
          domainClass: 'runtime-target',
          allowedSources: ['user_confirmed', 'request'],
          trustLevel: 'authoritative',
          required: true,
          defaultPolicy: 'none',
          confidence: 0.95,
        },
      ],
      capabilityMappings: [
        {
          sourceActivity: 'inspect_runtime',
          capabilityId: 'capability.inspect-area',
          confidence: 1,
          ambiguity: 'none',
        },
      ],
      negativeExamples: [],
      explanation: 'Fuses two successful, cross-device Runtime traces.',
    },
    applicabilityCandidate: {
      domain: 'runtime',
      taskTypeId: 'task-type-v141',
      environmentClasses: ['integration'],
      deviceClasses: ['server-runtime', 'server-runtime-secondary'],
      tenantScope: 'single',
      userScope: 'single',
    },
    scopeEvidence: {
      tenantCount: 1,
      userCount: 1,
      deviceClassCount: 2,
      environmentClassCount: 1,
      successCount: 2,
      failureCount: 0,
      hasTemporaryAuthorization: false,
      hasFailureBoundary: true,
    },
    supportRefs: traceRefs,
    contradictionRefs: [],
    confidence: 0.95,
    fusionVersion: 'sdar-pattern-fusion/1.2',
    contentHash: hashCanonicalEvidenceJson({
      workflowPatternId: workflowPattern.workflowPatternId,
      traceRefs,
      deviceClasses: ['server-runtime', 'server-runtime-secondary'],
    }),
  });
  const generalizedPattern = createGeneralizedPattern({
    generalizedPatternId: 'generalized-pattern-v141',
    domain: 'runtime',
    taskTypeId: 'task-type-v141',
    variables: [
      {
        variableName: 'target',
        sourceField: 'request.target',
        domainClass: 'runtime-target',
        schema: { type: 'string' },
        allowedSources: ['user_confirmed', 'request'],
        trustLevel: 'authoritative',
        required: true,
      },
    ],
    invariants: [],
    requiredConditions: [],
    forbiddenConditions: [],
    applicabilityPredicates: [{ field: 'environmentClass', operator: 'eq', value: 'integration' }],
    failureBoundaries: [recovery],
    retainedExampleRefs: traceRefs,
    counterexampleRefs: [],
    sourceFusedPatternRef: fusedPattern.fusedPatternId,
    generalizerVersion: 'sdar-pattern-generalizer/1.2',
    contentHash: hashCanonicalEvidenceJson({
      fusedPatternId: fusedPattern.fusedPatternId,
      variables: ['target'],
      failureBoundary: recovery,
    }),
  });
  await pool.query(
    `INSERT INTO fused_pattern(
       fused_pattern_id,tenant_id,workflow_pattern_id,source_process_pattern_ref,
       source_trace_refs,content,content_hash,fusion_version,created_at)
     VALUES($1,'tenant-v141',$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
    [
      fusedPattern.fusedPatternId,
      fusedPattern.sourceWorkflowPatternRef,
      fusedPattern.sourceProcessPatternRef,
      JSON.stringify(fusedPattern.sourceTraceRefs),
      JSON.stringify(fusedPattern),
      fusedPattern.contentHash,
      fusedPattern.fusionVersion,
      at,
    ],
  );
  await pool.query(
    `INSERT INTO generalized_pattern(
       generalized_pattern_id,tenant_id,domain,task_type_id,source_fused_pattern_ref,
       content,content_hash,generalizer_version,created_at)
     VALUES($1,'tenant-v141',$2,$3,$4,$5::jsonb,$6,$7,$8)`,
    [
      generalizedPattern.generalizedPatternId,
      generalizedPattern.domain,
      generalizedPattern.taskTypeId,
      generalizedPattern.sourceFusedPatternRef,
      JSON.stringify(generalizedPattern),
      generalizedPattern.contentHash,
      generalizedPattern.generalizerVersion,
      at,
    ],
  );

  const correctionSources = [
    {
      schemaVersion: '1.0',
      sourceRefId: 'source-plan-v141',
      sourceKind: 'plan_revision',
      sourceId: 'plan-v141-runtime-core',
      sourceRevision: 2,
      authority: 'runtime_fact',
      dataClassification: 'internal',
      capturedAt: at,
    },
    {
      schemaVersion: '1.0',
      sourceRefId: 'source-episode-v141',
      sourceKind: 'goal_experience_episode',
      sourceId: 'episode-v141',
      sourceRevision: 1,
      authority: 'runtime_fact',
      dataClassification: 'user_scoped',
      capturedAt: at,
    },
  ];
  await pool.query(
    `INSERT INTO planning_correction_fact(
       correction_id,task_id,scope,tenant_id,user_id,correction_type,before_snapshot,
       user_instruction,structured_patch,after_snapshot,validation,source_refs,idempotency_key,
       created_at,goal_id,goal_version,session_id,turn_id,actor_id,target_scope,accepted,
       preference_category,final_outcome_ref,counterexample_refs,correction_hash)
     VALUES('correction-v141','task-v141-runtime-core','task','tenant-v141',
       'user-v141-runtime-core',
       'wrong_decomposition','{}'::jsonb,'Use verified inspection',$1::jsonb,'{}'::jsonb,
       '{"valid":true}'::jsonb,$2::jsonb,'correction-v141',$3,
       'goal-v141-runtime-core',2,'session-v141','turn-v141','user-v141-runtime-core',
       'skill_goal_plan',true,NULL,'outcome-v141-runtime-core','["counterexample-v141"]'::jsonb,$4)`,
    [
      JSON.stringify({ operation: 'replace', path: '/steps/0' }),
      JSON.stringify(correctionSources),
      at,
      hash('8'),
    ],
  );
  await pool.query(
    `INSERT INTO planning_interaction_episode(
       episode_id,task_id,revision,episode_hash,completeness,snapshot,created_at,goal_id,
       goal_version,tenant_id,user_id,original_request,outcome_ref,counterexample_refs,
       induction_fingerprint,source_refs)
     VALUES('interaction-v141','task-v141-runtime-core',1,$1,1,$2::jsonb,$3,
       'goal-v141-runtime-core',2,'tenant-v141','user-v141-runtime-core','Inspect runtime',
       'outcome-v141-runtime-core','["counterexample-v141"]'::jsonb,$4,$5::jsonb)`,
    [
      hash('9'),
      JSON.stringify({ correctionIds: ['correction-v141'] }),
      at,
      hash('a'),
      JSON.stringify([
        {
          schemaVersion: '1.0',
          sourceRefId: 'interaction-task-source-v141',
          sourceKind: 'task_request',
          sourceId: 'task-v141-runtime-core',
          sourceRevision: 1,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          capturedAt: at,
        },
        ...correctionSources.slice(1),
      ]),
    ],
  );

  const artifactDefinition = planTemplateEvidenceDefinition();
  const artifactSource = buildRuntimeSourceArtifact({
    sourceTable: 'compiled_artifact',
    sourceRecordId: 'artifact-v141',
    sourceVersion: 1,
    value: artifactDefinition as unknown as EvidenceJsonValue,
  });
  const compiledArtifact = createCompiledArtifact({
    artifactId: 'artifact-v141',
    artifactKey: 'artifact-key-v141',
    version: 1,
    artifactType: 'plan_template',
    name: 'Runtime inspection plan template',
    description: 'Compiles the exact inspection and verification workflow pattern.',
    scope: {
      tenantId: 'tenant-v141',
      domain: 'runtime',
      taskTypeIds: ['task-type-v141'],
    },
    definition: artifactDefinition,
    applicability: {
      requiredConditions: [],
      optionalConditions: [],
      forbiddenConditions: [],
      requiredParameters: ['target'],
      allowedEnvironmentClasses: ['integration'],
      excludedEnvironmentClasses: [],
      minimumIntentScore: 0.8,
      minimumConditionScore: 0.8,
      maximumUncertainty: 0.2,
      outOfDistributionPolicy: 'require_confirmation',
    },
    requiredCapabilities: [{ capabilityId: 'capability.inspect-area' }],
    requiredPolicies: [{ policyId: 'policy.read-only', version: '1' }],
    dependencySnapshot: {
      capabilityCatalogHash: hash('b'),
      policyVersionRefs: ['policy.read-only@1'],
      taskTypeVersionRefs: ['task-type-v141@1'],
      schemaVersionRefs: ['artifact.contract@1.2'],
      requiredSkillVersionRefs: ['skill-v141-runtime-core@1'],
      compilerVersion: 'compiler.1.2',
    },
    riskLevel: 'low',
    status: 'candidate',
    lineageRef: 'lineage-v141',
    validationSummaryRef: 'validation-v141',
    contentHash: artifactSource.artifactRef.sha256,
    createdAt: at,
  });
  const artifactLineage = createArtifactLineage({
    lineageId: 'lineage-v141',
    artifactId: compiledArtifact.artifactId,
    artifactVersion: compiledArtifact.version,
    sourceEpisodeRefs: ['episode-v141'],
    sourceKnowledgeRefs: [],
    sourceCorrectionRefs: ['correction-v141'],
    sourcePatternRefs: [
      workflowPattern.workflowPatternId,
      fusedPattern.sourceProcessPatternRef,
      fusedPattern.fusedPatternId,
      generalizedPattern.generalizedPatternId,
    ],
    generationMethods: ['process_mining'],
    validationRunRefs: ['validation-v141'],
    supersedesArtifactRefs: [],
  });
  const storedArtifactEnvelope = {
    schemaVersion: '1.0',
    artifact: compiledArtifact,
    lineage: artifactLineage,
  };
  const artifactClient = await pool.connect();
  try {
    await artifactClient.query('BEGIN');
    await artifactClient.query(
      `INSERT INTO compiled_artifact(
         artifact_id,artifact_key,version,artifact_type,tenant_id,domain,status,risk_level,
         definition,applicability,dependency_snapshot,lineage_id,content_hash,created_at)
       VALUES('artifact-v141','artifact-key-v141',1,'plan_template','tenant-v141','runtime',
         'candidate','low',$1::jsonb,$2::jsonb,$3::jsonb,'lineage-v141',$4,$5)`,
      [
        JSON.stringify(storedArtifactEnvelope),
        JSON.stringify(compiledArtifact.applicability),
        JSON.stringify(compiledArtifact.dependencySnapshot),
        compiledArtifact.contentHash,
        at,
      ],
    );
    await artifactClient.query(
      `INSERT INTO artifact_lineage(
         lineage_id,artifact_id,artifact_version,source_episode_refs,source_knowledge_refs,
         source_correction_refs,source_pattern_refs,generation_methods,compiler_version,created_at)
       VALUES('lineage-v141','artifact-v141',1,$1::jsonb,'[]'::jsonb,
         '["correction-v141"]'::jsonb,$2::jsonb,
         '["process_mining"]'::jsonb,'compiler/1.2',$3)`,
      [
        JSON.stringify(artifactLineage.sourceEpisodeRefs),
        JSON.stringify(artifactLineage.sourcePatternRefs),
        at,
      ],
    );
    await artifactClient.query('COMMIT');
  } catch (error) {
    await artifactClient.query('ROLLBACK');
    throw error;
  } finally {
    artifactClient.release();
  }
  const replayCase = createArtifactReplayCase({
    replayCaseId: 'replay-case-v141',
    tenantId: 'tenant-v141',
    requestSnapshotRef: 'runtime.request:task-v141-runtime-core',
    goalContractSnapshotRef: 'user_goal_contract:goal-v141-runtime-core:2',
    capabilityCatalogSnapshotRef: 'capability_catalog:integration-v141',
    worldStateSnapshotRef: 'runtime.world:integration-v141',
    policySnapshotRef: 'policy.read-only/1',
    readinessSnapshotRef: 'gate-v141-runtime-core',
    acceptedPlanSnapshotRef: 'plan-v141-runtime-core:2',
    executionTraceSnapshotRef: trace.traceId,
    outcomeSnapshotRef: 'outcome-v141-runtime-core',
    correctionRefs: ['correction-v141'],
    environmentClass: 'integration',
    deviceClass: 'server-runtime',
    taskTypeId: 'task-type-v141',
    sourceEpisodeRefs: ['episode-v141'],
    goalLineageHash: hash('c'),
    snapshotCompleteness: 1,
    contentHash: hashCanonicalEvidenceJson({ episodeId: 'episode-v141', revision: 1 }),
  });
  const replayCaseSource = buildRuntimeSourceArtifact({
    sourceTable: 'artifact_replay_case',
    sourceRecordId: replayCase.replayCaseId,
    sourceVersion: 1,
    value: replayCase as unknown as EvidenceJsonValue,
  });
  await pool.query(
    `INSERT INTO artifact_replay_case(
       replay_case_id,tenant_id,task_type_id,primary_source_episode_id,content,fixture,
       content_hash,snapshot_completeness,created_at)
     VALUES($1,$2,$3,'episode-v141',$4::jsonb,$5::jsonb,$6,1,$7)`,
    [
      replayCase.replayCaseId,
      replayCase.tenantId,
      replayCase.taskTypeId,
      JSON.stringify(replayCase),
      JSON.stringify({
        provider: 'ReplayNoPhysicalProvider',
        physicalAdapterInvocationCount: 0,
      }),
      replayCase.contentHash,
      at,
    ],
  );
  const dataset = createReplayDatasetManifest({
    datasetId: 'dataset-v141',
    datasetVersion: 1,
    purpose: 'promotion_holdout',
    tenantId: 'tenant-v141',
    taskTypeIds: ['task-type-v141'],
    caseRefs: [replayCase.replayCaseId],
    splitPolicyVersion: 'split-policy-v141',
    sourceRange: { from: at, to: at },
    sourceHash: replayCaseSource.artifactRef.sha256,
    contentHash: hashCanonicalEvidenceJson({
      replayCaseArtifactRef: replayCaseSource.artifactRef.uri,
      ordinal: 0,
    }),
    leakageCheckRef: 'leakage-v141',
    createdAt: at,
  });
  await pool.query(
    `INSERT INTO replay_dataset_manifest(
       dataset_id,dataset_version,purpose,tenant_id,content,source_hash,content_hash,
       leakage_check_ref,promotion_eligible,created_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,true,$9)`,
    [
      dataset.datasetId,
      dataset.datasetVersion,
      dataset.purpose,
      dataset.tenantId,
      JSON.stringify(dataset),
      dataset.sourceHash,
      dataset.contentHash,
      dataset.leakageCheckRef,
      dataset.createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO replay_dataset_case(dataset_id,dataset_version,replay_case_id,ordinal)
     VALUES('dataset-v141',1,'replay-case-v141',0)`,
  );
  const validationRun = createArtifactValidationRun({
    validationRunId: 'validation-v141',
    artifactId: compiledArtifact.artifactId,
    artifactVersion: compiledArtifact.version,
    validationType: 'replay',
    datasetRef: dataset.datasetId,
    status: 'passed',
    result: 'passed',
    metrics: { goal_satisfaction: 0.97, side_effect_attempt_count: 0 },
    counterexampleRefs: ['counterexample-v141'],
    startedAt: at,
    completedAt: '2026-08-04T03:03:00.000Z',
  });
  const validationResultHash = hashCanonicalEvidenceJson({
    validationRunId: validationRun.validationRunId,
    artifactHash: compiledArtifact.contentHash,
    datasetHash: dataset.contentHash,
    status: validationRun.status,
    counterexampleRefs: validationRun.counterexampleRefs,
  });
  const validationResult = createArtifactValidationResult({
    validationRunId: validationRun.validationRunId,
    artifactRef: `${compiledArtifact.artifactId}:v${String(compiledArtifact.version)}`,
    datasetRef: `${dataset.datasetId}:v${String(dataset.datasetVersion)}`,
    validationType: 'replay',
    metrics: validationRun.metrics,
    failureRefs: ['failure-v141'],
    counterexampleRefs: validationRun.counterexampleRefs,
    unsafe: false,
    result: 'passed',
    validatorVersion: 'validator/1.2',
    metricCatalogVersion: 'metrics/1.2',
    artifactHash: compiledArtifact.contentHash,
    datasetHash: dataset.contentHash,
    resultHash: validationResultHash,
    replaySafety: {
      provider: 'ReplayNoPhysicalProvider',
      physicalAdapterInvocationCount: 0,
      sideEffectAttemptCount: 0,
      deniedBeforePhysicalBoundaryCount: 0,
      denialEvidenceRefs: [],
      physicalOutcomeClaim: 'none',
    },
    completedAt: validationRun.completedAt ?? at,
  });
  await pool.query(
    `INSERT INTO artifact_validation_run(
       validation_run_id,artifact_id,artifact_version,validation_type,dataset_ref,status,result,
       metrics,counterexample_refs,started_at,completed_at,tenant_id,dataset_version,artifact_hash,
       dataset_hash,validator_version,metric_catalog_version,result_hash,result_payload,
       promotion_eligible,work_state,attempt,max_attempts,available_at,idempotency_key,
       created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,'tenant-v141',$12,$13,$14,
       $15,$16,$17,$18::jsonb,true,'completed',1,5,$10,$1,$10,$11)`,
    [
      validationRun.validationRunId,
      validationRun.artifactId,
      validationRun.artifactVersion,
      validationRun.validationType,
      validationRun.datasetRef,
      validationRun.status,
      validationRun.result,
      JSON.stringify(validationRun.metrics),
      JSON.stringify(validationRun.counterexampleRefs),
      validationRun.startedAt,
      validationResult.completedAt,
      dataset.datasetVersion,
      compiledArtifact.contentHash,
      dataset.contentHash,
      validationResult.validatorVersion,
      validationResult.metricCatalogVersion,
      validationResult.resultHash,
      JSON.stringify(validationResult),
    ],
  );
  const caseEvaluation = { passed: true, outcomeStatus: 'succeeded' };
  const caseMetrics = { goal_satisfaction: 0.97, side_effect_attempt_count: 0 };
  await pool.query(
    `INSERT INTO artifact_replay_case_result(
       validation_run_id,replay_case_id,evaluation,metrics,result_hash,created_at)
     VALUES('validation-v141','replay-case-v141',$1::jsonb,$2::jsonb,$3,$4)`,
    [
      JSON.stringify(caseEvaluation),
      JSON.stringify(caseMetrics),
      hashCanonicalEvidenceJson({ evaluation: caseEvaluation, metrics: caseMetrics }),
      validationResult.completedAt,
    ],
  );
  await pool.query(
    `INSERT INTO artifact_validation_failure(
       failure_id,validation_run_id,replay_case_id,category,severity,content,created_at)
     VALUES('failure-v141','validation-v141','replay-case-v141','outcome_regression','minor',
       '{"preserved":true}'::jsonb,$1)`,
    [at],
  );
  const counterexample = createArtifactCounterexample({
    counterexampleId: 'counterexample-v141',
    artifactRef: `${compiledArtifact.artifactId}:v${String(compiledArtifact.version)}`,
    replayCaseRef: replayCase.replayCaseId,
    failureRef: 'failure-v141',
    conditionFingerprint: hash('1'),
    environmentClass: 'integration',
    failureBoundaryCandidate: { boundary: 'verification-mismatch', preserved: true },
    sourceRefs: [replayCase.replayCaseId],
    status: 'recorded',
    createdAt: at,
  });
  await pool.query(
    `INSERT INTO artifact_counterexample(
       counterexample_id,artifact_id,artifact_version,replay_case_id,failure_id,
       validation_run_id,content,condition_fingerprint,status,created_at)
     VALUES($1,'artifact-v141',1,'replay-case-v141','failure-v141',
       'validation-v141',$2::jsonb,$3,$4,$5)`,
    [
      counterexample.counterexampleId,
      JSON.stringify(counterexample),
      counterexample.conditionFingerprint,
      counterexample.status,
      counterexample.createdAt,
    ],
  );
  await pool.query(
    `INSERT INTO artifact_match_log(
       match_id,request_id,task_id,candidate_artifact_id,artifact_version,score,applicability,
       decision,reason_codes,policy_snapshot_hash,created_at)
     VALUES('match-v141','task-v141-runtime-core','task-v141-runtime-core','artifact-v141',1,
       $1::jsonb,$2::jsonb,'template_adapt','[]'::jsonb,$3,$4)`,
    [
      JSON.stringify({
        intentScore: 0.95,
        structuredConditionScore: 0.9,
        parameterCoverageScore: 1,
        capabilityShapeScore: 1,
        environmentSimilarityScore: 1,
        validationConfidenceScore: 0.95,
        recentReliabilityScore: 0.9,
        riskPenalty: 0,
        totalScore: 0.95,
      }),
      JSON.stringify({
        artifactRef: 'artifact-v141:v1',
        applicable: true,
        confidence: 0.95,
        satisfiedConditionIds: ['environment.integration'],
        missingConditionIds: [],
        violatedConditionIds: [],
        uncertainConditionIds: [],
        outOfDistribution: false,
        disposition: 'requires_adaptation',
        reasonCodes: ['environment-match'],
      }),
      hash('2'),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO runtime_candidate_decision(
       decision_id,match_id,request_id,path,selected_artifact_ref,parameter_bindings,
       missing_parameters,required_confirmations,reason_codes,matcher_snapshot_hash,
       policy_snapshot_hash,created_at)
     VALUES('retrieval-decision-v141','match-v141','task-v141-runtime-core','template_adapt',
       'artifact-v141:1','{"target":"runtime"}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
       $1,$2,$3)`,
    [hash('d'), hash('2'), at],
  );
  await pool.query(
    `INSERT INTO artifact_execution(
       artifact_execution_id,artifact_id,artifact_version,task_id,goal_id,goal_version,mode,
       decision_snapshot,generated_plan_id,status,started_at,completed_at)
     VALUES('artifact-execution-v141','artifact-v141',1,'task-v141-runtime-core',
       'goal-v141-runtime-core',2,'template',$1::jsonb,'plan-v141-runtime-core','completed',$2,$2)`,
    [JSON.stringify({ retrievalDecisionId: 'retrieval-decision-v141' }), at],
  );
  await pool.query(
    `INSERT INTO artifact_feedback(
       feedback_id,artifact_execution_id,artifact_id,feedback_type,reason_code,summary,impact,
       outcome_ref,created_at)
     VALUES('feedback-v141','artifact-execution-v141','artifact-v141','successful_use',
       'goal_verified','Verified use','{"positive":true}'::jsonb,'outcome-v141-runtime-core',$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO artifact_promotion_policy(
       promotion_policy_version,policy_hash,definition,created_at,created_by)
     VALUES('promotion-policy-v141',$1,'{}'::jsonb,$2,'integration')`,
    [hash('3'), at],
  );
  const counterexampleSummaryHash = hashCanonicalEvidenceJson([counterexample]);
  await pool.query(
    `INSERT INTO artifact_promotion_package(
       promotion_package_id,artifact_id,artifact_version,artifact_ref,artifact_hash,
       validation_summary_ref,validation_summary_hash,shadow_summary_ref,shadow_summary_hash,
       counterexample_summary_ref,counterexample_summary_hash,risk_review_ref,risk_review_hash,
       dependency_snapshot_ref,dependency_snapshot_hash,promotion_policy_version,eligibility,
       content_hash,created_at)
     VALUES('promotion-v141','artifact-v141',1,$1,$2,
       'validation-v141',$3,'shadow-v141',$4,'counterexample-v141',$5,'risk-v141',$6,
       'dependency-v141',$7,'promotion-policy-v141','eligible_for_review',$8,$9)`,
    [
      artifactSource.artifactRef.uri,
      compiledArtifact.contentHash,
      validationResult.resultHash,
      hash('5'),
      counterexampleSummaryHash,
      hash('7'),
      hash('8'),
      hash('9'),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO artifact_promotion_assessment(
       promotion_package_id,coverage,reason_codes,evidence_hash,risk_review_hash,created_at)
     VALUES('promotion-v141','{"complete":true}'::jsonb,'[]'::jsonb,$1,$2,$3)`,
    [hash('a'), hash('7'), at],
  );
}

async function seedLargePatternFacts(count: number) {
  const at = '2026-08-04T05:00:00.000Z';
  const patternId = 'pattern-v141-large';
  const workflowPatternId = 'workflow-pattern-v141-large';
  const traceIds = Object.freeze(
    Array.from(
      { length: count },
      (_, index) => `trace-v141-large-${String(index).padStart(5, '0')}`,
    ),
  );
  const traceSourceHashes = traceIds.map((traceId) =>
    hashSourceArtifactJson({ traceId, sourceEpisodeId: 'episode-v141' }),
  );
  const firstTraceId = traceIds[0];
  const firstTraceSourceHash = traceSourceHashes[0];
  if (firstTraceId === undefined || firstTraceSourceHash === undefined) {
    throw new Error('Large Pattern trace fixture is empty.');
  }
  const traceBody = createExperienceTrace({
    traceId: firstTraceId,
    sourceEpisodeId: 'episode-v141',
    taskTypeRefs: ['task-type-v141-large'],
    goalFingerprint: `sha256:${'1'.repeat(64)}`,
    capabilityFingerprint: `sha256:${'2'.repeat(64)}`,
    environmentFingerprint: `sha256:${'3'.repeat(64)}`,
    trace: {
      schemaVersion: '1.2',
      tenantId: 'tenant-v141',
      events: [
        {
          eventId: 'event-large-support',
          sequence: 0,
          occurredAt: at,
          eventType: 'skill_attempt_completed',
          actorType: 'runtime',
          activity: {
            activityKey: 'inspect_runtime_large',
            activityKind: 'provider_operation',
            objectiveSummary: 'Inspect the large-pattern Runtime support cohort.',
            sourcePlanNodeRef: 'node-v141-large',
            sourceSkillGoalRef: 'step-v141-large',
            sourceAttemptRef: 'attempt-v141-large',
            operationRef: 'server-v141-runtime-core/inspect_runtime_large',
            capabilityRefs: ['capability.inspect-area'],
            effectRefs: ['effect-v141-runtime-core'],
          },
          capabilityRefs: ['capability.inspect-area'],
          authorityRefs: ['runtime-postgresql:experience_trace'],
          parentEventRefs: [],
          payloadSummary: { outcome: 'observed' },
        },
      ],
      correctionRefs: [],
      outcomeRef: 'outcome-v141-runtime-core',
      outcomeStatus: 'succeeded',
      missingFactCodes: [],
      environmentClass: 'integration',
    },
    completeness: 1,
    dataClassification: 'internal',
    normalizerVersion: 'sdar-experience-normalizer/1.2',
    sourceHash: firstTraceSourceHash,
    createdAt: at,
  }).trace;

  await pool.query(
    `INSERT INTO experience_trace(
       trace_id,source_episode_id,task_type_refs,goal_fingerprint,capability_fingerprint,
       environment_fingerprint,trace,completeness,created_at)
     SELECT input.trace_id,'episode-v141','["task-type-v141-large"]'::jsonb,
       $2,$3,$4,$5::jsonb,1,$6
     FROM unnest($1::text[]) AS input(trace_id)`,
    [
      traceIds,
      `sha256:${'1'.repeat(64)}`,
      `sha256:${'2'.repeat(64)}`,
      `sha256:${'3'.repeat(64)}`,
      JSON.stringify(traceBody),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO experience_trace_source(
       trace_id,source_episode_id,tenant_id,user_scope_id,normalizer_version,source_hash,
       data_classification,redaction_codes,created_at)
     SELECT input.trace_id,'episode-v141','tenant-v141',NULL,
       'sdar-experience-normalizer/1.2',input.source_hash,'internal','[]'::jsonb,$3
     FROM unnest($1::text[],$2::text[]) AS input(trace_id,source_hash)`,
    [traceIds, traceSourceHashes, at],
  );

  const runtimeEpisode = await pool.query<{ record_id: string }>(
    `SELECT record_id FROM evidence_outbox
     WHERE record_type='runtime.episode' AND source_record_id='task-v141-runtime-core'
     ORDER BY sequence DESC LIMIT 1`,
  );
  const runtimeEpisodeRecordId = runtimeEpisode.rows[0]?.record_id;
  if (runtimeEpisodeRecordId === undefined) {
    throw new Error('Large Pattern fixture requires the projected Runtime episode.');
  }
  const supportingEvidence = traceIds.map((traceId) =>
    createCatalogEvidenceEnvelope({
      sourceRecordId: traceId,
      sourceRevision: hashSourceArtifactJson({ traceId, revision: 1 }),
      recordType: 'experience.trace',
      environment: 'integration',
      tenantId: 'tenant-v141',
      correlationId: `large-pattern:${patternId}`,
      occurredAt: at,
      recordedAt: at,
      evidenceRefs: [runtimeEpisodeRecordId],
      artifactRefs: [],
      payload: {
        traceId,
        sourceEpisodeId: 'episode-v141',
        taskTypeRefs: ['task-type-v141-large'],
        goalFingerprint: `sha256:${'1'.repeat(64)}`,
        capabilityFingerprint: `sha256:${'2'.repeat(64)}`,
        environmentFingerprint: `sha256:${'3'.repeat(64)}`,
        completeness: 1,
        dataClassification: 'internal',
        redactionCodes: [],
        normalizerVersion: 'sdar-experience-normalizer/1.2',
        sourceHash: hashSourceArtifactJson({ traceId, sourceEpisodeId: 'episode-v141' }),
        traceBody: {
          schemaVersion: '1.2',
          tenantId: 'tenant-v141',
          eventRecordIds: [],
          correctionRefs: [],
          outcomeRef: 'outcome-v141-runtime-core',
          outcomeStatus: 'succeeded',
          missingFactCodes: [],
          environmentClass: 'integration',
          deviceClass: null,
        },
      },
    }),
  );
  await pool.query(
    `INSERT INTO evidence_outbox(
       record_id,record_family,record_type,schema_name,schema_version,source_system,source_table,
       source_record_id,source_revision,source_partition,tenant_id,environment,correlation_id,
       delivery_guarantee,evaluation_role,occurred_at,recorded_at,evidence_refs,artifact_refs,
       payload,payload_hash,captured_at,next_attempt_at,acknowledged_at)
     SELECT input.record_id,'experience','experience.trace','sdar.evidence.experience.trace',1,
       'runtime','experience_trace',input.source_record_id,input.source_revision,
       'phase8-large-pattern-support','tenant-v141','integration',$7,'durable_projection',
       'required',$6,$6,jsonb_build_array($8::text),'[]'::jsonb,input.payload_json::jsonb,
       input.payload_hash,$6,$6,$6
     FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[])
       AS input(record_id,source_record_id,source_revision,payload_json,payload_hash)`,
    [
      supportingEvidence.map((envelope) => envelope.recordId),
      supportingEvidence.map((envelope) => envelope.sourceRecordId),
      supportingEvidence.map((envelope) => envelope.sourceRevision),
      supportingEvidence.map((envelope) => canonicalizeEvidenceJson(envelope.payload)),
      supportingEvidence.map((envelope) => envelope.payloadHash),
      at,
      `large-pattern:${patternId}`,
      runtimeEpisodeRecordId,
    ],
  );

  const cohort = createCohortDefinition({
    tenantId: 'tenant-v141',
    taskTypeId: 'task-type-v141-large',
    environmentClass: 'integration',
    minimumCompleteness: 1,
  });
  const quality = Object.freeze({
    supportCount: count,
    totalTraceCount: count,
    supportRate: 1,
    successRate: 1,
    traceCoverage: 1,
    fitness: 1,
    precisionProxy: 1,
    environmentCoverage: 1,
    contradictionRate: 0,
    generalization: 1,
    mandatoryThreshold: 1,
  });
  const variant = createProcessVariant({
    variantId: 'variant-v141-large',
    activitySequence: ['inspect_runtime_large'],
    activityKindSequence: ['provider_operation'],
    concurrencyGroups: [],
    branchSequence: [],
    occurrenceCount: count,
    traceRefs: traceIds,
    successCount: count,
    failureCount: 0,
  });
  const discoveredPattern = createDiscoveredProcessPattern({
    patternId,
    cohortFingerprint: hashSourceArtifactJson(cohort as unknown as EvidenceJsonValue),
    algorithmVersion: 'sdar-deterministic-process-miner/1.2',
    mandatoryActivities: ['inspect_runtime_large'],
    optionalActivities: [],
    orderingConstraints: [],
    parallelCandidates: [],
    recoveryBranches: [],
    failureVariants: [],
    supportRefs: traceIds,
    contradictionRefs: [],
    environmentCoverage: ['integration'],
    quality,
  });
  const workflowPattern = createWorkflowPattern({
    workflowPatternId,
    taskTypeId: 'task-type-v141-large',
    activityPatterns: [
      {
        activityKey: 'inspect_runtime_large',
        activityKind: 'provider_operation',
        objectiveSummary: 'Inspect the large-pattern Runtime support cohort.',
        required: true,
        supportCount: count,
        supportRate: 1,
        capabilityRefs: ['capability.inspect-area'],
        effectRefs: ['effect-v141-runtime-core'],
        lifecycleEventTypes: ['skill_attempt_completed'],
      },
    ],
    dependencyPatterns: [
      {
        predecessorActivityKey: 'inspect_runtime_large',
        successorActivityKey: 'inspect_runtime_large',
        relation: 'conditional',
        condition: {
          type: 'atomic',
          field: 'context.rule',
          operator: 'eq',
          value: { '😀': 'emoji', 中: 'han', é: 'accent' },
        },
        supportRefs: traceIds,
        contradictionRefs: [],
      },
    ],
    recoveryPatterns: [],
    sourcePatternRef: patternId,
    sourceTraceRefs: traceIds,
    quality,
  });
  const definition = {
    schemaVersion: '1.2',
    cohort,
    variants: [variant],
    discoveredPattern,
    workflowPattern,
  } as const;
  const serialized = canonicalizeSourceArtifactJson(definition as unknown as EvidenceJsonValue);
  const envelope = {
    schemaVersion: '1.2',
    encoding: 'br+base64',
    contentHash: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    uncompressedBytes: Buffer.byteLength(serialized),
    workflowPatternId,
    supportCount: count,
    contradictionCount: 0,
    payload: brotliCompressSync(serialized).toString('base64'),
  };
  await pool.query(
    `INSERT INTO pattern_candidate(
       pattern_id,pattern_type,cohort_fingerprint,definition,support_refs,contradiction_refs,
       confidence,status,created_at)
     VALUES($1,'workflow_pattern',$2,$3::jsonb,$4::jsonb,'[]'::jsonb,1,'discovered',$5)`,
    [
      patternId,
      discoveredPattern.cohortFingerprint,
      JSON.stringify(envelope),
      JSON.stringify(traceIds.slice(0, 4096)),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO pattern_candidate_support(pattern_id,trace_id,tenant_id,support_kind,created_at)
     SELECT $1,input.trace_id,'tenant-v141','support',$3
     FROM unnest($2::text[]) AS input(trace_id)`,
    [patternId, traceIds, at],
  );
  await pool.query(
    `INSERT INTO compilation_run(
       run_id,run_type,source_episode_id,tenant_id,user_scope_id,cohort_fingerprint,status,
       attempt,max_attempts,available_at,idempotency_key,payload,result_ref,created_at,updated_at)
     VALUES('process-mining-run-v141-large','process_mining',NULL,'tenant-v141',NULL,$1,
       'completed',1,5,$2,'process-mining-run-v141-large',$3::jsonb,$4,$2,$2)`,
    [
      discoveredPattern.cohortFingerprint,
      at,
      JSON.stringify({ algorithmVersion: 'sdar-deterministic-process-miner/1.2' }),
      workflowPatternId,
    ],
  );
  const artifact = buildRuntimeSourceArtifact({
    sourceTable: 'pattern_candidate',
    sourceRecordId: patternId,
    sourceVersion: 1,
    value: definition as unknown as EvidenceJsonValue,
  });
  return Object.freeze({ patternId, workflowPatternId, traceIds, artifact });
}

async function seedLateExperienceInteraction(): Promise<void> {
  const at = '2026-08-04T03:05:00.000Z';
  await pool.query(
    `INSERT INTO planning_interaction_episode(
       episode_id,task_id,revision,episode_hash,completeness,snapshot,created_at,goal_id,
       goal_version,tenant_id,user_id,original_request,outcome_ref,counterexample_refs,
       induction_fingerprint,source_refs)
     VALUES('interaction-late-v141','task-v141-runtime-core',2,$1,1,$2::jsonb,$3,
       'goal-v141-runtime-core',2,'tenant-v141','user-v141-runtime-core',
       'Inspect runtime after the initial projection checkpoint','outcome-v141-runtime-core',
       '["counterexample-v141"]'::jsonb,$4,$5::jsonb)`,
    [
      hashCanonicalEvidenceJson({ taskId: 'task-v141-runtime-core', revision: 2 }),
      JSON.stringify({
        lateArrival: true,
        sourceEpisodeId: 'episode-v141',
        correctionIds: ['correction-v141'],
      }),
      at,
      hashCanonicalEvidenceJson({ taskTypeId: 'task-type-v141', lateArrival: true }),
      JSON.stringify([
        {
          schemaVersion: '1.0',
          sourceRefId: 'late-interaction-task-source-v141',
          sourceKind: 'task_request',
          sourceId: 'task-v141-runtime-core',
          sourceRevision: 1,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          capturedAt: at,
        },
        {
          schemaVersion: '1.0',
          sourceRefId: 'late-interaction-episode-source-v141',
          sourceKind: 'goal_experience_episode',
          sourceId: 'episode-v141',
          sourceRevision: 1,
          authority: 'runtime_fact',
          dataClassification: 'user_scoped',
          capturedAt: at,
        },
      ]),
    ],
  );
}

function planTemplateEvidenceDefinition(): PlanTemplateArtifactDefinition {
  return {
    goalPattern: {
      objectiveTemplate: 'Inspect {{target}}.',
      criterionTemplates: [
        {
          criterionTemplateId: 'criterion.runtime-inspected',
          statementTemplate: 'Structured Runtime evidence was inspected and verified.',
          required: true,
        },
      ],
    },
    parameterSchema: {
      type: 'object',
      required: ['target'],
      properties: { target: { type: 'string' } },
    },
    parameterBindings: [
      {
        parameterName: 'target',
        schema: { type: 'string' },
        required: true,
        allowedSources: 'user_confirmed',
        trustLevel: 'authoritative',
        defaultPolicy: 'none',
      },
    ],
    skillGoalGraph: {
      nodes: [
        {
          nodeKey: 'inspect_runtime',
          nodeType: 'observation',
          objectiveTemplate: 'Inspect {{target}} without physical side effects.',
          requiredCapabilities: ['capability.inspect-area'],
          requiredEffectRefs: ['effect-v141-runtime-core'],
          coveredCriterionTemplateIds: ['criterion.runtime-inspected'],
          evidenceRequirements: ['evidence.runtime-state'],
          artifactRequirements: [],
          inputTemplate: { target: '{{target}}' },
          assumptionsAllowed: [],
          constraints: ['No physical side effects.'],
        },
      ],
      dependencies: [],
    },
    completionContractTemplate: {
      titleTemplate: 'Runtime inspection complete',
      descriptionTemplate: 'The requested Runtime target was inspected and verified.',
      criteria: [
        {
          criterionTemplateId: 'criterion.runtime-inspected',
          statementTemplate: 'Structured Runtime evidence was inspected and verified.',
          required: true,
        },
      ],
      evidenceRequirements: ['evidence.runtime-state'],
      artifactRequirements: [],
    },
    recoveryBranches: [],
  };
}

async function seedMcpCapabilityFacts(): Promise<void> {
  const at = '2026-08-04T03:00:30.000Z';
  const later = '2026-08-04T03:01:30.000Z';
  await pool.query(
    `INSERT INTO task_availability_snapshot(
       snapshot_id,readiness_id,node_id,server_id,operation_name,arguments_snapshot_json,
       arguments_hash,result_json,availability,risk_level,reservation_mode,source_revision,
       checked_at,normalization_reason_codes_json)
     VALUES('availability-v141-runtime-core','gate-v141-runtime-core','node-v141-runtime-core',
       'server-v141-runtime-core','inspect_runtime','{"target":"runtime"}',$1,
       '{"available":true}','available','low','none','provider-revision-1',$2,'[]')`,
    ['3'.repeat(64), at],
  );
  await pool.query(
    `INSERT INTO remote_task_binding(
       binding_id,server_id,operation_name,remote_task_id,agent_task_id,context_id,goal_id,
       goal_version,workflow_plan_id,workflow_definition_id,workflow_definition_version,
       workflow_instance_id,workflow_node_id,workflow_node_run_id,mcp_invocation_id,
       protocol_status,protocol_revision,tasks_schema_revision,last_provider_updated_at,
       local_state,execution_mode,credential_revision,session_revision,poll_interval_ms,
       created_at,updated_at,task_behavior,task_cancellation,runtime_revision)
     VALUES('remote-v141-runtime-core','server-v141-runtime-core','inspect_runtime',
       'provider-task-v141','task-v141-runtime-core','context-v141-runtime-core',
       'goal-v141-runtime-core',2,'plan-v141-runtime-core','workflow-v141-runtime-core',1,
       'instance-v141-runtime-core','node-v141-runtime-core','node-run-v141',
       'invocation-v141-runtime-core','working','2026-07-28','2026-07-28',$1,'polling',
       'live','credential-1','session-1',1000,$1,$1,'task_required','task_cancel','2')`,
    [at],
  );
  await pool.query(
    `INSERT INTO remote_task_observation(
       observation_id,binding_id,sequence,observation_type,payload_json,accepted,observed_at,
       observation_source,runtime_revision,provider_revision)
     VALUES('observation-v141-runtime-core','remote-v141-runtime-core',1,'task.snapshot',
       '{"status":"working"}',true,$1,'reconciliation','2','provider-2')`,
    [at],
  );
  await pool.query(
    `INSERT INTO remote_task_control_event(
       event_id,binding_id,event_type,remote_revision,result_hash,payload_json,status,created_at,
       runtime_revision)
     VALUES('control-event-v141-runtime-core','remote-v141-runtime-core','task.input_required',
       'provider-2',$1,'{"request":"approval"}','pending',$2,'2')`,
    ['4'.repeat(64), at],
  );
  await pool.query(
    `INSERT INTO remote_task_protocol_attempt(
       attempt_id,binding_id,method,expected_binding_version,protocol_revision,status,
       started_at,completed_at,duration_ms)
     VALUES('poll-v141-runtime-core','remote-v141-runtime-core','tasks/get',1,'2026-07-28',
       'succeeded',$1,$1,0)`,
    [at],
  );
  await pool.query(
    `INSERT INTO task_input_request(
       input_request_id,task_id,context_id,source,question,status,created_at)
     VALUES('input-v141-runtime-core','task-v141-runtime-core','context-v141-runtime-core',
       'workflow','Approve remote Task continuation?','waiting',$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO remote_task_input_link(
       input_request_id,control_event_id,binding_id,remote_task_id,workflow_instance_id,
       workflow_node_id,workflow_node_run_id,remote_revision,result_hash,input_requests_json,
       status,created_at,updated_at)
     VALUES('input-v141-runtime-core','control-event-v141-runtime-core',
       'remote-v141-runtime-core','provider-task-v141','instance-v141-runtime-core',
       'node-v141-runtime-core','node-run-v141','provider-2',$1,'[{"id":"approval"}]',
       'waiting',$2,$2)`,
    ['4'.repeat(64), at],
  );
  await pool.query(
    `INSERT INTO remote_task_cancel_request(
       cancel_request_id,binding_id,idempotency_key,source,reason_code,summary,delivery_status,
       requested_at,updated_at)
     VALUES('cancel-v141-runtime-core','remote-v141-runtime-core','cancel-key-v141','task',
       'user_requested','Cancel requested','uncertain',$1,$1)`,
    [at],
  );
  await pool.query(
    `INSERT INTO workflow_continuation_snapshot(
       snapshot_id,continuation_id,state_version,schema_version,lifecycle,agent_task_id,context_id,
       workflow_control_id,goal_id,goal_version,workflow_plan_id,workflow_definition_id,
       workflow_definition_version,workflow_definition_hash,input_hash,workflow_instance_id,
       state_json,created_at,updated_at)
     VALUES('continuation-v141-runtime-core','continuation-id-v141',1,'1.0','active',
       'task-v141-runtime-core','context-v141-runtime-core','control-v141-runtime-core',
       'goal-v141-runtime-core',2,'plan-v141-runtime-core','workflow-v141-runtime-core',1,
       $1,$2,'instance-v141-runtime-core','{"resumeNode":"node-v141-runtime-core"}',$3,$3)`,
    ['5'.repeat(64), '6'.repeat(64), at],
  );
  await pool.query(
    `INSERT INTO workflow_continuation_wait_binding(
       snapshot_id,wait_id,binding_id,wait_kind,node_id,node_run_id,wait_state)
     VALUES('continuation-v141-runtime-core','wait-v141','remote-v141-runtime-core',
       'remote_task','node-v141-runtime-core','node-run-v141','awaiting_input')`,
  );
  await pool.query(
    `INSERT INTO workflow_continuation_attempt(
       attempt_id,event_id,snapshot_id,continuation_id,workflow_instance_id,
       snapshot_state_version,claim_token,status,created_at,started_at,completed_at)
     VALUES('continuation-attempt-v141','control-event-v141-runtime-core',
       'continuation-v141-runtime-core','continuation-id-v141','instance-v141-runtime-core',1,
       'claim-v141','succeeded',$1,$1,$2)`,
    [at, later],
  );
  await pool.query(
    `INSERT INTO capability_readiness_snapshot(
       capability_id,capability_version,snapshot_version,status,raw_status,evaluated_at,valid_until,
       catalog_hash,policy_hash,snapshot_hash,reasons,available_implementations,
       unavailable_implementations,evaluation_input,trigger_reason)
     VALUES('capability.inspect-area',1,1,'available','available',$1,$2,$3,$4,$5,'[]',
       '["skill-v141-runtime-core@1"]','[]','{}','integration')`,
    [at, later, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`],
  );
  await pool.query(
    `INSERT INTO task_capability_execution_attempt(
       attempt_id,task_id,capability_binding_id,attempt_no,plan_id,skill_version_refs,
       provider_binding_refs,reason,status,started_at,completed_at)
     VALUES('capability-attempt-v141','task-v141-runtime-core','binding-v141-runtime-core',1,
       'plan-v141-runtime-core','[{"skillId":"skill-v141-runtime-core","version":1}]',
       '[{"providerId":"server-v141-runtime-core"}]','initial','succeeded',$1,$2)`,
    [at, later],
  );
  await pool.query(
    `INSERT INTO runtime_agent_card_revision(
       revision,node_id,exposure_refs,content_hash,capability_catalog_hash,status,card,generated_at,
       activated_at)
     VALUES(1,'node-v141','["exposure-v141"]',$1,$2,'active',$3::jsonb,$4,$4)`,
    [
      'd'.repeat(64),
      'e'.repeat(64),
      JSON.stringify({
        name: 'SDAR',
        description: 'Canonical Evidence integration fixture.',
        supportedInterfaces: [
          {
            url: 'http://127.0.0.1:3000/a2a',
            protocolBinding: 'HTTP+JSON',
            tenant: '',
            protocolVersion: '1.0',
          },
        ],
        version: '1.4.1',
        capabilities: { streaming: true, pushNotifications: false, extensions: [] },
        securitySchemes: {},
        securityRequirements: [],
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain', 'application/json'],
        skills: [],
        signatures: [],
      }),
      at,
    ],
  );
  await pool.query(
    `INSERT INTO runtime_agent_card_exposure_snapshot(
       revision,exposure_id,exposure_version,capability_id,capability_version,agent_skill_id,
       request_schema,result_schema,exposure_hash)
     VALUES(1,'exposure-v141',1,'capability.inspect-area',1,'skill-v141-runtime-core',
       '{"type":"object"}','{"type":"object"}',$1)`,
    ['f'.repeat(64)],
  );
}

async function seedSkillPrerequisiteEvidence(): Promise<void> {
  const occurredAt = '2026-08-04T04:15:00.000Z';
  const capability = createCatalogEvidenceEnvelope({
    recordType: 'capability.definition',
    sourceRecordId: 'capability.inspect-area:1',
    sourceRevision: hashCanonicalEvidenceJson({ version: 1, definitionHash: '7'.repeat(64) }),
    environment: 'integration',
    correlationId: 'capability.inspect-area',
    occurredAt,
    recordedAt: occurredAt,
    payload: {
      capabilityId: 'capability.inspect-area',
      version: 1,
      definitionHash: '7'.repeat(64),
    },
  });
  await store.append(capability, occurredAt, 'control:capability.inspect-area');
  const runtimeEpisode = record(await evidenceRecords(), 'runtime.episode');
  await store.append(
    createCatalogEvidenceEnvelope({
      recordType: 'capability.task_binding',
      sourceRecordId: 'binding-v141-runtime-core',
      sourceRevision: hashCanonicalEvidenceJson({ bindingHash: '9'.repeat(64) }),
      environment: 'integration',
      correlationId: 'task-v141-runtime-core',
      occurredAt,
      recordedAt: occurredAt,
      taskId: 'task-v141-runtime-core',
      contextId: 'context-v141-runtime-core',
      episodeId: 'task-v141-runtime-core',
      evidenceRefs: [capability.recordId, runtimeEpisode.recordId],
      payload: {
        bindingId: 'binding-v141-runtime-core',
        taskId: 'task-v141-runtime-core',
        bindingHash: '9'.repeat(64),
      },
    }),
    occurredAt,
    'capability:task-v141-runtime-core',
  );
}

async function seedRuntimeCoreEpisode(): Promise<void> {
  await pool.query(
    `TRUNCATE capability_readiness_snapshot,task_capability_execution_attempt,
      runtime_agent_card_revision,mcp_invocation,skill_execution_record,skill_selection_record,
      skill_input_resolution,task_capability_binding,skill_version,skill,
      conversation_context,evidence_export_configuration,evidence_outbox,
      evidence_source_checkpoint,evidence_export_state,evidence_dead_letter,
      evidence_projection_issue,evidence_quality_issue,episode_evidence_manifest
      RESTART IDENTITY CASCADE`,
  );
  const created = '2026-08-04T03:00:00.000Z';
  const completed = '2026-08-04T03:01:00.000Z';
  const hash = (character: string): string => `sha256:${character.repeat(64)}`;

  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-v141-runtime-core','user-v141-runtime-core',$1,$2)`,
    [created, completed],
  );
  const usageSpecification = (
    sourceFormat: 'native' | 'legacy',
    capabilitySlots: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, unknown>> => ({
    apiVersion: 'sdar.io/v1alpha1',
    sourceFormat,
    visibility: { userSelectable: true, composable: true, internalOnly: false },
    normative: {
      constraints: [],
      forbiddenActions: [],
      requiredConfirmations: [],
      noApplicableSkill: 'reject',
    },
    adaptive: {
      instructions: [],
      optimizationHints: [],
      allowPreferredProviderFallback: false,
    },
    contextRequirements: [],
    modes: {
      supported: ['procedure'],
      defaultMode: 'procedure',
      procedure: { summary: 'Run the verified procedure.', instructions: ['Record evidence.'] },
    },
    taskBindings: [],
    composition: { maxDepth: 3, fixedDependencies: [], capabilitySlots },
    evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
  });
  await pool.query(
    `INSERT INTO goal(goal_id,context_id,version,title,description,constraints_json,
       success_criteria_json,status,created_at,updated_at)
     VALUES('goal-v141-runtime-core','context-v141-runtime-core',2,'Inspect runtime',
       'Inspect and verify the runtime','[]','[]','achieved',$1,$2)`,
    [created, completed],
  );
  await pool.query(
    `INSERT INTO user_goal_contract(goal_id,goal_version,schema_version,contract_hash,
       contract_json,created_at)
     VALUES('goal-v141-runtime-core',2,'1.0',$1,$2::jsonb,$3)`,
    [hash('a'), JSON.stringify({ goalId: 'goal-v141-runtime-core', goalVersion: 2 }), created],
  );
  await pool.query(
    `INSERT INTO user_goal_plan(plan_id,goal_id,goal_version,revision,revision_kind,source_plan_id,
       status,contract_hash,content_hash,plan_json,created_at,updated_at)
     VALUES
       ('plan-v141-old','goal-v141-runtime-core',2,1,'initial',NULL,'superseded',$1,$2,$3::jsonb,$4,$5),
       ('plan-v141-runtime-core','goal-v141-runtime-core',2,2,'goal_patch','plan-v141-old',
        'completed',$1,$6,$7::jsonb,$4,$5)`,
    [
      hash('a'),
      hash('b'),
      JSON.stringify({ planId: 'plan-v141-old', skillGoals: [] }),
      created,
      completed,
      hash('c'),
      JSON.stringify({ planId: 'plan-v141-runtime-core', skillGoals: ['step-v141-runtime-core'] }),
    ],
  );
  await pool.query(
    `INSERT INTO skill_goal(skill_goal_id,plan_id,ordinal,status,contract_json,created_at,updated_at)
     VALUES('step-v141-runtime-core','plan-v141-runtime-core',1,'achieved',$1::jsonb,$2,$3)`,
    [JSON.stringify({ activityKey: 'inspect_runtime' }), created, completed],
  );
  await pool.query(
    `INSERT INTO skill_attempt(attempt_id,plan_id,skill_goal_id,ordinal,status,
       strategy_fingerprint,attempt_json,created_at,updated_at)
     VALUES('attempt-v141-runtime-core','plan-v141-runtime-core','step-v141-runtime-core',1,
       'achieved',$1,$2::jsonb,$3,$4)`,
    [hash('f'), JSON.stringify({ strategy: 'registered_skill' }), created, completed],
  );
  await pool.query(
    `INSERT INTO agent_task(task_id,context_id,user_id,phase,phase_message,goal_id,goal_version,
       created_at,updated_at,request_text,request_metadata,user_goal_plan_id,skill_goal_id,
       skill_attempt_id)
     VALUES('task-v141-runtime-core','context-v141-runtime-core','user-v141-runtime-core',
       'completed','Completed','goal-v141-runtime-core',2,$1,$2,'Inspect runtime',
       $3::jsonb,'plan-v141-runtime-core','step-v141-runtime-core','attempt-v141-runtime-core')`,
    [created, completed, JSON.stringify({ protocol: 'a2a' })],
  );
  await pool.query(
    `INSERT INTO goal_patch(patch_id,goal_id,from_version,to_version,instruction,changes_json,
       decision_summary,compensation_warnings_json,invalidated_plan_ids_json,
       invalidated_instance_ids_json,new_plan_id,before_goal_json,after_goal_json,created_at,
       triggering_task_id)
     VALUES('patch-v141-runtime-core','goal-v141-runtime-core',1,2,'Add verification',$1::jsonb,
       'Accepted patch','[]',$2::jsonb,'[]','plan-v141-runtime-core',$3::jsonb,$4::jsonb,$5,
       'task-v141-runtime-core')`,
    [
      JSON.stringify([{ op: 'add', path: '/successCriteria/0', value: 'verified' }]),
      JSON.stringify(['plan-v141-old']),
      JSON.stringify({ goalId: 'goal-v141-runtime-core', version: 1 }),
      JSON.stringify({ goalId: 'goal-v141-runtime-core', version: 2 }),
      created,
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan(plan_id,goal_id,goal_version,definition_json,confirmation_status,
       attempt_count,created_at,confirmation_task_id,confirmed_at,goal_contract_json,skill_goal_id,
       skill_attempt_id)
     VALUES('plan-v141-runtime-core','goal-v141-runtime-core',2,$1::jsonb,'confirmed',1,$2,
       'task-v141-runtime-core',$2,$3::jsonb,'step-v141-runtime-core','attempt-v141-runtime-core')`,
    [
      JSON.stringify({ nodes: [{ id: 'node-v141-runtime-core' }], edges: [] }),
      created,
      JSON.stringify({ goalId: 'goal-v141-runtime-core', version: 2 }),
    ],
  );
  await pool.query(
    `INSERT INTO skill(skill_id,current_version,created_at,updated_at)
     VALUES
       ('skill-v141-runtime-core',1,$1,$2),
       ('skill-v141-child',1,$1,$2)`,
    [created, completed],
  );
  await pool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,
       runtime_policy_json,status,source_kind,validation_passed,created_at,
       usage_specification_json)
     VALUES
       ('skill-v141-runtime-core',1,'Runtime inspection','Inspect runtime','Inspect runtime',
        '["capability.inspect-area"]'::jsonb,'Inspect runtime','Return verification',
        '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,
        '{"required":[],"optional":[],"forbidden":[]}'::jsonb,'{}'::jsonb,
        'enabled','admin',true,$1,$2::jsonb),
       ('skill-v141-child',1,'Area inspection','Inspect an area','Inspect one patrol area',
        '["capability.inspect-area"]'::jsonb,'Inspect area','Return area evidence',
        '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,
        '{"required":[],"optional":[],"forbidden":[]}'::jsonb,'{}'::jsonb,
        'enabled','admin',true,$1,$3::jsonb)`,
    [
      created,
      JSON.stringify(
        usageSpecification('native', [
          {
            slotId: 'inspect-slot',
            capability: 'capability.inspect-area',
            required: true,
            candidateSkillIds: ['skill-v141-child'],
            failurePolicy: 'degraded',
          },
        ]),
      ),
      JSON.stringify(usageSpecification('legacy', [])),
    ],
  );
  for (const [skillId, specificationHash] of [
    ['skill-v141-runtime-core', `sha256:${'1'.repeat(64)}`],
    ['skill-v141-child', `sha256:${'2'.repeat(64)}`],
  ] as const) {
    await pool.query(
      `INSERT INTO skill_outcome_specification(
         skill_id,skill_version,schema_version,specification_hash,specification_json,created_at)
       VALUES($1,1,'1.0',$2,$3::jsonb,$4)`,
      [
        skillId,
        specificationHash,
        JSON.stringify({
          schemaVersion: '1.0',
          skillId,
          skillVersion: 1,
          effects: ['inspection.completed'],
          evidence: ['inspection.receipt'],
          artifacts: [],
          taskGoalPolicy: { completion: 'verify' },
          confidencePolicy: { minimum: 'high' },
          sideEffectPolicy: { replay: 'forbidden_after_completion' },
          specificationHash,
        }),
        created,
      ],
    );
  }
  const skillPolicy = (
    skillId: string,
    edges: readonly Readonly<Record<string, unknown>>[],
  ): Readonly<Record<string, unknown>> => ({
    skill: { skillId, skillVersion: 1 },
    mode: 'procedure',
    modeDecision: {
      decision: 'template_adapt',
      mode: 'procedure',
      confirmationRequired: false,
      confirmationSatisfied: true,
    },
    constraints: [],
    forbiddenActions: [],
    adaptiveInstructions: [],
    requiredConfirmations: [],
    requiredContextIds: [],
    allowedTools: [],
    taskOperations: [],
    childPolicies: [],
    evidenceRequirements: [
      { requirementId: 'coverage', evidenceType: 'coverage', required: true, hardGate: true },
    ],
    rejectSuccessWithoutRequiredEvidence: true,
    composition: {
      root: { skillId, skillVersion: 1 },
      expandedSkills: [],
      edges,
      maxDepth: 3,
      consumedDepth: edges.length === 0 ? 0 : 1,
      consumedSkills: edges.length + 1,
      consumedNodes: edges.length,
    },
    context: {
      complete: true,
      requirements: [],
      satisfied: 0,
      total: 0,
      inputRequiredIds: [],
      unsatisfiedIds: [],
      unknownIds: [],
    },
    readiness: { overall: 'ready', bindings: [] },
  });
  const skillEdge = {
    edgeId: 'edge-v141-slot',
    kind: 'capability_slot',
    declarationId: 'inspect-slot',
    parent: { skillId: 'skill-v141-runtime-core', skillVersion: 1 },
    child: { skillId: 'skill-v141-child', skillVersion: 1 },
    candidateSet: [{ skillId: 'skill-v141-child', skillVersion: 1 }],
    failurePolicy: 'degraded',
    inputMappings: [],
    outputMappings: [],
    depth: 1,
  };
  await pool.query(
    `INSERT INTO skill_execution_record(
       execution_id,parent_execution_id,task_id,goal_id,goal_version,skill_id,skill_version,
       selection_ref,applicability_status,usage_policy_json,workflow_plan_id,
       workflow_definition_id,workflow_definition_version,created_at)
     VALUES
       ('skill-execution-v141-runtime-core',NULL,'task-v141-runtime-core',
        'goal-v141-runtime-core',2,'skill-v141-runtime-core',1,'selection-v141-runtime-core',
        'satisfied',$2::jsonb,'plan-v141-runtime-core','workflow-v141-runtime-core',1,$1),
       ('skill-execution-v141-child','skill-execution-v141-runtime-core',
        'task-v141-runtime-core','goal-v141-runtime-core',2,'skill-v141-child',1,
        'selection-v141-child','partial',$3::jsonb,'plan-v141-runtime-core',
        'workflow-v141-child',1,$1)`,
    [
      created,
      JSON.stringify(skillPolicy('skill-v141-runtime-core', [skillEdge])),
      JSON.stringify(skillPolicy('skill-v141-child', [])),
    ],
  );
  const usageCandidate = (skillId: string, status: 'satisfied' | 'partial') => ({
    skillId,
    skillVersion: 1,
    applicability: { status, reasonCodes: [], evidenceRefs: [] },
    modeDecision: {
      decision: 'template_adapt',
      mode: 'procedure',
      confirmationRequired: false,
      confirmationSatisfied: true,
      reasonCodes: [],
    },
  });
  const selectionCandidate = (skillId: string, status: 'satisfied' | 'partial') => ({
    skillId,
    skillVersion: 1,
    name: skillId,
    summary: skillId,
    capabilities: ['capability.inspect-area'],
    usageCandidate: usageCandidate(skillId, status),
  });
  await pool.query(
    `INSERT INTO skill_selection_record(
       selection_id,goal_description,candidates_json,selected_skill_id,
       selected_skill_version,decision_summary,created_at,goal_contract_json)
     VALUES
       ('selection-v141-runtime-core','Inspect runtime',$1::jsonb,
        'skill-v141-runtime-core',1,'Selected root Skill',$3,$4::jsonb),
       ('selection-v141-child','Inspect patrol area',$2::jsonb,
        'skill-v141-child',1,'Selected capability-slot child',$3,$4::jsonb)`,
    [
      JSON.stringify([selectionCandidate('skill-v141-runtime-core', 'satisfied')]),
      JSON.stringify([selectionCandidate('skill-v141-child', 'partial')]),
      created,
      JSON.stringify({ goalId: 'goal-v141-runtime-core', version: 2 }),
    ],
  );
  await pool.query(
    `INSERT INTO skill_input_resolution(
       resolution_id,task_id,goal_id,goal_version,skill_id,skill_version,
       structured_input_json,unresolved_fields_json,source_refs_json,decision_summary,
       status,created_at)
     VALUES('resolution-v141-runtime-core','task-v141-runtime-core','goal-v141-runtime-core',2,
       'skill-v141-runtime-core',1,'{"target":"runtime"}'::jsonb,'[]'::jsonb,
       '["context:runtime-map"]'::jsonb,'Resolved from authoritative context','resolved',$1)`,
    [created],
  );
  const eventRows: readonly (readonly [string, string, string, string | null, object, string])[] = [
    [
      'skill-event-v141-mode',
      'skill-execution-v141-runtime-core',
      'skill.mode_selected',
      null,
      { mode: 'procedure' },
      created,
    ],
    [
      'skill-event-v141-child',
      'skill-execution-v141-runtime-core',
      'skill.child_selected',
      null,
      {
        edgeId: 'edge-v141-slot',
        skillId: 'skill-v141-child',
        skillVersion: 1,
        failurePolicy: 'degraded',
      },
      created,
    ],
    [
      'skill-event-v141-procedure',
      'skill-execution-v141-runtime-core',
      'skill.procedure_compiled',
      'planning',
      { workflowDefinitionId: 'workflow-v141-runtime-core', workflowDefinitionVersion: 1 },
      created,
    ],
    [
      'skill-event-v141-compliance-pass',
      'skill-execution-v141-runtime-core',
      'skill.plan_compliance_passed',
      'planning',
      { compliant: true, errors: [] },
      created,
    ],
    [
      'skill-event-v141-wait',
      'skill-execution-v141-child',
      'skill.execution_waiting_external',
      'waiting_external',
      { remoteTaskId: 'remote-v141-child' },
      created,
    ],
    [
      'skill-event-v141-resume',
      'skill-execution-v141-child',
      'skill.execution_started',
      'executing',
      { resumedFrom: 'remote-v141-child' },
      completed,
    ],
    [
      'skill-event-v141-compliance-fail',
      'skill-execution-v141-runtime-core',
      'skill.plan_compliance_failed',
      'planning',
      { errors: ['required evidence unavailable'] },
      completed,
    ],
    [
      'skill-event-v141-failed',
      'skill-execution-v141-child',
      'skill.execution_failed',
      'degraded',
      {
        failureCode: 'INSPECTION_PARTIAL',
        failurePolicy: 'degraded',
        missingEffects: ['coverage.zone-b'],
        missingEvidence: ['image.zone-b'],
      },
      completed,
    ],
    [
      'skill-event-v141-completed',
      'skill-execution-v141-runtime-core',
      'skill.execution_completed',
      'completed',
      {},
      completed,
    ],
  ];
  for (const [eventId, executionId, eventType, statusAfter, details, occurredAt] of eventRows) {
    await pool.query(
      `INSERT INTO skill_execution_event(
         event_id,execution_id,event_type,status_after,summary,details_json,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        eventId,
        executionId,
        eventType,
        statusAfter,
        eventType,
        JSON.stringify(details),
        occurredAt,
      ],
    );
  }
  const referenceKinds = [
    ['provider', 'server-v141-runtime-core', 'task.provider', { operationName: 'inspect_runtime' }],
    ['resource', 'resource-v141-map', 'runtime.resource', { uri: 'urn:runtime:map' }],
    ['remote_task_binding', 'remote-v141-child', 'mcp.remote_task', {}],
    ['evidence', 'evidence-v141-image', 'inspection.image', {}],
    ['hard_gate', 'gate-v141-runtime-core', 'runtime.hard_gate', {}],
    ['human_intervention', 'human-v141-review', 'runtime.human_intervention', {}],
    ['outcome', 'outcome-v141-runtime-core', 'runtime.outcome', {}],
  ] as const;
  for (const [kind, referenceId, referenceType, metadata] of referenceKinds) {
    await pool.query(
      `INSERT INTO skill_execution_reference(
         link_id,execution_id,kind,reference_id,reference_type,source_system,
         producer_refs_json,metadata_json,created_at)
       VALUES($1,'skill-execution-v141-runtime-core',$2,$3,$4,'integration',
         '[]'::jsonb,$5::jsonb,$6)`,
      [
        `reference-v141-${kind}`,
        kind,
        referenceId,
        referenceType,
        JSON.stringify(metadata),
        created,
      ],
    );
  }
  await pool.query(
    `INSERT INTO task_capability_binding(
       binding_id,task_id,requested_capability_id,capability_version,input_snapshot,
       success_criteria_snapshot,evidence_requirement_snapshot,constraint_snapshot,
       initial_implementation_refs,binding_hash,bound_at)
     VALUES('binding-v141-runtime-core','task-v141-runtime-core','capability.inspect-area',1,
       '{"target":"runtime"}'::jsonb,'["inspection verified"]'::jsonb,$1::jsonb,
       '[]'::jsonb,'["skill-v141-runtime-core@1"]'::jsonb,$2,$3)`,
    [
      JSON.stringify([
        {
          requirementId: 'coverage',
          requirementType: 'coverage',
          required: true,
          hardGate: true,
        },
      ]),
      '9'.repeat(64),
      created,
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan_attempt(plan_id,attempt,candidate_json,validation_errors_json,valid,
       created_at,goal_contract_json,skill_goal_id,skill_attempt_id)
     VALUES('plan-v141-runtime-core',1,$1::jsonb,'[]',true,$2,$3::jsonb,
       'step-v141-runtime-core','attempt-v141-runtime-core')`,
    [
      JSON.stringify({ nodes: [{ id: 'node-v141-runtime-core' }], edges: [] }),
      created,
      JSON.stringify({ goalId: 'goal-v141-runtime-core', version: 2 }),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_instance(instance_id,plan_id,workflow_definition_id,workflow_version,
       goal_id,goal_version,status,input_json,result_json,errors_json,started_at,completed_at,
       skill_goal_id,skill_attempt_id)
     VALUES('instance-v141-runtime-core','plan-v141-runtime-core','workflow-v141-runtime-core',1,
       'goal-v141-runtime-core',2,'succeeded','{}',$1::jsonb,'[]',$2,$3,
       'step-v141-runtime-core','attempt-v141-runtime-core')`,
    [JSON.stringify({ inspected: true }), created, completed],
  );
  await pool.query(
    `INSERT INTO workflow_node_event(event_id,instance_id,sequence,node_id,event_type,
       event_timestamp,summary,duration_ms)
     VALUES('event-v141-runtime-core','instance-v141-runtime-core',1,'node-v141-runtime-core',
       'node_succeeded',$1,'Inspected',100)`,
    [completed],
  );
  await pool.query(
    `INSERT INTO workflow_control(control_id,context_id,goal_id,goal_version,task_id,status,
       current_plan_id,input_json,skill_ids_json,planning_instruction,round_count,replan_count,
       final_instance_id,created_at,updated_at)
     VALUES('control-v141-runtime-core','context-v141-runtime-core','goal-v141-runtime-core',2,
       'task-v141-runtime-core','achieved','plan-v141-runtime-core','{}','[]','Inspect',1,0,
       'instance-v141-runtime-core',$1,$2)`,
    [created, completed],
  );
  await pool.query(
    `INSERT INTO workflow_control_round(control_id,round_index,plan_id,instance_id,
       workflow_version,evaluation_decision,evaluation_summary,evaluation_detail_json,created_at)
     VALUES('control-v141-runtime-core',0,'plan-v141-runtime-core','instance-v141-runtime-core',1,
       'achieved','Criteria satisfied',$1::jsonb,$2)`,
    [JSON.stringify({ reasonCodes: ['criteria_satisfied'] }), completed],
  );
  await pool.query(
    `INSERT INTO task_execution_readiness(readiness_id,workflow_plan_id,plan_attempt,check_phase,
       dsl_hash,disposition,permitted_actions_json,guard_action,guard_reason_codes_json,
       confirmation_required,created_at)
     VALUES('gate-v141-runtime-core','plan-v141-runtime-core',1,'planning',$1,'ready','[]',
       'proceed',$2::jsonb,false,$3)`,
    ['d'.repeat(64), JSON.stringify(['confirmed']), created],
  );
  await pool.query(
    `INSERT INTO mcp_invocation(invocation_id,task_id,context_id,server_id,tool_name,
       arguments_json,result_json,status,started_at,completed_at,duration_ms,
       execution_semantics_json,execution_mode)
     VALUES('invocation-v141-runtime-core','task-v141-runtime-core','context-v141-runtime-core',
       'server-v141-runtime-core','inspect_runtime',$1::jsonb,$2::jsonb,'succeeded',$3,$4,100,
       $5::jsonb,'live')`,
    [
      JSON.stringify({ target: 'runtime' }),
      JSON.stringify({ verified: true }),
      created,
      completed,
      JSON.stringify({ effect: 'read' }),
    ],
  );
  await pool.query(
    `INSERT INTO completed_effect(completed_effect_id,goal_id,plan_id,skill_goal_id,status,
       effect_fingerprint,effect_json,created_at)
     VALUES('effect-v141-runtime-core','goal-v141-runtime-core','plan-v141-runtime-core',
       'step-v141-runtime-core','verified',$1,$2::jsonb,$3)`,
    [hash('e'), JSON.stringify({ verified: true }), completed],
  );
  await pool.query(
    `INSERT INTO outcome_decision(outcome_decision_id,level,subject_id,plan_id,status,confidence,
       decision_json,created_at)
     VALUES('decision-v141-runtime-core','user_goal','goal-v141-runtime-core',
       'plan-v141-runtime-core','achieved','high',$1::jsonb,$2)`,
    [JSON.stringify({ criteriaSatisfied: true }), completed],
  );
  await pool.query(
    `INSERT INTO runtime_terminal_outcome(outcome_id,outcome_kind,task_id,goal_id,goal_version,
       control_id,control_status,round_index,final_instance_id,summary,committed_at)
     VALUES('outcome-v141-runtime-core','achieved','task-v141-runtime-core',
       'goal-v141-runtime-core',2,'control-v141-runtime-core','achieved',0,
       'instance-v141-runtime-core','Goal achieved',$1)`,
    [completed],
  );
  await pool.query(
    `UPDATE workflow_control SET terminal_outcome_id='outcome-v141-runtime-core'
     WHERE control_id='control-v141-runtime-core';
     UPDATE workflow_control_round SET terminal_outcome_id='outcome-v141-runtime-core'
     WHERE control_id='control-v141-runtime-core' AND round_index=0`,
  );
}
