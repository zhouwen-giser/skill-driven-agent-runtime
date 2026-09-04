import { describe, expect, it } from 'vitest';

import type {
  CanonicalEvidenceEnvelope,
  EpisodeEvidenceManifest,
  EvidenceQualityIssue,
  EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  ControlEnrichedMcpCapabilityEvidenceSource,
  McpCapabilityEvidenceProjector,
  type McpCapabilityEvidenceSnapshot,
  type RuntimeCoreEvidenceWriter,
} from '../src/index.js';

describe('McpCapabilityEvidenceProjector', () => {
  it('enriches Runtime bindings through the Control authority and exact governance evidence ref', async () => {
    const base = snapshot();
    const revisionRef = `evidence_${'9'.repeat(64)}`;
    const source = new ControlEnrichedMcpCapabilityEvidenceSource({
      runtime: {
        pendingTaskIds: () => Promise.resolve(['task-evidence']),
        load: () =>
          Promise.resolve({
            ...base,
            definitions: [],
            implementationBindings: [],
            existingEvidence: [
              ...base.existingEvidence,
              {
                record_id: revisionRef,
                record_type: 'node_control.capability_revision',
                source_record_id: 'cap-a:1',
                payload: { capabilityId: 'cap-a', version: 1 },
              },
            ],
          }),
      },
      authority: {
        load: () =>
          Promise.resolve({
            definition: base.definitions?.[0] ?? {},
            implementationBindings: base.implementationBindings ?? [],
          }),
      },
    });

    const enriched = await source.load('task-evidence');

    expect(enriched?.definitions?.[0]).toMatchObject({
      capability_id: 'cap-a',
      node_control_revision_record_id: revisionRef,
    });
    expect(enriched?.implementationBindings).toHaveLength(1);
  });

  it('projects MCP Task consumer recovery and Capability record types with exact lifecycle semantics', async () => {
    const writer = new MemoryWriter();
    const projector = new McpCapabilityEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () => Promise.resolve(snapshot()),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T08:00:00.000Z' },
    });

    const result = await projector.projectTask('task-evidence');

    expect(new Set(writer.records.map((record) => record.recordType))).toEqual(
      new Set([
        'mcp_task.tool_call',
        'mcp_task.availability',
        'mcp_task.remote_binding',
        'mcp_task.logical_invocation',
        'mcp_task.admission',
        'mcp_task.dispatch_uncertain',
        'mcp_task.dispatch_reconciliation',
        'mcp_task.provider_execution_link',
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
    expect(writer.issues).toEqual([]);
    expect(result.projectedRecordIds).toHaveLength(23);
    expect(record(writer, 'mcp_task.tool_call').payload).toMatchObject({
      toolCallLifecycle: 'ended_after_task_handle_returned',
    });
    expect(record(writer, 'mcp_task.observation').payload).toMatchObject({
      workflowTrigger: false,
    });
    expect(record(writer, 'mcp_task.control_event').payload).toMatchObject({
      persistedBeforeContinue: true,
    });
    expect(record(writer, 'mcp_task.continuation_attempt').payload).toMatchObject({
      resumePosition: 'saved_continuation_not_start',
      completedSideEffectReplay: false,
    });
    expect(record(writer, 'mcp_task.dispatch_uncertain').payload).toMatchObject({
      logicalInvocationId: `mcp-logical-${'1'.repeat(64)}`,
      redispatchAllowed: false,
    });
    expect(record(writer, 'mcp_task.dispatch_reconciliation').payload).toMatchObject({
      status: 'found_exact',
      externalExecutionId: 'provider-execution-a',
      redispatchAllowed: false,
    });
    expect(record(writer, 'mcp_task.provider_execution_link').payload).toMatchObject({
      providerId: 'isr.vehicle.ugv.ugv1',
      runtimeServerId: 'ugv-smpp-runtime',
      providerBindingId: 'mcp-binding-ugv-smpp',
      providerOriginType: 'smpp_registry',
      smppSourceId: 'smpp-source-ugv',
      externalServerId: 'ugv1',
      externalExecutionId: 'provider-execution-a',
      missionStatus: 'unresolved',
      deviceMissionId: null,
      sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
      sourceRevision: 'binding:2/catalog:2',
    });
    expect(record(writer, 'mcp_task.cancel').payload).toMatchObject({
      deliveryStatus: 'uncertain',
      cancelConfirmation: 'requested_or_uncertain',
    });
    expect(record(writer, 'capability.task_binding').payload).toMatchObject({
      inputSnapshot: { zone: 'A' },
      successCriteriaSnapshot: [{ id: 'done' }],
      evidenceRequirementSnapshot: [{ id: 'receipt' }],
      constraintSnapshot: [{ id: 'safe' }],
      initialImplementationRefs: [{ skillId: 'skill-a', version: 1 }],
      providerPolicySnapshot: { provider: 'primary' },
      bindingHash: 'a'.repeat(64),
    });
  });

  it('keeps provider completion as receipt and requires Goal verification', async () => {
    const writer = new MemoryWriter();
    const value = snapshot();
    const projector = new McpCapabilityEvidenceProjector({
      source: {
        pendingTaskIds: () => Promise.resolve([]),
        load: () =>
          Promise.resolve({
            ...value,
            controlEvents: value.controlEvents.map((row) => ({
              ...row,
              event_type: 'task.completed',
              payload_json: { receipt: { status: 'completed' }, goalVerification: 'pending' },
            })),
          }),
      },
      writer,
      environment: 'test',
      clock: { now: () => '2026-08-04T08:00:00.000Z' },
    });

    await projector.projectTask('task-evidence');

    expect(record(writer, 'mcp_task.control_event').payload).toMatchObject({
      payload: { receipt: { status: 'completed' }, goalVerification: 'pending' },
    });
    expect(
      writer.records.some(
        (item) => item.recordType === 'runtime.verification' && item.sourceSystem === 'runtime',
      ),
    ).toBe(false);
  });
});

class MemoryWriter implements RuntimeCoreEvidenceWriter {
  readonly records: CanonicalEvidenceEnvelope[] = [];
  readonly issues: EvidenceQualityIssue[] = [];
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
  saveManifest(_manifest: EpisodeEvidenceManifest): Promise<void> {
    void _manifest;
    return Promise.resolve();
  }
  resolveQualityIssues(): Promise<void> {
    return Promise.resolve();
  }
}

function record(writer: MemoryWriter, type: string): CanonicalEvidenceEnvelope {
  const result = writer.records.find((item) => item.recordType === type);
  if (result === undefined) throw new Error(`Missing fixture record ${type}.`);
  return result;
}

function snapshot(): McpCapabilityEvidenceSnapshot {
  const at = '2026-08-04T07:00:00.000Z';
  const evidence = (
    recordType: string,
    sourceRecordId: string,
    character: string,
    payload = {},
  ) => ({
    record_id: `evidence_${character.repeat(64)}`,
    record_type: recordType,
    source_record_id: sourceRecordId,
    payload,
  });
  const definition = evidence('capability.definition', 'cap-a:1', 'd');
  return {
    task: { task_id: 'task-evidence', context_id: 'context-evidence' },
    invocations: [
      {
        invocation_id: 'invocation-a',
        task_id: 'task-evidence',
        server_id: 'provider-a',
        tool_name: 'tasks/run',
        arguments_json: { zone: 'A' },
        result_json: { taskId: 'remote-a' },
        status: 'succeeded',
        error_code: null,
        started_at: at,
        completed_at: at,
        duration_ms: 1,
      },
    ],
    availability: [
      {
        snapshot_id: 'availability-a',
        server_id: 'provider-a',
        operation_name: 'tasks/run',
        availability: 'available',
        risk_level: 'low',
        reservation_mode: 'none',
        reservation_ref: null,
        valid_until: at,
        result_json: { available: true },
        checked_at: at,
      },
    ],
    bindings: [
      {
        binding_id: 'remote-binding-a',
        mcp_invocation_id: 'invocation-a',
        remote_task_id: 'remote-a',
        version: 1,
        protocol_status: 'working',
        local_state: 'polling',
        created_at: at,
      },
    ],
    admissions: [
      {
        intent_id: 'admission-a',
        invocation_id: 'invocation-a',
        binding_id: 'remote-binding-a',
        logical_invocation_id: `mcp-logical-${'1'.repeat(64)}`,
        logical_identity_hash: `sha256:${'1'.repeat(64)}`,
        arguments_hash: '2'.repeat(64),
        reconciliation_contract_json: {
          schemaVersion: 'sdar.remote-task-reconciliation-contract/v1',
          dispatchStartedAt: at,
          logicalIdentity: {
            schemaVersion: 'sdar.mcp-logical-invocation/v1',
            logicalInvocationId: `mcp-logical-${'1'.repeat(64)}`,
            identityHash: `sha256:${'1'.repeat(64)}`,
            argumentsHash: '2'.repeat(64),
          },
        },
        status: 'materialized',
        dispatch_hash: `sha256:${'3'.repeat(64)}`,
        dispatched_at: at,
        reason_code: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
        created_at: at,
        updated_at: at,
      },
    ],
    reconciliationAttempts: [
      {
        attempt_id: 'reconciliation-a',
        intent_id: 'admission-a',
        logical_invocation_id: `mcp-logical-${'1'.repeat(64)}`,
        expected_intent_version: 3,
        status: 'found_exact',
        identity_validated: true,
        remote_task_id: 'remote-a',
        external_execution_id: 'provider-execution-a',
        safe_error_code: null,
        source_contract: 'sdar.smpp-diagnostics/v1+frozen-mcp-v1',
        request_hash: `sha256:${'4'.repeat(64)}`,
        result_hash: `sha256:${'5'.repeat(64)}`,
        started_at: at,
        completed_at: at,
      },
    ],
    providerExecutionLinks: [
      {
        link_id: 'provider-link-a',
        binding_id: 'remote-binding-a',
        logical_invocation_id: `mcp-logical-${'1'.repeat(64)}`,
        remote_task_id: 'remote-a',
        provider_id: 'isr.vehicle.ugv.ugv1',
        runtime_server_id: 'ugv-smpp-runtime',
        provider_binding_id: 'mcp-binding-ugv-smpp',
        provider_origin_type: 'smpp_registry',
        smpp_source_id: 'smpp-source-ugv',
        external_server_id: 'ugv1',
        operation_name: 'tasks/run',
        execution_status: 'exact',
        external_execution_id: 'provider-execution-a',
        mission_status: 'unresolved',
        device_mission_id: null,
        provenance: 'reconcile_found_exact',
        source_contract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
        source_revision: 'binding:2/catalog:2',
        content_hash: `sha256:${'6'.repeat(64)}`,
        observed_at: at,
      },
    ],
    observations: [
      {
        observation_id: 'observation-a',
        binding_id: 'remote-binding-a',
        observation_type: 'task.snapshot',
        observation_source: 'reconciliation',
        runtime_revision: '2',
        provider_revision: 'p2',
        accepted: true,
        payload_json: { status: 'working' },
        observed_at: at,
      },
    ],
    controlEvents: [
      {
        event_id: 'control-a',
        binding_id: 'remote-binding-a',
        event_type: 'task.input_required',
        runtime_revision: '2',
        status: 'processed',
        payload_json: { request: 'approval' },
        created_at: at,
      },
    ],
    pollAttempts: [
      { attempt_id: 'poll-a', binding_id: 'remote-binding-a', status: 'succeeded', started_at: at },
    ],
    inputLinks: [
      {
        input_request_id: 'input-a',
        binding_id: 'remote-binding-a',
        status: 'waiting',
        created_at: at,
      },
    ],
    cancels: [
      {
        cancel_request_id: 'cancel-a',
        binding_id: 'remote-binding-a',
        delivery_status: 'uncertain',
        provider_terminal_status: null,
        requested_at: at,
      },
    ],
    continuationSnapshots: [
      {
        snapshot_id: 'snapshot-a',
        continuation_id: 'continuation-a',
        state_version: 2,
        lifecycle: 'active',
        binding_ids: ['remote-binding-a'],
        created_at: at,
      },
    ],
    continuationAttempts: [
      {
        attempt_id: 'continuation-attempt-a',
        snapshot_id: 'snapshot-a',
        status: 'succeeded',
        created_at: at,
      },
    ],
    definitions: [
      {
        capability_id: 'cap-a',
        version: 1,
        definition_hash: 'b'.repeat(64),
        domain: 'embodied',
        name: 'Inspect',
        input_schema: { type: 'object' },
        output_schema: { type: 'object' },
        success_criteria: [{ id: 'done' }],
        required_evidence: [{ id: 'receipt' }],
        constraints: [{ id: 'safe' }],
        status: 'published',
        updated_at: at,
        node_control_revision_record_id: `evidence_${'c'.repeat(64)}`,
      },
    ],
    implementationBindings: [
      {
        binding_id: 'implementation-a',
        revision: 1,
        capability_id: 'cap-a',
        capability_version: 1,
        implementation_type: 'skill',
        implementation_id: 'skill-a',
        implementation_version: '1',
        role: 'primary',
        priority: 0,
        status: 'active',
        created_at: at,
      },
    ],
    readiness: [
      {
        capability_id: 'cap-a',
        capability_version: 1,
        snapshot_version: 1,
        status: 'available',
        valid_until: at,
        snapshot_hash: `sha256:${'e'.repeat(64)}`,
        reasons: [],
        evaluated_at: at,
      },
    ],
    capabilityBindings: [
      {
        binding_id: 'capability-binding-a',
        task_id: 'task-evidence',
        requested_capability_id: 'cap-a',
        capability_version: 1,
        input_snapshot: { zone: 'A' },
        success_criteria_snapshot: [{ id: 'done' }],
        evidence_requirement_snapshot: [{ id: 'receipt' }],
        constraint_snapshot: [{ id: 'safe' }],
        initial_implementation_refs: [{ skillId: 'skill-a', version: 1 }],
        provider_policy_snapshot: { provider: 'primary' },
        binding_hash: 'a'.repeat(64),
        bound_at: at,
      },
    ],
    capabilityAttempts: [
      {
        attempt_id: 'capability-attempt-a',
        capability_binding_id: 'capability-binding-a',
        attempt_no: 1,
        status: 'succeeded',
        reason: 'initial',
        skill_version_refs: [{ skillId: 'skill-a', version: 1 }],
        provider_binding_refs: [{ providerId: 'provider-a' }],
        started_at: at,
        completed_at: at,
      },
    ],
    exposures: [
      {
        revision: 1,
        exposure_id: 'exposure-a',
        exposure_version: 1,
        capability_id: 'cap-a',
        capability_version: 1,
        agent_skill_id: 'skill-a',
        request_schema: { type: 'object' },
        result_schema: { type: 'object' },
        exposure_hash: 'f'.repeat(64),
      },
    ],
    cardRevisions: [
      {
        revision: 1,
        status: 'active',
        content_hash: '1'.repeat(64),
        capability_catalog_hash: '2'.repeat(64),
        card: { name: 'SDAR' },
        generated_at: at,
      },
    ],
    existingEvidence: [
      evidence('runtime.action', 'invocation-a', 'a'),
      evidence('runtime.episode', 'task-evidence', 'b'),
      evidence('skill.execution', 'execution-a', 's', { skillId: 'skill-a', skillVersion: 1 }),
      definition,
    ],
  };
}
