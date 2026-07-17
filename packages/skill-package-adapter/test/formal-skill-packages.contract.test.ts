import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { SkillPackageImporter, SkillPackageValidator } from '../../application/src/index.js';
import {
  createSkillUsageSummary,
  createSkillVersion,
  type SkillPackageImportCandidate,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../src/index.js';

const createdRoots: string[] = [];
const timestamp = '2026-07-17T00:00:00.000Z';
const packageRoots = {
  moveTo: fileURLToPath(new URL('../../../skills/embodied.move_to/', import.meta.url)),
  areaPatrol: fileURLToPath(new URL('../../../skills/embodied.area_patrol/', import.meta.url)),
} as const;

afterEach(async () => {
  await Promise.all(
    createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('formal SDAR v1.2 Skill Packages', () => {
  it('validates the package schema and imports both exact immutable versions', async () => {
    const importer = await createImporter();
    const moveTo = await importer.import(packageRoots.moveTo);
    const areaPatrol = await importer.import(packageRoots.areaPatrol);

    expect(moveTo).toMatchObject({
      packageChecksum: 'f0017113882ab071210f365c89548f87cf755f8d6a3a4057b48c6f87ee7f9940',
      skillVersion: { skillId: 'embodied.move_to', version: 1, status: 'enabled' },
    });
    expect(areaPatrol).toMatchObject({
      packageChecksum: '194ed0c08582c9a779e56df7dfc084c2c53a4351e5a8714510dde28de933a747',
      skillVersion: { skillId: 'embodied.area_patrol', version: 1, status: 'enabled' },
    });
    expect(Object.isFrozen(moveTo.skillVersion.usageSpecification)).toBe(true);
    expect(Object.isFrozen(areaPatrol.skillVersion.usageSpecification?.composition)).toBe(true);
  });

  it('contains the required movement, patrol, degraded and evidence policies', async () => {
    const importer = await createImporter();
    const moveTo = await importer.import(packageRoots.moveTo);
    const patrol = await importer.import(packageRoots.areaPatrol);
    const moveUsage = requireUsage(moveTo);
    const patrolUsage = requireUsage(patrol);

    expect(moveTo.skillMarkdown).toContain('## Non-goals');
    expect(moveTo.skillMarkdown).toContain('without the required final-position evidence');
    expect(moveUsage.contextRequirements.map((item) => item.requirementId)).toEqual([
      'current-position',
      'resource-state',
      'permission-context',
    ]);
    expect(moveUsage.normative.forbiddenActions).toContain('Enter a forbidden area.');
    expect(moveUsage.evidencePolicy).toMatchObject({
      rejectSuccessWithoutRequiredEvidence: true,
      requirements: [{ evidenceType: 'position.observation', required: true, hardGate: true }],
    });

    expect(patrol.skillMarkdown).toContain('a degraded edge');
    expect(patrolUsage.contextRequirements.map((item) => item.requirementId)).toEqual([
      'area-boundary',
      'resource-state',
      'time-window',
      'area-partition',
    ]);
    expect(patrolUsage.composition).toMatchObject({
      maxDepth: 3,
      fixedDependencies: [{ skillId: 'embodied.move_to', failurePolicy: 'recoverable' }],
      capabilitySlots: [{ capability: 'embodied.inspect_area', failurePolicy: 'degraded' }],
    });
    expect(patrolUsage.evidencePolicy.requirements.map((item) => item.evidenceType)).toEqual([
      'patrol.coverage',
      'patrol.trajectory',
      'patrol.anomalies',
    ]);
  });

  it('fails closed when a formally distributed package violates its schema', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sdar-invalid-formal-package-'));
    createdRoots.push(root);
    await cp(packageRoots.moveTo, root, { recursive: true });
    const normativePath = path.join(root, 'normative.json');
    const normative = JSON.parse(await readFile(normativePath, 'utf8')) as Record<string, unknown>;
    normative['unknownPolicy'] = true;
    const content = JSON.stringify(normative);
    await writeFile(normativePath, content);
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    const files = manifest['files'] as Record<string, { path: string; sha256: string }>;
    const declaration = files['normative'];
    if (declaration === undefined) throw new Error('formal package declaration missing');
    declaration.sha256 = digest(content);
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect((await createImporter()).import(root)).rejects.toMatchObject({
      code: 'SKILL_PACKAGE_CONTRACT_INVALID',
    });
  });

  it('retains guidance-only legacy compatibility without inventing package capabilities', () => {
    const legacy = createSkillVersion({
      skillId: 'legacy.inspect',
      version: 1,
      name: 'Legacy Inspect',
      summary: 'Inspect.',
      description: 'Legacy inspection Skill.',
      capabilities: ['inspection'],
      workflowGuidance: 'Inspect safely.',
      outputInstruction: 'Return status.',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: timestamp,
    });

    expect(createSkillUsageSummary(legacy)).toMatchObject({
      source: 'legacy_projection',
      supportedModes: ['guidance'],
      taskTypes: [],
      hasComposition: false,
    });
  });

  it('matches the reviewed golden import snapshots', async () => {
    const importer = await createImporter();
    for (const [name, root] of Object.entries(packageRoots)) {
      const actual = formalSnapshot(await importer.import(root));
      const golden = JSON.parse(
        await readFile(
          new URL(
            `./golden/${name === 'moveTo' ? 'embodied.move_to' : 'embodied.area_patrol'}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      ) as unknown;
      expect(actual, name).toEqual(golden);
    }
  });
});

async function createImporter(): Promise<SkillPackageImporter> {
  const packageSchema = JSON.parse(
    await readFile(new URL('../../../schemas/skill-package.schema.json', import.meta.url), 'utf8'),
  ) as unknown;
  return new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({
      schemas: new AjvJsonSchemaValidator(),
      packageSchema,
    }),
    clock: { now: () => timestamp },
  });
}

function requireUsage(candidate: SkillPackageImportCandidate) {
  const usage = candidate.skillVersion.usageSpecification;
  if (usage === undefined) throw new Error('formal Skill Package usage missing');
  return usage;
}

function formalSnapshot(candidate: SkillPackageImportCandidate): unknown {
  const usage = requireUsage(candidate);
  return {
    skillId: candidate.skillVersion.skillId,
    version: candidate.skillVersion.version,
    packageChecksum: candidate.packageChecksum,
    capabilities: candidate.skillVersion.capabilities,
    visibility: usage.visibility,
    supportedModes: usage.modes.supported,
    defaultMode: usage.modes.defaultMode,
    taskTypes: usage.taskBindings.map((item) => item.taskType),
    composition: usage.composition ?? null,
    evidence: usage.evidencePolicy.requirements,
    rejectSuccessWithoutRequiredEvidence: usage.evidencePolicy.rejectSuccessWithoutRequiredEvidence,
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
