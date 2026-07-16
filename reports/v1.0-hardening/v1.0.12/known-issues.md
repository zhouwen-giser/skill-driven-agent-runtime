# v1.0.12 Known Issues

- Model refinement is intentionally data, not authority to execute code. The strict schema and
  durable-only policy fail closed, but semantic classification quality still depends on the
  configured model and requires operational evaluation.
- Migration 0064 conservatively excludes legacy Memory from semantic retrieval. It does not guess
  durability from historical text or mutate old migrations.
- Rollback to the previous fixed `vector(3)` schema is intentionally blocked if any non-three-
  dimensional Memory remains; an operator must migrate or delete those rows explicitly.
- SDAR does not become device state authority. Dynamic state is rejected from long-term Memory and
  must be requeried from MCP.
- No open feature-gate failure remains. Operator-managed mode defers Compose daemon/config
  validation and no Docker command was run.
