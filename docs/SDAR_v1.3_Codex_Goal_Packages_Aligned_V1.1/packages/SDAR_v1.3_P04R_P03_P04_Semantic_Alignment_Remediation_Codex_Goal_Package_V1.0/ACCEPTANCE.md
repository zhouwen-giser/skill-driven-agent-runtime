# Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P04R-001 | P00～P02 权威未改变 |
| AC-P04R-002 | P04R 位于 P04 与 P05 之间且不新增 G23 |
| AC-P04R-003 | P05 依赖 P04R COMPLETED |
| AC-P04R-004 | Activity Identity V1.2 严格 Schema |
| AC-P04R-005 | 生命周期与 Activity 分离 |
| AC-P04R-006 | 稳定 activityKey 可追溯正式事实 |
| AC-P04R-007 | 不同真实步骤不会因相同 lifecycle event 合并 |
| AC-P04R-008 | 纯生命周期事件不作为流程节点 |
| AC-P04R-009 | Unknown Activity 不静默推广 |
| AC-P04R-010 | Variant 使用 Activity Key |
| AC-P04R-011 | Self-loop 保留 |
| AC-P04R-012 | Parallel 只来自正式证据 |
| AC-P04R-013 | Recovery 保存 trigger/resume/sequence/capability |
| AC-P04R-014 | Quality 指标不再恒定 |
| AC-P04R-015 | P03 真实 Golden Output 可复现 |
| AC-P04R-016 | P03 独立 Review 无 blocking/major |
| AC-P04R-017 | P03 Handoff=COMPLETED |
| AC-P04R-018 | P04 使用 P03 真实 V1.2 输出 |
| AC-P04R-019 | Scope Evidence 完整 |
| AC-P04R-020 | 五类反过拟合门禁真实执行 |
| AC-P04R-021 | LLM 不覆盖结构事实 |
| AC-P04R-022 | Capability Catalog 真实校验 |
| AC-P04R-023 | 禁止 exact Skill/Provider/MCP |
| AC-P04R-024 | Fingerprint 三类 Hash 语义正确 |
| AC-P04R-025 | DAG 精确映射且不静默丢边 |
| AC-P04R-026 | Parallel 不降级为 Optional |
| AC-P04R-027 | 参数 Schema/Range/Enum/Source/Trust 保留 |
| AC-P04R-028 | Applicability 仅使用运行时可求值字段 |
| AC-P04R-029 | Recovery Patch 和 Lineage 完整 |
| AC-P04R-030 | Static Validator V1.2 全门禁执行 |
| AC-P04R-031 | Candidate Application Service 可达 |
| AC-P04R-032 | Worker 非空 Wake Shell |
| AC-P04R-033 | PostgreSQL durable run、Redis wake-only |
| AC-P04R-034 | P02 是 Candidate 唯一权威 |
| AC-P04R-035 | Outbox 真实发出 candidate event |
| AC-P04R-036 | Duplicate 不产生第二 Candidate |
| AC-P04R-037 | P03→P04→P02 真实集成通过 |
| AC-P04R-038 | Redis loss/restart/retry/dead-letter 通过 |
| AC-P04R-039 | Full pnpm verify 通过 |
| AC-P04R-040 | P04 独立 Review 无 blocking/major |
| AC-P04R-041 | P04 Handoff=COMPLETED |
| AC-P04R-042 | Registry V1.2 更新 |
| AC-P04R-043 | P05 Consumer Lock 更新 |
| AC-P04R-044 | P13 Audit 加入 P04R |
| AC-P04R-045 | validate-all 统计正确 |
| AC-P04R-046 | P04R Handoff 完整 |
| AC-P04R-047 | P05 尚未实现 |

AC-P04R-001～047 全部通过后才能 `COMPLETED`。
