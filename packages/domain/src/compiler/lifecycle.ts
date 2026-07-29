import type {
  ArtifactActivationEvidence,
  CompiledArtifact,
  CompiledArtifactStatus,
} from './contracts.js';
import { ArtifactDomainError } from './errors.js';
import { createCompiledArtifact } from './factory.js';

export const ARTIFACT_STATUS_TRANSITIONS: Readonly<
  Record<CompiledArtifactStatus, readonly CompiledArtifactStatus[]>
> = Object.freeze({
  discovered: Object.freeze(['candidate', 'rejected'] as const),
  candidate: Object.freeze(['validating', 'rejected'] as const),
  validating: Object.freeze(['awaiting_approval', 'candidate', 'rejected'] as const),
  awaiting_approval: Object.freeze(['active', 'candidate', 'rejected'] as const),
  active: Object.freeze(['revalidating', 'deprecated', 'archived'] as const),
  revalidating: Object.freeze(['active', 'deprecated', 'archived', 'rejected'] as const),
  deprecated: Object.freeze(['archived'] as const),
  archived: Object.freeze([] as const),
  rejected: Object.freeze([] as const),
});

export function canTransitionArtifactStatus(
  from: CompiledArtifactStatus,
  to: CompiledArtifactStatus,
): boolean {
  return ARTIFACT_STATUS_TRANSITIONS[from].includes(to);
}

export function transitionCompiledArtifact(
  artifact: CompiledArtifact,
  toStatus: CompiledArtifactStatus,
  evidence?: ArtifactActivationEvidence,
): CompiledArtifact {
  if (!canTransitionArtifactStatus(artifact.status, toStatus)) {
    throw new ArtifactDomainError(
      'ARTIFACT_LIFECYCLE_TRANSITION_INVALID',
      'Artifact lifecycle transition is not allowed.',
      { fromStatus: artifact.status, toStatus },
    );
  }
  if (
    toStatus === 'active' &&
    (artifact.validationSummaryRef === undefined ||
      !evidence?.validationPassed ||
      !evidence.approvalRecorded)
  ) {
    throw new ArtifactDomainError(
      'ARTIFACT_ACTIVATION_EVIDENCE_REQUIRED',
      'Artifact activation requires a validation summary and recorded validation/approval evidence.',
      { artifactId: artifact.artifactId },
    );
  }
  return createCompiledArtifact({ ...artifact, status: toStatus }, evidence);
}
