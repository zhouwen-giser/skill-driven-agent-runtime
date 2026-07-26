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

Status: open

Effect: local P00 baseline evidence is `READY_FULL`, but the branch is not pushed, no Draft PR exists
and P01 remains gated by the P00 atomic publication checklist.

`gh --version` passes. `gh auth status` reports that the active `zhouwen-giser` token is invalid. The
GitHub publish workflow stopped before `git push` as required by the repository publish skill.

Minimum remediation:

1. run `gh auth login -h github.com`;
2. confirm `gh auth status` succeeds;
3. re-check the three-commit P00 scope;
4. push `feature/v1.3-sequential-implementation`;
5. create a Draft PR targeting `main` and record its URL.

No merge, tag, release or deploy is authorized.
