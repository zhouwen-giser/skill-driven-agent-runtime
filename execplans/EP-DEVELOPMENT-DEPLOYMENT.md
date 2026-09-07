# Development deployment package

## Purpose / Outcome
Ship an online-build Compose bundle with one Runtime, Control API/worker, two PostgreSQL
databases and durable Redis. Public development APIs are open; internal identities and
database passwords are generated once. Non-weapon plans may use deployment preauthorization.
Device weapon execution is not enabled. Existing installations are not touched by validation.

## Requirements Covered
User-approved Development deployment plan (2026-09-07): configuration completeness, repeatable
empty-database startup, existing-data preservation, public interfaces, non-weapon confirmation,
isolated software-only demonstration and focused functional verification.

## Context and Orientation
Current HEAD 473ad7d uses host processes and infrastructure-only Compose files. Main service
schemas omit Redis authentication wiring; .env.example omits at least 22 runtime fields.
Runtime PostgreSQL and Control PostgreSQL remain their respective systems of record.

## Architecture and Interfaces
Deployment owns generated configuration, Compose and packaging. Application owns plan
confirmation and audit. Existing LangGraph, Task/Plan, confirmation and MCP admission services
remain the only execution path. No external Provider/Simulator services are deployed here.

## Progress
- [x] Inspected existing environment schemas, deployment scripts and confirmation boundaries.
- [x] Implement persistent Compose deployment and complete environment loading/templates.
- [x] Implement development non-weapon confirmation and isolated non-device demonstration.
- [x] Wire idempotent governance bootstrap and public interface metadata.
- [x] Run focused tests/build and isolated Compose startup using the matching prebuilt PG image.
- [x] Provide archive/checksum generation and delivery documentation.
- [ ] Verify default remote PostgreSQL recipe end-to-end (environment I/O blocker documented).

## Discoveries and Surprises
- Existing debug start cleanup may remove volumes; it must not be reused for upgrades.
- RedisConnectionConfig already supports password/db, but server main omits both.
- Flipping Skill autoConfirmPlan bypasses the governed-control issue hook; use the existing
  application confirmation path after persisted Task/Plan binding instead.

## Decision Log
- Follow the approved plan: no qualification/production suite or unrelated release audit.
- Do not change/restart the shared development instance while constructing the package.
- Preserve existing secret material; never place secrets in the distributable archive.

## Implementation Steps
1. Common environment loader, typed password/config wiring and coverage tests.
2. Compose/build/start lifecycle, durable init, guarded upgrade and package export.
3. Existing-service automatic confirmation plus explicit software-only non-device UI.
4. Formal governance initialization and focused end-to-end verification.

## Validation
- Configuration/confirmation/recovery/environment/governance focused selection: 11 files, 104 tests passed.
- `pnpm exec vitest run --project unit packages/application/test/mcp-registry.unit.test.ts`: 74 passed.
- `apps/server/test/ugv-agent-profile-execution.integration.test.ts` with an isolated real PostgreSQL,
  password-authenticated Redis and fake Provider: 2 passed (manual and deployment auto-confirmation,
  public A2A duplicate identity, one navigation admission and terminal continuation).
- Management HTTP `-t 'isolated software demo'`: 1 passed, 80 unrelated cases not selected.
- Configuration/demo focused recheck: 4 files / 6 passed. Typecheck, affected lint and Runtime/Console
  compilation passed; no qualification/production gate was requested or run.
- Isolated `up` and `upgrade`: Management/Console/A2A/Control HTTP 200; internal anonymous 401;
  generated Runtime service authority 200, Control service authority reaches typed missing-binding
  404 rather than authentication failure. Initial Prompts=21; migration 0178 present.
- Persistent demo audit survives upgrade: 2 rows, duplicate confirmation does not append a third;
  UPDATE is rejected by append-only trigger. Agent Task/MCP invocation=0 in this deployment.
- Upgrade preflight: Task/RemoteTask/pending dispatch/Bull active/lease=0; Redis AOF enabled/writable.
- Application Docker build and Node-free deployer image build passed; deployer Compose v2.40.3 runs.
- Default PostgreSQL image build remains environment-blocked: initial registry EOF, then Alpine gcc
  extraction I/O failure. Empty-database/upgrade smoke used an existing matching PG17.10/pgvector0.8.5
  image. Do not claim the default fresh remote image recipe is fully verified on this host.
- External UGV Provider was deliberately unconfigured in smoke; bootstrap returns
  DEVELOPMENT_PROVIDER_NOT_CONFIGURED. Empty-authority content reuse was tested through formal API
  fixtures, not by registering a shared physical Provider.

## Idempotence and Recovery
No volume deletion in down/upgrade. Missing/invalid external configuration is reported rather
than replaced by fixtures. Upgrades refuse active work before building and immediately before
rollout; the operator must stop new admissions during that window. Database identities/passwords,
Redis password and master-key changes require an explicit separate migration.

## Artifacts and Evidence
deploy/development; root .env.example; focused tests; an archive and checksum generated from
explicit delivery inputs, excluding secrets/history. Build/source identity is kept separately.

## Outcomes and Retrospective
Implementation, package/checksum tooling and focused functional validation are delivered.
This is not full qualification or production acceptance. Default remote PG build
and external Provider-specific availability remain explicitly unverified. Existing shared services
were never replaced, and no Device/Simulator/weapon execution was performed. The demonstration is
an inert manually acknowledged indicator, not an executable Device Capability.
