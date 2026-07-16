import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';

export type SkillInputResolutionStatus = 'resolved' | 'input_required' | 'failed';

/** Immutable evidence for one top-level formal Skill input decision. */
export interface SkillInputResolutionRecord {
  readonly resolutionId: string;
  readonly taskId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly structuredInput?: unknown;
  readonly unresolvedFields: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly decisionSummary: string;
  readonly status: SkillInputResolutionStatus;
  readonly createdAt: string;
}

export function createSkillInputResolutionRecord(
  input: SkillInputResolutionRecord,
): SkillInputResolutionRecord {
  const unresolvedFields = normalizeStrings(input.unresolvedFields);
  const sourceRefs = normalizeStrings(input.sourceRefs);
  const decisionSummary = input.decisionSummary.trim();
  if (!Number.isInteger(input.goalVersion) || input.goalVersion < 1)
    throw new DomainError('GOAL_VERSION_INVALID', 'Goal version must be positive.');
  if (!Number.isInteger(input.skillVersion) || input.skillVersion < 1)
    throw new DomainError('SKILL_VERSION_INVALID', 'Skill version must be positive.');
  if (decisionSummary === '')
    throw new DomainError(
      'SKILL_INPUT_DECISION_SUMMARY_REQUIRED',
      'Skill input resolution requires a decision summary.',
    );
  if (input.status === 'resolved' && input.structuredInput === undefined)
    throw new DomainError(
      'SKILL_INPUT_STRUCTURED_VALUE_REQUIRED',
      'A resolved Skill input requires a structured value.',
    );
  if (input.status === 'resolved' && unresolvedFields.length > 0)
    throw new DomainError(
      'SKILL_INPUT_UNRESOLVED_FIELDS_INVALID',
      'A resolved Skill input cannot retain unresolved fields.',
    );
  if (input.status === 'input_required' && unresolvedFields.length === 0)
    throw new DomainError(
      'SKILL_INPUT_UNRESOLVED_FIELDS_REQUIRED',
      'An input-required Skill resolution must identify unresolved fields.',
    );
  return {
    ...input,
    resolutionId: requireIdentifier(input.resolutionId, 'SKILL_INPUT_RESOLUTION_ID_REQUIRED'),
    taskId: requireIdentifier(input.taskId, 'TASK_ID_REQUIRED'),
    goalId: requireIdentifier(input.goalId, 'GOAL_ID_REQUIRED'),
    skillId: requireIdentifier(input.skillId, 'SKILL_ID_REQUIRED'),
    unresolvedFields,
    sourceRefs,
    decisionSummary,
  };
}

function normalizeStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
