# EP: default capability governance and site repair

## Purpose / Outcome
Repair empty public Agent Card using formal Skill/Capability/Exposure governance in Development and sz-gowm. Rebuild the source union after site verification.
## Requirements Covered
DEV-DEPLOY; FR-SKL lifecycle; Agent Card capability publication; NFR-SEC-001/002; ADR-149 preauthorization and ADR-153 shared ownership.
## Context and Orientation
Runtime and Node Control directories are empty. Previous site bootstrap registered MCP only; default governance was disabled and swallowed failure. Existing official governance driver is reused, not Agent Card JSON edits.
## Architecture and Interfaces
Deployment-owned orchestrator calls official Source, Provider, Skill, Capability, Exposure and Card APIs. No new workflow engine or public API; default YES bootstrap and structured fail-closed deployment status.
## Progress
- [x] 2026-09-09 Confirmed empty Runtime Skills and Control governance collections via read-only HTTP.
- [x] Unified bootstrap, manifest and default configuration regression.
- [x] Deploy real Registry and verify its lineage; user confirmed patrol inspection is deferred to future GOWM and remains explicitly blocked.
- [x] Full gate (corrected reruns retained), site backup/rollout, exact supported public inventory and repeated bootstrap.
- [x] Rebuilt union and clean extracted build/config verification; final immutable artifact identity is recorded in the report directory.
- [ ] Full-manifest acceptance: deferred until GOWM supplies embodied.inspect_area and patrol can be formally published.
## Discoveries and Surprises
PMS was absent. User authorized official PMS and independent management storage; API, worker and PostgreSQL deployed from fixed nested SMPP source, with native Runtime registration and real Registry projection verified. Builtin area_patrol requires embodied.inspect_area; actual SMPP polygon and result contracts do not satisfy it. User confirmed no Provider currently exists and GOWM will supply it later; retain explicit block, not full acceptance.
## Decision Log
User chose existing Development non-weapon preauthorization and site+package repair. Weapon/effector Device execution excluded. Existing explicit deployment configuration remains sticky; one-time authorized site migration is explicit. Nested custom plans remain manual.
## Implementation Steps
Unify entrypoints; inventory expected package-owned capabilities; refuse silent partial success; test locally; resolve dependencies; back up site; use official versioned governance; verify Card and package.
## Validation
Unit and fake-provider confirmation/recovery tests, format/lint/typecheck/integration/contract/e2e/build/smoke; clean extracted build and union verification; site tools/list and governance only, zero device actions.
## Idempotence and Recovery
Reuse exact definitions, append successor for changed content; preserve history and explicit operator disabled states. Refuse active work rollout. Back up private config; retain original image and version identities.
## Artifacts and Evidence
reports/default-capabilities-20260909; final union delivery manifest.
## Outcomes and Retrospective
Twelve supported Skills and public capabilities are verified on site; full-manifest completion remains blocked by the user-confirmed future GOWM inspection dependency. A verified source union is delivered separately from the deferred full-manifest acceptance; final package/image identity and checks remain in reports/default-capabilities-20260909.


## Validation results (2026-09-09)
Final format/typecheck and lint retry PASS; unit 2550 PASS; integration 242 PASS; protocol 534 PASS;
E2E 75 PASS across the repository's functional/performance split; production build and local smoke PASS.
No assertions were relaxed: repeat-governance request counts include the added point readiness check.
No new test skips. Initial failures remain in gate-final/gate.json; successful corrected lint/unit logs
and final summary are retained separately. Clean extracted source build/config PASS. Actual site
inventory has 12 supported items and one explicit missing inspection dependency, with zero device actions.
