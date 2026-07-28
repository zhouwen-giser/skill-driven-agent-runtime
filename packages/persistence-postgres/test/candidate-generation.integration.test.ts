import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PatternFusionService,
  PatternGeneralizationService,
  NoOpSemanticModel,
  ArtifactCandidateGenerator,
} from '../../application/src/index.js';
import {
  type WorkflowPattern,
  type DiscoveredProcessPattern,
  type ActivityPattern,
  type DependencyPattern,
  type PatternQuality,
  type RecoveryPattern,
} from '../../domain/src/index.js';
import { PostgresCandidateGenerationRepository } from '../src/compiler/candidate-generation-repositories.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../../../apps/server/test-support/postgres.js';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';

const adminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseName = 'sdar_v13_p04_candidate_e2e';
const postgresUrl = isolatedDatabaseUrl(adminUrl, databaseName);

let pool: Pool;

beforeAll(async () => {
  await createIsolatedRuntimeDatabase(adminUrl, databaseName);
  pool = new Pool({ connectionString: postgresUrl });
  await applyRuntimeMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await dropIsolatedRuntimeDatabase(adminUrl, databaseName);
});

const quality: PatternQuality = {
  support: 0.95,
  successRate: 0.8,
  traceCoverage: 0.9,
  fitness: 0.85,
  precisionProxy: 0.75,
  environmentCoverage: 0.7,
  contradictionRate: 0.05,
  generalization: 0.6,
  mandatoryThreshold: 0.8,
};

const activityPatterns: readonly ActivityPattern[] = [
  {
    activity: 'observe_input',
    required: true,
    supportRate: 1.0,
    capabilityRefs: ['capability.observe'],
  },
  {
    activity: 'verify_constraint',
    required: true,
    supportRate: 0.9,
    capabilityRefs: ['capability.verify'],
  },
  {
    activity: 'execute_action',
    required: true,
    supportRate: 0.85,
    capabilityRefs: ['capability.execute'],
  },
  {
    activity: 'recover_failure',
    required: false,
    supportRate: 0.2,
    capabilityRefs: ['capability.recover'],
  },
];

const dependencyPatterns: readonly DependencyPattern[] = [
  {
    predecessorActivity: 'observe_input',
    successorActivity: 'verify_constraint',
    relation: 'direct_follows',
    supportRefs: ['trace-1'],
    contradictionRefs: [],
  },
  {
    predecessorActivity: 'verify_constraint',
    successorActivity: 'execute_action',
    relation: 'direct_follows',
    supportRefs: ['trace-2'],
    contradictionRefs: [],
  },
];

const recoveryPatterns: readonly RecoveryPattern[] = [
  {
    triggerActivity: 'execute_action',
    resumeActivity: 'verify_constraint',
    activitySequence: ['recover_failure', 'verify_constraint'],
    supportRefs: ['trace-recovery-1'],
  },
];

const workflowPattern: WorkflowPattern = {
  workflowPatternId: 'wp-int-test-001',
  taskTypeId: 'task-type-int-test',
  activityPatterns,
  dependencyPatterns,
  recoveryPatterns,
  sourcePatternRef: 'dp-int-test-001',
  sourceTraceRefs: ['trace-1', 'trace-2', 'trace-3'],
  quality,
};

const discoveredPattern: DiscoveredProcessPattern = {
  patternId: 'dp-int-test-001',
  cohortFingerprint: 'cohort-int-test',
  algorithmVersion: 'sdar-process-mining/1.1',
  mandatoryActivities: ['observe_input', 'verify_constraint', 'execute_action'],
  optionalActivities: ['recover_failure'],
  orderingConstraints: [],
  parallelCandidates: [],
  recoveryBranches: [],
  failureVariants: [],
  supportRefs: ['trace-1', 'trace-2', 'trace-3'],
  contradictionRefs: [],
  environmentCoverage: ['test-env'],
  quality,
};

const knownCapabilities = [
  'capability.observe',
  'capability.verify',
  'capability.execute',
  'capability.recover',
];

describe('P04 candidate generation integration', () => {
  it('runs fusion → generalization → candidate → validation pipeline with real PostgreSQL', async () => {
    const fusion = new PatternFusionService();
    const fusedPattern = await fusion.fuse({
      workflowPattern,
      discoveredPattern,
      domain: 'int-test-domain',
      tenantId: 'tenant-int-test',
      environmentClasses: ['test-env'],
      deviceClasses: ['test-device'],
      model: new NoOpSemanticModel(),
      tenantScope: 'single',
      userScope: 'single',
    });
    expect(fusedPattern.structuralPattern.activityPatterns).toEqual(activityPatterns);
    expect(fusedPattern.confidence).toBeGreaterThan(0);

    const generalization = new PatternGeneralizationService();
    const generalizedPattern = generalization.generalize({
      fusedPattern,
      knownTaskTypeCapabilities: knownCapabilities,
    });
    expect(generalizedPattern.variables.length).toBeGreaterThan(0);

    const repository = new PostgresCandidateGenerationRepository(pool);
    await repository.saveGeneralizedPattern(generalizedPattern, 'tenant-int-test');

    const generator = new ArtifactCandidateGenerator();
    const candidate = generator.generate({
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: knownCapabilities,
      tenantId: 'tenant-int-test',
      createdAt: new Date().toISOString(),
    });

    expect(candidate.artifact.status).toBe('candidate');
    expect(candidate.artifact.artifactType).toBe('plan_template');
    expect(candidate.validation.result).toBe('passed_static');
    expect(candidate.validation.schemaValid).toBe(true);
    expect(candidate.validation.dagValid).toBe(true);

    await repository.saveFingerprint({
      fingerprint: candidate.fingerprint,
      artifactType: 'plan_template',
      domain: 'int-test-domain',
      taskTypeId: workflowPattern.taskTypeId,
      artifactRef: candidate.artifact.artifactId,
      generatorVersion: 'sdar-candidate-generator/1.1',
    });
    await repository.saveValidation(candidate.validation);

    const fp = await pool.query(
      'SELECT fingerprint FROM candidate_fingerprint WHERE artifact_ref = $1',
      [candidate.artifact.artifactId],
    );
    expect(fp.rows.length).toBe(1);
    expect((fp.rows[0] as { fingerprint: string }).fingerprint).toBe(candidate.fingerprint);

    const val = await pool.query(
      'SELECT result FROM candidate_static_validation WHERE artifact_ref = $1',
      [candidate.artifact.artifactId],
    );
    expect(val.rows.length).toBe(1);
    expect((val.rows[0] as { result: string }).result).toBe('passed_static');
  });

  it('rejects duplicate candidate fingerprint (AC-P04-012)', async () => {
    const fusion = new PatternFusionService();
    const fusedPattern = await fusion.fuse({
      workflowPattern,
      discoveredPattern,
      domain: 'dup-test-domain',
      tenantId: 'tenant-dup-test',
      environmentClasses: ['test-env'],
      deviceClasses: ['test-device'],
      model: new NoOpSemanticModel(),
      tenantScope: 'single',
      userScope: 'single',
    });
    const generalization = new PatternGeneralizationService();
    const generalizedPattern = generalization.generalize({
      fusedPattern,
      knownTaskTypeCapabilities: knownCapabilities,
    });
    const generator = new ArtifactCandidateGenerator();
    const candidate = generator.generate({
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: knownCapabilities,
      tenantId: 'tenant-dup-test',
      createdAt: new Date().toISOString(),
    });

    const repository = new PostgresCandidateGenerationRepository(pool);
    await repository.saveFingerprint({
      fingerprint: candidate.fingerprint,
      artifactType: 'plan_template',
      domain: 'dup-test-domain',
      taskTypeId: workflowPattern.taskTypeId,
      artifactRef: candidate.artifact.artifactId,
      generatorVersion: 'sdar-candidate-generator/1.1',
    });

    const existing = await repository.findExistingFingerprints(
      'plan_template',
      'dup-test-domain',
      workflowPattern.taskTypeId,
    );
    expect(existing).toContain(candidate.fingerprint);
  });

  it('worker is idempotent: same input produces same fingerprint (AC-P04-029)', async () => {
    const fusion = new PatternFusionService();
    const fusedPattern = await fusion.fuse({
      workflowPattern,
      discoveredPattern,
      domain: 'idem-test-domain',
      tenantId: 'tenant-idem-test',
      environmentClasses: ['test-env'],
      deviceClasses: ['test-device'],
      model: new NoOpSemanticModel(),
      tenantScope: 'single',
      userScope: 'single',
    });
    const generalization = new PatternGeneralizationService();
    const generalizedPattern = generalization.generalize({
      fusedPattern,
      knownTaskTypeCapabilities: knownCapabilities,
    });
    const generator = new ArtifactCandidateGenerator();
    const input = {
      generalizedPattern,
      fusedPattern,
      knownCapabilityIds: knownCapabilities,
      tenantId: 'tenant-idem-test',
      createdAt: '2026-07-28T00:00:00Z',
    };
    const c1 = generator.generate(input);
    const c2 = generator.generate(input);
    expect(c1.fingerprint).toBe(c2.fingerprint);
    expect(c1.artifact.artifactId).toBe(c2.artifact.artifactId);
  });

  it('recovers from Redis loss: PostgreSQL remains authoritative (AC-P04-030)', async () => {
    const repository = new PostgresCandidateGenerationRepository(pool);
    const fusion = new PatternFusionService();
    const fusedPattern = await fusion.fuse({
      workflowPattern,
      discoveredPattern,
      domain: 'redis-loss-domain',
      tenantId: 'tenant-redis-loss',
      environmentClasses: ['test-env'],
      deviceClasses: ['test-device'],
      model: new NoOpSemanticModel(),
      tenantScope: 'single',
      userScope: 'single',
    });
    const generalization = new PatternGeneralizationService();
    const generalizedPattern = generalization.generalize({
      fusedPattern,
      knownTaskTypeCapabilities: knownCapabilities,
    });
    await repository.saveGeneralizedPattern(generalizedPattern, 'tenant-redis-loss');

    const direct = await pool.query(
      'SELECT content FROM generalized_pattern WHERE generalized_pattern_id = $1',
      [generalizedPattern.generalizedPatternId],
    );
    expect(direct.rows.length).toBe(1);

    const refetched = await repository.loadGeneralizedPattern(
      generalizedPattern.generalizedPatternId,
    );
    expect(refetched).not.toBeNull();
    expect(refetched?.domain).toBe('redis-loss-domain');
  });
});
