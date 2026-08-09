import {
  EVIDENCE_RECORD_CATALOG,
  createCanonicalEvidenceEnvelope,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EvidenceJsonValue,
  type EvidenceQualityIssue,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import {
  createSkillExecutionEvidenceRecordId,
  skillExecutionEvidenceRevision,
  type RuntimeCoreEvidenceWriter,
  type RuntimeCoreSourceRow,
} from './runtime-core-evidence-projector.js';

export const SKILL_EVIDENCE_PROJECTOR_VERSION = 'skill/v1' as const;

export interface SkillEvidenceSnapshot {
  readonly task: RuntimeCoreSourceRow;
  readonly selections: readonly RuntimeCoreSourceRow[];
  readonly inputResolutions: readonly RuntimeCoreSourceRow[];
  readonly executions: readonly RuntimeCoreSourceRow[];
  readonly events: readonly RuntimeCoreSourceRow[];
  readonly references: readonly RuntimeCoreSourceRow[];
  readonly skillVersions: readonly RuntimeCoreSourceRow[];
  readonly capabilityBindings: readonly RuntimeCoreSourceRow[];
  readonly existingEvidence: readonly RuntimeCoreSourceRow[];
}

export interface SkillEvidenceSource {
  pendingTaskIds(limit: number): Promise<readonly string[]>;
  load(taskId: string): Promise<SkillEvidenceSnapshot | undefined>;
}

export interface SkillEvidenceWriter extends RuntimeCoreEvidenceWriter {
  resolveQualityIssues(input: {
    readonly episodeId: string;
    readonly recordTypePrefix: string;
    readonly retainedIssueIds: readonly string[];
    readonly resolvedAt: string;
  }): Promise<void>;
}

export interface SkillEvidenceProjectionResult {
  readonly taskId: string;
  readonly projectedRecordIds: readonly string[];
  readonly qualityIssueIds: readonly string[];
  readonly lastEvidenceSequence: string;
}

interface SkillEvidenceEmitInput {
  readonly type: string;
  readonly sourceId: string;
  readonly revision: EvidenceJsonValue;
  readonly occurredAt: string;
  readonly payload: RuntimeCoreSourceRow;
  readonly refs: readonly (string | undefined)[];
  readonly executionId?: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
}

export class SkillEvidenceProjector {
  readonly #source: SkillEvidenceSource;
  readonly #writer: SkillEvidenceWriter;
  readonly #environment: string;
  readonly #clock: { now(): string };

  constructor(input: {
    source: SkillEvidenceSource;
    writer: SkillEvidenceWriter;
    environment: string;
    clock?: { now(): string };
  }) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#environment = requiredText(input.environment, 'environment');
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async projectTask(taskId: string): Promise<SkillEvidenceProjectionResult> {
    const normalizedTaskId = requiredText(taskId, 'taskId');
    const snapshot = await this.#source.load(normalizedTaskId);
    if (snapshot === undefined)
      throw new Error(`Skill Evidence Task ${normalizedTaskId} not found.`);
    const recordedAt = this.#clock.now();
    const partition = `skill:${normalizedTaskId}`;
    const episodeId = normalizedTaskId;
    const projected = new Map<string, CanonicalEvidenceEnvelope>();
    const sequences: string[] = [];
    const issueIds: string[] = [];
    const existing = (type: string, sourceId?: string): string | undefined =>
      textOrUndefined(
        snapshot.existingEvidence.find(
          (row) =>
            row['record_type'] === type &&
            (sourceId === undefined || row['source_record_id'] === sourceId),
        ),
        'record_id',
      );
    const existingCapability = (capabilityId: string, version: number): string | undefined =>
      textOrUndefined(
        uniqueRow(
          snapshot.existingEvidence.filter(
            (row) =>
              row['record_type'] === 'capability.definition' &&
              objectOrUndefined(row, 'payload')?.['capabilityId'] === capabilityId &&
              objectOrUndefined(row, 'payload')?.['version'] === version,
          ),
        ),
        'record_id',
      );
    const issue = async (
      type: string,
      table: string,
      sourceId: string,
      detail: Readonly<Record<string, EvidenceJsonValue>>,
    ): Promise<void> => {
      const issueId = `quality_${hashCanonicalEvidenceJson([normalizedTaskId, type, table, sourceId, detail]).slice(7)}`;
      const value: EvidenceQualityIssue = {
        issueId,
        issueCode: 'reference_unresolved',
        severity: 'blocking',
        recordType: type,
        episodeId,
        sourceSystem: 'runtime',
        sourceTable: table,
        sourceRecordId: sourceId,
        detail,
        createdAt: recordedAt,
      };
      await this.#writer.recordQualityIssue(value);
      issueIds.push(issueId);
    };
    const emit = async (input: SkillEvidenceEmitInput): Promise<CanonicalEvidenceEnvelope> => {
      const catalog = requiredCatalog(input.type);
      const envelope = createCanonicalEvidenceEnvelope({
        sourceSystem: 'runtime',
        sourceTable: catalog.sourceTable,
        sourceRecordId: input.sourceId,
        sourceRevision: hashCanonicalEvidenceJson(input.revision),
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
        evidenceRefs: input.refs.filter((value): value is string => value !== undefined),
        taskId: normalizedTaskId,
        contextId: text(snapshot.task, 'context_id'),
        episodeId,
        ...(input.executionId === undefined ? {} : { skillExecutionId: input.executionId }),
        ...(input.goalId === undefined ? {} : { goalId: input.goalId }),
        ...(input.goalVersion === undefined ? {} : { goalVersion: input.goalVersion }),
        ...(input.planId === undefined ? {} : { planId: input.planId }),
        payload: input.payload,
      });
      sequences.push(await this.#writer.append(envelope, recordedAt, partition));
      projected.set(`${input.type}:${input.sourceId}`, envelope);
      return envelope;
    };

    for (const selection of snapshot.selections) {
      const selectionId = text(selection, 'selection_id');
      const candidates = rows(selection, 'candidates_json');
      const goalContractRef = existing('runtime.goal_contract');
      if (goalContractRef === undefined) {
        await issue('skill.candidate', 'skill_selection_record', selectionId, {
          missingReference: 'runtime.goal_contract',
        });
        continue;
      }
      for (const candidate of candidates) {
        const skillId = text(candidate, 'skillId');
        const skillVersion = integer(candidate, 'skillVersion');
        const sourceId = `${selectionId}:${skillId}:${String(skillVersion)}`;
        const candidateRecord = await emit({
          type: 'skill.candidate',
          sourceId,
          revision: candidate,
          occurredAt: timestamp(selection, 'created_at'),
          payload: {
            selectionId,
            skillId,
            skillVersion,
            candidateSnapshotHash: hashCanonicalEvidenceJson(candidate),
          },
          refs: [goalContractRef],
        });
        const applicability = objectOrUndefined(candidate, 'usageCandidate');
        await emit({
          type: 'skill.applicability',
          sourceId,
          revision: applicability ?? { status: 'unknown' },
          occurredAt: timestamp(selection, 'created_at'),
          payload: {
            selectionId,
            skillId,
            applicabilityStatus:
              objectOrUndefined(applicability ?? {}, 'applicability')?.['status'] ?? 'unknown',
            applicabilitySnapshot: applicability ?? {},
          },
          refs: [candidateRecord.recordId],
        });
      }
      const selectedId = `${selectionId}:${text(selection, 'selected_skill_id')}:${String(integer(selection, 'selected_skill_version'))}`;
      const candidateRef = projected.get(`skill.candidate:${selectedId}`)?.recordId;
      const applicabilityRef = projected.get(`skill.applicability:${selectedId}`)?.recordId;
      if (candidateRef === undefined || applicabilityRef === undefined)
        await issue('skill.selection', 'skill_selection_record', selectionId, {
          missingReference: 'selected candidate/applicability',
        });
      if (candidateRef === undefined || applicabilityRef === undefined) continue;
      await emit({
        type: 'skill.selection',
        sourceId: selectionId,
        revision: selection,
        occurredAt: timestamp(selection, 'created_at'),
        payload: {
          selectionId,
          selectedSkillId: text(selection, 'selected_skill_id'),
          selectedSkillVersion: integer(selection, 'selected_skill_version'),
          decisionSummary: value(selection, 'decision_summary'),
        },
        refs: [candidateRef, applicabilityRef],
      });
    }

    for (const resolution of snapshot.inputResolutions) {
      const resolutionId = text(resolution, 'resolution_id');
      const matchingExecutions = snapshot.executions.filter(
        (execution) =>
          execution['skill_id'] === resolution['skill_id'] &&
          execution['skill_version'] === resolution['skill_version'] &&
          execution['goal_id'] === resolution['goal_id'] &&
          execution['goal_version'] === resolution['goal_version'],
      );
      const matchingExecution = uniqueRow(matchingExecutions);
      const selectionId =
        matchingExecution === undefined ? undefined : text(matchingExecution, 'selection_ref');
      const selectionRef =
        selectionId === undefined
          ? undefined
          : (projected.get(`skill.selection:${selectionId}`)?.recordId ??
            existing('skill.selection', selectionId));
      if (selectionRef === undefined)
        await issue('skill.context_resolution', 'skill_input_resolution', resolutionId, {
          missingReference: 'skill.selection',
          matchingSkillExecutionCount: matchingExecutions.length,
        });
      if (selectionRef === undefined) continue;
      await emit({
        type: 'skill.context_resolution',
        sourceId: resolutionId,
        revision: resolution,
        occurredAt: timestamp(resolution, 'created_at'),
        payload: {
          resolutionId,
          status: value(resolution, 'status'),
          sourceRefs: value(resolution, 'source_refs_json'),
          unresolvedFields: value(resolution, 'unresolved_fields_json'),
        },
        refs: [selectionRef],
      });
    }

    for (const execution of snapshot.executions) {
      await this.#projectExecution({
        snapshot,
        execution,
        emit,
        issue,
        projected,
        existing,
        existingCapability,
      });
    }
    for (const binding of snapshot.capabilityBindings) {
      for (const requirement of rows(binding, 'evidence_requirement_snapshot')) {
        const bindingId = text(binding, 'binding_id');
        const requirementId = text(requirement, 'requirementId');
        const bindingRef = existing('capability.task_binding', bindingId);
        if (bindingRef === undefined) {
          await issue(
            'skill.evidence_requirement',
            'task_capability_binding',
            `${bindingId}:${requirementId}`,
            { missingReference: 'capability.task_binding' },
          );
          continue;
        }
        await emit({
          type: 'skill.evidence_requirement',
          sourceId: `${bindingId}:${requirementId}`,
          revision: requirement,
          occurredAt: timestamp(binding, 'bound_at'),
          payload: {
            bindingId,
            requirementId,
            requirementType:
              requirement['requirementType'] ?? requirement['evidenceType'] ?? 'unknown',
            requirementSnapshot: requirement,
          },
          refs: [bindingRef],
        });
      }
    }

    const lastEvidenceSequence = sequences.at(-1) ?? '0';
    await this.#writer.resolveQualityIssues({
      episodeId,
      recordTypePrefix: 'skill.',
      retainedIssueIds: issueIds,
      resolvedAt: recordedAt,
    });
    await this.#writer.saveCheckpoint({
      sourceFamily: 'skill',
      sourcePartition: partition,
      lastOccurredAt: timestamp(snapshot.task, 'updated_at'),
      lastSourceRecordId: normalizedTaskId,
      lastSourceRevision: hashCanonicalEvidenceJson(snapshot.executions),
      lastPayloadHash: hashCanonicalEvidenceJson(
        [...projected.values()].map((record) => record.payloadHash),
      ),
      lastProjectedAt: recordedAt,
      projectorVersion: SKILL_EVIDENCE_PROJECTOR_VERSION,
    } satisfies EvidenceSourceCheckpoint);
    return Object.freeze({
      taskId: normalizedTaskId,
      projectedRecordIds: Object.freeze([...projected.values()].map((record) => record.recordId)),
      qualityIssueIds: Object.freeze(issueIds),
      lastEvidenceSequence,
    });
  }

  async #projectExecution(input: {
    snapshot: SkillEvidenceSnapshot;
    execution: RuntimeCoreSourceRow;
    emit: (input: SkillEvidenceEmitInput) => Promise<CanonicalEvidenceEnvelope>;
    issue: (
      type: string,
      table: string,
      sourceId: string,
      detail: Readonly<Record<string, EvidenceJsonValue>>,
    ) => Promise<void>;
    projected: Map<string, CanonicalEvidenceEnvelope>;
    existing: (type: string, sourceId?: string) => string | undefined;
    existingCapability: (capabilityId: string, version: number) => string | undefined;
  }): Promise<void> {
    const { snapshot, execution, emit, issue, projected, existing, existingCapability } = input;
    const executionId = text(execution, 'execution_id');
    const selectionId = text(execution, 'selection_ref');
    const planId = text(execution, 'workflow_plan_id');
    const selectionRef =
      projected.get(`skill.selection:${selectionId}`)?.recordId ??
      existing('skill.selection', selectionId);
    const planStepMatches = snapshot.existingEvidence.filter(
      (row) => row['record_type'] === 'runtime.plan_step' && row['plan_id'] === planId,
    );
    const matchingPlanStep = uniqueRow(planStepMatches);
    const planStepRef =
      matchingPlanStep === undefined ? undefined : text(matchingPlanStep, 'record_id');
    if (selectionRef === undefined || planStepRef === undefined)
      await issue('skill.execution', 'skill_execution_record', executionId, {
        missingReference: 'skill.selection/runtime.plan_step',
        matchingPlanStepCount: planStepMatches.length,
      });
    if (selectionRef === undefined || planStepRef === undefined) return;
    const executionRecord = await emit({
      type: 'skill.execution',
      sourceId: executionId,
      revision: skillExecutionEvidenceRevision(execution),
      occurredAt: timestamp(execution, 'created_at'),
      payload: {
        executionId,
        skillId: text(execution, 'skill_id'),
        skillVersion: integer(execution, 'skill_version'),
        workflowPlanId: planId,
        status: terminalSkillStatus(snapshot.events, executionId),
      },
      refs: [selectionRef, planStepRef],
      executionId,
      goalId: text(execution, 'goal_id'),
      goalVersion: integer(execution, 'goal_version'),
      planId,
    });
    const policy = object(execution, 'usage_policy_json');
    const compositionRecord = await emit({
      type: 'skill.composition',
      sourceId: executionId,
      revision: policy['composition'] ?? {},
      occurredAt: timestamp(execution, 'created_at'),
      payload: {
        executionId,
        parentExecutionId: execution['parent_execution_id'] ?? null,
        compositionMode: policy['mode'] ?? 'unknown',
        composition: policy['composition'] ?? {},
      },
      refs: [selectionRef],
      executionId,
      planId,
    });
    const executionEvents = snapshot.events.filter((row) => row['execution_id'] === executionId);
    for (const event of executionEvents) {
      const eventId = text(event, 'event_id');
      const eventType = text(event, 'event_type');
      const details = object(event, 'details_json');
      const genericEvent = await emit({
        type: 'skill.execution_event',
        sourceId: eventId,
        revision: event,
        occurredAt: timestamp(event, 'occurred_at'),
        payload: {
          eventId,
          executionId,
          eventType,
          statusAfter: event['status_after'] ?? null,
          details,
        },
        refs: [executionRecord.recordId],
        executionId,
        planId,
      });
      if (eventType === 'skill.mode_selected')
        await emit({
          type: 'skill.mode_selection',
          sourceId: eventId,
          revision: event,
          occurredAt: timestamp(event, 'occurred_at'),
          payload: { eventId, executionId, mode: details['mode'] ?? policy['mode'] ?? 'unknown' },
          refs: [selectionRef],
          executionId,
          planId,
        });
      if (eventType === 'skill.child_selected') {
        const edge = compositionEdge(policy, text(details, 'edgeId'));
        const child = uniqueChild(snapshot.executions, executionId, details);
        if (child === undefined) {
          await issue('skill.composition_edge', 'skill_execution_event', eventId, {
            missingReference: 'child skill execution',
          });
          continue;
        }
        await emit({
          type: 'skill.composition_edge',
          sourceId: eventId,
          revision: event,
          occurredAt: timestamp(event, 'occurred_at'),
          payload: {
            eventId,
            parentExecutionId: executionId,
            childExecutionId: text(child, 'execution_id'),
            edgeId: details['edgeId'] ?? null,
            failurePolicy: edge?.['failurePolicy'] ?? details['failurePolicy'] ?? null,
            inputMappings: edge?.['inputMappings'] ?? [],
            outputMappings: edge?.['outputMappings'] ?? [],
          },
          refs: [compositionRecord.recordId],
          executionId,
          planId,
        });
        if (edge?.['kind'] === 'capability_slot') {
          const capabilityId = capabilityForSlot(
            snapshot.skillVersions,
            execution,
            text(edge, 'declarationId'),
          );
          const matchingBindings = snapshot.capabilityBindings.filter(
            (binding) => binding['requested_capability_id'] === capabilityId,
          );
          const matchingBinding = uniqueRow(matchingBindings);
          const capabilityVersion =
            matchingBinding === undefined
              ? undefined
              : optionalInteger(matchingBinding, 'capability_version');
          const capabilityRef =
            capabilityId === undefined || capabilityVersion === undefined
              ? undefined
              : existingCapability(capabilityId, capabilityVersion);
          if (
            capabilityId === undefined ||
            capabilityVersion === undefined ||
            capabilityRef === undefined
          ) {
            await issue('skill.capability_slot_resolution', 'skill_execution_event', eventId, {
              missingReference: 'capability.definition',
              slotId: edge['declarationId'] ?? null,
              matchingCapabilityBindingCount: matchingBindings.length,
            });
            continue;
          }
          await emit({
            type: 'skill.capability_slot_resolution',
            sourceId: eventId,
            revision: [event, capabilityId, capabilityVersion],
            occurredAt: timestamp(event, 'occurred_at'),
            payload: {
              eventId,
              slotId: text(edge, 'declarationId'),
              capabilityId,
              capabilityVersion,
              childExecutionId: text(child, 'execution_id'),
            },
            refs: [compositionRecord.recordId, capabilityRef],
            executionId,
            planId,
          });
        }
      }
      if (eventType === 'skill.procedure_compiled') {
        const capabilitySlotRefs = [...projected.values()]
          .filter(
            (record) =>
              record.recordType === 'skill.capability_slot_resolution' &&
              record.skillExecutionId === executionId,
          )
          .map((record) => record.recordId);
        if (capabilitySlotRefs.length === 0) {
          await issue('skill.procedure_compilation', 'skill_execution_event', eventId, {
            missingReference: 'skill.capability_slot_resolution',
          });
          continue;
        }
        await emit({
          type: 'skill.procedure_compilation',
          sourceId: eventId,
          revision: event,
          occurredAt: timestamp(event, 'occurred_at'),
          payload: {
            eventId,
            executionId,
            procedureHash: hashCanonicalEvidenceJson({
              workflowDefinitionId:
                details['workflowDefinitionId'] ?? execution['workflow_definition_id'],
              workflowDefinitionVersion:
                details['workflowDefinitionVersion'] ?? execution['workflow_definition_version'],
            }),
          },
          refs: capabilitySlotRefs,
          executionId,
          planId,
        });
      }
      if (
        eventType === 'skill.plan_compliance_passed' ||
        eventType === 'skill.plan_compliance_failed'
      ) {
        const procedureRef = [...projected.values()].find(
          (record) =>
            record.recordType === 'skill.procedure_compilation' &&
            record.skillExecutionId === executionId,
        )?.recordId;
        const runtimePlanRef = existing('runtime.plan', planId);
        if (procedureRef === undefined || runtimePlanRef === undefined) {
          await issue('skill.plan_compliance', 'skill_execution_event', eventId, {
            missingReference: 'skill.procedure_compilation/runtime.plan',
          });
          continue;
        }
        await emit({
          type: 'skill.plan_compliance',
          sourceId: eventId,
          revision: event,
          occurredAt: timestamp(event, 'occurred_at'),
          payload: {
            eventId,
            executionId,
            complianceStatus: eventType.endsWith('_passed') ? 'passed' : 'failed',
            errors: details['errors'] ?? [],
          },
          refs: [procedureRef, runtimePlanRef],
          executionId,
          planId,
        });
      }
      if (eventType === 'skill.execution_failed')
        await emit({
          type: 'skill.failure_propagation',
          sourceId: eventId,
          revision: event,
          occurredAt: timestamp(event, 'occurred_at'),
          payload: {
            eventId,
            executionId,
            failureCode: details['failureCode'] ?? 'SKILL_EXECUTION_FAILED',
            failurePolicy: details['failurePolicy'] ?? null,
            missingEffects: details['missingEffects'] ?? [],
            missingEvidence: details['missingEvidence'] ?? [],
          },
          refs: [genericEvent.recordId],
          executionId,
          planId,
        });
    }
    for (const reference of snapshot.references.filter(
      (row) => row['execution_id'] === executionId,
    )) {
      const linkId = text(reference, 'link_id');
      await emit({
        type: 'skill.execution_reference',
        sourceId: linkId,
        revision: reference,
        occurredAt: timestamp(reference, 'created_at'),
        payload: {
          linkId,
          executionId,
          referenceType: value(reference, 'reference_type'),
          kind: value(reference, 'kind'),
          referenceId: value(reference, 'reference_id'),
          producerRefs: value(reference, 'producer_refs_json'),
          metadata: value(reference, 'metadata_json'),
        },
        refs: [executionRecord.recordId],
        executionId,
        planId,
      });
    }
    const matchingVersions = snapshot.skillVersions.filter(
      (version) =>
        version['skill_id'] === execution['skill_id'] &&
        version['version'] === execution['skill_version'],
    );
    const matchingVersion = uniqueRow(matchingVersions);
    const declaredUsage =
      matchingVersion === undefined
        ? undefined
        : objectOrUndefined(matchingVersion, 'usage_specification_json');
    if (declaredUsage === undefined) {
      await issue('skill.usage_snapshot', 'skill_execution_record', executionId, {
        missingReference: 'skill_version.usage_specification_json',
        matchingSkillVersionCount: matchingVersions.length,
      });
      return;
    }
    const episodeRef = existing('runtime.episode');
    if (episodeRef === undefined) {
      await issue('skill.usage_snapshot', 'skill_execution_record', executionId, {
        missingReference: 'runtime.episode',
      });
      return;
    }
    await emit({
      type: 'skill.usage_snapshot',
      sourceId: executionId,
      revision: [skillExecutionEvidenceRevision(execution), declaredUsage],
      occurredAt: timestamp(execution, 'created_at'),
      payload: {
        executionId,
        skillId: text(execution, 'skill_id'),
        skillVersion: integer(execution, 'skill_version'),
        usageSpecificationHash: hashCanonicalEvidenceJson(declaredUsage),
        usageSpecificationSnapshot: declaredUsage,
        executionPolicyHash: hashCanonicalEvidenceJson(policy),
        executionPolicySnapshot: policy,
      },
      refs: [episodeRef, createSkillExecutionEvidenceRecordId(execution)],
      executionId,
      planId,
    });
  }
}

function requiredCatalog(type: string) {
  const found = EVIDENCE_RECORD_CATALOG.find((entry) => entry.recordType === type);
  if (found === undefined) throw new Error(`Missing Evidence catalog ${type}.`);
  return found;
}
function requiredText(value: string, field: string) {
  const result = value.trim();
  if (result === '') throw new Error(`${field} missing.`);
  return result;
}
function value(row: RuntimeCoreSourceRow, field: string): EvidenceJsonValue {
  const result = row[field];
  if (result === undefined) throw new Error(`Skill source ${field} missing.`);
  return result;
}
function text(row: RuntimeCoreSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'string' || result.trim() === '')
    throw new Error(`Skill source ${field} invalid.`);
  return result;
}
function integer(row: RuntimeCoreSourceRow, field: string) {
  const result = value(row, field);
  if (typeof result !== 'number' || !Number.isSafeInteger(result))
    throw new Error(`Skill source ${field} invalid.`);
  return result;
}
function optionalInteger(row: RuntimeCoreSourceRow, field: string): number | undefined {
  const result = row[field];
  return typeof result === 'number' && Number.isSafeInteger(result) ? result : undefined;
}
function timestamp(row: RuntimeCoreSourceRow, field: string) {
  const result = text(row, field);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`Skill source ${field} timestamp invalid.`);
  return new Date(result).toISOString();
}
function object(row: RuntimeCoreSourceRow, field: string): RuntimeCoreSourceRow {
  const result = value(row, field);
  if (result === null || Array.isArray(result) || typeof result !== 'object')
    throw new Error(`Skill source ${field} object invalid.`);
  return result as RuntimeCoreSourceRow;
}
function objectOrUndefined(
  row: RuntimeCoreSourceRow,
  field: string,
): RuntimeCoreSourceRow | undefined {
  const result = row[field];
  return result !== null && !Array.isArray(result) && typeof result === 'object'
    ? (result as RuntimeCoreSourceRow)
    : undefined;
}
function rows(row: RuntimeCoreSourceRow, field: string): readonly RuntimeCoreSourceRow[] {
  const result = value(row, field);
  if (
    !Array.isArray(result) ||
    result.some((item) => item === null || Array.isArray(item) || typeof item !== 'object')
  )
    throw new Error(`Skill source ${field} array invalid.`);
  return result as readonly RuntimeCoreSourceRow[];
}
function textOrUndefined(row: RuntimeCoreSourceRow | undefined, field: string) {
  if (row === undefined) return undefined;
  const result = row[field];
  return typeof result === 'string' && result.trim() !== '' ? result : undefined;
}
function terminalSkillStatus(
  events: readonly RuntimeCoreSourceRow[],
  executionId: string,
): EvidenceJsonValue {
  return (
    events
      .filter(
        (event) =>
          event['execution_id'] === executionId && typeof event['status_after'] === 'string',
      )
      .at(-1)?.['status_after'] ?? 'selected'
  );
}
function compositionEdge(
  policy: RuntimeCoreSourceRow,
  edgeId: string,
): RuntimeCoreSourceRow | undefined {
  const composition = objectOrUndefined(policy, 'composition');
  const edges = composition?.['edges'];
  if (!Array.isArray(edges)) return undefined;
  for (const edge of edges as readonly unknown[])
    if (isSourceRow(edge) && edge['edgeId'] === edgeId) return edge;
  return undefined;
}
function uniqueChild(
  executions: readonly RuntimeCoreSourceRow[],
  parentId: string,
  details: RuntimeCoreSourceRow,
) {
  const matches = executions.filter(
    (row) =>
      row['parent_execution_id'] === parentId &&
      row['skill_id'] === details['skillId'] &&
      row['skill_version'] === details['skillVersion'],
  );
  return matches.length === 1 ? matches[0] : undefined;
}
function capabilityForSlot(
  versions: readonly RuntimeCoreSourceRow[],
  execution: RuntimeCoreSourceRow,
  slotId: string,
): string | undefined {
  const version = versions.find(
    (row) =>
      row['skill_id'] === execution['skill_id'] && row['version'] === execution['skill_version'],
  );
  const usage =
    version === undefined ? undefined : objectOrUndefined(version, 'usage_specification_json');
  const composition = usage === undefined ? undefined : objectOrUndefined(usage, 'composition');
  const slots = composition?.['capabilitySlots'];
  if (!Array.isArray(slots)) return undefined;
  for (const slot of slots as readonly unknown[])
    if (isSourceRow(slot) && slot['slotId'] === slotId && typeof slot['capability'] === 'string')
      return slot['capability'];
  return undefined;
}

function isSourceRow(value: unknown): value is RuntimeCoreSourceRow {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function uniqueRow(rows: readonly RuntimeCoreSourceRow[]): RuntimeCoreSourceRow | undefined {
  return rows.length === 1 ? rows.at(0) : undefined;
}
