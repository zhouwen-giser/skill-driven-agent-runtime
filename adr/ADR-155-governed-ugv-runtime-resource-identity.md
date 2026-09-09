# ADR-155: Governed UGV resource identity throughout execution

Status: Accepted, user-requested interoperability correction, 2026-09-09.

## Context

ADR-154 corrected published Capability identity but the historical point-navigation profile still
hard-coded vehicle:ugv1 / isr.vehicle.ugv.ugv1 in input adaptation, operation selection, Skill Usage,
terminal validation and simulation qualification. GOWM device ugv:ugv and SMPP bind vehicle:ugv /
isr.vehicle.ugv.ugv. A benchmark request obeying the public contract was rejected internally.

## Decision

Remove deployment-specific device constants from production Runtime and Domain. The natural-language
bridge obtains the exact resource const from the current Exposure request schema. Structured admission
uses the hash-validated Task Capability snapshot and its single exact resource_policy; callers cannot
substitute a different device. The deterministic input adapter requires an explicit expected identity.

Provider selection uses the authoritative current Binding and Runtime Catalog, retaining exact Source
lineage, Provider type/version, catalog hashes, operation contracts and bounded vehicle identifiers.
Input and output resource consts, selected navigation arguments and final-state read must agree.
The immutable selected-operation domain model validates these identity relationships and hashes.
The persistence adapter port receives the selected resource explicitly; SDK types do not cross it.

Skill Usage, simulation target policy, qualification receipts and terminal checks carry the same frozen
identity. Qualification without a Task resolves one exact compatible current Provider/resource and
fails on ambiguity. It does not accept arbitrary caller-selected Tool arguments. Legacy ugv1 fixtures
remain supported when their formal contracts authorize them. No database migration, GOWM/SMPP binding
change, new execution runtime, confirmation bypass or weapon permission is introduced.

## Validation

Regressions include current sz-gowm tool schemas captured read-only after governance initialization,
both vehicle identities, wrong-device rejection before availability, natural-language admission,
Skill Usage, terminal projection and qualification. Complete gate and deployment evidence are recorded
in reports/resource-identity-20260909 and EP-UGV-RESOURCE-IDENTITY. Read-only site checks do not establish
that a real movement benchmark has completed.
