# ADR-099: Skill Normative Authority and Adaptive Guidance Boundary

## Status

Accepted on 2026-07-17.

## Context

A Skill combines human-authored guidance with deterministic safety, permission, confirmation and
evidence rules. Optimization and later evolution must not weaken those rules or promote observed/model
output to authority.

## Decision

- Normative constraints, forbidden actions, required confirmations, Provider restrictions,
  no-applicable-Skill behavior and evidence hard gates are deterministic authority.
- Adaptive instructions, optimization hints and observed profiles are advisory data. They may refine
  behavior only inside the normative envelope.
- Models may propose `SkillPatchCandidate` data. They cannot publish, activate or mutate a Skill
  version, change normative rules, bypass confirmation or claim missing evidence.
- Every external package and model response is validated and deeply snapshotted before Domain use.
  Private reasoning, executable artifacts, unknown enums and contradictory policy fail closed.
- A normative change creates a new exact Skill version and invalidates any plan or confirmation that
  depended on the old version.

## Consequences

Evolution remains auditable and cannot silently relax safety. Selection, planning and execution can
distinguish advisory hints from reproducible policy evidence.

## Rejected Alternatives

- Let an LLM merge normative and adaptive text: destroys deterministic authority.
- Auto-publish successful patches: bypasses review and versioning.
- Treat missing evidence as an optimization warning: violates hard-gate semantics.
