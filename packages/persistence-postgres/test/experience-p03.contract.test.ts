import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { SDAR_V13_ARTIFACT_EVENTS, SDAR_V13_ARTIFACT_QUEUES } from '../../application/src/index.js';
import { EXPERIENCE_COMPILATION_SCHEMA_HASHES } from '../../domain/src/index.js';

interface ContractLock {
  readonly producedContracts: Readonly<
    Record<string, Readonly<{ fields: readonly string[]; schemaHash: string }>>
  >;
  readonly persistenceTables: Readonly<Record<string, readonly string[]>>;
  readonly events: readonly string[];
  readonly queues: readonly string[];
}

let lock: ContractLock;
let p02Migration: string;
let p03Migration: string;

beforeAll(async () => {
  const packageRoot = new URL(
    '../../../docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P03_Codex_Goal_Package_V1.1/',
    import.meta.url,
  );
  lock = JSON.parse(
    await readFile(new URL('CONTRACT-LOCK.json', packageRoot), 'utf8'),
  ) as ContractLock;
  p02Migration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0125_v13_artifact_authority.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
  p03Migration = await readFile(
    new URL(
      '../../../infra/postgres/migrations/0126_v13_experience_compilation.up.sql',
      import.meta.url,
    ),
    'utf8',
  );
});

describe('SDAR v1.3 P03 frozen contract', () => {
  it('publishes all six exact 1.1 schema hashes', () => {
    expect(EXPERIENCE_COMPILATION_SCHEMA_HASHES).toEqual(
      Object.fromEntries(
        Object.entries(lock.producedContracts).map(([name, contract]) => [
          name,
          contract.schemaHash,
        ]),
      ),
    );
  });

  it('keeps exact top-level field order in the frozen registry', () => {
    expect(lock.producedContracts['ExperienceTrace']?.fields).toEqual([
      'traceId',
      'sourceEpisodeId',
      'taskTypeRefs',
      'goalFingerprint',
      'capabilityFingerprint',
      'environmentFingerprint',
      'trace',
      'completeness',
      'dataClassification',
      'normalizerVersion',
      'sourceHash',
      'createdAt',
    ]);
    expect(lock.producedContracts['ExperienceTraceEvent']?.fields).toEqual([
      'eventId',
      'sequence',
      'occurredAt',
      'eventType',
      'actorType',
      'capabilityRefs',
      'authorityRefs',
      'parentEventRefs',
      'concurrencyGroup',
      'branchRef',
      'payloadSummary',
    ]);
  });

  it('reuses the canonical P02 Trace and Pattern tables without aliases', () => {
    for (const table of ['experience_trace', 'pattern_candidate']) {
      expect(migrationColumns(p02Migration, table)).toEqual(lock.persistenceTables[table]);
      expect(p03Migration).not.toMatch(new RegExp(`CREATE TABLE ${table} \\(`, 'u'));
    }
    expect(
      [...p03Migration.matchAll(/CREATE TABLE ([a-z_]+) \(/gu)].map((item) => item[1]),
    ).toEqual(['experience_trace_source', 'pattern_candidate_support', 'compilation_run']);
  });

  it('uses only the frozen P03 event and queue names', () => {
    expect(SDAR_V13_ARTIFACT_EVENTS).toEqual(lock.events);
    expect(SDAR_V13_ARTIFACT_QUEUES).toEqual(lock.queues);
    expect(SDAR_V13_ARTIFACT_EVENTS).toEqual(
      expect.arrayContaining(['experience.trace_created', 'compiler.pattern_discovered']),
    );
    expect(SDAR_V13_ARTIFACT_QUEUES.slice(0, 2)).toEqual([
      'sdar-compiler-normalization',
      'sdar-compiler-process-mining',
    ]);
  });

  it('bounds compiler JSON and fences every durable lease', () => {
    const block = migrationTableBlock(p03Migration, 'compilation_run');
    expect(block).toContain('octet_length(payload::text)');
    expect(block).toContain('sdar_jsonb_depth(payload)');
    expect(block).toContain('lease_token');
    expect(block).toContain("status = 'leased'");
    expect(p03Migration).toContain('source_episode_id, normalizer_version, source_hash');
  });
});

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
