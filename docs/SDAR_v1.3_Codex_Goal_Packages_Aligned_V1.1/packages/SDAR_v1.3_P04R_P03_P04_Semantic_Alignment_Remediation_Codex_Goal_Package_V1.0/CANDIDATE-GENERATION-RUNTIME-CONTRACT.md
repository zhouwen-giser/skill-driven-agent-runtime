# Candidate Generation Runtime

必须形成真实产品链：

```text
WorkflowPattern V1.2
→ durable generation run
→ fusion/generalization
→ duplicate lookup
→ candidate generation/static validation
→ P02 ArtifactRepository.saveCandidate
→ lineage/validation child persistence
→ Outbox compiler.artifact_candidate_created
→ completed run
```

Worker 必须 Claim durable run、Lease/Fencing、Retry/Dead-letter、Idempotency、Redis-loss Requeue，并由 Server Composition 可达。

权威：

```text
Candidate = P02 ArtifactRepository
Run = PostgreSQL
Redis = wake-only
Event = Outbox
```

不得留下 Candidate 无 Lineage、Validation 无 Candidate、Event 无 Candidate、Completed Run 无 Result 等部分状态。
