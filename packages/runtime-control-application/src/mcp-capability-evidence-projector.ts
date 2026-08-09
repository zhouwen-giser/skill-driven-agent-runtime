import {
  EVIDENCE_RECORD_CATALOG,
  createCanonicalEvidenceEnvelope,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EvidenceJsonValue,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import type {
  RuntimeCoreEvidenceWriter,
  RuntimeCoreSourceRow,
} from './runtime-core-evidence-projector.js';

export const MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION = '1.4.1' as const;

export interface McpCapabilityEvidenceSnapshot {
  readonly task: RuntimeCoreSourceRow;
  readonly invocations: readonly RuntimeCoreSourceRow[];
  readonly availability: readonly RuntimeCoreSourceRow[];
  readonly bindings: readonly RuntimeCoreSourceRow[];
  readonly observations: readonly RuntimeCoreSourceRow[];
  readonly controlEvents: readonly RuntimeCoreSourceRow[];
  readonly pollAttempts: readonly RuntimeCoreSourceRow[];
  readonly inputLinks: readonly RuntimeCoreSourceRow[];
  readonly cancels: readonly RuntimeCoreSourceRow[];
  readonly continuationSnapshots: readonly RuntimeCoreSourceRow[];
  readonly continuationAttempts: readonly RuntimeCoreSourceRow[];
  readonly definitions?: readonly RuntimeCoreSourceRow[];
  readonly implementationBindings?: readonly RuntimeCoreSourceRow[];
  readonly readiness: readonly RuntimeCoreSourceRow[];
  readonly capabilityBindings: readonly RuntimeCoreSourceRow[];
  readonly capabilityAttempts: readonly RuntimeCoreSourceRow[];
  readonly exposures: readonly RuntimeCoreSourceRow[];
  readonly cardRevisions: readonly RuntimeCoreSourceRow[];
  readonly existingEvidence: readonly RuntimeCoreSourceRow[];
}

export interface McpCapabilityEvidenceSource {
  pendingTaskIds(limit: number): Promise<readonly string[]>;
  load(taskId: string): Promise<McpCapabilityEvidenceSnapshot | undefined>;
}

export interface McpCapabilityEvidenceWriter extends RuntimeCoreEvidenceWriter {
  resolveQualityIssues(
    input: Readonly<{
      episodeId: string;
      recordTypePrefix: string;
      retainedIssueIds: readonly string[];
      resolvedAt: string;
    }>,
  ): Promise<void>;
}

export interface McpCapabilityProjectionResult {
  readonly taskId: string;
  readonly projectedRecordIds: readonly string[];
  readonly qualityIssueIds: readonly string[];
  readonly lastEvidenceSequence: string;
}

interface McpCapabilityEmitInput {
  readonly type: string;
  readonly sourceId: string;
  readonly revision: EvidenceJsonValue;
  readonly occurredAt: string;
  readonly payload: RuntimeCoreSourceRow;
  readonly refs: readonly string[];
  readonly capabilityBindingId?: string;
  readonly remoteTaskBindingId?: string;
  readonly skillExecutionId?: string;
}

export class McpCapabilityEvidenceProjector {
  readonly #source: McpCapabilityEvidenceSource;
  readonly #writer: McpCapabilityEvidenceWriter;
  readonly #environment: string;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    input: Readonly<{
      source: McpCapabilityEvidenceSource;
      writer: McpCapabilityEvidenceWriter;
      environment: string;
      clock?: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#environment = requiredText(input.environment, 'environment');
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async projectTask(taskId: string): Promise<McpCapabilityProjectionResult> {
    const cleanTaskId = requiredText(taskId, 'taskId');
    const snapshot = await this.#source.load(cleanTaskId);
    if (snapshot === undefined)
      throw new Error(`MCP/Capability task ${cleanTaskId} was not found.`);
    const recordedAt = this.#clock.now();
    const partition = `mcp-capability:${cleanTaskId}`;
    const contextId = optionalText(snapshot.task, 'context_id');
    const projected = new Map<string, CanonicalEvidenceEnvelope>();
    const sequences: string[] = [];
    const issueIds: string[] = [];
    const existing = (type: string, sourceId?: string) => {
      const match = snapshot.existingEvidence.find(
        (row) =>
          row['record_type'] === type &&
          (sourceId === undefined || row['source_record_id'] === sourceId),
      );
      return optionalText(match, 'record_id');
    };
    const ref = (type: string, sourceId: string) =>
      projected.get(`${type}:${sourceId}`)?.recordId ?? existing(type, sourceId);
    const issue = async (
      recordType: string,
      sourceTable: string,
      sourceRecordId: string,
      detail: RuntimeCoreSourceRow,
    ) => {
      const issueId = `quality_${hashCanonicalEvidenceJson([cleanTaskId, recordType, sourceTable, sourceRecordId, detail]).slice(7)}`;
      const value: EvidenceQualityIssue = {
        issueId,
        issueCode: 'reference_unresolved',
        severity: 'blocking',
        recordType,
        episodeId: cleanTaskId,
        sourceSystem: sourceTable.startsWith('sdar_control.') ? 'node_control' : 'runtime',
        sourceTable,
        sourceRecordId,
        detail,
        createdAt: recordedAt,
      };
      await this.#writer.recordQualityIssue(value);
      issueIds.push(issueId);
    };
    const emit = async (input: McpCapabilityEmitInput) => {
      const catalog = EVIDENCE_RECORD_CATALOG.find((entry) => entry.recordType === input.type);
      if (catalog === undefined) throw new Error(`Missing Evidence catalog ${input.type}.`);
      const envelope = createCanonicalEvidenceEnvelope({
        sourceSystem: catalog.sourceSystem,
        sourceTable: catalog.sourceTable,
        sourceRecordId: input.sourceId,
        sourceRevision: hashCanonicalEvidenceJson(sanitizeEvidenceValue(input.revision)),
        schemaName: catalog.schemaName,
        schemaVersion: catalog.schemaVersion,
        recordFamily: catalog.recordFamily,
        recordType: catalog.recordType,
        environment: this.#environment,
        taskId: cleanTaskId,
        ...(contextId === undefined ? {} : { contextId }),
        episodeId: cleanTaskId,
        correlationId: cleanTaskId,
        occurredAt: input.occurredAt,
        recordedAt,
        deliveryGuarantee: catalog.deliveryGuarantee,
        evaluationRole: catalog.evaluationRole,
        evidenceRefs: input.refs,
        ...(input.capabilityBindingId === undefined
          ? {}
          : { capabilityBindingId: input.capabilityBindingId }),
        ...(input.remoteTaskBindingId === undefined
          ? {}
          : { remoteTaskBindingId: input.remoteTaskBindingId }),
        ...(input.skillExecutionId === undefined
          ? {}
          : { skillExecutionId: input.skillExecutionId }),
        payload: sanitizeEvidenceValue(input.payload) as RuntimeCoreSourceRow,
      });
      sequences.push(await this.#writer.append(envelope, recordedAt, partition));
      projected.set(`${input.type}:${input.sourceId}`, envelope);
      return envelope;
    };

    for (const row of snapshot.invocations) {
      const id = text(row, 'invocation_id');
      const action = existing('runtime.action', id);
      if (action === undefined)
        await issue('mcp_task.tool_call', 'mcp_invocation', id, {
          missingReference: 'runtime.action',
        });
      await emit({
        type: 'mcp_task.tool_call',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'completed_at'),
        payload: {
          invocationId: id,
          serverId: value(row, 'server_id'),
          toolName: value(row, 'tool_name'),
          status: value(row, 'status'),
          arguments: value(row, 'arguments_json'),
          result: row['result_json'] ?? null,
          errorCode: row['error_code'] ?? null,
          toolCallLifecycle: 'ended_after_task_handle_returned',
        },
        refs: compact(action),
      });
    }
    for (const row of snapshot.availability) {
      const id = text(row, 'snapshot_id');
      const calls = snapshot.invocations.filter(
        (call) =>
          call['server_id'] === row['server_id'] && call['tool_name'] === row['operation_name'],
      );
      const onlyCall = calls.length === 1 ? calls.at(0) : undefined;
      const callRef =
        onlyCall === undefined
          ? undefined
          : ref('mcp_task.tool_call', text(onlyCall, 'invocation_id'));
      if (callRef === undefined) {
        await issue('mcp_task.availability', 'task_availability_snapshot', id, {
          missingReference: 'mcp_task.tool_call',
          matchingToolCallCount: calls.length,
        });
        continue;
      }
      await emit({
        type: 'mcp_task.availability',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'checked_at'),
        payload: {
          snapshotId: id,
          operationName: value(row, 'operation_name'),
          availability: value(row, 'availability'),
          riskLevel: value(row, 'risk_level'),
          reservationMode: value(row, 'reservation_mode'),
          reservationRef: row['reservation_ref'] ?? null,
          validUntil: row['valid_until'] ?? null,
          result: value(row, 'result_json'),
        },
        refs: [callRef],
      });
    }
    for (const row of snapshot.bindings) {
      const id = text(row, 'binding_id');
      const callRef = ref('mcp_task.tool_call', text(row, 'mcp_invocation_id'));
      if (callRef === undefined)
        await issue('mcp_task.remote_binding', 'remote_task_binding', id, {
          missingReference: 'mcp_task.tool_call',
        });
      await emit({
        type: 'mcp_task.remote_binding',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          bindingId: id,
          remoteTaskId: value(row, 'remote_task_id'),
          version: value(row, 'version'),
          protocolStatus: value(row, 'protocol_status'),
          localState: value(row, 'local_state'),
          taskHandleReturned: true,
        },
        refs: compact(callRef),
        remoteTaskBindingId: id,
      });
    }
    for (const row of snapshot.observations) {
      const id = text(row, 'observation_id');
      const bindingId = text(row, 'binding_id');
      const bindingRef = ref('mcp_task.remote_binding', bindingId);
      if (bindingRef === undefined) {
        await issue('mcp_task.observation', 'remote_task_observation', id, {
          missingReference: 'mcp_task.remote_binding',
        });
        continue;
      }
      await emit({
        type: 'mcp_task.observation',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'observed_at'),
        payload: {
          observationId: id,
          bindingId,
          observationType: value(row, 'observation_type'),
          accepted: value(row, 'accepted'),
          source: row['observation_source'] ?? 'poll',
          payload: value(row, 'payload_json'),
          workflowTrigger: false,
        },
        refs: [bindingRef],
        remoteTaskBindingId: bindingId,
      });
    }
    for (const row of snapshot.controlEvents) {
      const id = text(row, 'event_id');
      const bindingId = text(row, 'binding_id');
      const bindingRef = ref('mcp_task.remote_binding', bindingId);
      if (bindingRef === undefined) {
        await issue('mcp_task.control_event', 'remote_task_control_event', id, {
          missingReference: 'mcp_task.remote_binding',
        });
        continue;
      }
      await emit({
        type: 'mcp_task.control_event',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          eventId: id,
          bindingId,
          eventType: value(row, 'event_type'),
          status: value(row, 'status'),
          persistedBeforeContinue: true,
          payload: value(row, 'payload_json'),
        },
        refs: [bindingRef],
        remoteTaskBindingId: bindingId,
      });
    }
    for (const row of snapshot.pollAttempts)
      await this.#emitMcpChild(
        row,
        'mcp_task.poll_attempt',
        'remote_task_protocol_attempt',
        'attempt_id',
        'started_at',
        'status',
        ref,
        emit,
        issue,
      );
    for (const row of snapshot.inputLinks)
      await this.#emitMcpChild(
        row,
        'mcp_task.input_link',
        'remote_task_input_link',
        'input_request_id',
        'created_at',
        'status',
        ref,
        emit,
        issue,
      );
    for (const row of snapshot.cancels) {
      const status = value(row, 'delivery_status');
      if (status === 'acknowledged' && row['provider_terminal_status'] === null)
        await issue(
          'mcp_task.cancel',
          'remote_task_cancel_request',
          text(row, 'cancel_request_id'),
          { invalidState: 'cancel cannot be confirmed without provider terminal status' },
        );
      await this.#emitMcpChild(
        row,
        'mcp_task.cancel',
        'remote_task_cancel_request',
        'cancel_request_id',
        'requested_at',
        'delivery_status',
        ref,
        emit,
        issue,
      );
    }
    for (const row of snapshot.observations.filter(
      (candidate) => candidate['observation_source'] === 'reconciliation',
    )) {
      const id = text(row, 'observation_id');
      const bindingId = text(row, 'binding_id');
      const observationRef = ref('mcp_task.observation', id);
      const controls = snapshot.controlEvents.filter(
        (event) =>
          event['binding_id'] === bindingId &&
          event['runtime_revision'] === row['runtime_revision'],
      );
      const onlyControl = controls.length === 1 ? controls.at(0) : undefined;
      const controlRef =
        onlyControl === undefined
          ? undefined
          : ref('mcp_task.control_event', text(onlyControl, 'event_id'));
      if (observationRef === undefined || controlRef === undefined) {
        await issue(
          'mcp_task.reconciliation',
          'remote_task_observation[observation_source=reconciliation]',
          id,
          {
            missingReference: 'mcp_task.observation/mcp_task.control_event',
            matchingControlEventCount: controls.length,
          },
        );
        continue;
      }
      await emit({
        type: 'mcp_task.reconciliation',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'observed_at'),
        payload: {
          observationId: id,
          bindingId,
          runtimeRevision: value(row, 'runtime_revision'),
          providerRevision: row['provider_revision'] ?? null,
        },
        refs: [observationRef, controlRef],
        remoteTaskBindingId: bindingId,
      });
    }
    for (const row of snapshot.continuationSnapshots) {
      const id = text(row, 'snapshot_id');
      const bindingIds = array(row, 'binding_ids').filter(
        (entry): entry is string => typeof entry === 'string',
      );
      const bindingRefs = bindingIds
        .map((binding) => ref('mcp_task.remote_binding', binding))
        .filter(isString);
      if (bindingRefs.length !== bindingIds.length || bindingRefs.length === 0) {
        await issue('mcp_task.continuation_snapshot', 'workflow_continuation_snapshot', id, {
          missingReference: 'mcp_task.remote_binding',
          bindingIds,
        });
        continue;
      }
      await emit({
        type: 'mcp_task.continuation_snapshot',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          snapshotId: id,
          continuationId: value(row, 'continuation_id'),
          stateVersion: value(row, 'state_version'),
          lifecycle: value(row, 'lifecycle'),
          resumePosition: 'saved_continuation_not_start',
        },
        refs: bindingRefs,
      });
    }
    for (const row of snapshot.continuationAttempts) {
      const id = text(row, 'attempt_id');
      const snapshotId = text(row, 'snapshot_id');
      const snapshotRef = ref('mcp_task.continuation_snapshot', snapshotId);
      if (snapshotRef === undefined) {
        await issue('mcp_task.continuation_attempt', 'workflow_continuation_attempt', id, {
          missingReference: 'mcp_task.continuation_snapshot',
        });
        continue;
      }
      await emit({
        type: 'mcp_task.continuation_attempt',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          attemptId: id,
          snapshotId,
          status: value(row, 'status'),
          resumePosition: 'saved_continuation_not_start',
          completedSideEffectReplay: false,
        },
        refs: [snapshotRef],
      });
    }

    for (const row of snapshot.definitions ?? []) {
      const id = `${text(row, 'capability_id')}:${String(integer(row, 'version'))}`;
      const revisionRef = optionalText(row, 'node_control_revision_record_id');
      if (revisionRef === undefined) {
        await issue(
          'capability.definition',
          'sdar_control.node_capability_definition_version',
          id,
          { missingReference: 'node_control.capability_revision' },
        );
        continue;
      }
      await emit({
        type: 'capability.definition',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'updated_at'),
        payload: {
          capabilityId: value(row, 'capability_id'),
          version: value(row, 'version'),
          definitionHash: value(row, 'definition_hash'),
          domain: value(row, 'domain'),
          name: value(row, 'name'),
          inputSchema: value(row, 'input_schema'),
          outputSchema: value(row, 'output_schema'),
          successCriteria: value(row, 'success_criteria'),
          requiredEvidence: value(row, 'required_evidence'),
          constraints: value(row, 'constraints'),
          status: value(row, 'status'),
        },
        refs: [revisionRef],
      });
    }
    for (const row of snapshot.implementationBindings ?? []) {
      const id = `${text(row, 'binding_id')}:${String(integer(row, 'revision'))}`;
      const definitionRef = ref(
        'capability.definition',
        `${text(row, 'capability_id')}:${String(integer(row, 'capability_version'))}`,
      );
      if (definitionRef === undefined) {
        await issue(
          'capability.implementation_binding',
          'sdar_control.capability_implementation_binding',
          id,
          { missingReference: 'capability.definition' },
        );
        continue;
      }
      await emit({
        type: 'capability.implementation_binding',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          bindingId: value(row, 'binding_id'),
          revision: value(row, 'revision'),
          capabilityId: value(row, 'capability_id'),
          capabilityVersion: value(row, 'capability_version'),
          implementationType: value(row, 'implementation_type'),
          implementationId: value(row, 'implementation_id'),
          implementationVersion: value(row, 'implementation_version'),
          role: value(row, 'role'),
          priority: value(row, 'priority'),
          status: value(row, 'status'),
        },
        refs: [definitionRef],
      });
    }
    for (const row of snapshot.readiness) {
      const id = `${text(row, 'capability_id')}:${String(integer(row, 'capability_version'))}:${String(integer(row, 'snapshot_version'))}`;
      const definitionRef = ref(
        'capability.definition',
        `${text(row, 'capability_id')}:${String(integer(row, 'capability_version'))}`,
      );
      if (definitionRef === undefined) {
        await issue('capability.readiness', 'capability_readiness_snapshot', id, {
          missingReference: 'capability.definition',
        });
        continue;
      }
      await emit({
        type: 'capability.readiness',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'evaluated_at'),
        payload: {
          capabilityId: value(row, 'capability_id'),
          snapshotVersion: value(row, 'snapshot_version'),
          status: value(row, 'status'),
          capabilityVersion: value(row, 'capability_version'),
          validUntil: value(row, 'valid_until'),
          snapshotHash: value(row, 'snapshot_hash'),
          reasons: value(row, 'reasons'),
        },
        refs: [definitionRef],
      });
    }
    for (const row of snapshot.capabilityBindings) {
      const id = text(row, 'binding_id');
      const definitionRef = ref(
        'capability.definition',
        `${text(row, 'requested_capability_id')}:${String(integer(row, 'capability_version'))}`,
      );
      const episodeRef = existing('runtime.episode');
      if (definitionRef === undefined || episodeRef === undefined) {
        await issue('capability.task_binding', 'task_capability_binding', id, {
          missingReference: 'capability.definition/runtime.episode',
        });
        continue;
      }
      await emit({
        type: 'capability.task_binding',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'bound_at'),
        payload: {
          bindingId: id,
          taskId: value(row, 'task_id'),
          bindingHash: value(row, 'binding_hash'),
          capabilityId: value(row, 'requested_capability_id'),
          capabilityVersion: value(row, 'capability_version'),
          inputSnapshot: value(row, 'input_snapshot'),
          successCriteriaSnapshot: value(row, 'success_criteria_snapshot'),
          evidenceRequirementSnapshot: value(row, 'evidence_requirement_snapshot'),
          constraintSnapshot: value(row, 'constraint_snapshot'),
          initialImplementationRefs: value(row, 'initial_implementation_refs'),
          providerPolicySnapshot: row['provider_policy_snapshot'] ?? null,
        },
        refs: [definitionRef, episodeRef],
        capabilityBindingId: id,
      });
    }
    for (const row of snapshot.capabilityAttempts) {
      const id = text(row, 'attempt_id');
      const bindingId = text(row, 'capability_binding_id');
      const bindingRef = ref('capability.task_binding', bindingId);
      const skillRefs = skillExecutionRefs(row, snapshot.existingEvidence);
      if (bindingRef === undefined || skillRefs.length === 0) {
        await issue('capability.execution_attempt', 'task_capability_execution_attempt', id, {
          missingReference: 'capability.task_binding/skill.execution',
          matchingSkillExecutionCount: skillRefs.length,
        });
        continue;
      }
      await emit({
        type: 'capability.execution_attempt',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'started_at', 'completed_at'),
        payload: {
          attemptId: id,
          bindingId,
          attemptNo: value(row, 'attempt_no'),
          status: value(row, 'status'),
          reason: value(row, 'reason'),
          skillVersionRefs: value(row, 'skill_version_refs'),
          providerBindingRefs: value(row, 'provider_binding_refs'),
        },
        refs: [bindingRef, ...skillRefs],
        capabilityBindingId: bindingId,
      });
    }
    for (const row of snapshot.exposures) {
      const id = `${String(integer(row, 'revision'))}:${text(row, 'exposure_id')}:${String(integer(row, 'exposure_version'))}`;
      const definitionRef = ref(
        'capability.definition',
        `${text(row, 'capability_id')}:${String(integer(row, 'capability_version'))}`,
      );
      if (definitionRef === undefined) {
        await issue('capability.a2a_exposure', 'runtime_agent_card_exposure_snapshot', id, {
          missingReference: 'capability.definition',
        });
        continue;
      }
      await emit({
        type: 'capability.a2a_exposure',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(
          snapshot.cardRevisions.find(
            (card) => integer(card, 'revision') === integer(row, 'revision'),
          ) ?? row,
          'generated_at',
        ),
        payload: {
          revision: value(row, 'revision'),
          exposureId: value(row, 'exposure_id'),
          exposureHash: value(row, 'exposure_hash'),
          exposureVersion: value(row, 'exposure_version'),
          capabilityId: value(row, 'capability_id'),
          capabilityVersion: value(row, 'capability_version'),
          agentSkillId: value(row, 'agent_skill_id'),
          requestSchema: value(row, 'request_schema'),
          resultSchema: value(row, 'result_schema'),
        },
        refs: [definitionRef],
      });
    }
    for (const row of snapshot.cardRevisions) {
      const revision = integer(row, 'revision');
      const id = String(revision);
      const exposureRefs = [...projected.values()]
        .filter(
          (record) =>
            record.recordType === 'capability.a2a_exposure' &&
            objectValue(record.payload, 'revision') === revision,
        )
        .map((record) => record.recordId);
      if (exposureRefs.length === 0) {
        await issue('capability.agent_card_revision', 'runtime_agent_card_revision', id, {
          missingReference: 'capability.a2a_exposure',
        });
        continue;
      }
      await emit({
        type: 'capability.agent_card_revision',
        sourceId: id,
        revision: row,
        occurredAt: timestamp(row, 'generated_at'),
        payload: {
          revision,
          status: value(row, 'status'),
          contentHash: value(row, 'content_hash'),
          capabilityCatalogHash: value(row, 'capability_catalog_hash'),
          card: value(row, 'card'),
        },
        refs: exposureRefs,
      });
    }

    const lastEvidenceSequence = sequences.reduce(
      (max, current) => (BigInt(current) > BigInt(max) ? current : max),
      '0',
    );
    const checkpoint: EvidenceSourceCheckpoint = {
      sourceFamily: 'mcp-capability',
      sourcePartition: partition,
      lastSourceRecordId: cleanTaskId,
      lastSourceRevision: hashCanonicalEvidenceJson({
        taskId: cleanTaskId,
        records: projected.size,
        issues: issueIds.length,
      }),
      lastProjectedAt: recordedAt,
      projectorVersion: MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION,
    };
    await this.#writer.saveCheckpoint(checkpoint);
    await this.#writer.resolveQualityIssues({
      episodeId: cleanTaskId,
      recordTypePrefix: 'mcp_task.',
      retainedIssueIds: issueIds,
      resolvedAt: recordedAt,
    });
    await this.#writer.resolveQualityIssues({
      episodeId: cleanTaskId,
      recordTypePrefix: 'capability.',
      retainedIssueIds: issueIds,
      resolvedAt: recordedAt,
    });
    return Object.freeze({
      taskId: cleanTaskId,
      projectedRecordIds: Object.freeze([...projected.values()].map((record) => record.recordId)),
      qualityIssueIds: Object.freeze(issueIds),
      lastEvidenceSequence,
    });
  }

  async #emitMcpChild(
    row: RuntimeCoreSourceRow,
    type: string,
    table: string,
    idField: string,
    timeField: string,
    statusField: string,
    ref: (type: string, id: string) => string | undefined,
    emit: (input: McpCapabilityEmitInput) => Promise<CanonicalEvidenceEnvelope>,
    issue: (
      recordType: string,
      sourceTable: string,
      sourceRecordId: string,
      detail: RuntimeCoreSourceRow,
    ) => Promise<void>,
  ) {
    const id = text(row, idField);
    const bindingId = text(row, 'binding_id');
    const bindingRef = ref('mcp_task.remote_binding', bindingId);
    if (bindingRef === undefined) {
      await issue(type, table, id, { missingReference: 'mcp_task.remote_binding' });
      return;
    }
    await emit({
      type,
      sourceId: id,
      revision: row,
      occurredAt: timestamp(row, timeField),
      payload: {
        [camel(idField)]: id,
        bindingId,
        [camel(statusField)]: value(row, statusField),
        ...(type === 'mcp_task.cancel'
          ? {
              providerTerminalStatus: row['provider_terminal_status'] ?? null,
              cancelConfirmation:
                row['provider_terminal_status'] === null ? 'requested_or_uncertain' : 'confirmed',
            }
          : {}),
      },
      refs: [bindingRef],
      remoteTaskBindingId: bindingId,
    });
  }
}

function value(row: RuntimeCoreSourceRow, field: string): EvidenceJsonValue {
  const result = row[field];
  if (result === undefined) throw new Error(`MCP/Capability source ${field} missing.`);
  return result;
}
function text(row: RuntimeCoreSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'string' || result.trim() === '')
    throw new Error(`MCP/Capability source ${field} invalid.`);
  return result;
}
function optionalText(row: RuntimeCoreSourceRow | undefined, field: string) {
  const result = row?.[field];
  return typeof result === 'string' && result.trim() !== '' ? result : undefined;
}
function integer(row: RuntimeCoreSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'number' || !Number.isSafeInteger(result))
    throw new Error(`MCP/Capability source ${field} invalid.`);
  return result;
}
function timestamp(row: RuntimeCoreSourceRow, field: string, fallback?: string) {
  const candidate = row[field] ?? (fallback === undefined ? undefined : row[fallback]);
  if (typeof candidate !== 'string' || !Number.isFinite(Date.parse(candidate)))
    throw new Error(`MCP/Capability source ${field} timestamp invalid.`);
  return new Date(candidate).toISOString();
}
function array(row: RuntimeCoreSourceRow, field: string): readonly EvidenceJsonValue[] {
  const result = value(row, field);
  if (!Array.isArray(result)) throw new Error(`MCP/Capability source ${field} array invalid.`);
  return result as readonly EvidenceJsonValue[];
}
function requiredText(input: string, field: string) {
  const result = input.trim();
  if (result === '') throw new Error(`${field} missing.`);
  return result;
}
function compact(...values: (string | undefined)[]) {
  return values.filter(isString);
}
function isString(value: string | undefined): value is string {
  return value !== undefined;
}
function camel(value: string) {
  return value.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}
function objectValue(value: EvidenceJsonValue, field: string): EvidenceJsonValue | undefined {
  return isObject(value) ? value[field] : undefined;
}
function skillExecutionRefs(
  attempt: RuntimeCoreSourceRow,
  existing: readonly RuntimeCoreSourceRow[],
) {
  const declared = array(attempt, 'skill_version_refs');
  return existing
    .filter(
      (row) =>
        row['record_type'] === 'skill.execution' &&
        declared.some(
          (item) =>
            typeof item === 'object' &&
            item !== null &&
            !Array.isArray(item) &&
            (item as RuntimeCoreSourceRow)['skillId'] ===
              (row['payload'] as RuntimeCoreSourceRow | undefined)?.['skillId'] &&
            (item as RuntimeCoreSourceRow)['version'] ===
              (row['payload'] as RuntimeCoreSourceRow | undefined)?.['skillVersion'],
        ),
    )
    .map((row) => text(row, 'record_id'));
}
function isObject(value: EvidenceJsonValue): value is Readonly<Record<string, EvidenceJsonValue>> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function sanitizeEvidenceValue(value: EvidenceJsonValue): EvidenceJsonValue {
  if (Array.isArray(value))
    return Object.freeze(
      (value as readonly EvidenceJsonValue[]).map((item) => sanitizeEvidenceValue(item)),
    );
  if (!isObject(value)) return value;
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isForbiddenEvidenceKey(key))
        .map(([key, item]) => [key, sanitizeEvidenceValue(item)]),
    ),
  );
}

function isForbiddenEvidenceKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  if (normalized.endsWith('credentialref') || normalized.endsWith('secretref')) return false;
  return /(?:credential|password|passwd|accesstoken|refreshtoken|secret|authorization|apikey|privatekey|chainofthought|privatereasoning|reasoningcontent|hiddenreasoning)/u.test(
    normalized,
  );
}
