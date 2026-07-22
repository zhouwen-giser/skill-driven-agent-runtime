import { describe, expect, it } from 'vitest';

import {
  createSkillVersion,
  type Skill,
  type SkillPackageImportCandidate,
  type SkillPackageImportAudit,
  type SkillUsageSpecification,
  type SkillVersion,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { SkillRegistryService, type RegisterSkillVersionInput } from '../src/index.js';
import type { SkillRepository } from '../src/ports.js';

describe('SkillRegistryService', () => {
  it('waits for the injected catalog projection after committed mutations', async () => {
    const projected: string[] = [];
    const registry = new SkillRegistryService({
      skills: new MemorySkillRepository(),
      validator: new AjvJsonSchemaValidator(),
      clock: { now: () => '2026-07-23T10:00:00.000Z' },
      afterCatalogChanged: () => {
        projected.push('projected');
        return Promise.resolve();
      },
    });

    await registry.register(skillInput('skill.projected'));
    await registry.setEnabled('skill.projected', false);

    expect(projected).toEqual(['projected', 'projected']);
  });

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

  it('returns native usage summaries, diffs and immutable exact versions', async () => {
    const registry = createRegistry(new MemorySkillRepository());
    await registry.register(skillInput('embodied.move-to'));
    const native = await registry.register({
      ...skillInput('embodied.move-to'),
      capabilities: ['embodied.move'],
      usageSpecification: usageSpecification(),
    });

    await expect(registry.getVersionSummary(native.skillId, 1)).resolves.toMatchObject({
      current: false,
      lifecycle: 'active',
      usage: { source: 'native', supportedModes: ['guidance'] },
    });
    await expect(registry.getCurrentSummary(native.skillId)).resolves.toMatchObject({
      current: true,
      domains: ['embodied'],
      tags: ['embodied.move'],
      usage: {
        source: 'native',
        supportedModes: ['guidance', 'template', 'procedure'],
        taskTypes: ['embodied.move'],
      },
    });
    await expect(registry.diff(native.skillId, 1, 2)).resolves.toMatchObject({
      changedFields: expect.arrayContaining(['capabilities', 'usageSpecification']),
    });
    const exact = await registry.readExactVersion(native.skillId, 2);
    expect(exact).not.toBe(native);
    expect(Object.isFrozen(exact)).toBe(true);
    expect(Object.isFrozen(exact.usageSpecification?.modes.supported)).toBe(true);
  });

  it('filters the existing catalog by lifecycle, visibility, mode, derived domain and exact tag', async () => {
    const registry = createRegistry(new MemorySkillRepository());
    await registry.register({
      ...skillInput('embodied.move-to'),
      capabilities: ['embodied.move'],
      usageSpecification: usageSpecification(),
    });
    await registry.register({
      ...skillInput('operations.inspect'),
      capabilities: ['operations.inspection'],
    });
    await registry.setEnabled('operations.inspect', false);

    await expect(
      registry.listCatalog({
        lifecycle: 'active',
        visibility: { userSelectable: true },
        mode: 'procedure',
        domain: 'embodied',
        tag: 'embodied.move',
      }),
    ).resolves.toMatchObject([{ skillId: 'embodied.move-to' }]);
    await expect(registry.listCatalog({ lifecycle: 'inactive' })).resolves.toMatchObject([
      { skillId: 'operations.inspect', lifecycle: 'inactive' },
    ]);
    await expect(registry.listCatalog({ tag: 'move' })).resolves.toEqual([]);
  });

  it('revalidates native usage and exact version continuity when importing a package candidate', async () => {
    const repository = new MemorySkillRepository();
    const registry = createRegistry(repository);
    const candidate = packageCandidate('embodied.move-to');
    await expect(registry.importPackage(candidate)).resolves.toMatchObject({
      skillId: 'embodied.move-to',
      version: 1,
    });
    expect(repository.packageImports).toEqual([
      expect.objectContaining({
        skillId: 'embodied.move-to',
        skillVersion: 1,
        packageChecksum: '0'.repeat(64),
      }),
    ]);
    await expect(registry.importPackage(candidate)).rejects.toMatchObject({
      code: 'SKILL_IMPORT_VERSION_CONFLICT',
    });
    await expect(
      registry.register({
        ...skillInput('skill.invalid-usage'),
        usageSpecification: {
          ...usageSpecification(),
          modes: { ...usageSpecification().modes, supported: ['guidance', 'invented'] },
        } as SkillUsageSpecification,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_USAGE_SPEC_INVALID' });
  });

  it('keeps validation read-only and re-reads the package on production import', async () => {
    const repository = new MemorySkillRepository();
    const candidate = packageCandidate('embodied.package-root');
    const packageRoots: string[] = [];
    const registry = new SkillRegistryService({
      skills: repository,
      validator: new AjvJsonSchemaValidator(),
      clock: { now: () => '2026-07-17T10:00:00.000Z' },
      packages: {
        import: (packageRoot) => {
          packageRoots.push(packageRoot);
          return Promise.resolve(candidate);
        },
      },
    });

    await expect(registry.validatePackage('/reviewed/package')).resolves.toBe(candidate);
    await expect(
      repository.findCurrentVersion(candidate.skillVersion.skillId),
    ).resolves.toBeUndefined();
    await expect(registry.importPackageRoot('/reviewed/package')).resolves.toMatchObject({
      skillId: candidate.skillVersion.skillId,
      version: 1,
    });
    expect(packageRoots).toEqual(['/reviewed/package', '/reviewed/package']);

    await expect(
      createRegistry(new MemorySkillRepository()).validatePackage('/unconfigured/package'),
    ).rejects.toMatchObject({ code: 'SKILL_PACKAGE_IMPORT_UNAVAILABLE' });
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
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId,
      skillVersion: 1,
      specificationHash: `sha256:${'1'.repeat(64)}`,
      effects: ['effect.inspected'],
      evidence: ['evidence.status'],
      artifacts: [],
      taskGoalPolicy: {},
      confidencePolicy: {},
      sideEffectPolicy: {},
    },
    usageSpecification: {
      ...usageSpecification(),
      modes: {
        supported: ['guidance'],
        defaultMode: 'guidance',
        guidance: { summary: 'Guidance.', instructions: ['Inspect safely.'] },
      },
      taskBindings: [],
    },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
  };
}

function packageCandidate(skillId: string): SkillPackageImportCandidate {
  return Object.freeze({
    skillVersion: createSkillVersion({
      ...skillInput(skillId),
      version: 1,
      createdAt: '2026-07-17T00:00:00.000Z',
      usageSpecification: usageSpecification(),
    }),
    packageChecksum: '0'.repeat(64),
    packageRoot: '/validated/package',
    fileChecksums: Object.freeze({ 'manifest.json': '0'.repeat(64) }),
    skillMarkdown: '# Move To',
    validatedAt: '2026-07-17T00:00:00.000Z',
  });
}

function usageSpecification(): SkillUsageSpecification {
  return {
    apiVersion: 'sdar.io/v1alpha1',
    visibility: { userSelectable: true, composable: true, internalOnly: false },
    normative: {
      constraints: ['Stay within policy.'],
      forbiddenActions: [],
      requiredConfirmations: [],
      noApplicableSkill: 'reject',
    },
    adaptive: {
      instructions: ['Prefer a safe route.'],
      optimizationHints: [],
      allowPreferredProviderFallback: false,
    },
    contextRequirements: [],
    modes: {
      supported: ['guidance', 'template', 'procedure'],
      defaultMode: 'template',
      guidance: { summary: 'Guide.', instructions: ['Guide safely.'] },
      template: { summary: 'Template.', instructions: ['Bind inputs.'] },
      procedure: { summary: 'Procedure.', instructions: ['Compile declarations.'] },
    },
    taskBindings: [
      {
        bindingId: 'move',
        taskType: 'embodied.move',
        providerPolicy: {
          selection: 'dynamic',
          preferredProviderIds: [],
          forbiddenProviderIds: [],
          requiredAttributes: [],
        },
      },
    ],
    evidencePolicy: { requirements: [], rejectSuccessWithoutRequiredEvidence: false },
  };
}

class MemorySkillRepository implements SkillRepository {
  readonly #versions = new Map<string, SkillVersion[]>();
  readonly packageImports: SkillPackageImportAudit[] = [];

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
  saveVersionAndSetCurrent(
    version: SkillVersion,
    _timestamp: string,
    packageImport?: SkillPackageImportAudit,
  ): Promise<void> {
    this.#versions.set(version.skillId, [...(this.#versions.get(version.skillId) ?? []), version]);
    if (packageImport !== undefined) this.packageImports.push(packageImport);
    return Promise.resolve();
  }
}
