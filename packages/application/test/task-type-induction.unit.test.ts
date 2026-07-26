import { describe, expect, it } from 'vitest';

import {
  createCognitiveSourceRef,
  createTaskTypeInductionExample,
  type TaskTypeDefinitionSnapshot,
} from '../../domain/src/index.js';
import {
  TaskTypeApplicabilityGuard,
  TaskTypeClusterer,
  TaskTypeFingerprintBuilder,
  TaskTypeInductionService,
} from '../src/cognitive/index.js';
import type {
  CognitiveStructuredModelStageInvoker,
  TaskTypeRepository,
} from '../src/cognitive/ports.js';

describe('G10 Task Type induction', () => {
  it('builds an order-independent multidimensional fingerprint without merging different criteria', () => {
    const builder = new TaskTypeFingerprintBuilder({
      objectiveAliases: { check: 'inspect', verify: 'inspect' },
    });
    const first = example('episode-1', {
      semanticObjective: ['Inspect', 'pump'],
      criteria: ['pressure stable', 'evidence attached'],
    });
    const paraphrase = example('episode-2', {
      semanticObjective: ['pump', 'CHECK'],
      criteria: ['evidence attached', 'pressure stable'],
    });
    const differentCriteria = example('episode-3', {
      semanticObjective: ['verify', 'pump'],
      criteria: ['repair completed'],
    });

    expect(builder.build(first).fingerprint).toBe(builder.build(paraphrase).fingerprint);
    expect(builder.build(first).fingerprint).not.toBe(builder.build(differentCriteria).fingerprint);
  });

  it('does not invoke the model or create a Candidate from one Episode', async () => {
    const repository = new FakeTaskTypes();
    const model = new TaskTypeModel();
    const service = inductionService(repository, model);

    const result = await service.induce({
      mode: 'online_candidate',
      examples: [example('episode-1')],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped).toEqual([
      { episodeIds: ['episode-1'], reasonCode: 'TASK_TYPE_EVIDENCE_INSUFFICIENT' },
    ]);
    expect(model.calls).toBe(0);
    expect(repository.items).toEqual([]);
  });

  it('clusters deterministically before naming and persists a versioned Candidate with 1-3 exemplars', async () => {
    const repository = new FakeTaskTypes();
    const model = new TaskTypeModel();
    const service = inductionService(repository, model);

    const result = await service.induce({
      mode: 'offline_batch',
      examples: [
        example('episode-2', { semanticObjective: ['check', 'pump'] }),
        example('episode-1', { semanticObjective: ['inspect', 'pump'] }),
        example('episode-3', { semanticObjective: ['verify', 'pump'] }),
        example('episode-4', { semanticObjective: ['repair', 'pump'], criteria: ['repair done'] }),
      ],
    });

    expect(model.calls).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      revision: 1,
      status: 'candidate',
      origin: 'induced',
      inductionMode: 'offline_batch',
      recognition: {
        negativeExamples: ['Repairing a failed pump is a different job.'],
      },
    });
    expect(result.candidates[0]?.exemplars.map((item) => item.episodeId)).toEqual([
      'episode-1',
      'episode-2',
      'episode-3',
    ]);
    expect(repository.items).toHaveLength(1);
  });

  it('supports an online revision without allowing Candidate knowledge into active status', async () => {
    const repository = new FakeTaskTypes();
    const model = new TaskTypeModel();
    const service = inductionService(repository, model);
    await service.induce({
      mode: 'offline_batch',
      examples: [example('episode-1'), example('episode-2')],
    });

    const result = await service.induce({
      mode: 'online_candidate',
      examples: [example('episode-1'), example('episode-2'), example('episode-3')],
    });

    expect(result.candidates[0]).toMatchObject({ revision: 2, status: 'candidate' });
    expect(repository.items.map((item) => item.status)).toEqual(['candidate', 'candidate']);
    const duplicate = await service.induce({
      mode: 'online_candidate',
      examples: [example('episode-1'), example('episode-2'), example('episode-3')],
    });
    expect(duplicate.candidates[0]).toMatchObject({ revision: 2 });
    expect(model.calls).toBe(2);
    expect(repository.items).toHaveLength(2);
  });

  it('rejects a Task Type when negative examples, user constraints, dimensions or capabilities conflict', () => {
    const candidate = snapshot();
    const result = new TaskTypeApplicabilityGuard().evaluate(candidate, {
      requestText: 'Repairing a failed pump in the restricted zone.',
      knownDimensions: ['target'],
      userConstraints: ['no remote access'],
      availableCapabilities: [],
    });

    expect(result).toEqual({
      applicable: false,
      reasonCodes: [
        'TASK_TYPE_CAPABILITY_UNAVAILABLE',
        'TASK_TYPE_CONSTRAINT_CONFLICT',
        'TASK_TYPE_NEGATIVE_EXAMPLE_MATCH',
        'TASK_TYPE_REQUIRED_DIMENSION_MISSING',
      ],
    });
  });
});

function inductionService(repository: FakeTaskTypes, model: TaskTypeModel) {
  const fingerprints = new TaskTypeFingerprintBuilder({
    objectiveAliases: { check: 'inspect', verify: 'inspect' },
  });
  return new TaskTypeInductionService({
    fingerprints,
    clusterer: new TaskTypeClusterer({ fingerprints }),
    repository,
    model,
    clock: { now: () => '2026-07-26T05:00:00.000Z' },
    nextTaskTypeId: (fingerprint) => `task-type-${fingerprint.slice(-12)}`,
  });
}

function example(
  episodeId: string,
  override: Partial<Parameters<typeof createTaskTypeInductionExample>[0]['dimensions']> = {},
) {
  return createTaskTypeInductionExample({
    schemaVersion: '1.0',
    episodeId,
    goalId: `goal-${episodeId}`,
    goalVersion: 1,
    dimensions: {
      semanticObjective: override.semanticObjective ?? ['inspect', 'pump'],
      criteria: override.criteria ?? ['pressure stable', 'evidence attached'],
      artifacts: override.artifacts ?? ['inspection report'],
      capabilities: override.capabilities ?? ['device.inspect', 'evidence.capture'],
      dagShape: override.dagShape ?? ['inspect->verify'],
      corrections: override.corrections ?? ['include pressure evidence'],
      outcome: override.outcome ?? ['achieved'],
    },
    constraints: ['no remote access'],
    sourceRefs: [
      createCognitiveSourceRef({
        schemaVersion: '1.0',
        sourceRefId: `source-${episodeId}`,
        sourceKind: 'goal_experience_episode',
        sourceId: episodeId,
        sourceRevision: 1,
        authority: 'runtime_fact',
        dataClassification: 'internal',
        capturedAt: '2026-07-26T04:00:00.000Z',
      }),
    ],
    createdAt: '2026-07-26T04:00:00.000Z',
  });
}

function snapshot(): TaskTypeDefinitionSnapshot {
  return {
    schemaVersion: '1.0',
    taskTypeId: 'task-type-inspection',
    revision: 1,
    status: 'candidate',
    origin: 'induced',
    inductionMode: 'offline_batch',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    title: 'Inspect a pump',
    summary: 'Inspect a pump and return cited evidence.',
    recognition: {
      hints: ['inspect pump'],
      positiveExamples: ['Inspect pump P-17.'],
      negativeExamples: ['Repairing a failed pump is a different job.'],
    },
    requiredDimensions: ['target', 'criteria'],
    optionalDimensions: ['time_range'],
    criteriaTemplate: ['Pressure is stable.', 'Evidence is attached.'],
    capabilityRequirements: ['device.inspect'],
    goalPattern: 'Inspect [instance] and verify evidence.',
    dependencyPattern: ['inspect->verify'],
    incompatibleConstraints: ['no remote access'],
    exemplars: [
      {
        episodeId: 'episode-1',
        goalId: 'goal-1',
        goalVersion: 1,
        summary: 'Inspected a pump and verified pressure evidence.',
      },
      {
        episodeId: 'episode-2',
        goalId: 'goal-2',
        goalVersion: 1,
        summary: 'Checked a pump and attached pressure evidence.',
      },
    ],
    sourceRefs: [],
    modelInvocationId: 'model-invocation-1',
    createdAt: '2026-07-26T05:00:00.000Z',
  };
}

class FakeTaskTypes implements TaskTypeRepository {
  readonly items: TaskTypeDefinitionSnapshot[] = [];

  findByFingerprint(fingerprint: string) {
    return Promise.resolve(
      [...this.items].reverse().find((item) => item.fingerprint === fingerprint),
    );
  }

  list(limit = 100) {
    return Promise.resolve(this.items.slice(0, limit));
  }

  saveCandidate(candidate: TaskTypeDefinitionSnapshot) {
    const duplicate = this.items.some(
      (item) =>
        item.taskTypeId === candidate.taskTypeId &&
        item.revision === candidate.revision &&
        JSON.stringify(item) === JSON.stringify(candidate),
    );
    if (!duplicate) this.items.push(candidate);
    return Promise.resolve(!duplicate);
  }
}

class TaskTypeModel implements CognitiveStructuredModelStageInvoker {
  calls = 0;

  generate() {
    this.calls += 1;
    return Promise.resolve({
      invocationId: `model-invocation-${String(this.calls)}`,
      structuredResult: {
        title: 'Inspect a pump',
        summary: 'Inspect a pump and return cited evidence.',
        recognitionHints: ['inspect pump', 'pressure evidence'],
        positiveExamples: ['Inspect pump P-17 and return a pressure report.'],
        negativeExamples: ['Repairing a failed pump is a different job.'],
        requiredDimensions: ['target', 'criteria'],
        optionalDimensions: ['time_range'],
        criteriaTemplate: ['Pressure is stable.', 'Evidence is attached.'],
        capabilityRequirements: ['device.inspect', 'evidence.capture'],
        goalPattern: 'Inspect [instance] and verify evidence.',
        dependencyPattern: ['inspect->verify'],
        incompatibleConstraints: ['no remote access'],
      },
    });
  }
}
