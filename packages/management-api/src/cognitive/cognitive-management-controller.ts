import { createHash, timingSafeEqual } from 'node:crypto';

import type {
  CognitiveManagementActionGate,
  CognitiveManagementOperation,
  InteractiveGoalActionInput,
  InteractiveGoalSessionService,
  InteractivePlanningActionInput,
  InteractivePlanningSessionService,
} from '../../../application/src/index.js';

export interface CognitiveManagementAuthorizationRequest {
  readonly authorization: string | undefined;
  readonly actorId: string;
  readonly operation: CognitiveManagementOperation;
}

export interface CognitiveManagementAuthorizer {
  readonly mode: 'trusted_intranet' | 'bearer';
  authorize(request: CognitiveManagementAuthorizationRequest): Promise<void>;
}

/**
 * Preserves the accepted V1 trusted-intranet boundary. actorId is an audit label,
 * not cryptographic identity proof.
 */
export class TrustedIntranetCognitiveManagementAuthorizer implements CognitiveManagementAuthorizer {
  readonly mode = 'trusted_intranet' as const;

  authorize(): Promise<void> {
    return Promise.resolve();
  }
}

/** Optional non-breaking bearer guard for deployments that provide a management secret. */
export class BearerCognitiveManagementAuthorizer implements CognitiveManagementAuthorizer {
  readonly mode = 'bearer' as const;
  readonly #tokenHash: Buffer;

  constructor(token: string) {
    const normalized = token.trim();
    if (normalized.length < 32) throw new Error('COGNITIVE_MANAGEMENT_TOKEN_TOO_SHORT');
    this.#tokenHash = digest(normalized);
  }

  authorize(request: CognitiveManagementAuthorizationRequest): Promise<void> {
    const prefix = 'Bearer ';
    const candidate =
      request.authorization?.startsWith(prefix) === true
        ? request.authorization.slice(prefix.length).trim()
        : '';
    const candidateHash = digest(candidate);
    if (!timingSafeEqual(this.#tokenHash, candidateHash)) {
      throw new CognitiveManagementAuthorizationError();
    }
    return Promise.resolve();
  }
}

export class CognitiveManagementController {
  readonly #goalSessions:
    Pick<InteractiveGoalSessionService, 'getByTask' | 'applyAction'> | undefined;
  readonly #planningSessions:
    Pick<InteractivePlanningSessionService, 'getByTask' | 'applyAction'> | undefined;
  readonly #authorizer: CognitiveManagementAuthorizer;
  readonly #actions: Pick<CognitiveManagementActionGate, 'execute'> | undefined;

  constructor(
    dependencies: Readonly<{
      goalSessions?: Pick<InteractiveGoalSessionService, 'getByTask' | 'applyAction'>;
      planningSessions?: Pick<InteractivePlanningSessionService, 'getByTask' | 'applyAction'>;
      authorizer?: CognitiveManagementAuthorizer;
      actions?: Pick<CognitiveManagementActionGate, 'execute'>;
    }>,
  ) {
    this.#goalSessions = dependencies.goalSessions;
    this.#planningSessions = dependencies.planningSessions;
    this.#authorizer =
      dependencies.authorizer ?? new TrustedIntranetCognitiveManagementAuthorizer();
    this.#actions = dependencies.actions;
  }

  get authorizationMode(): CognitiveManagementAuthorizer['mode'] {
    return this.#authorizer.mode;
  }

  /** Authorizes a write whose domain service owns its own P02/P06 audit transaction. */
  authorize(
    authorization: string | undefined,
    actorId: string,
    operation: CognitiveManagementOperation,
  ): Promise<void> {
    return this.#authorizer.authorize({ authorization, actorId, operation });
  }

  async executeWrite<T>(
    input: Readonly<{
      actorId: string;
      operation: CognitiveManagementOperation;
      subjectId: string;
      expectedVersion: number;
      idempotencyKey: string;
      reason: string;
    }>,
    authorization: string | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    await this.#authorizer.authorize({
      authorization,
      actorId: input.actorId,
      operation: input.operation,
    });
    return this.#actions === undefined ? action() : this.#actions.execute(input, action);
  }

  async applyGoalAction(
    taskId: string,
    input: Omit<InteractiveGoalActionInput, 'sessionId'> & Readonly<{ reason: string }>,
    authorization?: string,
  ) {
    const service = this.#goalSessions;
    if (service === undefined) throw new Error('INTERACTIVE_GOAL_SESSION_UNAVAILABLE');
    const current = await service.getByTask(taskId);
    if (current === undefined) throw new Error('INTERACTIVE_GOAL_SESSION_NOT_FOUND');
    return this.executeWrite(
      {
        operation: 'goal_session_action',
        subjectId: taskId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        reason: input.reason,
      },
      authorization,
      () =>
        service.applyAction({
          sessionId: current.session.sessionId,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
          actorId: input.actorId,
          action: input.action,
          payload: { ...input.payload, managementReason: input.reason },
        }),
    );
  }

  async applyPlanningAction(
    taskId: string,
    input: Omit<InteractivePlanningActionInput, 'sessionId'> & Readonly<{ reason: string }>,
    authorization?: string,
  ) {
    const service = this.#planningSessions;
    if (service === undefined) throw new Error('INTERACTIVE_PLANNING_SESSION_UNAVAILABLE');
    const current = await service.getByTask(taskId);
    if (current === undefined) throw new Error('INTERACTIVE_PLANNING_SESSION_NOT_FOUND');
    return this.executeWrite(
      {
        operation: 'planning_session_action',
        subjectId: taskId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        reason: input.reason,
      },
      authorization,
      () =>
        service.applyAction({
          sessionId: current.session.sessionId,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
          actorId: input.actorId,
          action: input.action,
          payload: { ...input.payload, managementReason: input.reason },
        }),
    );
  }
}

export class CognitiveManagementAuthorizationError extends Error {
  readonly code = 'COGNITIVE_MANAGEMENT_UNAUTHORIZED';

  constructor() {
    super('Valid management authorization is required for this cognitive write operation.');
    this.name = 'CognitiveManagementAuthorizationError';
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
