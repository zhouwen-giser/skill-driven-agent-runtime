# Preserved failed verification attempts

These failures are evidence, not acceptance passes. The full run/inputs/cleanup records, stage exit codes and hash-checked raw logs are retained in [failed-attempts.json](failed-attempts.json) and `attempts/`. Every full-gate failure below cleaned up its owned resources with exit code 0; its runtime inputs and baseline remained unchanged. No numerical test limit or behavioral assertion was removed to obtain a pass.

| Run suffix | Stage and observed failure | Resolution / follow-up evidence |
| --- | --- | --- |
| M1 `7a85074a` | Artifact P06 contract still inspected the old composition file location. | Move the source-path assertion to `composition/http.ts`, retaining both behavioral assertions. M1 full gate rerun. |
| M1 `f98ab0a9` | E2E observed `TASK_PROJECTION_CHANGED_DURING_READ`. | Preserve the failure; rerun the identical assertion on the independent frozen milestone source. No product retry added. |
| M1 `cb6189ba` | Performance baseline drift 26.55%, above the existing 15% limit. | Diagnose host I/O variance and independently rerun. Original threshold retained. |
| M1 `ab03019d` | Serial rerun still showed performance baseline drift 26.56%. | Pre-refactor source also fails on this host; use the repository's accepted real tmpfs PostgreSQL performance-fixture practice, separately from persistent-store gates. |
| M2 `8a7208ca` | New architecture script had an ESLint `console` global error. | Explicit Node console import; architecture fixtures unchanged. |
| M2 `37a9b8ab` | Official A2A TCK could not create a virtual environment because system Python lacked `ensurepip`. | Use the installed bundled Python runtime in PATH; no Python dependency or product code change. |
| M2 `bb47ef7e` | Shared Docker build tag replacement made a captured image unavailable. | Serialize the complete milestone gates; immutable failed inputs retained. |
| M3 `e6aa47e2` | Two new test callbacks violated lint's arrow-body rule. | Correct callback syntax without changing assertions. |
| M3 `83a73cc8` | Cognitive replay command produced no output before the existing 60-second timeout and received SIGTERM. | The same command on that frozen source passes when rerun alone; preserve the timeout and run subsequent complete gates serially. The precise environmental cause is not established. |

Additional diagnostic failures remain separate from full-gate acceptance:

- CPU-affinity performance isolation failed (28.44% drift, 73.82% P95 regression). See [focused/performance-affinity.json](focused/performance-affinity.json) and the hash-checked raw runner log. Affinity is not a product or final verification setting.
- The previously accepted pre-refactor frozen source failed the unchanged performance case on the current host (24.25% drift, 15.48% P95 regression). See [focused/performance-pre-refactor.json](focused/performance-pre-refactor.json). This supports an environment diagnosis; it does not substitute for post-change acceptance.
- Early GOWM diagnostic `5cf70f61` ran its formal and native cases successfully but the overall driver failed `OWNED_GOWM_BASELINE_CHANGED` because repository evidence documents were edited during the run. Its complete result stays `FAIL` in `attempts/GOWM-5cf70f61-b4c3-4c60-addc-cbe8c81be20e/`. Final acceptance must use the unchanged final frozen source and baseline.
- The source-identity audit helper initially exceeded Node's default stdout buffer, then treated Git-escaped Chinese documentation paths as extra runtime files. Its rejected result is retained as `attempts/source-enumeration-escaped-paths.json`. NUL-delimited Git enumeration with an adequate buffer corrects the helper; actual runtime file hashes were equal throughout. This is an evidence-collection error, not a product or gate failure.

The final owned performance fixture uses real PostgreSQL with the original 72/72 runtime samples, 100 append samples, and 15% drift / 10% P95 / 20 ms append limits. Only that benchmark's database directory is tmpfs. Functional, integration, migration, recovery and smoke tests retain the existing persistent-store infrastructure. Resolved Compose hash, immutable image IDs, database version, ownership and cleanup are recorded with the run. Site/device actions and deployment are `NOT_RUN` throughout.
