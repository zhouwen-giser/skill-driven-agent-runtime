# OSS Intake: LangGraph.js

- Official repository: `https://github.com/langchain-ai/langgraphjs`
- Package/module: `@langchain/langgraph` plus required peer `@langchain/core`
- Exact tag/commit/version: npm `@langchain/langgraph@1.4.7` integrity `sha512-2tcyf3QGC7v89kqSxMCtRvzg/3L/4yHtOaWC49A8KieCciWJs7LGaxHoPB6QRxXyUgyR+Zg9Q1ss/XJIE+JuSQ==`; `@langchain/core@1.2.2` integrity `sha512-KfjEOT6sCg0vvItagfEtGpmrGoLMGfma4Affb5BGEqPmS2YR3AxW54pABSkhQlzCehTB+0BnLquAe1lGF4J9zQ==`.
- License and NOTICE: MIT; verify packaged licenses after install.
- Requested use: direct dependency, published public APIs only.
- Files or APIs inspected: `StateGraph`, state annotations/schema, conditional edges, subgraphs and streaming APIs.
- Capability needed: the sole Workflow Runtime required by the baseline.
- Why current authoritative components cannot provide it: no other workflow runtime is permitted; SDAR owns the DSL and compiler while LangGraph executes compiled graphs.
- Boundary/adapter: only `packages/langgraph-runtime` imports LangGraph; external graph/state objects never cross into domain packages.
- Maintenance and upgrade plan: exact npm pins and lockfile; compiler contract tests and execution Spikes on every upgrade.
- Security/quality findings: package supports Node >=18, but its compatible peer `@langchain/core@1.2.2` requires Node >=20; runtime baseline is therefore Node >=20. Initial core `1.0.6` pin was rejected by `pnpm peers check` because LangGraph requires `^1.1.48`.
- License obligations: retain MIT license and include in SBOM/notices.
- Decision and ADR: ADR-001 accepts LangGraph.js as the only runtime; ADR-006 prohibits a second runtime.
