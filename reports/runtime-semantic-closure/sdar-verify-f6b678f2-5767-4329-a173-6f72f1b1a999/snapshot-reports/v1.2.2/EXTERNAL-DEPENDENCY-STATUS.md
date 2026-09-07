# External Provider Dependency Status

Final observation: 2026-07-22. The sibling Provider repository remained read-only to SDAR.

## Repository boundary

- Required ancestor: `ee14d2fa2b5130d3c7c016c71737175a124d5134`, present.
- Qualified asset/runtime candidate: `8a81b1b02971fb124ed96372c440c449f9087c99`.
- The external worktree moved independently from the initial `196620a` observation to later commits and
  ended the audit clean at `375927d937ba316fd971f57c148e8ff065f8976f`.
- To prevent a moving worktree from changing the candidate, SDAR used a `git archive` extraction of exact
  `8a81b1b`, installed/built it in `/tmp`, and used only its public HTTP interface.
- SDAR created no Provider branch, source/schema/migration/test edit, commit, tag or PR.

## EXT-BE-SKELETON

Status: `satisfied`.

`protocol/business-events/provider-v1.0/SOURCE.json` records 23 exact Apache-2.0 asset hashes. All
vendored protocol/fixture/golden/proto files are byte-identical to `8a81b1b`. ADR-110 and the OSS intake
approve only this boundary; no Provider runtime/generation source is copied.

## EXT-BE-RUNTIME-CANDIDATE

Status: `satisfied_exact_candidate`.

Real SDAR Streamable HTTP interop passed against Provider `8a81b1b`: Discovery, empty Ack, 260 Tasks,
Task/Resource Events, stable 128/128/4 Relation pages, durable admission, closed-generation Drain,
typed Reset, Continuity rollover, Provider unavailability, restart and eight reconnects. See
`reports/v1.2.2-interop/real-provider-interop.{md,json}`.

## Provider defects

No unresolved Provider defect. All retained failures were SDAR/test-driver/infrastructure issues and
were closed without modifying Provider. Qualification does not extend to the external worktree's newer
HEAD or arbitrary future Provider commits.
