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
import {
  PostgresGovernedControlAuthorityRepository,
  PostgresMcpRegistryRepository,
} from '../src/index.js';

const databaseName = 'sdar_v14_governed_control_authority_integration';
const adminConnection =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseConnection = replaceDatabase(adminConnection, databaseName);

const taskId = 'task-governed-control';
const planId = 'plan-governed-control';
const bindingId = 'binding-governed-control';
const attemptId = 'attempt-governed-control';
const capabilityId = 'vehicle.ugv.track-target';
const capabilityVersion = 1;
const skillId = 'ugv.track-target';
const skillVersion = 3;
const serverId = 'smpp-ugv-provider';
const toolName = 'vehicle_track_target';
const providerBindingId = 'provider-binding-ugv';
const arguments_ = Object.freeze({ resourceId: 'ugv-1', targetId: 'target-1' });
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
        capabilityAttemptId: attemptId,
        providerBindingId,
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
          riskLevel: 'medium',
        },
        confirmation: {
          confirmationId: 'confirmation-governed-live',
          actorKind: 'human',
        },
      });
      expect(snapshot?.confirmation).not.toHaveProperty('revokedAt');
      expect(snapshot?.confirmation).not.toHaveProperty('revokedBy');
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:00.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).resolves.toMatchObject({
        confirmationId: 'confirmation-governed-live',
        invocationId: 'invocation-governed-control',
        dispatchHash: `sha256:${'d'.repeat(64)}`,
        consumedAt: '2026-08-13T01:01:00.000Z',
      });
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:01.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED' });
      await expect(
        authorizer(afterIssueRestart.repository, '2026-08-13T01:01:02.000Z').authorizeAndConsume({
          ...invocation(),
          invocationId: 'invocation-governed-other',
          dispatchHash: `sha256:${'e'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED' });
      const invocationAudit = new PostgresMcpRegistryRepository(afterIssueRestart.pool);
      const auditRecord = {
        invocationId: 'invocation-governed-control',
        taskId,
        capabilityAttemptId: attemptId,
        controlConfirmationId: 'confirmation-governed-live',
        controlProviderBindingId: providerBindingId,
        controlArgumentsHash: argumentsHash,
        controlDispatchHash: `sha256:${'d'.repeat(64)}`,
        contextId: 'context-governed-control',
        executionMode: 'live' as const,
        serverId,
        toolName,
        executionSemantics: invocation().executionSemantics,
        arguments: arguments_,
        status: 'failed' as const,
        errorCode: 'TEST_NO_PROVIDER_DISPATCH',
        errorMessage: 'Deterministic audit fixture; no Provider transport was called.',
        startedAt: '2026-08-13T01:01:00.000Z',
        completedAt: '2026-08-13T01:01:00.000Z',
        durationMs: 0,
      };
      await expect(
        invocationAudit.saveInvocation({
          ...auditRecord,
          invocationId: 'invocation-governed-mismatched',
          controlDispatchHash: `sha256:${'e'.repeat(64)}`,
        }),
      ).rejects.toMatchObject({ code: '23503' });
      await invocationAudit.saveInvocation(auditRecord);
      await expect(invocationAudit.listInvocationsByTask(taskId)).resolves.toContainEqual(
        expect.objectContaining({
          invocationId: 'invocation-governed-control',
          controlConfirmationId: 'confirmation-governed-live',
          controlProviderBindingId: providerBindingId,
          controlArgumentsHash: argumentsHash,
          controlDispatchHash: `sha256:${'d'.repeat(64)}`,
        }),
      );
      expect(physicalDeviceWrites).toBe(0);

      const revocable = confirmationService(
        afterIssueRestart.repository,
        'confirmation-governed-revocable',
        '2026-08-13T01:01:10.000Z',
      );
      await revocable.issue(confirmationInput('2026-08-13T01:05:00.000Z'));
      const revocation = new GovernedControlConfirmationService({
        store: afterIssueRestart.repository,
        clock: { now: () => '2026-08-13T01:01:30.000Z' },
        ids: { nextConfirmationId: () => 'unused-confirmation-id' },
      });
      await expect(
        revocation.revoke({
          confirmationId: 'confirmation-governed-revocable',
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
        authorizer(afterRevokeRestart.repository, '2026-08-13T01:02:00.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID' });
      await expect(
        afterRevokeRestart.repository.load({
          taskId,
          capabilityAttemptId: attemptId,
          providerBindingId,
          serverId,
          toolName,
          argumentsHash,
        }),
      ).resolves.toMatchObject({
        confirmation: {
          confirmationId: 'confirmation-governed-revocable',
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
        authorizer(afterExpiryRestart.repository, '2026-08-13T01:04:00.000Z').authorizeAndConsume(
          invocation(),
        ),
      ).rejects.toMatchObject({ code: 'GOVERNED_CONTROL_CONFIRMATION_INVALID' });
      await expect(
        afterExpiryRestart.repository.load({
          taskId,
          capabilityAttemptId: attemptId,
          providerBindingId,
          serverId,
          toolName,
          argumentsHash,
        }),
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
    capabilityAttemptId: attemptId,
    planId,
    planHash,
    skillId,
    skillVersion,
    providerBindingId,
    serverId,
    toolName,
    argumentsHash,
    actorId: 'human:operator-1',
    actorKind: 'human' as const,
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve one bounded deterministic UGV tracking Task.',
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
    capabilityAttemptId: attemptId,
    planId,
    planHash,
    skillId,
    skillVersion,
    providerBindingId,
    serverId,
    toolName,
    argumentsHash,
    actorId: 'human:operator-1',
    actorKind: 'human',
    authenticationMethod: 'oidc-mfa',
    actorRoles: ['physical_control_approver'],
    reason: 'Approve one bounded deterministic UGV tracking Task.',
    confirmedAt: '2026-08-13T01:00:00.000Z',
    expiresAt,
  };
}

function invocation() {
  return {
    invocationId: 'invocation-governed-control',
    dispatchHash: `sha256:${'d'.repeat(64)}`,
    taskId,
    capabilityAttemptId: attemptId,
    providerBindingId,
    serverId,
    toolName,
    arguments: arguments_,
    executionSemantics: controlExecutionSemantics(),
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
      risk_level: 'medium',
      supported_modes: ['plan_confirmed', 'remote_task'],
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
        provider_policy_override: {
          selection: 'required',
          mcpProviderBindingId: providerBindingId,
          localServerId: serverId,
          mcpToolName: toolName,
          allowedResourceIds: ['ugv-1'],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
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
    `INSERT INTO mcp_server(
       server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
       created_at,updated_at)
     VALUES($1,'Governed Control Provider','https://provider.invalid/mcp','streamable_http',
            'enabled',1,'encrypted-test-only','2026-08-13T01:00:00.000Z',
            '2026-08-13T01:00:00.000Z')`,
    [serverId],
  );
  await pool.query(
    `INSERT INTO mcp_tool(server_id,tool_name,input_schema_json,discovered_at)
     VALUES($1,$2,'{"type":"object"}'::jsonb,'2026-08-13T01:00:00.000Z')`,
    [serverId, toolName],
  );
  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('context-governed-control','human:operator-1',
            '2026-08-13T01:00:00.000Z','2026-08-13T01:00:00.000Z')`,
  );
  await pool.query(
    `INSERT INTO goal(
       goal_id,context_id,version,title,description,status,created_at,updated_at)
      VALUES('goal-governed-control','context-governed-control',1,
             'Bounded UGV tracking','Track one deterministic UGV target.','active',
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
      VALUES($1,$2,'Governed UGV Target Tracking','Bounded physical UGV tracking.',
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
        sideEffectPolicy: {
          sideEffecting: true,
          confirmation: 'required_before_execution',
          autoConfirmPlan: false,
          allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
          realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
          exactResourceRequired: true,
          remoteTaskIdentityRequired: true,
          terminalObservationRequired: true,
          redispatchAfterUncertain: false,
        },
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
        title: 'Bounded UGV tracking',
        description: 'Track one deterministic UGV target.',
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
        title: 'Bounded UGV tracking',
        description: 'Track one deterministic UGV target.',
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
      VALUES($1,'context-governed-control','human:operator-1','Track target-1 with ugv-1.',
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
      JSON.stringify([{ type: 'remote_task_terminal', required: true }]),
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
             $1,$2,$3::jsonb,$4,'{"available":true}'::jsonb,'available','medium','none',
            '2026-08-13T01:10:00.000Z','catalog-governed-control-v1',
            '2026-08-13T01:00:30.000Z','[]'::jsonb)`,
    [serverId, toolName, JSON.stringify(arguments_), argumentsHash],
  );
}

function controlConstraints() {
  return [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['ugv-1'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: toolName,
      allowedResourceIds: ['ugv-1'],
      executionSemantics: controlExecutionSemantics(),
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    { type: 'exact_skill_version', skillId, skillVersion, taskType: toolName },
    {
      type: 'confirmation_policy',
      required: true,
      stage: 'before_execution',
      autoConfirmPlan: false,
    },
    {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      allowEnvironment: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
      runIdEnvironment: 'REAL_UGV_TEST_RUN_ID',
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    },
  ];
}

function controlExecutionSemantics() {
  return {
    effect: 'side_effecting' as const,
    execution: 'task_required' as const,
    cancellation: 'task_cancel' as const,
    idempotency: 'server_managed' as const,
    replay: 'forbidden' as const,
    source: 'mcp_declared' as const,
  };
}
