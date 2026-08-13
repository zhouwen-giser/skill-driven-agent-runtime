# Phase P04 Report

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Baseline: `origin/main` at `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Repair branch: `fix/sdar-breakpoint-repair`
- Last committed branch SHA before this phase evidence was frozen:
  `5bb5de0d4def7c77e08ec9ffbf89263fd517ff9f`
- Physical device writes: `0`
- Fire authority created or enabled: `0`

## Breakpoint

`BP-SDAR-004` - Governed Physical-Control Authority.

Disposition: `PARTIALLY_FIXED`.

The phase closes the transport-boundary fail-open defect, but it does not yet provide a trustworthy
production path that issues and consumes human control confirmation or a terminal stable-state
proof. The phase exit token `GOVERNED_CONTROL_AUTHORITY_PASSED` is therefore not asserted.

## Reproduction before repair

Temporary Skill discovery and ordinary Workflow transport could reach an enabled MCP Tool without
an exact Task Capability binding or a durable human-control authority. Discovery could therefore be
mistaken for permission to execute a side effect.

## Implemented safety boundary

- Every Runtime MCP call continues through `McpRegistryService`; Generic Workflow, Temporary Skill,
  and direct Runtime paths do not bypass the new gate.
- `read_only` calls retain their existing behavior. `unknown` and `side_effecting` calls fail closed
  unless an exact Task ID, active Capability attempt, single Provider Binding, current Capability
  version and constraints, active Skill, confirmed Plan hash, risk, readiness, and bounded durable
  confirmation all agree.
- `vehicle_fire_weapon` is hard denied by Tool identity before transport even if catalog metadata
  incorrectly classifies it as read-only. This Goal creates no fire Capability, Skill, or authority.
- Migration `0157_v14_governed_control_confirmation` adds PostgreSQL-backed confirmation records,
  expiry, one-way revocation, foreign keys, and update/delete immutability.
- Runtime composes the authorizer only when its Capability authority reader exists. Otherwise
  side-effecting calls fail closed because no control authority is available.

## Remaining blockers

1. No production endpoint derives a trusted human principal and issues or revokes confirmation.
   `GovernedControlConfirmationService` is not composed into a management boundary, and its raw
   caller-supplied actor fields are not suitable as production identity proof.
2. The authorizer's positive constraint shape does not match the current UGV control artifacts;
   existing governed controls remain safely non-selectable rather than forming a positive path.
3. A confirmation is not atomically consumed or bound to exactly one invocation/dispatch. The same
   Task/attempt/context could authorize more than one call.
4. Task Capability terminal evidence still implements read-only semantics. There is no authoritative
   stable side-effect observation evaluator that closes a fake-Provider control Task successfully.
5. Except for the explicit fire hard deny, physical-control classification still depends on declared
   Tool effect metadata. An administrative read-only misclassification remains a structural risk.

The minimum safe follow-up is a bearer-authenticated, human-only management command with a distinct
`physical_control.confirm` permission, server-derived identity and scope, bounded one-dispatch
consumption, and stable Provider evidence. It must not silently reuse artifact-approval authority or
trust actor fields from the request body.

## Validation

| Gate | Result | Evidence |
| --- | --- | --- |
| Governed authority/application/repository focused tests | PASS | 4 files, 60 tests |
| Existing UGV/managed deterministic regressions | PASS | 6 files, 56 tests |
| Full repository TypeScript check | PASS | `tsc -p tsconfig.json --noEmit`, exit `0` |
| Targeted ESLint, Prettier, and `git diff --check` | PASS | Phase-owned files |
| Real PostgreSQL confirmation integration | NOT EXECUTED | Test exists, but the protected local PostgreSQL rejected credentials and the isolated Docker runner was unavailable in the execution environment |
| Positive fake Provider to terminal stable-state path | NOT IMPLEMENTED | No production signer/consumer or terminal stable-state evaluator |

The unexecuted PostgreSQL integration contains restart-load, revoke, expiry, foreign-key, and
immutability cases, but its existence is not counted as dynamic evidence.

## Authority and safety impact

Runtime PostgreSQL remains Task and Capability-attempt authority. Node Control definitions remain
read-only inputs. The repair adds no second Task state machine, no real-device permission, and no
fire authority. Its current production behavior for controlled writes is conservative denial.

## Status

`BLOCKED_PRODUCTION_CONFIRMATION_ENTRY_AND_DYNAMIC_PG_EVIDENCE`
