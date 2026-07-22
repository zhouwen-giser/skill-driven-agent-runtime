import { createHash } from 'node:crypto';

import {
  COGNITIVE_SCHEMA_VERSION,
  createGoalContractCandidateSnapshot,
  type CandidateUserGoalCompletionContract,
  type GoalContractCandidateSnapshot,
  type GoalContractDiff,
} from '../../../domain/src/index.js';

export type GoalContractCandidateSeed = Omit<
  GoalContractCandidateSnapshot,
  'schemaVersion' | 'contractHash' | 'diff'
>;

export class GoalContractCandidateFactory {
  create(input: GoalContractCandidateSeed): GoalContractCandidateSnapshot {
    return this.#build(input, {
      changedFields: ['constraints', 'description', 'successCriteria', 'title'],
    });
  }

  patch(
    source: GoalContractCandidateSnapshot,
    patch: Partial<CandidateUserGoalCompletionContract>,
    input: GoalContractCandidateSeed,
  ): GoalContractCandidateSnapshot {
    const contract = {
      title: patch.title ?? source.contract.title,
      description: patch.description ?? source.contract.description,
      constraints: patch.constraints ?? source.contract.constraints,
      successCriteria: patch.successCriteria ?? source.contract.successCriteria,
    };
    const changedFields = contractFields.filter(
      (field) => canonicalJson(source.contract[field]) !== canonicalJson(contract[field]),
    );
    return this.#build({ ...input, contract }, { baseRevision: source.revision, changedFields });
  }

  transition(
    source: GoalContractCandidateSnapshot,
    status: GoalContractCandidateSnapshot['status'],
  ): GoalContractCandidateSnapshot {
    return createGoalContractCandidateSnapshot({ ...source, status });
  }

  #build(input: GoalContractCandidateSeed, diff: GoalContractDiff): GoalContractCandidateSnapshot {
    return createGoalContractCandidateSnapshot({
      ...input,
      schemaVersion: COGNITIVE_SCHEMA_VERSION,
      contractHash: hashCanonical(input.contract),
      diff,
    });
  }
}

const contractFields = [
  'constraints',
  'description',
  'successCriteria',
  'title',
] as const satisfies readonly (keyof CandidateUserGoalCompletionContract)[];

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
