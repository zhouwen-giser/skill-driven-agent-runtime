# v1.0.4 Bug-fixed Review

Date: 2026-07-15

## Findings and fixes

- Simulation case IDs originate in validated model data and become part of the stable Header identity. Non-live identities now reject whitespace, control/non-ASCII characters and values longer than 256 characters at the domain boundary.
- Legacy encrypted credential data could contain multiple case variants of reserved Headers even though new management writes reject them. Runtime sanitization is now explicitly regression-tested to remove every variant before canonical values are written last.
- Failure audit needed the same context evidence as success. A simulated transport failure now has direct regression evidence for mode/ID persistence without credential leakage.
- Paused Workflow resume and repeated calls under one stable ID now have explicit propagation and real official-SDK session-reuse evidence.

## Review outcome

- Live execution omits both reserved Headers.
- Simulation and historical replay send exact canonical Header values and persist matching audit fields.
- Subworkflows and child Skills inherit the immutable parent context.
- MCP Servers remain responsible for recognizing non-live metadata and preventing incompatible side effects.
- Feature tag: `v1.0.4` / `82a90ab`.
- Bug-fixed commit/tag: reconciled after publication.

No known correctness defect blocks v1.0.5 after publication.
