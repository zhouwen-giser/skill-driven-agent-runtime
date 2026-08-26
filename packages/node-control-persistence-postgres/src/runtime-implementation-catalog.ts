import type { Pool } from 'pg';

import type { NodeControlCapabilityImplementationCatalog } from '../../node-control-application/src/index.js';
import type { CapabilityImplementationType } from '../../node-control-domain/src/index.js';

/** Read-only adapter over existing Runtime and Artifact authorities. */
export class PostgresRuntimeCapabilityImplementationCatalog implements NodeControlCapabilityImplementationCatalog {
  readonly #runtimePool: Pool;

  constructor(runtimePool: Pool) {
    this.#runtimePool = runtimePool;
  }

  async exists(
    implementationType: CapabilityImplementationType,
    implementationId: string,
    implementationVersion: string,
  ): Promise<boolean> {
    return this.lookup(implementationType, implementationId, implementationVersion, false);
  }

  async isPubliclyRegistered(
    implementationType: CapabilityImplementationType,
    implementationId: string,
    implementationVersion: string,
  ): Promise<boolean> {
    return this.lookup(implementationType, implementationId, implementationVersion, true);
  }

  private async lookup(
    implementationType: CapabilityImplementationType,
    implementationId: string,
    implementationVersion: string,
    requireCurrentSkill: boolean,
  ): Promise<boolean> {
    if (!/^[1-9][0-9]*$/u.test(implementationVersion)) return false;
    const version = Number(implementationVersion);
    if (!Number.isSafeInteger(version) || version < 1) return false;
    const result =
      implementationType === 'skill'
        ? await this.#runtimePool.query(
            `SELECT 1
               FROM skill_version version
               LEFT JOIN runtime_skill_version_governance governance
                 ON governance.skill_id=version.skill_id
                AND governance.skill_version=version.version
              WHERE version.skill_id=$1 AND version.version=$2
                AND (NOT $3::boolean OR EXISTS (
                  SELECT 1 FROM skill
                   WHERE skill.skill_id=version.skill_id AND skill.current_version=version.version
                ))
                AND version.validation_passed=true
                AND COALESCE(
                      governance.lifecycle_status,
                      CASE version.status
                        WHEN 'enabled' THEN 'published'
                        WHEN 'disabled' THEN 'suspended'
                        ELSE version.status
                      END
                    )='published'
              LIMIT 1`,
            [implementationId, version, requireCurrentSkill],
          )
        : await this.#runtimePool.query(
            `SELECT 1 FROM compiled_artifact
              WHERE artifact_id=$1 AND version=$2 AND artifact_type='plan_template'
                AND status='active'
              LIMIT 1`,
            [implementationId, version],
          );
    return result.rows[0] !== undefined;
  }
}
