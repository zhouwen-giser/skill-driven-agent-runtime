import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresTaskCapabilityPhysicalEvidenceRepository } from '../src/index.js';

describe('PostgresTaskCapabilityPhysicalEvidenceRepository', () => {
  it('projects invocation-less attempt-scoped uncertain intents and confirmed plan ordinals', async () => {
    const query = vi.fn((sql: string, parameters: readonly unknown[]) => {
      if (sql.includes('FROM workflow_plan'))
        return Promise.resolve({
          rows: [
            {
              confirmation_status: 'confirmed',
              definition_json: {
                workflowDefinitionId: 'workflow-physical',
                version: 1,
                entryNodeId: 'usage_task_0',
                exitNodeIds: ['usage_result'],
                nodes: [
                  {
                    nodeId: 'usage_task_0',
                    name: 'Dispatch once',
                    type: 'mcp_tool',
                    tool: { serverId: 'provider', toolName: 'vehicle_navigate' },
                    arguments: {},
                    taskExecution: { protocolMode: 'frozen_v1' },
                  },
                  {
                    nodeId: 'usage_result',
                    name: 'Done',
                    type: 'result',
                    value: { op: 'literal', value: true },
                  },
                ],
                edges: [{ sourceNodeId: 'usage_task_0', targetNodeId: 'usage_result' }],
              },
            },
          ],
        });
      expect(parameters).toEqual(['task-physical', 'attempt-physical']);
      return Promise.resolve({
        rows: [
          {
            invocation_id: 'invocation-orphan',
            persisted_invocation_id: null,
            capability_attempt_id: 'attempt-physical',
            confirmation_id: null,
            consumed_invocation_id: null,
            consumed_dispatch_hash: null,
            consumed_at: null,
            revoked_at: null,
            admission_intent_id: 'intent-orphan',
            admission_invocation_id: 'invocation-orphan',
            admission_task_id: 'task-physical',
            admission_capability_attempt_id: 'attempt-physical',
            admission_binding_id: 'binding-orphan',
            admission_recorded_invocation_id: null,
            admission_materialized_binding_id: null,
            admission_arguments_hash: 'a'.repeat(64),
            admission_dispatch_hash: `sha256:${'b'.repeat(64)}`,
            admission_workflow_plan_id: 'plan-physical',
            admission_workflow_node_id: 'usage_task_0',
            admission_workflow_node_run_id: 'usage_task_0:run:1',
            admission_status: 'uncertain',
            admission_reason_code: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
            binding_id: null,
            remote_task_id: null,
            mcp_invocation_id: null,
            workflow_node_id: null,
            workflow_node_run_id: null,
            workflow_plan_id: null,
            workflow_definition_id: null,
            workflow_definition_version: null,
            workflow_instance_id: null,
            remote_execution_mode: null,
            protocol_status: null,
            local_state: null,
            provider_failure_count: null,
            provider_evidence_json: [],
            result_is_error: null,
            last_safe_error_code: null,
            invalidated_at: null,
            binding_created_at: null,
            terminal_at: null,
            accepted_observation_count: 0,
            accepted_observed_at: null,
            unsafe_observation_count: 0,
            failed_protocol_attempt_count: 0,
            terminal_event_count: 0,
            processed_completed_event_count: 0,
            terminal_event_created_at: null,
            terminal_event_processed_at: null,
            terminal_event_status: null,
            terminal_event_error_code: null,
            continuation_attempt_count: 0,
            waiting_external_continuation_count: 0,
            succeeded_continuation_count: 0,
          },
        ],
      });
    });
    const repository = new PostgresTaskCapabilityPhysicalEvidenceRepository({
      query,
    } as unknown as Pool);

    await expect(
      repository.loadPhysicalEvidence({
        taskId: 'task-physical',
        capabilityAttemptId: 'attempt-physical',
        planId: 'plan-physical',
      }),
    ).resolves.toMatchObject({
      plan: {
        planId: 'plan-physical',
        confirmationStatus: 'confirmed',
        nodes: [
          { nodeId: 'usage_task_0', ordinal: 1, taskRequired: true },
          { nodeId: 'usage_result', ordinal: 2, taskRequired: false },
        ],
      },
      dispatches: [
        {
          invocationId: 'invocation-orphan',
          invocationPresent: false,
          capabilityAttemptId: 'attempt-physical',
          admission: {
            intentId: 'intent-orphan',
            status: 'uncertain',
            reasonCode: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
          },
        },
      ],
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain(
      'FULL OUTER JOIN remote_task_admission_intent admission',
    );
  });
});
