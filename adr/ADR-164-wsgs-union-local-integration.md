# ADR-164: Validate WSGS-aware source unions and prepare local shared storage

Status: Accepted within the user's explicit 2026-10-13 local packaging/deployment request.

The selected Telemetry package embeds SMPP union schemaVersion 2 with an intact WSGS union. SDAR's old validator assumes separate analysis/GOWM archives and fails before packaging. Add an explicit version-2 traversal through WSGS → GSAP → GDPS → GOWM, verifying inventories, descriptors and source hashes at every boundary. Keep the legacy layout and all path/type/duplicate/secret checks. Preserve complete upstream bytes and distinguish package provenance from actual deployed component identity.

Local GOWM presently lacks SDAR business storage and the pinned vector extension. Prepare it only after an actual backup, using the official pinned owner installer and a derivative of the exact existing PostgreSQL image that adds reviewed pgvector 0.8.5 files/license. Preserve original roles, passwords, volumes, device bindings and existing component configurations. Control has a separate database; SDAR retains read-only startup contract verification and the sole LangGraph execution runtime.

Local deployment authorizes service installation and readiness verification. It does not authorize navigation, tracking, fire or other device actions, or remote deployment. Existing explicit execution policies are preserved; local listeners use loopback. Source packages contain no private configuration, tokens, keys or business data. Trajectory proof consumption and device-total-history qualification are separately scoped from package and deployment readiness.

The current SMPP trajectory release adds `vehicle_get_trajectory_history` and
`vehicle_get_trajectory_evidence`. Explicit profiles `ugv-v1-12` and `ugv-v1-13` review these
two operations as synchronous read-only contracts, respectively without and with laser range.
Legacy profile defaults and exact inventory checks remain unchanged. Discovery must converge
with the Control Catalog before publication; a cold-start or stale Catalog is not accepted by
reducing the required inventory. No execution authority or terminal writer is added.

The user excludes state snapshot history from this deployment's backup scope. Completed backups
cover all DDL/global roles, shared business data and affected installation/task histories, and
pass archive readability checks. Original snapshot data stays in its existing volume. Partial
full dumps are retained as incomplete captures; full restore qualification remains NOT_RUN.
