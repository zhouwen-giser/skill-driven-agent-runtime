import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

import pg from 'pg';

import { buildInfrastructureImages } from './lib/infrastructure.mjs';

const { Pool } = pg;
const root = process.cwd();
const sourceDatabase = 'sdar_v123_frozen_source';
const databases = [
  'sdar_v122_verify_empty',
  'sdar_v122_verify_existing',
  'sdar_v122_verify_rogue_ledger',
  'sdar_v13_verify_upgrade',
  'sdar_v13_verify_interrupted',
  'sdar_v14_verify_control',
];
const controlDatabaseName = databases.at(-1);
const baselineFile = resolve(
  root,
  'infra',
  'postgres',
  'baseline',
  '0001_sdar_v1_2_2_baseline.sql',
);
const seedFile = resolve(root, 'infra', 'postgres', 'seed', '0001_sdar_v1_2_2_minimal_seed.sql');
const migrationDirectory = resolve(root, 'infra', 'postgres', 'migrations');
const controlMigrationDirectory = resolve(root, 'infra', 'postgres-control', 'migrations');
const postBaselineMigrationFiles = (await readdir(migrationDirectory))
  .filter((file) => /^01[0-9]{2}_v(?:123|13|14)_[a-z0-9_]+\.up\.sql$/u.test(file))
  .sort();
const v123MigrationFiles = postBaselineMigrationFiles.filter(
  (file) => file.startsWith('01') && file.slice(0, 4) <= '0124',
);
const v13MigrationFiles = postBaselineMigrationFiles.filter(
  (file) => file.startsWith('01') && file.slice(0, 4) >= '0125',
);
const controlMigrationFiles = (await readdir(controlMigrationDirectory))
  .filter((file) => /^\d{4}_[a-z0-9_]+\.up\.sql$/u.test(file))
  .sort();
const controlMigrationVersions = controlMigrationFiles.map((file) =>
  file.slice(0, -'.up.sql'.length),
);
const requiredRuntimeEvidenceLedgerMigration = '0146_v14_evidence_export_observation_ledger.up.sql';
const requiredControlEvidenceAuthorityMigration = '0009_canonical_evidence_authority.up.sql';
const requiredControlLineageMigration = '0010_smpp_registry_lineage_revalidation.up.sql';
const requiredControlCredentialMigration = '0011_explicit_unauthenticated_credentials.up.sql';
const requiredControlBindingHealthMigration = '0012_mcp_binding_registration_health.up.sql';
if (!postBaselineMigrationFiles.includes(requiredRuntimeEvidenceLedgerMigration)) {
  throw new Error(`V141_RUNTIME_EVIDENCE_LEDGER_MIGRATION_MISSING`);
}
if (!controlMigrationFiles.includes(requiredControlEvidenceAuthorityMigration)) {
  throw new Error(`V141_CONTROL_EVIDENCE_AUTHORITY_MIGRATION_MISSING`);
}
if (!controlMigrationFiles.includes(requiredControlLineageMigration)) {
  throw new Error(`V141_CONTROL_LINEAGE_MIGRATION_MISSING`);
}
if (!controlMigrationFiles.includes(requiredControlCredentialMigration)) {
  throw new Error(`UGV_CONTROL_CREDENTIAL_MIGRATION_MISSING`);
}
if (!controlMigrationFiles.includes(requiredControlBindingHealthMigration)) {
  throw new Error('CONTROL_BINDING_HEALTH_MIGRATION_MISSING');
}
await assertMigrationFilePairs(migrationDirectory, postBaselineMigrationFiles, 'V13');
await assertMigrationFilePairs(controlMigrationDirectory, controlMigrationFiles, 'V14_CONTROL');
assertContiguousControlMigrationVersions(controlMigrationVersions);
const controlEvidenceAuthorityVersion = requiredControlEvidenceAuthorityMigration.slice(
  0,
  -'.up.sql'.length,
);
const controlLineageVersion = requiredControlLineageMigration.slice(0, -'.up.sql'.length);
const controlCredentialVersion = requiredControlCredentialMigration.slice(0, -'.up.sql'.length);
const controlBindingHealthVersion = requiredControlBindingHealthMigration.slice(
  0,
  -'.up.sql'.length,
);
if (
  JSON.stringify(controlMigrationVersions.slice(-4)) !==
  JSON.stringify([
    controlEvidenceAuthorityVersion,
    controlLineageVersion,
    controlCredentialVersion,
    controlBindingHealthVersion,
  ])
) {
  throw new Error('CONTROL_BINDING_HEALTH_MIGRATION_ORDER_INVALID');
}
const expectedVersions = [
  'v1.2.2_clean_slate_baseline',
  ...postBaselineMigrationFiles.map((file) => file.slice(0, -'.up.sql'.length)),
];
const expectedV123Versions = [
  'v1.2.2_clean_slate_baseline',
  ...v123MigrationFiles.map((file) => file.slice(0, -'.up.sql'.length)),
];
const checksumSources = [
  {
    version: 'v1.2.2_clean_slate_baseline',
    filePath: baselineFile,
  },
  ...postBaselineMigrationFiles.map((file) => ({
    version: file.slice(0, -'.up.sql'.length),
    filePath: resolve(migrationDirectory, file),
  })),
];
const v123FrozenComposeImage =
  'pgvector/pgvector@sha256:69573b32242ca232f65871d4cb916ba7210a372b9bd74068204c1a9a57bada4f';
const v13AlpineImage = 'sdar/postgres-pgvector:17.10-0.8.5-alpine3.23';
const postgresUser = 'sdar';
const postgresPassword = 'sdar_local_only';
const startedAt = new Date();
const writeP13Evidence = process.argv.includes('--report');
let adminUrl;
let sourceAdminUrl;
let isolatedInfrastructure;
let migrationInfrastructureEvidence;

try {
  isolatedInfrastructure = await startIsolatedMigrationInfrastructure();
  adminUrl = isolatedInfrastructure.targetAdminUrl;
  sourceAdminUrl = isolatedInfrastructure.sourceAdminUrl;
  migrationInfrastructureEvidence = isolatedInfrastructure.evidence;
  const { applyRuntimeMigrations } = await import(
    `../dist/apps/server/src/runtime.js?baseline-check=${String(Date.now())}`
  );
  const { applyControlMigrations, rollbackLatestControlMigration } = await import(
    `../dist/packages/node-control-persistence-postgres/src/migrations.js?control-baseline-check=${String(Date.now())}`
  );
  await recreateDatabases();
  await recreateSourceDatabase();

  const emptyPool = databasePool(databases[0]);
  try {
    await applyRuntimeMigrations(emptyPool);
    await verifyBaseline(emptyPool);
    await applyRuntimeMigrations(emptyPool);
    await verifyBaseline(emptyPool);
    await rollbackPostBaselineMigrations(emptyPool);
    await verifyPostBaselineMigrationsRolledBack(emptyPool);
    await applyRuntimeMigrations(emptyPool);
    await verifyBaseline(emptyPool);
  } finally {
    await emptyPool.end();
  }

  const existingPool = databasePool(databases[1]);
  try {
    await existingPool.query('CREATE TABLE operator_data(id text PRIMARY KEY)');
    await expectCleanDatabaseRejection(applyRuntimeMigrations, existingPool, 'existing-table');
    const preserved = await existingPool.query(
      "SELECT to_regclass('public.operator_data') IS NOT NULL AS preserved",
    );
    if (preserved.rows[0]?.preserved !== true)
      throw new Error('CLEAN_DATABASE_REJECTION_DESTROYED_EXISTING_DATA');
    verifyResetRejected(
      {
        SDAR_ENV: 'production',
        SDAR_ALLOW_DESTRUCTIVE_RESET: 'v1.2.2',
        SDAR_POSTGRES_URL: databaseUrl(databases[1]),
      },
      'V122_RESET_ENVIRONMENT_REJECTED',
    );
    verifyResetRejected(
      {
        SDAR_ENV: 'test',
        SDAR_ALLOW_DESTRUCTIVE_RESET: 'v1.2.2',
        SDAR_POSTGRES_URL: databaseUrl('sdar'),
      },
      'V122_RESET_DATABASE_NAME_REJECTED',
    );
    runReset(databaseUrl(databases[1]));
    await applyRuntimeMigrations(existingPool);
    await verifyBaseline(existingPool);
    const seed = await existingPool.query(
      `SELECT
         EXISTS(SELECT 1 FROM evolution_policy WHERE singleton=true) AS evolution,
         EXISTS(SELECT 1 FROM memory_retention_policy WHERE singleton=true) AS memory`,
    );
    if (seed.rows[0]?.evolution !== true || seed.rows[0]?.memory !== true)
      throw new Error('V122_MINIMAL_SEED_MISSING');
  } finally {
    await existingPool.end();
  }

  if (controlDatabaseName === undefined) throw new Error('V14_CONTROL_DATABASE_NAME_MISSING');
  const controlPool = databasePool(controlDatabaseName);
  try {
    await applyControlMigrations(controlPool, controlMigrationDirectory);
    await verifyControlBaseline(controlPool);
    await applyControlMigrations(controlPool, controlMigrationDirectory);
    await verifyControlBaseline(controlPool);
    const rolledBackBindingHealth = await rollbackLatestControlMigration(
      controlPool,
      controlMigrationDirectory,
    );
    if (rolledBackBindingHealth !== controlBindingHealthVersion) {
      throw new Error('CONTROL_BINDING_HEALTH_ROLLBACK_HEAD_INVALID');
    }
    const healthProjection = await controlPool.query(
      `SELECT to_regclass('sdar_control.mcp_provider_binding_projection') AS projection,
              to_regclass('sdar_control.mcp_provider_binding_state') AS state`,
    );
    if (healthProjection.rows[0]?.projection !== null || healthProjection.rows[0]?.state !== null) {
      throw new Error('CONTROL_BINDING_HEALTH_ROLLBACK_INCOMPLETE');
    }
    const rolledBackCredential = await rollbackLatestControlMigration(
      controlPool,
      controlMigrationDirectory,
    );
    if (rolledBackCredential !== controlCredentialVersion) {
      throw new Error(
        `UGV_CONTROL_CREDENTIAL_ROLLBACK_HEAD_INVALID:${String(rolledBackCredential)}:${controlCredentialVersion}`,
      );
    }
    await verifyControlCredentialMigrationRolledBack(controlPool);
    const rolledBackLineage = await rollbackLatestControlMigration(
      controlPool,
      controlMigrationDirectory,
    );
    if (rolledBackLineage !== controlLineageVersion) {
      throw new Error(
        `V141_CONTROL_LINEAGE_ROLLBACK_HEAD_INVALID:${String(rolledBackLineage)}:${controlLineageVersion}`,
      );
    }
    await verifyControlLineageMigrationRolledBack(controlPool);
    const rolledBackEvidence = await rollbackLatestControlMigration(
      controlPool,
      controlMigrationDirectory,
    );
    if (rolledBackEvidence !== controlEvidenceAuthorityVersion) {
      throw new Error(
        `V141_CONTROL_EVIDENCE_ROLLBACK_HEAD_INVALID:${String(rolledBackEvidence)}:${controlEvidenceAuthorityVersion}`,
      );
    }
    await verifyControlEvidenceMigrationRolledBack(controlPool);
    await applyControlMigrations(controlPool, controlMigrationDirectory);
    await verifyControlBaseline(controlPool);
    await expectControlChecksumDriftRejection(controlPool, applyControlMigrations);
    await expectControlRogueLedgerRejection(controlPool, applyControlMigrations);
    await verifyControlBaseline(controlPool);
  } finally {
    await controlPool.end();
  }

  const roguePool = databasePool(databases[2]);
  try {
    await applyRuntimeMigrations(roguePool);
    await roguePool.query("INSERT INTO schema_migration(version) VALUES ('9999_unknown')");
    await expectLedgerRejection(applyRuntimeMigrations, roguePool);
  } finally {
    await roguePool.end();
  }

  const upgradePool = databasePool(databases[3]);
  try {
    const logicalUpgrade = await restoreFrozenV123LogicalBackup(upgradePool);
    migrationInfrastructureEvidence.logicalUpgrade = logicalUpgrade;
    await applyRuntimeMigrations(upgradePool);
    await verifyBaseline(upgradePool);
    await verifyRepresentativeDataPreserved(upgradePool, logicalUpgrade.representativeSnapshot);
    await verifyMigrationChecksumLedger(upgradePool);
    await expectChecksumDriftRejection(upgradePool, v13MigrationFiles[0]);
  } finally {
    await upgradePool.end();
  }

  const interruptedPool = databasePool(databases[4]);
  try {
    await applyV122BaselineAndSeed(interruptedPool);
    await applyMigrationFiles(interruptedPool, v123MigrationFiles);
    await verifyMigrationPrefix(interruptedPool, expectedV123Versions);
    await verifyMigrationChecksumLedger(interruptedPool);
    await simulateInterruptedMigration(interruptedPool, v13MigrationFiles[0]);
    await verifyInterruptedMigrationRolledBack(interruptedPool, v13MigrationFiles[0]);
    await applyRuntimeMigrations(interruptedPool);
    await verifyBaseline(interruptedPool);
    await verifyMigrationChecksumLedger(interruptedPool);
  } finally {
    await interruptedPool.end();
  }

  await dropDatabases();
  await stopIsolatedMigrationInfrastructure(isolatedInfrastructure);
  isolatedInfrastructure = undefined;
  migrationInfrastructureEvidence.isolation.cleanupCompleted = true;
  if (writeP13Evidence)
    await writeMigrationReport({
      status: 'passed',
      startedAt,
      finishedAt: new Date(),
    });
  process.stdout.write(
    `SDAR migration path verified: exact frozen v1.2.3 Compose image logical backup/restore into hardened Alpine, ${String(postBaselineMigrationFiles.length)} additive migrations through ${expectedVersions.at(-1)}, plus ${String(controlMigrationFiles.length)} independent Control migrations through ${controlMigrationVersions.at(-1)}, idempotency, rollback/reapply, guarded reset, rogue-ledger rejection, representative data preservation, transactional interruption recovery, and incremental SHA-256 checksum drift rejection.\n`,
  );
} catch (error) {
  if (writeP13Evidence)
    await writeMigrationReport({
      status: 'failed',
      startedAt,
      finishedAt: new Date(),
      failure: error instanceof Error ? error.message : String(error),
    });
  throw error;
} finally {
  await dropDatabases().catch(() => undefined);
  if (isolatedInfrastructure !== undefined)
    await stopIsolatedMigrationInfrastructure(isolatedInfrastructure).catch(() => undefined);
}

async function writeMigrationReport({ status, startedAt, finishedAt, failure }) {
  const report = {
    schemaVersion: '1.0',
    packageId: 'SDAR-V1.3-P13',
    status,
    classification: 'real isolated local Docker PostgreSQL migration and upgrade evidence',
    command: 'pnpm evidence:v13-migration',
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      databaseNames: databases,
      isolatedDocker: migrationInfrastructureEvidence ?? null,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    baseline: {
      release: 'v1.2.3-final',
      commit: '856f909d22c33e6e20d7e0a1cffc2f54c03b4477',
      migrationHead: expectedV123Versions.at(-1),
      migrationCount: v123MigrationFiles.length,
    },
    candidate: {
      migrationHead: expectedVersions.at(-1),
      additiveMigrationCount: postBaselineMigrationFiles.length,
      v13MigrationCount: v13MigrationFiles.length,
      controlMigrationHead: controlMigrationVersions.at(-1),
      controlMigrationCount: controlMigrationFiles.length,
    },
    scenarios: {
      freshInstall: status,
      idempotentReapply: status,
      rollbackAndReapply: status,
      guardedDevelopmentReset: status,
      existingDatabaseRejection: status,
      rogueLedgerRejection: status,
      v123RepresentativeUpgrade: status,
      frozenV123ImageToAlpineLogicalBackupRestore: status,
      representativeFacts: [
        'Goal',
        'Plan',
        'Skill Attempt',
        'Outcome',
        'Experience',
        'Tenant/User',
        'Provider',
        'A2A Task',
      ],
      noRepresentativeDataLoss: status === 'passed',
      transactionalInterruptionRollback: status,
      migrationChecksumDriftRejection: status,
      controlFreshInstall: status,
      controlIdempotentReapply: status,
      controlRollbackAndReapply: status,
      controlRogueLedgerRejection: status,
      controlMigrationChecksumDriftRejection: status,
      postgresqlRestart:
        'covered independently by reports/goal/v1.3-final-chaos-recovery-report.json',
    },
    authority: {
      releasedMigrationSqlModifiedByVerifier: false,
      physicalPgdataReuseAttempted: false,
      existingComposeVolumeMounted: false,
      existingComposeContainerModified: false,
      sourceVolumePreservedUntilTargetVerification: true,
      checksumLedger:
        'verifier-only sidecar populated from SHA-256 of the released baseline and additive SQL',
      productionResetAttempted: false,
      productionDataUsed: false,
    },
    retainedFirstFailures: [
      {
        command: 'pnpm verify:migrations',
        cause: 'the managed Windows sandbox initially denied access to the Docker named pipe',
        repair:
          'reran the same repository command with the user-authorized Docker execution permission',
        result: 'passed without changing migration semantics',
      },
      {
        command: 'node scripts/verify-migration-path.mjs --report',
        cause:
          'the hardened musl/Alpine container reused the existing Debian-initialized compose PGDATA; CREATE DATABASE failed with "template database template1 has a collation version, but no actual collation version could be determined"',
        repair:
          'the verifier now uses uniquely named isolated source/target volumes and transfers the exact v1.2.3 schema and representative facts with pg_dump/pg_restore instead of mounting the old physical PGDATA',
        result:
          status === 'passed'
            ? 'passed; the existing compose volume and container were not mounted, deleted, reset, or overwritten'
            : 'failed; existing compose resources still were not modified',
      },
    ],
    ...(failure === undefined ? {} : { failure }),
  };
  const reportDirectory = resolve(root, 'reports', 'goal');
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, 'v1.3-final-migration-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function assertMigrationFilePairs(directory, upFiles, codePrefix) {
  const names = new Set(await readdir(directory));
  for (const upFile of upFiles) {
    const downFile = upFile.replace(/\.up\.sql$/u, '.down.sql');
    if (!names.has(downFile)) {
      throw new Error(`${codePrefix}_MIGRATION_DOWN_MISSING:${downFile}`);
    }
  }
}

function assertContiguousControlMigrationVersions(versions) {
  for (const [index, version] of versions.entries()) {
    const expectedPrefix = `${String(index + 1).padStart(4, '0')}_`;
    if (!version.startsWith(expectedPrefix)) {
      throw new Error(`V14_CONTROL_MIGRATION_GAP:${expectedPrefix}:${String(version)}`);
    }
  }
}

async function verifyControlBaseline(pool) {
  const ledger = await pool.query(
    `SELECT version, checksum::text AS checksum
       FROM sdar_control.control_schema_migration
      ORDER BY version`,
  );
  if (
    JSON.stringify(ledger.rows.map(({ version }) => version)) !==
    JSON.stringify(controlMigrationVersions)
  ) {
    throw new Error('V14_CONTROL_MIGRATION_MARKERS_INVALID');
  }
  for (const [index, file] of controlMigrationFiles.entries()) {
    const row = ledger.rows[index];
    const expectedChecksum = createHash('sha256')
      .update(await readFile(resolve(controlMigrationDirectory, file)))
      .digest('hex');
    if (row?.checksum !== expectedChecksum) {
      throw new Error(`V14_CONTROL_MIGRATION_CHECKSUM_INVALID:${String(row?.version)}`);
    }
  }

  const authority = await pool.query(
    `SELECT
       to_regclass('sdar_control.node_control_evidence_observation')::text AS observation_table,
       to_regclass('sdar_control.node_health_observation')::text AS health_table,
       to_regclass('sdar_control.node_event_outbox')::text AS node_event_table,
       to_regprocedure('sdar_control.capture_node_control_evidence_observation()')::text
         AS capture_function,
       to_regclass('public.schema_migration') IS NULL AS runtime_ledger_absent,
       (SELECT count(*)::integer
          FROM pg_trigger
         WHERE tgname LIKE 'evidence_observe_%' AND NOT tgisinternal) AS observation_triggers`,
  );
  const row = authority.rows[0];
  if (
    row?.observation_table !== 'sdar_control.node_control_evidence_observation' ||
    row?.health_table !== 'sdar_control.node_health_observation' ||
    row?.node_event_table !== 'sdar_control.node_event_outbox' ||
    row?.capture_function !== 'sdar_control.capture_node_control_evidence_observation()' ||
    row?.runtime_ledger_absent !== true ||
    row?.observation_triggers !== 19
  ) {
    throw new Error(`V141_CONTROL_EVIDENCE_AUTHORITY_INVALID:${JSON.stringify(row)}`);
  }

  const lineage = await pool.query(
    `SELECT
       to_regclass('sdar_control.smpp_registry_snapshot_lineage')::text AS lineage_table,
       to_regprocedure('sdar_control.protect_smpp_source_definition()')::text
         AS protect_function,
       position(
         'active_snapshot_valid_until' IN
         pg_get_functiondef(to_regprocedure('sdar_control.protect_smpp_source_definition()'))
       ) > 0 AS protect_allows_active_snapshot_valid_until,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema='sdar_control'
           AND table_name='smpp_registry_source'
           AND column_name='active_snapshot_valid_until') AS source_validity_columns,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema='sdar_control'
           AND table_name='smpp_registry_sync_attempt'
           AND column_name IN (
             'observed_native_revision','observed_native_checksum',
             'observed_projection_contract','observed_valid_until'
           )) AS attempt_lineage_columns,
       (SELECT count(*)::integer
          FROM pg_constraint
         WHERE connamespace='sdar_control'::regnamespace
           AND conname IN (
             'smpp_registry_source_active_validity_consistent',
             'smpp_registry_sync_attempt_native_lineage_consistent'
           )) AS lineage_constraints,
       (SELECT count(*)::integer
          FROM pg_trigger
         WHERE tgname='smpp_registry_snapshot_lineage_immutable'
           AND tgrelid=to_regclass('sdar_control.smpp_registry_snapshot_lineage')
           AND NOT tgisinternal) AS lineage_triggers`,
  );
  const lineageRow = lineage.rows[0];
  if (
    lineageRow?.lineage_table !== 'sdar_control.smpp_registry_snapshot_lineage' ||
    lineageRow?.protect_function !== 'sdar_control.protect_smpp_source_definition()' ||
    lineageRow?.protect_allows_active_snapshot_valid_until !== true ||
    lineageRow?.source_validity_columns !== 1 ||
    lineageRow?.attempt_lineage_columns !== 4 ||
    lineageRow?.lineage_constraints !== 2 ||
    lineageRow?.lineage_triggers !== 1
  ) {
    throw new Error(`V141_CONTROL_LINEAGE_AUTHORITY_INVALID:${JSON.stringify(lineageRow)}`);
  }

  const credentialConstraints = await pool.query(
    `SELECT conname AS constraint_name,pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE connamespace='sdar_control'::regnamespace
        AND conname IN (
          'smpp_registry_source_credential_ref_check',
          'mcp_provider_binding_credential_ref_check'
        )
      ORDER BY conname`,
  );
  if (
    credentialConstraints.rows.length !== 2 ||
    credentialConstraints.rows.some(
      ({ definition }) =>
        typeof definition !== 'string' || !definition.includes("'unauthenticated://none'"),
    )
  ) {
    throw new Error(
      `UGV_CONTROL_CREDENTIAL_CONSTRAINTS_INVALID:${JSON.stringify(credentialConstraints.rows)}`,
    );
  }
}

async function verifyControlCredentialMigrationRolledBack(pool) {
  const ledger = await pool.query(
    `SELECT array_agg(version ORDER BY version) AS versions
       FROM sdar_control.control_schema_migration`,
  );
  if (
    JSON.stringify(ledger.rows[0]?.versions) !==
    JSON.stringify(controlMigrationVersions.slice(0, -1))
  ) {
    throw new Error('UGV_CONTROL_CREDENTIAL_ROLLBACK_MARKERS_INVALID');
  }
  const constraints = await pool.query(
    `SELECT conname AS constraint_name,pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE connamespace='sdar_control'::regnamespace
        AND conname IN (
          'smpp_registry_source_credential_ref_check',
          'mcp_provider_binding_credential_ref_check'
        )
      ORDER BY conname`,
  );
  if (
    constraints.rows.length !== 2 ||
    constraints.rows.some(
      ({ definition }) =>
        typeof definition !== 'string' || definition.includes('unauthenticated://'),
    )
  ) {
    throw new Error(
      `UGV_CONTROL_CREDENTIAL_ROLLBACK_INCOMPLETE:${JSON.stringify(constraints.rows)}`,
    );
  }
}

async function verifyControlLineageMigrationRolledBack(pool) {
  const ledger = await pool.query(
    `SELECT array_agg(version ORDER BY version) AS versions
       FROM sdar_control.control_schema_migration`,
  );
  if (
    JSON.stringify(ledger.rows[0]?.versions) !==
    JSON.stringify(controlMigrationVersions.slice(0, -2))
  ) {
    throw new Error('V141_CONTROL_LINEAGE_ROLLBACK_MARKERS_INVALID');
  }
  const state = await pool.query(
    `SELECT
       to_regclass('sdar_control.smpp_registry_snapshot_lineage') IS NULL
         AS lineage_table_absent,
       to_regprocedure('sdar_control.protect_smpp_source_definition()')::text
         AS protect_function,
       position(
         'active_snapshot_valid_until' IN
         pg_get_functiondef(to_regprocedure('sdar_control.protect_smpp_source_definition()'))
       ) > 0 AS protect_allows_active_snapshot_valid_until,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema='sdar_control'
           AND table_name='smpp_registry_source'
           AND column_name='active_snapshot_valid_until') AS source_validity_columns,
       (SELECT count(*)::integer
          FROM information_schema.columns
         WHERE table_schema='sdar_control'
           AND table_name='smpp_registry_sync_attempt'
           AND column_name IN (
             'observed_native_revision','observed_native_checksum',
             'observed_projection_contract','observed_valid_until'
           )) AS attempt_lineage_columns,
       (SELECT count(*)::integer
          FROM pg_constraint
         WHERE connamespace='sdar_control'::regnamespace
           AND conname IN (
             'smpp_registry_source_active_validity_consistent',
             'smpp_registry_sync_attempt_native_lineage_consistent'
           )) AS lineage_constraints,
       (SELECT count(*)::integer
          FROM pg_trigger
         WHERE tgname='smpp_registry_snapshot_lineage_immutable'
           AND NOT tgisinternal) AS lineage_triggers,
       to_regclass('sdar_control.node_control_evidence_observation')::text
         AS observation_table,
       to_regclass('sdar_control.node_health_observation')::text AS health_table,
       to_regprocedure('sdar_control.capture_node_control_evidence_observation()')::text
         AS capture_function,
       (SELECT count(*)::integer
          FROM pg_trigger
         WHERE tgname LIKE 'evidence_observe_%' AND NOT tgisinternal) AS observation_triggers`,
  );
  const row = state.rows[0];
  if (
    row?.lineage_table_absent !== true ||
    row?.protect_function !== 'sdar_control.protect_smpp_source_definition()' ||
    row?.protect_allows_active_snapshot_valid_until !== false ||
    row?.source_validity_columns !== 0 ||
    row?.attempt_lineage_columns !== 0 ||
    row?.lineage_constraints !== 0 ||
    row?.lineage_triggers !== 0 ||
    row?.observation_table !== 'sdar_control.node_control_evidence_observation' ||
    row?.health_table !== 'sdar_control.node_health_observation' ||
    row?.capture_function !== 'sdar_control.capture_node_control_evidence_observation()' ||
    row?.observation_triggers !== 19
  ) {
    throw new Error(`V141_CONTROL_LINEAGE_ROLLBACK_INCOMPLETE:${JSON.stringify(row)}`);
  }
}

async function verifyControlEvidenceMigrationRolledBack(pool) {
  const ledger = await pool.query(
    `SELECT array_agg(version ORDER BY version) AS versions
       FROM sdar_control.control_schema_migration`,
  );
  if (
    JSON.stringify(ledger.rows[0]?.versions) !==
    JSON.stringify(controlMigrationVersions.slice(0, -3))
  ) {
    throw new Error('V141_CONTROL_EVIDENCE_ROLLBACK_MARKERS_INVALID');
  }
  const state = await pool.query(
    `SELECT
       to_regclass('sdar_control.node_control_evidence_observation') IS NULL
         AS observation_table_absent,
       to_regclass('sdar_control.node_health_observation') IS NULL AS health_table_absent,
       to_regclass('sdar_control.node_event_outbox')::text AS node_event_table,
       to_regprocedure('sdar_control.capture_node_control_evidence_observation()') IS NULL
         AS capture_function_absent,
       to_regclass('sdar_control.smpp_registry_snapshot_lineage') IS NULL
         AS lineage_table_absent,
       to_regclass('public.schema_migration') IS NULL AS runtime_ledger_absent,
       (SELECT count(*)::integer
          FROM pg_trigger
         WHERE tgname LIKE 'evidence_observe_%' AND NOT tgisinternal) AS observation_triggers`,
  );
  const row = state.rows[0];
  if (
    row?.observation_table_absent !== true ||
    row?.health_table_absent !== true ||
    row?.node_event_table !== 'sdar_control.node_event_outbox' ||
    row?.capture_function_absent !== true ||
    row?.lineage_table_absent !== true ||
    row?.runtime_ledger_absent !== true ||
    row?.observation_triggers !== 0
  ) {
    throw new Error(`V141_CONTROL_EVIDENCE_ROLLBACK_INCOMPLETE:${JSON.stringify(row)}`);
  }
}

async function expectControlChecksumDriftRejection(pool, applyControlMigrations) {
  const version = controlMigrationVersions.at(-1);
  if (version === undefined) throw new Error('V14_CONTROL_CHECKSUM_FIXTURE_MISSING');
  const recorded = await pool.query(
    `SELECT checksum::text AS checksum
       FROM sdar_control.control_schema_migration
      WHERE version=$1`,
    [version],
  );
  const checksum = recorded.rows[0]?.checksum;
  if (typeof checksum !== 'string') throw new Error('V14_CONTROL_CHECKSUM_RECORD_MISSING');
  const drifted = checksum.startsWith('0') ? '1'.repeat(64) : '0'.repeat(64);
  await pool.query(
    'UPDATE sdar_control.control_schema_migration SET checksum=$2 WHERE version=$1',
    [version, drifted],
  );
  let rejected = false;
  try {
    await applyControlMigrations(pool, controlMigrationDirectory);
  } catch (error) {
    if (controlMigrationErrorCode(error) !== 'CONTROL_MIGRATION_CHECKSUM_DRIFT') throw error;
    rejected = true;
  } finally {
    await pool.query(
      'UPDATE sdar_control.control_schema_migration SET checksum=$2 WHERE version=$1',
      [version, checksum],
    );
  }
  if (!rejected) throw new Error(`V14_CONTROL_MIGRATION_CHECKSUM_DRIFT_ACCEPTED:${version}`);
}

async function expectControlRogueLedgerRejection(pool, applyControlMigrations) {
  const version = '9999_verifier_only_rogue';
  await pool.query(
    `INSERT INTO sdar_control.control_schema_migration(version,checksum)
     VALUES ($1,$2)`,
    [version, '0'.repeat(64)],
  );
  let rejected = false;
  try {
    await applyControlMigrations(pool, controlMigrationDirectory);
  } catch (error) {
    if (controlMigrationErrorCode(error) !== 'CONTROL_MIGRATION_ROGUE_LEDGER') throw error;
    rejected = true;
  } finally {
    await pool.query('DELETE FROM sdar_control.control_schema_migration WHERE version=$1', [
      version,
    ]);
  }
  if (!rejected) throw new Error('V14_CONTROL_MIGRATION_ROGUE_LEDGER_ACCEPTED');
}

function controlMigrationErrorCode(error) {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function startIsolatedMigrationInfrastructure() {
  const runId = `${String(process.pid)}-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const resources = {
    sourceContainer: `sdar-p13-migration-source-${runId}`,
    sourceVolume: `sdar-p13-migration-source-data-${runId}`,
    targetContainer: `sdar-p13-migration-target-${runId}`,
    targetVolume: `sdar-p13-migration-target-data-${runId}`,
  };
  try {
    buildInfrastructureImages(root);
    ensureDockerImage(v123FrozenComposeImage, true);
    ensureDockerImage(v13AlpineImage, false);
    for (const volume of [resources.sourceVolume, resources.targetVolume]) {
      runDocker([
        'volume',
        'create',
        '--label',
        'io.sdar.scope=p13-migration-verifier',
        '--label',
        `io.sdar.run=${runId}`,
        volume,
      ]);
    }
    runPostgresContainer({
      container: resources.sourceContainer,
      volume: resources.sourceVolume,
      image: v123FrozenComposeImage,
      runId,
    });
    runPostgresContainer({
      container: resources.targetContainer,
      volume: resources.targetVolume,
      image: v13AlpineImage,
      runId,
    });
    await Promise.all([
      waitForPostgres(resources.sourceContainer),
      waitForPostgres(resources.targetContainer),
    ]);
    const sourcePort = publishedPostgresPort(resources.sourceContainer);
    const targetPort = publishedPostgresPort(resources.targetContainer);
    const sourceImage = inspectDockerImage(v123FrozenComposeImage);
    const targetImage = inspectDockerImage(v13AlpineImage);
    const registryManifests = writeP13Evidence
      ? {
          frozenV123ComposePin: inspectRemoteOciIndex(v123FrozenComposeImage),
        }
      : {
          verification:
            'deferred to evidence mode; normal migration verification remains runnable from pinned local images',
        };
    if (
      !sourceImage.repoDigests.includes(v123FrozenComposeImage) ||
      ('frozenV123ComposePin' in registryManifests &&
        registryManifests.frozenV123ComposePin.requestedReference !== v123FrozenComposeImage)
    )
      throw new Error('V13_FROZEN_V123_SOURCE_IMAGE_DRIFT');
    const sourceContainerImageId = containerImageId(resources.sourceContainer);
    const targetContainerImageId = containerImageId(resources.targetContainer);
    if (sourceContainerImageId !== sourceImage.imageId)
      throw new Error('V13_SOURCE_CONTAINER_IMAGE_DRIFT');
    if (targetContainerImageId !== targetImage.imageId)
      throw new Error('V13_TARGET_CONTAINER_IMAGE_DRIFT');
    return {
      ...resources,
      sourceAdminUrl: postgresUrl(sourcePort, 'postgres'),
      targetAdminUrl: postgresUrl(targetPort, 'postgres'),
      evidence: {
        runId,
        isolation: {
          uniqueContainers: true,
          uniqueVolumes: true,
          sharedComposeNetworkUsed: false,
          existingComposeResourcesTouched: false,
          cleanupCompleted: false,
        },
        baselineComposeImageAtExactV123Commit: v123FrozenComposeImage,
        registryManifests,
        source: {
          container: resources.sourceContainer,
          volume: resources.sourceVolume,
          hostPort: sourcePort,
          requestedImage: v123FrozenComposeImage,
          imageId: sourceImage.imageId,
          repoDigests: sourceImage.repoDigests,
          postgresVersionEnvironment: sourceImage.postgresVersionEnvironment,
          os: readContainerOsRelease(resources.sourceContainer),
        },
        target: {
          container: resources.targetContainer,
          volume: resources.targetVolume,
          hostPort: targetPort,
          requestedImage: v13AlpineImage,
          imageId: targetImage.imageId,
          repoDigests: targetImage.repoDigests,
          postgresVersionEnvironment: targetImage.postgresVersionEnvironment,
          os: readContainerOsRelease(resources.targetContainer),
        },
      },
    };
  } catch (error) {
    await stopIsolatedMigrationInfrastructure(resources).catch(() => undefined);
    throw error;
  }
}

async function stopIsolatedMigrationInfrastructure(resources) {
  const failures = [];
  for (const container of [resources.sourceContainer, resources.targetContainer]) {
    const result = tryDocker(['rm', '--force', container], { timeout: 60_000 });
    if (result.status !== 0 && !dockerResourceWasAbsent(result)) {
      failures.push(`container:${container}`);
    }
  }
  for (const volume of [resources.sourceVolume, resources.targetVolume]) {
    const result = tryDocker(['volume', 'rm', volume], { timeout: 60_000 });
    if (result.status !== 0 && !dockerResourceWasAbsent(result)) {
      failures.push(`volume:${volume}`);
    }
  }
  if (failures.length > 0)
    throw new Error(`V13_ISOLATED_DOCKER_CLEANUP_FAILED:${failures.join(',')}`);
}

function runPostgresContainer({ container, volume, image, runId }) {
  runDocker(
    [
      'run',
      '--detach',
      '--pull=never',
      '--platform',
      'linux/amd64',
      '--name',
      container,
      '--label',
      'io.sdar.scope=p13-migration-verifier',
      '--label',
      `io.sdar.run=${runId}`,
      '--env',
      `POSTGRES_USER=${postgresUser}`,
      '--env',
      `POSTGRES_PASSWORD=${postgresPassword}`,
      '--env',
      'POSTGRES_DB=postgres',
      '--publish',
      '127.0.0.1::5432',
      '--mount',
      `type=volume,source=${volume},target=/var/lib/postgresql/data`,
      image,
    ],
    { timeout: 120_000 },
  );
}

async function waitForPostgres(container) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = tryDocker([
      'exec',
      container,
      'pg_isready',
      '--username',
      postgresUser,
      '--dbname',
      'postgres',
    ]);
    if (result.status === 0) return;
    await delay(500);
  }
  const logs = tryDocker(['logs', '--tail', '80', container], { timeout: 30_000 });
  throw new Error(
    `V13_ISOLATED_POSTGRES_NOT_READY:${container}:${redactDockerOutput(logs.stderr ?? logs.stdout)}`,
  );
}

function publishedPostgresPort(container) {
  const output = runDocker(['port', container, '5432/tcp']);
  const match = /127\.0\.0\.1:(?<port>[0-9]+)/u.exec(String(output));
  if (match?.groups?.port === undefined)
    throw new Error(`V13_ISOLATED_POSTGRES_PORT_MISSING:${container}`);
  return Number.parseInt(match.groups.port, 10);
}

function postgresUrl(port, database) {
  const url = new URL('postgresql://127.0.0.1');
  url.username = postgresUser;
  url.password = postgresPassword;
  url.port = String(port);
  url.pathname = `/${database}`;
  return url.toString();
}

function ensureDockerImage(image, pullIfMissing) {
  const inspected = tryDocker(['image', 'inspect', image], { timeout: 30_000 });
  if (inspected.status === 0) return;
  if (pullIfMissing) {
    runDocker(['pull', image], { timeout: 300_000 });
    return;
  }
  throw new Error(
    `V13_TARGET_IMAGE_MISSING:${image}:build the repository-owned hardened image before migration verification`,
  );
}

function inspectDockerImage(image) {
  const records = JSON.parse(String(runDocker(['image', 'inspect', image])));
  const record = records[0];
  if (record === undefined || typeof record.Id !== 'string')
    throw new Error(`V13_DOCKER_IMAGE_INSPECT_INVALID:${image}`);
  const environment = Array.isArray(record.Config?.Env) ? record.Config.Env : [];
  return {
    imageId: record.Id,
    repoDigests: Array.isArray(record.RepoDigests) ? record.RepoDigests : [],
    postgresVersionEnvironment:
      environment.find((value) => value.startsWith('PG_VERSION='))?.slice('PG_VERSION='.length) ??
      null,
  };
}

function inspectRemoteOciIndex(image) {
  const index = JSON.parse(
    String(
      runDocker(['buildx', 'imagetools', 'inspect', image, '--raw'], {
        timeout: 120_000,
      }),
    ),
  );
  const requestedDigest = image.split('@').at(-1);
  const linuxAmd64 = index.manifests?.find(
    (manifest) => manifest.platform?.os === 'linux' && manifest.platform?.architecture === 'amd64',
  );
  if (
    index.mediaType !== 'application/vnd.oci.image.index.v1+json' ||
    typeof requestedDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(requestedDigest) ||
    typeof linuxAmd64?.digest !== 'string'
  ) {
    throw new Error(`V13_OCI_INDEX_EVIDENCE_INVALID:${image}`);
  }
  return {
    requestedReference: image,
    mediaType: index.mediaType,
    indexDigest: requestedDigest,
    linuxAmd64ManifestDigest: linuxAmd64.digest,
    manifestCount: index.manifests.length,
  };
}

function containerImageId(container) {
  const records = JSON.parse(String(runDocker(['container', 'inspect', container])));
  const imageId = records[0]?.Image;
  if (typeof imageId !== 'string')
    throw new Error(`V13_DOCKER_CONTAINER_INSPECT_INVALID:${container}`);
  return imageId;
}

function readContainerOsRelease(container) {
  const output = String(runDocker(['exec', container, 'cat', '/etc/os-release']));
  return Object.fromEntries(
    output
      .split(/\r?\n/u)
      .filter((line) => /^(?:ID|VERSION_ID|VERSION_CODENAME)=/u.test(line))
      .map((line) => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator),
          line
            .slice(separator + 1)
            .replace(/^"/u, '')
            .replace(/"$/u, ''),
        ];
      }),
  );
}

function runDocker(args, options = {}) {
  const result = tryDocker(args, options);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `V13_DOCKER_COMMAND_FAILED:${args.slice(0, 2).join(':')}:${redactDockerOutput(result.stderr)}`,
    );
  }
  return result.stdout;
}

function tryDocker(args, { binary = false, input, timeout = 60_000 } = {}) {
  return spawnSync('docker', args, {
    cwd: root,
    encoding: binary ? null : 'utf8',
    input,
    maxBuffer: 128 * 1024 * 1024,
    timeout,
  });
}

function redactDockerOutput(output) {
  return String(output ?? '')
    .replaceAll(postgresPassword, '[redacted]')
    .trim()
    .slice(-2_000);
}

function dockerResourceWasAbsent(result) {
  return /No such (?:container|volume)|no such (?:container|volume)/u.test(
    String(result.stderr ?? ''),
  );
}

function databasePool(database) {
  return new Pool({ connectionString: databaseUrl(database) });
}

function databaseUrl(database) {
  if (adminUrl === undefined) throw new Error('V13_TARGET_ADMIN_URL_MISSING');
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function sourceDatabaseUrl(database) {
  if (sourceAdminUrl === undefined) throw new Error('V13_SOURCE_ADMIN_URL_MISSING');
  const url = new URL(sourceAdminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function recreateDatabases() {
  if (adminUrl === undefined) throw new Error('V13_TARGET_ADMIN_URL_MISSING');
  const admin = new Pool({ connectionString: adminUrl });
  try {
    for (const database of databases) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await admin.end();
  }
}

async function recreateSourceDatabase() {
  if (sourceAdminUrl === undefined) throw new Error('V13_SOURCE_ADMIN_URL_MISSING');
  const admin = new Pool({ connectionString: sourceAdminUrl });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [sourceDatabase],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${sourceDatabase}`);
    await admin.query(`CREATE DATABASE ${sourceDatabase}`);
  } finally {
    await admin.end();
  }
}

async function dropDatabases() {
  if (adminUrl === undefined) return;
  const admin = new Pool({ connectionString: adminUrl });
  try {
    for (const database of databases) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    }
  } finally {
    await admin.end();
  }
}

async function verifyBaseline(pool) {
  const identity = await pool.query(
    "SELECT current_database() AS database_name, to_regclass('public.schema_migration')::text AS marker_table",
  );
  if (!['public.schema_migration', 'schema_migration'].includes(identity.rows[0]?.marker_table))
    throw new Error(
      `V122_BASELINE_TABLE_MISSING:${String(identity.rows[0]?.database_name)}:${String(identity.rows[0]?.marker_table)}`,
    );
  const marker = await pool.query(
    `SELECT array_agg(
       version ORDER BY CASE WHEN version='v1.2.2_clean_slate_baseline' THEN 0 ELSE 1 END, version
     ) AS versions
     FROM public.schema_migration`,
  );
  if (JSON.stringify(marker.rows[0]?.versions) !== JSON.stringify(expectedVersions))
    throw new Error('V123_MIGRATION_MARKERS_INVALID');

  const requiredTables = [
    'goal',
    'skill',
    'workflow_plan',
    'remote_task_binding',
    'user_goal_plan',
    'skill_goal',
    'skill_attempt',
    'business_event_inbox',
    'runtime_capability_summary',
    'generic_task_understanding',
    'interactive_goal_session',
    'goal_experience_episode',
    'knowledge_status_transition',
    'compiled_artifact',
    'artifact_active_pointer',
    'artifact_lineage',
    'artifact_validation_run',
    'artifact_approval',
    'artifact_execution',
    'artifact_feedback',
    'artifact_match_log',
    'experience_trace',
    'pattern_candidate',
    'evidence_export_configuration',
    'evidence_outbox',
    'evidence_source_checkpoint',
    'evidence_export_state',
    'evidence_export_batch',
    'evidence_export_ack',
    'evidence_dead_letter',
    'evidence_projection_issue',
    'evidence_quality_issue',
    'episode_evidence_manifest',
  ];
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema='public' AND table_name=ANY($1::text[])
     ORDER BY table_name`,
    [requiredTables],
  );
  if (tables.rows.length !== requiredTables.length)
    throw new Error('V122_BASELINE_REQUIRED_TABLES_MISSING');

  const evidenceCutover = await pool.query(
    `SELECT
       to_regclass('public.runtime_telemetry_export_configuration') IS NULL AS old_configuration_absent,
       to_regclass('public.runtime_telemetry_export_state') IS NULL AS old_state_absent,
       to_regclass('public.runtime_telemetry_export_outbox') IS NULL AS old_outbox_absent,
       EXISTS(SELECT 1 FROM pg_constraint WHERE conname='evidence_outbox_record_id_key') AS record_unique,
       EXISTS(SELECT 1 FROM pg_constraint
         WHERE conname='evidence_outbox_source_system_source_table_source_record_id_key') AS source_unique,
       EXISTS(SELECT 1 FROM pg_indexes
         WHERE schemaname='public' AND indexname='evidence_outbox_pending_idx') AS pending_index,
       EXISTS(SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='evidence_export_state'
           AND column_name='fencing_token' AND is_nullable='NO') AS fencing_token,
       EXISTS(SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='evidence_outbox'
           AND column_name='observation_generation' AND is_nullable='NO'
           AND data_type='smallint') AS observation_generation,
       EXISTS(SELECT 1 FROM pg_trigger
         WHERE tgname='evidence_export_batch_immutable' AND NOT tgisinternal) AS batch_immutable,
       EXISTS(SELECT 1 FROM pg_trigger
         WHERE tgname='evidence_export_ack_immutable' AND NOT tgisinternal) AS ack_immutable,
       EXISTS(SELECT 1 FROM pg_constraint
         WHERE conname='evidence_export_ack_ack_disposition_check') AS ack_disposition_check,
       EXISTS(SELECT 1 FROM information_schema.table_constraints
         WHERE table_schema='public' AND table_name='evidence_source_checkpoint'
           AND constraint_type='PRIMARY KEY') AS checkpoint_partition_key`,
  );
  const evidence = evidenceCutover.rows[0];
  if (
    evidence?.old_configuration_absent !== true ||
    evidence?.old_state_absent !== true ||
    evidence?.old_outbox_absent !== true ||
    evidence?.record_unique !== true ||
    evidence?.source_unique !== true ||
    evidence?.pending_index !== true ||
    evidence?.fencing_token !== true ||
    evidence?.observation_generation !== true ||
    evidence?.batch_immutable !== true ||
    evidence?.ack_immutable !== true ||
    evidence?.ack_disposition_check !== true ||
    evidence?.checkpoint_partition_key !== true
  ) {
    throw new Error('V141_CANONICAL_EVIDENCE_CUTOVER_INVALID');
  }

  const modes = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conname='mcp_server_protocol_mode_check'`,
  );
  const definition = modes.rows[0]?.definition;
  if (typeof definition !== 'string' || !definition.includes('frozen_v1'))
    throw new Error('V122_FROZEN_PROTOCOL_CONSTRAINT_MISSING');

  const capabilitySchema = await pool.query(
    `SELECT
       EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='runtime_capability_summary'
           AND column_name='generation_policy_version'
           AND is_nullable='NO'
       ) AS policy_column,
       EXISTS(
         SELECT 1 FROM pg_constraint
         WHERE conname='runtime_capability_summary_catalog_policy_unique'
       ) AS catalog_policy_unique,
       EXISTS(
         SELECT 1 FROM pg_constraint
         WHERE conname='runtime_capability_limitation_reason_check'
           AND pg_get_constraintdef(oid) LIKE '%no_enabled_skill%'
       ) AS limitation_reason_check`,
  );
  if (
    capabilitySchema.rows[0]?.policy_column !== true ||
    capabilitySchema.rows[0]?.catalog_policy_unique !== true ||
    capabilitySchema.rows[0]?.limitation_reason_check !== true
  ) {
    throw new Error('V123_CAPABILITY_SUMMARY_SCHEMA_INVALID');
  }

  const capabilityCardSchema = await pool.query(
    `SELECT
       count(*) FILTER (
         WHERE column_name=ANY(ARRAY['card_content_hash','source_skill_refs','generation_mode'])
           AND is_nullable='NO'
       )::integer AS required_columns,
       EXISTS(
         SELECT 1 FROM pg_constraint
         WHERE conname='public_capability_card_catalog_policy_unique'
       ) AS catalog_policy_unique
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='public_capability_card_snapshot'`,
  );
  if (
    capabilityCardSchema.rows[0]?.required_columns !== 3 ||
    capabilityCardSchema.rows[0]?.catalog_policy_unique !== true
  ) {
    throw new Error('V123_PUBLIC_CAPABILITY_CARD_SCHEMA_INVALID');
  }

  const understandingSchema = await pool.query(
    `SELECT
       EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='generic_task_understanding'
           AND column_name='model_invocation_id'
           AND is_nullable='NO'
       ) AS invocation_column,
       EXISTS(
         SELECT 1 FROM pg_constraint
         WHERE conname='generic_task_understanding_dimension_kind_check'
           AND pg_get_constraintdef(oid) LIKE '%human_confirmation_policy%'
       ) AS complete_dimension_check,
       EXISTS(
         SELECT 1 FROM pg_constraint
         WHERE conname='stage_model_route_stage_check'
           AND pg_get_constraintdef(oid) LIKE '%task_understanding%'
       ) AS model_stage_check`,
  );
  if (
    understandingSchema.rows[0]?.invocation_column !== true ||
    understandingSchema.rows[0]?.complete_dimension_check !== true ||
    understandingSchema.rows[0]?.model_stage_check !== true
  ) {
    throw new Error('V123_TASK_UNDERSTANDING_SCHEMA_INVALID');
  }

  const interactiveGoalSchema = await pool.query(
    `SELECT
       count(*) FILTER (
         WHERE (table_name='interactive_goal_session' AND column_name='max_elapsed_ms')
            OR (table_name='interactive_goal_turn' AND column_name='binding')
            OR (table_name='goal_contract_candidate'
                AND column_name=ANY(ARRAY['diff','model_invocation_id']))
       )::integer AS required_columns,
       EXISTS(
         SELECT 1 FROM pg_constraint
         WHERE conname='stage_model_route_stage_check'
           AND pg_get_constraintdef(oid) LIKE '%task_clarification%'
           AND pg_get_constraintdef(oid) LIKE '%goal_contract_generation%'
       ) AS model_stage_check
     FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name=ANY(ARRAY[
         'interactive_goal_session','interactive_goal_turn','goal_contract_candidate'
       ])`,
  );
  if (
    interactiveGoalSchema.rows[0]?.required_columns !== 4 ||
    interactiveGoalSchema.rows[0]?.model_stage_check !== true
  ) {
    throw new Error('V123_INTERACTIVE_GOAL_SCHEMA_INVALID');
  }
}

async function rollbackPostBaselineMigrations(pool) {
  for (const upFile of [...postBaselineMigrationFiles].reverse()) {
    const downFile = upFile.replace(/\.up\.sql$/u, '.down.sql');
    await pool.query(await readFile(resolve(migrationDirectory, downFile), 'utf8'));
  }
}

async function verifyPostBaselineMigrationsRolledBack(pool) {
  const marker = await pool.query(
    'SELECT array_agg(version ORDER BY version) AS versions FROM public.schema_migration',
  );
  if (
    JSON.stringify(marker.rows[0]?.versions) !== JSON.stringify(['v1.2.2_clean_slate_baseline'])
  ) {
    throw new Error('V123_ROLLBACK_MARKER_INVALID');
  }
  const tables = await pool.query(
    `SELECT to_regclass('public.runtime_capability_summary') IS NULL AS capability_absent,
            to_regclass('public.goal_experience_episode') IS NULL AS experience_absent,
            to_regclass('public.knowledge_status_transition') IS NULL AS knowledge_absent,
            to_regclass('public.compiled_artifact') IS NULL AS artifact_absent,
            to_regclass('public.evidence_outbox') IS NULL AS evidence_outbox_absent,
            to_regclass('public.evidence_source_checkpoint') IS NULL AS evidence_checkpoint_absent,
            to_regclass('public.episode_evidence_manifest') IS NULL AS evidence_manifest_absent,
            to_regclass('public.evidence_export_batch') IS NULL AS evidence_batch_absent,
            to_regclass('public.evidence_export_ack') IS NULL AS evidence_ack_absent`,
  );
  if (
    tables.rows[0]?.capability_absent !== true ||
    tables.rows[0]?.experience_absent !== true ||
    tables.rows[0]?.knowledge_absent !== true ||
    tables.rows[0]?.artifact_absent !== true ||
    tables.rows[0]?.evidence_outbox_absent !== true ||
    tables.rows[0]?.evidence_checkpoint_absent !== true ||
    tables.rows[0]?.evidence_manifest_absent !== true ||
    tables.rows[0]?.evidence_batch_absent !== true ||
    tables.rows[0]?.evidence_ack_absent !== true
  ) {
    throw new Error('V123_ROLLBACK_TABLES_REMAIN');
  }

  const capabilityColumn = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='runtime_capability_summary'
         AND column_name='generation_policy_version'
     ) AS present`,
  );
  if (capabilityColumn.rows[0]?.present === true)
    throw new Error('V123_CAPABILITY_SUMMARY_ROLLBACK_INCOMPLETE');

  const understandingColumn = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='generic_task_understanding'
         AND column_name='model_invocation_id'
     ) AS present`,
  );
  if (understandingColumn.rows[0]?.present === true)
    throw new Error('V123_TASK_UNDERSTANDING_ROLLBACK_INCOMPLETE');

  const interactiveGoalColumns = await pool.query(
    `SELECT count(*)::integer AS present
     FROM information_schema.columns
     WHERE table_schema='public'
       AND (
         (table_name='interactive_goal_session' AND column_name='max_elapsed_ms')
         OR (table_name='interactive_goal_turn' AND column_name='binding')
         OR (table_name='goal_contract_candidate'
             AND column_name=ANY(ARRAY['diff','model_invocation_id']))
       )`,
  );
  if (interactiveGoalColumns.rows[0]?.present !== 0)
    throw new Error('V123_INTERACTIVE_GOAL_ROLLBACK_INCOMPLETE');
}

async function restoreFrozenV123LogicalBackup(targetPool) {
  if (isolatedInfrastructure === undefined)
    throw new Error('V13_ISOLATED_DOCKER_INFRASTRUCTURE_MISSING');
  const sourcePool = new Pool({ connectionString: sourceDatabaseUrl(sourceDatabase) });
  let representativeSnapshot;
  let sourceIdentity;
  try {
    await applyV122BaselineAndSeed(sourcePool);
    await applyMigrationFiles(sourcePool, v123MigrationFiles);
    await verifyMigrationPrefix(sourcePool, expectedV123Versions);
    await verifyMigrationChecksumLedger(sourcePool);
    representativeSnapshot = await insertRepresentativeV123Data(sourcePool);
    await verifyRepresentativeDataPreserved(sourcePool, representativeSnapshot);
    sourceIdentity = await captureDatabaseIdentity(sourcePool);
  } finally {
    await sourcePool.end();
  }

  const archive = runDocker(
    [
      'exec',
      isolatedInfrastructure.sourceContainer,
      'pg_dump',
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--username',
      postgresUser,
      '--dbname',
      sourceDatabase,
    ],
    { binary: true, timeout: 180_000 },
  );
  if (!Buffer.isBuffer(archive) || archive.length === 0)
    throw new Error('V13_V123_LOGICAL_BACKUP_EMPTY');
  runDocker(
    [
      'exec',
      '--interactive',
      isolatedInfrastructure.targetContainer,
      'pg_restore',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      '--username',
      postgresUser,
      '--dbname',
      databases[3],
    ],
    { binary: true, input: archive, timeout: 180_000 },
  );

  await verifyMigrationPrefix(targetPool, expectedV123Versions);
  await verifyMigrationChecksumLedger(targetPool);
  await verifyRepresentativeDataPreserved(targetPool, representativeSnapshot);
  const targetIdentity = await captureDatabaseIdentity(targetPool);
  return {
    status: 'passed',
    method: 'pg_dump custom archive -> pg_restore single transaction',
    archiveBytes: archive.length,
    archiveSha256: createHash('sha256').update(archive).digest('hex'),
    sourceDatabase,
    targetDatabase: databases[3],
    sourceIdentity,
    targetIdentity,
    physicalPgdataReused: false,
    existingComposeVolumeTouched: false,
    sourceVolumeHeldUntilTargetVerification: true,
    representativeSnapshot,
  };
}

async function captureDatabaseIdentity(pool) {
  const result = await pool.query(
    `SELECT
       current_database() AS database_name,
       current_setting('server_version') AS server_version,
       datcollate AS database_collation,
       datctype AS database_character_classification,
       datlocprovider::text AS locale_provider,
       datcollversion AS recorded_collation_version,
       (
         SELECT extversion
         FROM pg_extension
         WHERE extname='vector'
       ) AS vector_extension_version
     FROM pg_database
     WHERE datname=current_database()`,
  );
  const identity = result.rows[0];
  if (identity === undefined) throw new Error('V13_DATABASE_IDENTITY_MISSING');
  return identity;
}

async function applyV122BaselineAndSeed(pool) {
  await pool.query(await readFile(baselineFile, 'utf8'));
  await pool.query(await readFile(seedFile, 'utf8'));
}

async function applyMigrationFiles(pool, files) {
  for (const file of files) {
    await pool.query(await readFile(resolve(migrationDirectory, file), 'utf8'));
  }
}

async function verifyMigrationPrefix(pool, versions) {
  const marker = await pool.query(
    `SELECT array_agg(
       version ORDER BY CASE WHEN version='v1.2.2_clean_slate_baseline' THEN 0 ELSE 1 END, version
     ) AS versions
     FROM public.schema_migration`,
  );
  if (JSON.stringify(marker.rows[0]?.versions) !== JSON.stringify(versions))
    throw new Error('V123_MIGRATION_PREFIX_INVALID');
}

async function verifyMigrationChecksumLedger(pool, contentOverrides = new Map()) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.schema_migration_checksum (
       version text PRIMARY KEY
         REFERENCES public.schema_migration(version) ON DELETE CASCADE,
       sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
       verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
     )`,
  );
  const applied = await pool.query(
    `SELECT version
     FROM public.schema_migration
     ORDER BY CASE WHEN version='v1.2.2_clean_slate_baseline' THEN 0 ELSE 1 END, version`,
  );
  const sourceByVersion = new Map(checksumSources.map((source) => [source.version, source]));
  for (const row of applied.rows) {
    const source = sourceByVersion.get(row.version);
    if (source === undefined)
      throw new Error(`V13_MIGRATION_CHECKSUM_SOURCE_MISSING:${row.version}`);
    const content = contentOverrides.get(row.version) ?? (await readFile(source.filePath));
    const checksum = createHash('sha256').update(content).digest('hex');
    const recorded = await pool.query(
      'SELECT sha256 FROM public.schema_migration_checksum WHERE version=$1',
      [row.version],
    );
    if (recorded.rowCount === 0) {
      await pool.query(
        `INSERT INTO public.schema_migration_checksum(version,sha256)
         VALUES ($1,$2)`,
        [row.version, checksum],
      );
      continue;
    }
    if (recorded.rows[0]?.sha256 !== checksum)
      throw new Error(`V13_MIGRATION_CHECKSUM_DRIFT:${row.version}`);
  }
}

async function expectChecksumDriftRejection(pool, migrationFile) {
  if (migrationFile === undefined) throw new Error('V13_MIGRATION_CHECKSUM_DRIFT_FIXTURE_MISSING');
  const version = migrationFile.slice(0, -'.up.sql'.length);
  const original = await readFile(resolve(migrationDirectory, migrationFile));
  const drifted = Buffer.concat([
    original,
    Buffer.from('\n-- verifier-only simulated file drift\n', 'utf8'),
  ]);
  try {
    await verifyMigrationChecksumLedger(pool, new Map([[version, drifted]]));
  } catch (error) {
    if (error instanceof Error && error.message === `V13_MIGRATION_CHECKSUM_DRIFT:${version}`)
      return;
    throw error;
  }
  throw new Error(`V13_MIGRATION_CHECKSUM_DRIFT_ACCEPTED:${version}`);
}

async function insertRepresentativeV123Data(pool) {
  const hash = (digit) => `sha256:${digit.repeat(64)}`;
  const recordedAt = '2026-07-30T00:00:00.000Z';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.conversation_context(
         context_id,user_id,created_at,updated_at
       ) VALUES ($1,$2,$3,$3)`,
      ['p13-upgrade-context', 'p13-upgrade-user', recordedAt],
    );
    await client.query(
      `INSERT INTO public.goal(
         goal_id,context_id,version,title,description,constraints_json,
         success_criteria_json,status,created_at,updated_at
       ) VALUES ($1,$2,1,$3,$4,'[]'::jsonb,'[]'::jsonb,'achieved',$5,$5)`,
      [
        'p13-upgrade-goal',
        'p13-upgrade-context',
        'P13 migration preservation goal',
        'Representative v1.2.3 goal retained through the v1.3 migration chain.',
        recordedAt,
      ],
    );
    await client.query(
      `INSERT INTO public.agent_task(
         task_id,context_id,user_id,phase,phase_message,goal_id,goal_version,
         output_text,created_at,updated_at,request_text,request_metadata
       ) VALUES ($1,$2,$3,'completed',$4,$5,1,$6,$7,$7,$8,$9::jsonb)`,
      [
        'p13-upgrade-a2a-task',
        'p13-upgrade-context',
        'p13-upgrade-user',
        'Representative A2A task completed before v1.3.',
        'p13-upgrade-goal',
        'preserved',
        recordedAt,
        'Verify the migration path.',
        '{"protocol":"A2A","revision":"v1.2.3-final"}',
      ],
    );
    await client.query(
      `INSERT INTO public.workflow_plan(
         plan_id,goal_id,goal_version,definition_json,confirmation_status,
         attempt_count,created_at,revision_kind,goal_contract_json
       ) VALUES ($1,$2,1,'{}'::jsonb,'confirmed',1,$3,'admin_dsl',$4::jsonb)`,
      [
        'p13-upgrade-workflow-plan',
        'p13-upgrade-goal',
        recordedAt,
        '{"goalId":"p13-upgrade-goal","version":1}',
      ],
    );
    await client.query(
      `INSERT INTO public.workflow_control(
         control_id,context_id,goal_id,goal_version,task_id,status,current_plan_id,
         input_json,skill_ids_json,planning_instruction,round_count,replan_count,
         created_at,updated_at
       ) VALUES ($1,$2,$3,1,$4,'canceled',$5,'{}'::jsonb,'[]'::jsonb,$6,0,0,$7,$7)`,
      [
        'p13-upgrade-control',
        'p13-upgrade-context',
        'p13-upgrade-goal',
        'p13-upgrade-a2a-task',
        'p13-upgrade-workflow-plan',
        'Representative migration verification control.',
        recordedAt,
      ],
    );
    await client.query(
      `INSERT INTO public.runtime_terminal_outcome(
         outcome_id,outcome_kind,task_id,goal_id,goal_version,control_id,
         control_status,summary,committed_at
       ) VALUES ($1,'canceled',$2,$3,1,$4,'canceled',$5,$6)`,
      [
        'p13-upgrade-terminal-outcome',
        'p13-upgrade-a2a-task',
        'p13-upgrade-goal',
        'p13-upgrade-control',
        'Representative terminal outcome retained through v1.3.',
        recordedAt,
      ],
    );
    await client.query(
      `INSERT INTO public.user_goal_contract(
         goal_id,goal_version,schema_version,contract_hash,contract_json,created_at
       ) VALUES ($1,1,'1.0',$2,'{}'::jsonb,$3)`,
      ['p13-upgrade-goal', hash('1'), recordedAt],
    );
    await client.query(
      `INSERT INTO public.user_goal_plan(
         plan_id,goal_id,goal_version,revision,revision_kind,status,contract_hash,
         content_hash,plan_json,created_at,updated_at
       ) VALUES ($1,$2,1,1,'initial','completed',$3,$4,'{}'::jsonb,$5,$5)`,
      ['p13-upgrade-user-goal-plan', 'p13-upgrade-goal', hash('2'), hash('3'), recordedAt],
    );
    await client.query(
      `INSERT INTO public.skill_goal(
         skill_goal_id,plan_id,ordinal,status,contract_json,created_at,updated_at
       ) VALUES ($1,$2,1,'achieved','{}'::jsonb,$3,$3)`,
      ['p13-upgrade-skill-goal', 'p13-upgrade-user-goal-plan', recordedAt],
    );
    await client.query(
      `INSERT INTO public.skill_attempt(
         attempt_id,plan_id,skill_goal_id,ordinal,status,strategy_fingerprint,
         attempt_json,created_at,updated_at
       ) VALUES ($1,$2,$3,1,'achieved',$4,'{}'::jsonb,$5,$5)`,
      [
        'p13-upgrade-attempt',
        'p13-upgrade-user-goal-plan',
        'p13-upgrade-skill-goal',
        hash('4'),
        recordedAt,
      ],
    );
    await client.query(
      `INSERT INTO public.outcome_decision(
         outcome_decision_id,level,subject_id,plan_id,status,confidence,
         decision_json,created_at
       ) VALUES ($1,'skill_goal',$2,$3,'achieved','high','{}'::jsonb,$4)`,
      [
        'p13-upgrade-outcome-decision',
        'p13-upgrade-skill-goal',
        'p13-upgrade-user-goal-plan',
        recordedAt,
      ],
    );
    await client.query(
      `INSERT INTO public.goal_experience_episode(
         episode_id,goal_id,goal_version,revision,episode_hash,completeness,
         data_classification,redaction_codes,snapshot,created_at,task_id,
         context_id,episode_type,terminal_outcome_ref,source_hash,status,
         tenant_id,user_scope_id
       ) VALUES (
         $1,$2,1,1,$3,1,'internal','[]'::jsonb,'{}'::jsonb,$4,$5,$6,
         'terminal',$7,$8,'complete',$9,$10
       )`,
      [
        'p13-upgrade-experience',
        'p13-upgrade-goal',
        hash('5'),
        recordedAt,
        'p13-upgrade-a2a-task',
        'p13-upgrade-context',
        'p13-upgrade-terminal-outcome',
        hash('6'),
        'p13-upgrade-tenant',
        'p13-upgrade-user',
      ],
    );
    await client.query(
      `INSERT INTO public.model_provider(
         provider_id,name,kind,base_url,model,enabled,timeout_ms,
         encrypted_credential,created_at,updated_at
       ) VALUES ($1,$2,'local',$3,$4,true,1000,$5,$6,$6)`,
      [
        'p13-upgrade-provider',
        'P13 migration provider',
        'http://127.0.0.1:1',
        'p13-verifier',
        'verifier-only-encrypted-envelope',
        recordedAt,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return captureRepresentativeData(pool);
}

async function captureRepresentativeData(pool) {
  const snapshot = await pool.query(
    `SELECT jsonb_build_object(
       'goal',(
         SELECT jsonb_build_object(
           'goalId',goal_id,'contextId',context_id,'version',version,'title',title,'status',status
         )
         FROM public.goal WHERE goal_id='p13-upgrade-goal'
       ),
       'plan',(
         SELECT jsonb_build_object(
           'planId',plan_id,'goalId',goal_id,'revision',revision,'status',status,
           'contentHash',content_hash
         )
         FROM public.user_goal_plan WHERE plan_id='p13-upgrade-user-goal-plan'
       ),
       'attempt',(
         SELECT jsonb_build_object(
           'attemptId',attempt_id,'planId',plan_id,'skillGoalId',skill_goal_id,
           'ordinal',ordinal,'status',status,'strategyFingerprint',strategy_fingerprint
         )
         FROM public.skill_attempt WHERE attempt_id='p13-upgrade-attempt'
       ),
       'outcome',(
         SELECT jsonb_build_object(
           'outcomeDecisionId',outcome_decision_id,'level',level,'subjectId',subject_id,
           'planId',plan_id,'status',status,'confidence',confidence
         )
         FROM public.outcome_decision WHERE outcome_decision_id='p13-upgrade-outcome-decision'
       ),
       'experience',(
         SELECT jsonb_build_object(
           'episodeId',episode_id,'goalId',goal_id,'goalVersion',goal_version,
           'episodeHash',episode_hash,'status',status,'terminalOutcomeRef',terminal_outcome_ref
         )
         FROM public.goal_experience_episode WHERE episode_id='p13-upgrade-experience'
       ),
       'tenant',(
         SELECT jsonb_build_object('tenantId',tenant_id,'userScopeId',user_scope_id)
         FROM public.goal_experience_episode WHERE episode_id='p13-upgrade-experience'
       ),
       'provider',(
         SELECT jsonb_build_object(
           'providerId',provider_id,'kind',kind,'model',model,'enabled',enabled
         )
         FROM public.model_provider WHERE provider_id='p13-upgrade-provider'
       ),
       'a2a',(
         SELECT jsonb_build_object(
           'taskId',task_id,'contextId',context_id,'userId',user_id,
           'phase',phase,'goalId',goal_id,'goalVersion',goal_version
         )
         FROM public.agent_task WHERE task_id='p13-upgrade-a2a-task'
       )
     ) AS snapshot`,
  );
  return snapshot.rows[0]?.snapshot;
}

async function verifyRepresentativeDataPreserved(pool, before) {
  const after = await captureRepresentativeData(pool);
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error('V13_REPRESENTATIVE_DATA_NOT_PRESERVED');
  if (
    before === null ||
    typeof before !== 'object' ||
    Object.values(before).some((value) => value === null)
  ) {
    throw new Error('V123_REPRESENTATIVE_DATA_INCOMPLETE');
  }
}

async function simulateInterruptedMigration(pool, migrationFile) {
  if (migrationFile === undefined) throw new Error('V13_INTERRUPTION_FIXTURE_MISSING');
  const sql = await readFile(resolve(migrationDirectory, migrationFile), 'utf8');
  const body = sql
    .replace(/^\uFEFF?BEGIN;[ \t]*\r?\n/u, '')
    .replace(/\r?\nCOMMIT;[ \t]*\r?\n?$/u, '');
  if (body === sql) throw new Error(`V13_MIGRATION_TRANSACTION_WRAPPER_MISSING:${migrationFile}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(body);
    throw new Error('V13_SIMULATED_MIGRATION_INTERRUPTION');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof Error && error.message === 'V13_SIMULATED_MIGRATION_INTERRUPTION') return;
    throw error;
  } finally {
    client.release();
  }
}

async function verifyInterruptedMigrationRolledBack(pool, migrationFile) {
  if (migrationFile === undefined) throw new Error('V13_INTERRUPTION_FIXTURE_MISSING');
  const version = migrationFile.slice(0, -'.up.sql'.length);
  const state = await pool.query(
    `SELECT
       NOT EXISTS(
         SELECT 1 FROM public.schema_migration WHERE version=$1
       ) AS marker_absent,
       to_regclass('public.compiled_artifact') IS NULL AS artifact_table_absent,
       NOT EXISTS(
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema='public'
           AND table_name='cognitive_runtime_outbox'
           AND column_name='outbox_sequence'
       ) AS outbox_column_absent,
       NOT EXISTS(
         SELECT 1 FROM public.schema_migration_checksum WHERE version=$1
       ) AS checksum_absent`,
    [version],
  );
  if (
    state.rows[0]?.marker_absent !== true ||
    state.rows[0]?.artifact_table_absent !== true ||
    state.rows[0]?.outbox_column_absent !== true ||
    state.rows[0]?.checksum_absent !== true
  ) {
    throw new Error(`V13_INTERRUPTED_MIGRATION_PARTIAL_STATE:${version}`);
  }
  await verifyMigrationPrefix(pool, expectedV123Versions);
}

async function expectLedgerRejection(applyRuntimeMigrations, pool) {
  try {
    await applyRuntimeMigrations(pool);
  } catch (error) {
    if (error instanceof Error && error.message === 'SDAR_V123_MIGRATION_LEDGER_INVALID') return;
    throw error;
  }
  throw new Error('V123_ROGUE_MIGRATION_LEDGER_ACCEPTED');
}

async function expectCleanDatabaseRejection(applyRuntimeMigrations, pool, label) {
  try {
    await applyRuntimeMigrations(pool);
  } catch (error) {
    if (error instanceof Error && error.message === 'SDAR_V122_CLEAN_DATABASE_REQUIRED') return;
    throw error;
  }
  throw new Error(`V122_EXISTING_DATABASE_ACCEPTED:${label}`);
}

function verifyResetRejected(environment, expectedCode) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/reset-v122-database.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
  if (result.status === 0 || !`${result.stdout}${result.stderr}`.includes(expectedCode))
    throw new Error(`V122_RESET_GUARD_NOT_ENFORCED:${expectedCode}`);
}

function runReset(connectionString) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/reset-v122-database.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SDAR_ENV: 'test',
      SDAR_ALLOW_DESTRUCTIVE_RESET: 'v1.2.2',
      SDAR_POSTGRES_URL: connectionString,
    },
  });
  if (result.status !== 0) throw new Error(`V122_RESET_FAILED:${result.stdout}${result.stderr}`);
}
