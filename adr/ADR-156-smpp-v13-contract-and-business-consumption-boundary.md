# ADR-156: Consume the pinned SMPP v1.3 business contract

Status: Accepted (explicit local upgrade task, 2026-10-10).

## Context

The local clean main did not contain PR34. W0 verified PR34 is open/draft at
52f54a11a40380f7c73bd9da277d640e49bdfbf7 and created a local branch from that exact head.
All twenty existing commits are preserved; no cherry-pick, reset, push, merge or deployment occurred.

## Decision

Pin SMPP 0a4a7c36865d4c9920a4e65857c0903e9ef12533, Frozen MCP 2026-07-28,
TaskBusiness 1.0-rc2 and BusinessEvents 1.0. Retain the public JSON Schemas and catalog
unmodified with their license and content identities under contracts/smpp-task-business/v1.3.
Reuse the existing Frozen client, Registry, immutable RemoteTaskBinding, Input service,
governed-control confirmation store, event inbox and PostgreSQL/GOWM adapters.

Domain owns normalized business identity, references, quality and command facts. No upstream
SDK types enter core models. Business synchronization does not schedule graphs or dispatch tools.
Remote plan revision changes never mutate the SDAR Workflow. Recovery only reads and reconciles
the original admitted task; running workflow process loss remains governed by existing ADRs.

Provider reception time requires field-level provenance from the pinned implementation.
Context updatedAt, event providerRecordedAt and Artifact updatedAt must not be assigned to
every trajectory sample. Missing public per-sample clocks and missing deviceReportedAt are
explicit gaps. Provider summaries and sampled geometry are not complete device history.

W0 also repairs PR34's direct Ajv import, which violates the existing architecture checker,
by using the existing JSON Schema adapter. Original validation behavior is preserved and
date-time formats receive the existing validator's checks. No architecture rule is relaxed.

## Verification and limits

Pinned contract tests validate positive assets and negative wire/time examples. Original
adapter/Registry regression passed 102 tests before this increment. Each of the four milestones
requires the repository full isolated gate; ADR-150's separate earlier development scope does
not waive this task's gates. Site reads/writes remain NOT_RUN without selected-target authorization.
Public Input cancellation closes the prompt and is independent of Task cancellation.
Fire, independent lock, Provider configuration and upstream private tables are excluded.
