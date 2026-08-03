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
    if (!/^[1-9][0-9]*$/u.test(implementationVersion)) return false;
    const version = Number(implementationVersion);
    if (!Number.isSafeInteger(version) || version < 1) return false;
    const result =
      implementationType === 'skill'
        ? await this.#runtimePool.query(
            `SELECT 1 FROM skill_version
              WHERE skill_id=$1 AND version=$2 AND status='enabled' AND validation_passed=true
              LIMIT 1`,
            [implementationId, version],
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
