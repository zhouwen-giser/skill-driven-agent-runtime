# P03 Retained Failed Attempts

## Static and focused repairs

- Initial lint found an unnecessary optional chain. The call site was simplified; no lint rule was
  disabled.
- The first real integration attempt reached `model_invocation` without its required `agent_task`
  row, and the next attempt reached `agent_task` without its required `conversation_context`. The
  fixture now creates the same durable prerequisites as the real Runtime path.
- Route revision 2 stayed draft after Ack with `CONTROL_LLM_DEFINITION_IMMUTABLE`. The Control
  immutability trigger compared generated selector columns during a `BEFORE` trigger. Generated
  columns were excluded from the content comparison while status-only projection transitions remain
  allowed and definition content remains immutable.

## Full verification attempts

- The first full gate passed through Server smoke, then Node Control smoke inherited
  `SDAR_REUSE_EXISTING_INFRA=true` into its nested Runtime smoke and attempted an unstarted random
  PostgreSQL port. The nested smoke now explicitly disables reuse and owns its disposable stack.
- Two full gates exposed the existing P10 p99 test exceeding 750 ms only inside the highly parallel
  Unit batch (877 ms and 784 ms); isolated reruns were 314 ms or lower. The unchanged 22-test
  performance file now runs exclusively after the parallel Unit batch, and the verifier aggregates
  both Vitest result blocks. Its final p99 was 248.003 ms.
- The next gate exceeded the old 180-second bootstrap child timeout after adding the exclusive
  performance batch. The orchestration timeout was raised to 300 seconds without changing a product
  timeout, assertion or performance budget.
- A complete gate then passed before read-only review. Review found two Major issues: Runtime target
  apply could duplicate work after an apply-before-Ack crash, and arbitrary upstream error codes
  could enter invocation audit. Exact active revision replay plus a locked recheck made apply
  idempotent; audit now stores only four stable transport categories.
- The second read-only review found one remaining Major issue: the Runtime Apply Ack sanitizer used a
  broad uppercase-code pattern. It was replaced by an explicit four-code allowlist and a
  secret-bearing rejection regression.
- The first post-review full gate passed Unit/Contract, architecture, build, 29 migrations and all
  135 Integration tests, then failed 8 E2E tests. The first failure expected the obsolete
  `MODEL_UPSTREAM_ERROR`; its early assertion terminated cleanup and polluted seven subsequent
  serial cases. The assertion was aligned to `MODEL_TRANSPORT_UPSTREAM_ERROR`; the final full gate
  passed all 72 E2E tests and every smoke.
- Two focused E2E invocations returned no test result because automatic permission review timed out.
  No Node process remained, so neither attempt is classified as a test pass or product failure. The
  already-authorized complete gate supplied the final E2E evidence.

No failed attempt was hidden, no assertion was weakened, no secret was added to evidence, and no
existing Docker volume was deleted.
