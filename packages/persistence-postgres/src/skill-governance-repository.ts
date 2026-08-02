import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { SkillVersion } from '../../domain/src/index.js';

import {
  SkillGovernanceError,
  type GovernedSkillStatus,
  type SkillExactVersionGovernanceRepository,
  type SkillGovernanceImportMutation,
  type SkillGovernanceImportResult,
  type SkillGovernanceMutation,
  type SkillGovernanceMutationResult,
} from '../../application/src/index.js';
import { PostgresSkillRepository } from './repositories.js';

interface GovernanceRow extends QueryResultRow {
  lifecycle_status: GovernedSkillStatus;
  lock_version: string;
}

interface CommandRow extends QueryResultRow {
  operation_type: string;
  skill_id: string;
  skill_version: number;
  request_hash: string;
  result_revision: string;
  result_status: GovernedSkillStatus;
}

interface SkillStateRow extends QueryResultRow {
  validation_passed: boolean;
  has_outcome_specification: boolean;
}

interface ImportCommandRow extends QueryResultRow {
  request_hash: string;
  package_root: string;
  package_checksum: string;
  skill_id: string;
  skill_version: number;
  status: 'pending' | 'succeeded';
}

export class PostgresSkillExactVersionGovernanceRepository implements SkillExactVersionGovernanceRepository {
  readonly #pool: Pool;
  readonly #skills: PostgresSkillRepository;

  constructor(pool: Pool) {
    this.#pool = pool;
    this.#skills = new PostgresSkillRepository(pool);
  }

  async findGovernance(skillId: string, version: number) {
    const result = await this.#pool.query<GovernanceRow>(
      `SELECT lifecycle_status,lock_version::text
         FROM runtime_skill_version_governance
        WHERE skill_id=$1 AND skill_version=$2`,
      [skillId, version],
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : Object.freeze({ status: row.lifecycle_status, revision: Number(row.lock_version) });
  }

  async importPackage(
    input: SkillGovernanceImportMutation,
    importValidatedPackage: () => Promise<SkillVersion>,
  ): Promise<SkillGovernanceImportResult> {
    const client = await this.#pool.connect();
    let replayed = false;
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('runtime_skill_import:' || $1))", [
        input.idempotencyKeyHash,
      ]);
      const command = await findImportCommand(client, input);
      const imported = await hasImportedPackage(client, input);
      if (command?.status === 'succeeded' || imported) {
        if (command === undefined) await insertImportCommand(client, input, 'succeeded');
        else if (command.status === 'pending') await completeImportCommand(client, input);
        await client.query('COMMIT');
        replayed = true;
      } else {
        if (command === undefined) await insertImportCommand(client, input, 'pending');
        const created = await importValidatedPackage();
        if (created.skillId !== input.skillId || created.version !== input.version)
          throw new SkillGovernanceError(
            'SKILL_IMPORT_RESULT_MISMATCH',
            'The imported Skill did not match the validated package identity.',
            409,
          );
        await completeImportCommand(client, input);
        await client.query('COMMIT');
      }
      const skill = await this.#skills.findVersion(input.skillId, input.version);
      if (skill === undefined) throw notFound(input.skillId, input.version);
      return Object.freeze({ skill, replayed });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(input: SkillGovernanceMutation): Promise<SkillGovernanceMutationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('runtime_skill_governance:' || $1))",
        [input.skillId],
      );
      const replay = await findReplay(client, input);
      if (replay !== undefined) {
        await client.query('COMMIT');
        const skill = await this.#skills.findVersion(input.skillId, input.version);
        if (skill === undefined) throw notFound(input.skillId, input.version);
        return Object.freeze({
          skill,
          status: replay.result_status,
          governanceRevision: Number(replay.result_revision),
          replayed: true,
        });
      }

      const state = await client.query<SkillStateRow>(
        `SELECT version.validation_passed,
                EXISTS(
                  SELECT 1 FROM skill_outcome_specification outcome
                   WHERE outcome.skill_id=version.skill_id
                     AND outcome.skill_version=version.version
                ) AS has_outcome_specification
           FROM skill_version version
          WHERE version.skill_id=$1 AND version.version=$2
          FOR UPDATE`,
        [input.skillId, input.version],
      );
      const skill = state.rows[0];
      if (skill === undefined) throw notFound(input.skillId, input.version);
      const current = await client.query<GovernanceRow>(
        `SELECT lifecycle_status,lock_version::text
           FROM runtime_skill_version_governance
          WHERE skill_id=$1 AND skill_version=$2
          FOR UPDATE`,
        [input.skillId, input.version],
      );
      const revision = Number(current.rows[0]?.lock_version ?? 0);
      if (input.expectedRevision !== revision)
        throw new SkillGovernanceError(
          'SKILL_GOVERNANCE_REVISION_CONFLICT',
          `Expected governance revision ${String(input.expectedRevision)} but found ${String(revision)}.`,
          412,
        );
      if (
        input.operation === 'publish' &&
        (!skill.validation_passed || !skill.has_outcome_specification)
      )
        throw new SkillGovernanceError(
          'SKILL_PUBLISH_REQUIRES_VALIDATED_OUTCOME',
          'Publishing an exact Skill version requires validation and an outcome specification.',
        );

      const lifecycleStatus = targetLifecycle(input.operation);
      const resultRevision = revision + 1;
      if (input.operation === 'publish') {
        await client.query(
          `UPDATE skill SET current_version=$2,updated_at=$3
            WHERE skill_id=$1`,
          [input.skillId, input.version, input.occurredAt],
        );
      }
      await client.query(
        `INSERT INTO runtime_skill_version_governance(
           skill_id,skill_version,lifecycle_status,lock_version,updated_by,reason,created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT(skill_id,skill_version) DO UPDATE SET
           lifecycle_status=EXCLUDED.lifecycle_status,
           lock_version=EXCLUDED.lock_version,
           updated_by=EXCLUDED.updated_by,
           reason=EXCLUDED.reason,
           updated_at=EXCLUDED.updated_at`,
        [
          input.skillId,
          input.version,
          lifecycleStatus,
          resultRevision,
          input.actorId,
          input.reason,
          input.occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO runtime_skill_governance_command(
           command_id,operation_type,skill_id,skill_version,idempotency_key_hash,request_hash,
           expected_revision,result_revision,result_status,actor_id,reason,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          commandId(input),
          `skill.${input.operation}`,
          input.skillId,
          input.version,
          input.idempotencyKeyHash,
          input.requestHash,
          input.expectedRevision,
          resultRevision,
          lifecycleStatus,
          input.actorId,
          input.reason,
          input.occurredAt,
        ],
      );
      await client.query('COMMIT');
      const updated = await this.#skills.findVersion(input.skillId, input.version);
      if (updated === undefined) throw notFound(input.skillId, input.version);
      return Object.freeze({
        skill: updated,
        status: lifecycleStatus,
        governanceRevision: resultRevision,
        replayed: false,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findImportCommand(
  client: PoolClient,
  input: SkillGovernanceImportMutation,
): Promise<ImportCommandRow | undefined> {
  const result = await client.query<ImportCommandRow>(
    `SELECT request_hash::text,package_root,package_checksum::text,
            skill_id,skill_version,status
       FROM runtime_skill_import_command
      WHERE idempotency_key_hash=$1
      FOR UPDATE`,
    [input.idempotencyKeyHash],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (
    row.request_hash !== input.requestHash ||
    row.package_root !== input.packageRoot ||
    row.package_checksum !== input.packageChecksum ||
    row.skill_id !== input.skillId ||
    row.skill_version !== input.version
  )
    throw new SkillGovernanceError(
      'SKILL_IMPORT_IDEMPOTENCY_CONFLICT',
      'The idempotency key was already used for a different Skill import request.',
      409,
    );
  return row;
}

async function hasImportedPackage(
  client: PoolClient,
  input: SkillGovernanceImportMutation,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM skill_package_import_audit
      WHERE skill_id=$1 AND skill_version=$2
        AND package_checksum=$3 AND package_root=$4
        AND file_checksums_json=$5::jsonb`,
    [
      input.skillId,
      input.version,
      input.packageChecksum,
      input.packageRoot,
      JSON.stringify(input.fileChecksums),
    ],
  );
  return result.rowCount === 1;
}

async function insertImportCommand(
  client: PoolClient,
  input: SkillGovernanceImportMutation,
  status: 'pending' | 'succeeded',
): Promise<void> {
  await client.query(
    `INSERT INTO runtime_skill_import_command(
       command_id,idempotency_key_hash,request_hash,package_root,package_checksum,
       skill_id,skill_version,status,actor_id,reason,created_at,completed_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      importCommandId(input.idempotencyKeyHash),
      input.idempotencyKeyHash,
      input.requestHash,
      input.packageRoot,
      input.packageChecksum,
      input.skillId,
      input.version,
      status,
      input.actorId,
      input.reason,
      input.occurredAt,
      status === 'succeeded' ? input.occurredAt : null,
    ],
  );
}

async function completeImportCommand(
  client: PoolClient,
  input: SkillGovernanceImportMutation,
): Promise<void> {
  const result = await client.query(
    `UPDATE runtime_skill_import_command
        SET status='succeeded',completed_at=$2
      WHERE idempotency_key_hash=$1 AND status='pending'`,
    [input.idempotencyKeyHash, input.occurredAt],
  );
  if (result.rowCount !== 1)
    throw new SkillGovernanceError(
      'SKILL_IMPORT_COMMAND_STATE_CONFLICT',
      'The Skill import command could not be completed from its durable pending state.',
      409,
    );
}

function importCommandId(idempotencyKeyHash: string): string {
  return `skill-import-${idempotencyKeyHash}`;
}

async function findReplay(
  client: PoolClient,
  input: SkillGovernanceMutation,
): Promise<CommandRow | undefined> {
  const result = await client.query<CommandRow>(
    `SELECT operation_type,skill_id,skill_version,request_hash::text,
            result_revision::text,result_status
       FROM runtime_skill_governance_command
      WHERE operation_type=$1 AND idempotency_key_hash=$2`,
    [`skill.${input.operation}`, input.idempotencyKeyHash],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (
    row.request_hash !== input.requestHash ||
    row.skill_id !== input.skillId ||
    row.skill_version !== input.version
  )
    throw new SkillGovernanceError(
      'SKILL_GOVERNANCE_IDEMPOTENCY_CONFLICT',
      'The idempotency key was already used for a different Skill governance request.',
      409,
    );
  return row;
}

function targetLifecycle(operation: SkillGovernanceMutation['operation']): GovernedSkillStatus {
  if (operation === 'publish') return 'published';
  if (operation === 'suspend') return 'suspended';
  return 'deprecated';
}

function commandId(input: SkillGovernanceMutation): string {
  return `skill-governance-${createHash('sha256')
    .update(`skill.${input.operation}:${input.idempotencyKeyHash}`)
    .digest('hex')}`;
}

function notFound(skillId: string, version: number): SkillGovernanceError {
  return new SkillGovernanceError(
    'SKILL_VERSION_NOT_FOUND',
    `Skill ${skillId} version ${String(version)} was not found.`,
    404,
  );
}
