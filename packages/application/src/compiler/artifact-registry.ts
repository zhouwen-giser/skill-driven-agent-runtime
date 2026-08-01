import type { CompiledArtifact } from '../../../domain/src/index.js';

import type {
  ArtifactCandidatePersistence,
  ArtifactIndexEntry,
  ArtifactIndexQuery,
  ArtifactRef,
  ArtifactRepository,
} from './artifact-persistence.js';

export const ARTIFACT_REGISTRY_SERVICE_SCHEMA_HASH =
  '011be4e2c1686e0f68256aa9c4cf9f98dff2d92fcb4cf043b2d09b06a0c7cab5' as const;

export const SDAR_V13_ARTIFACT_EVENTS = Object.freeze([
  'experience.trace_created',
  'compiler.pattern_discovered',
  'compiler.artifact_candidate_created',
  'artifact.validation_started',
  'artifact.validation_completed',
  'artifact.shadow_started',
  'artifact.shadow_completed',
  'artifact.promotion_ready',
  'artifact.approval_recorded',
  'artifact.activated',
  'artifact.revalidating',
  'artifact.deprecated',
  'artifact.match_evaluated',
  'artifact.execution_started',
  'artifact.execution_completed',
  'artifact.execution_failed',
  'artifact.feedback_recorded',
  'gateway.route_selected',
  'gateway.confirmation_required',
  'gateway.fallback_started',
  'gateway.formal_handoff',
  'model_route.selected',
  'model_cascade.escalated',
] as const);

export const SDAR_V13_ARTIFACT_QUEUES = Object.freeze([
  'sdar-compiler-normalization',
  'sdar-compiler-process-mining',
  'sdar-compiler-pattern-generalization',
  'sdar-compiler-artifact-generation',
  'sdar-artifact-replay',
  'sdar-artifact-simulation',
  'sdar-artifact-shadow',
  'sdar-artifact-revalidation',
] as const);

export type ArtifactMode = 'off' | 'shadow' | 'advisory' | 'active';

export interface ArtifactFeatureFlags {
  readonly artifactMode: ArtifactMode;
  readonly compilerEnabled: boolean;
  readonly registryEnabled: boolean;
  readonly shadowEnabled: boolean;
  readonly promotionEnabled: boolean;
  readonly retrievalEnabled: boolean;
  readonly modelRouteEnabled: boolean;
  readonly templateEnabled: boolean;
  readonly ruleEnabled: boolean;
  readonly fastGatewayEnabled: boolean;
  readonly caseEnabled: boolean;
  readonly modelCascadeEnabled: boolean;
  readonly tenantAllowlist: ReadonlySet<string>;
  /** Exact, versioned Artifact refs (`artifactId:version`). Empty denies all retrieval. */
  readonly artifactAllowlist: ReadonlySet<string>;
}

/** P02/P07 frozen flag names. Additive release controls live in the P13 list below. */
export const ARTIFACT_FEATURE_FLAG_NAMES = Object.freeze([
  'SDAR_V13_ARTIFACT_MODE',
  'SDAR_V13_TEMPLATE_ENABLED',
  'SDAR_V13_RULE_ENABLED',
  'SDAR_V13_FAST_GATEWAY_ENABLED',
  'SDAR_V13_CASE_ENABLED',
  'SDAR_V13_MODEL_CASCADE_ENABLED',
  'SDAR_V13_TENANT_ALLOWLIST',
] as const);

export const ARTIFACT_OPERATIONAL_FLAG_NAMES = Object.freeze([
  'SDAR_V13_COMPILER_ENABLED',
  'SDAR_V13_REGISTRY_ENABLED',
  'SDAR_V13_SHADOW_ENABLED',
  'SDAR_V13_PROMOTION_ENABLED',
  'SDAR_V13_RETRIEVAL_ENABLED',
  'SDAR_V13_MODEL_ROUTE_ENABLED',
  'SDAR_V13_ARTIFACT_ALLOWLIST',
] as const);

export function parseArtifactFeatureFlags(
  environment: Readonly<Record<string, string | undefined>>,
): ArtifactFeatureFlags {
  const artifactMode = environment['SDAR_V13_ARTIFACT_MODE'] ?? 'off';
  if (!['off', 'shadow', 'advisory', 'active'].includes(artifactMode)) {
    throw new ArtifactRegistryError('ARTIFACT_FEATURE_FLAG_INVALID');
  }
  return Object.freeze({
    artifactMode: artifactMode as ArtifactMode,
    compilerEnabled: parseBoolean(environment['SDAR_V13_COMPILER_ENABLED']),
    registryEnabled: parseBoolean(environment['SDAR_V13_REGISTRY_ENABLED']),
    shadowEnabled: parseBoolean(environment['SDAR_V13_SHADOW_ENABLED']),
    promotionEnabled: parseBoolean(environment['SDAR_V13_PROMOTION_ENABLED']),
    retrievalEnabled: parseBoolean(environment['SDAR_V13_RETRIEVAL_ENABLED']),
    modelRouteEnabled: parseBoolean(environment['SDAR_V13_MODEL_ROUTE_ENABLED']),
    templateEnabled: parseBoolean(environment['SDAR_V13_TEMPLATE_ENABLED']),
    ruleEnabled: parseBoolean(environment['SDAR_V13_RULE_ENABLED']),
    fastGatewayEnabled: parseBoolean(environment['SDAR_V13_FAST_GATEWAY_ENABLED']),
    caseEnabled: parseBoolean(environment['SDAR_V13_CASE_ENABLED']),
    modelCascadeEnabled: parseBoolean(environment['SDAR_V13_MODEL_CASCADE_ENABLED']),
    tenantAllowlist: immutableReadonlySet(
      (environment['SDAR_V13_TENANT_ALLOWLIST'] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
    artifactAllowlist: parseArtifactAllowlist(environment['SDAR_V13_ARTIFACT_ALLOWLIST']),
  });
}

export interface ArtifactActiveIndexProjection {
  query(query: ArtifactIndexQuery): Promise<readonly ArtifactIndexEntry[] | undefined>;
  replace(query: ArtifactIndexQuery, entries: readonly ArtifactIndexEntry[]): Promise<void>;
  getVersion(ref: ArtifactRef): Promise<CompiledArtifact | undefined>;
  putVersion(artifact: CompiledArtifact): Promise<void>;
  invalidateDependency(dependencyRef: string): Promise<void>;
  rebuild(entries: readonly ArtifactIndexEntry[]): Promise<void>;
}

export class ArtifactRegistryService {
  readonly #repository: ArtifactRepository;
  readonly #projection: ArtifactActiveIndexProjection;

  constructor(
    dependencies: Readonly<{
      repository: ArtifactRepository;
      projection: ArtifactActiveIndexProjection;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#projection = dependencies.projection;
  }

  async createCandidate(candidate: ArtifactCandidatePersistence): Promise<void> {
    await this.#repository.saveCandidate(candidate);
  }

  async getVersion(ref: ArtifactRef): Promise<CompiledArtifact | undefined> {
    const projected = await this.#projection.getVersion(ref);
    if (projected !== undefined) return projected;
    const authoritative = await this.#repository.getDefinition(ref);
    if (authoritative !== undefined) await this.#projection.putVersion(authoritative);
    return authoritative;
  }

  async queryActiveIndex(query: ArtifactIndexQuery): Promise<readonly ArtifactIndexEntry[]> {
    const projected = await this.#projection.query(query);
    if (projected !== undefined) return projected;
    const authoritative = await this.#repository.findActiveIndex(query);
    await this.#projection.replace(query, authoritative);
    return authoritative;
  }

  invalidateDependency(dependencyRef: string): Promise<void> {
    if (dependencyRef.trim().length === 0) {
      throw new ArtifactRegistryError('ARTIFACT_DEPENDENCY_REF_INVALID');
    }
    return this.#projection.invalidateDependency(dependencyRef);
  }

  async rebuildProjection(): Promise<readonly ArtifactIndexEntry[]> {
    const authoritative: ArtifactIndexEntry[] = [];
    let afterArtifactKey: string | undefined;
    for (;;) {
      const page = await this.#repository.findActiveIndex({
        limit: 500,
        ...(afterArtifactKey === undefined ? {} : { afterArtifactKey }),
      });
      authoritative.push(...page);
      if (page.length < 500) break;
      const next = page.at(-1)?.artifactKey;
      if (next === undefined || next === afterArtifactKey) {
        throw new ArtifactRegistryError('ARTIFACT_PROJECTION_CURSOR_INVALID');
      }
      afterArtifactKey = next;
    }
    await this.#projection.rebuild(authoritative);
    return Object.freeze(authoritative);
  }
}

export class InMemoryArtifactActiveIndexProjection implements ArtifactActiveIndexProjection {
  readonly #queries = new Map<string, readonly ArtifactIndexEntry[]>();
  readonly #versions = new Map<string, CompiledArtifact>();
  #fullIndex: readonly ArtifactIndexEntry[] | undefined;

  query(query: ArtifactIndexQuery): Promise<readonly ArtifactIndexEntry[] | undefined> {
    const key = artifactProjectionQueryCacheKey(query);
    const exact = this.#queries.get(key);
    if (exact !== undefined) return Promise.resolve(exact);
    if (this.#fullIndex === undefined) return Promise.resolve(undefined);
    const result = this.#fullIndex
      .filter((entry) => query.tenantId === undefined || entry.tenantId === query.tenantId)
      .filter((entry) => query.domain === undefined || entry.domain === query.domain)
      .filter(
        (entry) =>
          query.afterArtifactKey === undefined || entry.artifactKey > query.afterArtifactKey,
      )
      .filter(
        (entry) =>
          query.artifactTypes === undefined || query.artifactTypes.includes(entry.artifactType),
      )
      .slice(0, query.limit ?? 100);
    return Promise.resolve(Object.freeze(result));
  }

  replace(_query: ArtifactIndexQuery, entries: readonly ArtifactIndexEntry[]): Promise<void> {
    this.#queries.set(artifactProjectionQueryCacheKey(_query), Object.freeze([...entries]));
    return Promise.resolve();
  }

  getVersion(ref: ArtifactRef): Promise<CompiledArtifact | undefined> {
    return Promise.resolve(this.#versions.get(artifactVersionCacheKey(ref)));
  }

  putVersion(artifact: CompiledArtifact): Promise<void> {
    this.#versions.set(artifactVersionCacheKey(artifact), artifact);
    return Promise.resolve();
  }

  invalidateDependency(dependencyRef: string): Promise<void> {
    this.#queries.clear();
    // A partial deletion is not an authoritative full index. Force a PostgreSQL miss/rebuild.
    this.#fullIndex = undefined;
    for (const [key, artifact] of this.#versions) {
      if (dependencyContains(artifact.dependencySnapshot, dependencyRef))
        this.#versions.delete(key);
    }
    return Promise.resolve();
  }

  rebuild(entries: readonly ArtifactIndexEntry[]): Promise<void> {
    this.#queries.clear();
    this.#versions.clear();
    this.#fullIndex = Object.freeze([...entries]);
    return Promise.resolve();
  }
}

export function artifactProjectionQueryCacheKey(query: ArtifactIndexQuery): string {
  return JSON.stringify([
    'artifact-active-index',
    query.tenantId ?? '*',
    query.domain ?? '*',
    [...(query.artifactTypes ?? [])].sort(),
    query.limit ?? 100,
    query.afterArtifactKey ?? null,
  ]);
}

export function artifactVersionCacheKey(ref: ArtifactRef): string {
  return `artifact-version:${ref.artifactId}:${String(ref.version)}`;
}

export function artifactIndexEntryCacheKey(entry: ArtifactIndexEntry): string {
  return JSON.stringify([
    'artifact-active-entry',
    entry.tenantId ?? '*',
    entry.artifactKey,
    entry.artifactVersion,
    entry.pointerLockVersion,
    entry.dependencySnapshot.capabilityCatalogHash,
    [...entry.dependencySnapshot.policyVersionRefs].sort(),
  ]);
}

export class ArtifactRegistryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ArtifactRegistryError';
    this.code = code;
  }
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new ArtifactRegistryError('ARTIFACT_FEATURE_FLAG_INVALID');
}

function parseArtifactAllowlist(value: string | undefined): ReadonlySet<string> {
  if (value === undefined || value.trim().length === 0) return immutableReadonlySet([]);
  const refs = value.split(',').map((entry) => entry.trim());
  if (refs.some((ref) => !isVersionedArtifactRef(ref)) || new Set(refs).size !== refs.length) {
    throw new ArtifactRegistryError('ARTIFACT_FEATURE_FLAG_INVALID');
  }
  return immutableReadonlySet(refs);
}

function isVersionedArtifactRef(value: string): boolean {
  const separator = value.lastIndexOf(':');
  if (separator <= 0 || /\s/u.test(value)) return false;
  const version = value.slice(separator + 1);
  return /^[1-9]\d*$/u.test(version);
}

function dependencyContains(value: unknown, dependencyRef: string): boolean {
  if (value === dependencyRef) return true;
  if (Array.isArray(value)) {
    return value.some((item) => dependencyContains(item, dependencyRef));
  }
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((item) => dependencyContains(item, dependencyRef));
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
