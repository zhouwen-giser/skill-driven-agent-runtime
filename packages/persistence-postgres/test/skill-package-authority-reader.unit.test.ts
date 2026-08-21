import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresExactSkillPackageAuthorityReader } from '../src/index.js';

describe('PostgresExactSkillPackageAuthorityReader', () => {
  it('reads one exact immutable Skill import audit without a mutation surface', async () => {
    const query = vi.fn((statement: string, parameters: readonly unknown[]) => {
      if (statement.length === 0 || parameters.length === 0) throw new Error('INVALID_TEST_QUERY');
      return Promise.resolve({
        rows: [
          {
            skill_id: 'embodied.move_to',
            skill_version: '1',
            package_checksum: '6d5fc9c8e093de18a8b11c8377b96788336606b25d0df0f27efef7b4d9f6a48c',
            validated_at: new Date('2026-08-21T01:50:00.000Z'),
            imported_at: new Date('2026-08-21T01:51:00.000Z'),
          },
        ],
      });
    });
    const reader = new PostgresExactSkillPackageAuthorityReader({ query } as unknown as Pool);

    await expect(reader.loadExactSkillPackageAuthority('embodied.move_to', 1)).resolves.toEqual({
      skillId: 'embodied.move_to',
      skillVersion: 1,
      packageChecksum: '6d5fc9c8e093de18a8b11c8377b96788336606b25d0df0f27efef7b4d9f6a48c',
      validatedAt: '2026-08-21T01:50:00.000Z',
      importedAt: '2026-08-21T01:51:00.000Z',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('skill_package_import_audit'), [
      'embodied.move_to',
      1,
    ]);
    expect(query.mock.calls[0]?.[0]).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
    expect(reader).not.toHaveProperty('save');
  });

  it.each([
    [[], 'SKILL_PACKAGE_AUTHORITY_NOT_EXACT'],
    [
      [authorityRow(), { ...authorityRow(), package_checksum: 'b'.repeat(64) }],
      'SKILL_PACKAGE_AUTHORITY_NOT_EXACT',
    ],
    [[{ ...authorityRow(), package_checksum: 'NOT-A-HASH' }], 'SKILL_PACKAGE_AUTHORITY_INVALID'],
    [[{ ...authorityRow(), skill_version: '2' }], 'SKILL_PACKAGE_AUTHORITY_INVALID'],
    [[{ ...authorityRow(), imported_at: 'invalid' }], 'SKILL_PACKAGE_AUTHORITY_INVALID'],
  ] as const)('fails closed for a non-exact or malformed audit row', async (rows, code) => {
    const reader = new PostgresExactSkillPackageAuthorityReader({
      query: vi.fn(() => Promise.resolve({ rows })),
    } as unknown as Pool);

    await expect(
      reader.loadExactSkillPackageAuthority('embodied.move_to', 1),
    ).rejects.toMatchObject({
      code,
    });
  });
});

function authorityRow() {
  return {
    skill_id: 'embodied.move_to',
    skill_version: '1',
    package_checksum: 'a'.repeat(64),
    validated_at: '2026-08-21T01:50:00.000Z',
    imported_at: '2026-08-21T01:51:00.000Z',
  };
}
