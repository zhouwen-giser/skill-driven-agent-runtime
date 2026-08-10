# Phase 4 Completion

- Phase: 4
- Goal: Evidence Export configuration, service and HTTP transport
- Base SHA: `ffb49321db145e6c7572983755075540bf74bb40`
- Contract: sole external `sdar.evidence/v1`; legacy Telemetry routes/header/payload removed
- Runtime path: PostgreSQL lease -> pending bounded prefix -> canonical hash -> HTTP send -> exact
  sent ownership -> explicit contiguous/partial ACK -> completed/degraded status
- Security: required families always enabled; Diagnostic-only exclusion; CredentialRef-only;
  HTTPS or verified loopback HTTP; redirects/user-info rejected; bounded request, response, timeout
- Authority: PostgreSQL owns run/delivery/ACK/DLQ/LKG state; Redis is wake-only; sink is recipient
- Focused tests: 21 Unit, 71 Contract, 11 real PostgreSQL and one real vertical acceptance passed
- Full verify: passed in 601,088 ms; 1,207 static Unit/Contract, 158 Integration, 72 E2E, 37
  migrations, architecture, build and all smokes
- Source closure: 100/100 source-confirmed; formal projector coverage remains 0/100 until Phases 5-10
- Failed/repaired: missing failure-state upsert; stale generated manifest hash; sandbox Docker-config
  access. Root causes, repairs and reruns are preserved in `evidence-export-protocol-report.md`.
- Blockers: none to Phase 4 completion
- Next phase: project Runtime core evidence

## Independent read-only review

- Blocking: none.
- Major: none.
- Minor: none.
- Accepted: the old external Telemetry symbols and routes are absent; remaining mentions are the
  frozen historical Node Event/internal Control key, immutable migrations, catalog source names or
  negative compatibility assertions. Exact sent ownership and in-batch contiguous ACK are enforced;
  required families cannot be configured away; transport limits and endpoint security fail closed;
  and neither Redis nor the receiver owns Evidence state.
