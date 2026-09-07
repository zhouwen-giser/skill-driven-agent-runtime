# Real Provider Interop Attempt Ledger

Failed attempts are retained because the release policy forbids hiding them.

1. Adapter startup used a repository-relative proto path and failed from the isolated candidate cwd;
   the adapter now resolves the candidate path explicitly.
2. Readiness probed `/readyz`; the Provider candidate publishes `/health/ready`.
3. Management registration initially bypassed the subscription coordinator; product registration now
   starts the same coordinator used by runtime composition.
4. A test driver reused a stale Ack high-water mark and observed a normal event before continuity; the
   driver now evaluates the current generation boundary.
5. HTTP 409 JSON-RPC Reset was collapsed to a generic HTTP error; the client now preserves the frozen
   Provider reason code.
6. A long-lived reconnecting stream never became healthy because health changed only after stream end;
   the coordinator now becomes healthy after a durable Ack. The retained JSON from this attempt is in
   commit `325b8d0` history.
7. Final-candidate invocation used native `node` for TypeScript and exited before Provider startup with
   module resolution failure; corrected to the repository `tsx` runner.
8. Final-candidate infrastructure used the wrong password for the isolated local database; Provider
   correctly failed before migration/protocol work. `real-provider-interop-failure.json` retains this
   failure.

The next run, with the same exact code/Provider commits and corrected disposable infrastructure,
passed the complete matrix in `real-provider-interop.json`. None of the failed attempts modified the
Provider repository.

