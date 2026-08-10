# Phase 8 PostgreSQL Failure and Rerun Evidence

Phase 8 implementation includes a real PostgreSQL vertical in
`runtime-core-evidence.integration.test.ts`. It seeds constrained P03 Experience/Pattern facts,
P04/P02 Artifact facts, immutable Replay Dataset/Case/Run/Result/Counterexample facts and projects
all 22 Experience, Replay and Artifact record types. Initial environment and implementation
failures are retained below. The first implementation later failed independent Review, so its
passing mapper test is historical evidence only; the source-centric remediation and current reruns
are recorded separately.

## Attempt 1

Command:

```powershell
node_modules\.bin\vitest.cmd run packages/runtime-control-persistence-postgres/test/runtime-core-evidence.integration.test.ts --project integration
```

Result: suite setup failed before any test ran with `password authentication failed for user
"sdar"`. Port `55432` belongs to the unrelated `smpp-continuation-postgres` instance documented in
the baseline; it is not a valid SDAR v1.4.1 test authority and was not modified.

## Attempt 2

Command:

```powershell
$env:SDAR_TEST_POSTGRES_URL='postgresql://sdar:sdar_local_only@127.0.0.1:55484/sdar_v141_phase8'
node_modules\.bin\vitest.cmd run packages/runtime-control-persistence-postgres/test/runtime-core-evidence.integration.test.ts --project integration
```

Result: suite setup failed before any test ran with `ECONNREFUSED 127.0.0.1:55484`. The isolated
Compose service used by the baseline is no longer running.

## Docker access

Sandboxed `docker compose ps` cannot open `//./pipe/docker_engine`. The authorized escalated call
was rejected by the Codex platform usage limit before Docker executed. No workaround, unrelated
container stop, credential guessing, database reset or evidence fabrication was attempted.

## Attempt 3

On 2026-08-09 Docker Desktop was restarted and isolated project
`sdar-v141-phase8-20260809` became healthy on PostgreSQL `55484` and Redis `56384`. A fresh
`sdar_v141_phase8` database was created from `template0`. The focused test ran four cases: three
passed and the Phase 8 case failed with `Experience Evidence source trace_id missing`.

Root cause: `to_jsonb(trace)` resolved the table's `trace` JSON column rather than the intended row
alias. Renaming the row alias to `trace_row` restored the authoritative identity. The integration
test now asserts `trace_id` and `source_episode_id` immediately after source loading.

## Attempt 4

The database was recreated from `template0` and the same focused command reran. Three cases passed;
Phase 8 failed with `Experience Evidence source validation_run_id missing`.

Root cause: the Validation query had the same row-alias/column ambiguity. All source queries now
use explicit `*_row` aliases, and the integration test asserts Artifact, Validation Run and Replay
Case Result primary identities before projection.

## Initial implementation rerun (subsequently rejected)

The database was recreated again from `template0`; migrations, constrained source seeding and all
four focused tests passed:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
Duration    15.32s
```

No unrelated container was modified. The isolated PostgreSQL/Redis Compose project remains
available for the later full gates.

## Initial static gate rerun (subsequently rejected)

The post-fix full Unit gate initially reported 972/973 because the source-isolation Unit assertion
accepted only the old `episode.task_id` spelling after production SQL had deliberately renamed the
row alias to `episode_row`. The assertion now accepts only the two explicit row aliases while still
requiring exact `task_id=$1` and rejecting every Goal Revision join. The complete Unit rerun passes
973/973 plus 22/22 performance tests. Contract 230/230, Evidence Contract 100/100, Architecture
671 sources and production build also pass.

## Independent Review rejection

The first independent read-only Review rejected that implementation with two Blocking and eight
Major findings. In particular, its Task checkpoint could permanently suppress late P03/P04 facts;
shared Pattern, Replay and Artifact authorities were assigned through Task slices; required
reconstruction fields and references were lost; ArtifactRef and Replay-safety claims were not
verifiable; and delivery/scope metadata contradicted the real write path. The 74/100 coverage and
Phase 8 completion claims were withdrawn before remediation.

## Source-centric remediation PostgreSQL reruns

The repaired projector uses 10 source-owned partitions and opaque aggregate revisions. The real
P03→P04→P02→P05→Evidence vertical initially blocked because heterogeneous Artifact lineage refs
were all interpreted as WorkflowPattern refs. The authority rows proved a unique
Generalized→Fused→Workflow chain; the mapper now follows that exact chain while retaining the full
heterogeneous lineage payload. The isolated PostgreSQL/Redis vertical then passed 3/3, including a
late normalization fact whose source timestamp predates the checkpoint.

The supplemental legal V1.2 mapper regression exposed several production-only mismatches rather
than hiding them in fixtures: missing authoritative interaction correction IDs, stale generated
delivery guarantees, exact Artifact-version lookup, unresolved Workflow/Fused/Generalized lineage,
and structured required-policy objects copied into a string-ref schema. Production now derives the
exact correction IDs, stores exact match version, normalizes `policyId@version`, and resolves exact
lineage. The final isolated PostgreSQL rerun passed 4/4 with 36 schema-valid records, restart
idempotency and late-interaction rescan.

## Contract and full-gate attempts

The first full Contract preflight failed because its positive sample generator emitted a flat
string for the new nested `concurrencyGroups` array and still constructed Catalog records with the
withdrawn `transactional` guarantee. The helper now recursively samples the generated schema and
uses `durable_projection`; focused 3/3 and full Contract 234/234 passed. A concurrent Frozen MCP
notification assertion failed once in the combined run but passed 7/7 alone and on the full rerun,
so no production change was made for that timing-only observation.

The first full `pnpm verify` attempt passed format, lint, typecheck, 1,008 Unit plus 22 performance,
234 Contract, 677-source Architecture, protocol/acceptance/license/build checks and all 38
migrations, then failed before Integration because unrelated infrastructure already owned default
port `55432`. No unrelated container was stopped. The second attempt selected an isolated Compose
project on `55485/56385`; it exposed a non-hermetic Server environment test that had not cleared the
operator's Redis port before asserting local defaults. The test now saves, clears and restores the
four environment keys it owns and passes 8/8 under the isolated port.

Fresh Review subsequently identified three Major items: per-source projection failures required
durable isolation/backoff so poison sources could not starve healthy sources; generated Phase 8
schemas required exact enum/positive-version rejection; and a legal Pattern with more than 256
children required a lossless externalization path. Its Minor test-cleanup finding was also repaired.

## Exact-schema red test and generated-schema rerun

The first negative Contract run proved the old generated schemas incorrectly accepted unknown
closed-domain enum values and version `0`. This was a valid red test, not a flaky failure. The
Domain generator was changed to require explicit schemas for every required Phase 8 payload field,
closed enums and positive versions. It also normalized cross-record provenance to structured
`CognitiveSourceRef` values.

The next real PostgreSQL Runtime Core run passed four of five cases. Its Phase 8 case loaded the
new source shapes but validated them against stale generated record schemas. The generator was run
after source/schema coordination completed; the identical PostgreSQL suite then passed 5/5. The
focused Phase 8 Contract passes 9/9. The complete Evidence Contract passes 100/100, split as 95
Required plus five diagnostic, under registry hash
`sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d` and
contract hash `sha256:a1ffebfde0902dab632c16a8ffdad781926198a9bf69ed3722b52da1206dfd86`.

During parallel source/schema integration, one intermediate typecheck saw an exact-optional
property mismatch while one side of the coordinated edit was visible without the other. The schema
owner completed the conditional property construction and the focused typecheck rerun passed. This
is retained as a concurrent intermediate failure, not represented as evidence for the final tree.

## Poison isolation and 10,000-element Pattern closure

The shared pipeline now catches each Runtime, Skill, MCP/Capability and Phase 8 source item
independently. A poison item persists a stable required/blocking Projection Issue, uses restart-safe
backoff and cannot starve healthy work; repairing the source replays it and resolves the exact
issue. Source queries select the latest revision per source identity. The real PostgreSQL Runtime
Core/Phase 8 integration passes 5/5.

The Pattern producer stores an immutable canonical definition and publishes an exact
`patternDefinitionArtifactRef`. Collections larger than 256 use descriptors containing the fixed
allowlisted URI, JSON pointer, count and full-array SHA-256. A real 10,000-element producer/resolver
PostgreSQL regression passes 1/1 and proves lossless reconstruction without truncation or empty
substitution.

## Final Review and Phase 8 closure

The final independent read-only Review reports Blocking 0, Major 0 and Minor 0 and declares
`CLEAN_FOR_PHASE8_CLOSURE`. All known Review findings are closed. Generated coverage is 74/100
verified and 74/95 Required (77.89%).

Two later best-effort full `pnpm verify` attempts are retained as failed attempts, not completion
evidence. In the first, the Architecture allowlist rejected the new producer/resolver path; the
allowlist was repaired. The run then used the wrong isolated Redis port `56385` and timed out. In
the second attempt the correct Redis port `56379` allowed the combined Integration group to run.
The other 32 files / 165 tests passed; the only failure was a Node Control test with a startup race
and migration setup that was not independent. After repairing those two defects, that exact file
passed 1/1.

Latest targeted format, lint and typecheck checks pass. Prettier wrote the touched files before the
targeted checks, so this report does not claim a whole-repository format check. It also does not
claim either full `pnpm verify` attempt succeeded.

Task-package section 30 requires complete `pnpm verify` only at Phases 0, 3, 7, 9, 12, 13 and 14.
Phase 8 therefore closes from its focused Contract/PostgreSQL evidence, generated 74/100 coverage
and clean independent Review. Status: `COMPLETED`.
