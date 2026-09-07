# Skill Evidence Report

## Result

Phase 6 implements and verifies all 16 Skill-family record types. Total formal projector coverage
is 34/100. The real vertical is `selection -> context -> exact usage snapshot -> parent/child
composition -> Capability Slot -> procedure/compliance -> execution references -> failure`.

## Semantic closure

- Candidate applicability uses the persisted `usageCandidate.applicability.status`; selection and
  context references are correlated by exact Skill/Goal version and execution selection identity.
- `skill.execution` reuses the immutable revision function consumed by Phase 5 Runtime Action, so
  a future reference and emitted record have the same stable ID.
- Usage Evidence contains both the exact Skill Version Usage Specification hash/snapshot and the
  separate persisted execution-policy hash/snapshot. Native and Legacy sources are preserved as
  declared data; no old Telemetry compatibility path exists.
- Parent/child composition is reconstructable. Capability Slot resolution requires the declared
  slot, unique Task Capability Binding version and exact Capability Definition Evidence.
- Procedure compilation and plan compliance are scoped to the same Skill Execution. Both pass and
  failure are visible.
- Provider, Resource, Remote Task, Evidence, Hard Gate, Human Intervention and Outcome references
  are retained. Waiting/resume and degraded missing Effect/Evidence facts are not collapsed.
- Unsupported-mode, recursion/cycle, optional, recoverable, fail-fast and degraded failures remain
  explicit failure codes/policies. Missing authority creates a blocking Quality Issue and no
  guessed derived record.

## Runtime path and authority

`PostgresSkillEvidenceSource` reads a repeatable-read, read-only snapshot after the Runtime Core
checkpoint exists. `SkillEvidenceProjector` writes canonical records and the `skill/v1` checkpoint
through `PostgresEvidenceStore`. Server composition invokes Runtime then Skill in a bounded timer.
Runtime PostgreSQL remains Skill authority; Control PostgreSQL remains Capability Definition
authority; Redis owns neither.

## Verification

- Format, full lint and typecheck: passed.
- Architecture: passed across 661 TypeScript source files.
- Evidence contract: passed for all 100 records with registry hash
  `sha256:b425727078045bd8e710660bd73277993e2c98bfcbd143430f88aee31ddb5b27`.
- Focused Unit: 10/10 across Runtime identity and Skill projection suites.
- Real PostgreSQL Integration: 2/2, including the Phase 5 Runtime vertical and the Phase 6
  parent/child Skill vertical on isolated port 55541.
- Integration asserts all 16 types, exact Capability ID/version, seven reference kinds,
  pass/fail compliance, waiting/resume, Native/Legacy source preservation, zero Quality Issues,
  stable hashes and idempotent replay.

## Failed attempts and repairs

1. A one-second runner timeout terminated an otherwise valid focused command; commands were rerun
   with normal timeouts.
2. PostgreSQL rejected `ORDER BY value` in a `DISTINCT` JSON query; the snapshot now uses `EXISTS`
   with real source columns.
3. PostgreSQL timestamp JSON used `+00:00`; the mapper now normalizes valid timestamps to canonical
   RFC 3339 `Z` form.
4. The `version` table alias collided with the `version` column and serialized scalars. A distinct
   row alias restored full Skill Version objects.
5. Review found Plan-only Action correlation ambiguous for parent/child Skills, invented
   `unresolved` values, and Capability ID without version. Exact Provider/Operation correlation,
   fail-closed derived records and Task Binding version correlation closed all three.
6. Independent Review found that a blocking cross-family gap could be checkpointed without later
   retry. Unresolved blocking Skill issues now keep the Task pending; successful reprojection
   resolves obsolete issues, and reappearance reopens the same stable issue ID.

## Independent read-only review

- Blocking: none.
- Major: none after the exact identity, no-invention, Capability-version and issue-recovery findings
  were repaired and all focused gates rerun.
- Minor: none.
- Accepted: all sixteen Skill records have authoritative sources, stable identity/hash semantics,
  exact references, visible failure boundaries and durable idempotent projection.
