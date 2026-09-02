# External Execution Identity

`RemoteTaskBinding` remains protocol-neutral lifecycle authority. The companion
`sdar.remote-task-provider-execution-link/v1` records:

- local `bindingId`, logical invocation and remote Task;
- `runtimeServerId`, `providerBindingId`, `providerOriginType`;
- `smppSourceId`, `externalServerId`, Provider ID and operation;
- independently resolved/unresolved Provider execution and Device Mission identities;
- committed-receipt or exact-reconciliation provenance, source contract/revision, observed time and
  canonical content hash.

For an SMPP origin, Binding, Source and external Server are all mandatory. An exact Mission requires
an exact Provider execution. The observed rejected southbound call exposed neither identity, so both
remain unresolved; no Task ID or Telemetry projection is promoted into either field.
