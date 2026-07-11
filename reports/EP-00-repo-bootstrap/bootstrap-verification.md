# EP-00 Bootstrap Verification

Date: 2026-07-11 18:44 +08:00

## Result

The strict TypeScript workspace, three compatibility Spikes, digest-pinned Compose infrastructure and SBOM/license evidence are executable and reproducible. `pnpm peers check`, `pnpm verify:bootstrap` and `pnpm smoke:infra` pass. EP-00 is complete; the external A2A 1.0.1 TCK moves to EP-01 after its complete lifecycle SUT exists.

## Reproducible evidence

- `pnpm install --frozen-lockfile`: passed with only the reviewed `esbuild` build script allowed.
- `pnpm peers check`: passed with no peer dependency issues.
- `pnpm verify:bootstrap`: passed format check, ESLint, strict TypeScript typecheck, 16 tests in 4 files, source pin check, Compose contract, SBOM/license freshness and production TypeScript build.
- A2A contract: real loopback REST/streaming endpoint using official `@a2a-js/sdk@1.0.0-beta.0`; verifies discovery, submit/get, standard Task states, protocol-version rejection, standard stream events, and task continuation/polling after stream disconnect.
- MCP contract: real loopback HTTP server/client using official `@modelcontextprotocol/sdk@1.29.0`; verifies Tool discovery, invocation, original input Schema rejection and remote AbortSignal cancellation.
- LangGraph unit: real in-process `StateGraph` execution using `@langchain/langgraph@1.4.7`; verifies conditional routing and a bounded loop.
- Infrastructure contract: Compose parses with digest-pinned pgvector/PostgreSQL and Redis services, health checks, pgvector bootstrap migration and rollback notes.
- Supply-chain evidence: 10 source pins, CycloneDX SBOM, 266 installed npm package licenses, 2 external services and third-party notices pass freshness checks.
- `pnpm smoke:infra`: real digest-pinned containers passed pgvector 0.8.4 discovery, migration marker, vector distance operation, Redis PING and Redis write/read; services were stopped with volumes retained.

## Classification

- Real: A2A REST/streaming loopback; MCP Streamable HTTP and cancellation loopback; LangGraph StateGraph execution; dependency/peer/build/SBOM gates.
- Simulated/static: immutable image manifest and Compose structure validation.
- Unverified/outside EP-00 completion: BullMQ restart behavior and external A2A 1.0.1 TCK, both assigned to their owning later EPs.

## Resolved environment blocker

Earlier attempts to start the service and Docker Desktop failed with named-pipe access denial. In the resumed environment Docker Desktop 4.81.0 / Engine 29.6.1 was available, and the unchanged `pnpm smoke:infra` command passed without weakening its checks.
