import { describe, expect, it } from 'vitest';

import type {
  CanonicalEvidenceEnvelope,
  EpisodeEvidenceManifest,
  EvidenceQualityIssue,
  EvidenceJsonValue,
  EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  createSkillExecutionEvidenceRecordId,
  SkillEvidenceProjector,
  type RuntimeCoreEvidenceWriter,
  type SkillEvidenceWriter,
  type SkillEvidenceSnapshot,
} from '../src/index.js';

describe('SkillEvidenceProjector', () => {
  it('reconstructs all 16 Skill record types from exact persisted selection and execution facts', async () => {
    const writer = new MemoryWriter();
    const projector = new SkillEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () => Promise.resolve(snapshot()),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T06:00:00.000Z' },
    });

    const result = await projector.projectTask('task-skill-evidence');

    expect(new Set(writer.records.map((record) => record.recordType))).toEqual(
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
    expect(writer.issues).toEqual([]);
    expect(
      writer.records.find((record) => record.recordType === 'skill.failure_propagation')?.payload,
    ).toMatchObject({ failurePolicy: 'degraded', missingEffects: ['coverage.zone-b'] });
    expect(
      writer.records.find((record) => record.recordType === 'skill.capability_slot_resolution')
        ?.payload,
    ).toMatchObject({ slotId: 'inspect-slot', capabilityId: 'embodied.inspect_area' });
    expect(
      writer.records.find((record) => record.recordType === 'skill.usage_snapshot')?.payload,
    ).toMatchObject({ skillId: 'embodied.area_patrol', skillVersion: 2 });
    const rootExecution = snapshot().executions[0];
    if (rootExecution === undefined) throw new Error('Root execution fixture missing.');
    const projectedExecution = writer.records.find(
      (record) =>
        record.recordType === 'skill.execution' && record.sourceRecordId === 'execution-root',
    );
    expect(projectedExecution?.recordId).toBe(createSkillExecutionEvidenceRecordId(rootExecution));
    expect(writer.checkpoint?.projectorVersion).toBe('skill/v1');
    expect(result.projectedRecordIds).toHaveLength(
      new Set(writer.records.map((record) => record.recordId)).size,
    );
  });

  it('records a blocking issue and does not invent a capability slot resolution', async () => {
    const writer = new MemoryWriter();
    const missingAuthority = snapshot();
    const projector = new SkillEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () =>
          Promise.resolve({
            ...missingAuthority,
            existingEvidence: missingAuthority.existingEvidence.filter(
              (record) => record['record_type'] !== 'capability.definition',
            ),
          }),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T06:00:00.000Z' },
    });

    await projector.projectTask('task-skill-evidence');

    expect(
      writer.issues.some(
        (issue) =>
          issue.recordType === 'skill.capability_slot_resolution' &&
          issue.detail['missingReference'] === 'capability.definition',
      ),
    ).toBe(true);
    expect(
      writer.records.some((record) => record.recordType === 'skill.capability_slot_resolution'),
    ).toBe(false);
    expect(writer.records.some((record) => containsValue(record.payload, 'unresolved'))).toBe(
      false,
    );
  });

  it.each([
    ['fail_fast', 'UNSUPPORTED_MODE'],
    ['recoverable', 'SKILL_RECURSION_CYCLE'],
    ['optional', 'OPTIONAL_CHILD_FAILED'],
    ['degraded', 'REQUIRED_EVIDENCE_MISSING'],
  ] as const)(
    'preserves %s failure propagation without hiding %s',
    async (failurePolicy, failureCode) => {
      const writer = new MemoryWriter();
      const sourceSnapshot = snapshot();
      const projector = new SkillEvidenceProjector({
        source: {
          pendingTaskIds: () => Promise.resolve([]),
          load: () =>
            Promise.resolve({
              ...sourceSnapshot,
              events: sourceSnapshot.events.map((event) =>
                event['event_id'] === 'event-failed'
                  ? {
                      ...event,
                      details_json: {
                        failureCode,
                        failurePolicy,
                        missingEffects: ['effect.required'],
                        missingEvidence: ['evidence.required'],
                      },
                    }
                  : event,
              ),
            }),
        },
        writer,
        environment: 'test',
        clock: { now: () => '2026-08-04T06:00:00.000Z' },
      });

      await projector.projectTask('task-skill-evidence');

      expect(
        writer.records.find((record) => record.recordType === 'skill.failure_propagation')?.payload,
      ).toMatchObject({ failurePolicy, failureCode });
    },
  );

  it('resolves a prior blocking issue after its authoritative reference arrives', async () => {
    const writer = new MemoryWriter();
    const complete = snapshot();
    let current: SkillEvidenceSnapshot = {
      ...complete,
      existingEvidence: complete.existingEvidence.filter(
        (record) => record['record_type'] !== 'capability.definition',
      ),
    };
    const projector = new SkillEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () => Promise.resolve(current),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T06:00:00.000Z' },
    });

    const first = await projector.projectTask('task-skill-evidence');
    expect(first.qualityIssueIds).toHaveLength(3);
    current = complete;
    const second = await projector.projectTask('task-skill-evidence');

    expect(second.qualityIssueIds).toEqual([]);
    expect(writer.resolvedIssueIds).toEqual(first.qualityIssueIds);
    expect(
      writer.records.some((record) => record.recordType === 'skill.capability_slot_resolution'),
    ).toBe(true);
  });
});

class MemoryWriter implements RuntimeCoreEvidenceWriter, SkillEvidenceWriter {
  readonly records: CanonicalEvidenceEnvelope[] = [];
  readonly issues: EvidenceQualityIssue[] = [];
  readonly resolvedIssueIds: string[] = [];
  checkpoint?: EvidenceSourceCheckpoint;
  append(envelope: CanonicalEvidenceEnvelope): Promise<string> {
    this.records.push(envelope);
    return Promise.resolve(String(this.records.length));
  }
  recordQualityIssue(issue: EvidenceQualityIssue): Promise<void> {
    this.issues.push(issue);
    return Promise.resolve();
  }
  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void> {
    this.checkpoint = checkpoint;
    return Promise.resolve();
  }
  saveManifest(manifest: EpisodeEvidenceManifest): Promise<void> {
    void manifest;
    return Promise.resolve();
  }
  resolveQualityIssues(input: {
    episodeId: string;
    recordTypePrefix: string;
    retainedIssueIds: readonly string[];
    resolvedAt: string;
  }): Promise<void> {
    void input.episodeId;
    void input.resolvedAt;
    const retained = new Set(input.retainedIssueIds);
    for (const issue of this.issues)
      if (
        issue.recordType?.startsWith(input.recordTypePrefix) === true &&
        !retained.has(issue.issueId) &&
        !this.resolvedIssueIds.includes(issue.issueId)
      )
        this.resolvedIssueIds.push(issue.issueId);
    return Promise.resolve();
  }
}

function containsValue(value: EvidenceJsonValue, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value))
    return (value as readonly EvidenceJsonValue[]).some((item) => containsValue(item, expected));
  if (value !== null && typeof value === 'object')
    return Object.values(value).some((item) => containsValue(item, expected));
  return false;
}

function snapshot(): SkillEvidenceSnapshot {
  const created = '2026-08-04T05:00:00.000Z';
  const completed = '2026-08-04T05:01:00.000Z';
  const ref = (character: string) => `evidence_${character.repeat(64)}`;
  const candidate = (skillId: string, skillVersion: number) => ({
    skillId,
    skillVersion,
    name: skillId,
    summary: skillId,
    capabilities: [],
    usageCandidate: {
      skillId,
      skillVersion,
      applicability: { status: 'satisfied', reasonCodes: [], evidenceRefs: [] },
      modeDecision: {
        decision: 'selected',
        mode: 'procedure',
        confirmationRequired: false,
        confirmationSatisfied: true,
        reasonCodes: [],
      },
    },
  });
  const policy = (skillId: string, skillVersion: number, edges: readonly EvidenceJsonValue[]) => ({
    skill: { skillId, skillVersion },
    mode: 'procedure',
    modeDecision: {
      decision: 'selected',
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
      root: { skillId, skillVersion },
      expandedSkills: [],
      edges,
      maxDepth: 3,
      consumedDepth: 1,
      consumedSkills: 2,
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
  const edge = {
    edgeId: 'edge-slot',
    kind: 'capability_slot',
    declarationId: 'inspect-slot',
    parent: { skillId: 'embodied.area_patrol', skillVersion: 2 },
    child: { skillId: 'embodied.inspect', skillVersion: 1 },
    candidateSet: [{ skillId: 'embodied.inspect', skillVersion: 1 }],
    failurePolicy: 'degraded',
    inputMappings: [],
    outputMappings: [],
    depth: 1,
  };
  return {
    task: {
      task_id: 'task-skill-evidence',
      context_id: 'context-skill-evidence',
      updated_at: completed,
    },
    selections: [
      {
        selection_id: 'selection-root',
        candidates_json: [candidate('embodied.area_patrol', 2)],
        selected_skill_id: 'embodied.area_patrol',
        selected_skill_version: 2,
        decision_summary: 'root',
        created_at: created,
      },
      {
        selection_id: 'selection-child',
        candidates_json: [candidate('embodied.inspect', 1)],
        selected_skill_id: 'embodied.inspect',
        selected_skill_version: 1,
        decision_summary: 'child',
        created_at: created,
      },
    ],
    inputResolutions: [
      {
        resolution_id: 'resolution-root',
        goal_id: 'goal-skill-evidence',
        goal_version: 1,
        skill_id: 'embodied.area_patrol',
        skill_version: 2,
        status: 'resolved',
        source_refs_json: ['context:map'],
        unresolved_fields_json: [],
        created_at: created,
      },
    ],
    executions: [
      {
        execution_id: 'execution-root',
        parent_execution_id: null,
        task_id: 'task-skill-evidence',
        goal_id: 'goal-skill-evidence',
        goal_version: 1,
        skill_id: 'embodied.area_patrol',
        skill_version: 2,
        selection_ref: 'selection-root',
        applicability_status: 'satisfied',
        usage_policy_json: policy('embodied.area_patrol', 2, [edge]),
        workflow_plan_id: 'plan-skill-evidence',
        workflow_definition_id: 'workflow-root',
        workflow_definition_version: 3,
        created_at: created,
      },
      {
        execution_id: 'execution-child',
        parent_execution_id: 'execution-root',
        task_id: 'task-skill-evidence',
        goal_id: 'goal-skill-evidence',
        goal_version: 1,
        skill_id: 'embodied.inspect',
        skill_version: 1,
        selection_ref: 'selection-child',
        applicability_status: 'satisfied',
        usage_policy_json: policy('embodied.inspect', 1, []),
        workflow_plan_id: 'plan-skill-evidence',
        workflow_definition_id: 'workflow-child',
        workflow_definition_version: 1,
        created_at: created,
      },
    ],
    events: [
      {
        event_id: 'event-mode',
        execution_id: 'execution-root',
        event_type: 'skill.mode_selected',
        status_after: null,
        details_json: { mode: 'procedure' },
        occurred_at: created,
      },
      {
        event_id: 'event-child',
        execution_id: 'execution-root',
        event_type: 'skill.child_selected',
        status_after: null,
        details_json: {
          edgeId: 'edge-slot',
          skillId: 'embodied.inspect',
          skillVersion: 1,
          failurePolicy: 'degraded',
        },
        occurred_at: created,
      },
      {
        event_id: 'event-procedure',
        execution_id: 'execution-root',
        event_type: 'skill.procedure_compiled',
        status_after: null,
        details_json: { workflowDefinitionId: 'workflow-root', workflowDefinitionVersion: 3 },
        occurred_at: created,
      },
      {
        event_id: 'event-compliance',
        execution_id: 'execution-root',
        event_type: 'skill.plan_compliance_passed',
        status_after: 'planning',
        details_json: { compliant: true },
        occurred_at: created,
      },
      {
        event_id: 'event-completed',
        execution_id: 'execution-root',
        event_type: 'skill.execution_completed',
        status_after: 'completed',
        details_json: {},
        occurred_at: completed,
      },
      {
        event_id: 'event-failed',
        execution_id: 'execution-child',
        event_type: 'skill.execution_failed',
        status_after: 'degraded',
        details_json: {
          failureCode: 'INSPECTION_PARTIAL',
          failurePolicy: 'degraded',
          missingEffects: ['coverage.zone-b'],
          missingEvidence: ['image.zone-b'],
        },
        occurred_at: completed,
      },
    ],
    references: [
      {
        link_id: 'reference-provider',
        execution_id: 'execution-root',
        reference_type: 'task.provider',
        kind: 'provider',
        reference_id: 'provider-1',
        producer_refs_json: [],
        metadata_json: { operationName: 'inspect' },
        created_at: created,
      },
    ],
    skillVersions: [
      {
        skill_id: 'embodied.area_patrol',
        version: 2,
        usage_specification_json: {
          composition: {
            capabilitySlots: [{ slotId: 'inspect-slot', capability: 'embodied.inspect_area' }],
          },
        },
      },
      { skill_id: 'embodied.inspect', version: 1, usage_specification_json: {} },
    ],
    capabilityBindings: [
      {
        binding_id: 'binding-skill',
        requested_capability_id: 'embodied.inspect_area',
        capability_version: 3,
        evidence_requirement_snapshot: [{ requirementId: 'coverage', requirementType: 'coverage' }],
        bound_at: created,
      },
    ],
    existingEvidence: [
      {
        record_id: ref('a'),
        record_type: 'runtime.episode',
        source_record_id: 'task-skill-evidence',
      },
      {
        record_id: ref('b'),
        record_type: 'runtime.goal_contract',
        source_record_id: 'goal-skill-evidence:1',
      },
      { record_id: ref('c'), record_type: 'runtime.plan', source_record_id: 'plan-skill-evidence' },
      {
        record_id: ref('d'),
        record_type: 'runtime.plan_step',
        source_record_id: 'step-skill-evidence',
        plan_id: 'plan-skill-evidence',
      },
      {
        record_id: ref('e'),
        record_type: 'capability.definition',
        source_record_id: 'embodied.inspect_area:3',
        payload: {
          capabilityId: 'embodied.inspect_area',
          version: 3,
          definitionHash: '1'.repeat(64),
        },
      },
      {
        record_id: ref('f'),
        record_type: 'capability.task_binding',
        source_record_id: 'binding-skill',
      },
    ],
  };
}
