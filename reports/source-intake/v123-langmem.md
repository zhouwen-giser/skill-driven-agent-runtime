# OSS Intake: LangMem / typed extraction behavior

- Official repository: `langchain-ai/langmem`
- Package/module: knowledge extraction and reflection
- Exact tag/commit/version: `a2d580946465137c89162e67dc0b18108bd4850c`
- License and NOTICE: MIT, `LICENSE` blob `c38f6f284dc464af69e9f618bc0304d299d0bdf0`; no root NOTICE
- Requested use: clean-room design/schema/test reference; no copied code in G00
- Files or APIs inspected: task-package locked extraction, reflection, graph and prompt-layer paths
- Capability needed: typed independent extractors and bounded consolidation
- Why current authoritative components cannot provide it: v1.2.2 has no generic Experience Observation pipeline
- Boundary/adapter: TypeScript/Zod or JSON Schema, SDAR Model Runtime, PostgreSQL
- Maintenance and upgrade plan: exact commit only; a copied implementation requires a new intake
- Security/quality findings: LangChain Python/Store cannot become a second runtime or authority
- License obligations: preserve MIT notice if later copied material is approved
- Decision and ADR: behavior reference only; ADR-112
