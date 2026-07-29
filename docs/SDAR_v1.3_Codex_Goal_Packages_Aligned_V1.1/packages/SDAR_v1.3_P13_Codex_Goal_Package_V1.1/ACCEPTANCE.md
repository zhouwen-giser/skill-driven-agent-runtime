# P13 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P13-001 | P00 READY_FULL |
| AC-P13-002 | P01～P12 全部完成并合入 origin/main |
| AC-P13-003 | P00～P12 Handoff Schema 全部有效 |
| AC-P13-004 | 23 个原子 Goal 全部有 Evidence |
| AC-P13-005 | Working tree / baseline / toolchain 冻结 |
| AC-P13-006 | 架构图和模块清单完整 |
| AC-P13-007 | Goal Authority 唯一 |
| AC-P13-008 | Plan Authority 唯一 |
| AC-P13-009 | Workflow Authority 唯一 |
| AC-P13-010 | Outcome / Recovery Authority 唯一 |
| AC-P13-011 | Artifact Definition Authority 唯一 |
| AC-P13-012 | Artifact Active Authority 唯一 |
| AC-P13-013 | Gateway 仅编排 |
| AC-P13-014 | Management / Console / A2A 仅投影 |
| AC-P13-015 | PostgreSQL 是持久化权威 |
| AC-P13-016 | Redis / Cache / Queue 可重建 |
| AC-P13-017 | 无未解释直接 SQL Writer |
| AC-P13-018 | 无 Worker / Model 自动审批 |
| AC-P13-019 | 无 Rule / Template / Case / Model 直接执行绕过 |
| AC-P13-020 | 14 包职责和依赖无 blocking drift |
| AC-P13-021 | P00 基线语义未回退 |
| AC-P13-022 | P01/P02 Domain / Persistence 未重复 |
| AC-P13-023 | P03/P04 Pattern / Candidate 边界正确 |
| AC-P13-024 | P05/P06 Replay / Shadow / Promotion 边界正确 |
| AC-P13-025 | P07/P08/P09 Retrieval / Runtime / Policy 边界正确 |
| AC-P13-026 | P10 Gateway / Feedback 边界正确 |
| AC-P13-027 | P11 Case / Model 边界正确 |
| AC-P13-028 | P12 Management / A2A 边界正确 |
| AC-P13-029 | Fresh Migration 通过 |
| AC-P13-030 | v1.2.3 Final Upgrade 通过 |
| AC-P13-031 | Migration Idempotent 通过 |
| AC-P13-032 | Migration Rollback / Reapply 通过 |
| AC-P13-033 | Interrupted / Rogue Migration 检查通过 |
| AC-P13-034 | Full Verify 通过 |
| AC-P13-035 | Unit / Contract / Integration / E2E 全通过 |
| AC-P13-036 | Architecture Gate 通过 |
| AC-P13-037 | OpenAPI Gate 通过 |
| AC-P13-038 | A2A MUST TCK 通过 |
| AC-P13-039 | Console E2E / Accessibility 通过 |
| AC-P13-040 | SSE Resume / Dedup / Backpressure 通过 |
| AC-P13-041 | Auth / RBAC / Tenant 通过 |
| AC-P13-042 | Cross-tenant / IDOR 测试通过 |
| AC-P13-043 | Credential / Secret 扫描通过 |
| AC-P13-044 | PII / Redaction / Deletion 通过 |
| AC-P13-045 | Rule DSL / Prompt / XSS / Injection 通过 |
| AC-P13-046 | Supply Chain / Dependency Scan 通过 |
| AC-P13-047 | SBOM / License / Sources Lock 通过 |
| AC-P13-048 | Reproducible Build 通过 |
| AC-P13-049 | Capacity Baseline / Expected / Stress 完整 |
| AC-P13-050 | Gateway / Retrieval / Rule / Template SLO 通过 |
| AC-P13-051 | Case / Model / Cost / Budget SLO 通过 |
| AC-P13-052 | Background Worker / Queue Backpressure 通过 |
| AC-P13-053 | 正式 Runtime 不被后台任务饿死 |
| AC-P13-054 | Redis Flush / Restart 恢复通过 |
| AC-P13-055 | Worker Restart / Duplicate Event 恢复通过 |
| AC-P13-056 | PostgreSQL Restart 恢复通过 |
| AC-P13-057 | Network / Provider Degradation 通过 |
| AC-P13-058 | Deadline / Cancellation / Late Result 通过 |
| AC-P13-059 | 不重复 Formal Plan / Attempt / Side Effect |
| AC-P13-060 | Kill Switch Drill 通过 |
| AC-P13-061 | Artifact Rollback Drill 通过 |
| AC-P13-062 | Compiled Path Disable / Cognitive Fallback 通过 |
| AC-P13-063 | Feature Flag Matrix 完整 |
| AC-P13-064 | Canary / Stop Condition 完整 |
| AC-P13-065 | Application / Data Rollback Plan 完整 |
| AC-P13-066 | Known Limitations 完整且诚实 |
| AC-P13-067 | 三类独立只读 Review 完成 |
| AC-P13-068 | blocking / major 全部关闭 |
| AC-P13-069 | Release Candidate Report 完整 |
| AC-P13-070 | 最终状态只有 READY 或 BLOCKED |
| AC-P13-071 | Draft PR 已创建/更新 |
| AC-P13-072 | 未自动 Merge |
| AC-P13-073 | 未自动 Tag / Release |
| AC-P13-074 | 未自动 Production Deploy |
| AC-P13-075 | Release Handoff 完整 |

AC-P13-001～075 全部通过后才能输出 `RELEASE_CANDIDATE_READY`。
