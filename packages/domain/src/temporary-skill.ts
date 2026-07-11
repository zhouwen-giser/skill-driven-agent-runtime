import { DomainError } from './errors.js';
import { requireIdentifier } from './identity.js';
import type { ToolReference } from './skill.js';

export interface TemporarySkill {
  readonly temporarySkillId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly name: string;
  readonly description: string;
  readonly tools: readonly ToolReference[];
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly capabilityFingerprint: string;
  readonly status: 'active' | 'expired';
  readonly createdAt: string;
  readonly expiredAt?: string;
}

export interface TemporarySkillExperience {
  readonly experienceId: string;
  readonly temporarySkillId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly capabilityFingerprint: string;
  readonly successful: boolean;
  readonly outcomeSummary: string;
  readonly createdAt: string;
}

export interface SkillFormalizationCandidate {
  readonly candidateId: string;
  readonly capabilityFingerprint: string;
  readonly successfulExperienceCount: number;
  readonly requiredSuccessThreshold: number;
  readonly sourceExperienceIds: readonly string[];
  readonly status: 'awaiting_simulation';
  readonly createdAt: string;
}

export function createTemporarySkill(input: TemporarySkill): TemporarySkill {
  const temporarySkillId = requireIdentifier(input.temporarySkillId, 'TEMPORARY_SKILL_ID_REQUIRED');
  const taskId = requireIdentifier(input.taskId, 'TASK_ID_REQUIRED');
  const contextId = requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED');
  if (input.name.trim() === '' || input.description.trim() === '') {
    throw new DomainError(
      'TEMPORARY_SKILL_DESCRIPTION_REQUIRED',
      'Temporary Skill name and description are required.',
    );
  }
  if (input.tools.length === 0) {
    throw new DomainError(
      'TEMPORARY_SKILL_TOOL_REQUIRED',
      'Temporary Skill requires at least one MCP Tool.',
    );
  }
  if (input.status === 'expired' && input.expiredAt === undefined) {
    throw new DomainError(
      'TEMPORARY_SKILL_EXPIRY_INVALID',
      'Expired Temporary Skill requires expiredAt.',
    );
  }
  return {
    ...input,
    temporarySkillId,
    taskId,
    contextId,
    name: input.name.trim(),
    description: input.description.trim(),
  };
}

export function expireTemporarySkill(skill: TemporarySkill, timestamp: string): TemporarySkill {
  if (skill.status !== 'active') {
    throw new DomainError('TEMPORARY_SKILL_ALREADY_EXPIRED', 'Temporary Skill is already expired.');
  }
  return { ...skill, status: 'expired', expiredAt: timestamp };
}
