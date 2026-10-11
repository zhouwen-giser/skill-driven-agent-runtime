/** Frozen error identity shared by confirmation persistence and the UGV read adapter. */
export class PostgresUgvGovernedControlAuthorityError extends Error {
  readonly code = 'UGV_GOVERNED_CONTROL_PERSISTED_AUTHORITY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'PostgresUgvGovernedControlAuthorityError';
  }
}
