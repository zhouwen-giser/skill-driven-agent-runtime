# Phase P04 Report

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Baseline: `origin/main` at `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Repair branch: `fix/sdar-breakpoint-repair`
- P04 implementation commits: `6711aaa`, `7e98cbb`, and `2e695a6`
- Physical device writes: `0`
- Fire authority created or enabled: `0`

## Breakpoint

`BP-SDAR-004` - Governed Physical-Control Authority.

Disposition: `FIXED`.

The Runtime now proves the complete authority chain from exact Capability version and confirmed
Skill/Plan through effect/risk classification, trusted-human confirmation, readiness, exact Task
Capability binding, one bounded Provider dispatch, and durable terminal observation evidence.
Catalog discovery remains evidence only and cannot authorize execution.

Phase exit: `GOVERNED_CONTROL_AUTHORITY_PASSED`.

## Reproduction before repair

Temporary Skill discovery and ordinary Workflow transport could reach an enabled MCP Tool without
an exact Task Capability binding or a durable human-control authority. Discovery could therefore be
mistaken for permission to execute a side effect, and a confirmation was not bound to exactly one
Provider dispatch.

## Implemented authority chain

- Every Runtime MCP call continues through `McpRegistryService`; Generic Workflow, Temporary Skill,
  and direct Runtime paths do not bypass the governed-control gate.
- `unknown` and `side_effecting` calls fail closed unless the exact Task ID, active Capability
  attempt, single Provider Binding, current Capability version and constraints, active Skill,
  confirmed Plan hash, declared risk, readiness, and bounded durable confirmation all agree.
- Production Management API issue/revoke commands derive a trusted human principal from the
  server-side bearer identity. The request body cannot select the actor or authority scope, and
  distinct `physical_control.confirm` and `physical_control.revoke` permissions are enforced.
- The server derives the confirmation scope from PostgreSQL authority: Task, Capability binding and
  attempt, Plan hash, Skill, Provider binding, server, Tool, and arguments hash.
- Migration `0158_v14_governed_control_dispatch_consumption` binds the confirmation to the exact
  attempt, Provider binding, server, Tool, arguments hash, invocation, and dispatch hash.
- The deterministic pre-transport fence is acquired before confirmation consumption. Consumption
  is one-way and one-shot; a repeated call, including the same logical scope, fails with
  `GOVERNED_CONTROL_CONFIRMATION_ALREADY_CONSUMED` before Provider transport.
- The existing UGV policy vocabulary (`side_effecting`, `before_execution`,
  `required_before_execution`, and medium/high/critical risk) is accepted by the positive authority
  path without weakening its constraints.
- `vehicle_fire_weapon` remains hard denied by Tool identity before transport even if metadata is
  misclassified. This Goal creates no fire Capability, Skill, confirmation, or execution authority.

## Positive execution and evidence

The PostgreSQL integration uses the production management service, PostgreSQL authority reader and
stores, `McpRegistryService`, and the loopback Frozen MCP Provider. A trusted human issues one
bounded confirmation for `embodied.move`; exactly one `tools/call` creates and reconciles the remote
Task. The terminal Provider snapshot is persisted with `position.observation` evidence and a
pending `task.completed` control event. A second dispatch with the same authority is rejected, and
the Provider call count remains exactly one.

This is a deterministic fake-provider qualification. It performs no physical write and does not
claim real-device qualification.

## Negative execution proof

The A2A E2E regression covers ungoverned `embodied.move_to` and recursive
`embodied.area_patrol` paths. Each fails closed with `MCP_CONTROL_AUTHORITY_REQUIRED` before
`tools/call`, remote Task creation, MCP invocation persistence, or any child Provider dispatch.
Catalog discovery and Plan confirmation alone therefore do not become control authority.

## Validation

| Gate | Result | Evidence |
| --- | --- | --- |
| Trusted-human management, HTTP, authority, and repository tests | PASS | 150/150 |
| UGV policy/authority regressions | PASS | 19/19 |
| Governed PostgreSQL + loopback Provider integration | PASS | 2/2, including one terminal positive dispatch and restart/revoke/expiry/FK/immutability |
| Ungoverned A2A control regressions | PASS | 8/8; Provider transport count remains zero |
| Full repository TypeScript check | PASS | `pnpm typecheck`, exit `0` |
| Physical-device safety | PASS | `physicalDeviceWrites=0`; deterministic fake Provider only |

The positive chain proves Provider call count `1`, durable remote admission and terminal
reconciliation, `position.observation` evidence, and rejection of a second call without an
additional transport. The negative chain proves ungoverned calls do not reach Provider transport.

## Authority and safety impact

Runtime PostgreSQL remains Task, Capability-attempt, confirmation, invocation, and remote-binding
authority. Node Control definitions remain read-only inputs. The repair adds no second Task state
machine, no real-device permission, and no fire authority. Read-only Tools preserve their prior
behavior; controlled writes require the new exact, trusted, single-dispatch authority chain.

## Status

`GOVERNED_CONTROL_AUTHORITY_PASSED`
