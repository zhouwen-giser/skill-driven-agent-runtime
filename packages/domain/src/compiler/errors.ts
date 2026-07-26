import { DomainError } from '../errors.js';

export type ArtifactDomainErrorCode =
  | 'ARTIFACT_INVALID'
  | 'ARTIFACT_DEFINITION_MISMATCH'
  | 'ARTIFACT_CONDITION_INVALID'
  | 'ARTIFACT_JSON_INVALID'
  | 'ARTIFACT_LIFECYCLE_TRANSITION_INVALID'
  | 'ARTIFACT_ACTIVATION_EVIDENCE_REQUIRED'
  | 'ARTIFACT_LINEAGE_INVALID'
  | 'ARTIFACT_RUNTIME_BINDING_INVALID';

export class ArtifactDomainError extends DomainError {
  constructor(
    code: ArtifactDomainErrorCode,
    message: string,
    details: Readonly<Record<string, string>> = {},
  ) {
    super(code, message, details);
    this.name = 'ArtifactDomainError';
  }
}
