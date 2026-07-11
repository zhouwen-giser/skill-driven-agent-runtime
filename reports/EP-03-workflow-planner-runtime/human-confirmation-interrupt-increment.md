# Human confirmation interrupt evidence

Date: 2026-07-12

## Delivered

- Native LangGraph interrupt/Command resume for `human_confirmation`.
- PostgreSQL `paused` Workflow instance and displayable pending-confirmation persistence.
- Same-instance resume API with continuous event ordering and budget accounting.
- Fail-closed behavior when ephemeral checkpoint state is unavailable.

## Reproducible evidence

- `pnpm test:unit`: all ten node kinds execute; confirmation pauses and resumes through LangGraph without replaying the preceding MCP node.
- `pnpm test:integration`: PostgreSQL migration/repository suite includes the paused status and pending payload schema.
- `pnpm test:contract`: management confirmation-resume request/response contract.
- `pnpm test:e2e`: real local MCP call count remains exactly one across persisted pause and resume, then the same Workflow instance succeeds.

## Verification classification

- Real: LangGraph native checkpoint/interrupt, PostgreSQL, management HTTP, and official-SDK local MCP execution.
- Simulated: human approval is supplied by the local e2e HTTP client.
- Not verified here: arbitrary user pause, long-pause replan, and cancellation policy; these remain EP-04 requirements.
