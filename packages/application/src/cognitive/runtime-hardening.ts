import {
  createCognitiveRuntimeFeatureFlags,
  type CognitiveInjectionMode,
  type CognitiveRuntimeFeatureFlags,
  type MemoryRetentionPolicy,
} from '../../../domain/src/index.js';

export interface CognitiveRuntimeRebuildReport {
  readonly terminalOutboxDispatched: number;
  readonly experienceJobsRequeued: number;
  readonly observationJobsRequeued: number;
  readonly reflectionJobsRequeued: number;
  readonly activeKnowledgeProjectionsRebuilt: number;
}

type CountOperation = () => Promise<number>;

export class CognitiveRuntimeReconciler {
  readonly #dispatchTerminalOutbox: CountOperation;
  readonly #requeueExperience: CountOperation;
  readonly #requeueObservation: CountOperation;
  readonly #requeueReflection: CountOperation;
  readonly #rebuildActiveKnowledge: CountOperation;

  constructor(
    dependencies: Readonly<{
      dispatchTerminalOutbox: CountOperation;
      requeueExperience: CountOperation;
      requeueObservation: CountOperation;
      requeueReflection: CountOperation;
      rebuildActiveKnowledge: CountOperation;
    }>,
  ) {
    this.#dispatchTerminalOutbox = dependencies.dispatchTerminalOutbox;
    this.#requeueExperience = dependencies.requeueExperience;
    this.#requeueObservation = dependencies.requeueObservation;
    this.#requeueReflection = dependencies.requeueReflection;
    this.#rebuildActiveKnowledge = dependencies.rebuildActiveKnowledge;
  }

  async rebuild(): Promise<CognitiveRuntimeRebuildReport> {
    const terminalOutboxDispatched = await this.#dispatchTerminalOutbox();
    const experienceJobsRequeued = await this.#requeueExperience();
    const observationJobsRequeued = await this.#requeueObservation();
    const reflectionJobsRequeued = await this.#requeueReflection();
    const activeKnowledgeProjectionsRebuilt = await this.#rebuildActiveKnowledge();
    return Object.freeze({
      terminalOutboxDispatched,
      experienceJobsRequeued,
      observationJobsRequeued,
      reflectionJobsRequeued,
      activeKnowledgeProjectionsRebuilt,
    });
  }
}

export interface RetentionApplicationReport {
  readonly policy: MemoryRetentionPolicy;
  readonly reviewedCount: number;
  readonly archivedCount: 0;
  readonly deletedCount: 0;
}

export class RetentionService {
  readonly #policies: Readonly<{
    getPolicy(): Promise<MemoryRetentionPolicy>;
    updatePolicy(input: Omit<MemoryRetentionPolicy, 'updatedAt'>): Promise<MemoryRetentionPolicy>;
  }>;
  readonly #reviewers: readonly Readonly<{
    review(policy: MemoryRetentionPolicy): Promise<number>;
  }>[];

  constructor(
    dependencies: Readonly<{
      policies: Readonly<{
        getPolicy(): Promise<MemoryRetentionPolicy>;
        updatePolicy(
          input: Omit<MemoryRetentionPolicy, 'updatedAt'>,
        ): Promise<MemoryRetentionPolicy>;
      }>;
      reviewers?: readonly Readonly<{
        review(policy: MemoryRetentionPolicy): Promise<number>;
      }>[];
    }>,
  ) {
    this.#policies = dependencies.policies;
    this.#reviewers = Object.freeze([...(dependencies.reviewers ?? [])]);
  }

  getPolicy(): Promise<MemoryRetentionPolicy> {
    return this.#policies.getPolicy();
  }

  updatePolicy(input: Omit<MemoryRetentionPolicy, 'updatedAt'>): Promise<MemoryRetentionPolicy> {
    return this.#policies.updatePolicy(input);
  }

  async apply(): Promise<RetentionApplicationReport> {
    const policy = await this.#policies.getPolicy();
    if (policy.automaticArchiveEnabled || policy.automaticDeleteEnabled) {
      throw new Error('COGNITIVE_AUTOMATIC_RETENTION_FORBIDDEN');
    }
    let reviewedCount = 0;
    for (const reviewer of this.#reviewers) reviewedCount += await reviewer.review(policy);
    return Object.freeze({
      policy,
      reviewedCount,
      archivedCount: 0,
      deletedCount: 0,
    });
  }
}

export interface DeletionPropagationReport {
  readonly userId: string;
  readonly deletedCount: number;
  readonly targets: Readonly<Record<string, number>>;
}

export class DeletionPropagationService {
  readonly #targets: readonly Readonly<{
    name: string;
    deleteUserScope(userId: string, actorId: string): Promise<number>;
  }>[];

  constructor(
    dependencies: Readonly<{
      targets: readonly Readonly<{
        name: string;
        deleteUserScope(userId: string, actorId: string): Promise<number>;
      }>[];
    }>,
  ) {
    if (dependencies.targets.length === 0) {
      throw new Error('COGNITIVE_DELETION_TARGETS_REQUIRED');
    }
    if (
      new Set(dependencies.targets.map((target) => target.name)).size !==
      dependencies.targets.length
    ) {
      throw new Error('COGNITIVE_DELETION_TARGET_DUPLICATE');
    }
    this.#targets = Object.freeze([...dependencies.targets]);
  }

  async propagate(userId: string, actorId: string): Promise<DeletionPropagationReport> {
    if (userId.trim().length === 0 || actorId.trim().length === 0) {
      throw new Error('COGNITIVE_DELETION_IDENTITY_REQUIRED');
    }
    const targets: Record<string, number> = {};
    for (const target of this.#targets) {
      targets[target.name] = await target.deleteUserScope(userId, actorId);
    }
    return Object.freeze({
      userId,
      deletedCount: Object.values(targets).reduce((sum, count) => sum + count, 0),
      targets: Object.freeze(targets),
    });
  }
}

export type CognitiveRolloutStage =
  'capture' | 'observe' | 'candidate' | 'shadow' | 'advisory' | 'active_low_risk';

export interface FeatureRolloutDecision {
  readonly stage: CognitiveRolloutStage;
  readonly enabled: boolean;
  readonly reason: string;
  readonly effectiveInjectionMode: CognitiveInjectionMode;
}

export class FeatureRolloutPolicy {
  evaluate(
    input: Readonly<{
      stage: CognitiveRolloutStage;
      flags: CognitiveRuntimeFeatureFlags;
      risk?: 'low' | 'medium' | 'high';
      humanApproved?: boolean;
    }>,
  ): FeatureRolloutDecision {
    const flags = createCognitiveRuntimeFeatureFlags(input.flags);
    const observed = flags.experienceCaptureEnabled && flags.experienceObserverEnabled;
    const candidate = observed && flags.inductionMode !== 'off';
    const shadow = candidate && flags.injectionMode !== 'off';
    const advisory =
      shadow && (flags.injectionMode === 'advisory' || flags.injectionMode === 'active_low_risk');
    const active =
      advisory &&
      flags.injectionMode === 'active_low_risk' &&
      input.risk === 'low' &&
      input.humanApproved === true;
    const enabledByStage: Readonly<Record<CognitiveRolloutStage, boolean>> = {
      capture: flags.experienceCaptureEnabled,
      observe: observed,
      candidate,
      shadow,
      advisory,
      active_low_risk: active,
    };
    const enabled = enabledByStage[input.stage];
    return Object.freeze({
      stage: input.stage,
      enabled,
      reason: enabled
        ? `Rollout stage ${input.stage} passed all prior deterministic gates.`
        : `Rollout stage ${input.stage} is disabled by flags, risk, review, or a prior gate.`,
      effectiveInjectionMode: flags.injectionMode,
    });
  }
}
