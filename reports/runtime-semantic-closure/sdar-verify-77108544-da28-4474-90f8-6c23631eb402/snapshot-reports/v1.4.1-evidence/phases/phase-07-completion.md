# Phase 7 Completion

- Phase: 7
- Goal: MCP Tasks and Capability Evidence
- Base SHA: `39bad28`
- Coverage: 11/11 MCP Task and 7/7 Capability types; 52/100 total implemented and verified
- Runtime path: Runtime repeatable-read snapshot -> authenticated Control full-state enrichment ->
  canonical mapper -> PostgreSQL Evidence outbox/checkpoint/issues
- Authority: Runtime PostgreSQL owns lifecycle facts; Control PostgreSQL owns Capability
  definitions/bindings; Redis is unused as authority
- Focused tests: 12 Unit and 3 real PostgreSQL Integration passed; Manifest accounting regression
  3/3 Unit, ordered Evidence/Artifact startup regression 3/3 + 8/8 Integration
- Contract/architecture: format/lint/typecheck, 667-source architecture and 100-record Evidence
  contract passed
- Full verify: passed in 865,814 ms with 1,222 static Unit/performance/Contract assertions, 161
  real PostgreSQL/Redis Integration tests, 72 E2E tests, 37 migrations, build, infrastructure,
  Server/Console and Node Control smokes
- Blockers: none
- Next phase: Experience, Replay and Artifact evidence

## Failure and rerun evidence

- First full run failed in Artifact startup because the Phase 7 Skill fixtures used incomplete
  Usage Specifications. The fixtures now carry valid `sdar.io/v1alpha1` specifications and
  explicit Outcome Specifications; ordered PostgreSQL reruns pass.
- The next run passed Integration and E2E but exposed invalid Manifest accounting
  (`episode_evidence_manifest_check`) and a stale active Agent Card fixture. Failed integrity
  requirements are now included in the expected count, and the active card is an official-SDK
  compatible HTTP+JSON card.
- Successful projection exposed cross-Runtime contention and shutdown races. PostgreSQL session
  advisory locking serializes the authoritative projector, and shutdown awaits the in-flight
  projection before closing the pool. E2E passes 72/72 without the prior projection failure.
- Two verification attempts were terminated only by undersized harness timeouts under sustained
  Windows/Docker load. The E2E inner limit is now 180 seconds, the bootstrap outer limit is 600
  seconds, and both retain every test and assertion. The final complete gate passes all eight
  stages; `reports/verification/summary.json` contains hashes and timings.

## Independent read-only review

- Blocking: none.
- Major: none after repair and rerun.
- Minor: none.
- Accepted: 18 Phase 7 record types preserve remote lifecycle, continuation, cancel, Capability
  Binding snapshot, cross-authority and sensitive-data boundaries without invented facts. The
  PostgreSQL projection lease is coordination only and creates no second authority.
