# Persistence Authority Mapping V1.1

- Validation and Shadow facts: `artifact_validation_run`.
- Approval facts: `artifact_approval`.
- Active version: `artifact_active_pointer`.
- Runtime execution and instantiation: `artifact_execution` (`mode` and `decision_snapshot` distinguish rule/template/gateway/case/model).
- Runtime feedback, cost, drift and outcome links: `artifact_feedback` (`impact` contains typed payload).
- Retrieval decisions: `artifact_match_log`.
- Type-specific child tables are non-authoritative projections only and must reference the core record.
