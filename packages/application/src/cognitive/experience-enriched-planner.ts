import {
  createExperienceUsageRecord,
  type CognitiveInjectionMode,
  type ExperienceUsageRecord,
  type Goal,
  type PlanningKnowledgeBundle,
  type UserGoalCompletionContract,
  type UserGoalPlan,
} from '../../../domain/src/index.js';
import type { UserGoalPlanningService } from '../user-goal-planning.js';
import type { PlanningExperienceContext } from './planning-experience-context-builder.js';

export type ExperienceFallbackReason =
  | 'repository_failed'
  | 'timeout'
  | 'conflict'
  | 'low_confidence'
  | 'knowledge_risk_not_low'
  | 'enhanced_plan_invalid';

export interface ExperiencePlanningResult {
  readonly contract: UserGoalCompletionContract;
  readonly plan: UserGoalPlan;
  readonly mode: CognitiveInjectionMode;
  readonly selected: 'base' | 'experience';
  readonly requiresManualConfirmation: boolean;
  readonly usageRecords: readonly ExperienceUsageRecord[];
  readonly fallbackReason?: ExperienceFallbackReason;
  readonly shadow?: Readonly<{ planHash: string }>;
}

export class BasePlannerFallbackPolicy {
  shouldFallback(
    input:
      | Readonly<{ error: unknown }>
      | Readonly<{ bundle: PlanningKnowledgeBundle; mode: CognitiveInjectionMode }>,
  ): ExperienceFallbackReason | undefined {
    if ('error' in input) {
      return input.error instanceof PlanningExperienceTimeoutError
        ? 'timeout'
        : 'repository_failed';
    }
    if (input.bundle.conflicts.length > 0) return 'conflict';
    if (input.bundle.definitions.length === 0) return 'low_confidence';
    if (
      input.mode === 'active_low_risk' &&
      input.bundle.definitions.some((definition) => definition.risk !== 'low')
    ) {
      return 'knowledge_risk_not_low';
    }
    return undefined;
  }
}

export class ExperienceEnrichedUserGoalPlanningService {
  readonly #base: Pick<UserGoalPlanningService, 'generateCandidate'>;
  readonly #contexts: Readonly<{
    build(input: ExperiencePlanningInput): Promise<PlanningExperienceContext>;
  }>;
  readonly #fallback: BasePlannerFallbackPolicy;
  readonly #timeoutMs: number;

  constructor(
    dependencies: Readonly<{
      base: Pick<UserGoalPlanningService, 'generateCandidate'>;
      contexts: Readonly<{
        build(input: ExperiencePlanningInput): Promise<PlanningExperienceContext>;
      }>;
      fallback: BasePlannerFallbackPolicy;
      timeoutMs?: number;
    }>,
  ) {
    this.#base = dependencies.base;
    this.#contexts = dependencies.contexts;
    this.#fallback = dependencies.fallback;
    this.#timeoutMs = dependencies.timeoutMs ?? 500;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 10_000) {
      throw new Error('EXPERIENCE_PLANNING_TIMEOUT_INVALID');
    }
  }

  async plan(input: ExperiencePlanningInput): Promise<ExperiencePlanningResult> {
    if (input.mode === 'off') return this.#baseResult(await this.#generateBase(input), input.mode);
    if (input.mode === 'shadow') return this.#shadow(input);
    let context: PlanningExperienceContext;
    try {
      context = await withTimeout(this.#contexts.build(input), this.#timeoutMs);
    } catch (error: unknown) {
      return this.#fallbackToBase(input, this.#fallback.shouldFallback({ error }));
    }
    const fallbackReason = this.#fallback.shouldFallback({
      bundle: context.bundle,
      mode: input.mode,
    });
    if (fallbackReason !== undefined) return this.#fallbackToBase(input, fallbackReason, context);
    try {
      const enriched = await this.#base.generateCandidate({
        goal: input.goal,
        taskId: input.taskId,
        planningContext: context.bundle,
      });
      return Object.freeze({
        ...enriched,
        mode: input.mode,
        selected: 'experience' as const,
        requiresManualConfirmation: input.mode === 'advisory',
        usageRecords: usageForPlan(context.usageRecords, enriched.plan),
      });
    } catch {
      return this.#fallbackToBase(input, 'enhanced_plan_invalid', context);
    }
  }

  async #shadow(input: ExperiencePlanningInput): Promise<ExperiencePlanningResult> {
    const base = await this.#generateBase(input);
    let context: PlanningExperienceContext;
    try {
      context = await withTimeout(this.#contexts.build(input), this.#timeoutMs);
    } catch (error: unknown) {
      return this.#baseResult(base, input.mode, this.#fallback.shouldFallback({ error }));
    }
    const fallbackReason = this.#fallback.shouldFallback({
      bundle: context.bundle,
      mode: input.mode,
    });
    if (fallbackReason !== undefined) {
      return this.#baseResult(base, input.mode, fallbackReason, context);
    }
    try {
      const shadow = await this.#base.generateCandidate({
        goal: input.goal,
        taskId: input.taskId,
        planningContext: context.bundle,
      });
      return Object.freeze({
        ...base,
        mode: input.mode,
        selected: 'base' as const,
        requiresManualConfirmation: false,
        usageRecords: usageForPlan(context.usageRecords, shadow.plan, {
          shadowPlanHash: shadow.plan.contentHash,
        }),
        shadow: Object.freeze({ planHash: shadow.plan.contentHash }),
      });
    } catch {
      return this.#baseResult(base, input.mode, 'enhanced_plan_invalid', context);
    }
  }

  async #fallbackToBase(
    input: ExperiencePlanningInput,
    reason: ExperienceFallbackReason | undefined,
    context?: PlanningExperienceContext,
  ): Promise<ExperiencePlanningResult> {
    const base = await this.#generateBase(input);
    return this.#baseResult(base, input.mode, reason, context);
  }

  #baseResult(
    generated: Awaited<ReturnType<UserGoalPlanningService['generateCandidate']>>,
    mode: CognitiveInjectionMode,
    fallbackReason?: ExperienceFallbackReason,
    context?: PlanningExperienceContext,
  ): ExperiencePlanningResult {
    return Object.freeze({
      ...generated,
      mode,
      selected: 'base' as const,
      requiresManualConfirmation: false,
      usageRecords:
        context === undefined
          ? Object.freeze([])
          : usageWithoutPlan(context.usageRecords, {
              ...(fallbackReason === undefined ? {} : { fallbackReason }),
            }),
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
    });
  }

  #generateBase(
    input: ExperiencePlanningInput,
  ): ReturnType<UserGoalPlanningService['generateCandidate']> {
    return this.#base.generateCandidate({ goal: input.goal, taskId: input.taskId });
  }
}

export interface ExperiencePlanningInput {
  readonly mode: CognitiveInjectionMode;
  readonly taskId: string;
  readonly userId: string;
  readonly planningSessionId: string;
  readonly planCandidateId: string;
  readonly catalogHash?: string;
  readonly promotionPolicyVersion: string;
  readonly goal: Goal;
}

function usageForPlan(
  records: readonly ExperienceUsageRecord[],
  plan: UserGoalPlan,
  influence: Readonly<Record<string, unknown>> = {},
): readonly ExperienceUsageRecord[] {
  const affectedSkillGoalIds = plan.skillGoals.map((skillGoal) => skillGoal.skillGoalId);
  return Object.freeze(
    records.map((record) =>
      createExperienceUsageRecord({
        ...record,
        affectedSkillGoalIds,
        influence: { ...record.influence, ...influence, affectedSkillGoalIds },
      }),
    ),
  );
}

function usageWithoutPlan(
  records: readonly ExperienceUsageRecord[],
  influence: Readonly<Record<string, unknown>>,
): readonly ExperienceUsageRecord[] {
  return Object.freeze(
    records.map((record) =>
      createExperienceUsageRecord({
        ...record,
        affectedSkillGoalIds: [],
        influence: { ...record.influence, ...influence, affectedSkillGoalIds: [] },
      }),
    ),
  );
}

class PlanningExperienceTimeoutError extends Error {
  constructor() {
    super('EXPERIENCE_PLANNING_TIMEOUT');
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new PlanningExperienceTimeoutError());
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
