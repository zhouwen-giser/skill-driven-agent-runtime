# P11 Completion Report

## Goal

Implement bounded output-only Telemetry Export control and durable Runtime delivery without adding
a telemetry query authority or allowing endpoint availability to affect Task execution.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `d978e8ef5d72ee4b7fd464aa3caac4fb367d00bc`
- primaryImplementationSha: `a53b4fbd185e3d9c59f13857e9dac317be5f6f4f`
- implementationSha: `7f631fd674352f72633994a2b47875e2856a9922`
- evidenceSha: `PENDING_EVIDENCE_COMMIT`

## Implementation

- Added strict TelemetryExportConfiguration/Status domain contracts, secret-reference validation,
  bounded batch/retry/outbox policies and HTTP(S) endpoint validation.
- Added the six frozen public routes and authenticated internal Runtime apply/status routes. Public
  commands reuse P02 Configuration Revision, idempotency, ETag, desired/observed Ack, Operation and
  Audit authorities.
- Added Runtime Active/LKG, collector state and durable outbox migration `0142`, exact ACK handling,
  bounded exponential retry, remaining-capacity high-watermark enforcement and local delivery
  status. Redis is not authoritative.
- Added an HTTPS-first, redirect-denying transport whose credential resolver accepts only `env:`
  references and never returns secret material through an API, status or audit record.
- Added a nonblocking Server drain loop. Endpoint/probe/delivery failure is reduced to a safe error
  code and cannot fail, cancel or retry a Task.
- Added real Control -> Runtime -> `runtime_event` -> HTTP endpoint -> durable ACK evidence and an
  outage continuation proving both Tasks remain completed while pending delivery is retained.

## Acceptance

| P11 criterion | Result | Evidence |
|---|---|---|
| Export-only API, no query authority | passed | frozen contract gate and forbidden-route contract test |
| Apply/Ack/LKG and auditable local status | passed | real dual-database vertical, migration `0142`, status assertions |
| Endpoint outage does not stop Runtime | passed | real endpoint shutdown with two completed Task rows and retained pending record |
| SecretRef/TLS/redirect safety | passed | Domain/transport unit and contract coverage; secret-free Operation/Audit/status |
| Retry/retention/high watermark | passed | PostgreSQL failure, exact ACK and near-capacity regression tests |
| Active revision isolation | passed | newer Draft remains unapplied during the public connection test |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 2 files, 5 tests |
| focused Contract | passed | 2 files, 5 P11 route/auth scenarios within 219 total contract tests |
| focused real PostgreSQL/HTTP Integration | passed | 2 files, 3 tests |
| formatting/lint/typecheck/architecture | passed | strict TypeScript; 639 TypeScript source files |
| migration verification | passed | 35 additive Runtime migrations through `0142`; rollback/reapply and checksum drift protection |
| `pnpm verify` | passed in 414,357 ms | 934 Unit + 22 performance, 219 Contract, 146 Integration, 72 E2E; build and all smokes |

The accepted exact-commit report is `reports/verification/summary.json` for
`93a901eb6e6b7eb3bef895895bf5c68e4d5936a9`, with SHA-256
`7a7de517d065ceaa22dc1fe448e155985b1f16693fbf76846a4f28eceb802430` and
`dirty=false`.

## Real / simulated / unverified

PostgreSQL migrations, Control/Runtime HTTP, real Runtime facts, local HTTP ingestion, ACK,
retention, outage isolation, Docker migration containers and process smokes are real local
evidence. The ingestion platform is a local deterministic HTTP server; no external telemetry SaaS
was contacted. Multi-node delivery and production capacity are outside the single-node Goal and are
not claimed.

## Review and failed attempts

The independent read-only Review closed 2 Major findings; final verdict is 0 Blocking, 0 Major and
0 Minor. All retained failures, causes and reruns are recorded in
`failed-attempts/p11-telemetry-export.md`.

## Handoff

P11 is `COMPLETED` locally. P12 may implement organization-facing Node Profile and Node Events. It
must reuse the existing single event stream and must not add telemetry query, evaluation or
reconciliation behavior.
