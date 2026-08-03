# SDAR v1.4 Node Control Upgrade and Rollback Runbook

## Supported path

v1.4 is a fresh `sdar_control` baseline with ordered additive migrations. It does not support
reading or mutating an earlier experimental Control database. Runtime and Control databases,
credentials, processes and migration ledgers remain separate.

## Upgrade

1. Freeze the exact release candidate SHA, image digests, SBOM and contract hashes.
2. Verify compatible Node Control, Runtime Control, Node Events and Telemetry Export contract
   versions. Block incompatible new governance commands; never dual-write Task authority.
3. Run the backup runbook and confirm the encrypted backup hash.
4. Apply ordered Control migrations exactly once. Reject gaps, rogue rows and checksum drift.
5. Start the Node Control API and Worker with distinct service credentials and TLS/allowlists for
   every non-loopback endpoint.
6. Verify liveness, readiness, role RBAC, active Profile, applied Configuration/LKG, Capability
   readiness, Agent Card revision and event cursor recovery.
7. Resume governance traffic only after a human approves reconciliation.

## Rollback

- Before governance traffic resumes, stop the candidate and restore the pre-upgrade backup into a
  new database; verify hashes and repoint through the deployment control plane.
- After new immutable revisions or events are accepted, do not run destructive down migrations.
  Roll forward with a corrected release or publish compensating revisions through normal commands.
- Runtime continues from its own Active/LKG state while Control is unavailable. Control must not
  mutate Runtime Task terminal state during rollback.

## Availability and recovery limits

The first release does not promise automatic cross-host HA, zero data loss, zero downtime or a
production RTO/RPO. Local acceptance proves restart reconstruction, Control outage isolation,
logical backup/restore and bounded fault recovery only. Production objectives require deployment
topology, workload, storage and monitoring evidence owned by operators.
