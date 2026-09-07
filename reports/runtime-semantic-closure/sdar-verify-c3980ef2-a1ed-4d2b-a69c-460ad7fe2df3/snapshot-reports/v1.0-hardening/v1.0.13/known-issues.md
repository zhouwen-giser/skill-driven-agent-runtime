# v1.0.13 Known Issues

- Notifications are intentionally single-process and ephemeral. A future multi-process runtime must
  add a separately reviewed notification transport while retaining the PostgreSQL reload.
- Safety polling can add up to the configured interval after a missed notification. The production
  default is 1,000 ms; configuration below 100 ms is rejected.
- The notifier's bounded latest-state cache is wake-up optimization only, not persistence or crash
  recovery. V1 running Tasks remain non-recoverable and never automatically retry after process loss.
- The measured numbers are local deterministic test evidence, not production capacity claims.
- No open feature-gate failure remains. Operator-managed mode deferred Compose daemon/config
  validation and no Docker command was run.
