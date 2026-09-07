# Failure-driven Skill replacement increment

Date: 2026-07-12

FR-SKL-013 is verified through a real local A2A/PostgreSQL/Model Runtime scenario:

1. The Task selects a primary Skill and persists its selection ID.
2. The confirmed primary Workflow makes a real local model call that fails; the failed WorkflowInstance is persisted.
3. Goal Evaluation returns `replace_skill` from that failure evidence.
4. Only an enabled `alternative` graph target is considered and its decision snapshot is persisted.
5. The next immutable Workflow supersedes the failed source plan and remains awaiting confirmation.
6. A second A2A confirmation resumes the same controller and the replacement completes with schema-validated output.

Unit evidence covers persisted-failure evaluation, forced confirmation even for auto-confirm-capable Skills, Task replacement binding, and alternative-only selection. Integration evidence covers selection/replacement persistence and Task selection foreign-key migration.

External model behavior is simulated by a deterministic local HTTP server; PostgreSQL, A2A SDK, application services, and LangGraph.js execution are real local components.

Full gate: format, lint, typecheck, architecture, 124 unit tests, 29 integration tests, 35 contract tests, 34 E2E tests, production build, and local server smoke passed.
