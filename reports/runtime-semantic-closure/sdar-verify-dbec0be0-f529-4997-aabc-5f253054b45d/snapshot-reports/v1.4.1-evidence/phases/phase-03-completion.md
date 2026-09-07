# Phase 3 Completion

- Phase: 3
- Goal: Strategy B clean-slate canonical Evidence persistence
- Base SHA: `beb616831093546aaac3b4c9894a776ecc49af39`
- Migration: `0144_v14_canonical_evidence`; immutable 0142/0143 unchanged
- Authorities: eight required tables created; three old Telemetry tables removed; no data migration
  and no dual write
- Source closure: 100/100 source-confirmed; seven Phase 1 infrastructure blockers closed as source
  authorities; projector coverage remains 0/100 until Phases 4-10
- Repository semantics: stable-ID idempotency/conflict, monotonic sequence, High Watermark,
  partition checkpoints, lease/fencing, bounded ACK, issues, DLQ, manifest constraints, restart
  recovery, caller-owned transaction append
- Focused tests: 2 files / 11 real PostgreSQL tests passed
- Reset: guarded v1.4.1 test reset passed with 37 migrations and zero fabricated Evidence
- Migration gate: passed through 0144 including fresh, reset, rollback/reapply, upgrade,
  interruption, checksum and ledger scenarios
- Full verify: passed; 1,198 static Unit/Contract tests, 158 Integration, 72 E2E, build and all smokes
- Failed and repaired: High Watermark rollback and ambiguous sequence; verifier constraint name;
  isolated Redis port mismatch; ACK unsent-sequence gap found in semantic review. Exact evidence is
  in `evidence-persistence-report.md`.
- Known limitation: the old P11 application/wire names remain only as a canonical-outbox
  compatibility shell for this intermediate full gate; Phase 4 removes them
- Blockers: none to Phase 3 completion
- Next phase: replace Telemetry API/Domain/Transport with Evidence batch protocol and service

## Read-only review

- Blocking: none.
- Major: the initial review found that ACK by a high sequence could skip an earlier record not sent
  by the current worker. Exact `sent_export_id`/`sent_fencing_token` ownership and a contiguous-gap
  check were added before the review rerun; the regression and full gate pass.
- Minor: none open. The P11-named compatibility wrapper is explicitly accepted only as the Phase 3
  intermediate path and is a mandatory deletion target in Phase 4.
- Accepted: immutable migration history, clean cutover, PostgreSQL-only authority, transaction-safe
  capture, source-partition checkpoints, durable High Watermark, fenced delivery, retained DLQ and
  manifest constraints match the Phase 3 task boundary.
