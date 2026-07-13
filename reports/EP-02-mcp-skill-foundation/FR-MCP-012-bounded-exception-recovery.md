# FR-MCP-012 Bounded Exception Recovery Evidence

## Outcome

Failed MCP calls now enter the fixed structured LLM exception stage with only the immutable, validated, and unexhausted recovery choices from the confirmed Workflow. The model can select retry, prevalidated changed arguments, a registered alternative Tool, an enabled Skill, or termination. The compiler records bounded action/target counters and rejects invented or exhausted routes.

## Boundary evidence

- Domain-owned recovery actions and options do not contain SDK types.
- The DSL validator proves Tool identity/argument and Skill target semantics before confirmation.
- The model decider requires an exact offered action/target pair and has no rule or Provider fallback.
- LangGraph.js routes through precompiled nodes; no graph mutation or second runtime was introduced.
- `maxAttempts` is restricted to 1..10, exhausted options are removed from model input, and termination remains available.
- Legacy constrained handlers remain compatible.

## Executed evidence

- `pnpm exec vitest run packages/application/test/workflow-validator.unit.test.ts packages/application/test/model-decisions.unit.test.ts packages/langgraph-runtime/test/workflow-compiler.unit.test.ts`: 3 files, 32 tests passed.
- `pnpm exec vitest run packages/json-schema-adapter/test/workflow-dsl-schema.contract.test.ts`: 1 contract test passed.
- `pnpm typecheck`: passed.
- `pnpm verify`: 54 files/240 unit+contract tests, 165-file architecture guard, A2A compatibility baseline, 102 management operations, 17 OSS pins, 52 migration pairs, SBOM/license checks, and Server/Console production builds passed.

The targeted runtime suite executes all four recovery actions and termination, proves a retry option disappears after its one permitted attempt, and verifies an invented model target fails closed. The schema/validator tests prove semantic target constraints and the strict JSON DSL shape.

## Evidence classification

The DSL, model-decision, compiler, boundedness, and replay-counter evidence is real deterministic local execution. No tests were skipped or weakened; no placeholder decision, dynamic code, SDK-domain leakage, new `any`, or secret-bearing field was added. Historical PostgreSQL MCP invocation audit and same-process E2E tests already exist, but this increment could not rerun Docker-backed PostgreSQL/Redis/Mock MCP/model paths because container mutations hang while the engine remains readable. FR-MCP-012 therefore remains **developing**, not verified, until those real integration and E2E gates rerun with the new recovery DSL.
