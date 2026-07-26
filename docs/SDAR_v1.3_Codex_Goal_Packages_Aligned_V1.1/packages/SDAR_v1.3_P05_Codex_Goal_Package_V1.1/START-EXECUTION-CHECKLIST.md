# P05 Start Execution Checklist

1. Use future `v1.2.3-final` lineage; do not bind the historical reference SHA in this package.
2. Validate registry SHA `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
3. Validate package self-check: `node scripts/self-check.mjs`.
4. Required merged predecessors: `P00, P01, P02, P03, P04`.
5. P00 status must be `READY_FULL` for every package P01-P13.
6. Branch from execution-time latest `origin/main`; verify predecessor commits are ancestors.
7. Read `AGENTS.md`, package scripts, migration head, architecture gates, OpenAPI and acceptance map.
8. Refuse execution if consumed contract hash differs from `CONTRACT-LOCK.json`.
9. Keep one atomic Goal sequence, evidence, commit, push and Draft PR; never auto-merge/tag.
10. Final Handoff must use `templates/STANDARD-HANDOFF.json` without adding ad-hoc top-level fields.
