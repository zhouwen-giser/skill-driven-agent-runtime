# SDAR v1.2 Phase 4 — Applicability, Context and Mode Selection

- Goal: deterministic applicability and mode decisions before the existing model decider
- Dependency class: `V11-INDEPENDENT / V11-CONTRACT-SENSITIVE`
- Base SHA: `89abeaef8da24404b5f2255dd4eda8fa6053a71c`
- Resulting SHA: pending publication
- v1.1 Gate: OPEN; readiness integration remains mock-only

## Delivered

Domain now owns closed status enums and immutable snapshots for applicability, context observations and
resolution, Task readiness, system mode policy and selected/blocked mode decisions. Application owns
`SkillContextRequirementResolver`, `SkillApplicabilityAssessor`, `SkillModeSelector` and
`SkillUsageCandidateAssessor`. The existing `SkillSelectionService` optionally enriches its existing
candidate snapshot, removes unknown/unsatisfied or blocked-mode candidates before its existing model
decider, and preserves the old path when no Phase 4 assessor is configured.

Available context is evidence-by-reference only; values are never guessed or copied. Skill declarations
must preserve the fixed authority subsequence: authoritative context, read-only query, deterministic
derivation, user input. The resolver chooses the first available declared source, explicitly returns
`input_required`, `unsatisfied` or `unknown`, and rejects empty/reordered declarations, duplicate or
unsupported observations, evidence-free availability and undeclared observations.

The read-only `SkillTaskReadinessPort` sees only exact Skill/binding demand and returns a Domain-owned
summary. The assessor verifies every binding exactly once and recomputes overall readiness, rejecting a
forged aggregate. No v1.1 type or production adapter is used. Mode selection intersects Skill support
with a closed system policy and considers applicability, context completeness, risk, normative
confirmation, readiness restriction and human confirmation. Partial context may select guidance only
when policy explicitly permits it; arbitrary mode strings and blocked decisions do not reach the model.

## Architecture guardian evidence

This extends the existing Semantic Retriever→Selection Service→Decider chain and candidate snapshot.
The new readiness boundary is read-only and protocol-neutral. No Provider state, reservation, Workflow,
MCP SDK, persistence, API, Console or Runtime graph is copied or wired. Phase 8 owns the real adapter.
No ADR is needed because the fixed authority ordering and mock isolation are explicit frozen requirements.

## Verification

- targeted Phase 4 selection tests: 2 files / 18 tests passed;
- formal package compatibility regression: 1 file / 5 tests passed;
- all unit tests: 68 files / 428 tests passed;
- full repository format, ESLint and strict typecheck: passed;
- architecture: 244 TypeScript source files passed.

Tests cover all four applicability states, source precedence, missing/forged evidence, explicit input,
fixed-order declaration rejection, readiness aggregate forgery, high-risk procedure selection, partial
guidance, declined confirmation, arbitrary mode input, immutable candidate output, selection-context
requirement and filtering before the model decider. Intermediate failures were limited to test placement,
exact optional typing and type-aware lint; each was corrected without weakening behavior.

## Limitations and next step

Readiness is deterministic mock evidence only and does not claim live Provider interoperability. Phase 5
uses these exact candidate/mode decisions for bounded composition and three-mode IR. Phase 8 later maps
the accepted v1.1 readiness authority behind this Port.

## Publication

The designated Phase commit is pending. Its immutable commit and remote SHA will be recorded in the
immediate follow-up evidence commit without amend, rebase or force push.
