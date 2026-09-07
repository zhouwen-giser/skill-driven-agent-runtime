# P08 Independent Read-only Review

Review scope: P08 implementation commit `c76a4d0`; frozen Exposure, Agent Card and Runtime-control
contracts; Control/Runtime PostgreSQL adapters; A2A endpoint composition; migrations; focused and
full evidence. The review phase was read-only. Repairs were made only after it ended, followed by
affected and full gate reruns.

## Blocking

None.

## Major

None open. Three Major findings were closed before acceptance:

- Agent Card revision allocation now uses a PostgreSQL sequence instead of concurrent `MAX+1`.
- Card uniqueness covers both content and capability-catalog evidence, so an unchanged wire Card
  with changed readiness evidence is representable and auditable.
- If Runtime activation succeeds but the Control Active acknowledgement fails, the prior Runtime
  Active/LKG is restored and the candidate/operation becomes rejected/failed.

## Minor

None open.

## Accepted

- Only public, published Exposures backed by exact published Capabilities and current qualifying
  Runtime readiness create AgentSkill entries.
- AgentSkill identity and display metadata originate from Exposure, never from an internal Skill.
- Requester policy is excluded from the Card and sensitive policy keys fail closed.
- Official SDK validation precedes stage, invalid Cards cannot replace Active, and identical rebuilds
  are idempotent no-ops.
- Runtime remains the active Card byte authority; Redis owns no Candidate, Revision or Active fact.
- Node Event delivery remains correctly deferred to the P12 frozen at-least-once event stream.

Verdict: 0 Blocking, 0 Major, 0 Minor; P08 is acceptable for evidence publication.
