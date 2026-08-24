import { randomUUID } from 'node:crypto';

import type { User } from '@a2a-js/sdk/server';
import type { UserBuilder } from '@a2a-js/sdk/server/express';
import type { RequestHandler } from 'express';

import {
  GovernedControlManagementError,
  type GovernedControlPrincipal,
  type GovernedControlPrincipalResolver,
} from '../../application/src/index.js';

const principalByUser = new WeakMap<User, GovernedControlPrincipal>();

export interface GovernedControlA2AAuthentication {
  readonly userBuilder: UserBuilder;
  readonly authenticateBeforeProtocol: RequestHandler;
}

/**
 * Keeps Express and official A2A SDK identity types inside the adapter while
 * preserving the complete protocol-neutral principal returned by the Runtime
 * identity resolver.
 */
export function createGovernedControlA2AAuthentication(
  resolver: GovernedControlPrincipalResolver,
): GovernedControlA2AAuthentication {
  const userByRequest = new WeakMap<object, Promise<User>>();
  const userBuilder: UserBuilder = (request) => {
    const existing = userByRequest.get(request);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<User> => {
      const authorization = request.header('authorization');
      const principal = await resolver.resolve({
        ...(authorization === undefined ? {} : { authorization }),
        requestId: request.header('x-request-id') ?? `a2a-confirmation-${randomUUID()}`,
        ...(request.ip === undefined ? {} : { sourceIp: request.ip }),
      });
      const user: User = Object.freeze(new GovernedControlA2AUser(principal.actorId));
      principalByUser.set(user, principal);
      return user;
    })();
    userByRequest.set(request, pending);
    return pending;
  };

  const authenticateBeforeProtocol: RequestHandler = (request, response, next) => {
    void userBuilder(request).then(
      () => {
        next();
      },
      (error: unknown) => {
        if (!(error instanceof GovernedControlManagementError)) {
          next(error);
          return;
        }
        response.status(error.status).json({
          error: {
            code: error.status,
            status: error.status === 401 ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED',
            message: error.code,
            details: [],
          },
        });
      },
    );
  };

  return Object.freeze({ userBuilder, authenticateBeforeProtocol });
}

export function governedControlPrincipalForA2AUser(
  user: User | undefined,
): GovernedControlPrincipal | undefined {
  return user === undefined ? undefined : principalByUser.get(user);
}

class GovernedControlA2AUser implements User {
  readonly #actorId: string;
  readonly isAuthenticated = true;

  constructor(actorId: string) {
    this.#actorId = actorId;
  }

  get userName(): string {
    return this.#actorId;
  }
}
