# SDAR v1.3 Orchestration Blockers

## P00 — `V123_RELEASE_DEVIATION_NOT_ACCEPTED`

Severity: blocking

Status: closed on 2026-07-26 by explicit repository-owner acceptance.

Effect: none. The local P00 baseline decision is `READY_FULL`.

### Evidence before remediation

- `docs/16_DEFINITION_OF_DONE.md` retained an unchecked v1.2.3 protected-review release item.
- `docs/17_TRACEABILITY_MATRIX.md` recorded `AC-G17-09` and `AC-MASTER-05` as failed.
- `reports/v1.2.3-release/release-report.json` recorded
  `requiredUnmergedStateSatisfied=false` and `failed_external_merge`.
- Independent review: `reports/goal/v1.3-p00-review.md`.

`origin/main` and the lightweight `v1.2.3-final` tag both resolve to
`856f909d22c33e6e20d7e0a1cffc2f54c03b4477`, and every runtime/full verification gate passes. Those
facts did not supply the missing repository-owner acceptance of the recorded release deviation.

### Accepted remediation

The repository owner selected the authority-preserving acceptance path. All three authority records
were synchronized; P00 self-check and evidence
validation pass, clean full `pnpm verify` passed at `6e27d70`, contract alignment passed and a fresh
independent read-only review accepted `READY_FULL`.

## P00 remote checklist — `GITHUB_AUTH_INVALID`

Severity: external coordination

Status: closed on 2026-07-26 after GitHub authentication was restored.

Effect: none. The branch is pushed and Draft PR #12 exists.

`gh --version` and `gh auth status` pass for the active `zhouwen-giser` account.

Completed remediation:

1. restored GitHub CLI authentication;
2. confirmed the remote integration branch at
   `cbd90697c6ba72581a8898e366b4f71d860eac1d`;
3. created Draft PR #12 targeting `main`;
4. recorded <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/12>.

No merge, tag, release or deploy is authorized.

## P01 first independent review

Severity: two blocking, two major.

Status: closed on 2026-07-27.

The first review rejected P01 for PlanTemplate/P04 incompatibility, Domain/Zod/AJV drift, an Active
construction bypass, incomplete nested validation and overstated evidence. All findings were fixed
by the main implementation Agent and rerun through focused and full gates. A new independent
read-only review accepted the remediated tree with zero blocking/major findings. Its one
documentation-only minor item was also closed. P01 Handoff is `READY_FULL` with no open blocker.

## P02 independent reviews

Severity: six Blocking, eight Major and one Minor across three rejected snapshots.

Status: closed on 2026-07-27.

The first three independent read-only reviews rejected stale evidence/tenant/CAS/Outbox,
immutability, cache, bounds and commit-order defects. Each exact negative record remains preserved.
All findings were corrected and rerun through focused, migration and full gates without weakening
assertions. A fourth new independent read-only reviewer accepted exact commit `14abffe` with zero
Blocking, Major or Minor findings. P02 Handoff is `COMPLETED` with no open blocker.

## P03 final evidence gate — `P03_OPERATOR_DATABASE_BASELINE_SMOKE`

Severity: external evidence environment.

Status: open on 2026-07-27.

The remediation full gate at `1f7e043` passed format, lint, typecheck, 828 unit/contract tests,
architecture, A2A, OpenAPI, all 19 migration checks, 100 real integration tests, 62 real E2E tests
and production build. The final infrastructure smoke queried the protected operator-managed
`/sdar` database and did not find `v1.2.2_clean_slate_baseline`. This predates P03 and is already
documented under the P02 environment boundary.

P03 will not overwrite/reset the operator database or redirect evidence to an unmigrated fallback.
Minimum closure is a clean full gate against a dedicated freshly migrated database. The attempt to
perform the required local database operation was rejected by the Codex usage limit after the user
restored authentication; no workaround was attempted.

Effect: P03 remains `IN_REVIEW`; AC-P03-028 and the final Handoff remain open, and P04 is not started.
