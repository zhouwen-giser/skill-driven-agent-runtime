import type { Pool } from 'pg';

import type {
  CandidateStaticValidationResult,
  GeneralizedPattern,
} from '../../../domain/src/index.js';

export interface CandidateGenerationRepository {
  saveGeneralizedPattern(pattern: GeneralizedPattern, tenantId: string): Promise<void>;
  saveFingerprint(input: {
    fingerprint: string;
    artifactType: string;
    domain: string;
    taskTypeId: string;
    artifactRef: string;
    generatorVersion: string;
  }): Promise<void>;
  findExistingFingerprints(
    artifactType: string,
    domain: string,
    taskTypeId: string,
  ): Promise<readonly string[]>;
  saveValidation(validation: CandidateStaticValidationResult): Promise<void>;
}

export class PostgresCandidateGenerationRepository implements CandidateGenerationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async saveGeneralizedPattern(pattern: GeneralizedPattern, tenantId: string): Promise<void> {
    await this.#pool.query(
      `INSERT INTO generalized_pattern
         (generalized_pattern_id, tenant_id, domain, task_type_id, source_fused_pattern_ref,
          content, content_hash, generalizer_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (generalized_pattern_id) DO NOTHING`,
      [
        pattern.generalizedPatternId,
        tenantId,
        pattern.domain,
        pattern.taskTypeId,
        pattern.sourceFusedPatternRef,
        JSON.stringify(pattern),
        pattern.contentHash,
        pattern.generalizerVersion,
      ],
    );
  }

  async saveFingerprint(input: {
    fingerprint: string;
    artifactType: string;
    domain: string;
    taskTypeId: string;
    artifactRef: string;
    generatorVersion: string;
  }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO candidate_fingerprint
         (fingerprint, artifact_type, domain, task_type_id, artifact_ref, generator_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (fingerprint) DO NOTHING`,
      [
        input.fingerprint,
        input.artifactType,
        input.domain,
        input.taskTypeId,
        input.artifactRef,
        input.generatorVersion,
      ],
    );
  }

  async findExistingFingerprints(
    artifactType: string,
    domain: string,
    taskTypeId: string,
  ): Promise<readonly string[]> {
    const result = await this.#pool.query(
      `SELECT fingerprint FROM candidate_fingerprint
       WHERE artifact_type = $1 AND domain = $2 AND task_type_id = $3`,
      [artifactType, domain, taskTypeId],
    );
    return Object.freeze(result.rows.map((r: { fingerprint: string }) => r.fingerprint));
  }

  async saveValidation(validation: CandidateStaticValidationResult): Promise<void> {
    const validationId = `validation-${validation.artifactRef}-${validation.validatorVersion}`;
    await this.#pool.query(
      `INSERT INTO candidate_static_validation
         (validation_id, artifact_ref, schema_valid, dag_valid, required_criteria_covered,
          capability_shape_valid, parameter_policy_valid, side_effect_replay_safe,
          bounds_valid, duplicate_fingerprint, errors, warnings, validator_version, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (validation_id) DO NOTHING`,
      [
        validationId,
        validation.artifactRef,
        validation.schemaValid,
        validation.dagValid,
        validation.requiredCriteriaCovered,
        validation.capabilityShapeValid,
        validation.parameterPolicyValid,
        validation.sideEffectReplaySafe,
        validation.boundsValid,
        validation.duplicateFingerprint ?? null,
        JSON.stringify(validation.errors),
        JSON.stringify(validation.warnings),
        validation.validatorVersion,
        validation.result,
      ],
    );
  }
}
