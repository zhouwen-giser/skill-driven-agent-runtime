# OSS Intake: Gemini CLI / Auto Memory behavior

- Official repository: `google-gemini/gemini-cli`
- Package/module: Auto Memory and memory patch utilities
- Exact tag/commit/version: `c776c665b00a39d55c470beb788a2b9a77a2feb7`
- License and NOTICE: Apache-2.0, `LICENSE` blob `7a4a3ea2424c09fbe48d455aed1eaa94d9124835`; no root NOTICE
- Requested use: design reference in G00; no copied or translated code
- Files or APIs inspected: task-package locked paths under `packages/cli`, `packages/core` and `evals`
- Capability needed: bounded eligibility, candidate lifecycle, background failure isolation and patch safety
- Why current authoritative components cannot provide it: v1.2.2 has no cognitive Experience candidate pipeline
- Boundary/adapter: SDAR Domain/Application Ports; PostgreSQL authority; existing Model Runtime only
- Maintenance and upgrade plan: never track moving main; any direct TypeScript port requires a new intake and behavior tests
- Security/quality findings: upstream filesystem and CLI state cannot become SDAR authority
- License obligations: preserve Apache-2.0 attribution/modification notices if a later port is approved
- Decision and ADR: design reference only in G00; ADR-112
