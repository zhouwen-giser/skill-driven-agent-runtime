# Known limitations

- Delivery is at least once; duplicate batches and records are expected and must be deduplicated by stable identity and hash.
- ACK is contiguous and partition-aware; it is not a distributed transaction with the receiver.
- Diagnostic record exclusion is policy-controlled; all 100 Required record types remain mandatory.
- PostgreSQL is the SDAR authority. This handoff contains no ClickHouse DDL, table, query, proxy or operational authority.
- No production HA, throughput SLO, RTO or RPO is claimed by the local acceptance evidence.
- Artifact payloads remain referenced by hash/size/URI and require an authorized resolver.
- The sample batches are deterministic simulated adapter fixtures; real execution proof remains in the Phase 12 and Phase 14 reports.
