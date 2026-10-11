import type { Pool } from 'pg';
import { createRemoteTaskBinding, hashCanonicalEvidenceJson } from '../../domain/src/index.js';
import { taskBusinessFixture } from '../../domain/test/task-business-fixture.js';
import { businessMutationPolicy } from '../../domain/test/task-business-command-fixture.js';
import { PostgresRemoteTaskRepository, PostgresTaskBusinessRepository } from '../src/index.js';
import { TaskBusinessSyncService } from '../../application/src/task-business-sync.js';
import type { TaskBusinessView } from '../../domain/src/task-business.js';

// Fixture-only schema writes in a freshly created loopback database; never used in a site or GOWM.
export async function taskBusinessControlFixture(pool: Pool, tag: string) {
  if (!/^[a-z0-9-]+$/u.test(tag)) throw new Error('INVALID_TEST_TAG');
  const taskId = `${tag}-task`;
  const planId = `${tag}-plan`;
  const bindingId = `${tag}-capability-binding`;
  const attemptId = `${tag}-capability-attempt`;
  const capabilityId = `${tag}-capability`;
  const capabilityVersion = 1;
  const skillId = `${tag}-skill`;
  const skillVersion = 1;
  const serverId = `${tag}-server`;
  const toolName = 'vehicle_navigate';
  const providerBindingId = `${tag}-provider-binding`;
  const providerId = 'isr.vehicle.ugv.ugv';
  const arguments_ = {
    resourceId: 'vehicle:ugv',
    mission: { type: 'point', target: { longitude: 106.8, latitude: 29.7 } },
  };
  const planDefinition = {
    workflowDefinitionId: `${tag}-workflow`,
    version: 1,
    goalId: `${tag}-goal`,
    goalVersion: 1,
    entryNodeId: 'move-ugv',
    exitNodeIds: ['move-ugv'],
    nodes: [
      {
        nodeId: 'move-ugv',
        name: 'Move once',
        type: 'mcp_tool',
        serverId,
        toolName,
        arguments: { op: 'literal', value: arguments_ },
      },
    ],
    edges: [],
  };
  const planHash = hashCanonicalEvidenceJson(planDefinition).slice(7);
  const readinessArguments = { unresolved: false, value: arguments_ };
  const readinessArgumentsHash = hashCanonicalEvidenceJson(readinessArguments).slice(7);
  const constraints = [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['vehicle:ugv'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: providerBindingId,
      localServerId: serverId,
      mcpToolName: toolName,
      allowedResourceIds: ['vehicle:ugv'],
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
    businessMutationPolicy,
  ];
  const outcomeSpecification = {
    schemaVersion: '1.0',
    skillId,
    skillVersion,
    effects: ['effect.smpp.business'],
    evidence: ['evidence.smpp.business'],
    artifacts: [],
    taskGoalPolicy: {},
    confidencePolicy: {},
    sideEffectPolicy: {
      sideEffecting: true,
      classification: 'physical_control',
      confirmation: 'required_before_execution',
      autoConfirmPlan: false,
      allowRealSideEffectsEnv: 'ALLOW_REAL_UGV_SIDE_EFFECTS',
      realTestRunIdEnv: 'REAL_UGV_TEST_RUN_ID',
      exactResourceRequired: true,
      remoteTaskIdentityRequired: true,
      terminalObservationRequired: true,
      redispatchAfterUncertain: false,
    },
  };

  await pool.query(
    `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
     VALUES('${tag}-context','human:operator-1',
            clock_timestamp(),clock_timestamp())`,
  );
  await pool.query(
    `INSERT INTO goal(
       goal_id,context_id,version,title,description,status,created_at,updated_at)
      VALUES('${tag}-goal','${tag}-context',1,
             'Bounded UGV movement','Move one deterministic UGV.','active',
            clock_timestamp(),clock_timestamp())`,
  );
  await pool.query(
    `INSERT INTO skill(skill_id,current_version,created_at,updated_at)
     VALUES($1,$2,clock_timestamp(),clock_timestamp())`,
    [skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO skill_version(
       skill_id,version,name,summary,description,capabilities_json,workflow_guidance,
       output_instruction,input_schema_json,output_schema_json,tool_policy_json,
       runtime_policy_json,status,source_kind,validation_passed,created_at)
      VALUES($1,$2,'Governed UGV Movement','Bounded physical UGV movement.',
       'Requires exact Task, Capability, plan, readiness, Provider and human confirmation.',
       $3::jsonb,'Invoke the exact required Tool once.','Return confirmed state evidence.',
       '{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,$4::jsonb,$5::jsonb,
       'enabled','admin',true,clock_timestamp())`,
    [
      skillId,
      skillVersion,
      JSON.stringify([capabilityId]),
      JSON.stringify({
        required: [{ serverId, toolName }],
        optional: [],
        forbidden: [{ serverId, toolName: 'vehicle_fire_weapon' }],
      }),
      JSON.stringify({
        autoConfirmPlan: false,
        maxMcpCalls: 1,
        taskBusinessMutationPolicy: businessMutationPolicy,
      }),
    ],
  );
  await pool.query(
    `INSERT INTO runtime_skill_version_governance(
       skill_id,skill_version,lifecycle_status,lock_version,updated_by,reason,created_at,updated_at)
     VALUES($1,$2,'published',1,'human:operator-1','Approved exact bounded fixture.',
            clock_timestamp(),clock_timestamp())`,
    [skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO skill_outcome_specification(
       skill_id,skill_version,schema_version,specification_hash,specification_json,created_at)
     VALUES($1,$2,'1.0',$3,$4::jsonb,clock_timestamp())`,
    [
      skillId,
      skillVersion,
      hashCanonicalEvidenceJson(outcomeSpecification),
      JSON.stringify(outcomeSpecification),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan(
       plan_id,goal_id,goal_version,goal_contract_json,definition_json,
       confirmation_status,attempt_count,created_at)
     VALUES($1,'${tag}-goal',1,$2::jsonb,$3::jsonb,
            'confirmed',1,clock_timestamp())`,
    [
      planId,
      JSON.stringify({
        goalId: `${tag}-goal`,
        version: 1,
        title: 'Bounded UGV movement',
        description: 'Move one deterministic UGV.',
        constraints: [],
        successCriteria: [],
      }),
      JSON.stringify(planDefinition),
    ],
  );
  await pool.query(
    `INSERT INTO workflow_plan_attempt(
       plan_id,attempt,goal_contract_json,candidate_json,validation_errors_json,valid,created_at)
     VALUES($1,1,$2::jsonb,$3::jsonb,'[]'::jsonb,true,clock_timestamp())`,
    [
      planId,
      JSON.stringify({
        goalId: `${tag}-goal`,
        version: 1,
        title: 'Bounded UGV movement',
        description: 'Move one deterministic UGV.',
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
      VALUES($1,'${tag}-context','human:operator-1','Move ugv-1 to the bounded map target.',
            '{}'::jsonb,'executing','Executing governed control.','${tag}-goal',1,
            $2,$3,$4,clock_timestamp(),clock_timestamp())`,
    [taskId, planId, skillId, skillVersion],
  );
  await pool.query(
    `INSERT INTO workflow_control(
       control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,input_json,
       skill_ids_json,planning_instruction,round_count,replan_count,created_at,updated_at)
     VALUES('${tag}-control','${tag}-context',
            '${tag}-goal',1,$1,'running',$2,$3::jsonb,$4::jsonb,
            'Run the bounded governed-control fixture.',0,0,
            clock_timestamp(),clock_timestamp())`,
    [taskId, planId, JSON.stringify(arguments_), JSON.stringify([skillId])],
  );
  await pool.query(
    `INSERT INTO workflow_instance(
       instance_id,plan_id,workflow_definition_id,workflow_version,goal_id,goal_version,
       status,input_json,errors_json,started_at)
     VALUES('${tag}-instance',$1,'${tag}-workflow',1,
            '${tag}-goal',1,'running',$2::jsonb,'{}'::jsonb,
            clock_timestamp())`,
    [planId, JSON.stringify(arguments_)],
  );
  await pool.query(
    `INSERT INTO task_capability_binding(
       binding_id,task_id,requested_capability_id,capability_version,
       input_snapshot,success_criteria_snapshot,evidence_requirement_snapshot,
       constraint_snapshot,initial_implementation_refs,binding_hash,bound_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,
            clock_timestamp())`,
    [
      bindingId,
      taskId,
      capabilityId,
      capabilityVersion,
      JSON.stringify(arguments_),
      JSON.stringify([{ type: 'remote_task_terminal', required: true }]),
      JSON.stringify([
        {
          type: 'required_evidence',
          evidenceType: 'position.observation',
          required: true,
          hardGate: true,
        },
      ]),
      JSON.stringify(constraints),
      JSON.stringify([`skill:${skillId}:${String(skillVersion)}`]),
      hashCanonicalEvidenceJson({
        taskId,
        bindingId,
        capabilityId,
        capabilityVersion,
        inputSnapshot: arguments_,
        constraints,
      }).slice(7),
    ],
  );
  await pool.query(
    `INSERT INTO task_capability_execution_attempt(
       attempt_id,task_id,capability_binding_id,attempt_no,plan_id,skill_version_refs,
       provider_binding_refs,reason,status,started_at)
     VALUES($1,$2,$3,1,$4,$5::jsonb,$6::jsonb,'initial','running',
            clock_timestamp())`,
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
     VALUES('${tag}-readiness',$1,1,'pre_invocation',
            '${tag}-instance','move-ugv:1',$2,'ready',
            '["execute"]'::jsonb,'proceed','[]'::jsonb,false,
            clock_timestamp())`,
    [planId, planHash],
  );
  await pool.query(
    `INSERT INTO task_availability_snapshot(
       snapshot_id,readiness_id,node_id,server_id,operation_name,
       arguments_snapshot_json,arguments_hash,result_json,availability,risk_level,
       reservation_mode,valid_until,source_revision,checked_at,normalization_reason_codes_json)
     VALUES('${tag}-availability','${tag}-readiness','move-ugv',
             $1,$2,$3::jsonb,$4,'{"available":true}'::jsonb,'available','medium','none',
            clock_timestamp(),'catalog-governed-control-v1',
            clock_timestamp(),'[]'::jsonb)`,
    [serverId, toolName, JSON.stringify(readinessArguments), readinessArgumentsHash],
  );

  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO mcp_server(server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,created_at,updated_at) VALUES($1,'Isolated task business','http://127.0.0.1:1/mcp','streamable_http','enabled',1,'encrypted-test-only',$2,$2)`,
    [serverId, now],
  );
  const invocationId = `${tag}-invocation`;
  await pool.query(
    `INSERT INTO mcp_invocation(invocation_id,task_id,context_id,server_id,tool_name,arguments_json,result_json,status,started_at,completed_at,duration_ms,execution_mode) VALUES($1,$2,$3,$4,$5,$6::jsonb,'{}'::jsonb,'succeeded',$7,$7,1,'live')`,
    [invocationId, taskId, `${tag}-context`, serverId, toolName, JSON.stringify(arguments_), now],
  );
  const remote = new PostgresRemoteTaskRepository(pool);
  const admitted = await remote.admit(
    createRemoteTaskBinding({
      bindingId: `${tag}-remote`,
      serverId,
      operationName: toolName,
      remoteTaskId: `${tag}-provider-task`,
      agentTaskId: taskId,
      contextId: `${tag}-context`,
      goalId: `${tag}-goal`,
      goalVersion: 1,
      workflowPlanId: planId,
      workflowDefinitionId: `${tag}-workflow`,
      workflowDefinitionVersion: 1,
      workflowInstanceId: `${tag}-instance`,
      workflowNodeId: 'move-ugv',
      workflowNodeRunId: 'move-ugv:1',
      mcpInvocationId: invocationId,
      protocolStatus: 'working',
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'tasks-schema-v13',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: '2026-07-28',
        baselineSha256: 'a'.repeat(64),
        serverDiscoverySnapshotId: `${tag}-discovery`,
      },
      taskBehavior: 'server_directed',
      taskCancellation: 'task_cancel',
      runtimeRevision: '1',
      executionContext: { mode: 'live' },
      authoritySnapshot: {
        schemaVersion: '1.0',
        capturedAt: now,
        runtime: {
          serverId,
          endpoint: 'http://127.0.0.1:1/mcp',
          serverUpdatedAt: now,
          toolRevision: 1,
          protocolSnapshotId: `${tag}-discovery`,
          catalogRevision: 'catalog-v13',
          catalogChecksum: 'c'.repeat(64),
          operationCount: 1,
        },
        providerBinding: {
          bindingId: providerBindingId,
          revision: 1,
          originType: 'direct',
          providerId,
          endpointRef: 'http://127.0.0.1:1/mcp',
          catalogRevision: 'catalog-v13',
          catalogChecksum: 'c'.repeat(64),
          operationCount: 1,
          availabilityValidUntil: new Date(Date.now() + 600000).toISOString(),
          observedAt: now,
        },
      },
      credentialRevision: now,
      sessionRevision: 'session-v13',
      lastProviderUpdatedAt: now,
      pollIntervalMs: 1000,
      createdAt: now,
    }),
    `${tag}-admission`,
  );
  const original = taskBusinessFixture({
    taskId: admitted.binding.remoteTaskId,
    providerId,
    resourceId: 'vehicle:ugv',
    operationName: toolName,
  });
  let view: TaskBusinessView = {
    ...original,
    context: {
      ...original.context,
      state: 'in_progress',
      effectivePlanRevision: 4,
      artifactRefs: [{ kind: 'artifact', id: 'route-line', revision: 1 }],
      requiredInputRefs: [],
      interventionRefs: [{ kind: 'intervention', id: 'intervention-1', revision: 1 }],
      activeRefs: {
        route: { kind: 'artifact', id: 'route-line', revision: 1 },
        navigationAdjustment: { kind: 'intervention', id: 'intervention-1', revision: 1 },
      },
    },
    objects: original.objects
      .filter((object) => object.kind !== 'input_request')
      .map((object) =>
        object.kind === 'intervention'
          ? {
              ...object,
              value: {
                ...object.value,
                state: 'available',
                revision: 1,
                validUntil: new Date(Date.now() + 300000).toISOString(),
                inputSchema: {
                  type: 'object',
                  required: ['waypoints', 'density'],
                  additionalProperties: false,
                  properties: {
                    waypoints: { type: 'array', minItems: 1 },
                    density: { enum: ['normal', 'fine'] },
                  },
                },
              },
            }
          : object,
      ),
  };
  const business = new PostgresTaskBusinessRepository(pool);
  const reader = {
    readRemoteTaskBusinessContext: () => Promise.resolve(view),
    readRemoteTaskBusinessArtifact: ({
      artifactId,
      revision,
    }: {
      artifactId: string;
      revision: number;
    }) =>
      Promise.resolve({
        artifact: view.objects.find(
          (object) =>
            object.kind === 'artifact' &&
            object.value['artifactId'] === artifactId &&
            object.value.revision === revision,
        )?.value,
      }),
    readRemoteTaskBusinessArtifactContent: () =>
      Promise.resolve(
        Buffer.from('{"type":"LineString","coordinates":[[106.8,29.7],[106.9,29.8]]}'),
      ),
  };
  const sync = new TaskBusinessSyncService({
    repository: business,
    reader,
    clock: { now: () => new Date().toISOString() },
  });
  await sync.refresh(admitted.binding.bindingId);
  return {
    taskId,
    planId,
    bindingId,
    attemptId,
    capabilityId,
    skillId,
    serverId,
    providerBindingId,
    remote,
    business,
    sync,
    reader,
    constraints,
    remoteBindingId: admitted.binding.bindingId,
    identity: view.context.identity,
    get view() {
      return view;
    },
    set view(value: TaskBusinessView) {
      view = value;
    },
  };
}
