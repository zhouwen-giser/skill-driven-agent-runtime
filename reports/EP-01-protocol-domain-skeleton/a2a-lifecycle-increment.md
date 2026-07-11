# EP-01 A2A lifecycle increment

Status: passed for the submit-to-plan-confirmation slice.

The single-process server composition root connects the official A2A HTTP handler to TaskService, PostgreSQL and BullMQ. An official client streams a task submission through the real queue to `INPUT_REQUIRED`, receives the readable message `Plan confirmation required.`, then queries, lists and cancels the persisted task without credentials.

Evidence:

- `pnpm verify:bootstrap` — 28 passed; architecture gate covers 33 TypeScript source files.
- `pnpm test:integration` — 7 passed against real PostgreSQL and Redis containers and loopback HTTP.

This evidence does not yet cover confirmation, supplementary input, pause/resume, final dual-format result, Skill draft behavior, or the official TCK.
