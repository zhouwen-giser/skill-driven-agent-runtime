# v1.0.12 Bug-fixed Audit

Date: 2026-07-16

Feature commit `01e2d44` and annotated `v1.0.12` are published and remotely verified.

The independent adversarial audit found three real trust-boundary defects:

- a shape-valid model result could name `admin` or `skill_experience` and gain durable authority
  despite originating from ordinary processed-result inference;
- a contradictory model response could mark a named dynamic device-state observation durable, and
  one positive test accidentally demonstrated that unsafe classification;
- Memory content and embedding arrays remained caller-owned mutable references across asynchronous
  work despite readonly TypeScript types.

Durable authority now must equal the application-owned provenance path. A deterministic policy
forces coordinates, battery, online state, occupancy and current device tasks to `volatile` / `mcp`
before embedding, including the direct-create boundary. Domain construction copies, finite-JSON
validates, bounds to 64 levels and deeply freezes content; validated embeddings are copied and
frozen before repository handoff. Cyclic, non-plain and non-finite content fails closed.

Bug-fixed publication: pending / annotated `v1.0.12-bug-fixed`.
