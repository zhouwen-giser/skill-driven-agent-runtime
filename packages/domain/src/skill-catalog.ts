import { createSkillVersion, type SkillStatus, type SkillVersion } from './skill.js';
import { createLegacySkillUsageProjection, createSkillUsageSpecification } from './skill-usage.js';
import type {
  SKILL_USAGE_API_VERSION,
  SkillExecutionMode,
  SkillUsageSpecSource,
  SkillVisibility,
} from './skill-usage.js';

export type SkillLifecycleProjection =
  'draft' | 'validating' | 'active' | 'inactive' | 'deprecated' | 'validation_failed';

export interface SkillUsageSummary {
  readonly source: SkillUsageSpecSource;
  readonly apiVersion: typeof SKILL_USAGE_API_VERSION;
  readonly visibility: SkillVisibility;
  readonly supportedModes: readonly SkillExecutionMode[];
  readonly defaultMode: SkillExecutionMode;
  readonly taskTypes: readonly string[];
  readonly hasComposition: boolean;
  readonly requiredContextCount: number;
  readonly requiredEvidenceCount: number;
}

export interface SkillCatalogVersionSnapshot {
  readonly skillId: string;
  readonly version: number;
  readonly current: boolean;
  readonly name: string;
  readonly summary: string;
  readonly capabilities: readonly string[];
  /** Derived from the first dot, colon or slash-delimited capability segment. */
  readonly domains: readonly string[];
  /** Exact capabilities are the existing catalog classification tags. */
  readonly tags: readonly string[];
  readonly status: SkillStatus;
  readonly lifecycle: SkillLifecycleProjection;
  readonly usage: SkillUsageSummary;
  readonly createdAt: string;
}

export interface SkillCatalogFilter {
  readonly lifecycle?: SkillLifecycleProjection;
  readonly visibility?: Partial<SkillVisibility>;
  readonly mode?: SkillExecutionMode;
  readonly domain?: string;
  readonly tag?: string;
}

export function createSkillUsageSummary(version: SkillVersion): SkillUsageSummary {
  const resolved =
    version.usageSpecification === undefined
      ? createLegacySkillUsageProjection({
          workflowGuidance: version.workflowGuidance,
          autoConfirmPlan: version.runtimePolicy.autoConfirmPlan,
        })
      : {
          source: 'native' as const,
          specification: createSkillUsageSpecification(version.usageSpecification),
        };
  const specification = resolved.specification;
  return Object.freeze({
    source: resolved.source,
    apiVersion: specification.apiVersion,
    visibility: Object.freeze({ ...specification.visibility }),
    supportedModes: Object.freeze([...specification.modes.supported]),
    defaultMode: specification.modes.defaultMode,
    taskTypes: Object.freeze([...new Set(specification.taskBindings.map((item) => item.taskType))]),
    hasComposition: specification.composition !== undefined,
    requiredContextCount: specification.contextRequirements.filter((item) => item.required).length,
    requiredEvidenceCount: specification.evidencePolicy.requirements.filter((item) => item.required)
      .length,
  });
}

export function createSkillCatalogVersionSnapshot(
  version: SkillVersion,
  current: boolean,
): SkillCatalogVersionSnapshot {
  const exact = createSkillVersion(version);
  const tags = [...new Set(exact.capabilities)];
  const domains = [
    ...new Set(
      tags.map((capability) => {
        const separator = capability.search(/[.:/]/u);
        return separator === -1 ? capability : capability.slice(0, separator);
      }),
    ),
  ];
  return Object.freeze({
    skillId: exact.skillId,
    version: exact.version,
    current,
    name: exact.name,
    summary: exact.summary,
    capabilities: Object.freeze([...exact.capabilities]),
    domains: Object.freeze(domains),
    tags: Object.freeze(tags),
    status: exact.status,
    lifecycle: projectSkillLifecycle(exact.status),
    usage: createSkillUsageSummary(exact),
    createdAt: exact.createdAt,
  });
}

export function matchesSkillCatalogFilter(
  snapshot: SkillCatalogVersionSnapshot,
  filter: SkillCatalogFilter,
): boolean {
  if (filter.lifecycle !== undefined && snapshot.lifecycle !== filter.lifecycle) return false;
  if (filter.mode !== undefined && !snapshot.usage.supportedModes.includes(filter.mode))
    return false;
  if (filter.domain !== undefined && !snapshot.domains.includes(filter.domain)) return false;
  if (filter.tag !== undefined && !snapshot.tags.includes(filter.tag)) return false;
  const visibility = filter.visibility;
  if (visibility === undefined) return true;
  return (['userSelectable', 'composable', 'internalOnly'] as const).every(
    (field) =>
      visibility[field] === undefined || snapshot.usage.visibility[field] === visibility[field],
  );
}

export function projectSkillLifecycle(status: SkillStatus): SkillLifecycleProjection {
  switch (status) {
    case 'draft':
    case 'validating':
    case 'deprecated':
    case 'validation_failed':
      return status;
    case 'enabled':
      return 'active';
    case 'disabled':
      return 'inactive';
  }
}
