# SDAR v1.4 Node Control Backup and Restore Runbook

This runbook applies only to the independent `sdar_control` PostgreSQL authority. Runtime
PostgreSQL has its own backup lifecycle and must never be co-mingled with this backup.

## Preconditions

- Identify the exact Node ID, Control release SHA, database server/version and migration ledger.
- Stop governance writes or place the Node Control API in a maintenance window. Runtime Task
  execution must continue from Runtime Active/LKG state.
- Resolve database credentials from the deployment secret manager. Never put a password, connection
  string or dump in a report or commit.
- Confirm encrypted backup storage, retention, restore target and human approver.

## Backup

Use the deployment's pinned PostgreSQL client and a custom-format logical dump:

```text
pg_dump --format=custom --no-owner --no-acl --dbname=<CONTROL_SECRET_REF> --file=<ENCRYPTED_PATH>
```

Record only the dump SHA-256, byte size, PostgreSQL version, migration head, Node ID, start/end time
and operator identity. Do not record the resolved connection string.

## Restore drill

1. Create a new isolated database; never restore over the source database.
2. Restore with the matching pinned PostgreSQL client.
3. Run the Control migration verifier without using reset against production.
4. Reconcile migration ledger continuity and checksums.
5. Reconcile the Node Profile ID/revision/active status, active Configuration pointers,
   Capability/Exposure versions, ManagementOperation terminal state and append-only Audit/Event
   counts/hashes.
6. Start one Control API instance against the restored database and verify authenticated readiness,
   authoritative GETs and `Last-Event-ID` recovery.
7. Keep traffic on the original database until a human approves cutover.

## Rollback

If reconciliation fails, stop the restored instance, preserve its logs and hashes, and continue on
the untouched original Control database. Never repair a failed restore by editing published
revisions or audit/event rows. Escalate checksum, identity or revision divergence as a release
blocker.

The repository `pnpm verify:v14-recovery` drill uses disposable Docker volumes, performs a real
`pg_dump`/`pg_restore`, checks the restored active Node identity, restarts the API, rotates the
public administrator credential and proves Runtime can start after Control is stopped.
