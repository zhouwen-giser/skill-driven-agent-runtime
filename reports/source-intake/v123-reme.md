# OSS Intake: ReMe / retrieval behavior

- Official repository: `agentscope-ai/ReMe`
- Package/module: search, vector/text fusion and relation expansion
- Exact tag/commit/version: `46adb5ae1e94715ecdffe201a46933fbd419a5e1`
- License and NOTICE: Apache-2.0, `LICENSE` blob `65c2c5cf06d722c79d8105cfce97016491a7a7f4`; no root NOTICE
- Requested use: design/algorithm behavior reference only
- Files or APIs inspected: locked search/config/link-expansion paths listed by the task package
- Capability needed: RRF, bounded relation expansion and context de-duplication
- Why current authoritative components cannot provide it: v1.2.2 Memory search has no promoted multi-target planning knowledge fusion
- Boundary/adapter: clean-room TypeScript/PostgreSQL implementation; MemoryService is active projection only
- Maintenance and upgrade plan: exact commit; no ReMe service or file store
- Security/quality findings: FastAPI/FastMCP and file authority are forbidden product dependencies
- License obligations: Apache attribution/modification notices if later code is ported
- Decision and ADR: behavior reference only; ADR-112
