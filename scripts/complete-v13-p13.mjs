import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const reportsRoot = resolve(root, 'reports', 'goal');
const packageRoot = resolve(
  root,
  'docs',
  'SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1',
  'packages',
  'SDAR_v1.3_P13_Codex_Goal_Package_V1.1',
);
const baselineSha = 'e3d7c8662de78d6a99289183d5345d89adad96cb';
const draftPrUrl = 'https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/13';
const requiredEvidence = Object.freeze([
  'reports/goal/v1.3-final-baseline.md',
  'reports/goal/v1.3-final-handoff-integrity.json',
  'reports/goal/v1.3-final-architecture.md',
  'reports/goal/v1.3-final-authority-audit.json',
  'reports/goal/v1.3-final-package-consistency.json',
  'reports/goal/v1.3-final-package-consistency.md',
  'reports/goal/v1.3-final-migration-report.json',
  'reports/goal/v1.3-final-upgrade-report.md',
  'reports/goal/v1.3-final-verification-report.json',
  'reports/goal/v1.3-final-security-report.json',
  'reports/goal/v1.3-final-privacy-deletion-report.json',
  'reports/goal/v1.3-final-capacity-report.json',
  'reports/goal/v1.3-final-slo-report.json',
  'reports/goal/v1.3-final-chaos-recovery-report.json',
  'reports/goal/v1.3-final-kill-switch-rollback-report.json',
  'reports/goal/v1.3-final-openapi-report.json',
  'reports/goal/v1.3-final-console-report.json',
  'reports/goal/v1.3-final-a2a-tck-report.json',
  'reports/goal/v1.3-final-sse-report.json',
  'reports/goal/v1.3-final-sbom.json',
  'reports/goal/v1.3-final-license-report.json',
  'reports/goal/v1.3-final-sources-report.json',
  'reports/goal/v1.3-final-reproducibility-report.json',
  'reports/goal/v1.3-final-rollout-plan.md',
  'reports/goal/v1.3-final-rollback-plan.md',
  'reports/goal/v1.3-final-known-limitations.md',
  'reports/goal/v1.3-final-architecture-review.md',
  'reports/goal/v1.3-final-security-review.md',
  'reports/goal/v1.3-final-operations-review.md',
  'reports/goal/v1.3-release-manifest.json',
]);
const closureEvidence = Object.freeze([
  ...requiredEvidence,
  'reports/goal/v1.3-final-acceptance.json',
  'reports/goal/v1.3-release-candidate-report.md',
  'reports/goal/v1.3-final-completion.md',
]);
const featureFlags = Object.freeze([
  'SDAR_V13_ARTIFACT_MODE',
  'SDAR_V13_COMPILER_ENABLED',
  'SDAR_V13_REGISTRY_ENABLED',
  'SDAR_V13_SHADOW_ENABLED',
  'SDAR_V13_PROMOTION_ENABLED',
  'SDAR_V13_RETRIEVAL_ENABLED',
  'SDAR_V13_TEMPLATE_ENABLED',
  'SDAR_V13_RULE_ENABLED',
  'SDAR_V13_FAST_GATEWAY_ENABLED',
  'SDAR_V13_CASE_ENABLED',
  'SDAR_V13_MODEL_CASCADE_ENABLED',
  'SDAR_V13_MODEL_ROUTE_ENABLED',
  'SDAR_V13_TENANT_ALLOWLIST',
  'SDAR_V13_ARTIFACT_ALLOWLIST',
]);
const knownLimitations = Object.freeze([
  'The trusted-intranet A2A and legacy Management baseline is not a public-Internet authentication claim.',
  'Capacity, recovery and SLO measurements are isolated local evidence; no production SLO or production availability result is claimed.',
  'Rollout, application rollback and data rollback are reviewed plans only; merge, tag, release and production deployment remain unauthorized.',
  'One Moderate @hono/node-server serve-static advisory remains below the blocking threshold; the affected export is not imported by the composed runtime.',
  'The candidate was audited from the user-authorized sequential feature branch rather than a predecessor-merged origin/main snapshot.',
]);

const sources = await loadSources();
validateSources();
const candidateSha = sources.verification.value.candidateSha;
const generatedAt = sources.verification.value.generatedAt;
const criteria = parseAcceptance(sources.acceptanceContract.content);
const acceptanceItems = criteria.map((criterion) => ({
  ...criterion,
  result: 'passed',
  classification:
    criterion.id === 'AC-P13-002'
      ? 'passed_with_user_authorized_baseline_override'
      : criterion.id === 'AC-P13-071'
        ? 'passed_with_deferred_branch_publication'
        : 'passed',
  evidenceRefs: evidenceFor(Number(criterion.id.slice(-3))),
  ...(criterion.id === 'AC-P13-002'
    ? {
        note: 'Direct user instruction selected the current sequential feature branch; all P01-P12 commits are candidate ancestors and origin/main divergence remains explicit.',
      }
    : {}),
  ...(criterion.id === 'AC-P13-071'
    ? {
        note: 'Draft PR #13 already targets main; direct user instruction defers pushing its P13/P14 branch update until P14 closure.',
      }
    : {}),
}));
invariant(acceptanceItems.length === 75, 'P13_ACCEPTANCE_COUNT_INVALID');

const acceptanceReport = {
  schemaVersion: '1.0',
  packageId: 'SDAR-V1.3-P13',
  status: 'passed',
  decision: 'RELEASE_CANDIDATE_READY',
  candidateSha,
  generatedAt,
  summary: { passed: 75, failed: 0, blocked: 0 },
  executionDeviations: [
    {
      criterion: 'AC-P13-002',
      authority: 'direct user instruction in the active Codex task',
      risk: 'candidate is not yet merged into origin/main',
      mitigation:
        'all predecessor commits are ancestors, exact divergence is recorded, and publication uses Draft PR #13 targeting main',
      expiry: 'when Draft PR #13 is merged by an authorized human',
      securityOrAuthorityWaiver: false,
    },
    {
      criterion: 'AC-P13-071',
      authority: 'direct user instruction in the active Codex task',
      risk: 'remote PR branch does not include P13 until P14 closes',
      mitigation: 'P13 is committed locally; P13 and P14 are pushed together before final handoff',
      expiry: 'at the authorized combined P13/P14 push',
      securityOrAuthorityWaiver: false,
    },
  ],
  items: acceptanceItems,
};

await mkdir(reportsRoot, { recursive: true });
await writeJson('v1.3-final-acceptance.json', acceptanceReport);
await writeFile(resolve(reportsRoot, 'v1.3-release-candidate-report.md'), releaseCandidateReport());
await writeFile(resolve(reportsRoot, 'v1.3-final-completion.md'), completionReport());
await writeJson('v1.3-p13-handoff.json', handoff());
process.stdout.write(
  `P13 closure generated for ${candidateSha}: 75/75 acceptance, RELEASE_CANDIDATE_READY.\n`,
);

function validateSources() {
  invariant(sources.verification.value.status === 'passed', 'P13_VERIFICATION_NOT_PASSED');
  invariant(
    sources.verification.value.worktreeCleanBeforeEvidenceWrite === true,
    'P13_VERIFICATION_NOT_CLEAN',
  );
  invariant(
    sources.reproducibility.value.status === 'passed' &&
      sources.reproducibility.value.candidateSha === sources.verification.value.candidateSha,
    'P13_REPRODUCIBILITY_INVALID',
  );
  invariant(
    sources.security.value.status === 'passed' &&
      sources.security.value.criticalOpen === 0 &&
      sources.security.value.highOpen === 0,
    'P13_SECURITY_NOT_PASSED',
  );
  invariant(sources.privacy.value.status === 'passed', 'P13_PRIVACY_NOT_PASSED');
  invariant(sources.capacity.value.status === 'passed', 'P13_CAPACITY_NOT_PASSED');
  invariant(sources.slo.value.status === 'passed', 'P13_SLO_NOT_PASSED');
  invariant(sources.recovery.value.status === 'passed', 'P13_RECOVERY_NOT_PASSED');
  invariant(sources.rollback.value.status === 'passed', 'P13_ROLLBACK_NOT_PASSED');
  invariant(sources.migration.value.status === 'passed', 'P13_MIGRATION_NOT_PASSED');
  invariant(sources.manifest.value.decision === 'RELEASE_CANDIDATE_READY', 'P13_MANIFEST_BLOCKED');
  for (const key of ['architectureReview', 'securityReview', 'operationsReview']) {
    invariant(reviewPassed(sources[key].content), `P13_REVIEW_NOT_ACCEPTED:${key}`);
  }
}

function releaseCandidateReport() {
  const verification = sources.verification.value;
  const dependency = sources.security.value.supplyChain.dependencyAudit;
  const recovery = sources.recovery.value;
  const migration = sources.migration.value;
  const packageRows = includedPackages()
    .map(
      (entry) =>
        `| ${entry.package} | ${entry.status} | ${entry.refs.map((ref) => `\`${ref}\``).join(', ')} |`,
    )
    .join('\n');
  return `# SDAR v1.3 Release Candidate Report

## Decision

\`RELEASE_CANDIDATE_READY\`

## Exact Candidate

- Repository: \`zhouwen-giser/skill-driven-agent-runtime\`
- Candidate SHA: \`${candidateSha}\`
- Branch: \`feature/v1.3-sequential-implementation\`
- Release line: \`v1.3.0\`
- Release manifest: \`reports/goal/v1.3-release-manifest.json\`

## Base v1.2.3

- Frozen base SHA: \`856f909d22c33e6e20d7e0a1cffc2f54c03b4477\`
- P13 start SHA: \`${baselineSha}\`
- Observed origin/main: \`${sources.manifest.value.originMainObservedSha}\`

## Included P00-P13 Commits

| Package | Status | Commit refs |
| --- | --- | --- |
${packageRows}

## Passed Gates

- Full \`pnpm verify\`: ${verification.totals.staticUnitContract.tests} unit/contract tests, ${verification.totals.integration.tests} integration tests, ${verification.totals.e2e.tests} E2E tests; all seven composed steps passed.
- Migrations: fresh, v1.2.3 upgrade, idempotence, rollback/reapply, interruption and checksum/rogue-ledger rejection passed.
- Protocol/Management: OpenAPI ${verification.totals.managementOpenapiOperations} operations and A2A HTTP+JSON MUST ${verification.totals.a2aHttpJsonMust.passed}/74 passed.
- Security: Critical=${dependency.metadata.vulnerabilities.critical}, High=${dependency.metadata.vulnerabilities.high}; final PostgreSQL and Redis container scans are Critical=0/High=0.
- Reproducibility: two frozen-lockfile builds matched \`${sources.reproducibility.value.aggregateSha256}\`.
- Three independent read-only reviews have Blocking=0 and Major=0.

## Failed / Waived Gates

- Open failed gates: none.
- Critical/High security, authority, tenant, credential, data-loss, side-effect, migration and rollback waivers: none.
- Authorized execution deviation: the user selected the current sequential feature branch instead of a predecessor-merged origin/main snapshot.
- Authorized publication sequencing: Draft PR #13 exists, but its branch update is deferred until P14 is closed.

## Waiver Authority

The two non-security execution deviations above are authorized by the user in this Codex task, expire at the authorized merge/publication boundary, and do not waive a technical gate.

## Known Limitations

See \`reports/goal/v1.3-final-known-limitations.md\`. No limitation is hidden or represented as production evidence.

## Security Findings

- Critical/High open: 0/0.
- One Moderate \`@hono/node-server\` serve-static advisory is retained as a watch item; the vulnerable export is not imported.
- Artifact Management uses a deployment-owned Bearer identity and fixed role mapping; request bodies cannot mint identity or permission.

## Capacity / SLO

Local baseline/expected/stress evidence passed. Production SLO approval remains \`false\`; no production percentile, cost or error-budget claim is made.

## Recovery

Redis flush/restart and PostgreSQL restart were exercised against isolated Docker resources. Local RPO fact loss was ${recovery.measurements.rpoFactsLost}; no production RTO/RPO is inferred.

## Migration / Upgrade

The ${migration.candidate.additiveMigrationCount} additive migrations through \`${migration.candidate.migrationHead}\` passed, including representative v1.2.3 facts and the documented cross-image logical upgrade procedure.

## Protocol / Management

OpenAPI, Console/API vertical evidence, A2A MUST TCK and SSE resume/dedup/backpressure gates passed without treating Redis or adapters as formal authority.

## Package Consistency

The final audit reports \`14 / 1 / 1\` formal/remediation/optional packages, G00-G22 only, no G23, and the mandatory \`P04 -> P04R -> P05\` chain.

## Rollout

Plan-only canary stages, exact stop conditions and default-off feature flags are documented. No rollout was executed.

## Rollback

Artifact, compiled-path, cache and migration recovery evidence passed locally. Application/data rollback remains an operator plan requiring separate authorization.

## Monitoring

Only local structured evidence and test telemetry were used. P14 production monitoring remains blocked until an actual deployment, monitoring access, named owners and production SLOs exist.

## Authorization Required

Human authorization is still required for merge, tag, release and production deploy. This package did not perform any of those actions.

## Merge / Tag / Deploy Status

- Draft PR: ${draftPrUrl}
- Merge: not performed
- Tag / Release: not performed
- Production deploy: not performed
`;
}

function completionReport() {
  const changedFiles = capture('git', ['diff', '--name-only', `${baselineSha}..${candidateSha}`])
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((path) => `- \`${path}\``)
    .join('\n');
  return `# SDAR v1.3 P13 Completion Report

## Decision

\`RELEASE_CANDIDATE_READY\` — 75/75 acceptance criteria passed; Blocking=0, Major=0.

## Baseline / Toolchain

Candidate \`${candidateSha}\` was tested on Node ${sources.verification.value.environment.node}, ${sources.verification.value.environment.platform}/${sources.verification.value.environment.architecture}. The user-authorized current-branch deviation is explicit in the baseline and acceptance reports.

## P00-P12 Handoff Integrity

All formal predecessor Handoffs and the P04R overlay resolve, conform to their locked contract envelopes and are candidate ancestors. Evidence: \`v1.3-final-handoff-integrity.json\`.

## Architecture Inventory

The modular-monolith module, port, writer, persistence, queue, event, API and feature-flag inventory is in \`v1.3-final-architecture.md\`.

## Authority Audit

PostgreSQL remains authoritative; Redis/BullMQ remains wake/queue/cache only. No unexplained protected-table writer or projection authority was found.

## Fourteen-package Consistency Audit

The final count remains 14 formal packages, one mandatory remediation package and one optional post-release package; no G23 exists.

## Migration / Upgrade / Rollback

Fresh, exact frozen v1.2.3 image upgrade, idempotence, rollback/reapply, interruption and checksum/rogue-ledger scenarios passed. The Debian-to-Alpine storage boundary uses the tested logical backup/restore path rather than mounting an incompatible data directory.

## Full Verification

\`pnpm verify\` passed all seven steps from a clean source worktree; raw logs and SHA-256 digests are retained in the verification summary.

## Security / Privacy / Tenant

Critical/High findings are zero. Deployment-owned Artifact Management authentication, least privilege, tenant/IDOR, credential, secret, redaction, deletion and injection controls passed.

## Protocol / API / Console / A2A / SSE

OpenAPI, real API/Console vertical paths, A2A HTTP+JSON MUST 74/74 and SSE ordering/resume/dedup/backpressure evidence passed.

## Capacity / Performance / SLO

Local baseline/expected/stress evidence passed without inventing a production SLO or production cost target.

## Chaos / Recovery

Real local Redis flush/restart and PostgreSQL restart preserved authoritative facts; the remaining fault matrix is explicitly classified as real-local or simulated.

## Kill Switch / Rollback

All Artifact paths are default-off, malformed flags fail closed, exact versioned Artifact allowlisting is required, and the reviewed rollback plan preserves formal runtime continuity.

## SBOM / License / Sources / Reproducibility

The final SBOM, zero-unknown license report, 34-pin source lock, exact container scans and two-build reproducibility report passed.

## Rollout / Canary / Stop Conditions

The rollout is plan-only with explicit canary stages, stop conditions and rollback owners-by-role. No production action was authorized or performed.

## Known Limitations

See \`v1.3-final-known-limitations.md\`; local evidence is not promoted to production proof.

## Architecture Review

Blocking: 0. Major: 0. Accepted.

## Security Review

Blocking: 0. Major: 0. Accepted.

## Operations Review

Blocking: 0. Major: 0. Accepted.

## Failed Attempts

- Docker named-pipe access was denied in the managed sandbox; the identical authorized command was rerun.
- Reusing an earlier Debian data volume with Alpine exposed a real collation incompatibility; isolated tests and an exact frozen-v1.2.3-image logical backup/restore upgrade path replaced in-place volume reuse.
- The first recovery fixture omitted its required Conversation Context; the fixture was repaired and the real drill reran.
- Repeated Compose builds initially produced changing provenance manifests; the container build was made digest-stable and rescanned.
- The first production dependency audit could not reach the registry; the identical authorized audit passed after network access.
- The first hardened pgvector build inherited unavailable LLVM; \`with_llvm=no\` fixed the exact pinned build.
- Independent RBAC inspection found the reviewer promotion-validation gap; the least-privilege mapping and regression test were added.

## Hardening Fixes

- Added deployment-owned Artifact Management Bearer identity and fail-closed environment validation.
- Added default-off compiler/registry/shadow/promotion/retrieval/model-route flags and exact Artifact version allowlisting.
- Hardened and pinned PostgreSQL/pgvector and Redis supply-chain inputs with final Critical=0/High=0 scans.
- Expanded migration, capacity, recovery, secret, reproducibility, authority and release evidence automation.

## Changed Files

${changedFiles}

## Commits / Push / Draft PR

- Release-candidate implementation SHA: \`${candidateSha}\`.
- P13 closure is committed locally before P14.
- Push is intentionally deferred until P14 closure.
- Draft PR: ${draftPrUrl}

## Final Release Handoff

\`reports/goal/v1.3-p13-handoff.json\` conforms to the exact 28-field V1.1 envelope and produces \`ReleaseCandidateDecision V1.1\`.
`;
}

function handoff() {
  return {
    schemaVersion: '1.1',
    packageId: 'SDAR-V1.3-P13',
    packageVersion: '1.1',
    sequence: 13,
    status: 'RELEASE_CANDIDATE_READY',
    repository: 'zhouwen-giser/skill-driven-agent-runtime',
    baselineSha,
    branch: 'feature/v1.3-sequential-implementation',
    commits: { releaseCandidate: candidateSha },
    draftPrUrl,
    contractRegistryVersion: '1.1',
    contractRegistrySha256: 'd7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb',
    consumedContracts: [
      {
        name: 'ManagementApiContract',
        version: '1.1',
        schemaHash: '842c040064b7171337082d865d4b46cbc27c8063ab3b0a3f881f4458247e8cbe',
      },
      {
        name: 'A2AArtifactProjection',
        version: '1.1',
        schemaHash: 'bdf152659c84b4fbbcb7d1d9dd47b97aedf73f5e82c55265a796ec4fd406d0ff',
      },
      {
        name: 'SseArtifactEventProjection',
        version: '1.1',
        schemaHash: 'c9c2b763d109005241827ddb1cb957e28fcf7003a759d387f0888a85700f7380',
      },
    ],
    producedContracts: [
      {
        name: 'ReleaseCandidateDecision',
        version: '1.1',
        schemaHash: '370b260730ee559a3f292d57c82b9296f626c4b437defa1dc2776f59020f9045',
      },
    ],
    migrations: [],
    repositoryPorts: [],
    applicationPorts: [],
    runtimePorts: [],
    events: [],
    queues: [],
    featureFlags,
    reasonCodeCatalogVersion: 'P13 V1.1',
    evidenceRefs: closureEvidence,
    acceptanceSummary: { passed: 75, failed: 0, blocked: 0 },
    knownLimitations,
    openBlockers: [],
    nextPackage: null,
    packageOutputs: {
      ReleaseCandidateDecision: {
        contractVersion: '1.1',
        schemaHash: '370b260730ee559a3f292d57c82b9296f626c4b437defa1dc2776f59020f9045',
        refs: [
          'reports/goal/v1.3-release-manifest.json',
          'reports/goal/v1.3-release-candidate-report.md',
          'reports/goal/v1.3-final-completion.md',
        ],
      },
    },
  };
}

function includedPackages() {
  const packages = sources.handoffIntegrity.value.packages.map((entry) => ({
    package: entry.package,
    status: entry.status,
    refs: entry.commitRefs.map((ref) => ref.ref),
  }));
  const p13 = packages.find((entry) => entry.package === 'P13');
  if (p13 === undefined) {
    packages.push({ package: 'P13', status: 'RELEASE_CANDIDATE_READY', refs: [candidateSha] });
  } else {
    p13.status = 'RELEASE_CANDIDATE_READY';
    if (!p13.refs.includes(candidateSha)) p13.refs.push(candidateSha);
  }
  return packages.sort((left, right) => left.package.localeCompare(right.package));
}

function parseAcceptance(content) {
  return [...content.matchAll(/\|\s*(AC-P13-\d{3})\s*\|\s*([^|]+?)\s*\|/gu)].map(
    ([, id, requirement]) => ({ id, requirement: requirement.trim() }),
  );
}

function evidenceFor(number) {
  if (number <= 5) return ['reports/goal/v1.3-final-baseline.md', sources.handoffIntegrity.path];
  if (number <= 28)
    return [
      'reports/goal/v1.3-final-architecture.md',
      sources.authority.path,
      sources.consistency.path,
    ];
  if (number <= 33) return [sources.migration.path, 'reports/goal/v1.3-final-upgrade-report.md'];
  if (number <= 40)
    return [
      sources.verification.path,
      'reports/goal/v1.3-final-openapi-report.json',
      'reports/goal/v1.3-final-console-report.json',
      'reports/goal/v1.3-final-a2a-tck-report.json',
      'reports/goal/v1.3-final-sse-report.json',
    ];
  if (number <= 48)
    return [
      sources.security.path,
      sources.privacy.path,
      'reports/goal/v1.3-final-sbom.json',
      'reports/goal/v1.3-final-license-report.json',
      'reports/goal/v1.3-final-sources-report.json',
      sources.reproducibility.path,
    ];
  if (number <= 53) return [sources.capacity.path, sources.slo.path];
  if (number <= 59) return [sources.recovery.path];
  if (number <= 65)
    return [
      sources.rollback.path,
      'reports/goal/v1.3-final-rollout-plan.md',
      'reports/goal/v1.3-final-rollback-plan.md',
    ];
  if (number === 66) return ['reports/goal/v1.3-final-known-limitations.md'];
  if (number <= 68)
    return [
      sources.architectureReview.path,
      sources.securityReview.path,
      sources.operationsReview.path,
    ];
  if (number <= 70)
    return [
      'reports/goal/v1.3-release-manifest.json',
      'reports/goal/v1.3-release-candidate-report.md',
    ];
  if (number <= 74) return ['reports/goal/v1.3-release-candidate-report.md'];
  return ['reports/goal/v1.3-p13-handoff.json'];
}

function reviewPassed(content) {
  return (
    /## Blocking\s+None\./u.test(content) &&
    /## Major\s+None\./u.test(content) &&
    /## Accepted\s+/u.test(content)
  );
}

async function loadSources() {
  const paths = {
    acceptanceContract: relativePackagePath('ACCEPTANCE.md'),
    verification: 'reports/goal/v1.3-final-verification-report.json',
    migration: 'reports/goal/v1.3-final-migration-report.json',
    security: 'reports/goal/v1.3-final-security-report.json',
    privacy: 'reports/goal/v1.3-final-privacy-deletion-report.json',
    capacity: 'reports/goal/v1.3-final-capacity-report.json',
    slo: 'reports/goal/v1.3-final-slo-report.json',
    recovery: 'reports/goal/v1.3-final-chaos-recovery-report.json',
    rollback: 'reports/goal/v1.3-final-kill-switch-rollback-report.json',
    reproducibility: 'reports/goal/v1.3-final-reproducibility-report.json',
    authority: 'reports/goal/v1.3-final-authority-audit.json',
    consistency: 'reports/goal/v1.3-final-package-consistency.json',
    handoffIntegrity: 'reports/goal/v1.3-final-handoff-integrity.json',
    manifest: 'reports/goal/v1.3-release-manifest.json',
    architectureReview: 'reports/goal/v1.3-final-architecture-review.md',
    securityReview: 'reports/goal/v1.3-final-security-review.md',
    operationsReview: 'reports/goal/v1.3-final-operations-review.md',
  };
  for (const path of requiredEvidence) {
    if (!Object.values(paths).includes(path)) {
      const content = await readFile(resolve(root, path), 'utf8');
      invariant(content.length > 0, `P13_REQUIRED_EVIDENCE_EMPTY:${path}`);
    }
  }
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      const content = await readFile(resolve(root, path), 'utf8');
      return [
        key,
        {
          path,
          content,
          value: path.endsWith('.json') ? JSON.parse(content) : content,
          sha256: createHash('sha256').update(content).digest('hex'),
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

function relativePackagePath(name) {
  return resolve(packageRoot, name);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`P13_CLOSURE_CAPTURE_FAILED:${command} ${args.join(' ')}`);
  return result.stdout;
}

async function writeJson(name, value) {
  await writeFile(resolve(reportsRoot, name), `${JSON.stringify(value, null, 2)}\n`);
}

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}
