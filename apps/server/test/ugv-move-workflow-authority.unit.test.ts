import { describe, expect, it, vi } from 'vitest';

import type { SkillExecutionRepository } from '../../../packages/application/src/index.js';
import type {
  SkillExecutionReference,
  SkillExecutionView,
} from '../../../packages/domain/src/index.js';
import {
  UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
  UgvMoveWorkflowAuthority,
} from '../src/ugv-move-workflow-authority.js';
import { prepareUgvMoveWorkflowPlan } from '../src/ugv-move-workflow.js';

import {
  UGV_WORKFLOW_GOAL,
  UGV_WORKFLOW_IDENTITY,
  createUgvSelectedTaskOperationFixture,
  ugvWorkflowPlanningFixture,
} from './ugv-move-workflow-test-fixture.js';

describe('UGV move SelectedTaskOperation Workflow authority', () => {
  it('appends and reloads exactly one self-hashed existing execution reference', async () => {
    const fixture = await authorityFixture();
    const loaded = await fixture.authority.append(UGV_WORKFLOW_IDENTITY, fixture.selected);

    expect(loaded).toEqual(fixture.selected);
    expect(fixture.repository.appendReference).toHaveBeenCalledTimes(1);
    expect(fixture.repository.view.references).toEqual([
      expect.objectContaining({
        kind: 'remote_task_binding',
        referenceId: fixture.selected.snapshotHash,
        referenceType: UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
        sourceSystem: 'ugv-agent-profile',
        checksum: fixture.selected.snapshotHash.slice('sha256:'.length),
        producedAt: fixture.selected.selectedAt,
        metadata: {
          schemaVersion: UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
          snapshot: fixture.selected,
        },
      }),
    ]);
    await expect(fixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).resolves.toEqual(
      fixture.selected,
    );
    await expect(
      fixture.authority.append(UGV_WORKFLOW_IDENTITY, fixture.selected),
    ).resolves.toEqual(fixture.selected);
    expect(fixture.repository.appendReference).toHaveBeenCalledTimes(1);
  });

  it('fails closed for missing and ambiguous selected-operation references', async () => {
    const missingFixture = await authorityFixture();
    await expect(missingFixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).rejects.toMatchObject({
      code: 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_MISSING',
    });

    const ambiguousFixture = await authorityFixture();
    await ambiguousFixture.authority.append(UGV_WORKFLOW_IDENTITY, ambiguousFixture.selected);
    const first = ambiguousFixture.repository.view.references[0];
    if (first === undefined) throw new Error('UGV_WORKFLOW_REFERENCE_FIXTURE_MISSING');
    ambiguousFixture.repository.setReferences([
      first,
      Object.freeze({ ...first, linkId: 'reference-uap-p2-b03-duplicate' }),
    ]);
    await expect(ambiguousFixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).rejects.toMatchObject(
      {
        code: 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_AMBIGUOUS',
      },
    );
  });

  it('reconstructs through the domain factory and rejects payload, checksum, or envelope tampering', async () => {
    const payloadFixture = await authorityFixture();
    await payloadFixture.authority.append(UGV_WORKFLOW_IDENTITY, payloadFixture.selected);
    const payloadReference = requiredReference(payloadFixture.repository.view);
    payloadFixture.repository.setReferences([
      {
        ...payloadReference,
        metadata: {
          schemaVersion: UGV_SELECTED_TASK_OPERATION_REFERENCE_TYPE,
          snapshot: {
            ...payloadFixture.selected,
            resolvedArguments: {
              ...payloadFixture.selected.resolvedArguments,
              resourceId: 'vehicle:forged',
            },
          },
        },
      },
    ]);
    await expect(payloadFixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).rejects.toMatchObject({
      code: 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_TAMPERED',
    });

    const checksumFixture = await authorityFixture();
    await checksumFixture.authority.append(UGV_WORKFLOW_IDENTITY, checksumFixture.selected);
    const checksumReference = requiredReference(checksumFixture.repository.view);
    checksumFixture.repository.setReferences([{ ...checksumReference, checksum: '0'.repeat(64) }]);
    await expect(checksumFixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).rejects.toMatchObject({
      code: 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_TAMPERED',
    });

    const envelopeFixture = await authorityFixture();
    await envelopeFixture.authority.append(UGV_WORKFLOW_IDENTITY, envelopeFixture.selected);
    const envelopeReference = requiredReference(envelopeFixture.repository.view);
    envelopeFixture.repository.setReferences([
      { ...envelopeReference, sourceSystem: 'untrusted-profile' },
    ]);
    await expect(envelopeFixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).rejects.toMatchObject({
      code: 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_TAMPERED',
    });
  });

  it('rejects task/plan/Skill identity drift before reading a selected reference', async () => {
    const fixture = await authorityFixture();
    await fixture.authority.append(UGV_WORKFLOW_IDENTITY, fixture.selected);
    await expect(
      fixture.authority.loadExact({ ...UGV_WORKFLOW_IDENTITY, taskId: 'task-forged' }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_WORKFLOW_AUTHORITY_IDENTITY_MISMATCH' });
    await expect(
      fixture.authority.loadExact({
        ...UGV_WORKFLOW_IDENTITY,
        workflowDefinitionId: 'workflow-forged',
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_WORKFLOW_AUTHORITY_IDENTITY_MISMATCH' });

    fixture.repository.view = Object.freeze({
      ...fixture.repository.view,
      skillVersion: 2,
    });
    await expect(fixture.authority.loadExact(UGV_WORKFLOW_IDENTITY)).rejects.toMatchObject({
      code: 'UGV_MOVE_WORKFLOW_AUTHORITY_IDENTITY_MISMATCH',
    });
  });

  it('rejects expired or future-selected authority at the planning append boundary', async () => {
    const expired = await authorityFixture('2026-08-21T12:05:00.000Z');
    await expect(
      expired.authority.append(UGV_WORKFLOW_IDENTITY, expired.selected),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_WORKFLOW_AUTHORITY_SELECTION_STALE' });
    expect(expired.repository.appendReference).not.toHaveBeenCalled();

    const future = await authorityFixture('2026-08-21T11:59:59.999Z');
    await expect(
      future.authority.append(UGV_WORKFLOW_IDENTITY, future.selected),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_WORKFLOW_AUTHORITY_SELECTION_STALE' });
    expect(future.repository.appendReference).not.toHaveBeenCalled();
  });

  it('reloads an exact historical snapshot after TTL for restart reconstruction', async () => {
    const fixture = await authorityFixture();
    await fixture.authority.append(UGV_WORKFLOW_IDENTITY, fixture.selected);
    const restartAuthority = new UgvMoveWorkflowAuthority({
      repository: fixture.repository,
      clock: { now: () => '2026-08-21T13:00:00.000Z' },
      nextReferenceId: () => 'reference-must-not-be-created',
    });

    await expect(restartAuthority.loadExact(UGV_WORKFLOW_IDENTITY)).resolves.toEqual(
      fixture.selected,
    );
    expect(fixture.repository.appendReference).toHaveBeenCalledTimes(1);
  });

  it('rejects a repository that drops or substitutes the appended authority reference', async () => {
    const fixture = await authorityFixture();
    fixture.repository.dropAppend = true;
    await expect(
      fixture.authority.append(UGV_WORKFLOW_IDENTITY, fixture.selected),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_WORKFLOW_AUTHORITY_REFERENCE_MISSING' });
  });
});

async function authorityFixture(now = '2026-08-21T12:01:00.000Z') {
  const planning = await ugvWorkflowPlanningFixture();
  const prepared = prepareUgvMoveWorkflowPlan({
    ...planning,
    goalContract: UGV_WORKFLOW_GOAL,
    workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
    workflowVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
    selectedTaskOperation: planning.selected,
  });
  const repository = new MemorySkillExecutionRepository(
    Object.freeze({
      executionId: 'execution-uap-p2-b03',
      taskId: UGV_WORKFLOW_IDENTITY.taskId,
      goalId: UGV_WORKFLOW_IDENTITY.goalId,
      goalVersion: UGV_WORKFLOW_IDENTITY.goalVersion,
      skillId: UGV_WORKFLOW_IDENTITY.skillId,
      skillVersion: UGV_WORKFLOW_IDENTITY.skillVersion,
      selectionRef: 'selection-uap-p2-b03',
      applicabilityStatus: 'satisfied',
      usagePolicy: prepared.policy,
      workflowPlanId: UGV_WORKFLOW_IDENTITY.workflowPlanId,
      workflowDefinitionId: UGV_WORKFLOW_IDENTITY.workflowDefinitionId,
      workflowDefinitionVersion: UGV_WORKFLOW_IDENTITY.workflowDefinitionVersion,
      createdAt: '2026-08-21T12:00:30.000Z',
      status: 'planning',
      events: Object.freeze([]),
      references: Object.freeze([]),
    }),
  );
  const authority = new UgvMoveWorkflowAuthority({
    repository,
    clock: { now: () => now },
    nextReferenceId: () => 'reference-uap-p2-b03',
  });
  return Object.freeze({
    authority,
    repository,
    selected: createUgvSelectedTaskOperationFixture(),
  });
}

function requiredReference(view: SkillExecutionView): SkillExecutionReference {
  const reference = view.references[0];
  if (reference === undefined) throw new Error('UGV_WORKFLOW_REFERENCE_FIXTURE_MISSING');
  return reference;
}

class MemorySkillExecutionRepository implements Pick<
  SkillExecutionRepository,
  'findByPlan' | 'appendReference'
> {
  view: SkillExecutionView;
  dropAppend = false;
  readonly appendReference = vi.fn<SkillExecutionRepository['appendReference']>((reference) => {
    if (!this.dropAppend)
      this.view = Object.freeze({
        ...this.view,
        references: Object.freeze([...this.view.references, reference]),
      });
    return Promise.resolve(this.view);
  });

  constructor(view: SkillExecutionView) {
    this.view = view;
  }

  findByPlan(workflowPlanId: string): Promise<SkillExecutionView | undefined> {
    return Promise.resolve(workflowPlanId === this.view.workflowPlanId ? this.view : undefined);
  }

  setReferences(references: readonly SkillExecutionReference[]): void {
    this.view = Object.freeze({ ...this.view, references: Object.freeze([...references]) });
  }
}
