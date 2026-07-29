import { createHash } from 'node:crypto';

import type {
  ArtifactLineage,
  ArtifactRuntimeBinding,
  CompiledArtifact,
  CompiledArtifactStatus,
  CompiledArtifactType,
} from '../../../domain/src/index.js';
import type { StructuredHint } from '../../../domain/src/compiler/contracts.js';

export const ARTIFACT_PERSISTENCE_CONTRACT_VERSION = '1.1' as const;

export const ARTIFACT_PERSISTENCE_SCHEMA_HASHES = Object.freeze({
  ArtifactRepository: '617560087d746b79cd5fa38f82bf8c7a90448f56e5b54c1117f0b186bae54c53',
  ArtifactValidationRepository: '0c94dc844ed8cf5f4e9e4ca678e208172cd3a394affbf93ce910765899f86ab9',
  ArtifactExecutionRepository: 'c32e0994dd2d25cbe5df2116e98b0c93252d5a75bb5e83867c25038fcec12650',
} as const);

export interface ArtifactRef {
  readonly artifactId: string;
  readonly version: number;
}

export interface ArtifactCandidatePersistence {
  readonly artifact: CompiledArtifact;
  readonly lineage: ArtifactLineage;
  readonly runtimeBinding?: ArtifactRuntimeBinding;
}

export interface ArtifactIndexQuery {
  readonly tenantId?: string;
  readonly domain?: string;
  readonly artifactTypes?: readonly CompiledArtifactType[];
  readonly limit?: number;
  /** Internal keyset cursor used only while rebuilding a disposable projection. */
  readonly afterArtifactKey?: string;
}

export interface ArtifactIndexEntry {
  readonly artifactId: string;
  readonly artifactKey: string;
  readonly artifactVersion: number;
  readonly artifactType: CompiledArtifactType;
  readonly tenantId?: string;
  readonly domain: string;
  readonly taskTypeIds?: readonly string[];
  readonly riskLevel: CompiledArtifact['riskLevel'];
  readonly contentHash: string;
  readonly dependencySnapshot: CompiledArtifact['dependencySnapshot'];
  readonly pointerLockVersion: number;
  readonly activatedAt: string;
  /**
   * Non-authoritative Level-0 selection fields projected from the immutable
   * Artifact envelope. They deliberately omit parameter schemas, conditions,
   * and runtime bindings; those require a Level-1 authoritative definition
   * read after this projection has narrowed the candidate set.
   */
  readonly exactPatterns?: readonly string[];
  readonly structuredHints?: readonly StructuredHint[];
  readonly embeddingRef?: string;
}

export interface ArtifactActivationInput extends ArtifactRef {
  readonly artifactKey: string;
  readonly expectedLockVersion: number;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly validationSummaryHash: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly activatedAt: string;
}

export interface ArtifactDeprecationInput extends ArtifactRef {
  readonly artifactKey: string;
  readonly expectedLockVersion: number;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly deprecatedAt: string;
}

export interface ArtifactRepository {
  findActiveIndex(query: ArtifactIndexQuery): Promise<readonly ArtifactIndexEntry[]>;
  getDefinition(ref: ArtifactRef): Promise<CompiledArtifact | undefined>;
  saveCandidate(candidate: ArtifactCandidatePersistence): Promise<void>;
  activate(input: ArtifactActivationInput): Promise<void>;
  deprecate(input: ArtifactDeprecationInput): Promise<void>;
}

export type ArtifactValidationType = 'static' | 'replay' | 'simulation' | 'shadow' | 'revalidation';
export type ArtifactValidationStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface ArtifactValidationRun {
  readonly validationRunId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly validationType: ArtifactValidationType;
  readonly datasetRef: string;
  readonly status: ArtifactValidationStatus;
  readonly result?: string;
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly counterexampleRefs: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type ValidationRunInput = Omit<ArtifactValidationRun, 'status' | 'result' | 'completedAt'>;

export interface ValidationResultInput {
  readonly validationRunId: string;
  readonly status: 'passed' | 'failed';
  readonly result: string;
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly counterexampleRefs: readonly string[];
  readonly completedAt: string;
}

export interface ValidationSummary {
  readonly validationRunId: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly status: 'passed' | 'failed';
  readonly result: string;
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly completedAt: string;
}

export function hashValidationSummary(summary: ValidationSummary): string {
  const canonical = JSON.stringify([
    summary.validationRunId,
    summary.artifactId,
    summary.artifactVersion,
    summary.status,
    summary.result,
    Object.entries(summary.metrics).sort(([left], [right]) => left.localeCompare(right)),
    summary.completedAt,
  ]);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

export interface ArtifactValidationRepository {
  createRun(input: ValidationRunInput): Promise<ArtifactValidationRun>;
  appendResult(input: ValidationResultInput): Promise<void>;
  findPromotionSummary(ref: ArtifactRef): Promise<ValidationSummary | undefined>;
}

export interface ArtifactExecutionStart extends ArtifactRef {
  readonly artifactExecutionId: string;
  readonly taskId: string;
  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly mode: string;
  readonly decisionSnapshot: Readonly<Record<string, unknown>>;
  readonly generatedPlanId?: string;
  readonly startedAt: string;
}

export interface ArtifactExecutionRecord extends ArtifactExecutionStart {
  readonly status: 'started' | 'completed' | 'failed' | 'canceled';
  readonly fallbackReasonCode?: string;
  readonly completedAt?: string;
}

export interface ArtifactExecutionCompletion {
  readonly artifactExecutionId: string;
  readonly status: 'completed' | 'failed' | 'canceled';
  readonly fallbackReasonCode?: string;
  readonly completedAt: string;
}

export interface ArtifactFeedbackInput {
  readonly feedbackId: string;
  readonly artifactExecutionId: string;
  readonly artifactId: string;
  readonly feedbackType: string;
  readonly reasonCode: string;
  readonly summary: string;
  readonly impact: Readonly<Record<string, unknown>>;
  readonly outcomeRef?: string;
  readonly createdAt: string;
}

export interface ArtifactExecutionRepository {
  start(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord>;
  complete(input: ArtifactExecutionCompletion): Promise<void>;
  appendFeedback(input: ArtifactFeedbackInput): Promise<void>;
}

export class ArtifactPersistenceError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, string>>;

  constructor(code: string, message: string, details: Readonly<Record<string, string>> = {}) {
    super(message);
    this.name = 'ArtifactPersistenceError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function assertArtifactStatus(
  status: CompiledArtifactStatus,
  allowed: readonly CompiledArtifactStatus[],
  operation: string,
): void {
  if (!allowed.includes(status)) {
    throw new ArtifactPersistenceError(
      'ARTIFACT_STATE_INVALID',
      `Artifact status does not permit ${operation}.`,
      { status, operation },
    );
  }
}
