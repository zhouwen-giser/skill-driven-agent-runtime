# Phase 10 Completion

- Phase: 10
- Goal: Episode Manifest, Source Coverage and Evidence Quality
- Base SHA: `0868821`
- Coverage: 5/5 Evidence records; 100/100 total implemented and verified
- Required coverage: 95/95 Required and 5/5 diagnostic records are backed by per-record source,
  mapper, PostgreSQL store, focused-test and phase-evidence anchors
- Runtime path: terminal authority -> bounded canonical projector drain -> quality evaluator ->
  authority-derived expectations -> draft/projecting or sealed Manifest -> generation-1 Evidence
  infrastructure projector -> Runtime PostgreSQL Outbox
- Manifest semantics: Required facts remain pending until receiver ACK; unresolved schema, identity,
  payload or source projection failures seal as `incomplete`; diagnostic findings do not masquerade
  as missing Required evidence
- Authority: PostgreSQL owns expectation, issue, checkpoint, Manifest and export ledgers; Redis is
  wake-only and no Outbox-count heuristic decides applicability
- Registry: 100 total / 95 Required / 5 diagnostic / 100 durable projection; registry hash
  `sha256:a7ac427efdc75530aee8cb27359243084cb29a0450d62e7b19bd21feb99771e5`
- Focused Unit: 3/3 passed
- Focused Contract: 1/1 passed (10 unrelated cases skipped)
- Focused PostgreSQL: 1/1 passed (11 unrelated cases skipped)
- TypeScript: `pnpm.cmd typecheck` passed
- Coverage gate: 100/100 implemented and verified; Required 95/95; diagnostic 5/5;
  durable projection 100/100
- Independent Review: Blocking 0 / Major 0 / Minor 0 / Accepted
- Full verify: not rerun in Phase 10 by explicit user direction; the single next repository-wide
  `pnpm verify` remains scheduled for Phase 14
- Blockers: none for Phase 10
- Next phase: Management API, operations and recovery

## Functional closure

- `EpisodeEvidencePolicy` freezes all 100 records, eight observable stages and ten quality rules.
- Expected-record identity is source-instance based, supports repeated records, and excludes
  generation-1 self-observation from the authority snapshot.
- Skill applicability includes selection, input resolution and execution; MCP applicability also
  includes the exact Availability authority path.
- Task-scoped Experience, Replay and Artifact partitions preserve episode identity. Only a true
  source-listing failure is global; item failures cannot mark unrelated episodes incomplete.
- Canonical projectors isolate poison partitions with durable issue state and retry timing. The
  Server drains to a bounded quiescent point before sealing.
- Operational and rule-based Quality Issues both project canonically. Quality findings do not get
  misclassified as projection-stage failures.
- Manifest revision, authority snapshot hash, recomputation time and `sealedAt` reconstruct the
  exact draft/seal lifecycle.

## Validation and first-failure evidence

- The first formatting command included SQL migrations, which the repository Prettier setup has no
  parser for; supported TypeScript/JSON/MJS files were already formatted. The final targeted check
  excludes SQL rather than pretending SQL was formatted.
- Contract generation produced 100 records, registry hash
  `sha256:a7ac427efdc75530aee8cb27359243084cb29a0450d62e7b19bd21feb99771e5`
  and contract hash
  `sha256:56202a9da3d36e24f4ff7e516d668929c19eb6ea2a80442a9b7811029a067a77`.
- The focused PostgreSQL regression proves that an episode-scoped Required Projection Issue with
  no record type still enters the Manifest snapshot as blocking authority; it cannot be silently
  treated as non-applicable or complete.
- The report-backed matrix generator and `verify:evidence-coverage` passed with 100 unique proof
  entries and no family-level self-certified status.

## Independent read-only review

- Blocking: none.
- Major: none.
- Minor: none.
- Accepted: ACK-gated Required completion, authority-derived applicability, exact task/global issue
  scope, durable poison isolation, schema validation, bounded self-observation, idempotent
  recomputation and per-record coverage proof.

Phase 10 is closed for implementation and handoff. Phase 11 may start; the final repository-wide
verification remains intentionally deferred to Phase 14.
