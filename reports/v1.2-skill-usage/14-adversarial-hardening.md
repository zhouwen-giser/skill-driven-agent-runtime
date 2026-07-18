# SDAR v1.2 Phase 14 — Adversarial Review and Hardening

Date: 2026-07-18

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `c5a4de954b02f02a8b475dee5f10de47ecac5a24`

Audit SHA: `ad08397da901931fbdba5083e2d877af2f818262`

Final fix SHA: `74344ceadfa28d3940118ec3cfdd437cde2e0b97`

## Result

The active adversarial review exercised every required threat against its owning Domain, package,
planning, readiness, execution or recovery boundary. Prompt-injected labels and self-attested safety
claims remain untrusted data: invented Providers and missing context/evidence gates fail structural
compliance while immutable normative rules remain unchanged.

Review found one recursive authority defect. A native child plan with an immutable Usage policy but no
legacy composition context did not enforce that policy as the child allowlist. The first hardening
commit made native policy authoritative and added exact/stale/undeclared-child regressions. The first
mandatory full gate then exposed an overcorrection: legacy Skills now carry a compatibility Usage
projection, which must still use the existing Skill Graph authority. The follow-up fix distinguishes a
native declaration from a legacy projection using the immutable selected Skill snapshot already stored
in the plan. Native policy stays exact and fail-closed; legacy nested confirmation remains compatible.

No second Runtime, composition authority, recovery state machine or Provider state was added.

## Required Threat Matrix

| Threat | Result | Reproducible evidence |
| --- | --- | --- |
| normative/adaptive confusion | Passed | immutable separate fields and package/schema/Domain contradictions; prompt-injection regression proves normative fields remain unchanged |
| prompt injection changes safety rules | Passed | injected node labels cannot establish Provider, context or evidence compliance |
| oversized Markdown/JSON | Passed | package per-file/aggregate and Domain bounded JSON contracts |
| cyclic JSON | Passed | Skill/version, Usage patch, policy and child-result cycle guards |
| symlink/path traversal | Passed | filesystem package contract rejects symlink and canonical-root escape |
| stale Skill version | Passed | exact parent policy rejects current-version drift before child planning |
| active Skill in-place modification | Passed | Registry exact-next-version import/lifecycle tests; immutable snapshots cannot mutate |
| LLM chooses non-candidate Skill | Passed | selection service rejects decider output outside enabled candidates |
| LLM chooses unsupported mode | Passed | structured mode decision validation rejects unsupported output |
| invented Task/Provider | Passed | structural compliance and readiness require exact selected operations/Providers |
| preferred/required drift | Passed | readiness tests keep required fail-closed and permit preferred fallback only when explicitly admitted |
| recursive explosion | Passed | default 3/hard 5, cycle, 32-Skill/128-node and child-call bounds |
| duplicate child execution | Passed | persisted child call/checkpoint identity and duplicate-confirmation serialization; E2E exact call counts |
| stale readiness | Passed | expired availability and pre-invocation refresh/reconfirmation regressions |
| old reservation | Passed | inconsistent/expired guaranteed reservation fails closed |
| parent/child terminal overwrite | Passed | append-only transition graph plus complete/degraded parent-child E2E |
| remote Task duplicate event | Passed | ordered observation/protocol-attempt idempotency contracts |
| restart replay | Passed | Server restart integration resumes external wait without replaying `tools/call` |
| evidence spoofing | Passed | Provider success without adapter-owned evidence cannot complete move; prompt labels cannot replace hard gates |
| degraded projected as full success | Passed | area-patrol E2E retains `degraded` and missing effects/evidence after achieved Goal control |
| human gate bypass | Passed | outer and nested confirmation regressions; duplicate/stale/canceled decisions have no side effect |
| legacy regression | Passed | first full-gate failure reproduced the compatibility issue; unit regression and final 59/59 E2E prove the fix |

## Mandatory Full Verification

Clean feature SHA `74344ceadfa28d3940118ec3cfdd437cde2e0b97` passed self-managed
`pnpm verify` in 153,204 ms:

- static/unit/contract/build: 84 files, 574/574 tests;
- architecture: 256 TypeScript source files;
- A2A baseline: MUST 74/74, 161 non-MUST tests classified skipped by the pinned TCK scope;
- Management OpenAPI: 116 operations;
- main acceptance map: 18 passed scenarios;
- V1.1 MCP Tasks acceptance map: 16 passed scenarios;
- source/license/SBOM/Compose: 19 pinned sources, 286 npm packages, two external services and 70
  runtime migrations verified;
- migration paths: empty, historical 0049, released 0064, rollback/reapply, isolated-profile and ledger
  gap fail-closed passed through 0106;
- real local PostgreSQL/Redis integration: 82/82 across nine files;
- real local PostgreSQL/Redis/Server/LangGraph E2E: 59/59 across two files;
- infrastructure and production Server/Console smoke passed.

The first full-gate attempt is intentionally not reported as success: it failed the legacy nested-child
E2E and directly caused the follow-up regression fix. The final report is the clean-tree successful
rerun. Deterministic loopback model/Provider behavior remains classified simulation; PostgreSQL, Redis,
BullMQ, Server Runtime, Workflow and adapters are real local infrastructure.

The disposable `sdar_phase14_verify_20260718` database was deleted. Repository containers are stopped
with volumes preserved. The ignored operator `.env`, operator-owned `sdar` database and external
provider-runtime PostgreSQL were unchanged.

## Remaining Scope

Phase 15 must update release/version/architecture/API/operations/checklist evidence, run every explicit
final command plus a second complete `pnpm verify`, execute the acceptance audit, push, update PR #5 and
mark it Ready for Review without merging. External production Provider interoperability remains an
explicit non-required limitation, not verified behavior.
