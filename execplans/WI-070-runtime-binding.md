# WI-070 — authoritative Runtime / Provider binding

## Purpose / Outcome

Persist the frozen development-v1 Runtime binding before accepting a remote admission. A missing or conflicting Provider identity remains unresolved and never authorizes redispatch. Genuine direct MCP tasks remain a separate authority variant, not a nullable SMPP compatibility path.

## Requirements Covered

WI-070-A01: all 20 frozen fields; A02: receipt/invocation/binding atomicity; A03: deterministic revision and terminal observations. Normative control contract: `runtime-provider-binding.v1.json`, SHA-256 `9861742fa0480bd07a851741715f8c9e5d8401885c19ec3a6e89c341ac710edb`; Decision `ADR-G03-binding-authority.md`, SHA-256 `2b9b424d1522ea90bf29a9f1b2774c6628a98adc977cc3ddbb29b964b3c3afbb`.

## Context and Orientation

Base commit `bb1542cce174923b30c89bf02b91c945a53305cb`. `McpRegistryService` freezes discovery authority before transport; the durable admission journal currently stores only dispatch hash, then receipt/invocation, and later materializes binding. PostgreSQL poll and external observation paths currently use different freshness rules. The MCP evidence projector emits a thin binding payload.

## Architecture and Interfaces

Add strict sibling Task metadata `io.sdar/providerIdentity`. Preserve provider identity across create/get/notification mapping. Add explicit trusted `SDAR_RUNTIME_TENANT_ID` and `SDAR_RUNTIME_PROJECT_ID` configuration, using existing `SDAR_CONTROL_ENVIRONMENT`; no global defaults. Freeze scope and verified SDAR registry revision/checksum before dispatch. Model direct and SMPP binding authority explicitly. Persist complete SMPP authority with the accepted receipt and invocation in one PostgreSQL transaction. Compare canonical Provider runtimeRevision losslessly and compare validated semantic Task content independently of arrival time, trace/correlation and unknown metadata.

## Progress

- [x] 2026-08-26 Read-only preparation, exact contract/source verification, scope confirmation.
- [x] 2026-08-26 G03 PASS and formal WI-070 claim received; isolated worktree created.
- [x] 2026-08-26 Implemented domain, metadata and durable admission authority; focused validation recorded below.
- [x] 2026-08-26 Implemented migration 0174, shared transaction and revision classifier; actual PostgreSQL validation remains pending.
- [x] 2026-08-26 Implemented exact canonical 20-field evidence projection with missing-field blocking tests.
- [ ] Run focused checks and prepare leased PostgreSQL integration evidence.
- [ ] Candidate commit, review, authorized push/PR and handoff.

2026-08-26T07:57Z interim boundary: domain/metadata, registry pre-dispatch snapshot,
shared receipt/invocation/binding transaction, migration 0174, revision classifier,
and canonical 20-field projection are implemented in the dirty isolated worktree,
but are not accepted as complete. Six focused unit/contract files passed all 124
tests. Whole-workspace typecheck still exits 2 (two missing console dependency
types, one authority union construction type, five optional revision test types).
A dedicated PostgreSQL integration file was added afterward and has not run.
The writer stops on context compaction; a same-role successor must take the sole
Runtime lane and complete the remaining verification and live-profile extension.

## Discoveries and Surprises

Node Control's HTTP reader already carries and checks exact external provider and registry projection fields, but the application port drops their types. Existing `remote_task_binding.authority_snapshot_json` admits legacy nulls. Provider ID in real WI-050 registry and Provider observations is exactly `isr.vehicle.ugv.ugv1`; no identity translation is needed.

## Decision Log

Root confirmed direct support is retained as a discriminated variant; old missing-snapshot fallback is removed. Only SMPP admission requires the new trusted scope configuration. The binding patch does not yet implement the separately identified UGV live-profile gap or change device safety/control behavior. Root subsequently authorized a narrow live-profile extension through `DEC-G04-EXTERNAL-UGV-LIVE-PROFILE.md` (SHA-256 `6ea4e35ef78e1799f665a5205881173290fbd064fe9c05e072cc11bd153fae74`); the successor must read that full Decision before implementing the extension, preferably after a coherent binding candidate boundary.

## Implementation Steps

1. Domain/provider metadata and exact authority types.
2. Pre-dispatch journal snapshot, atomic receipt/binding transaction, empty-development migration.
3. Shared revision/content classification and complete evidence projection.
4. Existing focused tests, typecheck, changed-file lint/format, candidate evidence.

## Validation

Use focused domain, MCP lifecycle, registry, journal/recovery and evidence projector tests. PostgreSQL transaction and migration integration requires the Run Controller's leased empty database; this writer does not start shared infrastructure. No unrelated full-suite or device invocation is required for this work item.

## Idempotence and Recovery

Same invocation and immutable identity is idempotent. Conflicting identity is never overwritten. Dispatching/uncertain intent is never replayed. Missing required authority cannot yield an accepted complete binding. Later registry changes do not repair historical snapshots.

## Artifacts and Evidence

Implementation report and command results live under this Runtime worktree. Root may assemble the control-repository handoff from exact candidate commit, hashes and actual validation material. No Gate PASS is asserted here.

- `reports/wi070-focused-in-progress.json`: actual 124/124 unit/contract result;
  SHA-256 `5b21344cb1948f42a9fe811163a058f41a484e71a13b40fc35f067f0ec5a2427`.
- `reports/wi070-binding-interim-20260826T075758Z.json`: recovery handoff material,
  implementation map, exact validation state and next steps. It is not a completed
  Work Item handoff or evidence of a PostgreSQL/live/Gate pass.

## Outcomes and Retrospective

Binding implementation is ready for focused verification and an exact candidate commit.
Shared-database validation, live-profile implementation, independent review and
integration adoption remain pending. No Gate PASS or physical outcome is claimed.

## Successor checkpoint — 2026-08-26

The successor verified all 31 dirty-file hashes and the tracked diff before editing.
Finished strict union typing, canonical numeric Provider revisions, explicit whole
Runtime scope configuration, missing authority and identity tests, 20-field
projection tests, and claimed-poll PostgreSQL coverage. Migration 0174 now has a
ledger insert/delete and an explicit migration-router entry. The accepted Provider
event index includes runtimeRevision so later accepted observations are not lost
when the Provider retains the same event ID. Neither Provider timestamp nor opaque
providerRevision substitutes for Runtime task sequence.

The dedicated PostgreSQL suite creates only
`sdar_wi070_binding_authority_integration` from template0 on an explicitly supplied
`SDAR_TEST_POSTGRES_URL`. It fails on an existing database name and drops only its
own database. The Run Controller must execute it under the separate WI-075 lease
against this exact committed candidate; this writer never opens the database.

The adopted live-profile Decision also permits a directly scoped follow-up commit.
Read-only mapping established that live mode must be carried through selected
Task operation, UGV profile/qualification, governed control, workflow evidence and
terminal/position consumers. A local durable qualification receipt is necessary
because the existing taskless MCP invocation lacks frozen Provider-binding scope.
The request/receipt reference is local qualification provenance, never navigation
binding authority. Root approved the bounded design; implementation is pending.

## Binding correction checkpoint — 2026-08-26

The deliberate phase successor reproduced two review findings against `a86a0ee`:
transport observation state could advance for an identity rejected by the Runtime
repository, and Task equality incorrectly applied Evidence export limits. No live
source or shared environment operation was part of this correction.

- [x] Separate bounded wire parsing from accepted lifecycle state for Runtime adapters.
- [x] Keep standalone lifecycle revision/terminal/input-key/submission state semantics.
- [x] Check accepted input-key history in both repository paths under the binding lock,
      before changing the accepted snapshot or emitting control; add `input_key_conflict`.
- [x] Compare Task JSON deterministically without Evidence-only size/key/array limits.
- [x] Reproduce A5 → B100 → A6 through the actual Runtime adapter, registry and repository
      with a query double. All nine failure cases reproduce on a86a0ee; the three polling
      cases with a fresh client pass there, proving the old restart-dependent outcome.
- [x] Add a controller-only PostgreSQL fixture for rejected versus accepted input-key
      history, poll/notification conflicts, and large detailed Task duplicate/content conflict.
- [ ] Actual PostgreSQL execution, independent review, live profile, push/PR and Gate G04.

The query double does not prove PostgreSQL SQL execution, lock/rollback semantics,
or device behavior. Its test source uses the real adapter/registry/repository and
injects only query results. Runtime input submission uses the persisted link's exact
keys and status; a fresh wire client cannot silently turn an empty map into an Ack.
The standalone protocol API retains its own submitted-key replay handling.

Correction evidence is indexed in `reports/runtime-binding-correction.json`.
Raw `wi070-correction-*.json`/logs stay local and the a86a0ee report remains unchanged.
The final report, not an in-progress test invocation, records completed check results.

## Durable input-key correction checkpoint — 2026-08-26

- [x] Reproduce the held `44a0834` cross-link replay through the real input service,
      Runtime wire adapter and repositories with query doubles: ACK and lost-response
      cases both sent `k`, then `k`, then `j+k` across new links/restarts.
- [x] Derive eligibility from persisted accepted detailed observations and real
      acknowledgement/attempt/reservation history. Preserve full raw Task snapshots.
- [x] Keep unsent keys open across local question replacement. Basic input projections,
      admission summaries, local failure evidence and rejected identity history do not
      establish Provider supersession.
- [x] Reserve uncertainty and pollability before wire dispatch under the binding lock;
      return the incremented binding version for exact outcome CAS. Save actual ACK and
      attempt before that CAS, including when a newer observation wins.
- [x] Allow input controls through `claimControl` without a terminal state transition;
      preserve the terminal and missing-continuation guards.
- [x] Extend the existing PostgreSQL fixture with actual continuation/input activation,
      open-link replacement, acknowledged later-revision/mixed-key filtering, two
      concurrent reservations and restart polling. No schema addition was needed.
- [x] Final 12-file selector: 247 passed, zero failed/pending. Whole-workspace typecheck,
      seven-file ESLint, scoped formatting and `git diff --check` all exit zero.
- [ ] Run Controller executes the exact five-case PostgreSQL fixture on the new pin.
- [ ] Independent review, separate LIVE implementation, authorized push/PR and G04.

The final focused commands, results and raw hashes are in
`reports/runtime-binding-input-key-correction.json`. Query-double wire evidence is
explicitly separate from SQL/locking/rollback evidence. All earlier reports and both
the a86 and 44a verification pins remain unchanged.
