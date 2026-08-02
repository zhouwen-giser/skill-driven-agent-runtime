# P08 Completion Report

## Goal

Publish a privacy-safe A2A Agent Card from explicit, published Capability Exposures and current
Runtime readiness without projecting internal Skills directly or allowing an invalid candidate to
replace the Runtime Active/LKG card.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `fcf8455ec692f1c560364a146de811344ab8228e`
- implementationSha: `c76a4d01bd1a0627b951c3066903957c68e77adb`
- repairShas: `02f341c`, `a426309`, `5ddc993`
- evidenceSha: `8e59a2a0c9b2babf4ec80e552a4b8f697b7830d8`

## Implementation

- Added immutable `A2aExposureVersion` definitions with stable content hashes, lifecycle ETags,
  exact Capability Input/Output schemas, visibility, requester policy and readiness publication
  policy.
- Agent Card construction reads only published Exposures backed by exact published Capability
  versions and current Runtime-authored readiness. Organization-only Exposures and internal Skill
  identities never enter public `AgentSkill` entries.
- Added deterministic Candidate/Diff/Stage/Activate/Ack behavior. Concurrent revision allocation
  uses a PostgreSQL sequence, unchanged Cards are no-ops, and equal card content with changed
  capability/readiness evidence remains a valid distinct revision identity.
- Runtime PostgreSQL owns staged/active/superseded Card bytes and command receipts. A Control Ack
  failure compensates by restoring the previous Runtime Active/LKG and records the candidate and
  ManagementOperation as rejected/failed.
- Added all frozen public and authenticated internal Exposure/Agent Card endpoints, official SDK
  schema validation and Runtime A2A endpoint projection from the active managed Card.
- Hardened the pinned A2A TCK launcher to repair incomplete temporary Python environments without
  changing the frozen TCK commit or compatibility scope.

## Acceptance

| P08 criterion | Result | Evidence |
|---|---|---|
| AgentSkill only from Published Capability Exposure | passed | real API/PostgreSQL vertical test and managed-card HTTP contract |
| Internal Skill isolation | passed | Runtime Card contains `capability.device.inspect` and excludes `skill.p06.inspect` |
| Visibility/requester privacy | passed | public-only projection and sensitive requester-policy key rejection |
| Readiness publication policy | passed | current TTL and policy-specific available/degraded/unavailable filtering |
| Candidate diff/idempotency | passed | exact replay and unchanged-content no-op retain one Runtime revision |
| Bad Card preserves Active | passed | official validator rejects invalid staged Card before persistence |
| Ack rollback preserves LKG | passed | Application regression restores prior Runtime Active and records failed operation |
| Schema/TCK gates | passed | frozen bundle 76/28/111/20/7; official HTTP JSON MUST 74 passed, 161 skipped |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 2 files, 3 tests including Control-Ack rollback |
| focused A2A Contract | passed | 1 file, 7 tests |
| focused real PostgreSQL Integration | passed | 1 file, 1 vertical acceptance test |
| aggregate Integration | passed | 25 files, 138 tests |
| architecture / frozen contract | passed | 618 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| official A2A MUST TCK | passed | 74 passed, 161 skipped, 30 deselected, 100% compatibility |
| migration verification | passed | 31 additive Runtime migrations through `0138`, Control through `0007` |
| `pnpm verify` | passed in 482,100 ms | 919 Unit + 22 performance, 215 Contract, 138 Integration, 72 E2E; build and all smokes |

The accepted report is `reports/verification/summary.json` with SHA-256
`b908132ab5f9023737cb58604273e6821eb986ad9be2b11b2c5ce5b9b0a6d43c`.

## Real / simulated / unverified

Control and Runtime PostgreSQL, separate migration ledgers, HTTP authentication, Candidate
deployment, active-card A2A projection, invalid-card rejection, official SDK parsing and the pinned
official TCK are real local evidence. Capability/Skill/provider rows are deterministic integration
fixtures; no physical provider operation was invoked. Multi-node publication and external
organization event delivery are unverified and not claimed; P12 owns the frozen Node Event Stream.

## Review and failed attempts

The independent read-only review closed three Major findings: concurrent revision allocation,
evidence-aware uniqueness and compensating rollback after a Control Ack failure. Final verdict is
0 Blocking, 0 Major and 0 Minor. Failed attempts are retained in
`failed-attempts/p08-a2a-exposure.md`.

## Handoff

P08 is `COMPLETED` locally. P09 may bind Tasks to exact Capability and implementation revisions but
must not change Exposure, Agent Card, Runtime readiness or internal Skill authority.
