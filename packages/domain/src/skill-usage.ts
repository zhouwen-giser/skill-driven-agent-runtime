import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export const SKILL_USAGE_API_VERSION = 'sdar.io/v1alpha1' as const;
export const DEFAULT_SKILL_USAGE_DEPTH = 3;
export const MAX_SKILL_USAGE_DEPTH = 5;
export const MAX_SKILL_USAGE_ITEMS = 64;
export const MAX_SKILL_USAGE_TEXT_LENGTH = 8_192;
export const MAX_SKILL_USAGE_JSON_DEPTH = 32;

export type SkillExecutionMode = 'guidance' | 'template' | 'procedure';
export type SkillFailurePolicy = 'fail_fast' | 'recoverable' | 'optional' | 'degraded';
export type SkillNoMatchPolicy = 'fallback' | 'confirm' | 'reject';
export type SkillContextSource =
  'authoritative_context' | 'read_only_query' | 'deterministic_derivation' | 'user_input';

export interface SkillVisibility {
  readonly userSelectable: boolean;
  readonly composable: boolean;
  readonly internalOnly: boolean;
}

export interface SkillNormativePolicy {
  readonly constraints: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly requiredConfirmations: readonly string[];
  readonly noApplicableSkill: SkillNoMatchPolicy;
}

export interface SkillAdaptiveGuidance {
  readonly instructions: readonly string[];
  readonly optimizationHints: readonly string[];
  readonly allowPreferredProviderFallback: boolean;
}

/** Observations are descriptive evidence and never normative authority. */
export interface SkillObservedProfile {
  readonly sampleCount: number;
  readonly successRate?: number;
  readonly notes: readonly string[];
}

export interface SkillContextRequirement {
  readonly requirementId: string;
  readonly description: string;
  readonly required: boolean;
  readonly sourceOrder: readonly SkillContextSource[];
}

export interface SkillModeDescriptor {
  readonly summary: string;
  readonly instructions: readonly string[];
  /** A package-local declarative artifact reference, never executable source. */
  readonly artifactRef?: string;
}

export interface SkillModeSpecification {
  readonly supported: readonly SkillExecutionMode[];
  readonly defaultMode: SkillExecutionMode;
  readonly guidance?: SkillModeDescriptor;
  readonly template?: SkillModeDescriptor;
  readonly procedure?: SkillModeDescriptor;
}

export type SkillProviderSelection = 'dynamic' | 'preferred' | 'required';

export interface SkillProviderPolicy {
  readonly selection: SkillProviderSelection;
  readonly preferredProviderIds: readonly string[];
  readonly requiredProviderId?: string;
  readonly forbiddenProviderIds: readonly string[];
  readonly requiredAttributes: readonly string[];
}

export interface SkillTaskBinding {
  readonly bindingId: string;
  readonly taskType: string;
  readonly providerPolicy: SkillProviderPolicy;
}

export interface SkillFixedDependency {
  readonly dependencyId: string;
  readonly skillId: string;
  readonly skillVersion?: number;
  readonly failurePolicy: SkillFailurePolicy;
}

export interface SkillCapabilitySlot {
  readonly slotId: string;
  readonly capability: string;
  readonly required: boolean;
  readonly candidateSkillIds: readonly string[];
  readonly failurePolicy: SkillFailurePolicy;
}

export interface SkillCompositionSpecification {
  readonly maxDepth: number;
  readonly fixedDependencies: readonly SkillFixedDependency[];
  readonly capabilitySlots: readonly SkillCapabilitySlot[];
}

export interface SkillEvidenceRequirement {
  readonly requirementId: string;
  readonly evidenceType: string;
  readonly required: boolean;
  readonly hardGate: boolean;
}

export interface SkillEvidencePolicy {
  readonly requirements: readonly SkillEvidenceRequirement[];
  readonly rejectSuccessWithoutRequiredEvidence: boolean;
}

export interface SkillUsageSpecification {
  readonly apiVersion: typeof SKILL_USAGE_API_VERSION;
  readonly visibility: SkillVisibility;
  readonly normative: SkillNormativePolicy;
  readonly adaptive: SkillAdaptiveGuidance;
  readonly observedProfile?: SkillObservedProfile;
  readonly contextRequirements: readonly SkillContextRequirement[];
  readonly modes: SkillModeSpecification;
  readonly taskBindings: readonly SkillTaskBinding[];
  readonly composition?: SkillCompositionSpecification;
  readonly evidencePolicy: SkillEvidencePolicy;
}

export interface SkillPatchCandidate {
  readonly candidateId: string;
  readonly skillId: string;
  readonly baseVersion: number;
  readonly proposedAdaptivePatch: unknown;
  readonly evidenceRefs: readonly string[];
  readonly status: 'candidate';
  readonly createdAt: string;
}

export type SkillUsageSpecSource = 'native' | 'legacy_projection';

export interface ResolvedSkillUsageSpecification {
  readonly source: SkillUsageSpecSource;
  readonly specification: SkillUsageSpecification;
}

export function createSkillUsageSpecification(
  input: SkillUsageSpecification,
): SkillUsageSpecification {
  const apiVersion: unknown = input.apiVersion;
  if (apiVersion !== SKILL_USAGE_API_VERSION) invalid('Skill usage apiVersion is unsupported.');
  validateVisibility(input.visibility);
  validateNormative(input.normative);
  validateAdaptive(input.adaptive);
  if (input.observedProfile !== undefined) validateObserved(input.observedProfile);
  validateUnique(input.contextRequirements, (value) => value.requirementId, 'context requirement');
  for (const requirement of input.contextRequirements) validateContextRequirement(requirement);
  validateModes(input.modes);
  validateUnique(input.taskBindings, (value) => value.bindingId, 'task binding');
  for (const binding of input.taskBindings) validateTaskBinding(binding);
  if (input.composition !== undefined) validateComposition(input.composition);
  validateEvidence(input.evidencePolicy);
  return snapshotUsage(input);
}

export function createLegacySkillUsageProjection(
  input: Readonly<{
    workflowGuidance: string;
    autoConfirmPlan: boolean;
  }>,
): ResolvedSkillUsageSpecification {
  const guidance = text(input.workflowGuidance, 'legacy workflow guidance');
  return Object.freeze({
    source: 'legacy_projection',
    specification: createSkillUsageSpecification({
      apiVersion: SKILL_USAGE_API_VERSION,
      visibility: { userSelectable: true, composable: false, internalOnly: false },
      normative: {
        constraints: [],
        forbiddenActions: [],
        requiredConfirmations: input.autoConfirmPlan ? [] : ['existing_plan_confirmation'],
        noApplicableSkill: 'confirm',
      },
      adaptive: {
        instructions: [guidance],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [],
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Legacy workflow guidance projection.', instructions: [guidance] },
      },
      taskBindings: [],
      evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
    }),
  });
}

export function createSkillPatchCandidate(input: SkillPatchCandidate): SkillPatchCandidate {
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 1)
    invalid('Skill patch baseVersion must be a positive integer.');
  const status: unknown = input.status;
  if (status !== 'candidate') invalid('Skill patches may only be created as candidates.');
  return Object.freeze({
    ...input,
    candidateId: identifier(input.candidateId, 'Skill patch candidate ID'),
    skillId: requireIdentifier(input.skillId, 'SKILL_ID_REQUIRED'),
    proposedAdaptivePatch: snapshotJson(input.proposedAdaptivePatch),
    evidenceRefs: stringList(input.evidenceRefs, 'patch evidence reference'),
    createdAt: text(input.createdAt, 'patch creation time'),
  });
}

function validateVisibility(value: SkillVisibility): void {
  if (
    typeof value.userSelectable !== 'boolean' ||
    typeof value.composable !== 'boolean' ||
    typeof value.internalOnly !== 'boolean'
  )
    invalid('Skill visibility flags must be boolean.');
  if (value.internalOnly && value.userSelectable)
    invalid('An internal-only Skill cannot be user-selectable.');
  if (!value.userSelectable && !value.composable && !value.internalOnly)
    invalid('Skill visibility must admit at least one use boundary.');
}

function validateNormative(value: SkillNormativePolicy): void {
  stringList(value.constraints, 'normative constraint');
  stringList(value.forbiddenActions, 'forbidden action');
  stringList(value.requiredConfirmations, 'required confirmation');
  enumValue(
    value.noApplicableSkill,
    ['fallback', 'confirm', 'reject'],
    'no-applicable-Skill policy',
  );
}

function validateAdaptive(value: SkillAdaptiveGuidance): void {
  stringList(value.instructions, 'adaptive instruction');
  stringList(value.optimizationHints, 'optimization hint');
  if (typeof value.allowPreferredProviderFallback !== 'boolean')
    invalid('Preferred Provider fallback flag must be boolean.');
}

function validateObserved(value: SkillObservedProfile): void {
  if (!Number.isInteger(value.sampleCount) || value.sampleCount < 0)
    invalid('Observed sampleCount must be a nonnegative integer.');
  if (
    value.successRate !== undefined &&
    (!Number.isFinite(value.successRate) || value.successRate < 0 || value.successRate > 1)
  )
    invalid('Observed successRate must be between zero and one.');
  stringList(value.notes, 'observed note');
}

function validateContextRequirement(value: SkillContextRequirement): void {
  identifier(value.requirementId, 'Context requirement ID');
  text(value.description, 'context requirement description');
  if (typeof value.required !== 'boolean') invalid('Context required flag must be boolean.');
  const sources = value.sourceOrder.map((source) =>
    enumValue(
      source,
      ['authoritative_context', 'read_only_query', 'deterministic_derivation', 'user_input'],
      'context source',
    ),
  );
  if (new Set(sources).size !== sources.length)
    invalid('Context source order contains duplicates.');
  bounded(sources, 'context source order');
}

function validateModes(value: SkillModeSpecification): void {
  bounded(value.supported, 'supported modes');
  if (value.supported.length === 0) invalid('At least one execution mode is required.');
  const supported = value.supported.map((mode) =>
    enumValue(mode, ['guidance', 'template', 'procedure'], 'execution mode'),
  );
  if (new Set(supported).size !== supported.length)
    invalid('Supported execution modes contain duplicates.');
  enumValue(value.defaultMode, ['guidance', 'template', 'procedure'], 'default execution mode');
  if (!supported.includes(value.defaultMode)) invalid('Default execution mode must be supported.');
  for (const mode of ['guidance', 'template', 'procedure'] as const) {
    const descriptor = value[mode];
    if (supported.includes(mode) !== (descriptor !== undefined))
      invalid(`Execution mode ${mode} descriptor must exactly match supported modes.`);
    if (descriptor !== undefined) validateModeDescriptor(descriptor);
  }
}

function validateModeDescriptor(value: SkillModeDescriptor): void {
  text(value.summary, 'mode summary');
  stringList(value.instructions, 'mode instruction');
  if (value.artifactRef !== undefined) {
    const ref = text(value.artifactRef, 'mode artifact reference');
    if (ref.startsWith('/') || ref.includes('..') || ref.includes('\\'))
      invalid('Mode artifact references must be package-relative normalized paths.');
    if (/\.(?:js|cjs|mjs|ts|tsx|sh|exe)$/iu.test(ref))
      invalid('Mode artifact references may not name executable source.');
  }
}

function validateTaskBinding(value: SkillTaskBinding): void {
  identifier(value.bindingId, 'Task binding ID');
  identifier(value.taskType, 'Task Type');
  const policy = value.providerPolicy;
  enumValue(policy.selection, ['dynamic', 'preferred', 'required'], 'Provider selection');
  const preferred = identifierList(policy.preferredProviderIds, 'preferred Provider');
  const forbidden = identifierList(policy.forbiddenProviderIds, 'forbidden Provider');
  stringList(policy.requiredAttributes, 'required Provider attribute');
  const required =
    policy.requiredProviderId === undefined
      ? undefined
      : identifier(policy.requiredProviderId, 'Required Provider ID');
  if (policy.selection === 'required' ? required === undefined : required !== undefined)
    invalid('Required Provider ID must be present only for required selection.');
  if (policy.selection === 'preferred' && preferred.length === 0)
    invalid('Preferred Provider selection requires at least one preferred Provider.');
  if (policy.selection === 'dynamic' && preferred.length > 0)
    invalid('Dynamic Provider selection cannot carry preferred Providers.');
  if (required !== undefined && forbidden.includes(required))
    invalid('A required Provider cannot be forbidden.');
  if (preferred.some((provider) => forbidden.includes(provider)))
    invalid('A preferred Provider cannot be forbidden.');
}

function validateComposition(value: SkillCompositionSpecification): void {
  if (
    !Number.isInteger(value.maxDepth) ||
    value.maxDepth < 1 ||
    value.maxDepth > MAX_SKILL_USAGE_DEPTH
  )
    invalid(`Skill usage maxDepth must be between 1 and ${String(MAX_SKILL_USAGE_DEPTH)}.`);
  validateUnique(value.fixedDependencies, (item) => item.dependencyId, 'fixed dependency');
  validateUnique(value.capabilitySlots, (item) => item.slotId, 'capability slot');
  for (const dependency of value.fixedDependencies) {
    identifier(dependency.dependencyId, 'Fixed dependency ID');
    requireIdentifier(dependency.skillId, 'SKILL_ID_REQUIRED');
    if (
      dependency.skillVersion !== undefined &&
      (!Number.isInteger(dependency.skillVersion) || dependency.skillVersion < 1)
    )
      invalid('Fixed dependency version must be a positive integer.');
    failurePolicy(dependency.failurePolicy);
  }
  for (const slot of value.capabilitySlots) {
    identifier(slot.slotId, 'Capability slot ID');
    text(slot.capability, 'capability slot capability');
    if (typeof slot.required !== 'boolean')
      invalid('Capability slot required flag must be boolean.');
    identifierList(slot.candidateSkillIds, 'capability slot candidate');
    failurePolicy(slot.failurePolicy);
  }
}

function validateEvidence(value: SkillEvidencePolicy): void {
  if (typeof value.rejectSuccessWithoutRequiredEvidence !== 'boolean')
    invalid('Evidence success gate flag must be boolean.');
  validateUnique(value.requirements, (item) => item.requirementId, 'evidence requirement');
  for (const requirement of value.requirements) {
    identifier(requirement.requirementId, 'Evidence requirement ID');
    identifier(requirement.evidenceType, 'Evidence Type');
    if (typeof requirement.required !== 'boolean' || typeof requirement.hardGate !== 'boolean')
      invalid('Evidence requirement flags must be boolean.');
    if (requirement.hardGate && !requirement.required)
      invalid('An evidence hard gate must be required.');
  }
}

function failurePolicy(value: SkillFailurePolicy): void {
  enumValue(value, ['fail_fast', 'recoverable', 'optional', 'degraded'], 'failure policy');
}

function snapshotUsage(value: SkillUsageSpecification): SkillUsageSpecification {
  return snapshotJson(value) as SkillUsageSpecification;
}

function snapshotJson(value: unknown, active = new WeakSet(), depth = 0): unknown {
  if (depth > MAX_SKILL_USAGE_JSON_DEPTH) invalid('Skill usage JSON exceeds the maximum depth.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, 'Skill usage text');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('Skill usage JSON numbers must be finite.');
    return value;
  }
  if (typeof value !== 'object') invalid('Skill usage snapshots must contain finite JSON data.');
  if (active.has(value)) invalid('Skill usage snapshots cannot contain cyclic JSON.');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      bounded(value, 'Skill usage array');
      return Object.freeze(value.map((item) => snapshotJson(item, active, depth + 1)));
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      invalid('Skill usage snapshots require plain JSON objects.');
    const entries = Object.entries(value);
    bounded(entries, 'Skill usage object');
    for (const [key] of entries)
      if (
        /^(?:chainOfThought|chain_of_thought|privateReasoning|private_reasoning|cot)$/iu.test(key)
      )
        invalid('Private reasoning fields are forbidden in Skill usage snapshots.');
    return Object.freeze(
      Object.fromEntries(
        entries.map(([key, item]) => [key, snapshotJson(item, active, depth + 1)]),
      ),
    );
  } finally {
    active.delete(value);
  }
}

function text(value: string, label: string): string {
  if (typeof value !== 'string') invalid(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized === '' || normalized.length > MAX_SKILL_USAGE_TEXT_LENGTH)
    invalid(
      `${label} must be non-empty and at most ${String(MAX_SKILL_USAGE_TEXT_LENGTH)} characters.`,
    );
  return normalized;
}

function stringList(values: readonly string[], label: string): readonly string[] {
  bounded(values, label);
  const normalized = values.map((value) => text(value, label));
  if (new Set(normalized).size !== normalized.length) invalid(`${label} values must be unique.`);
  return normalized;
}

function identifierList(values: readonly string[], label: string): readonly string[] {
  bounded(values, label);
  const normalized = values.map((value) => identifier(value, label));
  if (new Set(normalized).size !== normalized.length) invalid(`${label} values must be unique.`);
  return normalized;
}

function validateUnique<T>(values: readonly T[], id: (value: T) => string, label: string): void {
  bounded(values, label);
  const ids = values.map(id);
  if (new Set(ids).size !== ids.length) invalid(`${label} IDs must be unique.`);
}

function bounded(values: readonly unknown[], label: string): void {
  if (!Array.isArray(values) || values.length > MAX_SKILL_USAGE_ITEMS)
    invalid(`${label} exceeds the maximum item count ${String(MAX_SKILL_USAGE_ITEMS)}.`);
}

function enumValue<T extends string>(value: T, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value)) invalid(`${label} is unsupported.`);
  return value;
}

function identifier(value: string, label: string): string {
  const normalized = text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(normalized))
    invalid(`${label} is not a valid bounded identifier.`);
  return normalized;
}

function invalid(message: string): never {
  throw new DomainError('SKILL_USAGE_SPEC_INVALID', message);
}
