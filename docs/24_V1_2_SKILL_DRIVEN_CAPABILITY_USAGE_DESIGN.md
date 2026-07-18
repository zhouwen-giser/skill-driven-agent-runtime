# SDAR v1.2 Skill-Driven Capability Usage — Normalized Design

Status: Phase 10 existing Runtime/Graph integration implemented and verified; Phase 11 execution records next
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

Phase 6 confirms that `origin/main` `667146a3639eefdfed9b89c2417c08e1ac50e9a9` is already an
ancestor of the V1.2 branch, so no integration merge is required. ADR-097 through ADR-103 are the
accepted production decisions for the contracts below. PostgreSQL migration 0105 now persists Skill
usage/import evidence through the existing Registry; 0106 remains allocated to minimal execution
records. The applied migration high-water is 0105.

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

Phase 9 adds an exact-version `SkillUsagePlanPolicy`. Guidance injects only that bounded structured
policy and the complete Goal contract into the existing Planner. Template and procedure IR compile to
the existing `WorkflowDefinition`; parameter mappings become restricted references, selected Task
bindings become exact MCP nodes, and context/evidence hard gates become restricted conditions with an
unsuccessful false branch. The existing Validator then applies structural Skill Usage compliance before
readiness and confirmation. The complete policy is attached immutably to the Workflow definition for
review and replanning; the existing outer Workflow Plan confirmation remains the sole pre-execution
confirmation boundary. Natural-language text is never guessed into executable predicates or duplicated
as an in-graph confirmation. ADR-105 records this boundary.

Phase 10 wires the exact selected Usage candidate through the existing Task preparation path into
composition, mode interpretation, Workflow planning, validation and outer confirmation. The validated
policy survives persistence, bounded repair, ordinary replanning, natural-language/admin revision and
Goal Patch while each invalidating action still requires fresh confirmation. Legacy Usage with no v1.2
composition declaration continues to use the existing exact Skill Graph admission authority.

PR #5 review hardening makes declared child output mappings executable only as bounded Workflow data.
The existing LangGraph compiler applies exact safe property-path copies after child output validation
for both immediate and persisted-continuation results. Mapped evidence is read through the existing
evidence projection and gated by a presence-only restricted AST operation; no model code, second runtime
or mutable graph is introduced. Empty input mappings bind the parent's `skillInput`, and top-level Skill
selection excludes exact versions whose visibility is not user-selectable. ADR-107 records this boundary.

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

The Phase 8 production readiness adapter uses a narrow exact-name candidate catalog over the existing
MCP registry, the existing `TaskAvailabilityBatchReader` and V1.1 Domain
availability/timing/window/reservation types. Candidate hard attributes derive only from validated
V1.1 Task operation semantics; Tool enhancement text is not authority. The exact projection is
`available → ready`, `restricted → restricted`, `disabled → unavailable` and
`unknown/Provider errors → unknown`; the existing exact-argument pre-invocation guard remains final.
Usage-aware selection is always present when Skill selection is enabled. A deployment without V1.1
Task metadata returns no registered Task candidates, so native bindings fail closed instead of bypassing
readiness. ADR-104 records the exact Task Type/Provider/attribute authority.

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
