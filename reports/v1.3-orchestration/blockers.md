# SDAR v1.3 Orchestration Blockers

## P00 — `V123_RELEASE_DEVIATION_NOT_ACCEPTED`

Severity: blocking

Status: open

Effect: P00 is `BLOCKED_BASELINE`; P01–P13 are forbidden.

### Evidence

- `docs/16_DEFINITION_OF_DONE.md` retains an unchecked v1.2.3 protected-review release item.
- `docs/17_TRACEABILITY_MATRIX.md` records `AC-G17-09` and `AC-MASTER-05` as failed.
- `reports/v1.2.3-release/release-report.json` records
  `requiredUnmergedStateSatisfied=false` and `failed_external_merge`.
- Independent review: `reports/goal/v1.3-p00-review.md`.

`origin/main` and the lightweight `v1.2.3-final` tag both resolve to
`856f909d22c33e6e20d7e0a1cffc2f54c03b4477`, and every runtime/full verification gate passes. Those
facts do not supply the missing repository-owner acceptance of the recorded release deviation.

### Minimum remediation

Choose one authority-preserving path:

1. the repository owner explicitly accepts the external merge deviation, then
   `docs/16_DEFINITION_OF_DONE.md`, `docs/17_TRACEABILITY_MATRIX.md` and
   `reports/v1.2.3-release/release-report.json` are updated consistently with that acceptance; or
2. restore and re-run the required protected-review release path, replacing the failed acceptance
   evidence.

After remediation, re-run P00 self-check, the P00 evidence validator, `pnpm verify`, contract alignment
and a fresh independent read-only P00 review. Only `READY_FULL` may unlock P01.

## P00 remote checklist — `GITHUB_AUTH_INVALID`

Severity: external coordination

Status: open

Effect: local P00 evidence and blocked state are committed, but the branch is not pushed and no Draft
PR exists.

`gh --version` passes. `gh auth status` reports that the active `zhouwen-giser` token is invalid. The
GitHub publish workflow stopped before `git push` as required by the repository publish skill.

Minimum remediation:

1. run `gh auth login -h github.com`;
2. confirm `gh auth status` succeeds;
3. re-check the three-commit P00 scope;
4. push `feature/v1.3-sequential-implementation`;
5. create a Draft PR targeting `main` and record its URL.

No merge, tag, release or deploy is authorized.
