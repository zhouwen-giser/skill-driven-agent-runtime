# ADR-068: Automated Modular Boundary Enforcement

## Status

Accepted on 2026-07-13.

## Context

ADR-001, ADR-002, ADR-005, and ADR-007 define the single LangGraph runtime, protocol adapters, storage roles, and modular monolith. Import checks originally covered package source but did not inspect the production Server composition root or reject the accidental addition of a second agent/workflow runtime dependency.

## Decision

- Domain and Application depend only on internal models and ports.
- A2A SDK, MCP SDK, and LangGraph imports remain confined to their named adapter/runtime packages.
- PostgreSQL, BullMQ, and Ajv imports remain confined to infrastructure adapters. The Server composition root may instantiate PostgreSQL and inject repositories, but may not expose driver types to Application or Domain.
- The architecture gate scans package source and the Server composition root.
- The dependency manifest must contain LangGraph.js and must not contain a known alternative agent/workflow runtime.
- Adapter substitutability is demonstrated through injected unit/contract fakes; production adapter behavior remains covered by its integration/contract suite.

## Consequences

Boundary drift fails `pnpm verify:architecture` before build or deployment. Adding another runtime requires a superseding ADR and an explicit change to the guard; it cannot happen as an incidental dependency addition.
