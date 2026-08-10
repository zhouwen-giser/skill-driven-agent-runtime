import type { Pool } from 'pg';

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
 * Resolves only the four frozen Runtime PostgreSQL ArtifactRef routes. SQL identifiers and JSON
 * paths are fixed by the parsed route; source identities are always supplied as query parameters.
 */
export class PostgresRuntimeSourceArtifactResolver {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async resolve(ref: ArtifactRef): Promise<ResolvedRuntimeSourceArtifact> {
    const address = validateRuntimeSourceArtifactRef(ref);
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
  }
}
