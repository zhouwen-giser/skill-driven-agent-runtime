# OSS Intake: Agent Workflow Memory / Task Type induction behavior

- Official repository: `zorazrw/agent-workflow-memory`
- Package/module: offline/online induction and dataset shapes
- Exact tag/commit/version: `8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1`
- License and NOTICE: Apache-2.0, `LICENSE` blob `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`; no root NOTICE
- Requested use: research/design and dataset-shape reference only
- Files or APIs inspected: locked Mind2Web/WebArena induction paths listed by the task package
- Capability needed: deterministic grouping before naming and abstract pattern plus exemplars
- Why current authoritative components cannot provide it: v1.2.2 has no Task Type knowledge target
- Boundary/adapter: SDAR Domain types, PostgreSQL candidates and no-side-effect replay
- Maintenance and upgrade plan: exact commit only; no research runtime in production
- Security/quality findings: plaintext workflows cannot become executable or authoritative plans
- License obligations: Apache attribution/modification notices if later code is ported
- Decision and ADR: design reference only; ADR-112
