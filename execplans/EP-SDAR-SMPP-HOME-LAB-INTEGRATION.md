# EP-SDAR-SMPP-HOME-LAB-INTEGRATION

## Purpose / Outcome

Integrate SDAR v1.4 Node Control with the authoritative SMPP Registry and two Home Assistant MCP
Tasks Runtimes in the `home-lab` environment. The observable outcome is a governed A2A-to-SDAR-to-
SMPP path for read-only state, main-light control, safe climate mode/temperature control, a
cross-provider workflow, durable continuation, objective evidence, and restart/drift recovery
without duplicate physical side effects.

This is SDAR half of cross-repository Goal Run
`019fca75-f48a-7780-ac5e-942503c6690e`. The companion SMPP plan is
`../sdar-mcp-provider-platform/execplans/EP-SMPP-SDAR-HOME-LAB-INTEGRATION-SUPPORT.md`; the shared
run state is under `../.codex-sdar-smpp/`.

## Requirements Covered

- G02: vendor and byte-lock SMPP-SDAR Registry Projection Contract V1.0 and checksum vectors.
- G04: synchronize `home-lab-smpp` by poll with 200/304, strict checksum/expiry handling, durable
  Snapshot/LKG recovery, and non-callable Provider Candidates.
- G05: create exact Climate and Light MCP Provider Bindings and build Catalog only from live
  `server/discover` and `tools/list` responses.
- G06: publish the required exact Capability, Skill, evidence, confirmation, resource, binding, and
  version governance.
- G07-G08: qualify deterministic and A2A read-only execution with complete cross-system IDs.
- G09-G11: qualify gated main-light, safe climate, and cross-provider workflows with restoration.
- G12-G13: qualify source/binding/runtime drift and recovery, full gates, and secret-safe evidence.
- G14-G15: publish an independent SDAR pull request and optionally merge only when the explicit
  switch and protected gates permit it.

The detailed acceptance evidence lives under `reports/sdar-smpp-integration/`; current Goal status
is reflected in `docs/17_TRACEABILITY_MATRIX.md` without rewriting historical release evidence.

## Context and Orientation

- Baseline is `origin/main` and branch `codex/sdar-smpp-home-lab-integration`, initially
  `a9957c82c17ca01e77528f3817c03d86224aaf88`.
- Node Control remains authority for Source/Candidate/Binding/Capability/Skill/Plan governance.
- Runtime remains authority for Workflow, MCP invocation, Remote Task continuation, outcomes, and
  evidence matching. PostgreSQL remains durable authority; Redis remains ephemeral wake state.
- SMPP Provider Candidates supply identity and endpoint lineage only. They are never callable tools.
- Catalog eligibility comes only from live MCP discovery after a governed binding is configured.
- Home Assistant entity IDs and credentials remain in SMPP-local ignored files and never enter this
  repository, API output, logs, or reports.

## Architecture and Interfaces

SDAR consumes only the frozen strict projection DTO through an authenticated Source endpoint. Its
checksum input includes `smppSourceId`, normalized and sorted candidates, revision, generated and
expiry timestamps, and stable labels. A Source stores immutable Snapshots and an unexpired LKG. A
Candidate becomes usable only after an exact binding with source/provider/server/revision/checksum
lineage, CredentialRef, endpoint allowlist and local Server identity.

The existing Node Control public/internal contracts, official A2A adapter, official MCP adapter,
LangGraph workflow runtime, Remote Task Binding, immutable workflow instance, confirmation gate,
and evidence authority boundaries remain intact. Any externally received value is schema-validated
before entering a domain model. Redirects, credential-bearing URLs, private/loopback endpoints not
explicitly allowlisted, stale availability, drift, and missing credentials fail closed.

## Progress

- [x] 2026-08-10 20:49 +08:00 read the complete Goal package, fetched both origins, verified clean
      repository identities and created this branch from exact `origin/main`.
- [x] 2026-08-10 20:49 +08:00 acquired shared Goal lock and recorded exact SDAR/SMPP baseline SHAs.
- [x] 2026-08-10 21:05 +08:00 completed G00 secret-source, Home Assistant read-only (10/10),
      isolated database migrations, dedicated Redis, and active/uncertain Task checks (0/0).
- [x] 2026-08-10 21:18 +08:00 inspected existing P04-P10 Source, Candidate, Binding, Catalog,
      Capability, Skill, A2A and Remote
      Task implementations; record the first contract gap before editing production code.
- [x] 2026-08-10 21:47 +08:00 vendored and byte-verified the six-file projection contract,
      locked all required checksum vectors, and passed strict SDAR consumer/Node Control tests.
- [x] 2026-08-10 completed G03/G04 live projection probing, authenticated Source synchronization,
      304/LKG/restart/outage recovery, and strict expired/bad-lineage fail-closed acceptance.
- [x] 2026-08-10 completed G05 with two governed bindings and live Runtime `server/discover` plus
      `tools/list`; exact 4/3 Tool catalogs, schema/task behavior, freshness and CAS drift tests passed.
- [x] 2026-08-10 completed G06 with five exact-version procedure Skills and five published
      Capabilities. Public Runtime readiness was `available` after the mandatory stability window, and
      the same run replayed idempotently without physical resource bindings or device writes.
- [x] 2026-08-11 completed G07 with live deterministic Climate/Light reads and a same-run replay.
      Complete Task/Context/Goal/Plan/Workflow/Skill/Binding/MCP Invocation lineage, structured results
      and evidence remained identical; provider calls were not replayed; model calls and physical
      writes were zero.
- [x] 2026-08-12 completed G08 with one real A2A Task/Goal, the exact composite Capability/Skill,
      all seven task-linked structured-model stages, two live read-only MCP invocations, a combined
      structured Outcome, complete queryable authority lineage, and same-run Runtime restart
      recovery. Model semantics are explicitly supplied by a local simulated structured fixture.
- [ ] G09 and G10 completed the bounded real SMPP Runtime/Adapter/Home Assistant provider path,
      idempotency checks and restoration. They remain partial because the required SDAR
      Goal/Plan/confirmation/MCP lineage was not executed.
- [ ] G11 executed the real cross-provider tasks but failed the objective: the Climate Task
      confirmed `cool`, then Home Assistant returned to `off` within about three seconds. Climate
      and both lights were restored, write gates were closed and active/uncertain counts are `0/0`.
- [ ] G12 is blocked: deterministic/same-Goal read-only recovery evidence exists, but the Required
      real in-flight SDAR/SMPP/Adapter restart and fault cases were not executed.
- [ ] G13 is blocked by the authoritative full-run Phase 13 Runtime P95 regression
      (`39.981096754646735% > 10%`). Failed attempts 6 and 7 are immutable evidence; the later focused
      pass is diagnostic and does not supersede the failed repository-wide run.
- [x] Completed exact-commit review and published tested candidate
      `af88761891f6204bf6625bd423f382f025f59ba3` in blocked Draft PR #19. Merge/post-merge
      validation is not eligible while Required readiness and protected gates remain false.

## Discoveries and Surprises

- The current `origin/main` already includes SDAR v1.4.1 Canonical Evidence Export via PR #18.
- The SMPP Home Assistant preparation PR #9 is already merged and its retained support branch is
  byte-identical to SMPP `main`; this integration can use the required branch without reconciling
  divergent history.
- Docker is healthy when queried outside the filesystem sandbox. Existing unrelated containers and
  volumes must be preserved; the Goal will use unique database names and port/prefix inventory.
- Same-run G05 replay exposed a real authority gap: Control refresh was idempotent but an
  unconditional Runtime refresh could advance Tool revision beyond Binding revision. The live
  driver now refreshes once only when Runtime is exactly one revision behind, reuses an equal
  revision, and fails closed for every other gap. Both providers converged at revision 17.
- Runtime readiness is short lived. `available` is claimed only at the recorded G06 observation and
  G07 admission, not as a current post-expiry condition.
- Full-verification attempt 6 rejected unstable baseline medians (`18.81586958661147% > 15%`). The
  fixed equal-sample attempt 7 stabilized that metric but exposed a Runtime P95 regression of
  `39.981096754646735%`; no evidence-backed root cause is yet established.

## Decision Log

- 2026-08-10: Treat the SMPP native Registry as immutable authority and add only the consumer
  projection contract required by the Goal.
- 2026-08-10: Keep contract assets byte-identical across repositories but never copy production
  implementation source.
- 2026-08-10: Do not enable any physical write until both explicit write variables are present and
  read-only preflight plus zero uncertain Task gates pass.
- 2026-08-10: Do not merge SDAR without `ALLOW_SDAR_MAIN_MERGE=YES`, passing protected checks, zero
  unresolved review threads and zero active/uncertain Tasks.
- 2026-08-11: Preserve Phase 13 attempts 6 and 7 as immutable failed evidence. Do not use the later
  focused pass as repository-wide acceptance and do not perform result-seeking retries or further
  measurement-protocol edits in this Goal.
- 2026-08-12: Open the real-device gates only for the bounded run, then close them after restoration.
  Record G09/G10 as provider-path partial rather than SDAR-governed success, and record G11 as a
  real objective failure rather than retrying the device until green.

## Implementation Steps

1. Map the current v1.4 Source/Candidate/Binding/Catalog/Capability/Skill/A2A/Remote Task code and
   tests to G02-G12; capture the first narrow failing contract.
2. Vendor and verify the canonical SMPP projection asset set, manifest, source lock and checksum
   vectors. Add only SDAR consumer/interop code required by a demonstrated gap.
3. Configure and persist the `home-lab-smpp` Source with SecretRef and poll/LKG semantics; exercise
   live 200/304/restart/outage paths against the SMPP candidate.
4. Create exact Climate/Light bindings, run live discovery, qualify Catalog checksum/revision,
   schema, task behavior, availability and drift, then publish only allowed capabilities/skills.
5. Run deterministic read-only and A2A read-only workflows before any write test.
6. With explicit safety variables, capture original device state, run each bounded physical scenario
   exactly once per Task identity, confirm objective state/evidence, and restore.
7. Exercise restart, notification fallback, checksum/expiry, binding/catalog drift and fail-closed
   cases; leave no active, uncertain, orphaned or replayable side-effect Task.
8. Run focused and full SDAR/cross-repository gates, secret scan, exact-commit review, update status,
   traceability, changelog, final reports and handoff, then commit/push/open the SDAR PR.

## Validation

Discover exact commands from the execution-time `package.json`. Required gates include frozen
contract byte/hash/vector checks, Source 200/304/LKG/outage tests, live MCP discovery, governed
read-only and A2A execution, gated physical scenarios, restart/no-replay tests, secret scans and the
repository's full `pnpm verify`. Any unavailable command is reported as unverified rather than
silently replaced. PostgreSQL commands use explicit `TEST_DATABASE_URL`; Redis uses a dedicated
instance or Goal-specific prefix.

Current authoritative repository-wide run: `reports/verification/summary.json`, start
`2026-08-11T04:21:11.197Z`, finish `2026-08-11T04:41:19.158Z`. Static/unit/contract/build passed
(218 files, 1,514 tests, 165 OpenAPI operations); cognitive replay passed; Runtime migrations 43 and
Control migrations 10 passed; PostgreSQL/Redis integration passed (33 files, 180 tests). The final
E2E stage failed solely at Phase 13 performance: baseline drift `5.947292858025259%` passed,
Evidence append P95 `9.931700000001001 ms` passed, Runtime P95 regression
`39.981096754646735%` failed the `10%` ceiling. Therefore full verification is `failed`.

## Idempotence and Recovery

Every setup step is keyed by Goal Run ID and exact revision. Source sync, binding refresh,
capability/skill publication and evidence writes are idempotent. A Remote Task resumes through its
durable binding and authoritative SMPP `tasks/get`; SDAR never replays `tools/call` after uncertain
delivery. Physical actions record original state before the call and restore only through the same
gated Runtime-Adapter path. The same failure signature is repaired at most three times.

## Artifacts and Evidence

- Shared run state: `../.codex-sdar-smpp/`.
- Vendored contract: `protocol/external/smpp-sdar-registry-projection/v1/`.
- SDAR evidence and handoff: `reports/sdar-smpp-integration/`.
- Traceability: `docs/17_TRACEABILITY_MATRIX.md`.
- Significant deviations from frozen contracts require an ADR before implementation.

## Outcomes and Retrospective

Final Draft-publication outcome:

- Readiness true: projection contract, Registry integration, Provider Binding, Capability
  governance and deterministic read-only execution.
- Readiness false: A2A read-only, real light control, real climate control, cross-provider scenario,
  resilience integration and overall cross-repository integration.
- G08 code/configuration blockers are closed; the standard Runtime composes the explicit
  `home_lab_read_only` profile and the exact local structured-model routes.
- External/safety blockers: real-device write gates and real-fault injection gates are absent.
- Verification blocker: authoritative SDAR full verification failed the Phase 13 Runtime P95 gate.
- Safety closeout: active/uncertain SDAR Tasks `0/0`, active/uncertain SMPP Tasks `0/0`, physical
  writes `0`, device restore `RESTORED`.
- Tested candidates and independent Draft PR URLs are recorded in the final handoff. Merge, tag,
  release and public deployment remain unauthorized.

Exact allowed/blocked resources and operations, final commit/PR traceability and the same explicit
blockers will be frozen in the final handoff after publication; they are not guessed here.
