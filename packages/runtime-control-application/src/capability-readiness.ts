import { createHash } from 'node:crypto';

import type {
  CapabilityImplementationBinding,
  NodeCapabilityDefinitionVersion,
} from '../../node-control-domain/src/index.js';

export type CapabilityReadinessStatus = 'available' | 'degraded' | 'unavailable' | 'suspended';
export type CapabilityReadinessSeverity = 'info' | 'warning' | 'blocking';

export interface CapabilityReadinessReason {
  readonly code: string;
  readonly severity?: CapabilityReadinessSeverity;
  readonly detail?: string;
  readonly dependencyRef?: string;
}

export interface CapabilityReadinessSnapshot {
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly snapshotVersion: number;
  readonly status: CapabilityReadinessStatus;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly catalogHash?: string;
  readonly policyHash?: string;
  readonly reasons: readonly CapabilityReadinessReason[];
  readonly availableImplementations?: readonly string[];
  readonly unavailableImplementations?: readonly string[];
}

export interface RuntimeCapabilityReadinessInput {
  readonly definition: NodeCapabilityDefinitionVersion;
  readonly implementations: readonly CapabilityImplementationBinding[];
  readonly maintenanceMode: boolean;
  readonly killSwitch: boolean;
  readonly ttlMs: number;
  readonly minimumStableWindowMs: number;
  readonly trigger: string;
}

export interface RuntimeImplementationReadiness {
  readonly bindingId: string;
  readonly available: boolean;
  readonly degraded: boolean;
  readonly catalogParts: readonly string[];
  readonly policyParts: readonly string[];
  readonly reasons: readonly CapabilityReadinessReason[];
}

export interface StoredCapabilityReadiness {
  readonly snapshot: CapabilityReadinessSnapshot;
  readonly snapshotHash: string;
  readonly rawStatus: CapabilityReadinessStatus;
  readonly candidateStatus?: CapabilityReadinessStatus;
  readonly candidateSince?: string;
  readonly input: RuntimeCapabilityReadinessInput;
}

export interface RuntimeCapabilityReadinessCommand {
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface RuntimeCapabilityReadinessRepository {
  findLatest(
    capabilityId: string,
    capabilityVersion: number,
  ): Promise<StoredCapabilityReadiness | undefined>;
  findReplay(
    command: RuntimeCapabilityReadinessCommand,
  ): Promise<StoredCapabilityReadiness | undefined>;
  assessImplementations(
    input: RuntimeCapabilityReadinessInput,
    evaluatedAt: string,
  ): Promise<readonly RuntimeImplementationReadiness[]>;
  save(
    record: StoredCapabilityReadiness,
    command?: RuntimeCapabilityReadinessCommand,
  ): Promise<StoredCapabilityReadiness>;
  listLatest(
    status: CapabilityReadinessStatus | undefined,
    limit: number,
  ): Promise<readonly StoredCapabilityReadiness[]>;
  listExpired(limit: number, now: string): Promise<readonly StoredCapabilityReadiness[]>;
}

export interface RuntimeCapabilityReadinessClock {
  now(): string;
}

export class RuntimeCapabilityReadinessService {
  readonly #repository: RuntimeCapabilityReadinessRepository;
  readonly #clock: RuntimeCapabilityReadinessClock;

  constructor(
    dependencies: Readonly<{
      repository: RuntimeCapabilityReadinessRepository;
      clock: RuntimeCapabilityReadinessClock;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
  }

  async evaluate(
    input: RuntimeCapabilityReadinessInput,
    command?: RuntimeCapabilityReadinessCommand,
  ): Promise<StoredCapabilityReadiness> {
    assertInput(input);
    if (command !== undefined) {
      assertCommand(command);
      const replay = await this.#repository.findReplay(command);
      if (replay !== undefined) return replay;
    }
    const evaluatedAt = this.#clock.now();
    const prior = await this.#repository.findLatest(
      input.definition.capabilityId,
      input.definition.version,
    );
    const assessments = await this.#repository.assessImplementations(input, evaluatedAt);
    const raw = rawReadiness(input, assessments);
    const stabilized = stabilize(raw.status, prior, evaluatedAt, input.minimumStableWindowMs);
    const snapshot: CapabilityReadinessSnapshot = Object.freeze({
      capabilityId: input.definition.capabilityId,
      capabilityVersion: input.definition.version,
      snapshotVersion: (prior?.snapshot.snapshotVersion ?? 0) + 1,
      status: stabilized.status,
      evaluatedAt,
      validUntil: new Date(Date.parse(evaluatedAt) + input.ttlMs).toISOString(),
      catalogHash: hashParts(assessments.flatMap((value) => value.catalogParts)),
      policyHash: hashParts([
        input.definition.definitionHash,
        ...assessments.flatMap((value) => value.policyParts),
      ]),
      reasons: Object.freeze(
        stabilized.status === raw.status
          ? raw.reasons
          : [
              ...raw.reasons,
              Object.freeze({
                code: 'READINESS_STABILITY_WINDOW',
                severity: 'info' as const,
                detail:
                  'An improving or lateral transition is held until the minimum stability window elapses.',
              }),
            ],
      ),
      availableImplementations: Object.freeze(
        assessments
          .filter((value) => value.available)
          .map((value) => value.bindingId)
          .sort(),
      ),
      unavailableImplementations: Object.freeze(
        assessments
          .filter((value) => !value.available)
          .map((value) => value.bindingId)
          .sort(),
      ),
    });
    return this.#repository.save(
      Object.freeze({
        snapshot,
        snapshotHash: hashSnapshot(snapshot),
        rawStatus: raw.status,
        ...(stabilized.candidateStatus === undefined
          ? {}
          : { candidateStatus: stabilized.candidateStatus }),
        ...(stabilized.candidateSince === undefined
          ? {}
          : { candidateSince: stabilized.candidateSince }),
        input,
      }),
      command,
    );
  }

  async get(capabilityId: string, capabilityVersion: number) {
    return this.#repository.findLatest(capabilityId, capabilityVersion);
  }

  async list(status?: CapabilityReadinessStatus, limit = 100) {
    return this.#repository.listLatest(status, boundedLimit(limit));
  }

  async evaluateExpired(limit = 100): Promise<readonly StoredCapabilityReadiness[]> {
    const now = this.#clock.now();
    const expired = await this.#repository.listExpired(boundedLimit(limit), now);
    const results: StoredCapabilityReadiness[] = [];
    for (const record of expired) results.push(await this.evaluate(record.input));
    return Object.freeze(results);
  }
}

function rawReadiness(
  input: RuntimeCapabilityReadinessInput,
  assessments: readonly RuntimeImplementationReadiness[],
): Readonly<{ status: CapabilityReadinessStatus; reasons: readonly CapabilityReadinessReason[] }> {
  if (input.killSwitch || input.maintenanceMode || input.definition.status !== 'published') {
    return {
      status: 'suspended',
      reasons: [
        Object.freeze({
          code: input.killSwitch
            ? 'CAPABILITY_KILL_SWITCH'
            : input.maintenanceMode
              ? 'NODE_MAINTENANCE'
              : 'CAPABILITY_NOT_PUBLISHED',
          severity: 'blocking',
        }),
      ],
    };
  }
  const executable = input.implementations.filter(
    (value) =>
      value.status === 'active' && (value.role === 'primary' || value.role === 'alternative'),
  );
  const executableAssessments = assessments.filter((value) =>
    executable.some((binding) => binding.bindingId === value.bindingId),
  );
  const reasons = Object.freeze(assessments.flatMap((value) => value.reasons));
  if (
    executableAssessments.length === 0 ||
    executableAssessments.every((value) => !value.available)
  )
    return {
      status: 'unavailable',
      reasons:
        reasons.length === 0
          ? [Object.freeze({ code: 'NO_EXECUTABLE_IMPLEMENTATION', severity: 'blocking' as const })]
          : reasons,
    };
  if (
    executableAssessments.some((value) => !value.available || value.degraded) ||
    assessments.some((value) => !value.available || value.degraded)
  )
    return { status: 'degraded', reasons };
  return { status: 'available', reasons };
}

function stabilize(
  rawStatus: CapabilityReadinessStatus,
  prior: StoredCapabilityReadiness | undefined,
  now: string,
  minimumStableWindowMs: number,
): Readonly<{
  status: CapabilityReadinessStatus;
  candidateStatus?: CapabilityReadinessStatus;
  candidateSince?: string;
}> {
  if (prior === undefined || prior.snapshot.status === rawStatus) return { status: rawStatus };
  if (rawStatus === 'suspended' || statusRank(rawStatus) > statusRank(prior.snapshot.status))
    return { status: rawStatus };
  const candidateSince =
    prior.candidateStatus === rawStatus && prior.candidateSince !== undefined
      ? prior.candidateSince
      : now;
  if (Date.parse(now) - Date.parse(candidateSince) >= minimumStableWindowMs)
    return { status: rawStatus };
  return { status: prior.snapshot.status, candidateStatus: rawStatus, candidateSince };
}

function statusRank(status: CapabilityReadinessStatus): number {
  return status === 'available' ? 0 : status === 'degraded' ? 1 : 2;
}

function assertInput(input: RuntimeCapabilityReadinessInput): void {
  if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1_000 || input.ttlMs > 86_400_000)
    throw new Error('CAPABILITY_READINESS_TTL_INVALID');
  if (
    !Number.isSafeInteger(input.minimumStableWindowMs) ||
    input.minimumStableWindowMs < 0 ||
    input.minimumStableWindowMs > input.ttlMs
  )
    throw new Error('CAPABILITY_READINESS_STABILITY_WINDOW_INVALID');
}

function assertCommand(command: RuntimeCapabilityReadinessCommand): void {
  if (command.idempotencyKey.trim().length < 8 || command.idempotencyKey.length > 256)
    throw new Error('CAPABILITY_READINESS_IDEMPOTENCY_KEY_INVALID');
  if (!/^sha256:[0-9a-f]{64}$/u.test(command.requestHash))
    throw new Error('CAPABILITY_READINESS_REQUEST_HASH_INVALID');
}

function hashParts(parts: readonly string[]): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify([...parts].sort()))
    .digest('hex')}`;
}

function hashSnapshot(snapshot: CapabilityReadinessSnapshot): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000 ? value : 100;
}
