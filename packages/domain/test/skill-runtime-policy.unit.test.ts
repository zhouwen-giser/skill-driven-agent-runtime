import { describe, expect, it } from 'vitest';
import { createSkillVersion } from '../src/skill.js';
import { taskBusinessEvidencePolicySchema } from '../src/task-business-evidence.js';
import { businessMutationPolicy } from './task-business-command-fixture.js';

describe('Immutable published Skill runtime policy', () => {
  it('detaches nested governance and evidence policies from caller mutation', () => {
    const mutation = {
      ...businessMutationPolicy,
      allowedOperations: [...businessMutationPolicy.allowedOperations],
    };
    const evidence = taskBusinessEvidencePolicySchema.parse({
      schemaVersion: 'sdar.task-business-evidence-policy/v1',
      operationName: 'vehicle_navigate',
      providerSuccess: { jsonPointer: '/state', equals: 'succeeded' },
      skillSuccess: { jsonPointer: '/status', equals: 'completed' },
      requiredGeometryRoles: ['actual_trajectory'],
      requireHistoryContinuity: false,
      requireTrajectoryTime: false,
    });
    const skill = createSkillVersion({
      skillId: 'skill.business-policy',
      version: 1,
      name: 'Business',
      summary: 'Bounded business',
      description: 'Policy snapshot',
      capabilities: [],
      workflowGuidance: 'Observe original Task',
      outputInstruction: 'Return evidence',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: {
        autoConfirmPlan: false,
        taskBusinessMutationPolicy: mutation,
        taskBusinessEvidencePolicy: evidence,
      },
      status: 'draft',
      sourceKind: 'admin',
      validationPassed: false,
      createdAt: '2026-10-10T00:00:00Z',
    });
    mutation.allowedOperations.splice(0);
    evidence.providerSuccess.equals = 'failed';
    evidence.requiredGeometryRoles.splice(0);
    expect(skill.runtimePolicy.taskBusinessMutationPolicy?.allowedOperations).toEqual(
      businessMutationPolicy.allowedOperations,
    );
    expect(skill.runtimePolicy.taskBusinessEvidencePolicy).toMatchObject({
      providerSuccess: { equals: 'succeeded' },
      requiredGeometryRoles: ['actual_trajectory'],
    });
    expect(Object.isFrozen(skill.runtimePolicy.taskBusinessEvidencePolicy?.providerSuccess)).toBe(
      true,
    );
    expect(Object.isFrozen(skill.runtimePolicy.taskBusinessMutationPolicy?.allowedOperations)).toBe(
      true,
    );
  });
});
