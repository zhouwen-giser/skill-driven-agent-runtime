# P03 Start Execution Checklist

1. Use future `v1.2.3-final` lineage; do not bind the historical reference SHA in this package.
2. Validate V1.2 registry SHA `8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`.
3. Validate package self-check: `node scripts/self-check.mjs`.
4. Required merged predecessors: `P00, P01, P02`.
5. P00 status must be `READY_FULL` for every package P01-P13.
6. Branch from execution-time latest `origin/main`; verify predecessor commits are ancestors.
7. Read `AGENTS.md`, package scripts, migration head, architecture gates, OpenAPI and acceptance map.
8. Refuse execution if consumed contract hash differs from `CONTRACT-LOCK.json`.
9. Keep one atomic Goal sequence, evidence, commit, push and Draft PR; never auto-merge/tag.
10. Final Handoff must use `templates/STANDARD-HANDOFF.json` without adding ad-hoc top-level fields.
