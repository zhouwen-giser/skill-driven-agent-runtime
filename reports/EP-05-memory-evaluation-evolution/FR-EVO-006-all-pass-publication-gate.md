# FR-EVO-006 verification report

Date: 2026-07-12

## Outcome

Verified. Automatic publication is controlled by one all-pass decision over induction consistency/stability/generalizability and every static, source, historical replay, normal, boundary, and exception case. Any failure persists the complete candidate as `validation_failed` without registering a SkillVersion or changing the current enabled version.

## Reproducible evidence

- Unit proves a failed boundary simulation persists the failed report, never calls the formal registry, and leaves the modeled current version at v1.
- PostgreSQL integration round-trips a `validation_failed` candidate and its failed per-case report independently of the formal registry.
- Real local E2E first publishes an all-pass evolution from existing Skill v1 to v2. A second candidate with a distinct Experience fingerprint then receives one deliberately mismatched normal simulation: the MCP Tool succeeds while the expected outcome is failure. The candidate remains `validation_failed`, exposes the failed case, has no published Skill identity, and the formal version history remains exactly `[1, 2]`.
- The management response and dynamic Agent Card continue to resolve only formal enabled Skill versions.

## Verification classification

- Real: PostgreSQL candidate and Skill version authority, local MCP call, management HTTP result, no-current-version-change assertion.
- Simulated: deterministic local model supplies the deliberate expected-outcome mismatch.
- Unverified: behavior of arbitrary external side-effecting Tools; simulations require isolated safe endpoints under ADR-046/ADR-050.
