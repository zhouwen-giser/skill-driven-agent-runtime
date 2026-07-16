# v1.0.10 Known Issues

- The upstream Agent must decide when capability registration is complete and submit a new Task; SDAR deliberately performs no Tool scan or automatic execution.
- The terminal Task retains the Goal reference while the Goal remains active. Explicit Goal cancellation may end the Goal but does not rewrite the historical capability-gap Task/Control.
- MCP Tasks, remote Task polling and device conflict control remain out of scope.
