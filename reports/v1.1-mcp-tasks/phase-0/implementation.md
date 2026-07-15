# Phase 0 Implementation

- Start SHA: `6f9abf88cf9b7d5489c076da4728fdcde0019243`
- End SHA: pending Phase 0 publication commit
- Phase commit: pending
- Branch: `feature/v1.1-mcp-tasks`
- Latest observed hardening: `fa4b0509971fc73c474211b871eeefaf4e76eb54` / `v1.0.4-bug-fixed`

Phase 0 adds no runtime feature code. It freezes EP-09, five ADRs, canonical design/Provider extension, v1.1 requirement and acceptance IDs, exact official MCP Tasks extension source pins, repository/symbol/conflict maps and reproducible baseline evidence.

The architecture review confirmed the only implementation path: current SDK transport plus adapter-owned low-level extension requests; domain-owned remote models; PostgreSQL authority; BullMQ scheduling; LangGraph external-wait outcome; no long Promise, no second runtime, no in-flight graph mutation and no Provider resource authority in SDAR.

Continuation is allowed only after the Phase 0 gate, exact commit and remote push are recorded.
