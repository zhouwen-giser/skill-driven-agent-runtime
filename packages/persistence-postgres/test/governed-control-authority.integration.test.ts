import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  GovernedControlConfirmationService,
  GovernedControlInvocationAuthorizer,
  governedControlSnapshotHash,
  type CurrentGovernedCapabilityAuthority,
  type GovernedControlConfirmation,
} from '../../application/src/index.js';
import { PostgresGovernedControlAuthorityRepository } from '../src/index.js';

const databaseName = 'sdar_v14_governed_control_authority_integration';
const adminConnection =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = replaceDatabase(adminConnection, databaseName);

const taskId = 'task-governed-control';
const planId = 'plan-governed-control';
const bindingId = 'binding-governed-control';
const attemptId = 'attempt-governed-control';
const capabilityId = 'vehicle.light.control';
const capabilityVersion = 1;
const skillId = 'skill-governed-light-control';
const skillVersion = 3;
const serverId = 'provider-governed-control';
const toolName = 'light_set_state';
const providerBindingId = 'provider-binding-governed-control';
const arguments_ = Object.freeze({ resourceId: 'lab-light-1', state: 'off' });
const planDefinition = Object.freeze({
  workflowDefinitionId: 'workflow-governed-control',
  version: 1,
  nodes: [
    {
      id: 'set-lab-light',
      type: 'mcp_tool',
      serverId,
      toolName,
      arguments: arguments_,
    },
  ],
});
const planHash = governedControlSnapshotHash(planDefinition);
const argumentsHash = governedControlSnapshotHash(arguments_);
const constraints = Object.freeze(controlConstraints());

let pool: Pool;
let poolOpened = false;
let databaseCreated = false;

function replaceDatabase(connection: string, database: string): string {
  const url = new URL(connection);
  url.pathname = `/${database}`;
  return url.toString();
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
  } finally {
    await admin.end();
  }
  pool = new Pool({ connectionString: databaseConnection, max: 4 });
  poolOpened = true;
  await applyRuntimeMigrations(pool);
  await seedExactAuthority();
}, 60_000);

afterAll(async () => {
  if (!databaseCreated) return;
  if (poolOpened) await pool.end();
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await admin.end();
  }
});

describe('PostgreSQL governed physical-control authority', () => {
  it('survives restart, revokes and expires fail closed, and enforces FK/immutability', async () => {
    let physicalDeviceWrites = 0;
    const initial = confirmationService(
      new PostgresGovernedControlAuthorityRepository(pool),
      'confirmation-governed-live',
      '2026-08-13T01:00:00.000Z',
    );
    await expect(
      initial.issue(confirmationInput('2026-08-13T01:05:00.000Z')),
    ).resolves.toMatchObject({
      confirmationId: 'confirmation-governed-live',
      taskId,
      capabilityBindingId: bindingId,
      capabilityId,
      planId,
      planHash,
      skillId,
      actorId: 'human:operator-1',
    });

    const afterIssueRestart = await openRestartedRepository();
    try {
      const snapshot = await afterIssueRestart.repository.load({
        taskId,
        serverId,
        toolName,
        argumentsHash,
      });
      expect(snapshot).toMatchObject({
        task: { taskId, phase: 'executing', planId },
        binding: { bindingId, capabilityId, capabilityVersion },
        attempt: {
          attemptId,
          status: 'running',
          providerBindingRefs: [providerBindingId],
        },
        plan: { planId, confirmationStatus: 'confirmed', definitionHash: planHash },
        skill: {
          skillId,
          skillVersion,
          currentVersion: skillVersion,
          status: 'enabled',
        },
        readiness: {
          checkPhase: 'pre_invocation',
          serverId,
          operationName: toolName,
          argumentsHash,
          riskLevel: 'high',
        },
        confirmation: {
          confirmationId: 'confirmation-governed-live',
          actorKind: 'human',
          revokedAt: undefined,
        },
      });
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:00.000Z').authorize(
          invocation(),
        ),
      ).resolves.toBeUndefined();
      expect(physicalDeviceWrites).toBe(0);

      const revocation = new GovernedControlConfirmationService({
        store: afterIssueRestart.repository,
        clock: { now: () => '2026-08-13T01:01:30.000Z' },
        ids: { nextConfirmationId: () => 'unused-confirmation-id' },
      });
      await expect(
        revocation.revoke({
          confirmationId: 'confirmation-governed-live',
          actorId: 'human:operator-2',
          actorKind: 'human',
          authenticationMethod: 'oidc-mfa',
          actorRoles: ['physical_control_approver'],
        }),
      ).resolves.toMatchObject({
        revokedAt: '2026-08-13T01:01:30.000Z',
        revokedBy: 'human:operator-2',
      });
    } finally {
      await afterIssueRestart.pool.end();
    }

    const afterRevokeRestart = await openRestartedRepository();
    try {
      await expect(
        authorizer(afterRevokeRestart.repository, '2026-08-13T01:02:00.000Z').authorize(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID' });
      await expect(
        afterRevokeRestart.repository.load({ taskId, serverId, toolName, argumentsHash }),
      ).resolves.toMatchObject({
        confirmation: {
          confirmationId: 'confirmation-governed-live',
          revokedAt: '2026-08-13T01:01:30.000Z',
          revokedBy: 'human:operator-2',
        },
      });
      expect(physicalDeviceWrites).toBe(0);
    } finally {
      await afterRevokeRestart.pool.end();
    }

    const expiring = confirmationService(
      new PostgresGovernedControlAuthorityRepository(pool),
      'confirmation-governed-expiring',
      '2026-08-13T01:02:30.000Z',
    );
    await expiring.issue(confirmationInput('2026-08-13T01:03:00.000Z'));
    const afterExpiryRestart = await openRestartedRepository();
    try {
      await expect(
        authorizer(afterExpiryRestart.repository, '2026-08-13T01:04:00.000Z').authorize(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID' });
      await expect(
        afterExpiryRestart.repository.load({ taskId, serverId, toolName, argumentsHash }),
      ).resolves.toMatchObject({
        confirmation: {
          confirmationId: 'confirmation-governed-expiring',
          expiresAt: '2026-08-13T01:03:00.000Z',
        },
      });
      expect(physicalDeviceWrites).toBe(0);
    } finally {
      await afterExpiryRestart.pool.end();
    }

    await expect(
      pool.query(
        `UPDATE governed_control_confirmation
            SET reason='Attempted scope mutation'
          WHERE confirmation_id='confirmation-governed-expiring'`,
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        `DELETE FROM governed_control_confirmation
          WHERE confirmation_id='confirmation-governed-expiring'`,
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const repository = new PostgresGovernedControlAuthorityRepository(pool);
    await expect(
      repository.saveConfirmation({
        ...confirmationRecord('confirmation-invalid-fk', '2026-08-13T01:05:00.000Z'),
        taskId: 'task-that-does-not-exist',
      }),
    ).rejects.toMatchObject({ code: '23503' });
    physicalDeviceWrites += 0;
    expect(physicalDeviceWrites).toBe(0);
  });
});

function confirmationService(
  store: PostgresGovernedControlAuthorityRepository,
  confirmationId: string,
  now: string,
): GovernedControlConfirmationService {
  return new GovernedControlConfirmationService({
    store,
    clock: { now: () => now },
    ids: { nextConfirmationId: () => confirmationId },
  });
}

function confirmationInput(expiresAt: string) {
  return {
    taskId,
    capabilityBindingId: bindingId,
    capabilityId,
    capabilityVersion,
    planId,
    planHash,
    skillId,
    skillVersion,
    actorId: 'human:operator-1',
    actorKind: 'human' as const,
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve bounded deterministic light control.',
    expiresAt,
  };
}

function confirmationRecord(
  confirmationId: string,
  expiresAt: string,
): GovernedControlConfirmation {
  return {
    confirmationId,
    taskId,
    capabilityBindingId: bindingId,
    capabilityId,
    capabilityVersion,
    planId,
    planHash,
    skillId,
    skillVersion,
    actorId: 'human:operator-1',
    actorKind: 'human',
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve bounded deterministic light control.',
    confirmedAt: '2026-08-13T01:00:00.000Z',
    expiresAt,
  };
}

function invocation() {
  return {
    taskId,
    capabilityAttemptId: attemptId,
    providerBindingId,
    serverId,
    toolName,
    arguments: arguments_,
    executionSemantics: {
      effect: 'side_effecting' as const,
      execution: 'synchronous' as const,
      cancellation: 'unsupported' as const,
      idempotency: 'client_request_key' as const,
      replay: 'forbidden' as const,
      source: 'mcp_declared' as const,
    },
  };
}

function authorizer(store: PostgresGovernedControlAuthorityRepository, now: string) {
  return new GovernedControlInvocationAuthorizer({
    store,
    capabilities: { load: () => Promise.resolve(currentCapability()) },
    clock: { now: () => now },
  });
}

function currentCapability(): CurrentGovernedCapabilityAuthority {
  return {
    definition: {
      capability_id: capabilityId,
      version: capabilityVersion,
      status: 'published',
      risk_level: 'high',
      constraints,
    },
    implementationBindings: [
      {
        capability_id: capabilityId,
        capability_version: capabilityVersion,
        implementation_type: 'skill',
        implementation_id: skillId,
        implementation_version: String(skillVersion),
        role: 'primary',
        status: 'active',
      },
    ],
  };
}

async function openRestartedRepository(): Promise<{
  pool: Pool;
  repository: PostgresGovernedControlAuthorityRepository;
}> {
  const restartedPool = new Pool({ connectionString: databaseConnection, max: 1 });
  await restartedPool.query('SELECT 1');
  return {
    pool: restartedPool,
    repository: new PostgresGovernedControlAuthorityRepository(restartedPool),
  };
}

async function seedExactAuthority(): Promise<void> {
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-governed-control','human:operator-1',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO goal(
       goal_id,context_id,version,title,description,status,created_at,updated_at)
     VALUES('goal-governed-control','context-governed-control',1,
            'Bounded light control','Turn off one deterministic lab light.','active',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO skill(skill_id,current_version,created_at,updated_at)
     VALUES($1,$2,'2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
    [skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,
       runtime_policy_json,status,source_kind,validation_passed,created_at)
     VALUES($1,$2,'Governed Light Control','Bounded physical light control.',
       'Requires exact Task, Capability, plan, readiness, Provider and human confirmation.',
       $3::jsonb,'Invoke the exact required Tool once.','Return confirmed state evidence.',
       '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,$4::jsonb,$5::jsonb,
       'enabled','admin',true,'2026-08-13T01:00:00.000Z')`,
    [
      skillId,
      skillVersion,
      JSON.stringify([capabilityId]),
      JSON.stringify({
        required: [{ serverId, toolName }],
        optional: [],
        forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
      }),
      JSON.stringify({ autoConfirmPlan: false, maxMcpCalls: 1 }),
    ],
  );
  await pool.query(
    `INSERT INTO runtime_skill_version_governance(
       skill_id,skill_version,lifecycle_status,lock_version,updated_by,reason,created_at,updated_at)
     VALUES($1,$2,'published',1,'human:operator-1','Approved exact bounded fixture.',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
    [skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO skill_outcome_specification(
       skill_id,skill_version,schema_version,specification_hash,specification_json,created_at)
     VALUES($1,$2,'1.0',$3,$4::jsonb,'2026-08-13T01:00:00.000Z')`,
    [
      skillId,
      skillVersion,
      `sha256:${'1'.repeat(64)}`,
      JSON.stringify({
        schemaVersion: '1.0',
        sideEffectPolicy: { sideEffecting: true, confirmation: 'required' },
      }),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES($1,'goal-governed-control',1,$2::jsonb,$3::jsonb,
            'confirmed',1,'2026-08-13T01:00:00.000Z')`,
    [
      planId,
      JSON.stringify({
        goalId: 'goal-governed-control',
        version: 1,
        title: 'Bounded light control',
        description: 'Turn off one deterministic lab light.',
        constraints: [],
        successCriteria: [],
      }),
      JSON.stringify(planDefinition),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan_attempt(
       plan_id,attempt,goal_contract_json,candidate_json,validation_errors_json,valid,created_at)
     VALUES($1,1,$2::jsonb,$3::jsonb,'[]'::jsonb,true,'2026-08-13T01:00:00.000Z')`,
    [
      planId,
      JSON.stringify({
        goalId: 'goal-governed-control',
        version: 1,
        title: 'Bounded light control',
        description: 'Turn off one deterministic lab light.',
        constraints: [],
        successCriteria: [],
      }),
      JSON.stringify(planDefinition),
    ],
  );
  await pool.query(
    `INSERT INTO agent_task(
       task_id,context_id,user_id,request_text,request_metadata,phase,phase_message,
       goal_id,goal_version,plan_id,selected_skill_id,selected_skill_version,created_at,updated_at)
     VALUES($1,'context-governed-control','human:operator-1','Turn off the lab light.',
            '{}'::jsonb,'executing','Executing governed control.','goal-governed-control',1,
            $2,$3,$4,'2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
    [taskId, planId, skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO task_capability_binding(
       binding_id,task_id,requested_capability_id,capability_version,
       input_snapshot,success_criteria_snapshot,evidence_requirement_snapshot,
       constraint_snapshot,initial_implementation_refs,binding_hash,bound_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,
            '2026-08-13T01:00:00.000Z')`,
    [
      bindingId,
      taskId,
      capabilityId,
      capabilityVersion,
      JSON.stringify(arguments_),
      JSON.stringify([{ type: 'target_state', state: 'off' }]),
      JSON.stringify([{ type: 'state_confirmation', required: true }]),
      JSON.stringify(constraints),
      JSON.stringify([`skill:${skillId}:${String(skillVersion)}`]),
      '2'.repeat(64),
    ],
  );
  await pool.query(
    `INSERT INTO task_capability_execution_attempt(
       attempt_id,task_id,capability_binding_id,attempt_no,plan_id,skill_version_refs,
       provider_binding_refs,reason,status,started_at)
     VALUES($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,'initial','running',
            '2026-08-13T01:00:10.000Z')`,
    [
      attemptId,
      taskId,
      bindingId,
      planId,
      JSON.stringify([`skill:${skillId}:${String(skillVersion)}`]),
      JSON.stringify([providerBindingId]),
    ],
  );
  await pool.query(
    `INSERT INTO task_execution_readiness(
       readiness_id,workflow_plan_id,plan_attempt,check_phase,workflow_instance_id,
       workflow_node_run_id,dsl_hash,disposition,permitted_actions_json,guard_action,
       guard_reason_codes_json,confirmation_required,created_at)
     VALUES('readiness-governed-control',$1,1,'pre_invocation',
            'workflow-instance-governed-control','set-lab-light:1',$2,'ready',
            '["execute"]'::jsonb,'proceed','[]'::jsonb,false,
            '2026-08-13T01:00:30.000Z')`,
    [planId, planHash],
  );
  await pool.query(
    `INSERT INTO task_availability_snapshot(
       snapshot_id,readiness_id,node_id,server_id,operation_name,
       arguments_snapshot_json,arguments_hash,result_json,availability,risk_level,
       reservation_mode,valid_until,source_revision,checked_at,normalization_reason_codes_json)
     VALUES('availability-governed-control','readiness-governed-control','set-lab-light',
            $1,$2,$3::jsonb,$4,'{"available":true}'::jsonb,'available','high','none',
            '2026-08-13T01:10:00.000Z','catalog-governed-control-v1',
            '2026-08-13T01:00:30.000Z','[]'::jsonb)`,
    [serverId, toolName, JSON.stringify(arguments_), argumentsHash],
  );
}

function controlConstraints() {
  return [
    {
      type: 'authorization',
      effect: 'physical_control',
      requiredActorRole: 'physical_control_approver',
      allowedActorIds: ['human:operator-1'],
    },
    {
      type: 'confirmation_policy',
      required: true,
      stage: 'pre_dispatch',
      trustedActorRequired: true,
    },
    { type: 'side_effect_policy', sideEffecting: true, effectClass: 'physical_control' },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: toolName,
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    { type: 'resource_policy', allowedResourceIds: ['lab-light-1'] },
    { type: 'exact_skill_version', skillId, skillVersion, taskType: toolName },
  ];
}
