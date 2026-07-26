import { createHash } from 'node:crypto';

import {
  createCognitiveSourceRef,
  type CapabilityPatternEvidenceSnapshot,
  type CapabilitySkillVersionMapping,
  type CognitiveSourceRef,
  type SkillVersion,
} from '../../../domain/src/index.js';
import { CapabilityCatalogSnapshotBuilder } from './capability-summary-builder.js';
import type { CapabilityCatalogSource } from './ports.js';

export interface CapabilitySkillMappingResult {
  readonly catalogHash: string;
  readonly exactSkillVersionMappings: readonly CapabilitySkillVersionMapping[];
  readonly declaredEvidence: readonly CapabilityPatternEvidenceSnapshot[];
  readonly declaredSignals: Readonly<{
    effects: readonly string[];
    evidenceRequirements: readonly string[];
    artifacts: readonly string[];
  }>;
  readonly sourceRefs: readonly CognitiveSourceRef[];
}

export class CapabilitySkillMapper {
  readonly #catalog: CapabilityCatalogSource;
  readonly #catalogBuilder = new CapabilityCatalogSnapshotBuilder();

  constructor(dependencies: Readonly<{ catalog: CapabilityCatalogSource }>) {
    this.#catalog = dependencies.catalog;
  }

  async mapCurrentVersions(capabilityId: string): Promise<CapabilitySkillMappingResult> {
    const skills = await this.#catalog.listEnabledSkillVersions();
    const catalogHash = this.#catalogBuilder.build(skills).catalogHash;
    const matching = [...skills]
      .filter((skill) => skill.capabilities.includes(capabilityId))
      .sort(compareSkills);
    const sourceRefs = matching.map(sourceRef);
    return Object.freeze({
      catalogHash,
      exactSkillVersionMappings: Object.freeze(
        matching.map((skill) =>
          Object.freeze({
            exactSkillVersionRef: exactRef(skill),
            mappingBasis: 'declared_capability' as const,
            requiresCurrentReadiness: true as const,
            compatibilityStatus: 'requires_current_check' as const,
          }),
        ),
      ),
      declaredEvidence: Object.freeze(
        matching.map((skill, index) =>
          Object.freeze({
            level: 'declared' as const,
            exactSkillVersionRef: exactRef(skill),
            summary: `Current Skill declaration ${exactRef(skill)} declares ${capabilityId}.`,
            sourceRefIds: Object.freeze([sourceRefs[index]?.sourceRefId ?? 'source.missing']),
          }),
        ),
      ),
      declaredSignals: Object.freeze({
        effects: unique(matching.flatMap((skill) => skill.outcomeSpecification?.effects ?? [])),
        evidenceRequirements: unique(
          matching.flatMap((skill) => skill.outcomeSpecification?.evidence ?? []),
        ),
        artifacts: unique(matching.flatMap((skill) => skill.outcomeSpecification?.artifacts ?? [])),
      }),
      sourceRefs: Object.freeze(sourceRefs),
    });
  }
}

function sourceRef(skill: SkillVersion): CognitiveSourceRef {
  const fingerprint = createHash('sha256').update(exactRef(skill)).digest('hex').slice(0, 32);
  return createCognitiveSourceRef({
    schemaVersion: '1.0',
    sourceRefId: `source.skill.${fingerprint}`,
    sourceKind: 'skill_version',
    sourceId: skill.skillId,
    sourceRevision: skill.version,
    authority: 'skill_declaration',
    dataClassification: 'internal',
    capturedAt: skill.createdAt,
  });
}

function exactRef(skill: SkillVersion): string {
  return `${skill.skillId}:${String(skill.version)}`;
}

function compareSkills(left: SkillVersion, right: SkillVersion): number {
  return left.skillId.localeCompare(right.skillId) || left.version - right.version;
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}
