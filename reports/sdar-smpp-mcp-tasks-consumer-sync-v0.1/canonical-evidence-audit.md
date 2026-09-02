# Canonical Evidence Audit

Contract: `sdar.evidence/v1` (backward-compatible additive extension).

- Registry: 105 records, 100 Required, five Diagnostic, 105 durable projections.
- Families: Runtime 18, Skill 16, MCP Task 16, Capability 7, Experience 10, Replay 6,
  Artifact 6, Node Control 21, Evidence 5.
- Registry hash: `sha256:7d00320ed21eb89e98abce8ebbdaa7e4aa887e97ee97888ae8e4b62c69adf197`.
- Protocol contract byte hash: `sha256:fa9cdb146682a2f525af0fc11a5d561a7a1bf0abc35d6a9d9927c75182b7218e`.

Added Required records:

| Record | Source authority | Schema hash |
| --- | --- | --- |
| `mcp_task.logical_invocation` | `remote_task_admission_intent` | `sha256:291f249f3db684976983c66bb1a2c0ed5eaaa790418edc1970d8db09806bd622` |
| `mcp_task.admission` | `remote_task_admission_intent` | `sha256:93145487a171f461e86288152c87b7b6466def2b2fd3916f30dfaa5cf7ea4a17` |
| `mcp_task.dispatch_uncertain` | immutable reconciliation attempt | `sha256:d7e8bbf7af758e90f05b95e9a5e3026dffbdc54306503edb41c04104d47c003b` |
| `mcp_task.dispatch_reconciliation` | `remote_task_reconciliation_attempt` | `sha256:ebd1f779264c9a38b3f4991016c1cffa73b23dab9317de35f273d1b00116acf7` |
| `mcp_task.provider_execution_link` | `remote_task_provider_execution_link` | `sha256:afbbbfd75e0214d5fc18fb75499f3c8499dca6e950d611e246f8039f5de0c97b` |

The generated registry, per-record schemas, canonical union, batch schema, protocol contract, source
matrix, verification-proof manifest and downstream handoff all share the same Catalog authority.
`verify-v141-evidence-contract` and `verify-v141-evidence-coverage` pass 105/105. These records are
observational: they cannot mutate Task, Workflow, verification, Goal or physical-success authority.
