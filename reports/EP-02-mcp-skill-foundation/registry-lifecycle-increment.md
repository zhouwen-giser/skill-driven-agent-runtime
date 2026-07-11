# EP-02 Registry Lifecycle Increment Evidence

Date: 2026-07-11

## Real verification

- Management e2e performs MCP remote health against the official SDK loopback server, persists reachable status, rotates/re-encrypts the registration credential through HTTP, and deletes the Server.
- Management e2e lists Skill versions, obtains a field diff, rolls version 1 back as version 3 linked to version 2, and observes the capability return to Agent Card.

## Simulated verification

- Application unit tests use a protocol-neutral fake transport to prove changed credential headers are pinged before persistence and failed health persists `unreachable` without Tool rediscovery.
- Different-credential live e2e is not claimed because the current official SDK loopback fixture accepts one initialized server session; same-value rotation exercises real encryption/persistence and session teardown.

## Remaining

Management operation audit, LLM generation, Skill graph/search/selection, temporary Skills, and Console remain open.

## Full regression gate

Architecture verification passed across 52 source files. `pnpm verify:ep01` passed format, lint, strict typecheck, unit 31, real integration 9, contract 17, real e2e 6, production build, dual-endpoint built smoke, and the pinned A2A TCK harness with 67 selected MUST tests passed. No tests were skipped or weakened in the repository Vitest projects; the known upstream diagnostic distinction remains documented separately.
