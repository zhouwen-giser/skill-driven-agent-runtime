# SDAR v1.4 Single-Node Control Backend

## Summary

Adds the independently deployable, headless single-node Control API/worker and the frozen Runtime
Control boundary while preserving the existing single LangGraph Runtime and PostgreSQL authorities.

## Frozen Inputs

- Frozen Node Control bundle: 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures.
- Frozen design/API source locks and task package remain byte-verified under `docs/` and `protocol/`.

## Baseline

- Initial latest-main SHA: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- Latest synchronized main SHA: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- Verified code candidate SHA: `e6d0b698fb0430386edba66474f8214f9f4bd740`

## Delivered

P00-P14 deliver separate Control persistence and migrations; desired/observed apply/Ack/LKG; LLM,
SMPP and MCP governance; Capability definitions/readiness; A2A Exposure and Active/LKG Card;
immutable Task Capability bindings; Skill/Plan Template governance adapters; output-only Telemetry
Export; organization-safe Node Profile/Event views; and release/security/recovery qualification.

## Authority Boundaries

Control PostgreSQL owns Control definitions, desired/observed state, public Operation/Audit and event
delivery. Runtime PostgreSQL owns Tasks/execution, runtime readiness, bindings, Agent Card Active/LKG
and telemetry delivery. Redis/BullMQ is wake/scheduling only. No second workflow engine exists.

## P00-P14 Commit Inventory

Principal implementation anchors: `c8ec915`, `bf56489`, `deaa555`, `21c7a37`, `11d13d0`,
`f409911`, `f5be34f`, `be9d01d`, `c76a4d0`, `39298c3`, `9e53ebb`, `7f631fd`, `7eb5b83`,
`ee64870`, `47fb8c3`, and P14 recovery candidate `e6d0b69`. All fix/test/evidence commits remain in
history; the complete table is in the release report.

## Migrations

107 Runtime up migrations through `0143_v14_node_event_projection` and 8 independent Control up
migrations through `0008_organization_node_events`; fresh create, upgrade, rollback/reapply,
checksum and interruption guards pass.

## API and Protocol

The frozen MANIFEST hash is
`a06a13c60c31a3b914462b4a16d62a2f652217c6f5df7adf640d73b98bb4d7fc`; Node Control OpenAPI,
Runtime Control OpenAPI, Node Events AsyncAPI and Telemetry Export hashes are recorded in
`reports/v1.4-node-control/release/release-report.md`.

## Validation

- Clean exact `pnpm verify`: passed on `e6d0b69`, `dirty=false`, 581,785 ms.
- 938 Unit + 22 performance, 220 Contract, 149 Integration and 72 E2E.
- A2A HTTP/JSON MUST TCK: 74 passed, 161 skipped, 100% applicable compatibility.
- Architecture: 644 TypeScript sources; P14 review: 0 Blocking / 0 Major / 0 Minor.

## Recovery and Security

Zero secret findings; 0 Critical/High production advisories; role/tenant denial, ingress/egress
limits, SecretRefs, credential rotation/revocation, real Control dump/restore, API restart and
Runtime-after-Control-stop pass.

## Explicit Non-Goals

- no formal console frontend
- no hierarchical organization control plane
- no telemetry query or ClickHouse proxy
- no global supervision or interaction platform
- no production deployment, HA, SLO, capacity, RTO or RPO claim

## Failed Attempts

The stale SBOM, Docker sandbox denial, clean-worktree Console 404/order dependency and offline
tarball miss are retained in `reports/v1.4-node-control/failed-attempts/p14-release-qualification.md`.

## Known Limitations

See `reports/v1.4-node-control/release/known-limitations.md`. One Moderate dependency advisory is
tracked below the High/Critical release threshold; the affected serve-static export is not imported
by the composed Runtime.

## Rollback

See `reports/v1.4-node-control/release/rollback.md`; preserve both PostgreSQL authorities and Runtime
LKG, and never delete or restore over unknown data.

## Merge Evidence

PR #15 is non-draft and targets `main` from `feature/v1.4-node-control-backend`; live GitHub state is
`MERGEABLE/CLEAN` with no checks, reviews or review threads. The active main ruleset requires PR use
and resolved threads, requires zero approvals, permits Merge Commit and has no bypass actors. Final
merge SHA and ancestry will be verified after the Merge Commit. No force push, tag, GitHub Release
or deployment is authorized.
