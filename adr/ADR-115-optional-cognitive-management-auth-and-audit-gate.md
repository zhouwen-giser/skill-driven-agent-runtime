# ADR-115: Optional cognitive management authentication and durable audit gate

## Status

Accepted for SDAR v1.2.3 G15.

## Context

The v1.2.3 Goal package requires cognitive management writes to carry authentication, actor,
reason, expected version and idempotency evidence. The authoritative V1 baseline is a
trusted-intranet deployment with no authentication or multi-tenant identity model. Replacing that
baseline would be a breaking architecture change, while treating an operator-supplied `actorId` as
authenticated identity would be false evidence.

Goal and Planning sessions already persist CAS and idempotency in their authoritative turn tables.
Knowledge transitions and deterministic Capability rebuilds also enforce their own authority
boundaries, but they did not share a restart-stable management request audit.

## Decision

- Preserve trusted-intranet/no-auth as the default deployment mode. In that mode `actorId` remains
  an operator-supplied audit label and is not cryptographic identity proof.
- Add an optional, non-breaking bearer authorizer enabled only by
  `SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN`. The secret must be at least 32 characters, remains
  process memory/environment configuration, and is never persisted.
- Require every G15 cognitive write request to provide `actorId`, a displayable `reason`,
  `expectedVersion` and `idempotencyKey`. Session actions retain their domain-owned CAS and
  idempotency checks.
- Persist a PostgreSQL audit claim before invoking any cognitive management write. The audit table
  records operation, subject, request hash, actor, reason, expected version, idempotency key,
  terminal status and the displayable result/error. It is audit evidence only; existing
  Session/Knowledge/Capability/Experience records remain authority.
- The same operation, subject and idempotency key returns the completed stored result when the
  request hash is identical, and fails closed when the request differs. Pending or failed claims
  are never automatically replayed after restart. An operator must inspect the audit and submit a
  new reviewed key, preventing an indeterminate action from duplicating side effects.
- Reject private-reasoning fields before a result can enter management audit.
- Expose audit records through the trusted management API and Console. Do not expose them through
  A2A or the Public Capability Card.

## Consequences

Authenticated deployments can enforce a real bearer boundary without changing the default V1
network contract. Default deployments still require the existing trusted-network warning and must
not claim that `actorId` is authenticated. The audit gate adds no second business authority and no
automatic retry runtime. A process failure between the authoritative write and audit completion
may leave a fail-closed record requiring operator review; it cannot silently repeat the write.

## Rejected alternatives

- Make authentication mandatory for all V1 deployments: breaks the accepted trusted-intranet
  baseline and Console/API compatibility.
- Treat `actorId` as authentication: produces misleading security evidence.
- Keep idempotency only in HTTP validation or process memory: loses protection on restart.
- Automatically retry pending audit claims: can duplicate an action whose authoritative commit
  succeeded just before process failure.
- Store audit as a second Knowledge or Plan authority: violates the single-authority invariants.
