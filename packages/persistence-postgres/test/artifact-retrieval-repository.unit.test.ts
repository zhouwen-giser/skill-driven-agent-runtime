import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { ArtifactMatchAuditInput } from '../../application/src/index.js';
import { PostgresArtifactMatchAuditRepository } from '../src/index.js';

describe('PostgresArtifactMatchAuditRepository', () => {
  it('persists the exact immutable Artifact version', async () => {
    const pool = new FakePool(true, true);
    await expect(
      new PostgresArtifactMatchAuditRepository(pool as unknown as Pool).append(input()),
    ).resolves.toBeUndefined();
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.sql).toContain('candidate_artifact_id,artifact_version');
    expect(pool.calls[0]?.values[4]).toBe(3);
  });

  it('includes Artifact version in duplicate idempotency equality', async () => {
    const matching = new FakePool(false, true);
    await expect(
      new PostgresArtifactMatchAuditRepository(matching as unknown as Pool).append(input()),
    ).resolves.toBeUndefined();
    expect(matching.calls[1]?.sql).toContain('artifact_version=$5');

    const conflict = new FakePool(false, false);
    await expect(
      new PostgresArtifactMatchAuditRepository(conflict as unknown as Pool).append(input()),
    ).rejects.toMatchObject({ code: 'ARTIFACT_MATCH_AUDIT_IDEMPOTENCY_CONFLICT' });
  });
});

function input(): ArtifactMatchAuditInput {
  return {
    matchId: 'match-a',
    requestId: 'request-a',
    taskId: 'task-a',
    artifactId: 'artifact-a',
    artifactVersion: 3,
    score: {
      intentScore: 1,
      structuredConditionScore: 1,
      parameterCoverageScore: 1,
      capabilityShapeScore: 1,
      environmentSimilarityScore: 1,
      validationConfidenceScore: 1,
      recentReliabilityScore: 1,
      riskPenalty: 0,
      totalScore: 1,
    },
    applicability: {
      artifactRef: 'artifact-a:3',
      applicable: true,
      confidence: 1,
      satisfiedConditionIds: [],
      missingConditionIds: [],
      violatedConditionIds: [],
      uncertainConditionIds: [],
      outOfDistribution: false,
      disposition: 'eligible',
      reasonCodes: [],
    },
    decision: 'compiled_fast',
    reasonCodes: ['ARTIFACT_EXACT_MATCH'],
    policySnapshotHash: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-08-09T00:00:00.000Z',
  };
}

class FakePool {
  readonly calls: Readonly<{ sql: string; values: readonly unknown[] }>[] = [];
  readonly #inserted: boolean;
  readonly #same: boolean;

  constructor(inserted: boolean, same: boolean) {
    this.#inserted = inserted;
    this.#same = same;
  }

  query(sql: string, values: readonly unknown[] = []) {
    this.calls.push({ sql, values });
    if (sql.includes('INSERT INTO artifact_match_log')) {
      return Promise.resolve({ rowCount: this.#inserted ? 1 : 0, rows: [] });
    }
    return Promise.resolve({ rowCount: 1, rows: [{ same: this.#same }] });
  }
}
