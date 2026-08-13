# External UGV SMPP deployment profile

This profile integrates SDAR with an already-deployed UGV SMPP Registry and Runtime. It does not
build, bundle, start, stop, or modify SMPP. All MCP/UGV work is performed by the SDAR drivers through
the existing Node Control, Runtime, A2A, MCP-adapter, and PostgreSQL authorities.

## Package-driver contract and current status

The shell files are deliberately thin orchestration wrappers. Every documented package command is
present in `package.json`, and each wrapper executes the same underlying Node entry point directly so
it cannot trigger package-manager dependency installation during a deployment check. Status-only
wrappers remain non-mutating and return machine-readable `pending` or `blocked` output.

| Wrapper                   | Package command                                              | Current behavior                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight.sh`            | `ugv:driver:preflight`                                       | Implemented read-only PMS projection and Runtime-health guard. Success remains `overallPreflightAuthority: pending_driver_checks`; it does not claim DB, Redis, Catalog or model proof.                                                  |
| `bootstrap.sh`            | `ugv:driver:bootstrap`                                       | Safely returns `blocked / UGV_BOOTSTRAP_PIPELINE_PENDING` before mutation until the focused drivers are composed atomically and optional real-model bootstrap exists.                                                                    |
| `smoke-readonly.sh`       | `ugv:driver:smoke-readonly`                                  | The governed five-read driver is implemented. The current run stopped at the first read: live mode returned `UGV_EXECUTION_MODE_UNSUPPORTED`, and simulation later failed readiness with `UGV_DEVICE_MCP_UNAVAILABLE` before invocation. |
| `qualify-model.sh`        | `ugv:driver:qualify-model`                                   | Runs all nine structured stages, the application-level workflow-planning rejection/correction path, and the `goal`/`skill_selection` embedding prerequisites through the persisted Runtime model authority.                              |
| `qualify-a2a-readonly.sh` | `ugv:driver:qualify-a2a-readonly`                            | The real A2A driver is implemented, but qualification remains blocked until both a real model and the deterministic/device read prerequisite are available.                                                                              |
| `qualify-control.sh`      | `ugv:driver:control-gate`, then `ugv:driver:qualify-control` | The first command prints the exact public target/bound. The second remains blocked until the live authority and single-dispatch control driver exists.                                                                                   |

The narrower `ugv:driver:bootstrap-source`, `ugv:driver:bootstrap-provider`, and
`ugv:driver:govern-capabilities` commands are the current repeatable bootstrap sequence. The
aggregate `bootstrap.sh` remains blocked until those operations are composed under one resumable
pipeline receipt; it does not pretend that three independent commands are atomic.

The guard and status helpers are importable Node modules and CLIs. They never persist reports or
configuration.
`preflight.mjs` performs only read-only Registry requests (`200`, then conditional `304`) and never
calls an MCP Tool. `control-gate.mjs` checks operator inputs only; its successful result explicitly
leaves live execution authority pending.

The legacy phase branches in `scripts/sdar-ugv-smpp/driver-command.mjs` are status routing helpers,
not the readiness authority for the package-backed deterministic-read or A2A drivers. Interpret the
phase reports and final readiness aggregate instead of those static `pending`/`blocked` branches.

## Configure

Use [.env.example](.env.example) as an inventory, not as a production environment file. Supply values
through the deployment environment or an external secret manager. For each supported secret, set
exactly one of the inline variable or its `_FILE` companion. See [secrets/README.md](secrets/README.md).

This UGV profile overrides the local Node Control listener and client URLs to port `10081`. Port
`10080` is rejected as a forbidden port by the Node 22 Fetch/Undici transport even when another HTTP
client can reach it. This is a profile-specific interoperability override; it does not change the
product-wide Node Control default.

The Registry URL must be the complete frozen projection URL:

```text
/api/v1/registry/{environment}/consumers/sdar/v1/sources/{sourceId}/latest
```

The configured environment and source ID must match those exact encoded path segments. Both
`SMPP_UGV_EXTERNAL_PROVIDER_ID` and `SMPP_UGV_EXTERNAL_SERVER_ID` are mandatory; selection is always
the exact `(sourceId, externalProviderId, externalServerId)` tuple.

The profile materializes that exact external tuple under the stable SDAR-local server ID
`ugv-smpp-runtime` and binding ID `mcp-binding-ugv-smpp`. Reusing these identifiers makes bootstrap
idempotency explicit; they must not be replaced with an arbitrary first-match catalog record.

The supplied PMS deployment is reachable at `http://192.168.1.7:18088/`. Its API proxy base is
`http://192.168.1.7:18088/api/`, so the complete consumer projection begins with `/api/v1/...`.
The current proxy is unauthenticated. The profile therefore uses
`SMPP_REGISTRY_CREDENTIAL_REF=unauthenticated://none`, and both preflight and the real Source client
omit the `Authorization` header. A Console-native snapshot remains discovery evidence only and must
never be rewritten locally and presented as Registry authority.

The repeatable profile sets `SMPP_SDAR_SYNC_MODE=poll` so the persisted immutable Source remains
eligible for the existing scheduled worker after bootstrap. The bootstrap driver still performs its
explicit initial and conditional synchronization; omitted `SMPP_SDAR_SYNC_MODE` defaults safely to
`manual`, and an already-created Source with another mode fails the immutable drift gate.

`SMPP_UGV_RUNTIME_BASE_URL` is a separate operator assertion about the deployed Runtime. For the
currently supplied deployment it is `http://192.168.1.7:19100/`; port `19100` is the Runtime, not
the Registry/PMS projection. The defaults derive the MCP endpoint as `/mcp` and the read-only
readiness probe as `/health/ready`. Preflight accepts the Runtime only when the exact Registry
candidate endpoint equals the derived MCP endpoint and its exact authority is the sole MCP allowlist
entry. It never calls MCP directly; live catalog access remains behind the existing SDAR adapter.

For the current integration/test deployment, set `NODE_ENV=test`,
`SDAR_CONTROL_ENVIRONMENT=integration`, and
`SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY=unsafe_test_open`. This explicitly and globally bypasses the
ordinary outbound authority allowlist and HTTPS-required checks for credential-free HTTP(S) URLs, so
the PMS and Runtime addresses on `192.168.1.7` are admitted. Node Control refuses this mode when
either environment is production; the profile is therefore not production-eligible. URL-embedded
credentials and non-HTTP(S) schemes remain forbidden, authenticated clients retain manual redirect
handling, and HTTPS certificate validation is not disabled.

The allowlist values remain in the profile as discovered deployment inventory, but they are not a
security boundary while `unsafe_test_open` is active. Restore `safe` and exact authority controls
before any production qualification.

Set `SDAR_UGV_REAL_MODEL_ENABLED=YES` only when the real provider fields and secret are configured.
The generic preflight guard then validates their authority/configuration, and the SDAR preflight
driver must perform the provider-specific connectivity and structured-output probe. Configure
`SDAR_UGV_MODEL_EMBEDDING_NAME` (and optionally its stable Provider ID) separately because a chat
model is not an embedding model. Give each qualification attempt a fresh
`SDAR_UGV_MODEL_CONFORMANCE_RUN_ID`, then run `qualify-model.sh` before A2A qualification. The
producer reads Providers, operation-aware routes, Prompts and encrypted credentials through the
PostgreSQL Model Runtime repository and invokes the composite adapter; its report contains no
endpoint, credential, prompt body, raw model response or embedding vector. With the flag closed,
A2A qualification reports `pending`; it never falls back to a local fixture.

The deployed UGV adapter currently advertises `executionModes=[simulation]`. Set
`SDAR_UGV_EXECUTION_MODE=simulation` and a unique `SDAR_UGV_SIMULATION_ID` for deterministic reads.
This still uses the real PMS projection, Binding, deployed MCP Runtime and provider adapter, but its
result is classified as real external simulation evidence rather than physical-vehicle evidence.

## Run and interpret status

From the repository root, with the deployment environment already exported:

```bash
bash deploy/ugv-smpp-integration/preflight.sh
```

Preflight must keep all write gates closed. Its output contains only check names/status and redaction
metadata; it never prints secrets, endpoints, candidate IDs, or secret-file paths. A zero exit proves
only the checks named in its output. The preflight report was captured before later catalog
materialization, so its `pending_driver_checks` field is historical phase state; the catalog is
proven separately and does not retroactively turn aggregate bootstrap into a pass.

The wrappers provide safe execution or readiness results:

```bash
bash deploy/ugv-smpp-integration/bootstrap.sh             # blocked until full bootstrap composition
bash deploy/ugv-smpp-integration/smoke-readonly.sh        # currently fails closed on the first read
bash deploy/ugv-smpp-integration/qualify-model.sh         # real model + operation-aware route evidence
bash deploy/ugv-smpp-integration/qualify-a2a-readonly.sh  # blocked by model + deterministic/device prerequisites
```

`pending` exits with code 2 and `blocked` exits with code 1. Both record
`externalOperationPerformed: false`, `fireExecution: forbidden`, and
`productionEligible: false`. They are not acceptance evidence.

Do not open the control gate until the live control driver is implemented and the operator-approved
physical window is active. Today this command prints the bounded environment gate and then returns
`blocked / UGV_LIVE_CONTROL_DRIVER_PENDING` without contacting the device:

```bash
ALLOW_REAL_UGV_SIDE_EFFECTS=YES \
REAL_UGV_TEST_RUN_ID=replace-with-a-unique-run-id \
UGV_TEST_RESOURCE_ID=replace-with-the-exact-public-resource \
UGV_TEST_DISTANCE_M=1 \
bash deploy/ugv-smpp-integration/qualify-control.sh
```

The control environment gate enforces `0 < distance <= min(2, UGV_SITE_DISTANCE_LIMIT_M)`. It does
not authorize motion by itself. Immediately before every side effect, the control driver must prove:

- the run ID is unused across current/prior Task, Goal, and qualification evidence;
- SDAR active and uncertain task counts are both zero;
- authoritative SMPP task state is available and active/uncertain counts are both zero;
- UGV state is fresh, connected, available, stationary, and has no unowned task;
- the Provider Binding is current/available and the Catalog checksum matches approved authority;
- the approved catalog semantics match the requested operation;
- the Plan is awaiting confirmation and explicit confirmation is durably recorded;
- no prior or uncertain remote dispatch exists for the Capability Attempt.

Unknown, stale, or unavailable authority must fail closed. Coordinate navigation additionally requires
`ALLOW_UGV_COORDINATE_NAVIGATION=YES` plus both operator JSON fixtures. Reconnaissance additionally
requires `ALLOW_REAL_UGV_RECON=YES` and an operator region fixture. No fire gate exists: any
`ALLOW_REAL_UGV_FIRE` setting or fire/weapon/effector request is rejected.

## Evidence and failure semantics

Drivers write only redacted, phase-specific evidence under `reports/sdar-ugv-smpp-integration/`.
Absence of a phase report means unverified, not passed. A successful environment control gate must be
reported as pending until live SDAR, SMPP, Binding, Catalog, UGV-state, confirmation, remote-task, and
terminal observations all pass. Provider-path-only success is not SDAR-governed success.

Any report produced while `unsafe_test_open` is active must record `productionEligible: false` and
cannot satisfy the Production security gate, even when functional integration gates pass.

If the Runtime is mTLS-only and the current credential resolver cannot represent it, stop with
`MCP_MTLS_CREDENTIAL_ADAPTER_REQUIRED`; never bypass authentication. Do not expose the trusted-intranet
management endpoints publicly.
