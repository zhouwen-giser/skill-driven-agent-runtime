# EP-01 Skill draft-only increment

Explicit A2A `create_skill_draft` and `update_skill_draft` requests map to an application-owned draft intent. TaskService creates a domain `SkillDraft` with immutable `draft` status, persists it in PostgreSQL before queueing the task, and never adds it to the enabled-capability provider.

Real verification:

- unit: 18 passed
- integration: 7 passed against PostgreSQL/Redis
- contract: 13 passed
- e2e: 3 passed; draft persistence and Agent Card exclusion verified over HTTP

FR-A2A-012 remains in development because management API/console draft visibility belongs to EP-06 and is not yet implemented.
