import { describe, expect, it } from 'vitest';

import type { Skill, SkillVersion } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { SkillRegistryService, type RegisterSkillVersionInput } from '../src/index.js';
import type { SkillRepository } from '../src/ports.js';

describe('SkillRegistryService', () => {
  it('creates immutable versions for enable changes and rollback', async () => {
    const repository = new MemorySkillRepository();
    const registry = createRegistry(repository);
    const first = await registry.register(skillInput('skill.inspect'));
    const disabled = await registry.setEnabled(first.skillId, false);
    const rolledBack = await registry.rollback(first.skillId, 1);

    expect([first.version, disabled.version, rolledBack.version]).toEqual([1, 2, 3]);
    expect(disabled).toMatchObject({ status: 'disabled', previousVersion: 1 });
    expect(rolledBack).toMatchObject({ status: 'enabled', previousVersion: 2 });
    await expect(registry.getOutputSchema(first.skillId)).resolves.toEqual(first.outputSchema);
    await expect(registry.listVersions(first.skillId)).resolves.toHaveLength(3);
    await expect(registry.diff(first.skillId, 1, 2)).resolves.toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      changedFields: expect.arrayContaining(['status', 'sourceKind']),
    });
  });

  it('rejects invalid schemas and overlapping tool policy membership', async () => {
    const registry = createRegistry(new MemorySkillRepository());
    await expect(
      registry.register({ ...skillInput('skill.invalid'), outputSchema: { type: 'not-a-type' } }),
    ).rejects.toMatchObject({ code: 'RESULT_SCHEMA_INVALID' });
    await expect(
      registry.register({
        ...skillInput('skill.overlap'),
        toolPolicy: {
          required: [{ serverId: 'mcp.devices', toolName: 'read' }],
          optional: [{ serverId: 'mcp.devices', toolName: 'read' }],
          forbidden: [],
        },
      }),
    ).rejects.toMatchObject({ code: 'SKILL_TOOL_POLICY_OVERLAP' });
  });
});

function createRegistry(repository: SkillRepository): SkillRegistryService {
  return new SkillRegistryService({
    skills: repository,
    validator: new AjvJsonSchemaValidator(),
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
  });
}

function skillInput(skillId: string): RegisterSkillVersionInput {
  return {
    skillId,
    name: 'Inspect',
    summary: 'Inspect devices.',
    description: 'Inspects a device using registered tools.',
    capabilities: ['inspection'],
    workflowGuidance: 'Inspect safely.',
    outputInstruction: 'Return status.',
    inputSchema: { type: 'object' },
    outputSchema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string' } },
    },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
  };
}

class MemorySkillRepository implements SkillRepository {
  readonly #versions = new Map<string, SkillVersion[]>();

  find(skillId: string): Promise<Skill | undefined> {
    const versions = this.#versions.get(skillId);
    const current = versions?.at(-1);
    const first = versions?.[0];
    if (current === undefined || first === undefined) return Promise.resolve(undefined);
    return Promise.resolve({
      skillId,
      currentVersion: current.version,
      createdAt: first.createdAt,
      updatedAt: current.createdAt,
    });
  }
  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined> {
    return Promise.resolve(this.#versions.get(skillId)?.at(-1));
  }
  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    return Promise.resolve(this.#versions.get(skillId)?.find((item) => item.version === version));
  }
  listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    return Promise.resolve(this.#versions.get(skillId) ?? []);
  }
  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve(
      [...this.#versions.values()].flatMap((versions) => {
        const current = versions.at(-1);
        return current?.status === 'enabled' ? [current] : [];
      }),
    );
  }
  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    return Promise.resolve(
      [...this.#versions.values()].flatMap((versions) => {
        const current = versions.at(-1);
        return current === undefined ? [] : [current];
      }),
    );
  }
  saveVersionAndSetCurrent(version: SkillVersion): Promise<void> {
    this.#versions.set(version.skillId, [...(this.#versions.get(version.skillId) ?? []), version]);
    return Promise.resolve();
  }
}
