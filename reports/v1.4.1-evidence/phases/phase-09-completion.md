# Phase 9 Completion

- Phase: 9
- Goal: Node Control Evidence
- Base SHA: `ca0bf35`
- Coverage: 21/21 Node Control types; 95/100 total implemented and verified; 94/95 Required
  verified (98.95%)
- Runtime path: Control immutable observation ledger + Runtime delivery/ACK ledger -> two
  independently checkpointed sources -> canonical Node Control mapper -> Runtime PostgreSQL
  Evidence Outbox -> bounded single-flight HTTP export -> receiver ACK
- Authority: Control PostgreSQL retains all Control write authority; Runtime PostgreSQL owns
  Evidence/Exporter authority; Redis is wake-only; the sink is non-authoritative
- Security: fixed internal `node_control.evidence.read` service identity, fail-closed scope and
  classification checks, recursive CredentialRef redaction, no public projector route
- Focused E2E: real Control/Runtime PostgreSQL, Redis and HTTP sink 1/1 passed
- Registry: 100 total / 95 Required / 5 diagnostic; Node Control 21 verified; Evidence family five
  source-confirmed for Phase 10
- Independent Review: Blocking 0 / Major 0 / Minor 0 / Accepted
- Full verify: not passed and not claimed; first attempt failed lint and was repaired; second passed
  1,058 Unit/performance assertions before a stale Contract fixture failed; the repaired direct
  Contract suite passed 10/10; explicit user direction defers the next complete gate to Phase 14
- Blockers: no Phase 9 implementation or Review blocker; release-level full gate remains pending
- Next phase: Manifest, Coverage and Quality

## Failure and rerun evidence

- The first focused vertical exposed that schema hashing traversed the safe `secretStatus` schema
  descriptor. The canonicalizer now accepts only the frozen availability enum descriptor while
  still rejecting inline secret material.
- The next vertical exposed lexicographic ordering of `observation_sequence::text`, which caused an
  Apply ACK to reference `validated` instead of the exact `published` Configuration snapshot.
  Authority queries now order the bigint column explicitly.
- The enlarged self-observation backlog exposed one-partition-per-second exporter starvation. The
  Server now performs a bounded, sequential, single-flight drain of at most 32 successful
  partitions per tick and stops on failure or no work. The final focused vertical passes 1/1.
- Full verify attempt one stopped at lint; the exact mechanical findings were repaired. Attempt two
  passed 1,058 Unit/performance assertions and stopped on a stale positive Contract fixture. The
  affected Contract suite then passed 10/10 directly. No successful full-verify claim is made.

## Independent read-only review

- Blocking: none.
- Major: none.
- Minor: none.
- Accepted: all 21 Node Control records preserve Control/Runtime authority, Activity/event
  identity, exact references, Last-Event-ID recovery, revision/conflict behavior, service RBAC,
  scope/redaction and the generation-1 recursion boundary.

Phase 9 is closed for implementation and handoff. The final repository-wide verification remains
scheduled once at Phase 14 by explicit user direction.
