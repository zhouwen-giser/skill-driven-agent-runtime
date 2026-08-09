import {
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
  MCP_CAPABILITY_EVIDENCE_PROJECTOR_VERSION,
  type McpCapabilityEvidenceSource,
} from './mcp-capability-evidence-projector.js';
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
    ...(partition.kind === 'experience_task' ? { episodeId: partition.sourceId } : {}),
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
