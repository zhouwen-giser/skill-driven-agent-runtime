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

  it('restricts public discovery to the current registered Skill without consulting Provider health', async () => {
    const query = vi.fn((_statement: string, values: readonly unknown[]) =>
      Promise.resolve({ rows: values[2] === true ? [{}] : [] }),
    );
    const catalog = new PostgresRuntimeCapabilityImplementationCatalog({
      query,
    } as unknown as Pool);

    await expect(catalog.isPubliclyRegistered('skill', 'home.light.get-state', '1')).resolves.toBe(
      true,
    );

    expect(query).toHaveBeenCalledOnce();
    const [statement, values] = query.mock.calls[0] ?? [];
    expect(values).toEqual(['home.light.get-state', 1, true]);
    expect(statement).toContain('skill.current_version=version.version');
    expect(statement).toContain('governance.lifecycle_status');
    expect(statement).not.toMatch(/readiness|mcp_provider|availability|valid_until/u);
  });
});
