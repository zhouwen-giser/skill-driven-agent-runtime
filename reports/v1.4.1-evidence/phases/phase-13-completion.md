# Phase 13 Completion

- Phase: 13
- Goal: adversarial, security, performance and architecture hardening
- Base SHA: `0868821`
- Adversarial findings closed: 25/25
- Focused verification: 87 Unit / 11 Contract / 17 PostgreSQL Integration / 1 real E2E performance
- Runtime PostgreSQL: `127.0.0.1:55484`
- Control PostgreSQL: `127.0.0.1:55484`
- Redis: `127.0.0.1:56384`
- Registry: 100 total / 95 Required / 5 diagnostic / 100 durable projection
- Registry hash: `sha256:eac67fcc0cd02c55da750156af42f3ea2130ee470f0670aba980c08ddec41c71`
- Contract hash: `sha256:23ac6191b4f8334d5eb404ba545ed3ee7ebd2c877ccc3c7236bd3f1f80390c9b`
- Full verify: passed in Phase 14 (`reports/verification/summary.json`)
- Blockers: none in the implementation evidence; independent Review recorded below

## Adversarial closure matrix

| # | Attack or semantic defect | Closure evidence | Result |
| -: | --- | --- | --- |
| 1 | Business layer calls Telemetry directly | canonical append remains PostgreSQL-only; endpoint-outage Unit proves the receiver is outside business execution | Passed |
| 2 | Runtime Event summary is the only output | 100-record Catalog and Phase 12 44-scenario report prove typed Runtime, Skill, MCP, Capability, Experience, Artifact, Control and Evidence output | Passed |
| 3 | Mutable source without revision | Domain rejects missing revision; PostgreSQL rejects cursor regression | Passed |
| 4 | Random record identity | stable ID derives only from source/schema identity; concurrent duplicate append is idempotent | Passed |
| 5 | Non-deterministic hash | canonical key ordering and same-byte ArtifactRef SHA tests pass | Passed |
| 6 | NULL uniqueness gap | source identity columns are non-null and same-ID/different-hash persistence fails closed | Passed |
| 7 | Cross-tenant reference/read | privileged projector reads reject Organization/tenant principals; PostgreSQL append rejects explicit cross-tenant or cross-user Evidence references | Passed |
| 8 | Secret/Credential leakage | canonicalizer rejects inline secret fields; Control projection proves CredentialRef is absent from serialized Evidence | Passed |
| 9 | Chain-of-Thought leakage | `private_reasoning` and forbidden reasoning-shaped fields fail closed | Passed |
| 10 | Oversized payload | canonical JSON and ArtifactRef byte/URI limits fail closed | Passed |
| 11 | Cyclic JSON | cyclic, sparse and non-finite canonical JSON fail closed | Passed |
| 12 | Symlink or Artifact escape | encoded traversal, unknown tables/versions and non-authoritative Artifact URIs are rejected | Passed |
| 13 | ACK out of range or regression | exact sent-boundary, monotonic partial ACK and invalid ACK tests pass | Passed |
| 14 | Retry storm | retry is bounded by policy and a partition reaches durable DLQ after the configured attempt limit | Passed |
| 15 | Dead Letter loss | rejected and exhausted delivery rows retain immutable DLQ authority and requeue semantics | Passed |
| 16 | Cursor jump | independent checkpoint regression and poison-partition isolation tests pass | Passed |
| 17 | Restart duplicate or omission | a new PostgreSQL store instance resumes committed rows without Redis authority | Passed |
| 18 | Control revision regression | aggregate revision regression fails closed | Passed |
| 19 | Node Event conflicts with full-state GET | reused Runtime Event identity does not advance the Control cursor; Phase 12 reconnect/recovery passed | Passed |
| 20 | Required Family disabled | export configuration rejects Required-family exclusion | Passed |
| 21 | Supporting/Diagnostic data becomes a hard gate | Manifest completion counts Required stages only; degraded quality remains distinct from incomplete | Passed |
| 22 | Manifest completes early | Required projection failure persists and prevents early complete; complete requires acknowledged Required evidence | Passed |
| 23 | Remote Task completed directly marks Goal achieved | external waiting does not evaluate Goal; independent five-component quality aggregation remains authoritative | Passed |
| 24 | degraded becomes full success | all four Skill failure policies preserve degraded evidence and reject empty degraded claims | Passed |
| 25 | Replay causes physical side effects | replay reads frozen snapshots, requires replay-aware downstream context and rejects non-replay mode/queue substitution | Passed |

## Performance result

The authoritative result is `reports/v1.4.1-evidence/phase-13-performance.json`.

| Gate | Measurement | Threshold | Result |
| --- | ---: | ---: | --- |
| Critical Runtime balanced A/B/A P95 | baseline 805.957 ms; enabled 880.984 ms; regression 9.309% | <= 10% | Passed |
| Baseline stability | first median 546.711 ms; last median 634.236 ms; drift 14.823% | <= 15% | Passed |
| Evidence append P95 | 15.576 ms over 100 samples | <= 20 ms | Passed |
| Required write network dependency | canonical append used local PostgreSQL only; HTTP receiver was drained asynchronously | none | Passed |
| Bounded batch/projector | export every second handles at most eight idle partitions with 16 records each, or one busy partition with one record; projection every two seconds uses eight idle or one busy round, with foreground work deferred for at most ten seconds | bounded and live | Passed |
| Sink outage / High Watermark | existing focused tests preserve Task authority and isolate Evidence degradation | no Task block | Passed |

The local benchmark used a real A2A -> Runtime -> PostgreSQL/Redis business path and real local HTTP
Evidence delivery plus PostgreSQL ACK. Model/Skill behavior was deterministic test-fixture behavior,
and no physical device was invoked. The balanced rotating ABA/BAA/AAB order distributes enabled
samples across each timing position, uses the combined 40-sample baseline P95 and enforces a
separate first/last baseline median drift gate without changing the ten-percent P95 requirement.

## First failures and repairs

- The initial measurement mixed projection/export catch-up with the enabled sample and failed at
  12.355% Runtime regression and 31.812 ms append P95.
- After separating catch-up, a 32-round/32-partition background burst still failed at 17.43%.
- Eight slices reduced it to 11.551%; four slices alone did not solve timer overlap.
- The production scheduler now defers background Evidence projection/delivery while a computational
  Task is active or inside a 500 ms terminal grace period, then resumes from PostgreSQL cursors.
- Sequential A->B measurements exposed large baseline drift; fixed ABA interleaving then resonated
  with the one/two-second background timers. The final unchanged thresholds use the balanced
  rotating ABA/BAA/AAB order, passed the 15% stability gate at 14.823%, and passed the Runtime
  regression gate at 9.309%.
- The first Contract run exposed a stale common Episode Manifest schema. The generator now includes
  revision, policy version, source snapshot hash and recomputation time; the same file passed 11/11.
- A parallel PostgreSQL command shared one database and mixed Runtime/Control defaults. The direct
  attack-surface files were rerun serially against explicit disposable Runtime and Control databases:
  7/7 persistence, 4/4 export/DLQ and 5/5 Control isolation/revision tests passed.
- The first independent Review rejected the unstable A-B-A average, an unbounded foreground gate,
  missing cross-tenant reference enforcement and one merged checklist row. Production now grants
  foreground priority while guaranteeing one background slice every ten seconds, PostgreSQL
  validates explicit tenant/user scope on every resolved Evidence reference, and the 25-row matrix
  matches the frozen list one-to-one.

Raw performance failures remain in `reports/v1.4.1-evidence/failed-attempts/13-performance-attempt-*.json`.

## Independent read-only review

The first Review found one Blocking, two Major and one Minor finding: unstable baseline averaging,
unbounded foreground deferral, missing cross-tenant reference enforcement and a non-one-to-one
checklist. After the narrow production and evidence repairs, the final independent read-only Review
found:

- Blocking: none.
- Major: none.
- Minor: none.
- Accepted: bounded ten-second fairness, direct cross-scope rejection, stable balanced
  performance evidence, exact 25-row frozen mapping and unchanged contractual thresholds.

Phase 13 is closed. Phase 14 may run the single final repository-wide gate, freeze outputs and
prepare the PR; no merge, tag, release or deployment is authorized.
