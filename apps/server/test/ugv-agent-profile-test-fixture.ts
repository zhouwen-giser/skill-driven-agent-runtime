import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  SkillPackageImporter,
  SkillPackageValidator,
  type SkillRepository,
} from '../../../packages/application/src/index.js';
import type { Skill, SkillVersion } from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import { NodeSkillPackageReader } from '../../../packages/skill-package-adapter/src/index.js';

const skillRoot = fileURLToPath(new URL('../../../skills/embodied.move_to/', import.meta.url));

export async function loadExactUgvProfileSkill(): Promise<SkillVersion> {
  const packageSchema = JSON.parse(
    await readFile(new URL('../../../schemas/skill-package.schema.json', import.meta.url), 'utf8'),
  ) as unknown;
  const imported = await new SkillPackageImporter({
    reader: new NodeSkillPackageReader(),
    validator: new SkillPackageValidator({
      schemas: new AjvJsonSchemaValidator(),
      packageSchema,
    }),
    clock: { now: () => '2026-08-21T02:00:00.000Z' },
  }).import(skillRoot);
  return imported.skillVersion;
}

export class InMemoryMutableSkillRepository implements SkillRepository {
  readonly #versions: SkillVersion[];

  constructor(versions: readonly SkillVersion[]) {
    this.#versions = [...versions];
  }

  find(skillId: string): Promise<Skill | undefined> {
    const current = this.#current(skillId);
    return Promise.resolve(
      current === undefined
        ? undefined
        : {
            skillId,
            currentVersion: current.version,
            createdAt: current.createdAt,
            updatedAt: current.createdAt,
          },
    );
  }

  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined> {
    return Promise.resolve(this.#current(skillId));
  }

  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined> {
    return Promise.resolve(
      this.#versions.find(
        (candidate) => candidate.skillId === skillId && candidate.version === version,
      ),
    );
  }

  listVersions(skillId: string): Promise<readonly SkillVersion[]> {
    return Promise.resolve(
      this.#versions
        .filter((version) => version.skillId === skillId)
        .sort((left, right) => left.version - right.version),
    );
  }

  listEnabledVersions(): Promise<readonly SkillVersion[]> {
    return this.listCurrentVersions().then((versions) =>
      versions.filter((version) => version.status === 'enabled'),
    );
  }

  listCurrentVersions(): Promise<readonly SkillVersion[]> {
    const skillIds = [...new Set(this.#versions.map((version) => version.skillId))].sort();
    return Promise.resolve(
      skillIds.flatMap((skillId) => {
        const current = this.#current(skillId);
        return current === undefined ? [] : [current];
      }),
    );
  }

  saveVersionAndSetCurrent(version: SkillVersion): Promise<void> {
    const duplicate = this.#versions.some(
      (candidate) => candidate.skillId === version.skillId && candidate.version === version.version,
    );
    if (duplicate) return Promise.reject(new Error('fixture duplicate SkillVersion'));
    this.#versions.push(version);
    return Promise.resolve();
  }

  #current(skillId: string): SkillVersion | undefined {
    return this.#versions
      .filter((version) => version.skillId === skillId)
      .sort((left, right) => right.version - left.version)[0];
  }
}
