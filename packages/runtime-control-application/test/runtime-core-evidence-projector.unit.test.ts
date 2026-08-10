import { describe, expect, it } from 'vitest';

import type {
  CanonicalEvidenceEnvelope,
  EvidenceQualityIssue,
  EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  RuntimeCoreEvidenceProjector,
  type RuntimeCoreEvidenceSnapshot,
  type RuntimeCoreEvidenceWriter,
} from '../src/index.js';

describe('RuntimeCoreEvidenceProjector', () => {
  it('projects the real Runtime core source shape and leaves manifest sealing to coverage', async () => {
    const writer = new MemoryWriter();
    const projector = new RuntimeCoreEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () => Promise.resolve(snapshot()),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T04:00:00.000Z' },
    });

    const result = await projector.projectTask('task-runtime-core');

    expect(writer.records).toHaveLength(18);
    expect(new Set(writer.records.map((record) => record.recordType))).toEqual(
      new Set([
        'runtime.episode',
        'runtime.request',
        'runtime.a2a_task',
        'runtime.goal',
        'runtime.goal_contract',
        'runtime.goal_patch',
        'runtime.plan',
        'runtime.plan_step',
        'runtime.state_transition',
        'runtime.decision',
        'runtime.policy_decision',
        'runtime.execution_gate',
        'runtime.human_confirmation',
        'runtime.action',
        'runtime.receipt',
        'runtime.verification',
        'runtime.outcome',
        'runtime.run_seal',
      ]),
    );
    for (const [index, record] of writer.records.entries()) {
      expect(record.recordId).toMatch(/^evidence_[0-9a-f]{64}$/u);
      expect(record.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(writer.sequences[index]).toBe(String(index + 1));
      if (record.recordType !== 'runtime.episode')
        expect(record.evidenceRefs.length).toBeGreaterThan(0);
    }
    expect(payload(writer.records, 'runtime.action')).toMatchObject({
      executionBasis: { executionMode: 'live' },
    });
    expect(payload(writer.records, 'runtime.receipt')).toMatchObject({
      receiptLayers: { transport: 'recorded', executor: 'succeeded', business: 'not_asserted' },
    });
    expect(payload(writer.records, 'runtime.run_seal')).toMatchObject({
      outcomeKind: 'achieved',
      taskStatus: 'completed',
      controlStatus: 'achieved',
    });
    expect(writer.issues).toEqual([]);
    expect(writer.checkpoint?.projectorVersion).toBe('runtime-core/v1');
    expect(
      writer.records.find((record) => record.recordType === 'runtime.run_seal')?.evidenceRefs,
    ).toHaveLength(1);
    expect(result).toMatchObject({ lastEvidenceSequence: '18', qualityIssueIds: [] });
  });

  it('fails closed when the requested authoritative Task does not exist', async () => {
    const projector = new RuntimeCoreEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () => Promise.resolve(undefined),
      },
      writer: new MemoryWriter(),
      environment: 'test',
    });
    await expect(projector.projectTask('missing')).rejects.toThrow('was not found');
  });

  it('records a blocking quality issue instead of inferring a missing Skill execution reference', async () => {
    const writer = new MemoryWriter();
    const source = snapshot();
    const projector = new RuntimeCoreEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () => Promise.resolve({ ...source, skillExecutions: [] }),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T04:00:00.000Z' },
    });

    await projector.projectTask('task-runtime-core');

    expect(writer.issues).toHaveLength(1);
    expect(writer.issues[0]).toMatchObject({
      severity: 'blocking',
      recordType: 'runtime.action',
      detail: { missingReference: 'skill.execution', matchingSkillExecutionCount: 0 },
    });
  });
});

class MemoryWriter implements RuntimeCoreEvidenceWriter {
  readonly records: CanonicalEvidenceEnvelope[] = [];
  readonly sequences: string[] = [];
  readonly issues: EvidenceQualityIssue[] = [];
  checkpoint?: EvidenceSourceCheckpoint;

  append(envelope: CanonicalEvidenceEnvelope): Promise<string> {
    const sequence = String(this.records.length + 1);
    this.records.push(envelope);
    this.sequences.push(sequence);
    return Promise.resolve(sequence);
  }

  recordQualityIssue(issue: EvidenceQualityIssue): Promise<void> {
    this.issues.push(issue);
    return Promise.resolve();
  }

  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void> {
    this.checkpoint = checkpoint;
    return Promise.resolve();
  }
}

function payload(records: readonly CanonicalEvidenceEnvelope[], recordType: string): unknown {
  return records.find((record) => record.recordType === recordType)?.payload;
}

function snapshot(): RuntimeCoreEvidenceSnapshot {
  const created = '2026-08-04T03:00:00.000Z';
  const completed = '2026-08-04T03:01:00.000Z';
  return {
    task: {
      task_id: 'task-runtime-core',
      context_id: 'context-runtime-core',
      phase: 'completed',
      goal_id: 'goal-runtime-core',
      goal_version: 2,
      request_text: 'inspect and verify the runtime',
      request_metadata: { protocol: 'a2a' },
      user_goal_plan_id: 'plan-runtime-core',
      skill_goal_id: 'step-runtime-core',
      created_at: created,
      updated_at: completed,
    },
    goals: [
      {
        goal_id: 'goal-runtime-core',
        version: 2,
        status: 'achieved',
        updated_at: completed,
      },
    ],
    goalContracts: [
      {
        goal_id: 'goal-runtime-core',
        goal_version: 2,
        contract_hash: 'sha256:goal-contract',
        created_at: created,
      },
    ],
    goalPatches: [
      {
        patch_id: 'patch-runtime-core',
        goal_id: 'goal-runtime-core',
        from_version: 1,
        to_version: 2,
        invalidated_plan_ids_json: ['plan-old'],
        new_plan_id: 'plan-runtime-core',
        created_at: created,
      },
    ],
    plans: [
      {
        plan_id: 'plan-runtime-core',
        goal_id: 'goal-runtime-core',
        goal_version: 2,
        revision: 2,
        content_hash: 'sha256:plan-content',
        status: 'completed',
        lock_version: '4',
        source_plan_id: 'plan-old',
        updated_at: completed,
      },
    ],
    planSteps: [
      {
        skill_goal_id: 'step-runtime-core',
        plan_id: 'plan-runtime-core',
        ordinal: 1,
        status: 'achieved',
        lock_version: '3',
        updated_at: completed,
      },
    ],
    stateTransitions: [
      {
        event_id: 'event-runtime-core',
        plan_id: 'plan-runtime-core',
        skill_goal_id: 'step-runtime-core',
        sequence: 1,
        node_id: 'node-runtime-core',
        event_type: 'node_succeeded',
        event_timestamp: completed,
      },
    ],
    controlRounds: [
      {
        control_id: 'control-runtime-core',
        round_index: 0,
        plan_id: 'plan-runtime-core',
        evaluation_decision: 'achieved',
        evaluation_detail_json: { reasonCodes: ['criteria_satisfied'] },
        created_at: completed,
      },
    ],
    executionGates: [
      {
        readiness_id: 'gate-runtime-core',
        workflow_plan_id: 'plan-runtime-core',
        disposition: 'ready',
        guard_action: 'proceed',
        guard_reason_codes_json: ['confirmed'],
        confirmation_required: false,
        created_at: created,
      },
    ],
    confirmations: [
      {
        plan_id: 'plan-runtime-core',
        goal_id: 'goal-runtime-core',
        goal_version: 2,
        confirmation_status: 'confirmed',
        confirmation_task_id: 'task-runtime-core',
        attempt_count: 1,
        created_at: created,
        confirmed_at: created,
      },
    ],
    skillExecutions: [
      {
        execution_id: 'skill-execution-runtime-core',
        parent_execution_id: null,
        task_id: 'task-runtime-core',
        goal_id: 'goal-runtime-core',
        goal_version: 2,
        skill_id: 'skill-runtime-core',
        skill_version: 1,
        selection_ref: 'selection-runtime-core',
        applicability_status: 'satisfied',
        usage_policy_json: { mode: 'native' },
        workflow_plan_id: 'plan-runtime-core',
        workflow_definition_id: 'workflow-runtime-core',
        workflow_definition_version: 1,
        created_at: created,
      },
    ],
    invocations: [
      {
        invocation_id: 'invocation-runtime-core',
        tool_name: 'inspect_runtime',
        arguments_json: { target: 'runtime' },
        result_json: { verified: true },
        status: 'succeeded',
        execution_mode: 'live',
        execution_semantics_json: { effect: 'read' },
        started_at: created,
        completed_at: completed,
      },
    ],
    verifications: [
      {
        completed_effect_id: 'effect-runtime-core',
        goal_id: 'goal-runtime-core',
        plan_id: 'plan-runtime-core',
        status: 'active',
        effect_fingerprint: 'effect-fingerprint',
        created_at: completed,
      },
    ],
    outcomes: [
      {
        outcome_decision_id: 'decision-runtime-core',
        plan_id: 'plan-runtime-core',
        level: 'user_goal',
        status: 'achieved',
        confidence: '1',
        created_at: completed,
      },
    ],
    runSeals: [
      {
        outcome_id: 'outcome-runtime-core',
        outcome_kind: 'achieved',
        goal_id: 'goal-runtime-core',
        goal_version: 2,
        control_status: 'achieved',
        control_current_status: 'achieved',
        task_status: 'completed',
        goal_status: 'achieved',
        workflow_status: 'succeeded',
        final_instance_id: 'instance-runtime-core',
        authority: 'user_goal_plan_controller',
        committed_at: completed,
      },
    ],
  };
}
