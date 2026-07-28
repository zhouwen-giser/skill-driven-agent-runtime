# Test Plan

## Contract

- JSON Schema 可编译；
- Runtime Factory 与 Schema Exact-key 对齐；
- Hash 与 CONTRACT-LOCK 一致；
- Registry/P05 Consumer 对齐。

## P03

- same lifecycle/different activity；
- same activity/different lifecycle；
- repeated/self-loop/parallel/branch/recovery；
- unknown/redaction/hash/quality；
- Formal Facts→Trace→Pattern；
- PostgreSQL round-trip、10k、Redis loss、lease/retry/dead-letter、tenant/deletion、event-loop yield。

## P04

- 五类 anti-overfitting；
- capability valid/missing；
- fingerprint 三 Hash；
- exact node map/no silent edge loss；
- parallel group；
- parameter range/enum/source/trust；
- applicability allowlist；
- lineage/recovery；
- static validator V1.2。

## Integration

```text
Formal Episode
→ P03 Trace/WorkflowPattern V1.2
→ P04 Candidate Service
→ P02 saveCandidate
→ child evidence
→ Outbox
```

必须测试 duplicate、worker crash、Redis loss、Server restart、partial transaction rollback。

## Full

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:migrations
pnpm verify:architecture
pnpm build
pnpm verify
```
