import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const reportsRoot = resolve(root, 'reports', 'goal');
const packageRoot = resolve(root, 'docs', 'SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1', 'packages');
const paths = Object.freeze({
  verification: 'reports/verification/summary.json',
  migration: 'reports/goal/v1.3-final-migration-report.json',
  reproducibility: 'reports/goal/v1.3-final-reproducibility-report.json',
  rollback: 'reports/goal/v1.3-final-kill-switch-rollback-report.json',
  postgresTrivy: 'reports/goal/v1.3-p13-postgres-hardened-trivy.json',
  redisTrivy: 'reports/goal/v1.3-p13-redis-alpine-trivy.json',
  sbom: 'reports/EP-00-repo-bootstrap/sbom.cdx.json',
  license: 'reports/EP-00-repo-bootstrap/license-report.json',
  sources: 'third_party/sources.lock.yaml',
  limitations: 'reports/goal/v1.3-final-known-limitations.md',
  architectureReview: 'reports/goal/v1.3-final-architecture-review.md',
  securityReview: 'reports/goal/v1.3-final-security-review.md',
  operationsReview: 'reports/goal/v1.3-final-operations-review.md',
  rootPackage: 'package.json',
  consolePackage: 'apps/console/package.json',
});

const sources = await readSources();
validateSources();
const candidateSha = sources.verification.value.commit;
const generatedAt = sources.verification.value.finishedAt;
const formalPackages = await readFormalPackages();

const finalSbomContent = `${JSON.stringify(sources.sbom.value, null, 2)}\n`;
const finalSbomSha256 = sha256(finalSbomContent);
const finalLicense = {
  schemaVersion: '1.0',
  packageId: 'SDAR-V1.3-P13',
  status: 'passed',
  candidateSha,
  generatedAt,
  classification: 'deterministic lock-derived license inventory',
  commands: ['pnpm evidence:licenses', 'pnpm verify:licenses'],
  sourceRef: paths.license,
  sourceSha256: sources.license.sha256,
  packageCount: sources.license.value.package_count,
  unknownLicenseCount: sources.license.value.unknown_license_count,
  externalServices: sources.license.value.external_services,
  buildTools: sources.license.value.build_tools,
  releaseTools: sources.license.value.release_tools,
};
const sourceCount = sources.sources.content.match(/^\s+- name:\s+/gmu)?.length ?? 0;
const pinCount = sources.sources.content.match(/^\s+pin:\s+/gmu)?.length ?? 0;
const finalSources = {
  schemaVersion: '1.0',
  packageId: 'SDAR-V1.3-P13',
  status: 'passed',
  candidateSha,
  generatedAt,
  classification: 'static immutable source-lock verification',
  command: 'pnpm verify:sources',
  sourceRef: paths.sources,
  sourceSha256: sources.sources.sha256,
  sourceCount,
  pinCount,
  unpinnedCount: sources.sources.content.match(/\bUNPINNED\b/gu)?.length ?? 0,
};

const finalLicenseContent = `${JSON.stringify(finalLicense, null, 2)}\n`;
const finalSourcesContent = `${JSON.stringify(finalSources, null, 2)}\n`;
const releaseManifest = {
  schemaVersion: '1.0',
  packageId: 'SDAR-V1.3-P13',
  repository: 'zhouwen-giser/skill-driven-agent-runtime',
  releaseLine: 'v1.3.0',
  candidateSha,
  baseV123Sha: '856f909d22c33e6e20d7e0a1cffc2f54c03b4477',
  originMainObservedSha: capture('git', ['rev-parse', 'origin/main']).trim(),
  branch: capture('git', ['branch', '--show-current']).trim(),
  generatedAt,
  goals: formalPackages,
  migrations: {
    count: sources.migration.value.candidate.additiveMigrationCount,
    status: sources.migration.value.status,
    evidenceRef: paths.migration,
    sha256: sources.migration.sha256,
  },
  versions: {
    package: sources.rootPackage.value.version,
    console: sources.consolePackage.value.version,
    managementApiContract: '1.1',
    openapi: '3.1.0',
    a2aSdk: sources.rootPackage.value.dependencies['@a2a-js/sdk'],
  },
  featureFlags: sources.rollback.value.featureFlags,
  buildHashes: {
    aggregateSha256: sources.reproducibility.value.aggregateSha256,
    lockfileSha256: sources.reproducibility.value.lockfileSha256,
    evidenceRef: paths.reproducibility,
  },
  containers: {
    postgres: containerIdentity(sources.postgresTrivy.value),
    redis: containerIdentity(sources.redisTrivy.value),
  },
  sbom: {
    ref: 'reports/goal/v1.3-final-sbom.json',
    sha256: finalSbomSha256,
  },
  license: {
    ref: 'reports/goal/v1.3-final-license-report.json',
    sha256: sha256(finalLicenseContent),
  },
  sources: {
    ref: 'reports/goal/v1.3-final-sources-report.json',
    sha256: sha256(finalSourcesContent),
  },
  reviews: {
    architecture: reviewIdentity(sources.architectureReview),
    security: reviewIdentity(sources.securityReview),
    operations: reviewIdentity(sources.operationsReview),
  },
  knownLimitations: {
    ref: paths.limitations,
    sha256: sources.limitations.sha256,
  },
  decision: 'RELEASE_CANDIDATE_READY',
  authorizationStatus: {
    mergeAuthorized: false,
    tagAuthorized: false,
    releaseAuthorized: false,
    productionDeployAuthorized: false,
    rolloutClassification: 'plan-only; requires separately approved release and deployment',
  },
};

await Promise.all([
  writeFile(resolve(reportsRoot, 'v1.3-final-sbom.json'), finalSbomContent),
  writeFile(resolve(reportsRoot, 'v1.3-final-license-report.json'), finalLicenseContent),
  writeFile(resolve(reportsRoot, 'v1.3-final-sources-report.json'), finalSourcesContent),
  writeFile(
    resolve(reportsRoot, 'v1.3-release-manifest.json'),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
  ),
]);

process.stdout.write(
  `P13 final supply-chain evidence and release manifest generated for ${candidateSha}; ` +
    `${String(formalPackages.length)} formal packages, ${String(sourceCount)} pinned sources.\n`,
);

function validateSources() {
  for (const key of ['verification', 'migration', 'reproducibility', 'rollback']) {
    invariant(sources[key].value.status === 'passed', `P13_FINAL_SOURCE_NOT_PASSED:${key}`);
  }
  invariant(sources.verification.value.dirty === false, 'P13_FINAL_VERIFY_NOT_CLEAN');
  invariant(
    sources.reproducibility.value.candidateSha === sources.verification.value.commit,
    'P13_REPRODUCIBILITY_CANDIDATE_MISMATCH',
  );
  invariant(sources.license.value.unknown_license_count === 0, 'P13_LICENSE_UNKNOWN');
  for (const key of ['architectureReview', 'securityReview', 'operationsReview']) {
    invariant(reviewPassed(sources[key].content), `P13_REVIEW_NOT_ACCEPTED:${key}`);
  }
}

function reviewPassed(content) {
  return (
    /## Blocking\s+None\./u.test(content) &&
    /## Major\s+None\./u.test(content) &&
    /## Accepted\s+/u.test(content)
  );
}

function reviewIdentity(source) {
  return {
    status: 'accepted',
    ref: source.path,
    sha256: source.sha256,
    blocking: 0,
    major: 0,
  };
}

function containerIdentity(report) {
  const vulnerabilities = (report.Results ?? []).flatMap((result) => result.Vulnerabilities ?? []);
  return {
    artifact: report.ArtifactName,
    imageId: report.Metadata?.ImageID ?? null,
    repoDigests: report.Metadata?.RepoDigests ?? [],
    critical: vulnerabilities.filter((entry) => entry.Severity === 'CRITICAL').length,
    high: vulnerabilities.filter((entry) => entry.Severity === 'HIGH').length,
  };
}

async function readFormalPackages() {
  const directories = await readdir(packageRoot, { withFileTypes: true });
  const packages = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    try {
      const manifest = JSON.parse(
        await readFile(resolve(packageRoot, directory.name, 'manifest.json'), 'utf8'),
      );
      if (manifest.formalPackage !== true) continue;
      packages.push({
        sequence: manifest.sequence,
        packageId: manifest.packageId,
        goals: manifest.atomicGoals,
      });
    } catch (error) {
      if (error instanceof SyntaxError || error?.code !== 'ENOENT') throw error;
    }
  }
  packages.sort((left, right) => left.sequence - right.sequence);
  invariant(packages.length === 14, 'P13_FORMAL_PACKAGE_COUNT_INVALID');
  return packages;
}

async function readSources() {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      const content = await readFile(resolve(root, path), 'utf8');
      return [
        key,
        {
          path,
          content,
          value: path.endsWith('.json') ? JSON.parse(content) : content,
          sha256: sha256(content),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`P13_FINAL_CAPTURE_FAILED:${command} ${args.join(' ')}`);
  return result.stdout;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}
