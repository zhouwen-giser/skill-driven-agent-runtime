import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { RuntimeCoreEvidenceProjector } from '../../runtime-control-application/src/index.js';
import {
  PostgresEvidenceStore,
  PostgresRuntimeCoreEvidenceSource,
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

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
  await seedRuntimeCoreEpisode();
});

afterAll(async () => {
  await pool.end();
});

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
      expect(schemaValidator.validate(schema, envelope)).toEqual({ valid: true, errors: [] });
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

    const manifest = await pool.query<{
      manifest_id: string;
      status: string;
      expected_required_records: number;
      projected_required_records: number;
      pending_required_records: number;
      failed_required_records: number;
      last_evidence_sequence: string;
    }>(
      `SELECT manifest_id,status,expected_required_records,projected_required_records,
         pending_required_records,failed_required_records,last_evidence_sequence::text
       FROM episode_evidence_manifest WHERE episode_id=$1`,
      ['task-v141-runtime-core'],
    );
    expect(manifest.rows[0]).toMatchObject({
      manifest_id: first.manifestId,
      status: 'projecting',
      expected_required_records: 19,
      projected_required_records: 19,
      pending_required_records: 0,
      failed_required_records: 0,
      last_evidence_sequence: '19',
    });
    await expect(
      pool.query(`SELECT 1 FROM evidence_quality_issue WHERE episode_id=$1`, [
        'task-v141-runtime-core',
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });

    const second = await projector.projectTask('task-v141-runtime-core');
    expect(second.projectedRecordIds).toEqual(first.projectedRecordIds);
    await expect(evidenceRecords()).resolves.toHaveLength(19);
    await expect(source.pendingTaskIds(10)).resolves.toEqual([]);

    await pool.query(`DELETE FROM episode_evidence_manifest WHERE episode_id=$1`, [
      'task-v141-runtime-core',
    ]);
    await expect(source.pendingTaskIds(10)).resolves.toEqual(['task-v141-runtime-core']);
    await projector.projectTask('task-v141-runtime-core');
    await expect(evidenceRecords()).resolves.toHaveLength(19);
    await expect(source.pendingTaskIds(10)).resolves.toEqual([]);
  });
});

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

async function seedRuntimeCoreEpisode(): Promise<void> {
  await pool.query(
    `TRUNCATE mcp_invocation,skill_execution_record,skill_version,skill,
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
     VALUES('skill-v141-runtime-core',1,$1,$2)`,
    [created, completed],
  );
  await pool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,
       runtime_policy_json,status,source_kind,validation_passed,created_at)
     VALUES('skill-v141-runtime-core',1,'Runtime inspection','Inspect runtime','Inspect runtime',
       '[]'::jsonb,'Inspect runtime','Return verification','{"type":"object"}'::jsonb,
       '{"type":"object"}'::jsonb,
       '{"required":[],"optional":[],"forbidden":[]}'::jsonb,'{}'::jsonb,
       'enabled','admin',true,$1)`,
    [created],
  );
  await pool.query(
    `INSERT INTO skill_execution_record(
       execution_id,parent_execution_id,task_id,goal_id,goal_version,skill_id,skill_version,
       selection_ref,applicability_status,usage_policy_json,workflow_plan_id,
       workflow_definition_id,workflow_definition_version,created_at)
     VALUES('skill-execution-v141-runtime-core',NULL,'task-v141-runtime-core',
       'goal-v141-runtime-core',2,'skill-v141-runtime-core',1,'selection-v141-runtime-core',
       'satisfied','{"mode":"native"}'::jsonb,'plan-v141-runtime-core',
       'workflow-v141-runtime-core',1,$1)`,
    [created],
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
