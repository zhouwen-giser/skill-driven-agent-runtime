# Workflow DSL Validator increment

Date: 2026-07-12

Domain and JSON Schema cover LLM, MCP Tool, result, condition, parallel, bounded loop, subworkflow, human confirmation, error handler, and skill_call nodes plus restricted expressions. Unit negative corpus rejects unknown/executable nodes, arbitrary operators, unbounded loops, missing references, and invalid Tool arguments. Same-process e2e validates against current PostgreSQL MCP Tool and SkillVersion definitions.

Compiler/execution coverage and model auto-correction remain open, so FR-WF-001/002 are not marked complete by this validation increment alone.

Full gate: architecture 78 TypeScript sources; unit 56, integration 15, contract 22, e2e 13; format, lint, typecheck, build, local smoke, and selected A2A HTTP+JSON MUST harness (67 passed, 0 selected failures) all passed. The gate also exposed and fixed repeated `$id` Schema compilation in the Ajv adapter.
