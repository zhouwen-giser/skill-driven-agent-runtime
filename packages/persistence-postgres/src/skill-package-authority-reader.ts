import type { Pool, QueryResultRow } from 'pg';
import type {
  ExactSkillPackageAuthority,
  ExactSkillPackageAuthorityReader,
} from '../../application/src/index.js';

interface SkillPackageAuthorityRow extends QueryResultRow {
  skill_id: string;
  skill_version: string;
  package_checksum: string;
  validated_at: Date | string;
  imported_at: Date | string;
}

/** Read-only PostgreSQL authority for the immutable package audit committed with Skill import. */
export class PostgresExactSkillPackageAuthorityReader implements ExactSkillPackageAuthorityReader {
  constructor(private readonly pool: Pool) {}

  async loadExactSkillPackageAuthority(
    skillId: string,
    skillVersion: number,
  ): Promise<ExactSkillPackageAuthority> {
    const result = await this.pool.query<SkillPackageAuthorityRow>(
      `SELECT skill_id,skill_version::text,package_checksum::text,validated_at,imported_at
         FROM skill_package_import_audit
        WHERE skill_id=$1 AND skill_version=$2
        LIMIT 2`,
      [skillId, skillVersion],
    );
    const row = result.rows[0];
    if (result.rows.length !== 1 || row === undefined)
      throw new ExactSkillPackageAuthorityError(
        'SKILL_PACKAGE_AUTHORITY_NOT_EXACT',
        'Selected Skill requires one exact PostgreSQL package import authority.',
      );
    const version = Number(row.skill_version);
    if (
      row.skill_id !== skillId ||
      version !== skillVersion ||
      !Number.isSafeInteger(version) ||
      !/^[0-9a-f]{64}$/u.test(row.package_checksum)
    )
      throw new ExactSkillPackageAuthorityError(
        'SKILL_PACKAGE_AUTHORITY_INVALID',
        'Selected Skill package import authority is malformed.',
      );
    return Object.freeze({
      skillId: row.skill_id,
      skillVersion: version,
      packageChecksum: row.package_checksum,
      validatedAt: timestamp(row.validated_at),
      importedAt: timestamp(row.imported_at),
    });
  }
}

export type ExactSkillPackageAuthorityErrorCode =
  'SKILL_PACKAGE_AUTHORITY_NOT_EXACT' | 'SKILL_PACKAGE_AUTHORITY_INVALID';

export class ExactSkillPackageAuthorityError extends Error {
  constructor(
    readonly code: ExactSkillPackageAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExactSkillPackageAuthorityError';
  }
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf()))
    throw new ExactSkillPackageAuthorityError(
      'SKILL_PACKAGE_AUTHORITY_INVALID',
      'Selected Skill package authority timestamp is invalid.',
    );
  return date.toISOString();
}
