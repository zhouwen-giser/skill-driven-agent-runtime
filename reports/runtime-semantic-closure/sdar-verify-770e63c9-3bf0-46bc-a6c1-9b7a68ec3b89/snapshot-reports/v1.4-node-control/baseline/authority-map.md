# P00 Authority map

- Node Control PostgreSQL owns Node Profile, desired configuration revisions, Capability definitions,
  implementation bindings, Exposure definitions, SMPP candidate snapshots, Node Control operations,
  and Node Control audit.
- Runtime PostgreSQL continues to own Goals, Tasks, Plans, Workflow instances, Skill executions,
  Skill versions, Artifact/Plan Template versions and pointers, live MCP catalog projections,
  readiness snapshots, Agent Card applied revisions, immutable Task capability bindings, attempts,
  and transactional outbox facts.
- SMPP Runtime Database owns Provider task/command state. Provider availability remains an online
  Provider fact.
- The independent Telemetry System owns historical analytics and cross-system reconciliation. This
  repository only configures and reports telemetry export delivery state.
- Redis/BullMQ owns no durable business truth. It may wake workers or hold rebuildable coordination.
- Public Node Control API and internal Runtime Control API are distinct. Definitions flow through
  publish, pull, validate/stage, apply, acknowledgement, and active/LKG snapshots. Publish never means
  applied.
- Control Plane cannot write Runtime tables, Runtime cannot write Control tables, and neither may
  infer authority from Console state or Node Event hints.
