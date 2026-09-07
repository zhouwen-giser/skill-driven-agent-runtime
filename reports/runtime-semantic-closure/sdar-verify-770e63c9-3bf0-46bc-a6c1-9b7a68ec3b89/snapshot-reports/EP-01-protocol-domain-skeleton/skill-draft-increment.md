# EP-01 Skill draft-only increment

Explicit A2A `create_skill_draft` and `update_skill_draft` requests map to an application-owned draft intent. TaskService creates a domain `SkillDraft` with immutable `draft` status, persists it in PostgreSQL before queueing the task, and never adds it to the enabled-capability provider.

Real verification:

- unit: 18 passed
- integration: 7 passed against PostgreSQL/Redis
- contract: 13 passed
- e2e: 3 passed; draft persistence and Agent Card exclusion verified over HTTP

This original EP-01 limitation was closed by the later source-governed publication increment. See `FR-A2A-012-draft-management-reconciliation.md`: management draft read/publication, bypass rejection, and dynamic Agent Card behavior have real integration/contract/E2E evidence, so FR-A2A-012 is verified.
