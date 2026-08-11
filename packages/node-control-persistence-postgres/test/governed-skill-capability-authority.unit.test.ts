import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { PostgresRuntimeCapabilityImplementationCatalog } from '../src/index.js';

describe('governed Skill Capability implementation authority', () => {
  it('treats the exact governance lifecycle as authority without mutating SkillVersion content', async () => {
    const query = vi.fn((statement: string) =>
      Promise.resolve({
        rows:
          statement.includes('runtime_skill_version_governance') &&
          statement.includes('governance.lifecycle_status')
            ? [{}]
            : [],
      }),
    );
    const catalog = new PostgresRuntimeCapabilityImplementationCatalog({
      query,
    } as unknown as Pool);

    await expect(catalog.exists('skill', 'home.light.get-state', '1')).resolves.toBe(true);
    expect(query).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'LEFT JOIN runtime_skill_version_governance governance',
    );
    expect(String(query.mock.calls[0]?.[0])).toContain("='published'");
  });
});
