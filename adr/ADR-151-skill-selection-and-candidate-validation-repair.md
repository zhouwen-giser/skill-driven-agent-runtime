# ADR-151: Skill selection and candidate validation repair

## Status

Accepted for the revised development scope on 2026-09-07 by `execplans/EP-RUNTIME-SEMANTIC-CLOSURE.md`.
Not implemented; existing publication and normative-authority ADRs remain effective.

## Context

Default composition bypasses SkillSelectionService. Evolution can discard earlier policies and validates
only a first Tool call rather than candidate behavior. Empty open schemas can become enabled Skills.
Temporary Skill terminal cleanup appears confined to successful result enhancement.

## Proposed decision

- Production generic composition always wires the existing semantic retriever, structured model decider,
  SkillUsage assessor and selection evidence repository. Cognitive understanding being disabled does not
  disable Skill selection. Test injection remains possible; exact governed profiles retain their proven
  authority constraints. Missing configuration has an explicit typed failure, never first-match fallback.
- Preserve SkillGoalScheduler as dispatch orchestration; it consumes the authorized ranked/selected
  result and checks compatibility. It does not become a second semantic selector.
- Centralize Skill schema explicitness validation for authoring, evolution and registry publication.
  Reject unconstrained output objects and descriptions that demand fields absent from the contract.
  An explicitly parameterless input may be a closed empty object with recorded justification; this does
  not make arbitrary open empty input/output acceptable. Bounded model correction precedes draft failure.
- New-version evolution freezes the base Skill ID/version/content hash and effective policies. Tool
  prohibitions, required/optional boundaries, budgets, cancel/compensation/pause policy and native
  normative/provider/confirmation/evidence rules are preserved. Automatic adaptive evolution cannot
  weaken them. A proposed normative change stays a reviewable candidate under the existing management
  publication rules; it does not silently become active.
- Preserve permitted automatic publication of validated adaptive evolution under FR-EVO-008. New Skill
  candidates must carry explicit complete contracts derived and validated under existing authority;
  missing policies cannot be filled by permissive hard-coded defaults.
- Before publication, atomically compare the frozen base/version and validation-target hash with current
  authority. Concurrent update/disable or candidate modification invalidates the validation receipt and
  requires new validation. No current pointer moves on a stale or failed result.
- Candidate validation uses the existing Planner, Usage/DSL validators, result processing, outcome
  checks and LangGraph executor with a candidate-scoped validation reader. The candidate remains draft;
  it is never temporarily published or falsely labeled enabled to make execution pass.
- Validation transport is strictly local simulation/recorded replay and preserves execution-context
  isolation. Live-only or missing fixtures are a validation failure, never a live Tool fallback. Actual
  model/Tool outputs drive the simulated execution; no static success stub substitutes for the workflow.
- Replay runs candidate behavior on source inputs and verifies explicit expected outputs/effects/errors,
  plus candidate output Schema and evidence requirements. Historical outcome is source evidence, not the
  entire oracle; intentional improvements require recorded expectations. A model cannot grade away a
  violated deterministic contract. Include all required normal/boundary/exception cases and record
  candidate hash, exact dependencies, model/prompt versions, plan/instance IDs and assertions.
- Version the validation report. Legacy first-tool reports remain historical evidence but cannot authorize
  a new publication. Any skipped/unavailable/failed required case keeps the candidate unpublished.
- Close task-scoped temporary Skills idempotently with the owning terminal Task transaction for success,
  failure, cancellation, timeout and process-loss projection. Exactly one outcome experience is recorded;
  only successful qualified experiences contribute to induction thresholds. Post-terminal model
  enrichment remains optional and cannot determine whether a Skill expires.

## Compatibility and migration

Legacy and native Skills retain their accepted version-selection rules. Existing enabled Skills are not
automatically disabled for quality/schema audit findings. Changed/new versions use the new gates, while
old permissive definitions receive visible review findings.

Reuse existing JSON storage where possible, with strict versioned decoding. Add validation/base-policy
fields and terminal uniqueness/transaction support only where existing schema lacks them. Old reports and
Skill versions are immutable. Downgrades refuse to lose referenced publication/terminal evidence.

## Validation

Default server composition with two compatible Skills must invoke the real selection service and store
metrics and model choice. Tests cover empty-schema rejection, explicit parameterless acceptance,
base-policy retention, normative-change draft retention, concurrent publication races, second-Tool
failure, invalid candidate output, nested Skill wait/confirmation, and all temporary-Skill terminal paths.
Real PostgreSQL/Redis and local simulated Model/MCP prove pointer, lineage, no-live-call and exactly-once
publication/expiration invariants. No new dependency or alternate workflow runtime is required.

## Revised development scope

Default selection, shared explicit Schema rules and Task-owned transactional Temporary Skill expiry are implemented. Full candidate validation/publication remains deferred (F06/F07); both automatic and management execution/publication entry points are blocked before candidate tools or version writes. Existing enabled Skills and ordinary registration continue through their own validation. No production setting bypasses this protection.
