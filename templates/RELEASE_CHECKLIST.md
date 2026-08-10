# Release Checklist

## v1.4.1 Canonical Evidence release addendum

- [x] Contract, 100-record Catalog, schemas, hashes, Matrix and policies are frozen.
- [x] Required Source Coverage is 95/95 with no Required deferred item.
- [x] Phase 12 vertical acceptance is 44/44 and Phase 13 adversarial Review is clean.
- [x] ClickHouse handoff is adapter-only and contains no DDL/query/authority implementation.
- [x] Final exact-tree `pnpm verify` passes; `14-final-acceptance.{md,json}` is published with the final publication commit.
- [ ] Current branch is committed and pushed; PR is Ready for Review.
- [ ] Merge, tag, release and deploy remain unperformed.

- [x] Clean checkout installs successfully. Evidence: `reports/EP-07-hardening-acceptance/V1-CLEAN-CHECKOUT.{md,json}`.
- [x] Database migrations pass from empty and prior baseline. Evidence: `reports/EP-07-hardening-acceptance/V1-MIGRATION-PATH.{md,json}`.
- [x] `pnpm verify` passes. Evidence: `reports/verification/summary.{md,json}`.
- [x] All AC reports pass. Evidence: `reports/EP-07-hardening-acceptance/V1-ACCEPTANCE-AUDIT.{md,json}`.
- [x] Traceability Matrix has no gaps. Evidence: all rows are `已验证`; `pnpm verify:acceptance` passes.
- [x] Docker/local start and smoke test pass. Evidence: `V1-LOCAL-DEMO`, full verification, infra and Server/Console smoke reports.
- [x] Project `LICENSE`/`NOTICE`, SBOM, dependency licenses and THIRD_PARTY_NOTICES complete. Evidence: Apache-2.0 project metadata, 17 source pins, 284 portable current-lockfile npm packages (host-specific optional binaries are covered by their wrappers), two external services, `verify:project-license` and `verify:licenses` pass.
- [x] No secret or production endpoint in repository. Evidence: `V1-RELEASE-POSTURE.{md,json}`.
- [x] Risk warnings and limitations visible. Evidence: README, security/operations docs, health, Console and HTTP contracts.
- [x] A2A and Management listeners bind to loopback or an explicitly reviewed trusted interface; public ingress is blocked. Evidence: environment unit tests and NFR-SEC-001 report.
- [x] Any non-loopback bind sets `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE=true` only after documenting firewall/network isolation; this acknowledgement does not add authentication. Evidence: ADR-012 and operations/security docs.
- [x] PostgreSQL and Redis have no public route or published public port. Evidence: loopback-only Compose publishing, static guard and real smoke.
- [x] Documentation and CHANGELOG current. Evidence: README, docs index set, CONTRIBUTING, operations guide, DoD and this checklist.

## v1.1 MCP Tasks RC addendum

- [x] Phase 6 functional vertical is complete: confirmed plan, availability/risk guard, LangGraph, remote MCP Task, polling/control, durable continuation, result/evaluation and A2A projection.
- [x] AC-MCPT-01–16 machine/human reports pass and distinguish real local infrastructure/transport evidence from deterministic Provider/model simulation.
- [x] `pnpm demo:acceptance` passes build, 10 Provider contract, 402 unit, 80 real integration and 49 real E2E tests.
- [x] Clean self-managed Compose `pnpm verify` passes at `13194b8` in 162.0 seconds with 75 files/493 unit+contract, 80 integration, 49 E2E, 232-source architecture, 110-operation OpenAPI, 68 migration pairs and both smoke stages.
- [x] Migration 0104 persists `node_waiting_external` and its guarded rollback rejects lossy removal of existing external-wait evidence.
- [x] Restart evidence deletes ephemeral queues, reconciles only PostgreSQL-proven external waits without replaying `tools/call`, and preserves `PROCESS_EXECUTION_LOST` for ordinary running work.
- [x] Test helpers importing PostgreSQL, BullMQ or A2A SDK dependencies reside in their owning `test-support` boundary; the architecture gate is not weakened.
- [x] Phase 6 Conventional Commit exists and the release worktree is clean.
- [x] Exact commit `38356ea` passes isolated `pnpm install --frozen-lockfile`, `pnpm verify` and `pnpm demo:local`.
- [x] Annotated `v1.1.0-rc.1` points to `38356ea` locally and remotely and was pushed without force or branch-protection bypass.
- [x] Ready PR #4 targets protected `main`, is `MERGEABLE`, and GitHub currently reports no configured status-check runs; review/merge remains a separate protected action.

The RC checklist is complete. Do not create or announce stable `v1.1.0` until PR #4 is reviewed and merged through branch protection.

## v1.2 Skill usage final addendum

- [x] Package metadata, CHANGELOG, architecture/domain/DSL/API, ADR index, DoD, traceability, known
      gaps, operations and release documentation describe v1.2 exact-version usage.
- [x] Phase 1–14 reports and trace rows are verified; Phase 14 has zero open required findings.
- [x] Formal move-to and recursive area-patrol acceptance cover all required modes, Provider states,
      composition/failure semantics, remote waits, input, cancel, restart, hard gates and evidence trees.
- [x] Real local versus simulated versus externally unverified evidence is explicitly classified;
      external production Provider interoperability is a limitation, not claimed evidence.
- [x] Every explicit Phase 15 command and the final clean `pnpm verify` pass on `b3b6e67`.
- [x] `15-final-acceptance.{md,json}` records no required deferred item and is committed and pushed.
- [x] PR #5 is updated and marked Ready for Review; merge remains a separate protected action.
