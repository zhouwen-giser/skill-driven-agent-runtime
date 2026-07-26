import {
  createExactSkillKnowledgeDetail,
  type ExactSkillKnowledgeDetail,
} from '../../../domain/src/index.js';
import type { SkillRepository } from '../ports.js';
import type { ExactSkillKnowledgeSource } from './knowledge-retrieval-ports.js';

export class CurrentExactSkillKnowledgeSource implements ExactSkillKnowledgeSource {
  readonly #skills: Pick<SkillRepository, 'findCurrentVersion'>;

  constructor(skills: Pick<SkillRepository, 'findCurrentVersion'>) {
    this.#skills = skills;
  }

  async loadCurrentExact(
    exactSkillVersionRefs: readonly string[],
  ): Promise<readonly ExactSkillKnowledgeDetail[]> {
    const parsed = [...new Set(exactSkillVersionRefs)].map(parseExactReference);
    const loaded = await Promise.all(
      parsed.map(async (reference) => ({
        reference,
        skill: await this.#skills.findCurrentVersion(reference.skillId),
      })),
    );
    return Object.freeze(
      loaded.flatMap(({ reference, skill }) =>
        skill?.version !== reference.version || skill.status !== 'enabled'
          ? []
          : [
              createExactSkillKnowledgeDetail({
                skillId: skill.skillId,
                version: skill.version,
                name: skill.name,
                summary: skill.summary,
                status: 'enabled',
                declaration: {
                  description: skill.description,
                  capabilities: skill.capabilities,
                  workflowGuidance: skill.workflowGuidance,
                  outputInstruction: skill.outputInstruction,
                  inputSchema: skill.inputSchema,
                  outputSchema: skill.outputSchema,
                  toolPolicy: skill.toolPolicy,
                  runtimePolicy: skill.runtimePolicy,
                  sourceKind: skill.sourceKind,
                  validationPassed: skill.validationPassed,
                  ...(skill.usageSpecification === undefined
                    ? {}
                    : { usageSpecification: skill.usageSpecification }),
                  ...(skill.outcomeSpecification === undefined
                    ? {}
                    : { outcomeSpecification: skill.outcomeSpecification }),
                },
              }),
            ],
      ),
    );
  }
}

function parseExactReference(value: string): Readonly<{ skillId: string; version: number }> {
  const separator = value.lastIndexOf(':');
  const skillId = value.slice(0, separator);
  const version = Number(value.slice(separator + 1));
  if (
    separator < 1 ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    skillId.trim().length === 0
  ) {
    throw new Error('KNOWLEDGE_EXACT_SKILL_REFERENCE_INVALID');
  }
  return Object.freeze({ skillId, version });
}
