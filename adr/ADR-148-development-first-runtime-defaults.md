# ADR-148: Development-first Runtime defaults

## Status

Accepted by the user for the current development phase on 2026-09-04. This decision supersedes only
the development-default portions of ADR-138, ADR-142, ADR-146 and ADR-147. It does not claim or
qualify production behavior.

## Context

UGV integration repeatedly used qualification-style default-deny switches and a profile-specific
Skill allowlist while the project was still performing trusted-network development. Missing
environment markers selected no development identity, live physical side effects required an extra
deployment variable on every restart, and otherwise enabled PostgreSQL Skill versions disappeared
behind the UGV profile projection. These deployment restrictions obscured product defects and made
ordinary development restarts differ from the intended current operating mode.

## Decision

- An omitted `NODE_ENV` means `development`; `SDAR_CONTROL_ENVIRONMENT` already defaults to
  `development`. Qualification or production must therefore be selected explicitly.
- In the exact development/development environment, omitted UGV live and simulation side-effect
  switches mean enabled. An explicit `NO` still disables either gate. Outside development, omission
  remains disabled and an explicit `YES` is required.
- The UGV profile is valid in the development/development environment without a special test-only
  exception. Its development Skill view exposes every PostgreSQL-authoritative enabled Skill version
  instead of applying the additional UGV reviewed-Skill projection. Every explicitly selected
  non-development environment keeps the reviewed projection.
- This is visibility and deployment policy only. PostgreSQL remains the Skill/Capability authority;
  Task Capability admission still resolves one exact version. Plan confirmation, physical or weapon
  confirmation, argument/schema validation, one-shot consumption, idempotent MCP Task admission,
  uncertain-dispatch no-replay and terminal evidence are unchanged.
- A published Skill is not made available by this decision. Disabled versions remain excluded, and
  explicit Provider unavailability or stale/unhealthy/uncorrelated evidence remains a rejection.
- Current validation is intentionally limited to the development path. Qualification and production
  require a future explicit environment change and their own requested validation run.

## Consequences

The ordinary development restart matches the project's present operating phase and can exercise all
registered enabled Skills without editing a UGV allowlist. Physical operations remain governed by
the existing confirmation and execution authorities even though the deployment-level switch is on.
Operators must set `NODE_ENV` and `SDAR_CONTROL_ENVIRONMENT` explicitly before treating an instance
as qualification or production. They must also explicitly enable any desired non-development side
effect gate. Operators may set `ALLOW_UGV_LIVE_SIDE_EFFECTS=NO` and
`ALLOW_UGV_SIMULATION_SIDE_EFFECTS=NO` when they want a development instance to be observational
only.

No Domain type, workflow runtime, database table, migration or alternate source of truth is added.

## Evidence

- `apps/server/test/environment.unit.test.ts`
- `apps/server/test/ugv-agent-profile.unit.test.ts`
- `apps/server/test/ugv-live-side-effect-gate.unit.test.ts`
- `apps/server/test/ugv-simulation-side-effect-gate.unit.test.ts`
