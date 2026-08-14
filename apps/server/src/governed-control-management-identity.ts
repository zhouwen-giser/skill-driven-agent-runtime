import { createHash, timingSafeEqual } from 'node:crypto';

import {
  GovernedControlManagementError,
  type GovernedControlPermission,
  type GovernedControlPrincipal,
  type GovernedControlPrincipalResolver,
} from '../../../packages/application/src/index.js';

const CONTROL_PERMISSIONS = new Set<GovernedControlPermission>([
  'physical_control.confirm',
  'physical_control.revoke',
]);

export class ConfiguredBearerGovernedControlIdentity implements GovernedControlPrincipalResolver {
  readonly #authorizationHash: Buffer;
  readonly #actorId: string;
  readonly #permissions: ReadonlySet<GovernedControlPermission>;

  constructor(
    options: Readonly<{
      token: string;
      actorId: string;
      permissions: readonly GovernedControlPermission[];
    }>,
  ) {
    if (
      options.token.length < 32 ||
      /\s/u.test(options.token) ||
      options.actorId.trim() === '' ||
      /^(?:agent|assistant|llm|model):/iu.test(options.actorId) ||
      options.permissions.length === 0 ||
      options.permissions.some((permission) => !CONTROL_PERMISSIONS.has(permission)) ||
      new Set(options.permissions).size !== options.permissions.length
    )
      throw new Error('GOVERNED_CONTROL_IDENTITY_CONFIG_INVALID');
    this.#authorizationHash = digest(`Bearer ${options.token}`);
    this.#actorId = options.actorId.trim();
    this.#permissions = immutableReadonlySet(options.permissions);
  }

  resolve(
    input: Parameters<GovernedControlPrincipalResolver['resolve']>[0],
  ): Promise<GovernedControlPrincipal> {
    if (!timingSafeEqual(this.#authorizationHash, digest(input.authorization ?? '')))
      return Promise.reject(
        new GovernedControlManagementError('GOVERNED_CONTROL_AUTHENTICATION_REQUIRED', 401),
      );
    return Promise.resolve(
      Object.freeze({
        actorId: this.#actorId,
        kind: 'human' as const,
        authenticationMethod: 'configured_bearer',
        permissions: this.#permissions,
        requestId: input.requestId,
        ...(input.sourceIp === undefined ? {} : { sourceIp: input.sourceIp }),
      }),
    );
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function immutableReadonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const set = new Set(values);
  return Object.freeze({
    get size() {
      return set.size;
    },
    has(value: T) {
      return set.has(value);
    },
    entries: () => set.entries(),
    keys: () => set.keys(),
    values: () => set.values(),
    forEach(callback: (value: T, key: T, owner: ReadonlySet<T>) => void, thisArg?: unknown) {
      const owner = this as ReadonlySet<T>;
      set.forEach((value) => {
        callback.call(thisArg, value, value, owner);
      });
    },
    [Symbol.iterator]: () => set[Symbol.iterator](),
    [Symbol.toStringTag]: 'ReadonlySet',
  });
}
