# SDAR v1.2.1 Phase 12 Adversarial Hardening and Release Gate

Status: **HARDENING COMPLETE; RELEASE BLOCKED**

All 26 required adversarial classes have owning-layer evidence. The audit covers explicit Legacy/Frozen
isolation, missing/spoofed metadata and discovery, baseline/routing mismatches, Bridge aliases, Task result
shape and task-behavior conflicts, TTL/revision/terminal monotonicity, subscription authorization/Ack/order/
overflow, MRTR reuse, cooperative cancellation, Poll/Notification convergence, Evidence A injection and
pointer/URI bounds, output-schema enforcement, hard-gate isolation and immutable Provider protocol mode.
The Phase 11 real chain independently demonstrated that the same-revision content guard rejects a real
Provider split-brain projection rather than accepting it for compatibility.

Package metadata is upgraded from 1.2.0 to 1.2.1. The full SBOM records version 1.2.1 with 290 components.
The source-pin gate remains 20/20,
project licensing passes, static Compose/migration inventory reports 71 migrations, architecture covers
285 TypeScript sources, Management OpenAPI covers 122 operations, and acceptance maps remain 18/18 plus
Legacy MCP Tasks 16/16.

## Verification boundary

The frozen dependency tree was restored with `pnpm install --frozen-lockfile`; no lockfile change or manual
package-link workaround was used. The Windows security fixture now uses a directory junction on Windows and
a file symlink elsewhere, so it continues to prove fail-closed link rejection without requiring Developer
Mode. The Frozen migration verifier now owns Compose in the default self-managed mode while still requiring
an explicit `TEST_DATABASE_URL` in operator-managed mode. Two calendar-sensitive Mock Provider defects were
also fixed: restart acceptance no longer receives an unintended terminal Notification, and Task TTL plus
restricted Availability windows derive from Provider startup time instead of an expired fixed date.

The mandatory final `pnpm verify` first passed all seven steps in self-managed Compose mode on the working
tree, then passed again from clean exact commit `f7bdd7b2b8e51fe11868e153fd38099699d8cae8` in 212,915 ms:
format/lint/strict typecheck, 648/648 unit+contract tests, 285-source architecture, protocol/source/license/
SBOM/OpenAPI/acceptance checks, production build, the complete migration chain, 84/84 real PostgreSQL/Redis
integration tests, 60/60 E2E tests, infrastructure smoke and Server/Console smoke. The generated verification
report records `dirty=false`. The evidence-only follow-up commit does not change the tested implementation.

## Release decision

G2 (SDAR local component conformance) and the complete local command matrix pass. G3 is invalidated for
cross-implementation purposes by the four Provider wire defects in the Phase 11 report. Therefore G4
Interop Certified and G5 Release Ready remain blocked by real interoperability. PR #6 must remain Draft.
There is no tag, Ready
transition or release claim, and no required deferred item has been hidden.

Required next actions are: fix and merge the external Provider projection defects; rerun the complete real
interop matrix against its new exact commit; publish the resulting evidence-only update and only afterward
reconsider Ready for Review. The isolated Phase 9 Compose project and temporary external archive were
removed on 2026-07-22.
