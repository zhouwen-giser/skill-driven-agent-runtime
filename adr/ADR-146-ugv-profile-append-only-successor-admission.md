# ADR-146: UGV Profile Append-only Successor Admission

## Status

Accepted on 2026-09-01 for the UGV Profile governance repair. This decision extends ADR-138 and
ADR-139 without changing their confirmation, execution or terminal-success boundaries.

## Context

The UGV Profile admitted only the historical `embodied.move@2` Capability and
`a2a.embodied.move@2` Exposure. A newly discovered localhost Provider generation was therefore
unable to use the formally created append-only successors `embodied.move@4` and
`a2a.embodied.move@3`, even though their immutable contracts could be checked against the current
Binding and Runtime Catalog. Overriding the Capability, rewriting an old version or treating a
draft as ready would violate the PostgreSQL governance authority.

## Decision

- The exact public Skill remains `embodied.move_to@1`. No alias or newer Skill version is inferred.
- UGV Capability versions are admitted by immutable content, not by a fixed version number. Version
  2 remains compatible; a later version must name its immediately preceding append-only version.
- The dependency policy accepts only a fully published Capability whose frozen Skill, package,
  Binding, Catalog, schemas, usage policy and safety constraints match one of the reviewed UGV
  execution-mode contracts. A live contract must not carry simulation identity and must preserve
  replay-forbidden Provider semantics.
- The natural-language admission surface resolves the current Exposure from the active PostgreSQL
  Agent Card. It does not select the highest draft row and does not accept a caller-supplied version.
- Draft/unpublished Capability or Exposure successors remain unavailable. Provider health and
  southbound availability remain independent execution gates; this change does not authorize a
  Task, confirmation, Tool call or physical side effect.
- No new workflow runtime, database, migration, fallback authority or in-memory current pointer is
  introduced.

## Consequences

An operator may publish a reviewed append-only UGV successor and rebuild the managed Agent Card
without changing product code for each version. Existing Tasks and historical versions remain
immutable. Until `embodied.move@4` and `a2a.embodied.move@3` are formally published and the real
southbound transport is ready, the current deployment remains non-executable and continues to
advertise only its previously active Exposure.

## Evidence

Implementation and focused regression evidence are recorded in
`execplans/ugv-agent-profile-simulation.md` and `docs/17_TRACEABILITY_MATRIX.md`.
