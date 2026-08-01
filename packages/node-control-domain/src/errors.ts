export type NodeControlDomainErrorCode =
  | 'NODE_PROFILE_INVALID'
  | 'NODE_ID_IMMUTABLE'
  | 'NODE_PROFILE_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'MANAGEMENT_OPERATION_INVALID'
  | 'MANAGEMENT_OPERATION_TRANSITION_INVALID'
  | 'CONFIGURATION_REVISION_INVALID'
  | 'CONFIGURATION_TRANSITION_INVALID'
  | 'CONFIGURATION_CHECKSUM_MISMATCH'
  | 'CONFIGURATION_PLAINTEXT_SECRET_FORBIDDEN';

export class NodeControlDomainError extends Error {
  readonly code: NodeControlDomainErrorCode;

  constructor(code: NodeControlDomainErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlDomainError';
    this.code = code;
  }
}
