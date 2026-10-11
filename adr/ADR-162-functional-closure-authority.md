# ADR-162: Functional closure keeps owner and validation authorities

Status: Accepted for implementation, 2026-10-11.

The current-source audit found genuine feature gaps despite all existing tests passing. The user authorized local GOWM owner repairs and re-intake on 2026-10-11. This supersedes only the former SDAR-only scope for the two recorded shared-storage defects.

GOWM adds forward overlays; existing installed hashes and native migrations stay immutable. Device ownership comes from existing task/binding relations. SDAR keeps read-only contract verification and opaque provider IDs. Regression tests exercise actual PostgreSQL triggers and restricted consumer roles.

Skill evolution may replace the deliberate ADR-151 deferral only after isolated execution of the proposed candidate, exact policy/dependency identity checks and atomic CAS publication are implemented and verified. Production tool access is never a simulation mechanism. Existing LangGraph remains the only executor; Task and Goal state ownership remains unchanged.

Console node editing preserves full DSL values and calls existing validation/revision/confirmation paths. Neither UI operations nor generated candidates modify running workflow instances.

No missing provider capability or source event timestamp may be manufactured to close an acceptance item. Local fixture evidence remains explicitly distinct from physical provider/model/deployment evidence.
