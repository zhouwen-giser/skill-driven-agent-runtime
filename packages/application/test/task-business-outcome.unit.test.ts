import { describe, expect, it } from 'vitest';
import { createSkillVersion, type SkillVersion } from '../../domain/src/skill.js';
import { hashCanonicalEvidenceJson } from '../../domain/src/evidence/canonical-evidence.js';
import { buildRuntimeSourceArtifact } from '../../domain/src/evidence/source-artifact-ref.js';
import {
  projectTaskBusiness,
  type TaskBusinessProjection,
} from '../../domain/src/task-business.js';
import { taskBusinessEvidencePolicySchema } from '../../domain/src/task-business-evidence.js';
import { taskBusinessFixture } from '../../domain/test/task-business-fixture.js';
import { verifiedTaskBusinessOutcomeRefs } from '../src/task-business-outcome.js';

const evidencePolicy = taskBusinessEvidencePolicySchema.parse({
  schemaVersion: 'sdar.task-business-evidence-policy/v1',
  operationName: 'vehicle_area_recon',
  providerSuccess: { jsonPointer: '/missionTaskState', equals: 'succeeded' },
  skillSuccess: { jsonPointer: '/status', equals: 'completed' },
  requiredGeometryRoles: [],
  requireHistoryContinuity: false,
  requireTrajectoryTime: false,
});
const outcome = {
  schemaVersion: '1.0' as const,
  skillId: 'skill.business',
  skillVersion: 1,
  effects: ['effect.observation'],
  evidence: ['evidence.observation'],
  artifacts: [],
  taskGoalPolicy: {},
  confidencePolicy: {},
  sideEffectPolicy: { confirmation: 'required_before_execution' },
};
const skill = createSkillVersion({
  skillId: outcome.skillId,
  version: outcome.skillVersion,
  name: 'Business',
  summary: 'Observe the bound task',
  description: 'Use actual retained business facts',
  capabilities: ['capability.observation'],
  workflowGuidance: 'Observe once',
  outputInstruction: 'Return actual state',
  inputSchema: { type: 'object', additionalProperties: false },
  outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
  toolPolicy: { required: [], optional: [], forbidden: [] },
  runtimePolicy: { autoConfirmPlan: false, taskBusinessEvidencePolicy: evidencePolicy },
  outcomeSpecification: { ...outcome, specificationHash: hashCanonicalEvidenceJson(outcome) },
  status: 'enabled',
  sourceKind: 'admin',
  validationPassed: true,
  createdAt: '2026-10-10T00:00:00Z',
});
const sourceRef = buildRuntimeSourceArtifact({
  sourceTable: 'remote_task_observation',
  sourceRecordId: 'observation-1',
  sourceVersion: 1,
  value: { original: true },
}).artifactRef;
const rawProjection = projectTaskBusiness({
  bindingId: 'binding-1',
  taskId: 'task-1',
  view: taskBusinessFixture(),
  contents: [],
  receivedAt: '2026-10-10T00:00:00Z',
  projectedAt: '2026-10-10T00:00:00Z',
  historyContinuous: false,
});
const projection: TaskBusinessProjection = {
  ...rawProjection,
  quality: { ...rawProjection.quality, currentStateComplete: true, requiredObjectsResolved: true },
  objects: rawProjection.objects.map((o) => ({ ...o, artifactRef: sourceRef })),
  businessOutcome: {
    protocolStatus: 'completed',
    businessStatus: 'success',
    policySatisfied: true,
    missingRequiredRoles: [],
    gaps: [],
  },
};
const input = {
  taskId: 'task-1',
  selectedSkillId: skill.skillId,
  selectedSkillVersion: skill.version,
  workflowSkillVersions: [{ skillId: skill.skillId, version: skill.version }],
  proof: {
    taskId: 'task-1',
    bindingId: 'capability-binding-1',
    bindingHash: 'a'.repeat(64),
    attemptId: 'attempt-1',
    requestedCapabilityId: 'capability.observation',
    capabilityVersion: 1,
  },
  skill,
  result: { status: 'completed' },
  projections: [projection],
};

describe('Published business policy at the original terminal outcome boundary', () => {
  it('uses published effects with actual retained references only after native capability and business proof', () => {
    expect(verifiedTaskBusinessOutcomeRefs(input)).toEqual({
      effectRefs: outcome.effects,
      evidenceRefs: [sourceRef.uri],
      artifactRefs: [sourceRef.uri],
    });
  });
  it.each([
    { projections: [{ ...projection, taskId: 'another-task' }] },
    { projections: [{ ...projection, status: 'history' as const }] },
    { projections: [{ ...projection, businessOutcome: undefined }] },
    { projections: [{ ...projection, objects: [] }] },
    { result: { status: 'unknown' } },
    { selectedSkillVersion: 2 },
    { workflowSkillVersions: [] },
    { proof: { ...input.proof, requestedCapabilityId: 'another-capability' } },
    { proof: { ...input.proof, taskId: 'another-task' } },
  ])('denies incomplete, historical or foreign proof %#', (patch) => {
    const candidate = { ...input, ...patch } as Parameters<
      typeof verifiedTaskBusinessOutcomeRefs
    >[0];
    expect(() => verifiedTaskBusinessOutcomeRefs(candidate)).toThrow(
      'TASK_BUSINESS_SKILL_SUCCESS_EVIDENCE_INCOMPLETE',
    );
  });
  it('leaves the original compatibility path available when no published business policy exists', () => {
    const legacy: SkillVersion = { ...skill, runtimePolicy: { autoConfirmPlan: false } };
    expect(verifiedTaskBusinessOutcomeRefs({ ...input, skill: legacy })).toBeUndefined();
  });
});
