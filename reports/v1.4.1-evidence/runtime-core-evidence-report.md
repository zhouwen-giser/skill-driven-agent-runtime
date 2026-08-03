# Runtime Core Evidence Report

## Result

Phase 5 implements and verifies all 18 Runtime-family record types. The real vertical is
`request -> goal contract -> confirmed Plan -> action -> receipt -> verification -> achieved
outcome -> draft manifest`.

The PostgreSQL fixture creates actual Task, Goal, Contract, old/new Plan, Goal Patch, Skill
Goal/Attempt/Execution, Workflow, Control round, readiness gate, confirmation, MCP invocation,
completed effect, outcome decision and terminal outcome rows. It projects 19 instances across 18
types because both the superseded and replacement Plan are retained.

## Semantic closure

- Goal and Plan versions are explicit; Goal Patch preserves invalidated Plan identity.
- Action carries persisted execution mode/semantics; Receipt separates transport, executor and
  business. Executor success leaves business `not_asserted` until Verification and Outcome exist.
- Action references the exact Plan Step and a stable `skill.execution` ID. Parent/child plans use
  persisted Provider ID plus Operation metadata to correlate one execution; a single Plan execution
  is the bounded fallback. Zero or multiple exact candidates create a blocking Quality Issue.
- Run Seal records Task, Goal, Control and Workflow status separately and verifies terminal
  consistency. Workflow `succeeded` does not independently claim Goal `achieved`.
- Missing facts/references become blocking Quality Issues; the mapper never uses prompts or timing
  guesses. Draft manifests remain `projecting` until Phase 10.

## Runtime path and authority

`PostgresRuntimeCoreEvidenceSource` reads a repeatable-read, read-only snapshot. The Server scans a
bounded set of terminal Tasks missing either Run Seal or its corresponding manifest and invokes
`RuntimeCoreEvidenceProjector`; a crash between those writes is therefore replayable.
`PostgresEvidenceStore` owns idempotent append, checkpoint, issue and manifest writes. Redis and the
receiver own none of these facts.

## Verification

- format, lint and typecheck: passed.
- architecture: passed across 658 TypeScript source files.
- Evidence contract: passed for 100 records and registry hash
  `sha256:b425727078045bd8e710660bd73277993e2c98bfcbd143430f88aee31ddb5b27`.
- Focused Unit: 3/3 passed.
- Real PostgreSQL Integration: 1/1 passed on isolated port 55541. Every envelope validates against
  its schema; IDs, hashes, references and sequences are asserted; replay is idempotent.

## Failed attempts and repairs

1. `pnpm exec` could not resolve local tools on Windows; package scripts and repository-local
   `.cmd` binaries were used.
2. Early PostgreSQL fixtures violated real Skill/Workflow identity checks; complete authoritative
   rows were added instead of weakening constraints.
3. A stale MCP invocation survived partial cleanup because it lacks a Task foreign key; explicit
   isolated-test cleanup was added.
4. Direct Ajv use violated the adapter boundary; validation now uses the official adapter.
5. The first review found a missing required `skill.execution` reference (Major); stable identity
   and blocking missing/ambiguous-source handling closed it.
6. One rerun used the wrong PostgreSQL password and the phase gate found three strict lint errors.
   The repository test credential was used; the assertion and value narrowing were repaired.
7. The final review found a post-Run-Seal/pre-manifest crash window (Major). Pending selection now
   also checks the corresponding manifest; real PostgreSQL deletion/replay proves self-recovery
   without duplicate Evidence.

## Independent read-only review

- Blocking: none.
- Major: none after two findings were closed and rerun.
- Minor: none.
- Accepted: durable post-terminal projection is used for existing authorities; transaction paths
  are not retrofitted. PostgreSQL remains authority, gaps fail visibly, and final sealing is Phase 10.
