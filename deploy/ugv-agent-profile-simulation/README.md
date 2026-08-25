# UGV Agent Profile external-simulation stack

This directory owns the `UAP-P3-B01` local orchestration boundary. It composes the read-only SMPP
checkout at commit `2dfdeadaeacb9bb533cde2be9ab8140c9c7adf68` with an isolated SDAR Runtime and
Node Control stack. It never starts a Device MCP or MQTT mock and never calls `vehicle_navigate`.

The only southbound endpoints are configured on the SMPP Adapter:

- Device MCP: `http://192.168.2.63:19000/mcp`
- MQTT: `mqtt://192.168.2.63:1883`

All seven SMPP services share the internal Profile control network. PMS health and Catalog
discovery use `http://ugv-agent-profile-runtime:8080` there. A separate task-owned non-internal
northbound network is attached only to the PMS API and UGV Runtime, making their fixed loopback
ports reachable by host SDAR without granting the databases or worker external routing. The
Adapter remains the sole owner of the distinct southbound network. SDAR creates Source, Provider
Binding and Catalog authority only through the existing Node Control and Management APIs.

The three SDAR infrastructure containers likewise retain an internal control network and share a
separate task-owned northbound network solely so their fixed PostgreSQL/Redis loopback mappings are
reachable by the host processes. They contain no Device/MQTT endpoint and receive no model or
control-plane secret through Compose.

## Local inventory

| Owner                                       | Service/process                                        | Local endpoint        |
| ------------------------------------------- | ------------------------------------------------------ | --------------------- |
| SMPP Compose project `sdar-uap-p3-b01-smpp` | UGV Adapter diagnostics                                | `127.0.0.1:17031`     |
| SMPP Compose project                        | UGV Runtime MCP                                        | `127.0.0.1:19131/mcp` |
| SMPP Compose project                        | PMS/Registry API                                       | `127.0.0.1:18092`     |
| SMPP Compose project                        | Adapter PostgreSQL, Runtime PostgreSQL, PMS PostgreSQL | private bridge only   |
| SDAR Compose project `sdar-uap-p3-b01-sdar` | Runtime PostgreSQL                                     | `127.0.0.1:55462`     |
| SDAR Compose project                        | Control PostgreSQL                                     | `127.0.0.1:55463`     |
| SDAR Compose project                        | Redis                                                  | `127.0.0.1:56391`     |
| host process                                | SDAR Management API                                    | `127.0.0.1:10998`     |
| host process                                | SDAR A2A                                               | `127.0.0.1:10999`     |
| host process                                | Node Control API                                       | `127.0.0.1:10091`     |
| host process                                | Node Control worker                                    | no listener           |

Persistent Docker volumes are project-scoped. Runtime manifests, generated PMS credentials and
process logs live only under `/tmp/sdar-uap-p3-b01-<uid>` with private permissions. Reports are
redacted and written under `reports/ugv-agent-profile-simulation/attempts/`.

## Local `.env` contract

The SDAR repository root must contain a regular, owner-only (`0600`) `.env` file. It must not be a
symlink. Only the SDAR Server starts with the repository root as its current directory, and its
existing `process.loadEnvFile('.env')` loader loads the master key and generation/embedding model
configuration. Node Control API and worker start from the private `host-work` directory, where no
`.env` exists. Their complete task configuration is passed explicitly. A Node preflight parses the
file only in memory to validate and redact it; the orchestration never sources it into the shell,
prints, mounts, interpolates it into Compose, or copies it. The child environment is rebuilt from a
small system allowlist, so shell-exported master/model values cannot shadow the repository file.
Task-owned control credentials are generated separately under the private state root. Fixed values
override any same-named values present in `.env`:

- `NODE_ENV=test`
- `SDAR_CONTROL_ENVIRONMENT=integration`
- `SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY=safe`
- `SDAR_TASK_UNDERSTANDING_PROFILE=ugv-agent-profile`
- `BUSINESS_EVENTS_ENABLED=false`
- `ALLOW_UGV_SIMULATION_SIDE_EFFECTS=NO`

The preflight checks that real-model configuration is present without emitting names, endpoints or
credentials. An API-key file is accepted only through this Profile's strict regular-file,
non-symlink, owner and `0600` preflight; this does not claim an independent production-reader TOCTOU
hardening change. Secret-bearing values are compared in memory against rendered Compose, private
process logs and generated reports; a match fails closed with a stable error code. Model provider,
model name and base URLs may appear only in private process logs; public evidence contains booleans,
counts and hashes instead. Value-level public scanning is deliberately limited to credential
material and those exact LLM provider/model/base-URL values. Generic host, port, profile and
environment values may legitimately recur in the rendered local stack; their recurrence alone is
not treated as a secret leak, while prohibited key names remain independently rejected.

## Command surface

Run the clean-start sequence from the SDAR repository root:

```bash
deploy/ugv-agent-profile-simulation/preflight.sh
deploy/ugv-agent-profile-simulation/up.sh
deploy/ugv-agent-profile-simulation/bootstrap.sh
deploy/ugv-agent-profile-simulation/readiness.sh
deploy/ugv-agent-profile-simulation/verify.sh
```

`up.sh` is the ordered aggregate `up-smpp.sh` (which performs preflight, then proves live container
network membership and all three loopback port mappings before PMS seed and read-only
qualification) followed by `up-sdar.sh`. A missing live port mapping fails before the seed can make
any control-plane call. `up-sdar.sh` applies the same live inspection to its three infrastructure
ports before the host supervisor is invoked. If a spawned leader has already exited, the
supervisor's `UAP_PROCESS_ORPHAN_RISK` result intentionally sends no signal; that is a secondary
fail-closed outcome, not a substitute for the pre-supervisor network gate. The granular commands
remain available for diagnosis.
`preflight.sh`, `up-smpp.sh` and `up-sdar.sh` are deliberately clean-start, fail-closed commands:
their fixed ports must be free. `bootstrap-authority.sh` does not rerun preflight or any `up`
command. `bootstrap.sh` is a thin alias for it. It first proves that the exact two Compose projects and three host processes are already
owned and ready, then safely replays GET/compare/idempotent authority operations. Repeating it is
the B01 idempotency check.

The bootstrap authority is narrow: one full PMS Registry Source, one current Provider Binding and
Catalog, exact `embodied.move_to@1`, exact `embodied.move@1`, its Readiness snapshot, one Exposure,
and the active Node Control managed Agent Card revision. The public UGV Profile Capability Card is
a separate projection of the enabled Skill lifecycle (`useManagedAgentCardForProfile=false`); the
Node Control managed card is Exposure/admission authority and is not served as the Profile public
card. B01 performs no A2A task, navigation, weapon action or external model invocation.

The reviewed latest SMPP live Catalog is an exact 10-tool closure. The frozen protocol schema can
describe optional `vehicle_laser_range`, but this Profile does not advertise it; both a ninth/missing
tool and an eleventh/extra laser tool fail closed until a new authority review. Required
`vehicle_get_state` and `vehicle_navigate` remain present, and `vehicle_fire_weapon` remains inside
the explicit forbidden-operation/zero-invocation safety audit.

Stop or remove only task-owned runtime resources with:

```bash
deploy/ugv-agent-profile-simulation/down.sh
deploy/ugv-agent-profile-simulation/clean.sh
```

`down.sh` preserves all eight named volumes. `clean.sh` additionally removes only the explicitly
listed volumes after verifying their Compose-project labels. Both preserve the private run IDs,
reserved future simulation ID, raw logs and immutable/redacted evidence; neither removes the state
root or reports. Future B02 may use the supervisor's explicitly acknowledged server-only restart to
set side effects to `YES` for the already reserved simulation ID, then restore `NO`; B01 never calls
that operation.

The host supervisor publishes a complete owner record as a private regular file with one atomic
hard link. It never removes or recovers a stale lock automatically. A stale-lock error therefore
requires an operator to verify that the recorded PID, UID and process start ticks no longer identify
a live owner, and then remove only the exact lock file and its same-inode candidate. This deliberate
manual recovery prevents one contender from deleting a later winner's lock.
