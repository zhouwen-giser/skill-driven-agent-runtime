# ADR-121: Artifact Replay Dataset and Validation authority

## Status

Accepted for SDAR v1.3 P05 implementation.

## Context

P05 must validate a non-executable P04 Artifact Candidate against immutable historical facts without
creating another workflow runtime, consulting current production state as historical truth, or
crossing any physical Provider/MCP/device side-effect boundary. P02 already owns the canonical
`artifact_validation_run` table and Artifact lifecycle. V1.2.3 already has a narrower cognitive
Knowledge replay model, but its two-way split and post-evaluation receipt check do not satisfy P05's
four-way Dataset isolation or pre-call side-effect denial.

The general P02 validation completion method also transitions an Artifact and can emit
`artifact.promotion_ready`. P05 must produce validation evidence for P06 without performing a P06
promotion/governance decision.

## Decision

- `packages/domain/src/compiler/` owns the six frozen P05 contract names, exact fields, strict
  immutable factories and schema-hash metadata. They are bounded pure data and confer no runtime or
  governance authority.
- Historical persisted Request, Goal Contract, accepted Plan, Capability Catalog, World, Policy,
  Readiness, Trace, Outcome, Correction, Recovery and Feedback snapshots are the only Replay Case
  inputs. Missing snapshots remain missing and lower completeness; current state cannot backfill
  them.
- Dataset splitting is deterministic and group-aware across tenant, Goal lineage, Episode/revision,
  request/near-duplicate fingerprint, synthetic seed and time. Discovery, candidate development,
  promotion holdout and counterexample manifests are separately versioned. Candidate source traces
  and incomplete snapshots cannot enter promotion holdout.
- Replay uses a snapshot-only adapter that denies credential, network, MCP, Provider Task, device,
  notification, formal Outcome/evidence and Active Pointer operations before a physical call.
  Attempts create critical failure evidence and force `unsafe`.
- Plan replay materializes planning data and invokes the existing `validateUserGoalPlan` Domain
  validator. It does not create a formal Goal/Plan/Attempt, compile LangGraph or execute a Skill.
  Rule and Case replay remain contract/fixture evaluators until their later runtime packages.
- Counterfactual replay compares observable structure, coverage, risk, cost and interaction
  evidence. It never predicts that an unexecuted candidate achieved a physical Outcome.
- PostgreSQL remains authoritative. Migration 0129 extends P02's canonical
  `artifact_validation_run` with P05 hash/version/unsafe and durable lease fields and adds only
  foreign-keyed Replay Dataset/Case/Metric/Failure/Counterexample/Case Result records.
- P05 uses a dedicated validation terminal transaction on that canonical row. It freezes the
  Artifact/Dataset/Validator/Metric/Result hashes, Failure and Counterexample lineage and
  `artifact.validation_completed` Outbox event. It does not transition the Artifact and does not
  emit approval, activation or promotion events; P06 consumes the immutable evidence separately.
- Redis/BullMQ carries validation run-ID wakes only. PostgreSQL owns idempotency, leases, fencing,
  cancellation, bounded retry, dead-letter and reconstruction.

## Consequences

P05 can provide deterministic validation evidence to P06 without mutating Candidate definitions or
introducing Shadow, Promotion, Approval, Active Pointer, Fast Gateway or online route behavior.
Existing cognitive Replay remains intact and does not become Artifact validation authority. The P02
general governance repository remains available for its original callers, while P05's narrower
terminal transaction prevents a validation computation from silently becoming a promotion action.

## Rejected Alternatives

- Reuse current online Catalog/World/Policy state for missing history: fabricates the past.
- Run the Candidate through live LangGraph/MCP/Provider adapters: violates P05 safety and creates
  physical side-effect risk.
- Create a second Validation Run table: competes with P02 authority.
- Use P02's promotion-oriented append-result method directly: couples P05 calculation to Artifact
  lifecycle and promotion-ready events.
- Let a model set `passed`, metric values, Dataset split or unsafe status: displaces deterministic
  Goal/criterion/policy/outcome authority.
