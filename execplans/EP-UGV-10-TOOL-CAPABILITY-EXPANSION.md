# EP: UGV 10-Tool Capability, Skill and A2A Expansion

## Purpose / Outcome

The `ugv-agent-profile` publishes governed Skill, Capability and A2A Exposure authority for every
operation in the current ten-operation UGV Provider catalog. Historical point-navigation authority
remains immutable. Read-only and control tasks reuse the existing managed-capability, Skill Usage,
LangGraph.js and Frozen MCP Tasks runtime. No acceptance step invokes a physical Tool.

## Requirements Covered

- FR-SKL-001/002/004: versioned Skill registration, exact Tool policy and lifecycle.
- FR-ADM-001/002: published Capability/implementation/readiness and A2A exposure.
- FR-MCP-004/006/007: exact Provider Binding, catalog and invocation authority.
- FR-A2A-001/002: Agent Card projection and Task follow-up mapping.
- NFR-SEC-002: durable one-shot physical/weapon authority and secret-safe evidence.

## Context and Orientation

`apps/server/src/ugv-agent-profile.ts` currently exposes only `embodied.move_to@1` and
`embodied.move@4`. Generic Skill Usage and managed-capability execution already exist in the same
Runtime. `apps/node-control-acceptance/src/ugv-smpp-capability-governance-driver.ts` already contains
most non-weapon governance mechanics but publishes only a narrow subset. PostgreSQL is the sole
governance and runtime authority.

## Architecture and Interfaces

- Add a reviewed UGV catalog contract for the ten Provider operations and the thirteen public
  Capability surfaces (four navigation mission shapes share one Provider Tool).
- Route only the historical point-navigation Skill through its deterministic UGV terminal authority;
  route the other reviewed UGV Skills through the existing managed Skill Usage path.
- Add `authorityKind` to governed confirmations and add durable direct-emergency instruction evidence.
- Add `confirm_weapon_action` to the A2A follow-up contract and task-scoped management endpoints.
- Default and non-UGV profiles continue to deny `vehicle_fire_weapon`. UGV weapon admission requires
  exact target evidence plus a one-shot weapon confirmation.

## Progress

- [x] 2026-09-01: inspected current Runtime, Binding/Catalog, governance drivers and accepted ADRs.
- [x] 2026-09-01: froze the public mapping and confirmation decisions with the operator.
- [x] 2026-09-01: implemented the reviewed catalog and append-only governance bootstrap.
- [x] 2026-09-01: composed profile-aware generic execution while preserving point navigation.
- [x] 2026-09-01: implemented migrations 0176/0177, weapon/emergency authority, Management/A2A
  adapters and the operational Console evidence surface.
- [ ] Complete final full-suite, integration, architecture and build reruns after the Console addition.
- [ ] Publish redacted zero-Tool-call governance evidence and update traceability.

## Discoveries and Surprises

- Provider unavailability was caused by concurrent simulation requests and is externally resolved;
  SDAR must not add a readiness bypass.
- The current `vehicle_get_targets` output permits opaque target objects, so lifecycle publication is
  possible but weapon invocation must remain restricted until strict target evidence validates.
- The latest candidate Runtime uses Binding revision 2 and Catalog `2.0.0-rc.1:2`; no implementation
  may freeze the earlier revision.
- PostgreSQL instances that already ran migration 0176 exposed a compatibility defect when older
  writers omitted `authority_kind`. Migration 0177 restores a database default while current writers
  still persist the field explicitly; historical rows remain `physical_control`.
- A UGV provider policy cannot use an exact-key allowlist without turning additive contract fields
  into product-code drift. Required authority fields remain typed and exact; unknown/additive fields
  are retained and no speculative "dangerous field" blacklist is introduced.

## Decision Log

- Preserve `embodied.move_to@1` / `embodied.move@4` / `a2a.embodied.move@3` for point navigation.
- Publish separate route, distance and return-home Capability surfaces to keep schemas and terminal
  evidence unambiguous.
- Direct authenticated emergency-stop intent is a one-shot PostgreSQL authority, not model metadata.
- Weapon confirmation is shared by A2A and Management adapters through one Application service.
- The Console reads only a non-sensitive confirmation projection (target/resource, hashes, expiry,
  revocation and consumption); it never reads credentials or Provider response bodies.

## Implementation Steps

1. Add the reviewed catalog contract, Task Types and profile Skill projection.
2. Generalize profile routing so only the historical point Skill enters UGV-specific planning.
3. Extend the governance driver with append-only Skill/Capability/Exposure publication and Agent Card.
4. Add migration and high-risk confirmation services/adapters.
5. Add focused regression suites, run gates and update evidence/docs.

## Validation

- `pnpm typecheck`
- focused Vitest suites for UGV profile, governance, control authority and A2A mapping
- focused PostgreSQL migration/repository integration
- A2A and Management contract/E2E suites
- `pnpm verify:architecture`
- `pnpm build`
- changed-file ESLint, Prettier and `git diff --check`

Completed evidence before final rerun:

- focused UGV/profile/governance/control/A2A suites: 11 files / 116 tests passed;
- focused Task/A2A/Management/high-risk authority suites: 4 files / 151 tests passed;
- confirmation query/repository/Management/Console suites: 4 files / 125 tests passed;
- real PostgreSQL governed-control integration: 3/3 passed;
- migration verification: 70 Runtime migrations through 0177 plus 12 Control migrations passed;
- typecheck, full lint, production build and 870-source architecture gate passed;
- one loaded-host P10 P99 failure reproduced as environmental noise; the unchanged focused suite
  passed 22/22 at 266.646 ms (threshold 750 ms).

## Idempotence and Recovery

Governance compares immutable canonical content. Exact latest versions are reused; changed content
creates `latest+1` successors. Failed publication leaves drafts/history intact and never rewrites an
active version. Confirmation issuance is idempotent by exact Task/attempt/Plan/arguments/actor scope.

## Artifacts and Evidence

- This ExecPlan and the accepted follow-up ADR.
- Focused test output and a redacted governance report proving `tools/call=0`.
- Updated `docs/17_TRACEABILITY_MATRIX.md`, `PROJECT_STATUS.md` and `CHANGELOG.md`.

## Outcomes and Retrospective

The product implementation is complete. All ten Provider operations map to thirteen append-only
public surfaces, with read-only, ordinary physical, direct emergency and restricted weapon authority
kept distinct. The final full-suite rerun, read-only deployment bootstrap and redacted `tools/call=0`
evidence remain before this ExecPlan can close.
