# SDAR v1.2 Phase 9 — Mode Compilation and Workflow Plan Compliance

Date: 2026-07-17

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `cb1faf112b6f5c9346f11fc475a1184c9ff31fc2`

Feature SHA: `7cdee9e08d2dd1d0f5a2d56df135e387482a6927`

## Result

Phase 9 introduces an immutable exact-version `SkillUsagePlanPolicy` owned by Domain. It contains the
selected mode, normative and adaptive instructions, bounded context evidence summary, exact selected
Task operations and Providers, permitted Tools, exact composed children and mappings, failure policy,
readiness and evidence requirements.

Guidance serializes only that policy plus the complete Goal contract into the existing Planner request.
Template and procedure IR deterministically compile to the existing `WorkflowDefinition`: restricted
references bind child inputs, selected Task bindings become `mcp_tool` nodes, required confirmation
uses the existing human-confirmation node, failure propagation is explicit additive DSL data, and
context/evidence hard gates use restricted conditions whose false branch returns unsuccessful.

Every deterministic definition and every model-generated or repair definition runs through the
existing `WorkflowValidator` and then Skill Usage compliance. The first deterministic failure consumes
one existing Planner attempt; only the existing bounded remaining attempts may repair it. Compliance
rejects operations outside the exact Tool/Provider allowlist, missing bindings or children, unadmitted
children, recursion overflow, failure-policy drift, incomplete confirmation projection and missing
context/evidence false-to-failure gates. A model explanation is never compliance evidence.

ADR-105 records why natural-language normative and forbidden-action text is projected verbatim into an
existing confirmation node instead of being guessed into executable predicates. No second runtime,
graph, Provider state, persistence authority or migration was added.

## Verification

- Focused Skill Usage planning, existing Planner/Validator, JSON DSL contract and LangGraph compiler:
  5 files, 68/68.
- Complete unit suite: 71 files, 448/448.
- Complete contract suite: 11 files, 107/107, including loopback protocol contracts.
- Full format, lint and strict typecheck passed; architecture verified 251 TypeScript source files and
  the production Server/Console build passed.

No tests were skipped or weakened. No placeholder response, `any`, dynamic code, executable model
output, secret or unbounded artifact was added. Phase 9 is a planning/validation increment; real Runtime
wiring and the mandatory complete `pnpm verify` are Phase 10.

## Next

Phase 10 connects the selected Usage candidate, bounded composition/interpretation and prepared policy
to the existing Task→Planner→confirmation→LangGraph path, then runs the mandatory full verification.
Draft PR #5 remains Draft and is not merged.
