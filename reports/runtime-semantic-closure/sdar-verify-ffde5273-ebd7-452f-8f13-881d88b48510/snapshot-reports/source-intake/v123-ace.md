# OSS Intake: ACE / Reflector and Curator behavior

- Official repository: `ace-agent/ace`
- Package/module: Generator, Reflector, Curator and delta operations
- Exact tag/commit/version: `bcb7cea0504afad6f55fec4845dd4864c9f9eee7`
- License and NOTICE: Apache-2.0, `LICENSE.txt` blob `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`; no root NOTICE
- Requested use: design/operation-schema/evaluation reference only
- Files or APIs inspected: task-package locked ACE core and playbook paths
- Capability needed: role separation, helpful/harmful evidence and candidate deltas
- Why current authoritative components cannot provide it: v1.2.2 has no generic candidate knowledge curator
- Boundary/adapter: structured candidate deltas validated by SDAR Application code and stored in PostgreSQL
- Maintenance and upgrade plan: exact commit; no Python/model client reuse
- Security/quality findings: reasoning traces and free-text playbooks cannot be stored as authority or directly applied
- License obligations: Apache attribution/modification notices if later code is ported
- Decision and ADR: behavior reference only; ADR-112
