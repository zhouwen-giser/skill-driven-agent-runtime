# P10 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P10-001 | P00 READY_FULL、P01～P09 Handoff 已验证 |
| AC-P10-002 | Gateway 只编排 P07/P09/P08/正式 Fallback |
| AC-P10-003 | Feature Flag Off 保持 v1.2.3 原行为 |
| AC-P10-004 | Auth / Tenant / Authorization 先于 Artifact |
| AC-P10-005 | Kill Switch / Base Policy 先于 Fast Path |
| AC-P10-006 | Cross Tenant / Policy Deny 不能普通 Fallback 绕过 |
| AC-P10-007 | Request Context 不可变 |
| AC-P10-008 | Deadline / Cancellation 全链传播 |
| AC-P10-009 | 每阶段预算不超过剩余 Deadline |
| AC-P10-010 | 保留正式 Fallback / Interaction 时间 |
| AC-P10-011 | Deadline 后不得提交 Formal Plan |
| AC-P10-012 | 迟到结果被丢弃 |
| AC-P10-013 | P07 结果不在 Gateway 重算 |
| AC-P10-014 | P09 Rule 不在 Gateway 重算 |
| AC-P10-015 | P08 Template / Validator / Handoff 不在 Gateway 重算 |
| AC-P10-016 | Intent Route 不直接指向 Skill/MCP |
| AC-P10-017 | Rule Deny 终止请求 |
| AC-P10-018 | Rule / Policy Confirm 进入正式 Interaction |
| AC-P10-019 | Template 只能通过 P08 Formal Handoff |
| AC-P10-020 | Cognitive Fallback 复用 v1.3 正式权威 |
| AC-P10-021 | Gateway 不成为 Goal / Plan / Workflow 权威 |
| AC-P10-022 | Gateway 不创建 Skill Attempt |
| AC-P10-023 | Gateway 不调用 Skill / MCP |
| AC-P10-024 | Duplicate Request 不重复 Formal Handoff |
| AC-P10-025 | Stale Artifact / Goal / Policy / Catalog / Readiness 丢弃 |
| AC-P10-026 | Circuit Breaker 不绕过 Policy |
| AC-P10-027 | Bulkhead 隔离各 Adapter |
| AC-P10-028 | Load Shedding 优先保护正式 Runtime |
| AC-P10-029 | Redis 失败不使用过期 Cache 执行 |
| AC-P10-030 | Fast Failure / Fallback 事实分离 |
| AC-P10-031 | Fallback Success 不计 Fast Success |
| AC-P10-032 | GatewayDecision / Stage / Result 不可变 |
| AC-P10-033 | Reason Code 完整稳定 |
| AC-P10-034 | Formal Handoff Correlation 完整 |
| AC-P10-035 | Feedback 区分 selected / committed / fallback |
| AC-P10-036 | Formal Outcome 不被复制为 Gateway Authority |
| AC-P10-037 | Correction / Recovery / Rejection 可关联 |
| AC-P10-038 | Artifact-specific Drift 正确 |
| AC-P10-039 | Revalidation Signal 只发送、不改 Status |
| AC-P10-040 | Feedback Outbox 可靠且幂等 |
| AC-P10-041 | 删除传播和 Tenant 隔离有效 |
| AC-P10-042 | API / A2A / SSE 保持正式状态语义 |
| AC-P10-043 | Console 可解释但不暴露私有思维链 |
| AC-P10-044 | 未重实现 Planner / Policy / Retrieval / Rule / Template |
| AC-P10-045 | 未实现 Case Runtime / Model Cascade |
| AC-P10-046 | 未自动批准 / 激活 / 修改 Artifact |
| AC-P10-047 | Full Verify 通过 |
| AC-P10-048 | G17/G18 各有可审查提交和 Evidence |
| AC-P10-049 | 并发 / Chaos / 安全 / 性能测试通过 |
| AC-P10-050 | 独立只读 Review 无未关闭 blocking/major |
| AC-P10-051 | Draft PR 未 Merge |
| AC-P10-052 | P11 Handoff 完整 |

AC-P10-001～052 全部通过后 P10 才完成。
