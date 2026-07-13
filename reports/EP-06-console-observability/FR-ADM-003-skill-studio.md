# FR-ADM-003 Skill Studio Evidence

## Console lifecycle coverage

- Natural-language authoring calls the fixed `skill_authoring` model stage and receives Schema-constrained, server-validated output.
- Complete Skill JSON editing submits both Schemas, metadata, Tool policy, runtime policy, status, and source through the authoritative registration validator.
- Persisted drafts can be inspected and explicitly published with actor, formal Skill ID, Tool/runtime policy, and enabled/disabled state.
- Formal current versions support enable, disable, history, quality warnings, diff, rollback, and linked evolution evidence.
- Formalization candidates support inspection, five-part simulation/publication gate, correction history, and explicit correction/revalidation JSON.
- Skill Graph supports inventory plus typed relation creation/deletion for all six relation types.

## Invariants

- The browser never constructs an enabled Skill outside management APIs.
- Invalid generated or edited Schemas remain rejected by the existing Ajv/domain boundary.
- Failed simulation cannot publish; correction still undergoes full revalidation.
- A2A drafts retain their dedicated management-publication path.
- No external Skill/Agent runtime or copied UI component is introduced.

## Verification

- Console server-render test proves authoring, simulation/correction, version comparison, and graph controls exist.
- Existing Skill authoring/registry/graph/evolution unit, integration, contract, and E2E evidence remains authoritative for backend behavior.
- Strict typecheck, lint, format, and production build pass.

## Pending

- Real browser interaction E2E and current Docker-backed reruns remain unavailable.
- The requirement remains developing until those interactions and bidirectional navigation are reproducibly verified.

