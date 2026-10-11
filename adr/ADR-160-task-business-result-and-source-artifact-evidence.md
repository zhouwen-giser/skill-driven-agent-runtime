# ADR-160: TaskBusiness result evidence and native source Artifacts

Status: Accepted (2026-10-11, local implementation).

Protocol terminal status, Provider business outcome and Skill evidence coverage are separate facts.
Reuse the original Provider business failure classifier, preserving its reasonCode. A published
Skill may declare a bounded TaskBusiness evidence policy with literal JSON-pointer predicates,
required geometry roles and time/history requirements. No code is executed and no authority is
granted by that data. When required evidence is absent, a model cannot override the hard gate by
claiming successful output. Legacy Skills retain their existing contracts.

Derive geometry roles from the exact public artifact type/semantics and current adopted-route
reference. Preserve CRS, original sample count and complete retained bytes. Estimated sensor
geometry never becomes measured coverage. Pinned trajectory coordinates have no per-sample
Provider receive times; preserve that gap, even when the last observation has a qualified clock.
Retain duplicate/reversed coordinates in Provider order and declare that sample ordering basis;
do not infer per-sample clocks. Expired estimated geometry remains retrievable as history;
conflicting CRS declarations remain diagnostic with no invented conversion.

Extend the original artifact://runtime/v1 resolver by one immutable native source route:
remote_task_observation/<object-observation-id>/1/content. The source is the native immutable
object metadata and its bounded digest-verified content chunks. Canonical bytes carry the original
raw bytes as base64, with their own byte size and SHA-256. The ArtifactRef hash covers the canonical
envelope, not a differently serialized geometry. GOWM resolution obeys the native Task owner scope.

Keep the existing mcp_task.observation catalog/schema and export path. Emit bounded chunk facts
and references instead of inline base64 in Evidence envelopes. Original confirmation facts and
dispatch consumption are persisted in the same command transition journal; IDs/hashes link them
to the exact business object and Skill outcome. Missing links remain explicit. This additive source
route preserves all existing routes and does not add tables, external dependencies or a runtime.

Expose the canonical bytes through a Task-scoped management source-artifact read with all six
ArtifactRef fields, canonical hash/size checks and native owner isolation. Public Skill DTOs and
stored runtime policy preserve and validate these policies. Native terminal success still requires
the original Capability/physical dispatch proof, exact enabled Skill version/outcome specification,
current complete original projection and published evidence predicate; a model assertion cannot
replace them. The original terminal outcome writer remains the sole writer.

Deterministic native evidence or published output-schema denials finish the existing continuation
control as failed and quarantine its original Binding after the native Task failure is persisted.
Transient transport failures retain the existing durable callback retry path. An optional
post-failure memory enhancement cannot undo the durable denial or cause graph/Tool replay; its
error still propagates. A failed business mission under the same published Skill is tested with
protocol status completed and a denied native success result, alongside the successful mission.

Compatibility verification archives the repository's exact PR34 commit and invokes its real
RemoteTask repository against the migrated isolated database. Active old Tasks with no business
projection coexist with current projected Tasks; authority and Tool counts remain unchanged.
The 0184 down/up check does not modify the clean-slate baseline or the GOWM owner contract.
