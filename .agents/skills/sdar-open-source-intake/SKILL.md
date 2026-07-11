---
name: sdar-open-source-intake
description: Use before adding, copying, vendoring, forking, or adapting code from LangGraph, Mastra, VoltAgent, OpenHands, Dify, Google ADK, BeeAI, Microsoft Agent Framework, A2A SDK, MCP SDK, or any new dependency.
---

1. Read the exact commit LICENSE and NOTICE.
2. Fill `templates/OSS_INTAKE_TEMPLATE.md`.
3. Pin repository/tag/package and record it in `third_party/sources.lock.yaml`.
4. Classify use as direct dependency, source adaptation, API/design reference, or prohibited.
5. Check whether the same capability already has an authoritative implementation.
6. For copied code, preserve notices and record original file/commit plus modifications.
7. Never copy Dify code, Mastra `ee/`, or non-open OpenHands Cloud code.
8. Add or update an ADR for production dependencies or maintained forks.
