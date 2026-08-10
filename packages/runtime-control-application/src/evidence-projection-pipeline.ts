import {
  getEvidenceCatalogEntry,
  hashCanonicalEvidenceJson,
  type EvidenceIssueCode,
  type EvidenceJsonValue,
  type EvidenceProjectionIssue,
} from '../../domain/src/index.js';
import {
  EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
  type ExperienceReplayArtifactEvidenceSource,
  type ExperienceReplayArtifactProjectionPartition,
} from './experience-replay-artifact-evidence-projector.js';
import {
  EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
  type EvidenceInfrastructureProjectionPartition,
  type EvidenceInfrastructureSource,
} from './evidence-infrastructure-projector.js';
import {
  MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION,
  type McpCapabilityEvidenceSource,
} from './mcp-capability-evidence-projector.js';
import {
  NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
  type NodeControlEvidenceProjectionPartition,
  type NodeControlEvidenceSource,
} from './node-control-evidence-projector.js';
import {
  RUNTIME_CORE_EVIDENCE_PROJECTOR_VERSION,
  type RuntimeCoreEvidenceSource,
} from './runtime-core-evidence-projector.js';
import {
  SKILL_EVIDENCE_PROJECTOR_VERSION,
  type SkillEvidenceSource,
} from './skill-evidence-projector.js';

interface TaskEvidenceProjector {
  projectTask(taskId: string): Promise<unknown>;
}

interface PartitionEvidenceProjector {
  projectPartition(partition: ExperienceReplayArtifactProjectionPartition): Promise<unknown>;
}

interface NodeControlPartitionEvidenceProjector {
  projectPartition(partition: NodeControlEvidenceProjectionPartition): Promise<unknown>;
}

interface EvidenceInfrastructurePartitionProjector {
  projectPartition(partition: EvidenceInfrastructureProjectionPartition): Promise<unknown>;
}

export interface TerminalEpisodeCoverageCandidate {
  readonly episodeId: string;
  readonly taskId: string;
  readonly terminalOutcomeId: string;
  readonly sealRequested: boolean;
}

export interface TerminalEpisodeCoverageSource {
  pendingTerminalEpisodes(limit: number): Promise<readonly TerminalEpisodeCoverageCandidate[]>;
}

export interface TerminalEpisodeCoverageReconciler {
  reconcile(input: {
    readonly episodeId: string;
    readonly taskId: string;
    readonly terminalOutcomeId: string;
    readonly sealRequested: boolean;
  }): Promise<unknown>;
}

export const EPISODE_EVIDENCE_COVERAGE_PROJECTOR_VERSION = 'episode-evidence-coverage/v1' as const;

export interface EvidenceProjectionIssueWriter {
  recordProjectionIssue(
    issue: EvidenceProjectionIssue,
    evaluationRole: 'required' | 'supporting' | 'diagnostic',
  ): Promise<void>;
  resolveProjectionIssue(input: {
    readonly issueId: string;
    readonly sourcePartition: string;
    readonly projectorVersion: string;
    readonly resolvedAt: string;
  }): Promise<void>;
}

export interface EvidenceProjectionPipelineResult {
  readonly attemptedItems: number;
  readonly projectedItems: number;
  readonly failedItems: number;
  readonly sourceListingFailures: number;
  readonly issuePersistenceFailures: number;
  readonly openIssueIds: readonly string[];
}

export class EvidenceProjectionIssuePersistenceError extends Error {
  readonly code = 'EVIDENCE_PROJECTION_ISSUE_PERSISTENCE_FAILED' as const;
  readonly result: EvidenceProjectionPipelineResult;

  constructor(result: EvidenceProjectionPipelineResult) {
    super('One or more required Evidence projection issue state changes could not be persisted.');
    this.name = 'EvidenceProjectionIssuePersistenceError';
    this.result = result;
  }
}

interface ProjectionItemDescriptor {
  readonly sourceFamily: string;
  readonly sourcePartition: string;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly projectorVersion: string;
  readonly sourceSystem?: 'runtime' | 'node_control';
  readonly evaluationRole?: 'required' | 'supporting' | 'diagnostic';
  readonly recordType?: string;
  readonly episodeId?: string;
}

interface MutableProjectionPipelineResult {
  attemptedItems: number;
  projectedItems: number;
  failedItems: number;
  sourceListingFailures: number;
  issuePersistenceFailures: number;
  readonly openIssueIds: string[];
}

interface TaskFamilyInput {
  readonly sourceFamily: string;
  readonly sourceTable: string;
  readonly partitionPrefix: string;
  readonly projectorVersion: string;
  readonly source: Pick<RuntimeCoreEvidenceSource, 'pendingTaskIds'>;
  readonly projector: TaskEvidenceProjector;
}

export class CanonicalEvidenceProjectionPipeline {
  readonly #writer: EvidenceProjectionIssueWriter;
  readonly #runtimeCore: Readonly<{
    source: RuntimeCoreEvidenceSource;
    projector: TaskEvidenceProjector;
  }>;
  readonly #skill: Readonly<{ source: SkillEvidenceSource; projector: TaskEvidenceProjector }>;
  readonly #mcpCapability: Readonly<{
    source: McpCapabilityEvidenceSource;
    projector: TaskEvidenceProjector;
  }>;
  readonly #experienceReplayArtifact: Readonly<{
    source: ExperienceReplayArtifactEvidenceSource;
    projector: PartitionEvidenceProjector;
  }>;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    input: Readonly<{
      writer: EvidenceProjectionIssueWriter;
      runtimeCore: Readonly<{
        source: RuntimeCoreEvidenceSource;
        projector: TaskEvidenceProjector;
      }>;
      skill: Readonly<{ source: SkillEvidenceSource; projector: TaskEvidenceProjector }>;
      mcpCapability: Readonly<{
        source: McpCapabilityEvidenceSource;
        projector: TaskEvidenceProjector;
      }>;
      experienceReplayArtifact: Readonly<{
        source: ExperienceReplayArtifactEvidenceSource;
        projector: PartitionEvidenceProjector;
      }>;
      clock?: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#writer = input.writer;
    this.#runtimeCore = input.runtimeCore;
    this.#skill = input.skill;
    this.#mcpCapability = input.mcpCapability;
    this.#experienceReplayArtifact = input.experienceReplayArtifact;
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async drain(limit = 10): Promise<EvidenceProjectionPipelineResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Evidence projection limit must be between 1 and 1000.');
    }
    const state: MutableProjectionPipelineResult = {
      attemptedItems: 0,
      projectedItems: 0,
      failedItems: 0,
      sourceListingFailures: 0,
      issuePersistenceFailures: 0,
      openIssueIds: [],
    };

    await this.#drainTaskFamily(
      {
        sourceFamily: 'runtime',
        sourceTable: 'agent_task',
        partitionPrefix: 'runtime-core:',
        projectorVersion: RUNTIME_CORE_EVIDENCE_PROJECTOR_VERSION,
        source: this.#runtimeCore.source,
        projector: this.#runtimeCore.projector,
      },
      limit,
      state,
    );
    await this.#drainTaskFamily(
      {
        sourceFamily: 'skill',
        sourceTable: 'skill_execution_record',
        partitionPrefix: 'skill:',
        projectorVersion: SKILL_EVIDENCE_PROJECTOR_VERSION,
        source: this.#skill.source,
        projector: this.#skill.projector,
      },
      limit,
      state,
    );
    await this.#drainTaskFamily(
      {
        sourceFamily: 'mcp-capability',
        sourceTable: 'agent_task',
        partitionPrefix: 'mcp-capability:',
        projectorVersion: MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION,
        source: this.#mcpCapability.source,
        projector: this.#mcpCapability.projector,
      },
      limit,
      state,
    );
    await this.#drainExperienceReplayArtifact(limit, state);

    const result: EvidenceProjectionPipelineResult = Object.freeze({
      attemptedItems: state.attemptedItems,
      projectedItems: state.projectedItems,
      failedItems: state.failedItems,
      sourceListingFailures: state.sourceListingFailures,
      issuePersistenceFailures: state.issuePersistenceFailures,
      openIssueIds: Object.freeze([...state.openIssueIds]),
    });
    if (result.issuePersistenceFailures > 0) {
      throw new EvidenceProjectionIssuePersistenceError(result);
    }
    return result;
  }

  async #drainTaskFamily(
    input: TaskFamilyInput,
    limit: number,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    const listing = listingDescriptor(input);
    let taskIds: readonly string[];
    try {
      taskIds = await input.source.pendingTaskIds(limit);
      await this.#resolve(listing, state);
    } catch (error) {
      state.sourceListingFailures += 1;
      await this.#record(listing, error, 'source_listing', state);
      return;
    }

    for (const taskId of taskIds) {
      const descriptor: ProjectionItemDescriptor = {
        sourceFamily: input.sourceFamily,
        sourcePartition: `${input.partitionPrefix}${taskId}`,
        sourceTable: input.sourceTable,
        sourceRecordId: taskId,
        projectorVersion: input.projectorVersion,
        episodeId: taskId,
      };
      await this.#project(descriptor, () => input.projector.projectTask(taskId), state);
    }
  }

  async #drainExperienceReplayArtifact(
    limit: number,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    const listing: ProjectionItemDescriptor = {
      sourceFamily: 'experience-replay-artifact',
      sourcePartition: 'projection-source:experience-replay-artifact',
      sourceTable: 'evidence_source_checkpoint',
      sourceRecordId: 'experience-replay-artifact',
      projectorVersion: EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
    };
    let partitions: readonly ExperienceReplayArtifactProjectionPartition[];
    try {
      partitions = await this.#experienceReplayArtifact.source.pendingPartitions(limit);
      await this.#resolve(listing, state);
    } catch (error) {
      state.sourceListingFailures += 1;
      await this.#record(listing, error, 'source_listing', state);
      return;
    }

    for (const partition of partitions) {
      const descriptor = partitionDescriptor(partition);
      await this.#project(
        descriptor,
        () => this.#experienceReplayArtifact.projector.projectPartition(partition),
        state,
      );
    }
  }

  async #project(
    descriptor: ProjectionItemDescriptor,
    project: () => Promise<unknown>,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    state.attemptedItems += 1;
    try {
      await project();
      state.projectedItems += 1;
      await this.#resolve(descriptor, state);
    } catch (error) {
      state.failedItems += 1;
      await this.#record(descriptor, error, 'item_projection', state);
    }
  }

  async #record(
    descriptor: ProjectionItemDescriptor,
    error: unknown,
    failureStage: 'source_listing' | 'item_projection',
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    const issueId = projectionIssueId(descriptor);
    const issue: EvidenceProjectionIssue = {
      issueId,
      issueCode: projectionIssueCode(error),
      severity: 'blocking',
      ...(descriptor.episodeId === undefined ? {} : { episodeId: descriptor.episodeId }),
      sourceSystem: 'runtime',
      sourceTable: descriptor.sourceTable,
      sourceRecordId: descriptor.sourceRecordId,
      sourcePartition: descriptor.sourcePartition,
      projectorVersion: descriptor.projectorVersion,
      retryable: true,
      detail: Object.freeze({
        failureCode: safeFailureCode(error),
        failureStage,
        sourceFamily: descriptor.sourceFamily,
      }) satisfies Readonly<Record<string, EvidenceJsonValue>>,
      createdAt: this.#clock.now(),
    };
    try {
      await this.#writer.recordProjectionIssue(issue, 'required');
      state.openIssueIds.push(issueId);
    } catch {
      state.issuePersistenceFailures += 1;
    }
  }

  async #resolve(
    descriptor: ProjectionItemDescriptor,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    try {
      await this.#writer.resolveProjectionIssue({
        issueId: projectionIssueId(descriptor),
        sourcePartition: descriptor.sourcePartition,
        projectorVersion: descriptor.projectorVersion,
        resolvedAt: this.#clock.now(),
      });
    } catch {
      state.issuePersistenceFailures += 1;
    }
  }
}

/**
 * Recomputes terminal episode coverage without allowing one malformed episode to starve the
 * remaining terminal authority rows. The runner only coordinates Application ports; PostgreSQL
 * remains the candidate, Manifest and issue authority.
 */
export class EpisodeEvidenceCoverageProjectionPipeline {
  readonly #source: TerminalEpisodeCoverageSource;
  readonly #reconciler: TerminalEpisodeCoverageReconciler;
  readonly #attempts: IsolatedProjectionAttempts;

  constructor(
    input: Readonly<{
      writer: EvidenceProjectionIssueWriter;
      source: TerminalEpisodeCoverageSource;
      reconciler: TerminalEpisodeCoverageReconciler;
      clock?: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#source = input.source;
    this.#reconciler = input.reconciler;
    this.#attempts = new IsolatedProjectionAttempts(input.writer, input.clock);
  }

  async drain(limit = 10): Promise<EvidenceProjectionPipelineResult> {
    assertProjectionLimit(limit, 'Episode Evidence coverage');
    const state = projectionPipelineState();
    const listing = episodeCoverageListingDescriptor();
    let candidates: readonly TerminalEpisodeCoverageCandidate[];
    try {
      candidates = await this.#source.pendingTerminalEpisodes(limit);
      await this.#attempts.resolve(listing, state);
    } catch (error) {
      state.sourceListingFailures += 1;
      await this.#attempts.record(listing, error, 'source_listing', state);
      return finishProjectionPipeline(state);
    }

    for (const candidate of candidates) {
      const descriptor = episodeCoverageCandidateDescriptor(candidate);
      await this.#attempts.project(
        descriptor,
        () =>
          this.#reconciler.reconcile({
            episodeId: candidate.episodeId,
            taskId: candidate.taskId,
            terminalOutcomeId: candidate.terminalOutcomeId,
            sealRequested: candidate.sealRequested,
          }),
        state,
      );
    }
    return finishProjectionPipeline(state);
  }
}

/**
 * Projects the five Evidence-infrastructure record types after episode coverage reconciliation.
 * Its own durable Projection Issues are deliberately identified by the infrastructure projector
 * version so the PostgreSQL source can exclude them from self-observation.
 */
export class EvidenceInfrastructureProjectionPipeline {
  readonly #source: EvidenceInfrastructureSource;
  readonly #projector: EvidenceInfrastructurePartitionProjector;
  readonly #attempts: IsolatedProjectionAttempts;

  constructor(
    input: Readonly<{
      writer: EvidenceProjectionIssueWriter;
      source: EvidenceInfrastructureSource;
      projector: EvidenceInfrastructurePartitionProjector;
      clock?: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#source = input.source;
    this.#projector = input.projector;
    this.#attempts = new IsolatedProjectionAttempts(input.writer, input.clock);
  }

  async drain(limit = 25): Promise<EvidenceProjectionPipelineResult> {
    assertProjectionLimit(limit, 'Evidence infrastructure projection');
    const state = projectionPipelineState();
    const listing = evidenceInfrastructureListingDescriptor();
    let partitions: readonly EvidenceInfrastructureProjectionPartition[];
    try {
      partitions = await this.#source.pendingPartitions(limit);
      await this.#attempts.resolve(listing, state);
    } catch (error) {
      state.sourceListingFailures += 1;
      await this.#attempts.record(listing, error, 'source_listing', state);
      return finishProjectionPipeline(state);
    }

    for (const partition of partitions) {
      const descriptor = evidenceInfrastructurePartitionDescriptor(partition);
      await this.#attempts.project(
        descriptor,
        () => this.#projector.projectPartition(partition),
        state,
      );
    }
    return finishProjectionPipeline(state);
  }
}

class IsolatedProjectionAttempts {
  readonly #writer: EvidenceProjectionIssueWriter;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    writer: EvidenceProjectionIssueWriter,
    clock: Readonly<{ now(): string }> = { now: () => new Date().toISOString() },
  ) {
    this.#writer = writer;
    this.#clock = clock;
  }

  async project(
    descriptor: ProjectionItemDescriptor,
    project: () => Promise<unknown>,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    state.attemptedItems += 1;
    try {
      await project();
      state.projectedItems += 1;
      await this.resolve(descriptor, state);
    } catch (error) {
      state.failedItems += 1;
      await this.record(descriptor, error, 'item_projection', state);
    }
  }

  async record(
    descriptor: ProjectionItemDescriptor,
    error: unknown,
    failureStage: 'source_listing' | 'item_projection',
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    const issueId = projectionIssueId(descriptor);
    const evaluationRole = descriptor.evaluationRole ?? 'required';
    const issue: EvidenceProjectionIssue = {
      issueId,
      issueCode: projectionIssueCode(error),
      severity:
        evaluationRole === 'required'
          ? 'blocking'
          : evaluationRole === 'diagnostic'
            ? 'diagnostic'
            : 'degraded',
      ...(descriptor.recordType === undefined ? {} : { recordType: descriptor.recordType }),
      ...(descriptor.episodeId === undefined ? {} : { episodeId: descriptor.episodeId }),
      sourceSystem: descriptor.sourceSystem ?? 'runtime',
      sourceTable: descriptor.sourceTable,
      sourceRecordId: descriptor.sourceRecordId,
      sourcePartition: descriptor.sourcePartition,
      projectorVersion: descriptor.projectorVersion,
      retryable: true,
      detail: Object.freeze({
        failureCode: safeFailureCode(error),
        failureStage,
        sourceFamily: descriptor.sourceFamily,
      }) satisfies Readonly<Record<string, EvidenceJsonValue>>,
      createdAt: this.#clock.now(),
    };
    try {
      await this.#writer.recordProjectionIssue(issue, evaluationRole);
      state.openIssueIds.push(issueId);
    } catch {
      state.issuePersistenceFailures += 1;
    }
  }

  async resolve(
    descriptor: ProjectionItemDescriptor,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    try {
      await this.#writer.resolveProjectionIssue({
        issueId: projectionIssueId(descriptor),
        sourcePartition: descriptor.sourcePartition,
        projectorVersion: descriptor.projectorVersion,
        resolvedAt: this.#clock.now(),
      });
    } catch {
      state.issuePersistenceFailures += 1;
    }
  }
}

/**
 * Drains the cross-database Node Control source independently from the Runtime-owned families.
 * One corrupt authority aggregate must neither starve healthy partitions nor erase the durable
 * reason that it remains pending.
 */
export class NodeControlEvidenceProjectionPipeline {
  readonly #writer: EvidenceProjectionIssueWriter;
  readonly #source: NodeControlEvidenceSource;
  readonly #projector: NodeControlPartitionEvidenceProjector;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    input: Readonly<{
      writer: EvidenceProjectionIssueWriter;
      source: NodeControlEvidenceSource;
      projector: NodeControlPartitionEvidenceProjector;
      clock?: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#writer = input.writer;
    this.#source = input.source;
    this.#projector = input.projector;
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async drain(limit = 25): Promise<EvidenceProjectionPipelineResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('Node Control Evidence projection limit must be between 1 and 1000.');
    }
    const state: MutableProjectionPipelineResult = {
      attemptedItems: 0,
      projectedItems: 0,
      failedItems: 0,
      sourceListingFailures: 0,
      issuePersistenceFailures: 0,
      openIssueIds: [],
    };
    const listing = nodeControlListingDescriptor();
    let partitions: readonly NodeControlEvidenceProjectionPartition[];
    try {
      partitions = (await this.#source.pendingPage(limit)).partitions;
      await this.#resolve(listing, state);
    } catch (error) {
      state.sourceListingFailures += 1;
      await this.#record(listing, error, 'source_listing', state);
      return this.#finish(state);
    }

    for (const partition of partitions) {
      const descriptor = nodeControlPartitionDescriptor(partition);
      state.attemptedItems += 1;
      try {
        await this.#projector.projectPartition(partition);
        state.projectedItems += 1;
        await this.#resolve(descriptor, state);
      } catch (error) {
        state.failedItems += 1;
        await this.#record(descriptor, error, 'item_projection', state);
      }
    }
    return this.#finish(state);
  }

  async #record(
    descriptor: NodeControlProjectionItemDescriptor,
    error: unknown,
    failureStage: 'source_listing' | 'item_projection',
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    const issueId = nodeControlProjectionIssueId(descriptor);
    const issue: EvidenceProjectionIssue = {
      issueId,
      issueCode: projectionIssueCode(error),
      severity:
        descriptor.evaluationRole === 'required'
          ? 'blocking'
          : descriptor.evaluationRole === 'diagnostic'
            ? 'diagnostic'
            : 'degraded',
      ...(descriptor.recordType === undefined ? {} : { recordType: descriptor.recordType }),
      sourceSystem: descriptor.sourceSystem,
      sourceTable: descriptor.sourceTable,
      sourceRecordId: descriptor.sourceRecordId,
      sourcePartition: descriptor.sourcePartition,
      projectorVersion: NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
      retryable: true,
      detail: Object.freeze({
        failureCode: safeFailureCode(error),
        failureStage,
        sourceFamily: 'node_control',
      }) satisfies Readonly<Record<string, EvidenceJsonValue>>,
      createdAt: this.#clock.now(),
    };
    try {
      await this.#writer.recordProjectionIssue(issue, descriptor.evaluationRole);
      state.openIssueIds.push(issueId);
    } catch {
      state.issuePersistenceFailures += 1;
    }
  }

  async #resolve(
    descriptor: NodeControlProjectionItemDescriptor,
    state: MutableProjectionPipelineResult,
  ): Promise<void> {
    try {
      await this.#writer.resolveProjectionIssue({
        issueId: nodeControlProjectionIssueId(descriptor),
        sourcePartition: descriptor.sourcePartition,
        projectorVersion: NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
        resolvedAt: this.#clock.now(),
      });
    } catch {
      state.issuePersistenceFailures += 1;
    }
  }

  #finish(state: MutableProjectionPipelineResult): EvidenceProjectionPipelineResult {
    const result: EvidenceProjectionPipelineResult = Object.freeze({
      attemptedItems: state.attemptedItems,
      projectedItems: state.projectedItems,
      failedItems: state.failedItems,
      sourceListingFailures: state.sourceListingFailures,
      issuePersistenceFailures: state.issuePersistenceFailures,
      openIssueIds: Object.freeze([...state.openIssueIds]),
    });
    if (result.issuePersistenceFailures > 0) {
      throw new EvidenceProjectionIssuePersistenceError(result);
    }
    return result;
  }
}

function projectionPipelineState(): MutableProjectionPipelineResult {
  return {
    attemptedItems: 0,
    projectedItems: 0,
    failedItems: 0,
    sourceListingFailures: 0,
    issuePersistenceFailures: 0,
    openIssueIds: [],
  };
}

function finishProjectionPipeline(
  state: MutableProjectionPipelineResult,
): EvidenceProjectionPipelineResult {
  const result: EvidenceProjectionPipelineResult = Object.freeze({
    attemptedItems: state.attemptedItems,
    projectedItems: state.projectedItems,
    failedItems: state.failedItems,
    sourceListingFailures: state.sourceListingFailures,
    issuePersistenceFailures: state.issuePersistenceFailures,
    openIssueIds: Object.freeze([...state.openIssueIds]),
  });
  if (result.issuePersistenceFailures > 0) {
    throw new EvidenceProjectionIssuePersistenceError(result);
  }
  return result;
}

function assertProjectionLimit(limit: number, label: string): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error(`${label} limit must be between 1 and 1000.`);
  }
}

function episodeCoverageListingDescriptor(): ProjectionItemDescriptor {
  const catalog = getEvidenceCatalogEntry('evidence.episode_manifest');
  return {
    sourceFamily: 'evidence-coverage',
    sourcePartition: 'projection-source:evidence-coverage',
    sourceTable: 'runtime_terminal_outcome',
    sourceRecordId: 'terminal-episodes',
    projectorVersion: EPISODE_EVIDENCE_COVERAGE_PROJECTOR_VERSION,
    sourceSystem: catalog.sourceSystem,
    evaluationRole: catalog.evaluationRole,
    recordType: catalog.recordType,
  };
}

function episodeCoverageCandidateDescriptor(
  candidate: TerminalEpisodeCoverageCandidate,
): ProjectionItemDescriptor {
  const catalog = getEvidenceCatalogEntry('evidence.episode_manifest');
  return {
    sourceFamily: 'evidence-coverage',
    sourcePartition: `v141:evidence-coverage:${String(candidate.episodeId.length)}:${candidate.episodeId}`,
    sourceTable: 'runtime_terminal_outcome',
    sourceRecordId: candidate.terminalOutcomeId,
    projectorVersion: EPISODE_EVIDENCE_COVERAGE_PROJECTOR_VERSION,
    sourceSystem: catalog.sourceSystem,
    evaluationRole: catalog.evaluationRole,
    recordType: catalog.recordType,
    episodeId: candidate.episodeId,
  };
}

function evidenceInfrastructureListingDescriptor(): ProjectionItemDescriptor {
  const catalog = getEvidenceCatalogEntry('evidence.episode_manifest');
  return {
    sourceFamily: 'evidence',
    sourcePartition: 'projection-source:evidence-infrastructure',
    sourceTable: 'evidence_source_checkpoint',
    sourceRecordId: 'evidence-infrastructure',
    projectorVersion: EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
    sourceSystem: catalog.sourceSystem,
    evaluationRole: catalog.evaluationRole,
    recordType: catalog.recordType,
  };
}

function evidenceInfrastructurePartitionDescriptor(
  partition: EvidenceInfrastructureProjectionPartition,
): ProjectionItemDescriptor {
  const catalog = getEvidenceCatalogEntry(partition.recordType);
  return {
    sourceFamily: 'evidence',
    sourcePartition: partition.sourcePartition,
    sourceTable: catalog.sourceTable,
    sourceRecordId: partition.sourceRecordId,
    projectorVersion: EVIDENCE_INFRASTRUCTURE_PROJECTOR_VERSION,
    sourceSystem: catalog.sourceSystem,
    evaluationRole: catalog.evaluationRole,
    recordType: catalog.recordType,
  };
}

interface NodeControlProjectionItemDescriptor {
  readonly sourcePartition: string;
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceSystem: 'runtime' | 'node_control';
  readonly evaluationRole: 'required' | 'supporting' | 'diagnostic';
  readonly recordType?: string;
}

function nodeControlListingDescriptor(): NodeControlProjectionItemDescriptor {
  return {
    sourcePartition: 'projection-source:node-control',
    sourceTable: 'node_event_outbox',
    sourceRecordId: 'node-control',
    sourceSystem: 'node_control',
    evaluationRole: 'required',
  };
}

function nodeControlPartitionDescriptor(
  partition: NodeControlEvidenceProjectionPartition,
): NodeControlProjectionItemDescriptor {
  const catalog = getEvidenceCatalogEntry(partition.recordType);
  return {
    recordType: partition.recordType,
    sourcePartition: partition.sourcePartition,
    sourceTable: catalog.sourceTable,
    sourceRecordId: partition.sourceRecordId,
    sourceSystem: catalog.sourceSystem,
    evaluationRole: catalog.evaluationRole,
  };
}

function nodeControlProjectionIssueId(descriptor: NodeControlProjectionItemDescriptor): string {
  return `projection_${hashCanonicalEvidenceJson({
    sourceFamily: 'node_control',
    sourcePartition: descriptor.sourcePartition,
    sourceRecordId: descriptor.sourceRecordId,
    projectorVersion: NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
  }).slice('sha256:'.length)}`;
}

function listingDescriptor(input: TaskFamilyInput): ProjectionItemDescriptor {
  return {
    sourceFamily: input.sourceFamily,
    sourcePartition: `projection-source:${input.sourceFamily}`,
    sourceTable: input.sourceTable,
    sourceRecordId: input.sourceFamily,
    projectorVersion: input.projectorVersion,
  };
}

function partitionDescriptor(
  partition: ExperienceReplayArtifactProjectionPartition,
): ProjectionItemDescriptor {
  return {
    sourceFamily: partition.sourceFamily,
    sourcePartition: partition.sourcePartition,
    sourceTable: partitionSourceTable(partition.kind),
    sourceRecordId:
      partition.sourceVersion === undefined
        ? partition.sourceId
        : `${partition.sourceId}@${String(partition.sourceVersion)}`,
    projectorVersion: EXPERIENCE_REPLAY_ARTIFACT_PROJECTOR_VERSION,
    ...(partition.episodeId === undefined ? {} : { episodeId: partition.episodeId }),
  };
}

function partitionSourceTable(kind: ExperienceReplayArtifactProjectionPartition['kind']): string {
  switch (kind) {
    case 'experience_task':
      return 'goal_experience_episode';
    case 'experience_pattern':
      return 'pattern_candidate';
    case 'replay_case':
      return 'artifact_replay_case';
    case 'replay_dataset':
      return 'replay_dataset_manifest';
    case 'validation':
      return 'artifact_validation_run';
    case 'artifact':
      return 'compiled_artifact';
    case 'retrieval':
      return 'artifact_match_log';
    case 'usage':
      return 'artifact_execution';
    case 'feedback':
      return 'artifact_feedback';
    case 'promotion':
      return 'artifact_promotion_package';
  }
}

function projectionIssueId(descriptor: ProjectionItemDescriptor): string {
  return `projection_${hashCanonicalEvidenceJson({
    sourceFamily: descriptor.sourceFamily,
    sourcePartition: descriptor.sourcePartition,
    sourceRecordId: descriptor.sourceRecordId,
    projectorVersion: descriptor.projectorVersion,
  }).slice('sha256:'.length)}`;
}

function projectionIssueCode(error: unknown): EvidenceIssueCode {
  const code = errorCode(error);
  if (code === 'SCHEMA_INVALID') return 'schema_invalid';
  if (code === 'EVIDENCE_PAYLOAD_HASH_CONFLICT' || code === 'EVIDENCE_SOURCE_IDENTITY_CONFLICT') {
    return 'payload_hash_conflict';
  }
  return isSourceUnavailable(error) ? 'source_unavailable' : 'projection_bug';
}

function isSourceUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code.startsWith('08') ||
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === '53300' ||
    code === '53400' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ETIMEDOUT'
  );
}

function safeFailureCode(error: unknown): string {
  const code = errorCode(error);
  if (code.startsWith('08')) return 'SOURCE_UNAVAILABLE_PG_CONNECTION';
  if (
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === '53300' ||
    code === '53400'
  ) {
    return 'SOURCE_UNAVAILABLE_PG_RUNTIME';
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ETIMEDOUT'
  ) {
    return code;
  }
  if (error instanceof TypeError) return 'TYPE_ERROR';
  if (error instanceof RangeError) return 'RANGE_ERROR';
  if (error instanceof SyntaxError) return 'SYNTAX_ERROR';
  if (/^[0-9A-Z]{5}$/u.test(code)) return `PG_ERROR_CLASS_${code.slice(0, 2)}`;
  return 'UNCLASSIFIED_ERROR';
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code.toUpperCase() : '';
}
