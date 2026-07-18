import type { SkillExecutionMode, SkillFailurePolicy, SkillValueMapping } from './skill-usage.js';

export const MAX_SKILL_USAGE_EXPANDED_SKILLS = 32;
export const MAX_SKILL_USAGE_PLAN_NODES = 128;

export interface SkillExactVersionReference {
  readonly skillId: string;
  readonly skillVersion: number;
}

export interface SkillUsageCompositionEdge {
  readonly edgeId: string;
  readonly kind: 'fixed_dependency' | 'capability_slot';
  readonly declarationId: string;
  readonly parent: SkillExactVersionReference;
  readonly child: SkillExactVersionReference;
  readonly candidateSet: readonly SkillExactVersionReference[];
  readonly failurePolicy: SkillFailurePolicy;
  readonly inputMappings: readonly SkillValueMapping[];
  readonly outputMappings: readonly SkillValueMapping[];
  readonly depth: number;
}

export interface SkillUsageCompositionPlan {
  readonly root: SkillExactVersionReference;
  readonly expandedSkills: readonly SkillExactVersionReference[];
  readonly edges: readonly SkillUsageCompositionEdge[];
  readonly maxDepth: number;
  readonly consumedDepth: number;
  readonly consumedSkills: number;
  readonly consumedNodes: number;
}

export interface SkillGuidanceContext {
  readonly kind: 'guidance';
  readonly skill: SkillExactVersionReference;
  readonly constraints: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly instructions: readonly string[];
  readonly requiredEvidenceTypes: readonly string[];
  readonly composition: SkillUsageCompositionPlan;
}

export interface SkillTemplateInstance {
  readonly kind: 'template';
  readonly skill: SkillExactVersionReference;
  readonly templateId: string;
  readonly instructions: readonly string[];
  readonly parameterMappings: readonly SkillValueMapping[];
  readonly outputMappings: readonly SkillValueMapping[];
  readonly composition: SkillUsageCompositionPlan;
}

export type SkillProcedureStep =
  | Readonly<{
      stepId: string;
      kind: 'context_gate';
      requirementIds: readonly string[];
    }>
  | Readonly<{
      stepId: string;
      kind: 'confirmation_gate';
      confirmationIds: readonly string[];
    }>
  | Readonly<{
      stepId: string;
      kind: 'skill_call';
      edgeId: string;
      child: SkillExactVersionReference;
      failurePolicy: SkillFailurePolicy;
      inputMappings: readonly SkillValueMapping[];
      outputMappings: readonly SkillValueMapping[];
    }>
  | Readonly<{
      stepId: string;
      kind: 'task_binding';
      bindingIds: readonly string[];
    }>
  | Readonly<{
      stepId: string;
      kind: 'evidence_gate';
      requirementIds: readonly string[];
      rejectSuccessWithoutRequiredEvidence: boolean;
    }>;

export interface SkillProcedureProgram {
  readonly kind: 'procedure';
  readonly apiVersion: 'sdar.io/v1alpha1';
  readonly skill: SkillExactVersionReference;
  readonly instructions: readonly string[];
  readonly steps: readonly SkillProcedureStep[];
  readonly composition: SkillUsageCompositionPlan;
}

export type SkillModeInterpretation =
  SkillGuidanceContext | SkillTemplateInstance | SkillProcedureProgram;

export interface SkillFailureProjection {
  readonly policy: SkillFailurePolicy;
  readonly parentStatus: 'failed' | 'recovering' | 'continuing' | 'degraded';
  readonly action: 'abort' | 'try_recovery' | 'record_optional_failure' | 'continue_degraded';
  readonly missingEffects: readonly string[];
  readonly missingEvidence: readonly string[];
}

export function projectSkillUsageFailure(
  policy: SkillFailurePolicy,
  input: Readonly<{
    missingEffects?: readonly string[];
    missingEvidence?: readonly string[];
  }> = {},
): SkillFailureProjection {
  const missingEffects = snapshotMissing(input.missingEffects ?? [], 'effect');
  const missingEvidence = snapshotMissing(input.missingEvidence ?? [], 'evidence');
  switch (policy) {
    case 'fail_fast':
      return Object.freeze({
        policy,
        parentStatus: 'failed',
        action: 'abort',
        missingEffects,
        missingEvidence,
      });
    case 'recoverable':
      return Object.freeze({
        policy,
        parentStatus: 'recovering',
        action: 'try_recovery',
        missingEffects,
        missingEvidence,
      });
    case 'optional':
      return Object.freeze({
        policy,
        parentStatus: 'continuing',
        action: 'record_optional_failure',
        missingEffects,
        missingEvidence,
      });
    case 'degraded':
      if (missingEffects.length === 0 && missingEvidence.length === 0)
        throw new SkillUsageCompositionContractError(
          'SKILL_USAGE_DEGRADED_EVIDENCE_REQUIRED',
          'Degraded propagation requires an explicit missing effect or evidence item.',
        );
      return Object.freeze({
        policy,
        parentStatus: 'degraded',
        action: 'continue_degraded',
        missingEffects,
        missingEvidence,
      });
  }
}

export function snapshotSkillUsageCompositionPlan(
  plan: SkillUsageCompositionPlan,
): SkillUsageCompositionPlan {
  if (
    plan.maxDepth < 1 ||
    plan.maxDepth > 5 ||
    plan.consumedDepth > plan.maxDepth ||
    plan.expandedSkills.length === 0 ||
    plan.expandedSkills.length > MAX_SKILL_USAGE_EXPANDED_SKILLS ||
    plan.edges.length > MAX_SKILL_USAGE_PLAN_NODES ||
    plan.consumedSkills !== plan.expandedSkills.length ||
    plan.consumedNodes !== plan.edges.length
  )
    throw new SkillUsageCompositionContractError(
      'SKILL_USAGE_COMPOSITION_PLAN_INVALID',
      'Skill usage composition plan exceeds or contradicts its shared budget.',
    );
  const expandedSkills = plan.expandedSkills.map(snapshotReference);
  const identities = expandedSkills.map(referenceKey);
  const edgeIds = plan.edges.map((edge) => edge.edgeId);
  const depthBySkill = new Map<string, number>([[referenceKey(plan.root), 0]]);
  let maximumDepth = 0;
  for (const edge of plan.edges) {
    const parentDepth = depthBySkill.get(referenceKey(edge.parent));
    const childKey = referenceKey(edge.child);
    const candidateKeys = edge.candidateSet.map(referenceKey);
    if (
      parentDepth === undefined ||
      edge.depth !== parentDepth + 1 ||
      depthBySkill.has(childKey) ||
      candidateKeys.length === 0 ||
      new Set(candidateKeys).size !== candidateKeys.length ||
      !candidateKeys.includes(childKey)
    )
      throw new SkillUsageCompositionContractError(
        'SKILL_USAGE_COMPOSITION_PLAN_INVALID',
        'Skill usage composition edges must form one connected exact-version expansion.',
      );
    depthBySkill.set(childKey, edge.depth);
    maximumDepth = Math.max(maximumDepth, edge.depth);
  }
  if (
    new Set(identities).size !== identities.length ||
    new Set(edgeIds).size !== edgeIds.length ||
    identities[0] !== referenceKey(plan.root) ||
    depthBySkill.size !== identities.length ||
    plan.consumedDepth !== maximumDepth ||
    plan.edges.some(
      (edge) =>
        !identities.includes(referenceKey(edge.parent)) ||
        !identities.includes(referenceKey(edge.child)) ||
        edge.depth < 1 ||
        edge.depth > plan.maxDepth,
    )
  )
    throw new SkillUsageCompositionContractError(
      'SKILL_USAGE_COMPOSITION_PLAN_INVALID',
      'Skill usage composition plan contains invalid exact-version topology.',
    );
  return Object.freeze({
    root: snapshotReference(plan.root),
    expandedSkills: Object.freeze(expandedSkills),
    edges: Object.freeze(
      plan.edges.map((edge) =>
        Object.freeze({
          ...edge,
          parent: snapshotReference(edge.parent),
          child: snapshotReference(edge.child),
          candidateSet: Object.freeze(edge.candidateSet.map(snapshotReference)),
          inputMappings: snapshotMappings(edge.inputMappings),
          outputMappings: snapshotMappings(edge.outputMappings),
        }),
      ),
    ),
    maxDepth: plan.maxDepth,
    consumedDepth: plan.consumedDepth,
    consumedSkills: plan.consumedSkills,
    consumedNodes: plan.consumedNodes,
  });
}

function snapshotMissing(values: readonly string[], label: string): readonly string[] {
  if (
    values.length > 128 ||
    new Set(values).size !== values.length ||
    values.some((value) => value.trim() === '' || value.length > 512)
  )
    throw new SkillUsageCompositionContractError(
      'SKILL_USAGE_DEGRADED_EVIDENCE_REQUIRED',
      `Missing ${label} entries must be unique bounded non-empty strings.`,
    );
  return Object.freeze([...values]);
}

function snapshotReference(reference: SkillExactVersionReference): SkillExactVersionReference {
  if (
    reference.skillId.trim() === '' ||
    !Number.isSafeInteger(reference.skillVersion) ||
    reference.skillVersion < 1
  )
    throw new SkillUsageCompositionContractError(
      'SKILL_USAGE_COMPOSITION_PLAN_INVALID',
      'Composition references require an exact Skill version.',
    );
  return Object.freeze({ ...reference });
}

function snapshotMappings(mappings: readonly SkillValueMapping[]): readonly SkillValueMapping[] {
  return Object.freeze(mappings.map((mapping) => Object.freeze({ ...mapping })));
}

function referenceKey(reference: SkillExactVersionReference): string {
  return `${reference.skillId}@${String(reference.skillVersion)}`;
}

export type SkillUsageCompositionContractErrorCode =
  'SKILL_USAGE_COMPOSITION_PLAN_INVALID' | 'SKILL_USAGE_DEGRADED_EVIDENCE_REQUIRED';

export class SkillUsageCompositionContractError extends Error {
  readonly code: SkillUsageCompositionContractErrorCode;
  constructor(code: SkillUsageCompositionContractErrorCode, message: string) {
    super(message);
    this.name = 'SkillUsageCompositionContractError';
    this.code = code;
  }
}

export function modeOfInterpretation(value: SkillModeInterpretation): SkillExecutionMode {
  return value.kind;
}
