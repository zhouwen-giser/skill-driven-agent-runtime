# UGV Agent Profile external-simulation contract

## Status and scope

This runbook freezes the SDAR-facing contract for `ugv-agent-profile`. It applies only to the
external simulator and never qualifies production or a physical vehicle. SMPP owns both southbound
connections. SDAR must not connect directly to the Device MCP or MQTT endpoints.

The only public SkillVersion in this Profile is exact `embodied.move_to@1`. Its only side-effecting
semantic task type is `embodied.move`, bound to exactly one current SMPP Tool authority for
`vehicle_navigate`. The binding is valid only for resource `vehicle:ugv1`, mission `point`, execution
mode `simulation`, and MCP execution semantics `TASK_REQUIRED`.

Lifecycle-created Skill versions are not substitutes for `embodied.move_to@1`. If exact version 1
is disabled, missing, superseded for the Profile, or fails its required Skill declaration validation,
the Profile is unavailable and fails closed. Other enabled global Skills remain stored but are not
exposed or selectable through this Profile.

The P0 package checksum is offline provisioning/freeze corroboration produced by the validated
Skill Package reader/importer path. It is deliberately separate from Runtime Card authority: the
Card is derived from the current enabled PostgreSQL `SkillVersion`, records exact source ref
`embodied.move_to:1`, and does not claim to revalidate the package checksum on every Card read.

## Runtime Profile and Agent Card

Enable this deployment composition only with the exact environment identity below. The environment
parser and the direct `startServerRuntime` composition guard reject the Profile outside
test/integration control state, so the external-simulation-only qualification is enforced by startup
policy rather than being only a report label.

```text
NODE_ENV=test
SDAR_CONTROL_ENVIRONMENT=integration
SDAR_TASK_UNDERSTANDING_PROFILE=ugv-agent-profile
```

The existing Node Control capability/binding readers, frozen MCP Tasks runtime, and authenticated
human `physical_control.confirm` identity are mandatory. A custom Skill selector is rejected. The
Profile does not create a Server, Registry, workflow runtime, or Provider client.

Capability Summary, Capability Card, capability-to-Skill mapping, Skill Goal candidate admission,
and the A2A Skill provider all consume the same read-only Profile view of the PostgreSQL Skill
Registry. That view admits only an enabled exact `embodied.move_to@1`; it never derives Skills from
`tools/list`. Provider readiness is deliberately absent from Summary/Card hashes. A real Runtime
integration injects failing Provider authority readers and proves that Card GET/rebuild invokes
neither reader and that a same-catalog rebuild preserves the Card content hash. Disabling through the
normal Skill lifecycle creates current disabled v2; exact v1 is then no longer current, and the normal
catalog rebuild produces an empty public Card.

Under this Profile, active Card reads also compare both `catalogHash` and
`generationPolicyVersion` with the current exact Profile catalog. If the Skill mutation commits but
Summary/Card projection fails, management and A2A reads fail closed instead of serving the stale
capability. The pending PostgreSQL catalog event remains recoverable by the existing projector.

The Profile Card has deterministic name `ugv-agent-profile` and generation policy
`capability-policy-v1:ugv-agent-profile-v1`. Under this Profile only, the generic optional managed
Agent Card provider is not composed, preventing an unrelated managed Card from taking precedence.
Other runtime profiles retain their existing Card behavior. Historical `ugv.navigate` data remains
stored but is not projected through this Profile.

## Frozen boundary

The canonical machine-readable record is
`reports/ugv-agent-profile-simulation/contract-freeze.json`. The referenced SMPP reports own the
external Device MCP and MQTT details and are verified by immutable SHA-256 values.

| Boundary             | Frozen value                                                                            |
| -------------------- | --------------------------------------------------------------------------------------- |
| Profile              | `ugv-agent-profile`                                                                     |
| SkillVersion         | `embodied.move_to@1`                                                                    |
| semantic Task Type   | `embodied.move`                                                                         |
| Binding              | `ugv-agent-profile/move-resource`                                                       |
| resource             | `vehicle:ugv1` / `vehicle`                                                              |
| read operation       | `vehicle_get_state` / `SYNCHRONOUS`                                                     |
| movement operation   | `vehicle_navigate` / `TASK_REQUIRED`                                                    |
| movement variant     | `point`                                                                                 |
| execution mode       | `simulation`                                                                            |
| coordinate reference | `EPSG:4326` or alias `WGS84`                                                            |
| coordinate order     | Skill `x=longitude`, `y=latitude`                                                       |
| Provider arguments   | `{resourceId, mission:{type:"point",target:{longitude,latitude}}, stopOnObstacle:true}` |
| MQTT wire mode       | `ros_bridge_json`                                                                       |
| success evidence     | post-dispatch authoritative final position within `toleranceM`                          |

Altitude, route, distance, return-home, speed, planning, reconnaissance, tracking, gimbal, fire, and
emergency-stop arguments are not inferred or generated by this Profile. Emergency stop remains a
manual operational action outside planner authority.

## Deterministic coordinate adapter

The Skill input must satisfy all of these predicates before planning:

- `resourceId` is exactly `vehicle:ugv1`;
- `target.frame` is exactly `EPSG:4326` or `WGS84`;
- `target.x` is a finite longitude in `[-180, 180]`;
- `target.y` is a finite latitude in `[-90, 90]`;
- no unrequested altitude or other navigation parameter is present.

Both accepted frame labels map without transformation to WGS84 longitude/latitude. The adapter does
not swap axes and does not perform an undeclared CRS conversion. The fixed Provider argument is:

```json
{
  "resourceId": "vehicle:ugv1",
  "mission": {
    "type": "point",
    "target": {
      "longitude": "<skill.target.x>",
      "latitude": "<skill.target.y>"
    }
  },
  "stopOnObstacle": true
}
```

Missing or invalid inputs use stable fail-closed codes: `UGV_PROFILE_RESOURCE_NOT_ALLOWED`,
`UGV_PROFILE_CRS_UNSUPPORTED`, `UGV_PROFILE_LONGITUDE_INVALID`, and
`UGV_PROFILE_LATITUDE_INVALID`.

## Binding and readiness freeze

The model may choose neither a Provider nor an operation. Before confirmation, SDAR must resolve one
and only one current binding candidate and freeze the following authority in the confirmed plan:

- exact Skill ID/version and package checksum;
- semantic Task Type and Binding ID/revision;
- SMPP server, Provider ID/version, catalog revision/hash, and manifest hash;
- concrete operation name, execution semantics, input/output Schema and hashes;
- resource ID/type, resolved arguments and arguments hash;
- availability/readiness source revision and expiry;
- risk and confirmation policy.

Zero candidates yields `UGV_PROFILE_BINDING_NOT_FOUND`; more than one yields
`UGV_PROFILE_BINDING_AMBIGUOUS`. Expired or changed readiness invalidates dispatch and must not select
the first available candidate. Device contract mocking remains disabled because the external
`tools/list` currently satisfies the required point-navigation contract. A mock contract may only be
accepted by an explicitly labelled simulation-only report; it is always forbidden for live or
production configuration.

## Workflow and success gate

The required declarative workflow shape is:

```text
initial vehicle_get_state
-> exactly one vehicle_navigate(point)
-> waiting_external
-> persisted continuation at the saved frontier
-> final vehicle_get_state
-> deterministic final-position assessment
-> result
```

The outer confirmed Plan is the single user confirmation. Its exact immutable authority may be
mechanically projected into the existing one-shot governed-control dispatch authorization; the
control authorizer must not be bypassed and no second business confirmation is requested. Continuation
must not restart from `START` or replay navigation.

`completed` is allowed only when all of the following are true: the Provider remote Task completed;
the final state is for the same resource; its observation is newer than dispatch and passes the
frozen freshness/revision/cursor policy; correlation is not `MISMATCH`; Haversine distance to the
target is at most `toleranceM`; displacement from the initial authoritative position exceeds the
noise floor; exactly one navigation dispatch occurred; and no forbidden operation occurred.

A Provider-completed Task with missing, stale, mismatched, or out-of-tolerance position evidence is
failed or uncertain, never completed.

## Side-effect gate

Read-only qualification and startup require navigation count zero. The sole navigation attempt is
permitted only in task `UAP-P3-B02` when all of these environment gates are explicit and consistent:

```text
ALLOW_UGV_SIMULATION_SIDE_EFFECTS=YES
UGV_EXECUTION_MODE=simulation
UGV_SIMULATION_RUN_ID=<new unused run ID>
UGV_TEST_TARGET_LONGITUDE=<operator value or safely derived fresh target>
UGV_TEST_TARGET_LATITUDE=<operator value or safely derived fresh target>
```

The run ID and A2A idempotency key are single-use. An ambiguous admission or transport outcome is
reconciled against Provider authority and never blindly retried. Target derivation, when operator
coordinates are absent, may use only the current fresh authoritative position and a documented
approximately one-metre displacement within the simulator's allowed boundary. Otherwise the stable
blocker is `UGV_TEST_TARGET_REQUIRED`.

## External contract observations

The read-only preflight negotiated Device MCP protocol `2025-11-25` with
`ugv-mcp-server/1.26.0`. That southbound protocol is intentionally distinct from SMPP's northbound
frozen MCP Tasks profile. The real MQTT stream established `ros_bridge_json`; all subscriptions come
from SMPP's exported exact 18-topic UGV profile, with no wildcard and no publish.

Two upstream observations remain visible without weakening the contract: canonical `status/ugv` was
not observed while the exact compatibility alias `/ugv/status` was observed, and `/ugv/speed` was
published at QoS 0 although the locked subscription requests QoS 1. Neither authorizes SDAR to guess a
wire mode, add wildcard topics, or access MQTT directly.

## Requalification

Regenerate the SMPP Device MCP and MQTT contract reports after any change to its UGV allowlist,
operation profile, Provider manifest/catalog, MQTT topic profile, external `tools/list`, or wire-mode
decoder. Then regenerate/check the SDAR contract freeze and rerun the focused contract tests. Any
source hash mismatch, missing required Tool, undeclared wire mode, mock fallback, wildcard, or nonzero
side-effect count blocks qualification.
