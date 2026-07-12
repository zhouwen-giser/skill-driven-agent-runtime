# ADR-050: Historical simulation replays immutable Workflows through LangGraph

## Status

Accepted — 2026-07-12

## Context

FR-EVO-005 requires candidate validation to include static checks, real historical successful and failed Workflow replay, and model-generated normal, boundary, and exception cases. Historical records already contain immutable Workflow DSL, input, Tool references, results, errors, and evaluation evidence.

## Decision

- Select historical Evolution Experiences by the candidate's declared MCP Tool references and deduplicate them by Experience identity.
- Replay each selected immutable Workflow and saved input through the existing LangGraph executor. Do not create another execution runtime or mutate the historical Workflow.
- A replay passes when its terminal success/failure classification matches the recorded historical classification. The report records every source Experience, expected class, observed class, and displayable summary.
- Keep repeated Temporary Skill source records distinct from actual Workflow replay cases.
- Static validation and model-generated normal, boundary, and exception simulations remain mandatory; publication continues to require every case to pass.
- Replay may invoke MCP Tools, including side-effecting Tools. Operators must use isolated simulation endpoints or safe Tool configurations; no production system is contacted by repository tests.

## Consequences

The simulation report is reproducible and distinguishes source evidence from executable replay. Historical success and historical failure are both verified using the single approved runtime. Side effects are an explicit accepted operational risk rather than being hidden behind a mock-only claim.
