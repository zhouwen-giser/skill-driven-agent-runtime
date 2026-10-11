import { canonicalHash } from './mcp-task-readiness.js';
import { immutablePlanningSnapshot } from './planning-candidate-snapshot.js';
import type { WorkflowPlanCandidate } from './workflow-planning-contracts.js';

export function workflowPlanCandidate(
  input: Omit<WorkflowPlanCandidate, 'candidateHash'>,
): WorkflowPlanCandidate {
  const snapshot = immutablePlanningSnapshot(input);
  return immutablePlanningSnapshot({ ...snapshot, candidateHash: canonicalHash(snapshot) });
}

export function assertWorkflowCandidateHash(candidate: WorkflowPlanCandidate): void {
  const { candidateHash, ...input } = candidate;
  if (canonicalHash(input) !== candidateHash)
    throw new Error('WORKFLOW_PLAN_CANDIDATE_HASH_MISMATCH');
}
