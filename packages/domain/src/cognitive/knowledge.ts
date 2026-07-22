import {
  assertIdentifier,
  assertPositiveVersion,
  assertTimestamp,
  freezeStrings,
  type COGNITIVE_SCHEMA_VERSION,
  type CognitiveScope,
  type CognitiveSourceRef,
} from './common.js';
import { CognitiveDomainError } from './errors.js';

export type KnowledgeKind = 'planning_heuristic' | 'task_type' | 'capability_pattern';
export type KnowledgeStatus = 'candidate' | 'validating' | 'active' | 'deprecated' | 'rejected';
export type KnowledgeTransitionReason =
  | 'evaluation_started'
  | 'promotion_approved'
  | 'promotion_rejected'
  | 'contradiction_detected'
  | 'catalog_changed'
  | 'policy_changed'
  | 'skill_version_changed'
  | 'manual_deprecation';

const ALLOWED_KNOWLEDGE_TRANSITIONS = {
  candidate: ['validating', 'rejected'],
  validating: ['active', 'candidate', 'rejected'],
  active: ['validating', 'deprecated'],
  deprecated: [],
  rejected: [],
} as const satisfies Readonly<Record<KnowledgeStatus, readonly KnowledgeStatus[]>>;

export interface KnowledgeCandidateSnapshot {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly knowledgeId: string;
  readonly kind: KnowledgeKind;
  readonly revision: number;
  readonly status: KnowledgeStatus;
  readonly scope: CognitiveScope;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly title: string;
  readonly summary: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly supportSourceRefs: readonly CognitiveSourceRef[];
  readonly contradictionSourceRefs: readonly CognitiveSourceRef[];
  readonly createdAt: string;
}

export interface KnowledgeStatusTransition {
  readonly schemaVersion: typeof COGNITIVE_SCHEMA_VERSION;
  readonly transitionId: string;
  readonly knowledgeId: string;
  readonly knowledgeRevision: number;
  readonly expectedVersion: number;
  readonly fromStatus: KnowledgeStatus;
  readonly toStatus: KnowledgeStatus;
  readonly reason: KnowledgeTransitionReason;
  readonly actorId: string;
  readonly humanApproved: boolean;
  readonly occurredAt: string;
}

export function createKnowledgeCandidateSnapshot(
  input: KnowledgeCandidateSnapshot,
): KnowledgeCandidateSnapshot {
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertPositiveVersion(input.revision, 'revision');
  assertTimestamp(input.createdAt, 'createdAt');
  if (input.status === 'active') {
    throw new CognitiveDomainError(
      'KNOWLEDGE_CANDIDATE_INVALID',
      'Candidate factories cannot create active knowledge.',
    );
  }
  if (input.scope === 'user' && input.userId === undefined) {
    throw new CognitiveDomainError('COGNITIVE_SCOPE_INVALID', 'User scope requires userId.');
  }
  if (input.scope === 'tenant' && input.tenantId === undefined) {
    throw new CognitiveDomainError('COGNITIVE_SCOPE_INVALID', 'Tenant scope requires tenantId.');
  }
  const [title] = freezeStrings([input.title], 'title');
  const [summary] = freezeStrings([input.summary], 'summary');
  if (title === undefined || summary === undefined) {
    throw new CognitiveDomainError('KNOWLEDGE_CANDIDATE_INVALID', 'Knowledge text is invalid.');
  }
  return Object.freeze({
    ...input,
    title,
    summary,
    supportSourceRefs: Object.freeze([...input.supportSourceRefs]),
    contradictionSourceRefs: Object.freeze([...input.contradictionSourceRefs]),
  });
}

export function createKnowledgeStatusTransition(
  input: KnowledgeStatusTransition,
): KnowledgeStatusTransition {
  assertIdentifier(input.transitionId, 'transitionId');
  assertIdentifier(input.knowledgeId, 'knowledgeId');
  assertIdentifier(input.actorId, 'actorId');
  assertPositiveVersion(input.knowledgeRevision, 'knowledgeRevision');
  assertPositiveVersion(input.expectedVersion, 'expectedVersion');
  assertTimestamp(input.occurredAt, 'occurredAt');
  const allowed: readonly KnowledgeStatus[] = ALLOWED_KNOWLEDGE_TRANSITIONS[input.fromStatus];
  if (!allowed.includes(input.toStatus)) {
    throw new CognitiveDomainError(
      'COGNITIVE_STATE_TRANSITION_INVALID',
      `Knowledge cannot transition from ${input.fromStatus} to ${input.toStatus}.`,
    );
  }
  if (input.toStatus === 'active' && !input.humanApproved) {
    throw new CognitiveDomainError(
      'KNOWLEDGE_PROMOTION_FORBIDDEN',
      'G00 freezes manual approval for every initial active transition.',
    );
  }
  return Object.freeze({ ...input });
}
