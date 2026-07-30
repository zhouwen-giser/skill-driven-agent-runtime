import { createHash, timingSafeEqual } from 'node:crypto';

import {
  ArtifactManagementError,
  type ArtifactPermission,
  type ExternalOperatorIdentityProvider,
  type ManagementPrincipal,
  type ManagementPrincipalResolver,
  type ManagementRole,
  type OperatorIdentity,
  type OperatorRequestContext,
} from '../../../packages/application/src/index.js';

const MANAGEMENT_ROLES = new Set<ManagementRole>([
  'viewer',
  'operator',
  'reviewer',
  'approver',
  'administrator',
  'security_operator',
]);

const ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze([]),
  operator: Object.freeze(['artifact.validate', 'artifact.revalidate'] as const),
  reviewer: Object.freeze(['artifact.validate'] as const),
  approver: Object.freeze(['artifact.approve'] as const),
  administrator: Object.freeze([
    'artifact.validate',
    'artifact.activate',
    'artifact.revalidate',
    'artifact.deprecate',
    'artifact.rollback',
  ] as const),
  security_operator: Object.freeze(['artifact.rollback', 'artifact.kill_switch'] as const),
}) satisfies Readonly<Record<ManagementRole, readonly ArtifactPermission[]>>;

export interface ConfiguredBearerArtifactManagementIdentityOptions {
  readonly token: string;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly kind: 'human' | 'service';
  readonly roles: readonly ManagementRole[];
}

/**
 * Deployment-owned authentication adapter for the optional P12 surface.
 *
 * The two application ports both expose a method named `resolve` with
 * incompatible signatures, so this adapter exposes two immutable port views
 * over one configured credential and principal.
 */
export class ConfiguredBearerArtifactManagementIdentity {
  readonly managementPrincipalResolver: ManagementPrincipalResolver;
  readonly externalOperatorIdentityProvider: ExternalOperatorIdentityProvider;

  readonly #authorizationHash: Buffer;
  readonly #actorId: string;
  readonly #tenantId: string | undefined;
  readonly #kind: 'human' | 'service';
  readonly #roles: ReadonlySet<ManagementRole>;
  readonly #permissions: ReadonlySet<ArtifactPermission>;

  constructor(options: ConfiguredBearerArtifactManagementIdentityOptions) {
    if (
      options.token.length < 32 ||
      /\s/u.test(options.token) ||
      options.actorId.trim().length === 0 ||
      options.roles.length === 0 ||
      options.roles.some((role) => !MANAGEMENT_ROLES.has(role)) ||
      options.tenantId?.trim().length === 0
    ) {
      throw new Error('ARTIFACT_MANAGEMENT_IDENTITY_CONFIG_INVALID');
    }

    this.#authorizationHash = digest(`Bearer ${options.token}`);
    this.#actorId = options.actorId.trim();
    this.#tenantId = options.tenantId?.trim();
    this.#kind = options.kind;
    this.#roles = immutableReadonlySet(options.roles);
    const permissions: ArtifactPermission[] = [];
    for (const role of this.#roles) permissions.push(...ROLE_PERMISSIONS[role]);
    this.#permissions = immutableReadonlySet(permissions);
    this.managementPrincipalResolver = Object.freeze({
      resolve: (input: Parameters<ManagementPrincipalResolver['resolve']>[0]) =>
        this.#resolveManagementPrincipal(input),
    });
    this.externalOperatorIdentityProvider = Object.freeze({
      resolve: (context: OperatorRequestContext) => this.#resolveOperatorIdentity(context),
    });
  }

  #resolveManagementPrincipal(
    input: Parameters<ManagementPrincipalResolver['resolve']>[0],
  ): Promise<ManagementPrincipal> {
    const authorizationHash = digest(input.authorization ?? '');
    if (!timingSafeEqual(this.#authorizationHash, authorizationHash)) {
      return Promise.reject(new ArtifactManagementError('MANAGEMENT_AUTHENTICATION_REQUIRED', 401));
    }
    return Promise.resolve(
      Object.freeze({
        actorId: this.#actorId,
        ...(this.#tenantId === undefined ? {} : { tenantId: this.#tenantId }),
        roles: this.#roles,
        kind: this.#kind,
        requestId: input.requestId,
        ...(input.sourceIp === undefined ? {} : { sourceIp: input.sourceIp }),
      }),
    );
  }

  #resolveOperatorIdentity(context: OperatorRequestContext): Promise<OperatorIdentity | undefined> {
    if (
      context.operatorId !== this.#actorId ||
      context.tenantId !== this.#tenantId ||
      context.permissions === undefined ||
      context.permissions.length === 0 ||
      context.permissions.some((permission) => !this.#permissions.has(permission))
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(
      Object.freeze({
        operatorId: this.#actorId,
        ...(this.#tenantId === undefined ? {} : { tenantId: this.#tenantId }),
        permissions: immutableReadonlySet(context.permissions),
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
    entries() {
      return set.entries();
    },
    keys() {
      return set.keys();
    },
    values() {
      return set.values();
    },
    forEach(callback: (value: T, key: T, owner: ReadonlySet<T>) => void, thisArg?: unknown) {
      const owner = this as ReadonlySet<T>;
      set.forEach((value) => {
        callback.call(thisArg, value, value, owner);
      });
    },
    [Symbol.iterator]() {
      return set[Symbol.iterator]();
    },
    [Symbol.toStringTag]: 'ReadonlySet',
  });
}
