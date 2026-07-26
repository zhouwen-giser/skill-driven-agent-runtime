import type { PromotionCandidateRecord, PromotionTarget } from './promotion-ports.js';

export class PlanningHeuristicPromotionTarget implements PromotionTarget {
  readonly kind = 'planning_heuristic' as const;

  validate(candidate: PromotionCandidateRecord): readonly string[] {
    return candidate.kind === this.kind ? [] : ['promotion_target_kind_mismatch'];
  }

  promote(candidate: PromotionCandidateRecord, nextVersion: number): PromotionCandidateRecord {
    return promoted(this, candidate, nextVersion);
  }
}

export class TaskTypePromotionTarget implements PromotionTarget {
  readonly kind = 'task_type' as const;

  validate(candidate: PromotionCandidateRecord): readonly string[] {
    if (candidate.kind !== this.kind) return ['promotion_target_kind_mismatch'];
    const definition = candidate.definition;
    const failures: string[] = [];
    if (!nonEmptyStrings(definition['requiredDimensions'])) {
      failures.push('task_type_required_dimensions_unstable');
    }
    if (!nonEmptyStrings(definition['criteriaTemplate'])) {
      failures.push('task_type_criteria_structure_unstable');
    }
    if (!nonEmptyStrings(definition['capabilityRequirements'])) {
      failures.push('task_type_capability_structure_unstable');
    }
    return Object.freeze(failures);
  }

  promote(candidate: PromotionCandidateRecord, nextVersion: number): PromotionCandidateRecord {
    return promoted(this, candidate, nextVersion);
  }
}

export class CapabilityPatternPromotionTarget implements PromotionTarget {
  readonly kind = 'capability_pattern' as const;

  validate(candidate: PromotionCandidateRecord): readonly string[] {
    if (candidate.kind !== this.kind) return ['promotion_target_kind_mismatch'];
    const definition = candidate.definition;
    const failures: string[] = [];
    if (
      !Array.isArray(definition['exactSkillVersionMappings']) ||
      definition['exactSkillVersionMappings'].length === 0
    ) {
      failures.push('capability_pattern_current_skill_mapping_required');
    }
    if (
      !nonEmptyStrings(definition['effects']) ||
      !nonEmptyStrings(definition['evidenceRequirements'])
    ) {
      failures.push('capability_pattern_effect_evidence_unstable');
    }
    if (
      strings(definition['limitations']).some((item) => /\bsafety conflict\b/iu.test(item)) ||
      strings(definition['failures']).some((item) => /\bsafety conflict\b/iu.test(item))
    ) {
      failures.push('capability_pattern_safety_conflict');
    }
    return Object.freeze(failures);
  }

  promote(candidate: PromotionCandidateRecord, nextVersion: number): PromotionCandidateRecord {
    return promoted(this, candidate, nextVersion);
  }
}

function promoted(
  target: PromotionTarget,
  candidate: PromotionCandidateRecord,
  nextVersion: number,
): PromotionCandidateRecord {
  const failures = target.validate(candidate);
  if (failures.length > 0)
    throw new Error(`KNOWLEDGE_PROMOTION_TARGET_INVALID:${failures.join(',')}`);
  return Object.freeze({ ...candidate, status: 'active', version: nextVersion });
}

function nonEmptyStrings(value: unknown): boolean {
  return strings(value).length > 0;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
