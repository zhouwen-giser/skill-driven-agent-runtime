# v1.0.8 Bug-fixed Review

Date: 2026-07-16

## Findings and fixes

- TypeScript `readonly` did not prevent a caller from mutating constraint/criterion arrays while an async decision was pending. The Goal domain now copies and freezes the complete contract at each selection/planning boundary before its first `await`.
- Management Skill selection accepted arbitrary content for an already registered Goal. Selection and Workflow planning now require an exact active registered Goal and return stable 400 errors before any embedding/model call; standalone unregistered contracts remain supported.
- Goal Patch checked only source Goal ID/version. It now compares all six fields with the active Goal before patch deliberation, so stale source content cannot influence a new version or invalidate authority.
- Admin revision now explicitly snapshots its source contract, matching model planning and Temporary Skill behavior.

## Review outcome

The complete Goal Contract is both type-readonly and runtime immutable at decision boundaries. Registered authority, patch sources, confirmation inheritance and execution cannot cross terminal, version or same-version content changes.

Feature commit/tag: `f6501a9` / `v1.0.8`.

Bug-fixed commit/tag: reconciled after publication / `v1.0.8-bug-fixed`.
