# Phase P07 Cross-Project Regression Report

## Status

- Phase result: `CROSS_PROJECT_REGRESSION_PASSED`
- Breakpoint disposition: `BP-SDAR-007 = FIXED`
- Exit token: `CROSS_PROJECT_REGRESSION_PASSED`
- Final live assertions: `98/98 PASS`
- Database-backed SMPP controlled consumer: `1/1 PASS`
- Physical device writes: `0`
- Fire calls: `0`

P07 completed against a fresh, isolated SDAR repair-candidate SUT and the byte-equivalent latest
Console Main tree. The live journey used the production Runtime, Node Control, Console BFF, A2A,
and read-only MCP paths. It proved nonterminal pause/resume and Goal Patch/cancel behavior, exact
Task revision fencing, idempotent cancel replay, and A2A/BFF/Console terminal convergence. No SMPP
or Console source was modified.

## Exact source locks

The following refs and content locks were captured by the live driver at the start of the passing
run on 2026-08-14. SMPP and Console were read-only integration SUTs and remained clean.

| Repository | Checked-out branch / HEAD | `origin/main` | Content lock and observation |
| --- | --- | --- | --- |
| `skill-driven-agent-runtime` | `fix/sdar-breakpoint-repair` / `9ab42ac6e076d007115d640ed4e3a84b0349b8b4` | `b7f02dcedc9680758e7e5f779a939a738d8de770` | HEAD tree `4597d7bd75580ecc6f97e5da2439638c455ce425`; the live run used the frozen dirty repair candidate with tracked-diff SHA-256 `152f2de21e2f53c776b46371457af9491a390e8147dde86b00d5b7bfb1c00dec`. |
| `sdar-mcp-provider-platform` | `fix/smpp-breakpoint-repair` / `7e8b1193d020e9973805aa8cb19d3d4c3dbc1afb` | `340abeeff75cd811b40e1bfd9d5a26f5a62f2c45` | Both refs resolve to tree `f611988bf9d6aa8e5cebfacf53cfb235ff2a6ec4`; worktree clean. |
| `sdar-organization-control-plane` | `feature/single-node-console-live-integration` / `1a5ea3c279331a8fd83dd117d73d5a7166c668b7` | `e7fa2348f7d574a0e9363bdf33598f33144a909c` | Both refs resolve to tree `c0694842247c48813fff9127fda4744bbd02516c`; worktree clean. |

The Console checkout is one merge commit behind by commit identity but byte-equivalent to the
refreshed `origin/main`. The SDAR lock is intentionally a dirty-candidate lock: the exact tracked
diff hash and complete status name set are embedded in the temporary JSON evidence.

## Safety boundary

The live SUT explicitly cleared the real-device side-effect gates. No Home Assistant or other
physical-device writer was started.

- `ALLOW_REAL_DEVICE_SIDE_EFFECTS` was unset.
- `REAL_DEVICE_TEST_RUN_ID` was unset.
- The MCP fixture declared `effect=read_only`.
- `physicalDeviceWrites=0`.
- `fireCalls=0`.

The Runtime used production `apps/server/src/main.ts` with
`SDAR_TASK_UNDERSTANDING_PROFILE=off`; it did not use the temporary Skill Selection override from
the diagnostic attempt.

## SMPP database-backed controlled consumer

The previously unavailable PostgreSQL-backed controlled consumer was rerun with an isolated
`TEST_DATABASE_URL`:

```text
TEST_DATABASE_URL=<redacted> pnpm test:sdar-interop
1/1 PASS
```

It covered Registry import, `server/discover`, `tools/list`, synchronous Tool result,
`tools/call` Task creation, Task cancellation, terminal `tasks/get`, and terminal notification. The
committed read-only SMPP evidence is
`reports/evidence/sdar-interop.json` at SHA-256
`0d5510a615725aadc3e89da25c754d55c20165a25720b2413040f0cfcc918b46`.

This is controlled component interoperability with a local mock adapter. It is not external SDAR
certification, authenticated real-resource evidence, or a physical-device qualification.

## Candidate-built Console live SUT

The passing stack used fresh Goal-owned infrastructure:

| Component | Isolation / endpoint |
| --- | --- |
| Runtime PostgreSQL | `sdar-p07-runtime-postgres`, loopback port `55446` |
| Node Control PostgreSQL | `sdar-p07-control-postgres`, loopback port `55436` |
| Redis | `sdar-p07-redis`, loopback port `56394` |
| Runtime A2A / Management | loopback ports `19999` / `19998` |
| Node Control | loopback port `20080` |
| Console BFF | loopback port `4189` |
| Deterministic model | loopback port `18471` |
| MCP Provider | dynamic loopback endpoint; read-only only |

The driver used real A2A admission and the production Console BFF -> Node Control -> Runtime
command path. It imported the exact Console `liveResourceMap` implementation to verify the terminal
display semantics. No browser screenshot or pixel-level UI claim is made.

### Pause and resume journey

- Task: `6c616066-4d41-4243-a4f3-2c79a284a98a`.
- Context: `a61113a9-faec-4569-9614-6c1d2b8edd41`.
- Started at `awaiting_plan_confirmation`, then executed the confirmed read-only plan.
- Executing revision `10` -> pause `202`, `task.pause`, `SUCCEEDED` -> paused revision `12`.
- Pause ManagementOperation identities: public
  `control-task-56960702dab6d88e3ca92ab0b8fe8091f338ce82`, Runtime
  `runtime-3836f7dca19f447b23cef70fea41d6ac6890f2864e2975d53d737b057042d303`.
- Exactly one MCP invocation existed while paused.
- Resume `202`, `task.resume`, `SUCCEEDED` -> completed revision `15`.
- Resume ManagementOperation identities: public
  `control-task-22433e1d8051855dc6d8a976d70124a15f787e79`, Runtime
  `runtime-f4bc01264f4db42a60adc17950d38a33039d97508638176f4f727d8b93b32bc1`.
- Exactly two MCP invocations existed at completion; the first invocation was not replayed.
- Terminal convergence: A2A `TASK_STATE_COMPLETED`, BFF `completed`, Console mapping `completed`.

### Goal Patch, revision conflict, cancel, and replay journey

- Task: `840e92b6-a3c1-40a4-bc8f-f199fb72d317`.
- Context: `be09365c-e878-4f7b-aded-f68d701d2c9b`.
- Started at `awaiting_plan_confirmation`, revision `9`.
- Goal Patch returned `202`, `task.goal_patch`, `SUCCEEDED`.
- Goal Patch ManagementOperation identities: public
  `control-task-fe8527fd18554d1a1cca67e41fb7fad258daca85`, Runtime
  `runtime-5643e3e85f5c8f6addde5fc8c8c5f711910498fb402f2f12576ef4db56d42015`.
- Runtime then held the legitimate nonterminal replan state: phase `planning`, revision `11`, Goal
  version `2`, stable code `GOAL_PATCH_INVALIDATED`.
- Cancel with stale expected revision `9` returned `412 REVISION_CONFLICT`.
- Cancel with current expected revision `11` returned `202`, `task.cancel`, `SUCCEEDED`.
- Cancel ManagementOperation identities: public
  `control-task-e363ddd26f3eec3c7e390719cc9d77008748707d`, Runtime
  `runtime-cc6a81576efa6da7a627c4318fb368de3c1ac0a3d3edd1ae6ecf33d815537447`.
- Same-key, same-input cancel replay was byte-exact and returned the same public and Runtime
  operation identities.
- Terminal revision `13`; A2A `TASK_STATE_CANCELED`, BFF `canceled`, Console mapping `canceled`.

### Generic profile-off regression proof

The passing run also permanently qualified the production generic Skill path that exposed two SDAR
defects during P07. Direct reads from the fresh Runtime PostgreSQL database showed:

- both terminal Tasks retained their selected Skill while `skill_selection_id IS NULL`;
- `skill_selection_record` contained `0` rows;
- `agent_task_skill_selection_fk` failed-Task count was `0`;
- terminal authoritative rows were `completed` revision `15` and `canceled` revision `13`;
- Runtime logs contained neither `agent_task_skill_selection_fk` nor
  `SKILL_USAGE_SELECTION_ID_REQUIRED` nor a confirmed-execution failure.

This proves the generic profile does not fabricate Skill Selection authority, while the configured
selection paths remain fail-closed through their focused tests.

## Aggregate evidence

| Area | Result |
| --- | --- |
| Final live driver | PASS: 98/98 assertions |
| SMPP controlled PostgreSQL consumer | PASS: 1/1 |
| Registry projection | PASS: 6 canonical assets and 10 checksum vectors; byte-identical native lineage |
| SDAR credential-free / private HTTP | PASS: 3 files / 34 tests |
| SMPP projection | PASS: 3 files / 18 tests |
| SDAR Binding / Catalog / read-only authority | PASS: 3 files / 54 tests |
| SMPP Catalog / Task protocol | PASS: 5 files / 35 tests |
| SDAR remote terminal consumption | PASS: 2 files / 29 tests |
| Console frozen contract | PASS: 94 operations / 29 schemas |
| Console Task command mapper | PASS: 8 tests |
| Console BFF | PASS: 10/10 tests |
| Console Task/A2A presentation mapping | PASS: 19 tests plus the live terminal journeys above |

## Temporary live evidence

The live artifacts intentionally remain outside formal reports under
`D:\Code\test\.codex-console-live\`.

| Artifact | SHA-256 |
| --- | --- |
| `logs/p07-candidate-nonterminal.json` | `7b4f64b3ea46c91b8f759c2d111f58d04cf8355a0e8a83a944a3a14f04ec296c` |
| `logs/p07-candidate-final2.out.log` | `f599d25669563108aebe627fc8ed379442fa955a777826f03266898852e731a3` |
| `logs/p07-candidate-final2.err.log` | `21e92e305f1bc62cae4044a9c0da48b8f81c03f36afaa09d0aac881caf89e735` |
| `p07-candidate-nonterminal.mjs` | `aa0cd4e7b8ae141f9e5999508587b5e76bdcfd8d8c6027d0d2ef8c2ffcb3903e` |
| `logs/sdar-p07-final2-runtime.out.log` | `8915c3dacb5cb7bb6c6517aed95d16958d6eb1f02a4908614d588b00ca8f0339` |
| `logs/sdar-p07-final2-runtime.err.log` | `fb4523a7c774f3ea42c342720ebbb8fb73b261c6feba2ab5eed3726c14416277` |
| `logs/sdar-p07-final2-node-control.out.log` | `5cf41da79ff359a28c6cd5ae96edcb12e7b368d66132532aefb9b68831c0f837` |
| `logs/sdar-p07-final2-node-control.err.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `logs/sdar-p07-final2-console.out.log` | `fa650a6fd70e91d8afa6d98ea80fa656a55e3e8341d085e218aa07e3c9dab7de` |
| `logs/sdar-p07-final2-console.err.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

The JSON is the canonical P07 temporary evidence: it includes the complete source status name set,
all 98 assertions, command and operation identities, Task revisions, A2A/BFF payloads, Console
mapping results, MCP invocation records, and safety counters.

## Cleanup

After evidence collection:

- the exact Runtime, Node Control, and Console BFF process trees were stopped;
- the three Goal-owned `--rm` PostgreSQL/Redis containers were stopped and removed;
- ports `18471`, `19999`, `19998`, `20080`, `4189`, `55446`, `55436`, and `56394` had no listeners;
- no `sdar-p07-*` container remained;
- the Console and SMPP worktrees remained clean;
- `physicalDeviceWrites=0` and `fireCalls=0` remained unchanged.

## Conclusion

BP-SDAR-007 is `FIXED`. Credential-free SMPP Registry consumption, explicitly acknowledged private
HTTP, the database-backed controlled SMPP consumer, and the candidate-built SDAR/Console
nonterminal and terminal journeys are verified within the evidence boundaries above.

```text
CROSS_PROJECT_REGRESSION_PASSED
physicalDeviceWrites=0
fireCalls=0
```
