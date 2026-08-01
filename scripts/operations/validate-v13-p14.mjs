import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const operations = resolve(root, 'reports', 'operations');
const requiredReports = [
  'v1.3-post-release-baseline.md',
  'v1.3-monitoring-inventory.json',
  'v1.3-slo-error-budget.md',
  'v1.3-alert-matrix.json',
  'v1.3-incident-runbook.md',
  'v1.3-rollback-runbook.md',
  'v1.3-recovery-drill-report.md',
  'v1.3-drift-review.md',
  'v1.3-feedback-quality-report.json',
  'v1.3-cost-capacity-report.md',
  'v1.3-weekly-review-template.md',
  'v1.3-monthly-governance-template.md',
  'v1.3-improvement-backlog.json',
  'v1.3-next-version-recommendation.md',
  'v1.3-p14-review.md',
  'v1.3-p14-completion.md',
  'v1.3-p14-handoff.json',
];

const contents = new Map();
for (const file of requiredReports) {
  contents.set(file, await readFile(resolve(operations, file), 'utf8'));
}

const manifest = await json(
  'docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/' +
    'SDAR_v1.3_P14_Optional_Post_Release_Operations_Codex_Goal_Package_V1.0/manifest.json',
);
assert(manifest.packageId === 'SDAR-V1.3-P14-OPTIONAL', 'P14_PACKAGE_ID_INVALID');
assert(manifest.formalPackage === false, 'P14_FORMAL_PACKAGE_DRIFT');
assert(manifest.formalPackageCount === 14, 'P14_FORMAL_PACKAGE_COUNT_DRIFT');
assert(manifest.extensionGoal === 'X01', 'P14_EXTENSION_GOAL_DRIFT');

const handoff = parseJson('v1.3-p14-handoff.json');
assert(handoff.schemaVersion === '1.0', 'P14_HANDOFF_SCHEMA_INVALID');
assert(handoff.packageId === manifest.packageId, 'P14_HANDOFF_PACKAGE_ID_INVALID');
assert(handoff.formalPackage === false, 'P14_HANDOFF_FORMAL_PACKAGE_DRIFT');
assert(handoff.formalPackageCount === 14, 'P14_HANDOFF_PACKAGE_COUNT_DRIFT');
assert(handoff.extensionGoal === 'X01', 'P14_HANDOFF_EXTENSION_GOAL_DRIFT');
assert(
  handoff.decision === 'POST_RELEASE_OPERATIONS_BLOCKED',
  'P14_HANDOFF_DECISION_OVERSTATED',
);
assert(handoff.releaseSha === '', 'P14_RELEASE_SHA_MUST_REMAIN_EMPTY');
assert(handoff.deploymentRef === '', 'P14_DEPLOYMENT_REF_MUST_REMAIN_EMPTY');
assert(handoff.productionActionsAuthorized === false, 'P14_PRODUCTION_ACTION_AUTHORITY_DRIFT');
assert(
  Array.isArray(handoff.productionActionsPerformed) && handoff.productionActionsPerformed.length === 0,
  'P14_PRODUCTION_ACTION_PERFORMED',
);
assert(handoff.reviewOutcome?.blocking === 0, 'P14_REVIEW_BLOCKING_OPEN');
assert(handoff.reviewOutcome?.major === 0, 'P14_REVIEW_MAJOR_OPEN');
assert(handoff.reviewOutcome?.minor === 0, 'P14_REVIEW_MINOR_OPEN');
assert(handoff.acceptanceSummary?.passed === 18, 'P14_ACCEPTANCE_PASS_COUNT_INVALID');
assert(handoff.acceptanceSummary?.blocked === 16, 'P14_ACCEPTANCE_BLOCKED_COUNT_INVALID');
assert(handoff.acceptanceSummary?.pending === 0, 'P14_ACCEPTANCE_PENDING_COUNT_INVALID');
assert(handoff.remoteDraftPullRequest?.state === 'OPEN', 'P14_REMOTE_PR_NOT_OPEN');
assert(handoff.remoteDraftPullRequest?.draft === true, 'P14_REMOTE_PR_NOT_DRAFT');
assert(handoff.remoteDraftPullRequest?.merged === false, 'P14_REMOTE_PR_MERGED');
assert(handoff.remoteDraftPullRequest?.base === 'main', 'P14_REMOTE_PR_BASE_INVALID');
assert(Array.isArray(handoff.openBlockers), 'P14_HANDOFF_BLOCKERS_INVALID');

const expectedBlockers = Array.from({ length: 7 }, (_, index) =>
  `P14-BLK-${String(index + 1).padStart(3, '0')}`,
);
const handoffBlockerIds = handoff.openBlockers.map((item) => item.id);
assert(handoff.openBlockers.length === expectedBlockers.length, 'P14_HANDOFF_BLOCKER_COUNT_INVALID');
assert(new Set(handoffBlockerIds).size === expectedBlockers.length, 'P14_HANDOFF_BLOCKER_DUPLICATE');
assert(
  expectedBlockers.every((id) => handoffBlockerIds.includes(id)),
  'P14_HANDOFF_BLOCKER_MISSING',
);

const completion = contents.get('v1.3-p14-completion.md');
for (const heading of [
  '## Extension Status',
  '## P13 / Release Authorization',
  '## Production Baseline',
  '## Monitoring Inventory',
  '## SLO / Error Budget',
  '## Alert Matrix',
  '## Incident Runbook',
  '## Rollback / Kill Switch',
  '## Recovery Drill',
  '## Drift / Revalidation',
  '## Feedback Quality',
  '## Cost / Capacity',
  '## Weekly Review',
  '## Monthly Governance',
  '## Improvement Backlog',
  '## Next-version Recommendation',
  '## Production Actions Performed',
  '## Operations Review',
  '## Open Blockers',
  '## Final Handoff',
]) {
  assert(completion.includes(heading), `P14_COMPLETION_HEADING_MISSING:${heading}`);
}
assert(
  completion.includes('`POST_RELEASE_OPERATIONS_BLOCKED`'),
  'P14_COMPLETION_DECISION_MISSING',
);
assert(
  completion.includes('Current count: 18 passed, 16 blocked, 0 pending.'),
  'P14_COMPLETION_ACCEPTANCE_COUNT_INVALID',
);
assert(completion.includes('| AC-P14-030 | passed |'), 'P14_REVIEW_ACCEPTANCE_NOT_CLOSED');
assert(completion.includes('| AC-P14-032 | passed |'), 'P14_DRAFT_PR_ACCEPTANCE_NOT_CLOSED');

const review = contents.get('v1.3-p14-review.md');
for (const heading of ['## Blocking', '## Major', '## Minor', '## Accepted']) {
  assert(review.includes(heading), `P14_REVIEW_HEADING_MISSING:${heading}`);
}
assert(/## Blocking\s+None\./u.test(review), 'P14_REVIEW_BLOCKING_NOT_CLOSED');
assert(/## Major\s+None\./u.test(review), 'P14_REVIEW_MAJOR_NOT_CLOSED');

const monitoring = parseJson('v1.3-monitoring-inventory.json');
assert(monitoring.status === 'planned_blocked', 'P14_MONITORING_STATUS_INVALID');
assert(monitoring.dashboardAuthority === 'projection_only', 'P14_DASHBOARD_AUTHORITY_DRIFT');
assert(monitoring.productionAccess === false, 'P14_MONITORING_ACCESS_OVERSTATED');
assert(monitoring.ownersAssigned === false, 'P14_MONITORING_OWNER_OVERSTATED');
for (const category of [
  'runtime',
  'gateway',
  'artifact',
  'rule_template_case_model',
  'workers',
  'outbox',
  'infrastructure',
  'transport',
  'provider_model',
  'security',
]) {
  assert(
    monitoring.monitors.some((monitor) => monitor.category === category),
    `P14_MONITORING_CATEGORY_MISSING:${category}`,
  );
}

const alertMatrix = parseJson('v1.3-alert-matrix.json');
assert(alertMatrix.automaticProductionActions === false, 'P14_ALERT_AUTOMATION_DRIFT');
assert(alertMatrix.status === 'planned_unassigned', 'P14_ALERT_STATUS_OVERSTATED');
for (const alert of alertMatrix.alerts) {
  for (const field of [
    'id',
    'signal',
    'threshold',
    'window',
    'severity',
    'owner',
    'dedupKey',
    'runbook',
    'recoveryCondition',
  ]) {
    assert(typeof alert[field] === 'string' && alert[field] !== '', `P14_ALERT_FIELD_MISSING:${field}`);
  }
  assert(alert.owner.startsWith('PENDING_NAMED_'), `P14_ALERT_OWNER_OVERSTATED:${alert.id}`);
  assert(alert.automaticAction === false, `P14_ALERT_AUTOMATIC_ACTION:${alert.id}`);
}

const feedback = parseJson('v1.3-feedback-quality-report.json');
assert(feedback.status === 'feedback_blocked', 'P14_FEEDBACK_STATUS_OVERSTATED');
assert(feedback.productionRecordsInspected === 0, 'P14_FEEDBACK_RECORD_CLAIM_INVALID');

const backlog = parseJson('v1.3-improvement-backlog.json');
assert(backlog.silentV13MutationAllowed === false, 'P14_SILENT_V13_MUTATION_DRIFT');
assert(backlog.status === 'blocked_inputs_backlog', 'P14_BACKLOG_STATUS_OVERSTATED');
for (const item of backlog.items) {
  for (const field of [
    'itemId',
    'sourceEvidence',
    'problem',
    'impact',
    'risk',
    'affectedPackage',
    'affectedAuthority',
    'proposedNextVersion',
    'acceptance',
    'owner',
    'priority',
    'status',
  ]) {
    const value = item[field];
    assert(
      (typeof value === 'string' && value !== '') || (Array.isArray(value) && value.length > 0),
      `P14_BACKLOG_FIELD_MISSING:${field}`,
    );
  }
  assert(item.owner.startsWith('PENDING_'), `P14_BACKLOG_OWNER_OVERSTATED:${item.itemId}`);
}

const combined = [...contents.values()].join('\n');
for (const forbidden of [
  /P14 creates G23/iu,
  /P14 is the fifteenth formal package/iu,
  /"productionActionsAuthorized"\s*:\s*true/iu,
  /"automaticProductionActions"\s*:\s*true/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
]) {
  assert(!forbidden.test(combined), `P14_FORBIDDEN_CONTENT:${String(forbidden)}`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      packageId: manifest.packageId,
      decision: handoff.decision,
      formalPackage: false,
      formalPackageCount: 14,
      extensionGoal: 'X01',
      reportsChecked: requiredReports.length,
      blockers: expectedBlockers.length,
      productionActionsAuthorized: false,
    },
    null,
    2,
  )}\n`,
);

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

function parseJson(file) {
  return JSON.parse(contents.get(file));
}

function assert(condition, code) {
  if (!condition) throw new Error(code);
}
