import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

let upMigration: string;
let downMigration: string;

beforeAll(async () => {
  const migrationRoot = new URL('../../../infra/postgres/migrations/', import.meta.url);
  [upMigration, downMigration] = await Promise.all([
    readFile(new URL('0145_v14_artifact_match_exact_version.up.sql', migrationRoot), 'utf8'),
    readFile(new URL('0145_v14_artifact_match_exact_version.down.sql', migrationRoot), 'utf8'),
  ]);
});

describe('v1.4.1 exact Artifact Match authority migration', () => {
  it('adds a required version and an exact composite Artifact foreign key', () => {
    expect(upMigration).toContain('ADD COLUMN artifact_version integer');
    expect(upMigration).toMatch(/ALTER COLUMN artifact_version SET NOT NULL/u);
    expect(upMigration).toMatch(
      /FOREIGN KEY \(candidate_artifact_id,artifact_version\)\s+REFERENCES compiled_artifact\(artifact_id,version\)/u,
    );
    expect(upMigration).toContain("VALUES ('0145_v14_artifact_match_exact_version')");
  });

  it('backfills only from an exact decision ref or a provably unique version', () => {
    expect(upMigration).toContain('runtime_candidate_decision');
    expect(upMigration).toContain("artifact_row.artifact_id || ':' || artifact_row.version::text");
    expect(upMigration).toContain('ARTIFACT_MATCH_BACKFILL_SELECTED_REF_INVALID');
    expect(upMigration).toContain('ARTIFACT_MATCH_BACKFILL_VERSION_AMBIGUOUS');
    expect(upMigration).not.toMatch(/\b(?:MAX|MIN)\s*\(/iu);
  });

  it('provides a forward-only compatible rollback without touching earlier migrations', () => {
    expect(downMigration).toContain('DROP COLUMN IF EXISTS artifact_version');
    expect(downMigration).toMatch(
      /FOREIGN KEY \(candidate_artifact_id\)\s+REFERENCES compiled_artifact\(artifact_id\)/u,
    );
    expect(downMigration).toContain("version='0145_v14_artifact_match_exact_version'");
  });
});
