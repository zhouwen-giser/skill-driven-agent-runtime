import type { Pool } from 'pg';
import type { DeviceWorkScope } from '../../domain/src/device-task-context.js';
import { evidenceTaskScope } from './gowm-evidence-scope.js';
import {
  buildTaskBusinessSourceArtifact,
  taskBusinessContentFromStoredObject,
} from '../../domain/src/task-business-evidence.js';

import {
  assertRuntimeSourceArtifactRef,
  buildRuntimeSourceArtifact,
  validateRuntimeSourceArtifactRef,
  type ArtifactRef,
  type CanonicalRuntimeSourceArtifact,
  type EvidenceJsonValue,
  type RuntimeSourceArtifactAddress,
} from '../../domain/src/index.js';
import { decodePatternCandidateDefinition } from './pattern-definition-artifact.js';

export type RuntimeSourceArtifactResolutionErrorCode = 'RUNTIME_SOURCE_ARTIFACT_NOT_FOUND';

export class RuntimeSourceArtifactResolutionError extends Error {
  readonly code: RuntimeSourceArtifactResolutionErrorCode;
  readonly uri: string;

  constructor(uri: string) {
    super(`Runtime source Artifact ${uri} was not found at its authoritative PostgreSQL field.`);
    this.name = 'RuntimeSourceArtifactResolutionError';
    this.code = 'RUNTIME_SOURCE_ARTIFACT_NOT_FOUND';
    this.uri = uri;
  }
}

export interface ResolvedRuntimeSourceArtifact extends CanonicalRuntimeSourceArtifact {
  readonly value: EvidenceJsonValue;
}

/**
 * Resolves only the allowlisted Runtime PostgreSQL ArtifactRef routes. SQL identifiers and JSON
 * paths are fixed by the parsed route; source identities are always supplied as query parameters.
 */
export class PostgresRuntimeSourceArtifactResolver {
  readonly #pool: Pool;

  constructor(
    pool: Pool,
    readonly deviceScope?: DeviceWorkScope,
  ) {
    this.#pool = pool;
  }

  async resolveTaskBusiness(
    taskId: string,
    ref: ArtifactRef,
  ): Promise<ResolvedRuntimeSourceArtifact> {
    const address = validateRuntimeSourceArtifactRef(ref);
    if (address.sourceTable !== 'remote_task_observation')
      throw new RuntimeSourceArtifactResolutionError(ref.uri);
    const scope = evidenceTaskScope(this.deviceScope, 3);
    const owner = await this.#pool.query(
      `SELECT 1 FROM remote_task_observation observation
       JOIN remote_task_binding binding ON binding.binding_id=observation.binding_id
       JOIN agent_task task ON task.task_id=binding.agent_task_id
       WHERE observation.observation_id=$1 AND task.task_id=$2 AND ${scope.predicate}`,
      [address.sourceRecordId, taskId, ...scope.values],
    );
    if (owner.rowCount !== 1) throw new RuntimeSourceArtifactResolutionError(ref.uri);
    return this.resolve(ref);
  }

  async resolve(ref: ArtifactRef): Promise<ResolvedRuntimeSourceArtifact> {
    const address = validateRuntimeSourceArtifactRef(ref);
    if (address.sourceTable === 'remote_task_observation') {
      const scope = evidenceTaskScope(this.deviceScope, 2);
      const row = (
        await this.#pool.query<{ payload_json: unknown; binding_id: string }>(
          `SELECT observation.payload_json,observation.binding_id FROM remote_task_observation observation
        JOIN remote_task_binding binding ON binding.binding_id=observation.binding_id JOIN agent_task task ON task.task_id=binding.agent_task_id
        WHERE observation.observation_id=$1 AND ${scope.predicate} AND observation.payload_json->>'recordType' IN ('task_business.object','task_business.command','task_business.projection')`,
          [address.sourceRecordId, ...scope.values],
        )
      ).rows[0];
      if (row === undefined) throw new RuntimeSourceArtifactResolutionError(ref.uri);
      const payload = row.payload_json as Readonly<Record<string, unknown>>;
      if (payload['recordType'] !== 'task_business.object') {
        const canonical = buildRuntimeSourceArtifact({
          sourceTable: 'remote_task_observation',
          sourceRecordId: address.sourceRecordId,
          sourceVersion: 1,
          value: row.payload_json as EvidenceJsonValue,
        });
        assertRuntimeSourceArtifactRef(ref, canonical);
        return Object.freeze({
          ...canonical,
          value: JSON.parse(canonical.canonicalJson) as EvidenceJsonValue,
        });
      }
      const chunks = await this.#pool.query<{ payload_json: unknown }>(
        `SELECT payload_json FROM remote_task_observation WHERE binding_id=$1
        AND payload_json->>'recordType'='task_business.content' AND payload_json->>'digest'=($2::jsonb->>'digest') ORDER BY (payload_json->>'offset')::integer LIMIT 172`,
        [row.binding_id, JSON.stringify(row.payload_json)],
      );
      const content = taskBusinessContentFromStoredObject(
        row.payload_json,
        chunks.rows.map((chunk) => chunk.payload_json),
      );
      const canonical = buildTaskBusinessSourceArtifact(address.sourceRecordId, content);
      assertRuntimeSourceArtifactRef(ref, canonical);
      return Object.freeze({
        ...canonical,
        value: JSON.parse(canonical.canonicalJson) as EvidenceJsonValue,
      });
    }
    const query = resolutionQuery(address);
    const result = await this.#pool.query<{ value: unknown }>(query.sql, query.parameters);
    const value = result.rows[0]?.value;
    if (value === undefined || value === null) {
      throw new RuntimeSourceArtifactResolutionError(ref.uri);
    }
    if (address.sourceTable === 'pattern_candidate') {
      const decoded = decodePatternCandidateDefinition({
        patternId: address.sourceRecordId,
        envelope: value,
      });
      assertRuntimeSourceArtifactRef(ref, decoded.sourceArtifact);
      return Object.freeze({ ...decoded.sourceArtifact, value: decoded.definition });
    }
    // PostgreSQL JSONB is an external boundary. The canonical builder performs the runtime JSON
    // shape/depth/value validation before the value is accepted as EvidenceJsonValue.
    const canonical = buildRuntimeSourceArtifact({
      sourceTable: address.sourceTable,
      sourceRecordId: address.sourceRecordId,
      sourceVersion: address.sourceVersion,
      value: value as EvidenceJsonValue,
    });
    assertRuntimeSourceArtifactRef(ref, canonical);
    return Object.freeze({ ...canonical, value: value as EvidenceJsonValue });
  }
}

interface ResolutionQuery {
  readonly sql: string;
  readonly parameters: [string, number];
}

function resolutionQuery(address: RuntimeSourceArtifactAddress): ResolutionQuery {
  const parameters: [string, number] = [address.sourceRecordId, address.sourceVersion];
  switch (address.sourceTable) {
    case 'compiled_artifact':
      return Object.freeze({
        sql: `SELECT definition #> '{artifact,definition}' AS value
              FROM compiled_artifact
              WHERE artifact_id=$1 AND version=$2`,
        parameters,
      });
    case 'replay_dataset_manifest':
      return Object.freeze({
        sql: `SELECT content AS value
              FROM replay_dataset_manifest
              WHERE dataset_id=$1 AND dataset_version=$2`,
        parameters,
      });
    case 'artifact_replay_case':
      return Object.freeze({
        sql: `SELECT content AS value
              FROM artifact_replay_case
              WHERE replay_case_id=$1 AND $2::integer=1`,
        parameters,
      });
    case 'pattern_candidate':
      return Object.freeze({
        sql: `SELECT definition AS value
              FROM pattern_candidate
              WHERE pattern_id=$1 AND $2::integer=1`,
        parameters,
      });
    case 'remote_task_observation':
      throw new RuntimeSourceArtifactResolutionError(
        'remote_task_observation is resolved through immutable chunks',
      );
  }
}
