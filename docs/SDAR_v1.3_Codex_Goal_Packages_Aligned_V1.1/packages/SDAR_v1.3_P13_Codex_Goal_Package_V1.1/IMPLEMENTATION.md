# P13 Implementation Plan

## G22：Hardening、Release 与最终一致性审计

### 1. Baseline Freeze

- Fetch origin；
- 最新 main；
- Working tree；
- Toolchain；
- P00～P12 祖先；
- 依赖锁；
- 环境。

### 2. Handoff Integrity

解析 P00～P12 Handoff，核验 Schema、Version、Refs、Open Blockers。

### 3. Architecture Inventory

生成层级、模块、Port、Database、Queue、Event、API、Feature Flag 地图。

### 4. Authority Audit

按 `AUTHORITY-AUDIT-CONTRACT.md` 执行唯一 Writer / Projection 检查。

### 5. Final Package Drift Audit

执行 `FOURTEEN-PACKAGE-CONSISTENCY-AUDIT.md`。

### 6. Migration / Upgrade

- Fresh；
- v1.2.3 Final Upgrade；
- Idempotent；
- Rollback / Reapply；
- Interruption；
- Rogue；
- Reset。

### 7. Full Verify

从当前 package scripts 发现并执行所有 Gate。

### 8. Security / Privacy

执行 Auth、Tenant、Credential、PII、Deletion、Injection、Supply Chain。

### 9. Protocol / Management

执行 OpenAPI、Console、A2A TCK、SSE、Compatibility。

### 10. Capacity / SLO

建立 Baseline / Expected / Stress。

### 11. Chaos / Recovery

执行 Redis、Worker、PostgreSQL、Network、Provider、Queue、Cache、Outbox、Restart。

### 12. Kill Switch / Rollback

执行 Artifact、Gateway、Model Route、Application 和 Cognitive Fallback Drill。

### 13. Supply Chain

- SBOM；
- License；
- Sources；
- Secret Scan；
- Container；
- Reproducibility。

### 14. Rollout

生成 Feature Flag Matrix、Canary、Stop Condition、Rollback。

### 15. Known Limitations

不得隐藏：

- Unsupported；
- Capacity；
- External Dependency；
- Operational；
- Security；
- Data；
- Protocol；
- Cost。

### 16. Independent Reviews

三个只读 Review。

### 17. 修复

只修 Blocking / Major，记录每项来源包和影响。

### 18. Re-run

受影响 Gate + Full Verify + Final Audit。

### 19. Release Candidate Decision

固定算法：

```text
all hard gates pass
and no blocking/major
and no blocking drift
→ RELEASE_CANDIDATE_READY

otherwise
→ RELEASE_CANDIDATE_BLOCKED
```

### 20. Git / Handoff

- Commit；
- Push；
- Draft PR；
- Release Candidate Report；
- 不 Merge / Tag / Deploy。
