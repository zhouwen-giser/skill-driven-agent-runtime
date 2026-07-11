---
name: sdar-acceptance-auditor
description: Use for release readiness, final Goal completion, or auditing whether the Skill-Driven Agent Runtime actually satisfies the requirement baseline.
---

Audit independently from implementation claims.

1. Read original SRS, Definition of Done and Traceability Matrix.
2. Re-run `pnpm verify` from a clean environment.
3. Run all AC scenarios with real PostgreSQL/Redis and Mock MCP/Model services.
4. Inspect Agent Card, A2A streaming, plan confirmation, Goal Patch, Skill call, memory, evaluation, evolution and console data.
5. Check license pins, SBOM, notices, migration path and risk warnings.
6. Classify each result as real, simulated or unverified.
7. Do not approve completion while any requirement lacks evidence.
