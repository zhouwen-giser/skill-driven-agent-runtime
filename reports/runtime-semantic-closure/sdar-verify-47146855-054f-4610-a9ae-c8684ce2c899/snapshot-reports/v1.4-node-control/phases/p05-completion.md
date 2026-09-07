# P05 Completion Report

## Goal

Deliver MCP Provider Binding governance for explicit Direct and SMPP-origin imports. Preserve SMPP
as a candidate directory, make real `server/discover` plus `tools/list` the Catalog authority, fail
closed for Catalog drift and stale Availability, and leave existing Runtime Remote Tasks bound to
their original immutable facts.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `f1ea97874b57c8df3553364388f59217c983a78d`
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- mainSyncSha: not required; main did not advance before P05 evidence publication
- implementationSha: `f4099115694cee03c792c0f16590d95569b6e5fe`
- evidenceSha: `526155faac63ea06bbfb77bf2c36d825a889b5bc`
- remoteSha: `526155faac63ea06bbfb77bf2c36d825a889b5bc`, verified after push

## Implementation

- Domain/Application: exact Direct/SMPP origin invariants, Registry and Catalog lineage, append-only
  Binding revisions, safe lifecycle state machine, idempotent commands and fresh-active selection.
- Catalog adapter: reuses the frozen MCP client/registry adapter, resolves only `secret://env/*`,
  applies an explicit endpoint allowlist, rejects redirects and hashes the canonical complete Tool
  Catalog returned by real `server/discover` and `tools/list`.
- PostgreSQL: Control migration `0005_mcp_provider_binding_governance` adds immutable Binding
  revisions and Catalog observations. Binding and local Server advisory locks serialize concurrent
  imports; Redis owns no Binding, Catalog or Availability fact.
- API/composition: implements all frozen list/import/get/refresh/suspend/remove routes. Telemetry is
  not an import origin, and the public projection never exposes credential material.
- Cross-authority acceptance: a real local SMPP HTTP directory, MCP JSON-RPC provider, Control
  PostgreSQL and Runtime PostgreSQL prove explicit import, drift/expiry gating, SSRF rejection,
  historical lookup and post-remove Runtime Remote Task query/control.

## Acceptance

| P05 criterion | Result | Evidence |
|---|---|---|
| Telemetry cannot register Provider | passed | strict import schema accepts only `direct` or `smpp_registry`; 400 regression |
| Snapshot cannot directly make Tool callable | passed | candidate is unselectable before approved import and live Discover/Tools |
| Drift blocks new selection | passed | repeated drift remains `degraded` against the last approved active checksum |
| Availability expiry blocks new selection | passed | short real discovery TTL expires and selectable query fails closed |
| Suspend/remove affect only new selection | passed | terminal state cannot refresh/reactivate; historical revision 1 remains queryable |
| Existing Remote Task remains controllable | passed | real Runtime `remote_task_binding` is found and poll-claimed after Control removal |
| Endpoint/Credential safety | passed | disallowed metadata endpoint and redirect fail; raw credentials never enter API/audit |
| Concurrent identity safety | passed | two imports for one localServerId yield one success, one failure and one durable Binding |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| `pnpm test:node-control` | passed | 9 files, 23 focused tests |
| `pnpm test:integration` | passed | 24 files, 137 real PostgreSQL/Redis tests |
| `pnpm verify:v13-secrets` | passed | 4,226 files plus Git history; 0 findings |
| architecture / frozen contract | passed | 601 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| `pnpm verify` | passed in 358,400 ms | 1,146 Unit/Contract, 137 Integration, 72 E2E; 29 Runtime migrations, build and all smokes |

The successful report is `reports/verification/summary.json` with SHA-256
`009d001fb46e2920d327e70b7d827875147619f3747f0827121605c5f49d7358`. Its recorded
`dirty=true` reflects gate-owned report files created before evidence publication.

## Real / simulated / unverified

Control and Runtime PostgreSQL, both migration ledgers, the Node Control API, the frozen MCP HTTP
adapter, Runtime Remote Task repository and all lifecycle/selectability queries are real local
evidence. SMPP and MCP external services are deterministic local HTTP fixtures exercising real
authentication, protocol envelopes and schemas; no production provider was contacted. Production
network scale and production SLO are unverified and not claimed. P06 capability governance has not
started.

## Failed attempts and review

All strict typing/lint repairs, review findings, host-pause timeout, Docker permission issue and the
first full-gate architecture failure are retained in `failed-attempts/p05-mcp-binding.md`. Three
independent read-only review passes closed 5 Major and 1 Minor findings; the final verdict is
0 Blocking, 0 Major and 0 Minor.

## Handoff

P05 is `COMPLETED`; implementation and evidence are present on the verified remote branch. P06 may
start only after a fresh main comparison and may implement only Capability definition and
implementation-binding authority.
