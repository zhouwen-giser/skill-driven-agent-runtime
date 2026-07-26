import {
  createPlanningKnowledgeBundle,
  createKnowledgeIndexEntry,
  type ActiveKnowledgeDefinition,
  type ExactSkillKnowledgeDetail,
  type KnowledgeIndexEntry,
  type KnowledgeRelation,
  type PlanningKnowledgeBundle,
} from '../../../domain/src/index.js';
import type { FusedKnowledgeHit } from './knowledge-retrieval-ports.js';

const KIND_LIMITS = {
  task_type: 3,
  capability_pattern: 8,
  planning_heuristic: 8,
} as const;

export class PlanningContextBudget {
  readonly #maximumCharacters: number;
  readonly #maximumIndexCharacters: number;

  constructor(
    options: Readonly<{
      maximumCharacters?: number;
      maximumIndexCharacters?: number;
    }> = {},
  ) {
    this.#maximumCharacters = options.maximumCharacters ?? 20_000;
    this.#maximumIndexCharacters = options.maximumIndexCharacters ?? 8_000;
    if (
      !Number.isSafeInteger(this.#maximumCharacters) ||
      this.#maximumCharacters < 1 ||
      this.#maximumCharacters > 20_000 ||
      !Number.isSafeInteger(this.#maximumIndexCharacters) ||
      this.#maximumIndexCharacters < 1 ||
      this.#maximumIndexCharacters > this.#maximumCharacters
    ) {
      throw new Error('KNOWLEDGE_CONTEXT_BUDGET_INVALID');
    }
  }

  apply(
    input: Readonly<{
      queryFingerprint: string;
      ranked: readonly FusedKnowledgeHit[];
      exactSkills: readonly ExactSkillKnowledgeDetail[];
      conflicts: readonly KnowledgeRelation[];
      elapsedMs: number;
    }>,
  ): PlanningKnowledgeBundle {
    const skills = new Map<string, ExactSkillKnowledgeDetail>(
      input.exactSkills.map(
        (skill) => [`${skill.skillId}:${String(skill.version)}`, skill] as const,
      ),
    );
    const eligible = input.ranked.filter((item) =>
      item.entry.exactSkillVersionRefs.every((reference) => skills.has(reference)),
    );
    const index: KnowledgeIndexEntry[] = [];
    for (const item of eligible) {
      const candidate = createKnowledgeIndexEntry(indexView(item.entry));
      if (characters([...index, candidate]) > this.#maximumIndexCharacters) continue;
      index.push(candidate);
    }
    const definitions: ActiveKnowledgeDefinition[] = [];
    const counts = { task_type: 0, capability_pattern: 0, planning_heuristic: 0 };
    for (const item of eligible) {
      if (!index.some((entry) => entry.authoritativeRef === item.entry.authoritativeRef)) continue;
      if (counts[item.entry.kind] >= KIND_LIMITS[item.entry.kind]) continue;
      if (contextCharacters(index, [...definitions, item.entry], [], []) > this.#maximumCharacters)
        continue;
      definitions.push(item.entry);
      counts[item.entry.kind] += 1;
    }
    const referencedSkills = new Set(
      definitions.flatMap((definition) => definition.exactSkillVersionRefs),
    );
    const exactSkills: ExactSkillKnowledgeDetail[] = [];
    for (const skill of input.exactSkills) {
      const reference = `${skill.skillId}:${String(skill.version)}`;
      if (!referencedSkills.has(reference)) continue;
      if (
        contextCharacters(index, definitions, [...exactSkills, skill], []) > this.#maximumCharacters
      )
        continue;
      exactSkills.push(skill);
    }
    const includedSkillRefs = new Set(
      exactSkills.map((skill) => `${skill.skillId}:${String(skill.version)}`),
    );
    const disclosedDefinitions = definitions.filter((definition) =>
      definition.exactSkillVersionRefs.every((reference) => includedSkillRefs.has(reference)),
    );
    const disclosedSkillRefs = new Set(
      disclosedDefinitions.flatMap((definition) => definition.exactSkillVersionRefs),
    );
    const disclosedExactSkills = exactSkills.filter((skill) =>
      disclosedSkillRefs.has(`${skill.skillId}:${String(skill.version)}`),
    );
    const conflicts: KnowledgeRelation[] = [];
    for (const conflict of input.conflicts) {
      if (
        contextCharacters(index, disclosedDefinitions, disclosedExactSkills, [
          ...conflicts,
          conflict,
        ]) > this.#maximumCharacters
      )
        continue;
      conflicts.push(conflict);
    }
    const characterCount = contextCharacters(
      index,
      disclosedDefinitions,
      disclosedExactSkills,
      conflicts,
    );
    const disclosureOrder = [
      ...index.map((item) => item.authoritativeRef),
      ...disclosedDefinitions.map((item) => `detail:${item.authoritativeRef}`),
      ...disclosedExactSkills.map((item) => `skill:${item.skillId}:${String(item.version)}`),
    ];
    return createPlanningKnowledgeBundle({
      schemaVersion: '1.0',
      queryFingerprint: input.queryFingerprint,
      index,
      definitions: disclosedDefinitions,
      exactSkills: disclosedExactSkills,
      conflicts,
      disclosureOrder,
      characterCount,
      truncated:
        eligible.length !== input.ranked.length ||
        disclosedDefinitions.length !== eligible.length ||
        disclosedExactSkills.length !== referencedSkills.size ||
        conflicts.length !== input.conflicts.length,
      elapsedMs: input.elapsedMs,
    });
  }
}

function indexView(entry: ActiveKnowledgeDefinition) {
  return {
    schemaVersion: '1.0' as const,
    kind: entry.kind,
    knowledgeId: entry.knowledgeId,
    revision: entry.revision,
    authoritativeRef: entry.authoritativeRef,
    title: entry.title,
    summary: entry.summary,
    risk: entry.risk,
  };
}

function characters(value: unknown): number {
  return JSON.stringify(value).length;
}

function contextCharacters(
  index: readonly KnowledgeIndexEntry[],
  definitions: readonly ActiveKnowledgeDefinition[],
  exactSkills: readonly ExactSkillKnowledgeDetail[],
  conflicts: readonly KnowledgeRelation[],
): number {
  return characters({ index, definitions, exactSkills, conflicts });
}
