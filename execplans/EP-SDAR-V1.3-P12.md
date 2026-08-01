# EP-SDAR-V1.3-P12 — Management API, Console and A2A Integration

## Purpose / Outcome

Deliver P12/G21 as a projection and operator-control layer over the frozen
P01-P11 authorities. Provide tenant-scoped Artifact/runtime queries, audited
governance commands, a real Console registry/detail/runtime surface, safe A2A
capability evidence and resumable Outbox-backed SSE without creating a second
Artifact, Goal, Plan, Task, Outcome or policy authority.

## Frozen Baseline

- Branch: `feature/v1.3-sequential-implementation`.
- P11 closure: `0db8796`; local and origin matched with a clean worktree.
- P00 is `READY_FULL`; P01-P11 Handoffs are completed predecessor inputs.
- P12 package self-check passes with registry
  `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
- Consumed `ArtifactGovernancePort`, `FastGateway`, `CaseRuntime` and
  `ModelRouteRuntime` hashes match the P12 lock.

## Exposure Inventory

- Public: allowlisted capability summaries, formal task status,
  input-required/confirmation and safe reason/evidence classes.
- Authenticated user: own task/goal/plan/outcome references and redacted
  Artifact usage.
- Tenant operator/reviewer/approver/admin/security: role- and tenant-bounded
  Artifact lifecycle, evidence, runtime, drift and audit projections.
- Never exposed: Candidate definitions, credentials/API keys/secrets, raw
  Provider configuration, internal prompts/private reasoning, private
  Experience, full PII or cross-tenant existence.

## Architecture

- Domain owns the three frozen P12 contract values and redaction-safe shapes.
- Application owns one RBAC/tenant policy, query/command application ports,
  public A2A projection and SSE projection logic.
- PostgreSQL query adapters read canonical P02-P11 tables and formal Outbox.
  Commands delegate only to `ArtifactGovernancePort`.
- Management controllers parse/transport only; authenticated principal comes
  from an injected resolver, never request JSON.
- Console calls the real Management API and performs no business state writes.

## Progress

- [x] Bootstrap root/branch/clean tree, locate package by manifest ID, verify
      P12 self-check and P11 Handoff.
- [x] Read P12 contracts and inventory current Management/Console/A2A/SSE and
      governance seams.
- [x] Implement frozen P12 Domain/Application contracts and unified policy.
- [x] Implement PostgreSQL query/Outbox projection and Management API.
- [x] Wire audited governance commands through the frozen P02/P06 ports.
- [x] Add real Console Artifact operations/evidence views.
- [x] Add safe A2A capability evidence and resumable SSE.
- [x] Run focused Unit/Contract/Integration/E2E/A2A/accessibility/security tests.
- [x] Freeze code, perform independent read-only review and close findings.
- [x] Run clean exact-commit `pnpm verify`.
- [x] Generate 54/54 Acceptance, evidence and Completion/Handoff.

## Validation

- Frozen field/hash Contract tests.
- Role matrix, tenant IDOR, actor spoofing, redaction, CAS and idempotency Unit
  and Contract tests.
- Real PostgreSQL queries, governance writes, audit and Outbox resume/dedup
  Integration tests.
- Console real-API and accessibility component tests.
- A2A Agent Card/projection, input-required/formal-state compatibility and MUST
  TCK.
- Final clean exact-commit `pnpm verify`.

## Discoveries / Decisions

- Existing P06 HTTP commands accept operator context in the request body. P12
  will not extend that unsafe surface; its unified endpoints resolve a
  principal through injected authentication middleware and pass only derived
  identity context to the frozen governance port.
- Existing P10/P11 read endpoints are narrow evidence projections. P12 will
  aggregate via a formal query port rather than reimplement their decisions.
- Existing A2A formal Task handling remains untouched; P12 adds only optional
  safe metadata and capability projection.
- Review closed the P10 join-key defect, SSE source/public names and tenant
  derivation, IDOR, filters, unconditional A2A exposure, promotion audit and
  lineage redaction.
- SSE is a bounded replay response with overflow/resume, not a second state
  authority.

## Evidence / Outcomes

Focused evidence passes: 98 Unit/Contract/Console/A2A tests, 6 PostgreSQL
management tests, 3 real Server E2E tests and a local 1k/10k/100k benchmark.
First failures and fixes are retained: inactive Docker; legacy database ledger;
multi-statement prepared fixture; missing P12-wide Outbox sequence allocation.
Final `pnpm verify` passed all seven stages from clean commit
`5cef3a04b7237ac126f7e9d0548347b0d5c25baa`: 1,108 Unit/Contract,
129 Integration, 67 E2E, 27 migrations, build and both smoke checks.
Publication is the remaining step.
