# Server composition / planning authority evidence

The [acceptance report](FINAL_CLOSEOUT.md) records the scoped implementation, actual source identities, complete gates, restricted-role GOWM evidence and limitations. [Case results](CASE_RESULTS.json) link every local acceptance group to executed tests and original log hashes.

- [M1](M1_VALIDATION.json): server composition and lifecycle.
- [M2](M2_VALIDATION.json): UGV/SMPP isolation and generic ports.
- [M3](M3_VALIDATION.json): immutable generation and formal submission.
- [M4](M4_VALIDATION.json): fresh frozen-lockfile acceptance.
- [GOWM](GOWM_VALIDATION.json): same frozen local inputs, real restricted SQL roles.
- [Frozen source identity](M4_SOURCE_IDENTITY.json) and [baseline compatibility](BASELINE_COMPATIBILITY.json).
- [Preserved failures](FAILED_ATTEMPTS.md), [failed-run records](failed-attempts.json), [actual environment](verification-environment.json).

Raw logs are archived with their validation and SHA-256 records. Site, physical provider operations and deployment are NOT_RUN. Project-level upstream gaps remain outside this completed local validation scope. Git publication status is recorded separately after CI and merge.
