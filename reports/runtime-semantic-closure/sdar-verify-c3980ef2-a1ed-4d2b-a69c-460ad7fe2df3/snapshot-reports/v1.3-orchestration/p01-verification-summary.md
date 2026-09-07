# P01/G01 Verification Summary

- Status: **passed on clean completion commit**
- Verification commit: `8ac5f5e35982d6406290302c1a095a79d1031aa1`
- Dirty at gate start: no
- Duration: 174,873 ms
- Infrastructure: operator-managed PostgreSQL/Redis, existing isolated clean-baseline gate database
- Operator database modified: no

## Results

- Focused Artifact Domain/Zod/AJV: 20/20.
- Unit + contract: 785/785 across 126 files.
- Real PostgreSQL/Redis integration: 84/84.
- Real Server/A2A E2E: 62/62.
- Architecture: 435 TypeScript source files, including six Artifact Domain and two schema files.
- A2A HTTP-JSON MUST: 74/74; 161 non-MUST cases skipped by the pinned TCK scope.
- Management OpenAPI: 152 operations.
- Migration path: clean v1.2.2 baseline plus 17 additive v1.2.3 migrations.
- Cognitive Replay: passed with zero physical Provider calls.
- Production build, infrastructure smoke, and Server/Console smoke: passed.

The exact seven-step clean-commit gate is retained in `reports/verification/summary.json`.

## Retained attempts

The first bootstrap stopped at 25 strict lint findings in new files. They were all corrected without
weakening a contract or assertion. Two later smoke attempts exposed environment selection only: the
first pointed at the intentionally retained legacy operator migration ledger, and the second inherited
an expired `54329` port override. The successful run explicitly used the existing
`sdar_v13_orchestration_verify` clean-baseline isolation database on the healthy compose PostgreSQL
port. No operator database was reset.

The first post-remediation gate inside the filesystem sandbox produced 83 same-root EPERM failures
because local listening and child-process spawning were denied. The identical command passed outside
that sandbox; this was an environment failure, not a product/test relaxation.
