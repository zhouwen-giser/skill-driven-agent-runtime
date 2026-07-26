# P07 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P07-001 | P00 READY_FULL、P01～P06 Handoff 已验证 |
| AC-P07-002 | Active Index 只包含 active Artifact |
| AC-P07-003 | Candidate/Revalidating/Deprecated 不进入在线候选 |
| AC-P07-004 | Tenant / Authorization 隔离 |
| AC-P07-005 | PostgreSQL Active Pointer 是权威 |
| AC-P07-006 | Redis/pgvector/FTS 仅为投影 |
| AC-P07-007 | Redis 丢失后可重建 |
| AC-P07-008 | Exact Retrieval 正确 |
| AC-P07-009 | Structured Retrieval 正确 |
| AC-P07-010 | Semantic Retrieval 版本和阈值可审计 |
| AC-P07-011 | Memory 不作为 Artifact Authority |
| AC-P07-012 | Progressive L0/L1/L2 正确 |
| AC-P07-013 | Ranking 稳定且可解释 |
| AC-P07-014 | Match Score 只排序 |
| AC-P07-015 | 近分歧义不随机选取 |
| AC-P07-016 | Deterministic Tie-break |
| AC-P07-017 | Required Condition 正确 |
| AC-P07-018 | Forbidden Condition 硬阻断 |
| AC-P07-019 | Optional Condition 不授予资格 |
| AC-P07-020 | Parameter Source 优先级正确 |
| AC-P07-021 | 每个 Binding 有 Source/Trust/Confidence |
| AC-P07-022 | 关键参数不可模型默认 |
| AC-P07-023 | User Preference 仅低风险且作用域匹配 |
| AC-P07-024 | Source 冲突触发确认或拒绝 |
| AC-P07-025 | Missing Required Parameter 不 eligible |
| AC-P07-026 | Dependency Snapshot 全部校验 |
| AC-P07-027 | Dependency Mismatch 触发 fallback + revalidation signal |
| AC-P07-028 | Public Card 不替代内部 Runtime Capability |
| AC-P07-029 | Current Skill Candidate 正确 |
| AC-P07-030 | Current Provider Readiness 正确 |
| AC-P07-031 | Historical Success 不替代 Readiness |
| AC-P07-032 | Safety Policy 覆盖 Ranking |
| AC-P07-033 | Policy Deny / Confirm 正确 |
| AC-P07-034 | OOD / Critical Uncertainty 回退 |
| AC-P07-035 | Kill Switch 硬阻断 |
| AC-P07-036 | Reason Code 稳定且完整 |
| AC-P07-037 | Audit 保存 Snapshot Hash |
| AC-P07-038 | 未实现 Fast Gateway |
| AC-P07-039 | 未修改正式 Request 入口 |
| AC-P07-040 | 未实现 Template Runtime |
| AC-P07-041 | 未创建 Goal / Plan / Attempt |
| AC-P07-042 | 未调用 Skill / MCP |
| AC-P07-043 | Full Verify 通过 |
| AC-P07-044 | G13/G14 各有可审查提交和 Evidence |
| AC-P07-045 | 安全 / Cache / 性能测试通过 |
| AC-P07-046 | 独立只读 Review 无未关闭 blocking/major |
| AC-P07-047 | Draft PR 未 Merge |
| AC-P07-048 | P08 Handoff 完整 |

AC-P07-001～048 全部通过后 P07 才完成。
