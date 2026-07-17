# ADR-106: Promote the Merged V1.1/V1.2 Migration Range into the Released Chain

## Status

Accepted on 2026-07-17.

## Context

The `0100` migration range was originally protected by a disposable-database profile while V1.1 was
not yet merged into `main`. V1.1 is now an ancestor of `origin/main`, and V1.2 Phase 7 added the
exact-version Skill Usage authority in `0105`. Phase 10 runtime integration necessarily reads that
authority through the existing Skill repository. Keeping the production `released` profile at `0064`
therefore produces a schema/runtime contradiction: the normal Server entry point cannot read or run
the merged model.

## Decision

- The default `released` migration profile now applies the single monotonic chain through `0105`:
  complete V1.0.13 through `0064`, then `0100` through `0105` in filename order.
- Existing installations at `0064` upgrade additively. Installations already at a complete `0100+`
  ledger are accepted and remain idempotent.
- Any gap inside `0100..0105` still fails closed before a later migration is applied.
- The `v1.1-isolated` profile, acknowledgement flag and `sdar_v11_*` database-name guard remain for
  disposable compatibility tests; they are no longer the only way to apply merged migrations.
- Rollback guards and the existing PostgreSQL authority remain unchanged. No second schema, Registry,
  Runtime or startup path is introduced.

## Consequences

The production Server entry point, full smoke gate, V1.1 Remote Task repositories and V1.2 Skill
Usage repositories share one schema chain. Migration verification now proves released empty/`0064`
upgrade, idempotence, rollback/reapply, isolated-profile protection and ledger-gap rejection.

## Rejected Alternatives

- Make repositories tolerate a missing `0105` column: hides an invalid deployment and disables native
  Skill Usage at runtime.
- Apply only `0105`: violates the ordered migration ledger and skips required V1.1 authorities.
- Add a second V1.2 database or server entry point: breaks the modular-monolith and single-runtime
  invariants.
