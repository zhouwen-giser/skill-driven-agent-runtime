import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  ARTIFACT_FEATURE_FLAG_NAMES,
  ARTIFACT_GOVERNANCE_PORT_SCHEMA_HASH,
  ARTIFACT_PERSISTENCE_SCHEMA_HASHES,
  ARTIFACT_REGISTRY_SERVICE_SCHEMA_HASH,
  ArtifactRegistryService,
  ConfiguredOperatorIdentityPort,
  DefaultArtifactGovernanceService,
  OPERATOR_IDENTITY_PORT_SCHEMA_HASH,
  SDAR_V13_ARTIFACT_EVENTS,
  SDAR_V13_ARTIFACT_QUEUES,
} from '../../application/src/index.js';
import {
  PostgresArtifactExecutionRepository,
  PostgresArtifactRepository,
  PostgresArtifactValidationRepository,
} from '../src/index.js';

interface ContractLock {
  readonly producedContracts: Readonly<
    Record<string, Readonly<{ schemaHash: string; signature: string }>>
  >;
  readonly persistenceTables: Readonly<Record<string, readonly string[]>>;
  readonly events: readonly string[];
  readonly queues: readonly string[];
  readonly featureFlags: Readonly<Record<string, readonly string[]>>;
}

let lock: ContractLock;
let migration: string;

beforeAll(async () => {
  const packageRoot = new URL(
    '../../../docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P02_Codex_Goal_Package_V1.1/',
    import.meta.url,
  );
  lock = JSON.parse(
    await readFile(new URL('CONTRACT-LOCK.json', packageRoot), 'utf8'),
  ) as ContractLock;
  migration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0125_v13_artifact_authority.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
});

describe('SDAR v1.3 P02 frozen contract', () => {
  it('publishes the six exact schema hashes', () => {
    expect(ARTIFACT_PERSISTENCE_SCHEMA_HASHES).toEqual({
      ArtifactRepository: lock.producedContracts['ArtifactRepository']?.schemaHash,
      ArtifactValidationRepository:
        lock.producedContracts['ArtifactValidationRepository']?.schemaHash,
      ArtifactExecutionRepository:
        lock.producedContracts['ArtifactExecutionRepository']?.schemaHash,
    });
    expect(ARTIFACT_REGISTRY_SERVICE_SCHEMA_HASH).toBe(
      lock.producedContracts['ArtifactRegistryService']?.schemaHash,
    );
    expect(OPERATOR_IDENTITY_PORT_SCHEMA_HASH).toBe(
      lock.producedContracts['OperatorIdentityPort']?.schemaHash,
    );
    expect(ARTIFACT_GOVERNANCE_PORT_SCHEMA_HASH).toBe(
      lock.producedContracts['ArtifactGovernancePort']?.schemaHash,
    );
  });

  it('implements the exact frozen method vocabularies without aliases', () => {
    expect(methods(PostgresArtifactRepository)).toEqual([
      'activate',
      'deprecate',
      'findActiveIndex',
      'getDefinition',
      'saveCandidate',
    ]);
    expect(methods(PostgresArtifactValidationRepository)).toEqual([
      'appendResult',
      'createRun',
      'findPromotionSummary',
    ]);
    expect(methods(PostgresArtifactExecutionRepository)).toEqual([
      'appendFeedback',
      'complete',
      'start',
    ]);
    expect(methods(DefaultArtifactGovernanceService)).toEqual([
      'activate',
      'deprecate',
      'killSwitch',
      'recordApproval',
      'requestRevalidation',
      'requestValidation',
      'rollback',
    ]);
    expect(methods(ConfiguredOperatorIdentityPort)).toEqual([
      'getTenantScope',
      'requireIdentity',
      'requirePermission',
    ]);
    expect(methods(ArtifactRegistryService)).toEqual([
      'createCandidate',
      'getVersion',
      'invalidateDependency',
      'queryActiveIndex',
      'rebuildProjection',
    ]);
  });

  it('uses only the ten canonical tables and exact event, queue and flag names', () => {
    const createdTables = [...migration.matchAll(/CREATE TABLE ([a-z_]+) \(/gu)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined)
      .sort();
    expect(createdTables).toEqual(Object.keys(lock.persistenceTables).sort());
    for (const [table, expectedColumns] of Object.entries(lock.persistenceTables)) {
      expect(migrationColumns(migration, table)).toEqual(expectedColumns);
    }
    expect(SDAR_V13_ARTIFACT_EVENTS).toEqual(lock.events);
    expect(SDAR_V13_ARTIFACT_QUEUES).toEqual(lock.queues);
    expect(ARTIFACT_FEATURE_FLAG_NAMES).toEqual(Object.keys(lock.featureFlags));
  });

  it('bounds every canonical JSON column by type, size and depth', () => {
    const jsonColumnsByTable = {
      compiled_artifact: ['definition', 'applicability', 'dependency_snapshot'],
      artifact_lineage: [
        'source_episode_refs',
        'source_knowledge_refs',
        'source_correction_refs',
        'source_pattern_refs',
        'generation_methods',
      ],
      artifact_validation_run: ['metrics', 'counterexample_refs'],
      artifact_execution: ['decision_snapshot'],
      artifact_feedback: ['impact'],
      artifact_match_log: ['score', 'applicability', 'reason_codes'],
      experience_trace: ['task_type_refs', 'trace'],
      pattern_candidate: ['definition', 'support_refs', 'contradiction_refs'],
    } as const;
    for (const [table, columns] of Object.entries(jsonColumnsByTable)) {
      const block = migrationTableBlock(migration, table);
      for (const column of columns) {
        expect(block).toContain(`octet_length(${column}::text)`);
        expect(block).toContain(`sdar_jsonb_depth(${column})`);
      }
    }
  });
});

function methods(value: abstract new (...arguments_: never[]) => object): string[] {
  return Object.getOwnPropertyNames(value.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
}

function migrationColumns(source: string, table: string): string[] {
  return migrationTableBlock(source, table)
    .split('\n')
    .map((line) => /^ {2}([a-z_]+) /u.exec(line)?.[1])
    .filter((column): column is string => column !== undefined);
}

function migrationTableBlock(source: string, table: string): string {
  const match = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`, 'u').exec(source);
  if (match?.[1] === undefined) throw new Error(`Missing migration table ${table}.`);
  return match[1];
}
