# Persistent Provider Authority and Stable Agent Card

## Purpose / Outcome

Keep the UGV debug service discoverable without recurring clean/bootstrap. Provider registration does
not expire; health controls execution; health observations do not allocate semantic Binding revisions;
new semantic revisions automatically supply authority for subsequent Tasks. Commit/push the repair
and restart the existing debug services without deleting volumes or invoking UGV tools.

## Requirements Covered

- FR-A2A-001/006, FR-SKL-006/007: enabled registered Skills and truthful stable public discovery.
- FR-EXE-001/002, FR-MCPT-009/010: current contract and live readiness at execution.
- v1.4 P05/P07/P08 Binding, Capability readiness and Exposure authority; SACS-V03 compatibility.
- Operator's six lifecycle principles, recorded in ADR-141.

## Context and Orientation

`mcp-provider-binding-service.ts` currently increments revision on every refresh. Control PostgreSQL
stores the observation TTL in immutable Binding rows; `findCurrentAuthority` rejects expired rows.
`NodeControlFoundationWorker` only polls Source. Managed Card rebuilding and the public natural-language
extension depend on readiness. Runtime Task Capability snapshots pin the old revision.

## Architecture and Interfaces

Node Control owns stable Binding registration, semantic revisions and health observations. Runtime
owns Task snapshots, execution readiness, MCP transport and the sole LangGraph workflow runtime.
Current Binding reads expose registered identity plus separate health fields; observation expiry is
not registration expiry. Capability admission resolves latest semantic authority and freezes it into
the existing Task snapshot. Public description reads are separate from readiness gating.

## Progress

- [x] 2026-08-26: Confirm root cause and record ADR-141; assign non-overlapping implementation slices.
- [x] Implement Binding observation/lifecycle migration and periodic renewal.
- [x] Separate Card registration from readiness and resolve new Task authority automatically.
- [x] Run focused unit/contract and isolated PostgreSQL regressions plus static/build checks.
- [x] Commit/push, restart debug services and verify same databases/Card/authority without Tool calls.

## Discoveries and Surprises

- Source auto-refresh works, but Binding health is not scheduled.
- Binding refresh currently increments revision even for identical Catalogs and failures.
- The public extension currently calls execution-ready Exposure resolution, so registered capability
  discovery disappears on health expiry even though the enabled Skill remains present.
- Runtime refresh previously rotated the snapshot/server anchors for unchanged discovery. This
  would invalidate in-flight remote-task reads during periodic renewal; unchanged refresh now keeps
  those anchors. Control and Runtime use the same retained admin-override Catalog checksum.
- The generic test PostgreSQL on 55432 was unavailable. A short-lived existing-image PostgreSQL
  container on 55472 with tmpfs storage isolates the focused migration/integration checks; no live
  database or Provider/Device service is used.
- Registration-only startup exposed an existing official SDK edge: explicit `skills: []` becomes
  an omitted default on `AgentCard.toJSON`. The adapter accepts that exact empty-list round trip
  while still rejecting a missing input list. With no managed registrations/active Card, the
  scheduler leaves the generic registered-Skill Card alone.

## Decision Log

- 2026-08-26: Follow ADR-141. Keep health expiry meaningful for execution, not identity.
- 2026-08-26: New admissions resolve new semantic revisions; existing Task/Plan snapshots remain
  immutable. Capability business versions do not change for health or deployment observation churn.
- 2026-08-26: Respect the user's reduced-test request: relevant regression/DB checks, typecheck,
  scoped lint/format and production build, not repeated full-repository suites or simulation runs.

## Implementation Steps

1. Append same-revision health observations and separate governance status from semantic revision.
2. Renew health through bounded, serialized read-only discovery in existing service composition.
3. Read public registration independently of readiness; stop health-triggered Card churn.
4. Resolve latest semantic Binding for new Capability snapshots while preserving execution checks.
5. Verify changes, update traceability/status/changelog, commit/push, and restart existing processes.

## Validation

Focused regressions cover unchanged health refresh, failed health, real contract drift, currentness
after TTL, lifecycle suspend/remove, stable Card under unavailable readiness, new-admission revision
rollover, immutable prior Tasks and unavailable execution rejection. Run the changed PostgreSQL
repository/migration contracts in an isolated database. Static gates are TypeScript, scoped ESLint/
Prettier, architecture and build. Final live check reads Card, process/DB identity and authority only.

Executed on 2026-08-26:

- Changed-scope `./node_modules/.bin/vitest run` over all 26 changed/new unit/contract files:
  **358/358 PASS**. This includes the actual official SDK empty-Skill contract, both background
  reconcilers, Binding lifecycle, Task acceptance/frozen revision and execution health regressions.
- With `SDAR_TEST_POSTGRES_URL` / `SDAR_CONTROL_TEST_POSTGRES_URL` set only to dedicated databases
  on temporary localhost PostgreSQL 55472: `foundation.integration.test.ts` and
  `mcp-provider-binding.integration.test.ts` **19/19 PASS**, followed by independent
  `node-capability.integration.test.ts` **2/2 PASS**. The first two tests exercise additive migration,
  existing-row backfill, rollback protection and real loopback Control/Provider HTTP. The temporary
  container and its tmpfs databases were removed afterward; debug PostgreSQL was untouched.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false`: **PASS**; `pnpm build`: **PASS**.
- Changed-scope ESLint/Prettier: **PASS**. `node scripts/check-architecture.mjs`: **PASS**, 857
  TypeScript source files. `node --check scripts/verify-migration-path.mjs` and
  `git diff --check`: **PASS**. No new `any` debt, skipped/focused tests or dynamic source execution.
- Read-only pre-restart check: Runtime database remains `127.0.0.1:55462/sdar_uap`, Control is the
  paired existing database on 55463; three supervisor-owned processes are running with side effects
  `NO`. One canceled Task, zero active workflows, zero MCP invocations and zero remote bindings.
  The old process still lacks the natural-language Card extension, as expected before restart.

## Idempotence and Recovery

Do not change/delete existing attempts, reports, credentials or databases. Discovery operations use
the existing idempotent command/transaction boundary. Concurrent health refresh must not allocate
duplicate revisions. Failed discovery records unavailable health without revoking registration.
Restart uses the existing supervisor; preserve the current side-effect mode and never execute a Tool.

## Artifacts and Evidence

- ADR-141; additive Control migration and rollback notes.
- Focused test paths and command results recorded below when actually run.
- Existing untracked historical reports remain untouched and are excluded from the commit.

### Deployment observation (2026-08-26)

Code commit `9fc5ae01a969b6e0d4406d7d23daee61be0f3619` was pushed to
`origin/codex/provider-binding-lifecycle` before restarting the existing three supervisor-owned
processes. No Docker/Provider service, database volume, Task or historical evidence was removed.
The supervisor restarted with `NO` and verified all three process identities.

At `02:32:29Z`, the running processes still used Runtime `127.0.0.1:55462/sdar_uap` and Control
`127.0.0.1:55463/sdar_uap_control`; Control's Runtime URL exactly matched the server's actual URL.
Control migration 0012 was installed. Binding `ugv-smpp-uap-p3-b01-binding` remained semantic revision
1 with Catalog `2.0.0-rc.1:1` and checksum `65d2386183eae1eb823aedf8a4b991b13b3de7d77f6811c44e4d6ac9eb847534`.
Its real health observation advanced from `2026-08-25T03:39:38.242Z` to
`2026-08-26T02:31:47.424Z`, with fresh available health valid until `03:31:47.424Z`.
The immutable Binding count remained 1, observations became 2, Runtime tool revision remained 1,
protocol snapshot count remained 1, and Runtime `updated_at` remained unchanged.

The public Card returned HTTP 200 and retained `embodied.move_to`. At `02:33:08Z` its
`io.sdar/naturalLanguageCapabilityAdmission` extension explicitly advertised `text/plain`,
`externalCapabilityMetadataRequired=false`, `a2a.embodied.move@2`, `embodied.move@2`, the WGS84 input
schema and anonymous requester policy. This was already public while readiness was still converging
from the old unavailable observation, directly proving registration/readiness separation.
Task count remained 1 (the pre-existing canceled Task), MCP invocations and remote bindings both 0.

At `02:34:09Z`, readiness snapshot 1278 was `available` / `available`, fresh through `02:34:57Z`,
with no reasons. It was evaluated at `02:33:57Z` after the existing improvement-stability window.
The active managed Card was revision 60. MCP invocations, remote bindings and active workflows
remained zero. Actual listener PID `2416023` owns ports 10998/10999; PID `2416838` owns Control 10091.
The original databases and evidence were retained, and the side-effect gate remains `NO`.

## Outcomes and Retrospective

All requested lifecycle changes, targeted validation, code push and debug restart/read-only checks
are complete. Card discovery recovered independently of readiness and stayed present while readiness
converged; real health renewal did not create a Binding revision or rotate Runtime anchors. No
external movement acceptance, Tool execution or merge into `main` is claimed. The repair is pushed
on `codex/provider-binding-lifecycle`; this deployment uses that tested source revision.
