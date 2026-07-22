import { describe, expect, it } from 'vitest';

import type {
  GoalContractCandidateSnapshot,
  InteractiveGoalSessionSnapshot,
  InteractiveGoalTurn,
} from '../../domain/src/index.js';
import {
  GoalContractCandidateFactory,
  InteractiveGoalSessionService,
  MissingDimensionQuestionService,
  type InteractiveGoalMutation,
  type InteractiveGoalMutationResult,
  type InteractiveGoalRepository,
} from '../src/cognitive/index.js';

describe('MissingDimensionQuestionService', () => {
  it('chooses the highest-information unanswered blocking dimension without repetition', () => {
    const service = new MissingDimensionQuestionService();
    const question = service.nextQuestion(understanding('clarification_required'), [
      turn('dimension.target'),
    ]);
    expect(question).toMatchObject({ dimensionId: 'dimension.criteria', kind: 'criteria' });
  });
});

describe('GoalContractCandidateFactory', () => {
  it('applies a user patch as the highest-priority candidate source and exposes a deterministic diff', () => {
    const factory = new GoalContractCandidateFactory();
    const original = factory.create(candidateInput(1));
    const patched = factory.patch(
      original,
      {
        title: 'User-selected title',
        successCriteria: ['Return verified JSON.'],
      },
      candidateInput(2),
    );
    expect(patched.contract.title).toBe('User-selected title');
    expect(patched.diff.changedFields).toEqual(['successCriteria', 'title']);
  });
});

describe('InteractiveGoalSessionService', () => {
  it('persists answer/candidate/confirmation revisions and makes duplicate actions harmless', async () => {
    const repository = new MemoryInteractiveGoalRepository();
    const service = sessionService(repository);
    const started = await service.start({ taskId: 'task.interactive' });
    expect(started.session.state).toBe('understand');
    expect(started.question?.dimensionId).toBe('dimension.target');

    const reviewed = await service.applyAction({
      sessionId: started.session.sessionId,
      expectedVersion: 1,
      idempotencyKey: 'action.answer.1',
      actorId: 'user.1',
      action: 'answer',
      payload: { answer: 'pump-17' },
    });
    expect(reviewed.session).toMatchObject({ state: 'goal_review', version: 2 });
    expect(reviewed.candidate?.contract.title).toBe('Inspect pump-17');

    const duplicate = await service.applyAction({
      sessionId: started.session.sessionId,
      expectedVersion: 1,
      idempotencyKey: 'action.answer.1',
      actorId: 'user.1',
      action: 'answer',
      payload: { answer: 'ignored duplicate' },
    });
    expect(duplicate.outcome).toBe('duplicate');
    expect(repository.turns).toHaveLength(1);

    const confirmed = await service.applyAction({
      sessionId: started.session.sessionId,
      expectedVersion: 2,
      idempotencyKey: 'action.accept.1',
      actorId: 'user.1',
      action: 'accept',
      payload: {},
    });
    expect(confirmed.session).toMatchObject({ state: 'confirmed', version: 3 });
    expect(confirmed.candidate?.status).toBe('confirmed');
  });
});

function sessionService(repository: MemoryInteractiveGoalRepository) {
  let revised = false;
  return new InteractiveGoalSessionService({
    repository,
    understandings: {
      findCurrent: () =>
        Promise.resolve(understanding(revised ? 'contract_candidate' : 'clarification_required')),
      listRevisions: () => Promise.resolve([]),
      saveRevision: () => Promise.resolve(),
    },
    reviseUnderstanding: () => {
      revised = true;
      return Promise.resolve(understanding('contract_candidate'));
    },
    model: {
      generate: () =>
        Promise.resolve({
          invocationId: 'model-invocation.goal-contract.1',
          structuredResult: {
            title: 'Inspect pump-17',
            description: 'Inspect pump-17 and report its current status.',
            constraints: ['Read only.'],
            successCriteria: ['Return verified status.'],
          },
        }),
    },
    clock: { now: () => '2026-07-23T04:00:00.000Z' },
    ids: {
      nextSessionId: () => 'session.interactive',
      nextTurnId: () => `turn.${String(repository.turns.length + 1)}`,
      nextCandidateId: () => 'candidate.interactive',
    },
    budgets: { maxClarificationRounds: 4, maxContractRevisions: 4, maxElapsedMs: 300_000 },
  });
}

function understanding(disposition: 'clarification_required' | 'contract_candidate') {
  return {
    schemaVersion: '1.0' as const,
    understandingId: disposition === 'contract_candidate' ? 'understanding.2' : 'understanding.1',
    taskId: 'task.interactive',
    revision: disposition === 'contract_candidate' ? 2 : 1,
    originalRequest: 'Inspect a device.',
    objective: disposition === 'contract_candidate' ? 'Inspect pump-17.' : 'Inspect a device.',
    taskTypeCandidates: [],
    capabilityRequirements: [],
    knownConstraints: ['Read only.'],
    knownDimensions:
      disposition === 'contract_candidate'
        ? [
            { kind: 'target' as const, value: 'pump-17', source: 'user_request' as const },
            { kind: 'criteria' as const, value: 'Return status.', source: 'user_request' as const },
          ]
        : [],
    assumptions: [],
    missingDimensions:
      disposition === 'contract_candidate'
        ? []
        : [
            {
              dimensionId: 'dimension.target',
              kind: 'target' as const,
              severity: 'blocking' as const,
              question: 'Which device?',
              answered: false,
              authorizationSensitive: false,
            },
            {
              dimensionId: 'dimension.criteria',
              kind: 'criteria' as const,
              severity: 'blocking' as const,
              question: 'What outcome is required?',
              answered: false,
              authorizationSensitive: false,
            },
          ],
    confidence: disposition === 'contract_candidate' ? 0.9 : 0.4,
    disposition,
    sourceRefs: [],
    modelInvocationId: 'model-invocation.understanding',
    policyVersion: 'task-understanding-v1',
    stateHash: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-07-23T04:00:00.000Z',
  };
}

function turn(dimensionId: string): InteractiveGoalTurn {
  return {
    turnId: 'turn.previous',
    sessionId: 'session.interactive',
    ordinal: 1,
    expectedSessionVersion: 1,
    idempotencyKey: 'action.previous',
    action: 'answer',
    actorId: 'user.1',
    payload: { answer: 'answered' },
    binding: {
      understandingRevision: 1,
      dimensionId,
      criterionId: 'goal.success_criteria',
      blockingReason: 'missing_required_dimension',
    },
    createdAt: '2026-07-23T04:00:00.000Z',
  };
}

function candidateInput(revision: number) {
  return {
    candidateId: `candidate.${String(revision)}`,
    sessionId: 'session.interactive',
    revision,
    status: 'candidate' as const,
    contract: {
      title: 'Inspect device',
      description: 'Inspect the declared device.',
      constraints: ['Read only.'],
      successCriteria: ['Return status.'],
    },
    sourceRefs: [],
    modelInvocationId: 'model-invocation.goal-contract.1',
    createdAt: '2026-07-23T04:00:00.000Z',
  };
}

class MemoryInteractiveGoalRepository implements InteractiveGoalRepository {
  session: InteractiveGoalSessionSnapshot | undefined;
  readonly turns: InteractiveGoalTurn[] = [];
  readonly candidates: GoalContractCandidateSnapshot[] = [];

  findByTask(): Promise<InteractiveGoalSessionSnapshot | undefined> {
    return Promise.resolve(this.session);
  }
  find(): Promise<InteractiveGoalSessionSnapshot | undefined> {
    return Promise.resolve(this.session);
  }
  listTurns(): Promise<readonly InteractiveGoalTurn[]> {
    return Promise.resolve(this.turns);
  }
  listCandidates(): Promise<readonly GoalContractCandidateSnapshot[]> {
    return Promise.resolve(this.candidates);
  }
  findTurnByIdempotencyKey(
    _sessionId: string,
    idempotencyKey: string,
  ): Promise<InteractiveGoalTurn | undefined> {
    return Promise.resolve(this.turns.find((item) => item.idempotencyKey === idempotencyKey));
  }
  start(
    session: InteractiveGoalSessionSnapshot,
    candidate?: GoalContractCandidateSnapshot,
  ): Promise<InteractiveGoalSessionSnapshot> {
    this.session = session;
    if (candidate !== undefined) this.candidates.push(candidate);
    return Promise.resolve(session);
  }
  apply(mutation: InteractiveGoalMutation): Promise<InteractiveGoalMutationResult> {
    const current = this.session;
    if (current === undefined) throw new Error('INTERACTIVE_GOAL_SESSION_NOT_FOUND');
    if (current.version !== mutation.expectedVersion) {
      return Promise.resolve({ outcome: 'conflict', session: current });
    }
    this.session = mutation.nextSession;
    this.turns.push(mutation.turn);
    if (mutation.candidate !== undefined) this.candidates.push(mutation.candidate);
    return Promise.resolve({
      outcome: 'applied',
      session: mutation.nextSession,
      ...(mutation.candidate === undefined ? {} : { candidate: mutation.candidate }),
    });
  }
}
