import { createHash } from 'node:crypto';

import {
  COGNITIVE_SCHEMA_VERSION,
  createCognitiveSourceRef,
  createRuntimeCapabilitySummarySnapshot,
  type CapabilityLimitation,
  type CapabilityLimitationReason,
  type RuntimeCapabilitySummaryItem,
  type RuntimeCapabilitySummarySnapshot,
  type SkillVersion,
} from '../../../domain/src/index.js';

export interface CapabilitySummaryBuildInput {
  readonly summaryId: string;
  readonly revision: number;
  readonly generationPolicyVersion: string;
  readonly skillVersions: readonly SkillVersion[];
  readonly builtAt: string;
}

export interface CapabilityCatalogSnapshot {
  readonly exactSkillVersionRefs: readonly string[];
  readonly canonicalJson: string;
  readonly catalogHash: string;
}

interface MutableCapabilityAggregate {
  readonly capabilityId: string;
  readonly domain: string;
  readonly descriptions: Set<string>;
  readonly effects: Set<string>;
  readonly evidence: Set<string>;
  readonly artifacts: Set<string>;
  readonly contexts: Set<string>;
  readonly modes: Set<string>;
  readonly taskTypes: Set<string>;
  readonly composition: Set<string>;
  readonly limitations: Map<CapabilityLimitationReason, string>;
  readonly exactSkillVersionRefs: Set<string>;
  public: boolean;
}

export class CapabilityCatalogSnapshotBuilder {
  build(skillVersions: readonly SkillVersion[]): CapabilityCatalogSnapshot {
    const declarations = normalizedCatalogDeclarations(skillVersions);
    const json = canonicalJson(declarations);
    return Object.freeze({
      exactSkillVersionRefs: Object.freeze(
        [...skillVersions].sort(compareSkillVersions).map(skillVersionRef),
      ),
      canonicalJson: json,
      catalogHash: hashCanonicalJson(json),
    });
  }
}

export class CapabilitySummaryBuilder {
  readonly #catalogBuilder = new CapabilityCatalogSnapshotBuilder();

  build(input: CapabilitySummaryBuildInput): RuntimeCapabilitySummarySnapshot {
    const catalogHash = this.#catalogBuilder.build(input.skillVersions).catalogHash;
    const aggregates = new Map<string, MutableCapabilityAggregate>();

    for (const skill of [...input.skillVersions].sort(compareSkillVersions)) {
      assertEnabledExactSkill(skill);
      const skillRef = `${skill.skillId}:${String(skill.version)}`;
      for (const capabilityId of [...skill.capabilities].sort()) {
        const aggregate =
          aggregates.get(capabilityId) ?? createMutableAggregate(capabilityId, skill.summary);
        aggregate.descriptions.add(skill.summary.trim());
        aggregate.exactSkillVersionRefs.add(skillRef);
        const usage = skill.usageSpecification;
        const outcome = skill.outcomeSpecification;
        for (const effect of outcome?.effects ?? []) aggregate.effects.add(effect);
        for (const evidence of outcome?.evidence ?? []) aggregate.evidence.add(evidence);
        for (const artifact of outcome?.artifacts ?? []) aggregate.artifacts.add(artifact);
        for (const context of usage?.contextRequirements ?? []) {
          aggregate.contexts.add(context.requirementId);
        }
        for (const mode of usage?.modes.supported ?? []) aggregate.modes.add(mode);
        for (const binding of usage?.taskBindings ?? []) aggregate.taskTypes.add(binding.taskType);
        for (const dependency of usage?.composition?.fixedDependencies ?? []) {
          aggregate.composition.add(
            `skill:${dependency.skillId}:${dependency.skillVersion === undefined ? 'current' : String(dependency.skillVersion)}`,
          );
        }
        for (const slot of usage?.composition?.capabilitySlots ?? []) {
          aggregate.composition.add(`capability:${slot.capability}`);
        }
        if (outcome === undefined) {
          aggregate.limitations.set(
            'missing_outcome_specification',
            `Enabled Skill ${skillRef} has no Outcome Specification.`,
          );
        }
        if (usage === undefined || usage.visibility.internalOnly) {
          aggregate.limitations.set(
            'internal_only',
            `Capability includes Skill ${skillRef} that is not declared public.`,
          );
        } else {
          aggregate.public = true;
        }
        if ((usage?.normative.requiredConfirmations.length ?? 0) > 0) {
          aggregate.limitations.set(
            'confirmation_required',
            `Capability includes Skill ${skillRef} with required confirmations.`,
          );
        }
        if (usage?.visibility.composable !== true) {
          aggregate.limitations.set(
            'not_composable',
            `Capability includes Skill ${skillRef} that is not composable.`,
          );
        }
        aggregates.set(capabilityId, aggregate);
      }
    }

    if (aggregates.size === 0) {
      const empty = createMutableAggregate(
        'runtime.catalog',
        'No enabled Skill declaration is available.',
      );
      empty.limitations.set(
        'no_enabled_skill',
        'The current catalog has no enabled Skill version.',
      );
      aggregates.set(empty.capabilityId, empty);
    }

    const items = [...aggregates.values()]
      .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
      .map(freezeAggregate);
    const sourceRefs = [...input.skillVersions].sort(compareSkillVersions).map((skill) => {
      const declaration = normalizeSkillDeclaration(skill);
      const declarationHash = hashCanonical(declaration);
      return createCognitiveSourceRef({
        schemaVersion: COGNITIVE_SCHEMA_VERSION,
        sourceRefId: `source.skill.${declarationHash.slice('sha256:'.length, 'sha256:'.length + 32)}`,
        sourceKind: 'skill_version',
        sourceId: skill.skillId,
        sourceRevision: skill.version,
        authority: 'skill_declaration',
        dataClassification: 'internal',
        capturedAt: skill.createdAt,
        contentHash: declarationHash,
      });
    });

    return createRuntimeCapabilitySummarySnapshot({
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      summaryId: input.summaryId,
      revision: input.revision,
      catalogHash,
      generationPolicyVersion: input.generationPolicyVersion,
      status: 'building',
      items,
      sourceRefs,
      builtAt: input.builtAt,
    });
  }

  catalogHash(skillVersions: readonly SkillVersion[]): string {
    return this.#catalogBuilder.build(skillVersions).catalogHash;
  }
}

function normalizedCatalogDeclarations(skillVersions: readonly SkillVersion[]): readonly unknown[] {
  const refs = new Set<string>();
  return [...skillVersions].sort(compareSkillVersions).map((skill) => {
    assertEnabledExactSkill(skill);
    const ref = `${skill.skillId}:${String(skill.version)}`;
    if (refs.has(ref)) throw new Error(`CAPABILITY_CATALOG_DUPLICATE_SKILL_VERSION:${ref}`);
    refs.add(ref);
    return normalizeSkillDeclaration(skill);
  });
}

function normalizeSkillDeclaration(skill: SkillVersion): Readonly<Record<string, unknown>> {
  return {
    skillId: skill.skillId,
    version: skill.version,
    name: skill.name,
    summary: skill.summary,
    description: skill.description,
    capabilities: [...skill.capabilities].sort(),
    workflowGuidance: skill.workflowGuidance,
    outputInstruction: skill.outputInstruction,
    inputSchema: skill.inputSchema,
    outputSchema: skill.outputSchema,
    toolPolicy: skill.toolPolicy,
    runtimePolicy: skill.runtimePolicy,
    status: skill.status,
    sourceKind: skill.sourceKind,
    validationPassed: skill.validationPassed,
    previousVersion: skill.previousVersion ?? null,
    usageSpecification: skill.usageSpecification ?? null,
    outcomeSpecification:
      skill.outcomeSpecification === undefined
        ? null
        : {
            ...skill.outcomeSpecification,
            effects: [...skill.outcomeSpecification.effects].sort(),
            evidence: [...skill.outcomeSpecification.evidence].sort(),
            artifacts: [...skill.outcomeSpecification.artifacts].sort(),
          },
  };
}

function createMutableAggregate(
  capabilityId: string,
  description: string,
): MutableCapabilityAggregate {
  return {
    capabilityId,
    domain: capabilityDomain(capabilityId),
    descriptions: new Set([description.trim()]),
    effects: new Set(),
    evidence: new Set(),
    artifacts: new Set(),
    contexts: new Set(),
    modes: new Set(),
    taskTypes: new Set(),
    composition: new Set(),
    limitations: new Map(),
    exactSkillVersionRefs: new Set(),
    public: false,
  };
}

function freezeAggregate(aggregate: MutableCapabilityAggregate): RuntimeCapabilitySummaryItem {
  const limitations: readonly CapabilityLimitation[] = [...aggregate.limitations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reasonCode, detail]) => ({
      limitationId: limitationId(aggregate.capabilityId, reasonCode),
      reasonCode,
      detail,
    }));
  return {
    capabilityId: aggregate.capabilityId,
    domain: aggregate.domain,
    title: aggregate.capabilityId,
    shortDescription: boundedDescription([...aggregate.descriptions].sort().join(' / ')),
    public: aggregate.public,
    effects: sorted(aggregate.effects),
    evidence: sorted(aggregate.evidence),
    artifacts: sorted(aggregate.artifacts),
    contexts: sorted(aggregate.contexts),
    modes: sorted(aggregate.modes),
    taskTypes: sorted(aggregate.taskTypes),
    composition: sorted(aggregate.composition),
    limitations,
    exactSkillVersionRefs: sorted(aggregate.exactSkillVersionRefs),
  };
}

function capabilityDomain(capabilityId: string): string {
  const candidate = capabilityId.split(/[.:]/u)[0] ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(candidate) ? candidate : 'general';
}

function limitationId(capabilityId: string, reason: CapabilityLimitationReason): string {
  return `limitation.${createHash('sha256').update(`${capabilityId}:${reason}`).digest('hex').slice(0, 24)}`;
}

function boundedDescription(value: string): string {
  return value.length <= 2048 ? value : `${value.slice(0, 2045)}...`;
}

function sorted(values: ReadonlySet<string>): readonly string[] {
  return [...values].sort();
}

function compareSkillVersions(left: SkillVersion, right: SkillVersion): number {
  return left.skillId.localeCompare(right.skillId) || left.version - right.version;
}

function skillVersionRef(skill: SkillVersion): string {
  return `${skill.skillId}:${String(skill.version)}`;
}

function assertEnabledExactSkill(skill: SkillVersion): void {
  if (skill.status !== 'enabled' || !skill.validationPassed) {
    throw new Error(
      `CAPABILITY_CATALOG_SKILL_NOT_ENABLED:${skill.skillId}:${String(skill.version)}`,
    );
  }
}

function hashCanonical(value: unknown): string {
  return hashCanonicalJson(canonicalJson(value));
}

function hashCanonicalJson(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
