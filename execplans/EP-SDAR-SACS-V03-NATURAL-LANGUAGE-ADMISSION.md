# SACS v0.3 natural-language A2A admission ExecPlan

## Purpose / Outcome

Make the existing A2A 1.0 endpoint truthfully usable by SACS v0.3 through the public
`text/plain` Agent Card contract. A SACS caller can submit one ordinary natural-language UGV point
navigation request without knowing or fabricating SDAR-internal Capability metadata, an Exposure
version, an idempotency key, a Data Part, or a management API. SDAR deterministically derives the
bounded structured input, persists the normal PostgreSQL Task/Context/Capability Binding/Attempt
and initial-admission authority atomically, and retains the existing plan confirmation, MCP Runtime,
Provider and terminal-evidence gates.

This plan does not add A2A v0.3 wire compatibility. “v0.3” names the SACS product version; the wire
baseline remains A2A 1.0 / specification 1.0.1 under ADR-069.

## Requirements Covered

- FR-A2A-001/002/003/004: truthful Agent Card discovery and ordinary A2A Task submission.
- FR-SKL-001/003/005 and FR-EXE-001/002: server-owned Capability admission and exact Skill input.
- NFR-COMP-001: preserve the A2A 1.0 wire baseline while admitting a SACS v0.3 client.
- UGV Profile compatibility scenario: text such as
  `move the UGV to lon 106.81344630, lat 29.72034353` produces one durable formal admission;
  replay of the same A2A message identity returns the same Task; no side effect occurs before the
  existing plan confirmation.

## Context and Orientation

- `packages/a2a-adapter/src/task-mapping.ts` currently accepts a plain text Message, but only maps a
  formal Capability admission when the caller supplies private `io.sdar/requestedCapability`,
  `idempotency_key`, `structured_input` and one Data Part.
- `packages/application/src/task-service.ts` and
  `packages/persistence-postgres/src/task-capability-repository.ts` already own the durable atomic
  initial-admission transaction and replay/conflict behavior.
- `apps/server/src/ugv-agent-profile-admission.ts` requires that binding before its deterministic
  Goal/UserGoalPlan handoff. It must not read request prose or mutable metadata as execution
  authority.
- `packages/node-control-application/src/a2a-exposure-service.ts` builds the managed Agent Card, but
  the UGV Profile currently bypasses that managed Card and publishes an enabled-Skill-only view.
- SACS code is not present in this repository. Compatibility evidence therefore uses the official
  A2A 1.0 SDK/wire shape with a text-only, metadata-free request matching the reported SACS contract.

## Architecture and Interfaces

- Add an Application-owned, protocol-neutral `NaturalLanguageCapabilityAdmissionResolver` port.
  It receives bounded request text, normalized user identity and a stable client request identity,
  and may return an exact Exposure request, structured Capability input and durable idempotency key.
- `TaskService` invokes that port only for text-only submissions that do not already request formal
  Capability admission. Explicit structured callers retain their existing strict contract.
- The A2A adapter supplies only the official Message `messageId` as a protocol-neutral client request
  identity. It does not know UGV coordinates, Exposure IDs or Capability policy.
- The UGV Profile implementation parses exactly one explicitly labelled longitude and latitude,
  validates the intent/resource/coordinate bounds, produces the existing v2 input shape and derives
  a stable admission key from the client request identity. No model output is used.
- `RuntimeTaskCapabilityService` accepts the resolver's typed request through a direct Application
  parameter. It still resolves the current Exposure/readiness/Provider authority from PostgreSQL and
  applies the same schema/requester checks before the existing atomic accept.
- The existing UGV public Card remains the enabled-Skill projection and receives a safe optional
  extension resolved from the current PostgreSQL managed Exposure/readiness authority. It advertises
  Exposure/capability versions, request schema, requester policy and the fact that `text/plain`
  natural-language admission is server-resolved. SACS does not need to consume the extension to use
  the text contract.
- The trusted-intranet UGV Exposure permits anonymous A2A submission, consistent with empty Agent
  Card security requirements. This grants admission only; the existing authenticated/governed plan
  confirmation and side-effect gates remain independently mandatory.
- No SDK type crosses Application/Domain boundaries. No management write is exposed to SACS. No
  second Runtime, queue, state machine or persistence authority is introduced.

## Progress

- [x] 2026-08-24 Corrected the terminology: SACS v0.3 is a client/product version, not A2A v0.3.
- [x] 2026-08-24 Located the incompatibility across A2A mapping, TaskService, UGV admission and Card
      projection; confirmed the existing SDK/dependency remains sufficient.
- [x] 2026-08-24 Implemented the protocol-neutral resolver seam, UGV deterministic parser and
      Profile-only Runtime wiring without changing the A2A wire or SDK version.
- [x] 2026-08-24 Made the public UGV Card truthful with a current, safe admission-discovery
      extension derived from the managed Exposure/readiness authority.
- [x] 2026-08-24 Added unit, contract and real local PostgreSQL/Redis Runtime evidence for a
      metadata-free, text-only SACS request, replay and one post-confirm dispatch.
- [x] 2026-08-24 Ran the final implementation gate and updated ADR-140, traceability, assumptions,
      project status, the active UGV plan and changelog.

## Discoveries and Surprises

- The official pinned A2A SDK contains an unrelated v0.3 protocol compatibility module, but it is
  not relevant to SACS v0.3 and will not be enabled.
- Plain text already passes the A2A adapter; the failure occurs later because the UGV Profile runs
  deterministic admission before generic Task Understanding and requires an existing binding.
- The UGV Profile intentionally bypasses its Node-Control managed Card, so the current public Card
  cannot disclose the Exposure authority that the Runtime itself requires.
- The A2A endpoint already supports trusted-intranet identity. SACS does not need a bearer in that
  deployment mode; bearer mode remains an explicit, separately advertised operator choice.

## Decision Log

- 2026-08-24: Keep A2A wire version 1.0 and the pinned SDK unchanged.
- 2026-08-24: Treat external natural language as request evidence, not direct execution authority;
  only deterministic bounded parsing plus current PostgreSQL Exposure/readiness admission may create
  the immutable binding.
- 2026-08-24: Use A2A `messageId` only as a replay identity. It is hashed into the server-owned
  idempotency key and excluded from the canonical semantic request hash, preserving conflict checks.
- 2026-08-24: Do not require SACS to call management APIs or understand private SDAR metadata.
- 2026-08-24: Keep the existing enabled-Skill UGV Card projection and add the current managed
  Exposure contract as an optional public extension; do not switch Card ownership or duplicate the
  Exposure authority.

## Implementation Steps

1. Add and test the Application resolver types and TaskService composition.
2. Add and test the exact UGV natural-language parser/resolver and wire it only for
   `ugv-agent-profile`.
3. Pass A2A Message identity into the protocol-neutral command without changing follow-ups.
4. Enrich the UGV public Card at read time with a bounded contract derived from the current managed
   Exposure/readiness authority; align trusted-intranet requester policy.
5. Add a real local A2A endpoint/runtime regression proving text-only admission, replay identity,
   binding/input authority and zero pre-confirm navigation.
6. Run the mandatory implementation gate and update governance/evidence documents.

## Validation

- Focused Application: TaskService and Task Capability unit tests.
- Focused Profile: UGV parser/admission/Profile unit tests.
- Focused A2A: mapping, compatibility/Card and HTTP endpoint contracts.
- Local Runtime integration: official A2A 1.0 text-only Message, one Task/Binding/Attempt, input-required
  plan confirmation and zero navigation before confirmation.
- Final: `pnpm typecheck`, `pnpm build`, `pnpm verify:architecture`, changed-scope ESLint/Prettier,
  `git diff --check`, and the smallest relevant PostgreSQL integration set.

No external UGV, simulator, Device MCP or live YES window is part of this plan.

## Idempotence and Recovery

The resolver key is derived from a stable client request identity and is accepted only through the
existing PostgreSQL initial-admission transaction. Same identity/same semantics returns the original
Task; same identity/different semantics produces the existing stable conflict; queue failure remains
recoverable through the durable queued attempt. Parser or authority failure occurs before commit and
before queue dispatch. Re-running tests uses isolated fixtures and creates no external side effects.

## Artifacts and Evidence

- `adr/ADR-140-sacs-v03-natural-language-capability-admission.md`
- Focused test output recorded in this plan's Outcomes section.
- Traceability entry in `docs/17_TRACEABILITY_MATRIX.md`.

## Outcomes and Retrospective

Completed for the local SACS v0.3 compatibility boundary. The metadata-free official A2A 1.0 Runtime
integration passes against isolated PostgreSQL/Redis and a frozen local Provider: one anonymous
trusted-intranet text request creates one Task/Context/Binding/Capability Attempt, replay returns the
same Task, pre-confirm navigation remains zero, and the existing confirmation path emits one navigate
then resumes to terminal after restart. No external UGV or live side-effect window was used.

Final evidence:

- focused Application/Profile/A2A matrix: 8 files, 204 tests, PASS;
- real local Runtime/PostgreSQL/Redis integration: 1 file, 1 test, PASS;
- `pnpm typecheck`, `pnpm build` and `pnpm verify:architecture` across 852 TypeScript sources: PASS;
- changed-scope ESLint/Prettier and `git diff --check`: PASS;
- no changed test skip/only, new `any`, dynamic code or embedded credential was found;
- full repository lint retains 22 errors only in seven out-of-scope Home-Lab files, and full format
  retains the two pre-existing files `packages/application/src/skill-usage-planning.ts` and
  `packages/persistence-postgres/test/remote-task-catalog-lineage.contract.test.ts`. These are
  disclosed baselines, not full-gate pass claims.
