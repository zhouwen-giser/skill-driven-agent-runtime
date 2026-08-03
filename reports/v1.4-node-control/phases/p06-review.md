# P06 Independent Read-only Review

Review scope: P06 implementation commits `b092cb0`, `5db4848`, `479cc64` and `f5be34f`; frozen
Capability contracts; Domain/Application/API/PostgreSQL composition; migration; focused tests and
full verification evidence. Every review pass was read-only. Repairs were made only after ending the
applicable pass, followed by affected-gate reruns.

## Blocking

None.

## Major

None open. Three Major findings were closed before acceptance:

- Input/Output schemas were initially only checked as objects. A production Ajv boundary now compiles
  both as valid JSON Schema before validation/publication and reports stable schema errors.
- Capability create and implementation-binding create initially ignored the frozen command-wide
  `Idempotency-Key` policy. Both now use request-hash receipts, audit events and serialized replay.
- Mutable Capability lifecycle commands initially ignored the frozen ETag/If-Match policy. GET now
  emits a stable lifecycle ETag and stale validate/publish/terminal transitions fail with 412.

## Minor

None open. Two Minor findings were closed:

- Canonical object keys now use exact code-point ordering rather than locale-dependent comparison.
- Exact implementation versions reject noncanonical strings such as `01` before numeric lookup.

## Accepted

- `NodeCapabilityDefinitionVersion` owns business promises; Skill `capabilities[]` remains only a
  compatibility projection and cannot authorize publication.
- Exact enabled/validated Skill or active compiled Plan Template versions are checked through narrow
  read-only authority ports; Control writes neither authority.
- An active primary or alternative path is mandatory. Resource and undeclared implementation kinds
  fail closed; supporting/validation/recovery alone are insufficient.
- Published business promises are immutable in PostgreSQL. Lifecycle changes are idempotent,
  optimistic-concurrency protected and separately audited.
- Redis owns no Capability, binding or command result.

Verdict: 0 Blocking, 0 Major, 0 Minor; P06 is acceptable for evidence publication.
