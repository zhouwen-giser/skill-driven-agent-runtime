# ADR-064: React and Vite Console Boundary

## Status

Accepted on 2026-07-13.

## Context

EP-06 requires a real React management console for every operational domain. The repository already owns the management APIs and domain behavior but has no browser UI implementation or frontend build pipeline. V1 must remain a single-process modular monolith, must not introduce a second workflow runtime, and must visibly retain the no-auth trusted-intranet warning.

## Decision

- Use exact-version React 19.2.7 and React DOM 19.2.7 for the presentation layer.
- Use exact-version Vite 8.1.4 and `@vitejs/plugin-react` 6.0.3 only for development and production asset builds.
- Keep all framework imports under `apps/console`; core domain and application modules remain framework-independent.
- Treat the management API as the only operational source of truth. Production console code may not contain static business records or mutate projections outside documented APIs.
- Serve the built console from the existing management listener so A2A, Worker, management API, and console remain within one V1 Node.js process.
- Implement the Workflow DAG editor in repository-owned React components. Do not embed Dify UI source or a second workflow/runtime framework.
- Display the trusted-intranet/no-auth risk persistently and preserve the warning response header on API and console responses.

## Consequences

The console gains a conventional, testable TypeScript presentation stack without changing domain authority. The production build adds static artifacts but no independent server process. All dependency upgrades require renewed license, engine, build, accessibility, and E2E evidence.

