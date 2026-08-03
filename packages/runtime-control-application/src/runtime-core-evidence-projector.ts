import {
  EVIDENCE_RECORD_CATALOG,
  createCanonicalEvidenceEnvelope,
  createEvidenceRecordId,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EpisodeEvidenceManifest,
  type EvidenceJsonValue,
  type EvidenceIssueCode,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';

export type RuntimeCoreSourceRow = Readonly<Record<string, EvidenceJsonValue>>;

export interface RuntimeCoreEvidenceSnapshot {
  readonly task: RuntimeCoreSourceRow;
  readonly goals: readonly RuntimeCoreSourceRow[];
  readonly goalContracts: readonly RuntimeCoreSourceRow[];
  readonly goalPatches: readonly RuntimeCoreSourceRow[];
  readonly plans: readonly RuntimeCoreSourceRow[];
  readonly planSteps: readonly RuntimeCoreSourceRow[];
  readonly stateTransitions: readonly RuntimeCoreSourceRow[];
  readonly controlRounds: readonly RuntimeCoreSourceRow[];
  readonly executionGates: readonly RuntimeCoreSourceRow[];
  readonly confirmations: readonly RuntimeCoreSourceRow[];
  readonly skillExecutions: readonly RuntimeCoreSourceRow[];
  readonly skillExecutionReferences?: readonly RuntimeCoreSourceRow[];
  readonly invocations: readonly RuntimeCoreSourceRow[];
  readonly verifications: readonly RuntimeCoreSourceRow[];
  readonly outcomes: readonly RuntimeCoreSourceRow[];
  readonly runSeals: readonly RuntimeCoreSourceRow[];
}

export interface RuntimeCoreEvidenceSource {
  pendingTaskIds(limit: number): Promise<readonly string[]>;
  load(taskId: string): Promise<RuntimeCoreEvidenceSnapshot | undefined>;
}

export interface RuntimeCoreEvidenceWriter {
  append(
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string>;
  recordQualityIssue(issue: EvidenceQualityIssue): Promise<void>;
  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void>;
  saveManifest(manifest: EpisodeEvidenceManifest): Promise<void>;
}

export interface RuntimeCoreProjectionResult {
  readonly taskId: string;
  readonly episodeId: string;
  readonly projectedRecordIds: readonly string[];
  readonly qualityIssueIds: readonly string[];
  readonly lastEvidenceSequence: string;
  readonly manifestId?: string;
}

export class RuntimeCoreEvidenceProjector {
  readonly #source: RuntimeCoreEvidenceSource;
  readonly #writer: RuntimeCoreEvidenceWriter;
  readonly #environment: string;
  readonly #clock: { now(): string };

  constructor(input: {
    source: RuntimeCoreEvidenceSource;
    writer: RuntimeCoreEvidenceWriter;
    environment: string;
    clock?: { now(): string };
  }) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#environment = requiredText(input.environment, 'environment');
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async projectTask(taskId: string): Promise<RuntimeCoreProjectionResult> {
    const normalizedTaskId = requiredText(taskId, 'taskId');
    const snapshot = await this.#source.load(normalizedTaskId);
    if (snapshot === undefined) throw new Error(`Runtime task ${normalizedTaskId} was not found.`);

    const recordedAt = this.#clock.now();
    const contextId = text(snapshot.task, 'context_id');
    const episodeId = normalizedTaskId;
    const sourcePartition = `runtime-core:${normalizedTaskId}`;
    const projected = new Map<string, CanonicalEvidenceEnvelope>();
    const sequences: string[] = [];
    const qualityIssueIds: string[] = [];

    const issue = async (
      recordType: string,
      sourceTable: string,
      sourceRecordId: string,
      detail: Readonly<Record<string, EvidenceJsonValue>>,
      issueCode: EvidenceIssueCode = 'reference_unresolved',
    ): Promise<void> => {
      const issueId = `quality_${hashCanonicalEvidenceJson([
        normalizedTaskId,
        recordType,
        sourceTable,
        sourceRecordId,
        detail,
      ]).slice('sha256:'.length)}`;
      await this.#writer.recordQualityIssue({
        issueId,
        issueCode,
        severity: 'blocking',
        recordType,
        episodeId,
        sourceSystem: 'runtime',
        sourceTable,
        sourceRecordId,
        detail,
        createdAt: recordedAt,
      });
      qualityIssueIds.push(issueId);
    };

    const emit = async (input: {
      recordType: string;
      sourceRecordId: string;
      sourceRevisionValue: EvidenceJsonValue;
      occurredAt: string;
      payload: RuntimeCoreSourceRow;
      evidenceRefs?: readonly string[];
      goalId?: string;
      goalVersion?: number;
      planId?: string;
      planVersion?: number;
      nodeId?: string;
    }): Promise<CanonicalEvidenceEnvelope> => {
      const catalog = EVIDENCE_RECORD_CATALOG.find(
        (candidate) => candidate.recordType === input.recordType,
      );
      if (catalog === undefined)
        throw new Error(`Evidence catalog entry ${input.recordType} missing.`);
      const envelope = createCanonicalEvidenceEnvelope({
        sourceSystem: 'runtime',
        sourceTable: catalog.sourceTable,
        sourceRecordId: input.sourceRecordId,
        sourceRevision: hashCanonicalEvidenceJson(input.sourceRevisionValue),
        schemaName: catalog.schemaName,
        schemaVersion: catalog.schemaVersion,
        recordFamily: catalog.recordFamily,
        recordType: catalog.recordType,
        environment: this.#environment,
        correlationId: normalizedTaskId,
        occurredAt: input.occurredAt,
        recordedAt,
        deliveryGuarantee: catalog.deliveryGuarantee,
        evaluationRole: catalog.evaluationRole,
        evidenceRefs: input.evidenceRefs ?? [],
        taskId: normalizedTaskId,
        contextId,
        episodeId,
        ...(input.goalId === undefined ? {} : { goalId: input.goalId }),
        ...(input.goalVersion === undefined ? {} : { goalVersion: input.goalVersion }),
        ...(input.planId === undefined ? {} : { planId: input.planId }),
        ...(input.planVersion === undefined ? {} : { planVersion: input.planVersion }),
        ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
        payload: input.payload,
      });
      const sequence = await this.#writer.append(envelope, recordedAt, sourcePartition);
      projected.set(key(input.recordType, input.sourceRecordId), envelope);
      sequences.push(sequence);
      return envelope;
    };

    const taskRevision = {
      taskId: normalizedTaskId,
      phase: snapshot.task['phase'] ?? null,
      goalId: snapshot.task['goal_id'] ?? null,
      goalVersion: snapshot.task['goal_version'] ?? null,
      updatedAt: snapshot.task['updated_at'] ?? null,
    };
    const episode = await emit({
      recordType: 'runtime.episode',
      sourceRecordId: normalizedTaskId,
      sourceRevisionValue: taskRevision,
      occurredAt: timestamp(snapshot.task, 'created_at'),
      payload: { episodeId, taskId: normalizedTaskId, status: value(snapshot.task, 'phase') },
    });
    const inputHash = hashCanonicalEvidenceJson(
      JSON.stringify({
        requestText: snapshot.task['request_text'] ?? '',
        requestMetadata: snapshot.task['request_metadata'] ?? {},
      }),
    );
    const request = await emit({
      recordType: 'runtime.request',
      sourceRecordId: normalizedTaskId,
      sourceRevisionValue: { ...taskRevision, inputHash },
      occurredAt: timestamp(snapshot.task, 'created_at'),
      payload: { requestId: normalizedTaskId, taskId: normalizedTaskId, inputHash },
      evidenceRefs: [episode.recordId],
    });
    await emit({
      recordType: 'runtime.a2a_task',
      sourceRecordId: normalizedTaskId,
      sourceRevisionValue: taskRevision,
      occurredAt: timestamp(snapshot.task, 'created_at'),
      payload: {
        taskId: normalizedTaskId,
        contextId,
        protocolStatus: value(snapshot.task, 'phase'),
      },
      evidenceRefs: [request.recordId],
    });

    for (const row of snapshot.goals) {
      const goalId = text(row, 'goal_id');
      const goalVersion = integer(row, 'version');
      await emit({
        recordType: 'runtime.goal',
        sourceRecordId: `${goalId}:${String(goalVersion)}`,
        sourceRevisionValue: {
          goalId,
          goalVersion,
          status: row['status'] ?? null,
          updatedAt: row['updated_at'] ?? null,
        },
        occurredAt: timestamp(row, 'updated_at'),
        payload: { goalId, goalVersion, status: value(row, 'status') },
        evidenceRefs: [episode.recordId],
        goalId,
        goalVersion,
      });
    }

    for (const row of snapshot.goalContracts) {
      const goalId = text(row, 'goal_id');
      const goalVersion = integer(row, 'goal_version');
      const goalRef = projected.get(key('runtime.goal', `${goalId}:${String(goalVersion)}`));
      if (goalRef === undefined)
        await issue('runtime.goal_contract', 'user_goal_contract', goalId, {
          missingReference: 'runtime.goal',
        });
      await emit({
        recordType: 'runtime.goal_contract',
        sourceRecordId: `${goalId}:${String(goalVersion)}`,
        sourceRevisionValue: {
          goalVersion,
          contractHash: row['contract_hash'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: { goalId, goalVersion, contractHash: value(row, 'contract_hash') },
        evidenceRefs: refs(goalRef),
        goalId,
        goalVersion,
      });
    }

    for (const row of snapshot.goalPatches) {
      const patchId = text(row, 'patch_id');
      const goalId = text(row, 'goal_id');
      const toVersion = integer(row, 'to_version');
      const goalRef = projected.get(key('runtime.goal', `${goalId}:${String(toVersion)}`));
      const contractRef = projected.get(
        key('runtime.goal_contract', `${goalId}:${String(toVersion)}`),
      );
      await emit({
        recordType: 'runtime.goal_patch',
        sourceRecordId: patchId,
        sourceRevisionValue: {
          patchId,
          fromVersion: row['from_version'] ?? null,
          toVersion,
          createdAt: row['created_at'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          patchId,
          fromVersion: integer(row, 'from_version'),
          toVersion,
          invalidatedPlanIds: array(row, 'invalidated_plan_ids_json'),
          ...(optionalText(row, 'new_plan_id') === undefined
            ? {}
            : { newPlanId: text(row, 'new_plan_id') }),
        },
        evidenceRefs: refs(goalRef, contractRef),
        goalId,
        goalVersion: toVersion,
      });
    }

    for (const row of snapshot.plans) {
      const planId = text(row, 'plan_id');
      const goalId = text(row, 'goal_id');
      const goalVersion = integer(row, 'goal_version');
      const revision = integer(row, 'revision');
      const contractRef = projected.get(
        key('runtime.goal_contract', `${goalId}:${String(goalVersion)}`),
      );
      await emit({
        recordType: 'runtime.plan',
        sourceRecordId: planId,
        sourceRevisionValue: {
          revision,
          lockVersion: row['lock_version'] ?? null,
          contentHash: row['content_hash'] ?? null,
          status: row['status'] ?? null,
        },
        occurredAt: timestamp(row, 'updated_at'),
        payload: {
          planId,
          revision,
          contentHash: value(row, 'content_hash'),
          status: value(row, 'status'),
          lockVersion: value(row, 'lock_version'),
          ...(optionalText(row, 'source_plan_id') === undefined
            ? {}
            : { sourcePlanId: text(row, 'source_plan_id') }),
        },
        evidenceRefs: refs(contractRef),
        goalId,
        goalVersion,
        planId,
        planVersion: revision,
      });
    }

    for (const row of snapshot.planSteps) {
      const skillGoalId = text(row, 'skill_goal_id');
      const planId = text(row, 'plan_id');
      const planRef = projected.get(key('runtime.plan', planId));
      await emit({
        recordType: 'runtime.plan_step',
        sourceRecordId: skillGoalId,
        sourceRevisionValue: {
          lockVersion: row['lock_version'] ?? null,
          status: row['status'] ?? null,
          updatedAt: row['updated_at'] ?? null,
        },
        occurredAt: timestamp(row, 'updated_at'),
        payload: {
          skillGoalId,
          ordinal: integer(row, 'ordinal'),
          status: value(row, 'status'),
        },
        evidenceRefs: refs(planRef),
        planId,
        ...(planRef?.planVersion === undefined ? {} : { planVersion: planRef.planVersion }),
      });
    }

    for (const row of snapshot.stateTransitions) {
      const eventId = text(row, 'event_id');
      const skillGoalId = optionalText(row, 'skill_goal_id');
      const stepRef =
        skillGoalId === undefined
          ? undefined
          : projected.get(key('runtime.plan_step', skillGoalId));
      if (stepRef === undefined)
        await issue('runtime.state_transition', 'workflow_node_event', eventId, {
          missingReference: 'runtime.plan_step',
        });
      await emit({
        recordType: 'runtime.state_transition',
        sourceRecordId: eventId,
        sourceRevisionValue: {
          eventId,
          sequence: row['sequence'] ?? null,
          eventType: row['event_type'] ?? null,
        },
        occurredAt: timestamp(row, 'event_timestamp'),
        payload: {
          eventId,
          nodeId: value(row, 'node_id'),
          eventType: value(row, 'event_type'),
          workflowSequence: value(row, 'sequence'),
        },
        evidenceRefs: refs(episode, stepRef),
        ...(optionalText(row, 'plan_id') === undefined ? {} : { planId: text(row, 'plan_id') }),
        nodeId: text(row, 'node_id'),
      });
    }

    for (const row of snapshot.controlRounds) {
      const controlId = text(row, 'control_id');
      const roundIndex = integer(row, 'round_index');
      const sourceRecordId = `${controlId}:${String(roundIndex)}`;
      const planId = text(row, 'plan_id');
      const planRef = projected.get(key('runtime.plan', planId));
      const decision = await emit({
        recordType: 'runtime.decision',
        sourceRecordId,
        sourceRevisionValue: {
          controlId,
          roundIndex,
          decision: row['evaluation_decision'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: { controlId, roundIndex, decision: value(row, 'evaluation_decision') },
        evidenceRefs: refs(episode, planRef),
        planId,
        ...(planRef?.planVersion === undefined ? {} : { planVersion: planRef.planVersion }),
      });
      await emit({
        recordType: 'runtime.policy_decision',
        sourceRecordId,
        sourceRevisionValue: {
          controlId,
          roundIndex,
          detail: row['evaluation_detail_json'] ?? {},
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          controlId,
          roundIndex,
          reasonCodes: nestedArray(row, 'evaluation_detail_json', 'reasonCodes'),
          decision: value(row, 'evaluation_decision'),
        },
        evidenceRefs: [decision.recordId],
        planId,
        ...(planRef?.planVersion === undefined ? {} : { planVersion: planRef.planVersion }),
      });
    }

    for (const row of snapshot.executionGates) {
      const readinessId = text(row, 'readiness_id');
      const planId = text(row, 'workflow_plan_id');
      const policyRefs = [...projected.values()].filter(
        (record) => record.recordType === 'runtime.policy_decision' && record.planId === planId,
      );
      await emit({
        recordType: 'runtime.execution_gate',
        sourceRecordId: readinessId,
        sourceRevisionValue: {
          readinessId,
          disposition: row['disposition'] ?? null,
          guardAction: row['guard_action'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          readinessId,
          disposition: value(row, 'disposition'),
          guardAction: value(row, 'guard_action'),
          reasonCodes: array(row, 'guard_reason_codes_json'),
          confirmationRequired: value(row, 'confirmation_required'),
        },
        evidenceRefs: policyRefs.map((record) => record.recordId),
        planId,
      });
    }

    for (const row of snapshot.confirmations) {
      const planId = text(row, 'plan_id');
      const confirmationTaskId = optionalText(row, 'confirmation_task_id');
      if (confirmationTaskId === undefined) {
        await issue('runtime.human_confirmation', 'workflow_plan', planId, {
          missingSourceFact: 'confirmation_task_id',
        });
        continue;
      }
      await emit({
        recordType: 'runtime.human_confirmation',
        sourceRecordId: planId,
        sourceRevisionValue: {
          attemptCount: row['attempt_count'] ?? null,
          confirmationStatus: row['confirmation_status'] ?? null,
          confirmedAt: row['confirmed_at'] ?? null,
        },
        occurredAt: timestamp(row, 'confirmed_at', 'created_at'),
        payload: {
          planId,
          confirmationStatus: value(row, 'confirmation_status'),
          confirmationTaskId,
          attemptCount: value(row, 'attempt_count'),
        },
        evidenceRefs: refs(projected.get(key('runtime.plan', planId))),
        ...(optionalText(row, 'goal_id') === undefined ? {} : { goalId: text(row, 'goal_id') }),
        ...(optionalInteger(row, 'goal_version') === undefined
          ? {}
          : { goalVersion: integer(row, 'goal_version') }),
        planId,
      });
    }

    for (const row of snapshot.invocations) {
      const invocationId = text(row, 'invocation_id');
      const planStepRef =
        optionalText(snapshot.task, 'skill_goal_id') === undefined
          ? undefined
          : projected.get(key('runtime.plan_step', text(snapshot.task, 'skill_goal_id')));
      const planId = optionalText(snapshot.task, 'user_goal_plan_id');
      const matchingSkillExecutions = snapshot.skillExecutions.filter(
        (execution) => optionalText(execution, 'workflow_plan_id') === planId,
      );
      const correlatedSkillExecutions = matchingSkillExecutions.filter((execution) =>
        (snapshot.skillExecutionReferences ?? []).some(
          (reference) =>
            reference['execution_id'] === execution['execution_id'] &&
            reference['kind'] === 'provider' &&
            reference['reference_id'] === row['server_id'] &&
            objectOrEmpty(reference['metadata_json'])['operationName'] === row['tool_name'],
        ),
      );
      const exactSkillExecutions =
        correlatedSkillExecutions.length > 0
          ? correlatedSkillExecutions
          : matchingSkillExecutions.length === 1
            ? matchingSkillExecutions
            : [];
      const [matchingSkillExecution] = exactSkillExecutions;
      const skillExecutionRef =
        exactSkillExecutions.length === 1 && matchingSkillExecution !== undefined
          ? createSkillExecutionEvidenceRecordId(matchingSkillExecution)
          : undefined;
      if (skillExecutionRef === undefined) {
        await issue('runtime.action', 'mcp_invocation', invocationId, {
          missingReference: 'skill.execution',
          matchingSkillExecutionCount: exactSkillExecutions.length,
          planSkillExecutionCount: matchingSkillExecutions.length,
        });
      }
      const action = await emit({
        recordType: 'runtime.action',
        sourceRecordId: invocationId,
        sourceRevisionValue: {
          invocationId,
          status: row['status'] ?? null,
          completedAt: row['completed_at'] ?? null,
        },
        occurredAt: timestamp(row, 'started_at'),
        payload: {
          invocationId,
          operationName: value(row, 'tool_name'),
          argumentsHash: hashCanonicalEvidenceJson(row['arguments_json'] ?? {}),
          executionBasis: {
            executionMode: row['execution_mode'] ?? 'live',
            executionSemantics: row['execution_semantics_json'] ?? {},
          },
        },
        evidenceRefs: [
          ...refs(planStepRef),
          ...(skillExecutionRef === undefined ? [] : [skillExecutionRef]),
        ],
        ...(planId === undefined ? {} : { planId }),
      });
      await emit({
        recordType: 'runtime.receipt',
        sourceRecordId: invocationId,
        sourceRevisionValue: {
          invocationId,
          status: row['status'] ?? null,
          completedAt: row['completed_at'] ?? null,
        },
        occurredAt: timestamp(row, 'completed_at', 'started_at'),
        payload: {
          invocationId,
          status: value(row, 'status'),
          resultHash: hashCanonicalEvidenceJson({
            status: row['status'] ?? null,
            result: row['result_json'] ?? null,
            errorCode: row['error_code'] ?? null,
          }),
          receiptLayers: {
            transport: 'recorded',
            executor: row['status'] ?? 'unknown',
            business: 'not_asserted',
          },
        },
        evidenceRefs: [action.recordId],
        ...(optionalText(snapshot.task, 'user_goal_plan_id') === undefined
          ? {}
          : { planId: text(snapshot.task, 'user_goal_plan_id') }),
      });
    }

    for (const row of snapshot.verifications) {
      const completedEffectId = text(row, 'completed_effect_id');
      const planId = text(row, 'plan_id');
      const actionRefs = [...projected.values()].filter(
        (record) =>
          (record.recordType === 'runtime.action' || record.recordType === 'runtime.receipt') &&
          record.planId === planId,
      );
      await emit({
        recordType: 'runtime.verification',
        sourceRecordId: completedEffectId,
        sourceRevisionValue: {
          completedEffectId,
          status: row['status'] ?? null,
          effectFingerprint: row['effect_fingerprint'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          completedEffectId,
          status: value(row, 'status'),
          effectFingerprint: value(row, 'effect_fingerprint'),
        },
        evidenceRefs: actionRefs.map((record) => record.recordId),
        goalId: text(row, 'goal_id'),
        planId,
      });
    }

    for (const row of snapshot.outcomes) {
      const outcomeDecisionId = text(row, 'outcome_decision_id');
      const planId = text(row, 'plan_id');
      const verificationRefs = [...projected.values()].filter(
        (record) => record.recordType === 'runtime.verification' && record.planId === planId,
      );
      await emit({
        recordType: 'runtime.outcome',
        sourceRecordId: outcomeDecisionId,
        sourceRevisionValue: {
          outcomeDecisionId,
          level: row['level'] ?? null,
          status: row['status'] ?? null,
          confidence: row['confidence'] ?? null,
        },
        occurredAt: timestamp(row, 'created_at'),
        payload: {
          outcomeDecisionId,
          level: value(row, 'level'),
          status: value(row, 'status'),
          confidence: value(row, 'confidence'),
        },
        evidenceRefs: verificationRefs.map((record) => record.recordId),
        planId,
      });
    }

    let manifestId: string | undefined;
    let terminalOutcomeId: string | undefined;
    for (const row of snapshot.runSeals) {
      const outcomeId = text(row, 'outcome_id');
      terminalOutcomeId = outcomeId;
      const outcomeKind = text(row, 'outcome_kind');
      const taskStatus = optionalText(row, 'task_status');
      const goalStatus = optionalText(row, 'goal_status');
      const controlStatus =
        optionalText(row, 'control_current_status') ?? optionalText(row, 'control_status');
      const workflowStatus = optionalText(row, 'workflow_status');
      const terminalState = {
        taskStatus: taskStatus ?? null,
        goalStatus: goalStatus ?? null,
        controlStatus: controlStatus ?? null,
        workflowStatus: workflowStatus ?? null,
      };
      const expectedTaskStatus =
        outcomeKind === 'achieved'
          ? 'completed'
          : outcomeKind === 'canceled'
            ? 'canceled'
            : 'failed';
      const expectedGoalStatus =
        outcomeKind === 'achieved'
          ? 'achieved'
          : outcomeKind === 'canceled'
            ? 'canceled'
            : 'unachievable';
      const expectedControlStatuses =
        outcomeKind === 'achieved'
          ? ['achieved']
          : outcomeKind === 'canceled'
            ? ['canceled']
            : ['unachievable', 'replan_budget_exhausted'];
      if (
        taskStatus !== expectedTaskStatus ||
        goalStatus !== expectedGoalStatus ||
        controlStatus === undefined ||
        !expectedControlStatuses.includes(controlStatus) ||
        workflowStatus === undefined ||
        !['succeeded', 'failed', 'canceled', 'invalidated'].includes(workflowStatus)
      ) {
        await issue(
          'runtime.run_seal',
          'runtime_terminal_outcome',
          outcomeId,
          {
            terminalState,
            expectedTaskStatus,
            expectedGoalStatus,
            expectedControlStatuses,
            terminalOutcomeKind: outcomeKind,
          },
          'projection_bug',
        );
      }
      manifestId = `manifest_${hashCanonicalEvidenceJson([episodeId, outcomeId]).slice('sha256:'.length)}`;
      const outcomeRefs = [...projected.values()].filter(
        (record) => record.recordType === 'runtime.outcome',
      );
      await emit({
        recordType: 'runtime.run_seal',
        sourceRecordId: outcomeId,
        sourceRevisionValue: {
          outcomeId,
          outcomeKind: row['outcome_kind'] ?? null,
          committedAt: row['committed_at'] ?? null,
        },
        occurredAt: timestamp(row, 'committed_at'),
        payload: {
          outcomeId,
          outcomeKind,
          committedAt: value(row, 'committed_at'),
          ...terminalState,
          workflowInstanceId: row['final_instance_id'] ?? null,
          authority: row['authority'] ?? null,
        },
        evidenceRefs: [...outcomeRefs.map((record) => record.recordId), manifestId],
        goalId: text(row, 'goal_id'),
        goalVersion: integer(row, 'goal_version'),
      });
    }

    const lastEvidenceSequence = sequences.at(-1) ?? '0';
    const requiredRuntimeTypes = EVIDENCE_RECORD_CATALOG.filter(
      (entry) => entry.recordFamily === 'runtime' && entry.evaluationRole === 'required',
    ).map((entry) => entry.recordType);
    const projectedTypes = new Set([...projected.values()].map((record) => record.recordType));
    const missingRequiredTypes = requiredRuntimeTypes.filter((type) => !projectedTypes.has(type));
    const expectedRequiredRecords = projected.size + missingRequiredTypes.length;
    await this.#writer.saveCheckpoint({
      sourceFamily: 'runtime',
      sourcePartition,
      lastOccurredAt: timestamp(snapshot.task, 'updated_at'),
      lastSourceRecordId: normalizedTaskId,
      lastSourceRevision: hashCanonicalEvidenceJson(taskRevision),
      lastPayloadHash: episode.payloadHash,
      lastProjectedAt: recordedAt,
      projectorVersion: 'runtime-core/v1',
    });
    if (manifestId !== undefined && terminalOutcomeId !== undefined) {
      await this.#writer.saveManifest({
        manifestId,
        episodeId,
        taskId: normalizedTaskId,
        terminalOutcomeId,
        expectedRequiredRecords,
        projectedRequiredRecords: projected.size,
        pendingRequiredRecords: missingRequiredTypes.length,
        failedRequiredRecords: qualityIssueIds.length,
        expectedFamilies: ['runtime'],
        completedFamilies: [],
        missingFamilies: ['runtime'],
        sourceCoverage: {
          runtime: {
            expected: expectedRequiredRecords,
            projected: projected.size,
            pending: missingRequiredTypes.length,
            failed: qualityIssueIds.length,
            lastSourceRevision: hashCanonicalEvidenceJson(taskRevision),
          },
        },
        lastEvidenceSequence,
        status: 'projecting',
        qualityIssueIds,
        createdAt: recordedAt,
      });
    }
    return Object.freeze({
      taskId: normalizedTaskId,
      episodeId,
      projectedRecordIds: Object.freeze([...projected.values()].map((record) => record.recordId)),
      qualityIssueIds: Object.freeze(qualityIssueIds),
      lastEvidenceSequence,
      ...(manifestId === undefined ? {} : { manifestId }),
    });
  }
}

export function createSkillExecutionEvidenceRecordId(row: RuntimeCoreSourceRow): string {
  const catalog = EVIDENCE_RECORD_CATALOG.find((entry) => entry.recordType === 'skill.execution');
  if (catalog === undefined) throw new Error('Evidence catalog entry skill.execution missing.');
  return createEvidenceRecordId({
    sourceSystem: catalog.sourceSystem,
    sourceTable: catalog.sourceTable,
    sourceRecordId: text(row, 'execution_id'),
    sourceRevision: hashCanonicalEvidenceJson(skillExecutionEvidenceRevision(row)),
    schemaName: catalog.schemaName,
    schemaVersion: catalog.schemaVersion,
  });
}

export function skillExecutionEvidenceRevision(row: RuntimeCoreSourceRow): EvidenceJsonValue {
  return {
    executionId: row['execution_id'] ?? null,
    parentExecutionId: row['parent_execution_id'] ?? null,
    taskId: row['task_id'] ?? null,
    goalId: row['goal_id'] ?? null,
    goalVersion: row['goal_version'] ?? null,
    skillId: row['skill_id'] ?? null,
    skillVersion: row['skill_version'] ?? null,
    selectionRef: row['selection_ref'] ?? null,
    applicabilityStatus: row['applicability_status'] ?? null,
    usagePolicy: row['usage_policy_json'] ?? null,
    workflowPlanId: row['workflow_plan_id'] ?? null,
    workflowDefinitionId: row['workflow_definition_id'] ?? null,
    workflowDefinitionVersion: row['workflow_definition_version'] ?? null,
    createdAt: row['created_at'] ?? null,
  };
}

function key(recordType: string, sourceRecordId: string): string {
  return `${recordType}:${sourceRecordId}`;
}

function objectOrEmpty(value: EvidenceJsonValue | undefined): RuntimeCoreSourceRow {
  return isRuntimeCoreSourceRow(value) ? value : {};
}

function isRuntimeCoreSourceRow(
  value: EvidenceJsonValue | undefined,
): value is RuntimeCoreSourceRow {
  return (
    value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object'
  );
}

function refs(...records: readonly (CanonicalEvidenceEnvelope | undefined)[]): readonly string[] {
  return records.filter((record) => record !== undefined).map((record) => record.recordId);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') throw new Error(`${field} must not be empty.`);
  return normalized;
}

function value(row: RuntimeCoreSourceRow, field: string): EvidenceJsonValue {
  const result = row[field];
  if (result === undefined) throw new Error(`Runtime source field ${field} is missing.`);
  return result;
}

function text(row: RuntimeCoreSourceRow, field: string): string {
  const result = value(row, field);
  if (typeof result !== 'string' || result.trim() === '')
    throw new Error(`Runtime source field ${field} must be text.`);
  return result;
}

function optionalText(row: RuntimeCoreSourceRow, field: string): string | undefined {
  const result = row[field];
  return typeof result === 'string' && result.trim() !== '' ? result : undefined;
}

function integer(row: RuntimeCoreSourceRow, field: string): number {
  const result = value(row, field);
  const parsed = typeof result === 'number' ? result : Number(result);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`Runtime source field ${field} must be integer.`);
  return parsed;
}

function optionalInteger(row: RuntimeCoreSourceRow, field: string): number | undefined {
  const result = row[field];
  if (result === undefined || result === null) return undefined;
  const parsed = typeof result === 'number' ? result : Number(result);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function timestamp(row: RuntimeCoreSourceRow, ...fields: readonly string[]): string {
  for (const field of fields) {
    const result = row[field];
    if (typeof result === 'string' && !Number.isNaN(Date.parse(result)))
      return new Date(result).toISOString();
  }
  throw new Error(`Runtime source timestamp ${fields.join('/')} is missing.`);
}

function array(row: RuntimeCoreSourceRow, field: string): readonly EvidenceJsonValue[] {
  const result = row[field];
  return Array.isArray(result) ? (result as readonly EvidenceJsonValue[]) : [];
}

function nestedArray(
  row: RuntimeCoreSourceRow,
  field: string,
  nestedField: string,
): readonly EvidenceJsonValue[] {
  const container = row[field];
  if (container === null || Array.isArray(container) || typeof container !== 'object') return [];
  const nested = (container as Readonly<Record<string, EvidenceJsonValue>>)[nestedField];
  return Array.isArray(nested) ? (nested as readonly EvidenceJsonValue[]) : [];
}
