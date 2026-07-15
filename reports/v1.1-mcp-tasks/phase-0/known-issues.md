# Phase 0 Known Issues

1. MCP Tasks is not implemented in Phase 0; every FR-MCPT/NFR-MCPT/AC-MCPT item remains planned/unverified.
2. Official `ext-tasks` has no tag and is an incubating/draft Apache-2.0 extension. Exact commit/schema blobs are pinned; compatibility must be proved in Phase 1.
3. SDK 1.29.0 high-level experimental Tasks has the wrong legacy API and is forbidden for this upgrade.
4. Migration 0100+ cannot enter a persistent supported database before the complete v1.0.13 chain; disposable isolated development only.
5. Hardening v1.0.5–v1.0.13 is not yet merged. Phase 4 and final Phase 6 have hard dependencies.
6. The requested reference filename `SDAR_v1.1_MCP_Tasks_升级方案.md` is absent; the frozen `升级设计文档.md` is treated as its corresponding source and the assumption is recorded.
7. DOCX visual rendering was unavailable because `soffice` is not installed. Structural extraction completed; no DOCX artifact is modified by this phase.
8. Draft PR creation and Phase 0 commit/push evidence remain pending; the changed-document/source/build gate has passed.

Continuation after Phase 0 is allowed only if items 8 is resolved. Items 1–7 are explicit staged constraints, not permission to claim completion.
