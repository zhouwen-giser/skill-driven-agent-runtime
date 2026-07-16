# v1.0.11 Known Issues

- MCP Task binding and polling are intentionally deferred to v1.1; `task_capable` and
  `task_required` are planning/audit metadata only in v1.0.11.
- Tool annotations are untrusted protocol hints. Only explicit mapped values are imported, and
  missing fields remain `unknown`.
- The administrator override is retained across refresh but remains dormant while an MCP
  declaration exists, matching the task package's stated source order.
- SDAR records semantics but does not become device state authority and does not implement device
  conflict control.
- No open feature-gate failure remains. Operator-managed mode defers Compose daemon/config
  validation and no Docker command was run.
