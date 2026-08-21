import type { Clock, SkillExecutionRepository } from '../../../packages/application/src/ports.js';
import {
  createSelectedTaskOperation,
  createSkillExecutionReference,
  type SelectedTaskOperation,
  type SelectedTaskOperationDraft,
  type SkillExecutionReference,
  type SkillExecutionView,
} from '../../../packages/domain/src/index.js';

export const UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE = 'ugv.selected_task_operation/v1' as const;
const UGV_SELECTED_TASK_OPERATION_SOURCE = 'ugv-agent-profile';

export interface UgvMoveWorkflowAuthorityIdentity {
  readonly taskId: string;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly skillId: string;
  readonly skillVersion: number;
}

export type UgvMoveWorkflowAuthorityErrorCode =
  | 'UGV_MOVE_WORKFLOW_AUTHORITY_EXECUTION_MISSING'
  | 'UGV_MOVE_WORKFLOW_AUTHORITY_IDENTITY_MISMATCH'
  | 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_MISSING'
  | 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_AMBIGUOUS'
  | 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_TAMPERED'
  | 'UGV_MOVE_WORKFLOW_AUTHORITY_SELECTION_STALE';

export class UgvMoveWorkflowAuthorityError extends Error {
  constructor(
    readonly code: UgvMoveWorkflowAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvMoveWorkflowAuthorityError';
  }
}

type WorkflowAuthorityRepository = Pick<SkillExecutionRepository, 'findByPlan' | 'appendReference'>;

/**
 * Persists the exact selection in the existing append-only Skill execution reference lineage.
 * This creates no parallel table or mutable projection authority.
 */
export class UgvMoveWorkflowAuthority {
  readonly #repository: WorkflowAuthorityRepository;
  readonly #clock: Clock;
  readonly #nextReferenceId: () => string;

  constructor(
    input: Readonly<{
      repository: WorkflowAuthorityRepository;
      clock: Clock;
      nextReferenceId: () => string;
    }>,
  ) {
    this.#repository = input.repository;
    this.#clock = input.clock;
    this.#nextReferenceId = input.nextReferenceId;
  }

  async append(
    identity: UgvMoveWorkflowAuthorityIdentity,
    selectedInput: SelectedTaskOperation,
  ): Promise<SelectedTaskOperation> {
    const selected = rebuildSelectedTaskOperation(selectedInput);
    const now = this.#now();
    assertSelectionCurrent(selected, now);
    const execution = await this.#loadExecution(identity);
    const existing = matchingReferences(execution);
    if (existing.length > 1) ambiguous();
    if (existing.length === 1) {
      const loaded = decodeReference(exactReference(existing));
      if (loaded.snapshotHash !== selected.snapshotHash)
        tampered('A different selected-operation authority already exists for this plan.');
      return loaded;
    }

    const reference = createSkillExecutionReference({
      linkId: nonEmpty(this.#nextReferenceId(), 'reference link ID'),
      executionId: execution.executionId,
      kind: 'remote_task_binding',
      referenceId: selected.snapshotHash,
      referenceType: UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
      sourceSystem: UGV_SELECTED_TASK_OPERATION_SOURCE,
      checksum: checksumBody(selected.snapshotHash),
      producedAt: selected.selectedAt,
      producerRefs: producerRefs(selected),
      metadata: Object.freeze({
        schemaVersion: UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
        snapshot: selected,
      }),
      createdAt: now,
    });
    const updated = await this.#repository.appendReference(reference);
    assertExecutionIdentity(updated, identity);
    const persisted = matchingReferences(updated);
    if (persisted.length === 0)
      missing('The appended selected-operation reference could not be reloaded.');
    if (persisted.length > 1) ambiguous();
    const loaded = decodeReference(exactReference(persisted));
    if (loaded.snapshotHash !== selected.snapshotHash)
      tampered('The persisted selected-operation authority differs from the appended snapshot.');
    return loaded;
  }

  async loadExact(identity: UgvMoveWorkflowAuthorityIdentity): Promise<SelectedTaskOperation> {
    const execution = await this.#loadExecution(identity);
    const references = matchingReferences(execution);
    if (references.length === 0)
      missing('The exact selected-operation reference is missing for this Workflow plan.');
    if (references.length > 1) ambiguous();
    const selected = decodeReference(exactReference(references));
    if (
      selected.skill.skillId !== identity.skillId ||
      selected.skill.version !== identity.skillVersion
    )
      identityMismatch('The selected operation belongs to a different exact Skill version.');
    return selected;
  }

  async #loadExecution(identity: UgvMoveWorkflowAuthorityIdentity): Promise<SkillExecutionView> {
    const execution = await this.#repository.findByPlan(identity.workflowPlanId);
    if (execution === undefined)
      throw new UgvMoveWorkflowAuthorityError(
        'UGV_MOVE_WORKFLOW_AUTHORITY_EXECUTION_MISSING',
        'The authoritative Skill execution record does not exist for this Workflow plan.',
      );
    assertExecutionIdentity(execution, identity);
    return execution;
  }

  #now(): string {
    const value = this.#clock.now();
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds))
      identityMismatch('Workflow authority clock returned an invalid timestamp.');
    return new Date(milliseconds).toISOString();
  }
}

function assertExecutionIdentity(
  execution: SkillExecutionView,
  identity: UgvMoveWorkflowAuthorityIdentity,
): void {
  if (
    identity.skillId !== 'embodied.move_to' ||
    identity.skillVersion !== 1 ||
    execution.taskId !== identity.taskId ||
    execution.workflowPlanId !== identity.workflowPlanId ||
    execution.workflowDefinitionId !== identity.workflowDefinitionId ||
    execution.workflowDefinitionVersion !== identity.workflowDefinitionVersion ||
    execution.goalId !== identity.goalId ||
    execution.goalVersion !== identity.goalVersion ||
    execution.skillId !== identity.skillId ||
    execution.skillVersion !== identity.skillVersion ||
    execution.usagePolicy.skill.skillId !== identity.skillId ||
    execution.usagePolicy.skill.skillVersion !== identity.skillVersion
  )
    identityMismatch(
      'Task, Goal, Workflow plan, Workflow definition, and exact Skill execution identities must match.',
    );
}

function matchingReferences(execution: SkillExecutionView): readonly SkillExecutionReference[] {
  return execution.references.filter(
    (reference) => reference.referenceType === UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
  );
}

function exactReference(references: readonly SkillExecutionReference[]): SkillExecutionReference {
  const reference = references[0];
  if (reference === undefined)
    missing('The exact selected-operation reference is missing for this Workflow plan.');
  return reference;
}

function decodeReference(reference: SkillExecutionReference): SelectedTaskOperation {
  const metadata = record(reference.metadata);
  if (
    reference.kind !== 'remote_task_binding' ||
    reference.sourceSystem !== UGV_SELECTED_TASK_OPERATION_SOURCE ||
    reference.uri !== undefined ||
    metadata === undefined ||
    !exactKeys(metadata, ['schemaVersion', 'snapshot']) ||
    metadata['schemaVersion'] !== UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE
  )
    tampered('The selected-operation reference envelope is invalid.');
  const selected = rebuildSelectedTaskOperation(metadata['snapshot']);
  if (
    reference.referenceId !== selected.snapshotHash ||
    reference.checksum !== checksumBody(selected.snapshotHash) ||
    reference.producedAt !== selected.selectedAt ||
    !sameStrings(reference.producerRefs, producerRefs(selected))
  )
    tampered('The selected-operation reference lineage does not match its self-hashed payload.');
  return selected;
}

function rebuildSelectedTaskOperation(value: unknown): SelectedTaskOperation {
  const raw = record(value);
  const claimedHash = raw?.['snapshotHash'];
  if (raw === undefined || typeof claimedHash !== 'string')
    tampered('The selected-operation snapshot or self-hash is missing.');
  const draft = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== 'snapshotHash'),
  ) as unknown as SelectedTaskOperationDraft;
  let rebuilt: SelectedTaskOperation;
  try {
    rebuilt = createSelectedTaskOperation(draft);
  } catch {
    return tampered(
      'The selected-operation snapshot cannot be reconstructed by its domain factory.',
    );
  }
  if (rebuilt.snapshotHash !== claimedHash)
    tampered('The selected-operation snapshot self-hash is invalid.');
  return rebuilt;
}

function assertSelectionCurrent(selected: SelectedTaskOperation, now: string): void {
  const nowMs = Date.parse(now);
  if (
    Date.parse(selected.selectedAt) > nowMs ||
    Date.parse(selected.availability.validUntil) <= nowMs
  )
    throw new UgvMoveWorkflowAuthorityError(
      'UGV_MOVE_WORKFLOW_AUTHORITY_SELECTION_STALE',
      'The selected Task operation is expired or time-inconsistent at the authority boundary.',
    );
}

function producerRefs(selected: SelectedTaskOperation): readonly string[] {
  return Object.freeze([
    ...new Set([
      selected.skill.packageChecksum,
      selected.provider.manifestHash,
      selected.server.catalogChecksum,
    ]),
  ]);
}

function checksumBody(value: `sha256:${string}`): string {
  return value.slice('sha256:'.length);
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nonEmpty(value: string, label: string): string {
  const result = value.trim();
  if (result === '') identityMismatch(`${label} must be non-empty.`);
  return result;
}

function missing(message: string): never {
  throw new UgvMoveWorkflowAuthorityError('UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_MISSING', message);
}

function ambiguous(): never {
  throw new UgvMoveWorkflowAuthorityError(
    'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_AMBIGUOUS',
    'Exactly one selected-operation reference is required for the Workflow plan.',
  );
}

function tampered(message: string): never {
  throw new UgvMoveWorkflowAuthorityError(
    'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_TAMPERED',
    message,
  );
}

function identityMismatch(message: string): never {
  throw new UgvMoveWorkflowAuthorityError('UGV_MOVE_WORKFLOW_AUTHORITY_IDENTITY_MISMATCH', message);
}
