# Uncertain Admission Recovery

The transition is `prepared -> dispatching -> uncertain -> reconciliation-only`. An uncertain intent
never calls the normal mutating dispatch port again.

Each reconciliation persists an immutable attempt with the logical identity, expected intent version,
request hash, source contract, status, safe result hash and timing. Only `found_exact` with matching
identity/request/remote Task records the original invocation receipt and enters the existing one-Binding
materialization and stored LangGraph continuation path. `not_found`, `conflict`, `unavailable` and
`deferred` remain fail-closed.

The Frozen HTTP response-loss regression starts the Provider operation once, loses the first response,
repeats the exact idempotency identity through the reconciliation port and recovers the same Task. No
fallback dispatch is available on that port. PostgreSQL uniqueness and append-only triggers reject a
second Binding/execution link or conflicting attempt history.
