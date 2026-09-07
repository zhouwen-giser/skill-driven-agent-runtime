# NFR-COMP-001 A2A 1.0.1 Compatibility Evidence

## Outcome

The V1 A2A HTTP+JSON adapter is verified against the A2A 1.0.1 specification baseline. Patch version 1.0.1 is the normative source version; its wire and Agent Card interface version is `1.0`.

## Reproducible baseline

| Component | Exact baseline | Evidence |
| --- | --- | --- |
| Specification | `v1.0.1` / `3303592588e388e62e0f69f701af531d2f4e3991` | `third_party/a2a-1.0.1-baseline.json` |
| Official JavaScript SDK | `@a2a-js/sdk@1.0.0-beta.0` / `a005d2a118d3c1552ce6ea86b2917f2a9f56fea9` | exact package and source-lock pins; beta status is explicit |
| Official TCK | `5996b79f9cefa6fc390980e383e358a66fb9e49e` | frozen `uv` environment and copied JSON/JUnit/HTML reports |
| V1 transport scope | HTTP+JSON / MUST | no claim for JSON-RPC, gRPC, push notification, or undeclared capabilities |

`pnpm verify:a2a-baseline` validates all pins, adapter constants, the copied compatibility report, and JUnit summary. Its current output records 235 collected cases: 74 passed, 161 skipped, 0 failed, 0 errors, and 100.0% applicable MUST compatibility. Skips are chiefly non-configured transports and unsupported optional capabilities, not hidden passes.

## Specification-delta contracts

The pinned TCK embeds a 1.0.0 snapshot, so repository contracts close the literal 1.0.1 evidence gap:

- `application/a2a+json` request/response preservation is exercised through the production HTTP endpoint;
- legacy `application/json` request/response compatibility keeps the pinned HTTP+JSON TCK valid;
- the Agent Card and version validator use wire version `1.0`, never patch `1.0.1`;
- standard TaskStatus values, input-required lifecycle, streaming, structured media-type errors, and task history are exercised by contracts and the TCK.

## Commands and results

- `pnpm exec vitest run --project contract packages/a2a-adapter/test/http-endpoint.contract.test.ts packages/a2a-adapter/test/a2a-compatibility.contract.test.ts`
- `pnpm test:a2a-tck`
- `pnpm verify:a2a-baseline`
- `pnpm verify`

All four commands passed on 2026-07-13. The unified gate ran 54 unit/contract files with 227 tests, architecture/OpenAPI/source/Compose-static/SBOM checks, strict typecheck, and production Server/Console builds.

## Evidence classification

The loopback HTTP contracts and official TCK execution are real local protocol verification. The TCK SUT is a deterministic test harness, not the PostgreSQL/Redis production composition. The official 1.0 SDK is beta, and the TCK is not literally tagged to specification 1.0.1; those limitations are explicit and are compensated within the V1 scope by exact pins and direct patch-delta contracts. No all-transport or stable-SDK claim is made.
