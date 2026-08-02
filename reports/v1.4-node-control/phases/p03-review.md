# P03 Independent Read-only Review

Review scope: P03 implementation `21c7a376b0f6d6a6b5181d2da84b75973fbbedb7`, frozen Provider and
Model Route contracts, P02 Apply/Ack boundary, Control/Runtime authority matrix, migrations, focused
tests and full verification evidence. Each review pass was read-only; fixes were made afterward in
the main implementation phase and the affected tests were rerun.

## Blocking

None.

## Major

None open. Three Major findings were closed before acceptance:

- Exact Provider/Route Runtime apply was not idempotent across the apply-before-Ack crash window.
  Closed with exact configuration/revision/checksum replay checks before work and again under a
  target advisory lock; conflicting and inactive replays fail closed.
- Model transport audit accepted an arbitrary upstream `code`. Closed by mapping failures to stable
  timeout, rate-limited, unavailable or upstream-error categories and persisting a generic message.
- Runtime Apply Ack accepted secret-shaped uppercase error codes. Closed with an explicit safe-code
  allowlist and a regression using secret-bearing thrown message and code.

## Minor

None.

## Accepted

- Control owns only secret-reference Provider definitions, Model Catalog and scoped desired Route
  revisions. Runtime owns encrypted credential resolution, clients, live selection, invocation and
  fallback execution; Telemetry remains historical evidence only.
- Provider reconnect and Route new-task-only apply modes reuse the P02 Revision/Apply/Ack protocol.
  Runtime Ack alone activates the Control projection, and replay cannot duplicate the exact applied
  target.
- Route selection honors case, task and stage specificity. A Task/model-stage binding pins the exact
  Route checksum and exact Provider configuration revisions, so later Provider/Route revisions affect
  only new Tasks.
- Structured output and embedding capability checks, unavailable-candidate rejection, scope
  conflict, bounded attempts, timeout and fallback policy are implemented and tested against real
  PostgreSQL authorities.
- APIs, acknowledgements and model invocation audits return no credential material. The repository
  secret scan reports zero findings across current files and Git history.

Verdict: 0 Blocking, 0 Major, 0 Minor; P03 is acceptable for evidence publication.
