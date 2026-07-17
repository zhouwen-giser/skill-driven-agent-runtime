# SDAR v1.2 Skill-Driven Capability Usage — Normalized Design

Status: Phase 0 design freeze; implementation not yet started
Date: 2026-07-17
ExecPlan: `execplans/EP-10-v1.2-skill-driven-capability-usage.md`

## Source and authority boundary

This document normalizes the frozen decisions contained in
`docs/sdar_v1_2_skill_driven_capability_usage_codex_goal_package.md` into a stable repository design.
The separately named source document `SDAR_v1.2_Skill_Driven_Capability_Usage_Overall_Design.md`
was not present in the supplied attachment directory, repository, branches, or tags at Phase 0.
Consequently this file does not claim to reproduce that missing source. The complete supplied task package
is retained in the repository with Markdown trailing whitespace normalized, and its missing-source gap is recorded in the ExecPlan and
baseline report. The V1.0 SRS and existing requirements baseline remain higher authority.

## Outcome

Skill becomes a versioned capability-usage specification that an LLM can discover, assess, select,
compose and interpret while deterministic policy remains authoritative. The end-to-end chain is:

```text
Goal
  -> Skill discovery and applicability
  -> mode and exact-version selection
  -> bounded Skill composition
  -> guidance/template/procedure interpretation
  -> existing Workflow planning, validation, confirmation and LangGraph execution
  -> existing MCP Tool or v1.1 MCP Task Provider/resource authority
  -> minimal Skill execution and evidence record
```

No second Agent, Workflow, procedure, behavior-tree or recovery runtime is introduced.

## Frozen product decisions

1. Skill is a capability usage specification, not a Capability Proof or fixed Workflow.
2. V1.2 starts with embodied control while keeping the kernel generic and thin.
3. `embodied.move_to` and `embodied.area_patrol` are production examples.
4. A Skill package combines bounded natural-language guidance with a JSON-Schema-validated contract.
5. Execution modes are exactly `guidance`, `template`, and `procedure`.
6. Bindings name Task Types and may declare dynamic, preferred, required, or forbidden Providers.
7. Composition supports fixed dependencies and dynamic capability slots.
8. The usage recursion default is 3 and the V1.2 hard maximum is 5, independent of the existing
   generic Skill Graph snapshot maximum of 8.
9. Procedure is validated and compiled into the existing Workflow DSL; it never executes directly.
10. Visibility is `user_selectable`, `composable`, or `internal_only` with fail-closed combinations.
11. Failure propagation is `fail_fast`, `recoverable`, `optional`, or `degraded`.
12. LLM output may tune adaptive guidance but cannot weaken normative rules or hard gates.
13. V1.2 creates `SkillPatchCandidate` evidence only; it never auto-publishes a Skill.
14. No-applicable-Skill behavior is risk-based fallback, confirmation, or rejection.
15. V1.2 records minimum facts and hard-gate evidence; it does not build a full scoring platform.

## Domain ownership

The Domain layer owns immutable `SkillUsageSpecification`, applicability/mode/composition decisions,
failure policy, procedure IR, execution identity/status and evidence references. Existing `SkillVersion`
is extended additively with an optional usage specification. A missing specification is projected as
`legacy_guidance`: current `workflowGuidance`, `toolPolicy`, input/output schema and runtime policy keep
their existing authority, but template/procedure/capability-slot behavior is not inferred.

The Application layer owns orchestration through the existing Skill Registry, Selection, Composition,
Planner, Validator, Controller and Skill Call Workflow services. Adapter types never cross into Domain.
PostgreSQL remains the runtime system of record. Package files are review/import artifacts and cannot be
loaded as production authority on each execution.

## Usage contract

The additive immutable snapshot contains:

- `apiVersion: "sdar.io/v1alpha1"`;
- visibility and lifecycle projection;
- normative policy separate from adaptive guidance and observed profile;
- context requirements and bounded applicability rules;
- supported/default mode definitions;
- Task Type bindings and Provider policies;
- fixed dependencies and capability slots with parameter/output mapping;
- usage depth/size budgets and per-edge failure policy;
- evidence requirements and no-evidence hard gates.

All external JSON is finite, plain, depth/size/count bounded, enum-closed, duplicate-free and deeply
snapshotted. It contains no source code, expressions outside the restricted Workflow AST, private
reasoning fields, functions, prototypes or cyclic values.

## Three modes

- `guidance` supplies a bounded, structured context to the existing Planner.
- `template` instantiates a validated parameterized Workflow skeleton with only declared branches and
  slots.
- `procedure` validates a deterministic `SkillProcedureProgram`, compiles it into the existing Workflow
  DSL, and then passes it through the existing validator, confirmation, policy and LangGraph compiler.

Every mode ends at the same Workflow authority. Mode selection is a structured deterministic decision
bounded by Skill support, context completeness, risk, readiness, confirmation and system policy.

## Composition and failure

The existing Skill Graph remains the relationship authority. V1.2 adds a usage view that resolves exact
versions, fixed edges and slots while sharing one remaining recursion budget:

```text
effectiveDepth = min(systemHardLimit=5, skillLimit, parentRemainingBudget)
defaultDepth = 3
```

Cycles, duplicate expansion, stale versions, incompatible schemas, non-candidate slot choices and size
overflow fail closed. `degraded` is an explicit terminal projection with missing effects/evidence and may
never be reported as full success.

## v1.1 integration

V1.1 commit `9e32311e45a9257741fb7c62f4f89b76dce8360f` is an ancestor of Phase 0
`origin/main` `667146a3639eefdfed9b89c2417c08e1ac50e9a9`; PR #4 is merged. V1.2 therefore
reuses the final domain availability/timing types, readiness service, remote binding, external-wait
continuation, input, cancellation, reconciliation and restart predicates.

Skill expresses demand and preference. Provider remains authoritative for live availability,
reservation, resources, execution state and final result. Required unavailable Providers cannot be
silently replaced; preferred Providers may fall back only as permitted; forbidden Providers are always
filtered; unknown is never promoted to available; guaranteed requires a valid reservation reference.

## Execution and evidence boundary

The minimum Skill execution record links Goal, exact Skill version, parent/child execution, selection,
applicability, mode, bounded context snapshot, composition, plan/Workflow, Task, Provider/resource,
RemoteTaskBinding, EvidenceRef, hard gate, human intervention and outcome. It observes existing Task and
Workflow authority and cannot overwrite their terminal states.

## Security and non-goals

Normative policy, registered Task/Provider identity, permission/safety decisions, disabled state,
confirmation and evidence hard gates are deterministic. Markdown is bounded untrusted text. Package
reading rejects traversal, root escape, oversized/non-UTF-8 content and symlink escape, and never runs
scripts. V1.2 does not add a capability ontology/graph platform, Provider factory, automatic Provider
code, generic scheduler, full telemetry/scoring system, auto-publishing, multitenancy, a new editor or a
second runtime.
