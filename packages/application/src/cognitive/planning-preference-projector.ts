import type {
  PlanningCorrectionFact,
  PlanningPreferenceCategory,
} from '../../../domain/src/index.js';

const FORBIDDEN_TYPES = new Set<PlanningCorrectionFact['correctionType']>([
  'unsafe_side_effect',
  'degradation_correction',
]);

const LOW_RISK_CATEGORIES = new Set<PlanningPreferenceCategory>([
  'display',
  'interaction',
  'report_format',
  'detailed_plan',
  'parallel_explanation',
  'time_expression',
  'language',
]);

interface ScopedMemoryProjection {
  readonly memoryId: string;
  readonly status: 'active' | 'superseded' | 'invalid';
  readonly scope?: 'global' | 'user';
  readonly userId?: string;
}

interface ScopedMemoryProjectionService {
  create(
    input: Readonly<Record<string, unknown>> & { readonly memoryId?: string },
  ): Promise<ScopedMemoryProjection>;
  get(memoryId: string): Promise<ScopedMemoryProjection>;
  invalidate(memoryId: string, actor: string, reason: string): Promise<void>;
}

export class PlanningPreferenceProjector {
  readonly #memories: ScopedMemoryProjectionService;

  constructor(dependencies: Readonly<{ memories: ScopedMemoryProjectionService }>) {
    this.#memories = dependencies.memories;
  }

  async projectLowRisk(fact: PlanningCorrectionFact): Promise<ScopedMemoryProjection | undefined> {
    if (
      !fact.accepted ||
      fact.scope !== 'user' ||
      fact.userId === undefined ||
      fact.preferenceCategory === undefined ||
      !LOW_RISK_CATEGORIES.has(fact.preferenceCategory) ||
      FORBIDDEN_TYPES.has(fact.correctionType)
    ) {
      return undefined;
    }
    const memoryId = memoryIdFor(fact.correctionId);
    try {
      return await this.#memories.get(memoryId);
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error;
    }
    return this.#memories.create({
      memoryId,
      type: 'fact',
      content: {
        kind: 'user_planning_preference',
        category: fact.preferenceCategory,
        instruction: fact.userInstruction,
        correctionType: fact.correctionType,
      },
      summary: fact.userInstruction,
      sourceRefs: [`planning-correction:${fact.correctionId}`],
      confidence: 1,
      durability: 'durable',
      authority: 'user_instruction',
      durabilityReason: 'Explicit low-risk user planning preference.',
      scope: 'user',
      userId: fact.userId,
    });
  }

  async deleteUserScope(
    userId: string,
    facts: readonly PlanningCorrectionFact[],
    actorId: string,
  ): Promise<number> {
    let deleted = 0;
    for (const fact of facts) {
      if (fact.scope !== 'user' || fact.userId !== userId) continue;
      const memoryId = memoryIdFor(fact.correctionId);
      let current: ScopedMemoryProjection;
      try {
        current = await this.#memories.get(memoryId);
      } catch (error: unknown) {
        if (isNotFound(error)) continue;
        throw error;
      }
      if (current.status === 'invalid') continue;
      await this.#memories.invalidate(
        memoryId,
        actorId,
        `User-scoped planning preference deletion requested for ${userId}.`,
      );
      deleted += 1;
    }
    return deleted;
  }
}

function memoryIdFor(correctionId: string): string {
  return `planning-preference-${correctionId}`;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /MEMORY_NOT_FOUND|Memory not found/u.test(error.message);
}
