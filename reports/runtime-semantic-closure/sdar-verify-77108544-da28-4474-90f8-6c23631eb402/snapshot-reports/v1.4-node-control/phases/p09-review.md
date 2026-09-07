# P09 Independent Read-only Review

Review scope: P09 implementation commit `39298c3`; frozen Task Binding API/schema; Runtime Domain,
Application and PostgreSQL paths; A2A mapping; Runtime-Control query; migrations; focused and full
evidence. The review phase was read-only. Repairs were made only after review findings were recorded,
then affected and full gates were rerun.

## Blocking

None open. One Blocking was closed: ordinary Tasks no longer attempt to update a nonexistent
Capability Attempt during completion/failure when the Capability service is globally composed.

## Major

None open. Three Major findings were closed:

- Node Control reads Binding through the restricted Runtime-Control read adapter and no longer
  imports the Runtime write repository.
- Binding now freezes actual secret-free Skill tool/runtime policy or Plan Template dependency
  content and exact Provider refs, rather than storing only readiness hashes.
- Actual controlled Model fallback records `provider_failover` before invoking the next Provider;
  the API is no longer an unconnected history helper.

## Minor

None open. Deep freezing, runtime reason/status validation, composite Task/Binding identity,
timestamp checks, idempotent terminal timestamps and test cleanup isolation were hardened.

## Accepted

- Binding creation is in the same PostgreSQL transaction as Task, initial attempts and created event.
- Exact Exposure/Readiness/requester/schema admission fails closed, while no-metadata Tasks preserve
  existing behavior.
- SQL and Domain immutability cover Binding, Agent Card Exposure snapshot and attempt content.
- Replan, Skill replacement, Provider fallback and recovery preserve append-only attempt history.
- Terminal success requires frozen criteria, evidence and policy evidence.
- Redis owns no Binding, Attempt or Task authority.

Verdict: 0 Blocking, 0 Major, 0 Minor; P09 is acceptable for evidence publication.
