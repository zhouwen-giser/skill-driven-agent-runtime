---
name: sdar-implementation-gate
description: Use after implementing a feature or before marking an ExecPlan milestone complete. Run the evidence gate and update traceability.
---

- Identify all requirement IDs affected.
- Run format, lint, typecheck and the smallest relevant tests.
- Run contract/e2e tests when protocol or cross-module behavior changed.
- Confirm no skipped tests, weakened assertions, placeholder data, dynamic code, leaked secrets or new `any` debt.
- Update `docs/17_TRACEABILITY_MATRIX.md`, the active ExecPlan, `PROJECT_STATUS.md`, ADRs and CHANGELOG.
- A requirement is not complete without implementation path, test path, command and result evidence.
