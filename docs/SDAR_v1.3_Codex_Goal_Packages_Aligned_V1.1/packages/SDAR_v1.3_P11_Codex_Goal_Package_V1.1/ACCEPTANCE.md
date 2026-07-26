# P11 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P11-001 | P00 READY_FULL、P01～P10 Handoff 已验证 |
| AC-P11-002 | Case/Model 通过 P10 Adapter Registry 注册 |
| AC-P11-003 | 未修改 P10 Gateway Core 权威顺序 |
| AC-P11-004 | Case 只使用 active case_template |
| AC-P11-005 | Case / Goal / Policy / Readiness 重检 |
| AC-P11-006 | Case 不复制实例 ID / PII / Credential |
| AC-P11-007 | Similarity 不覆盖 Goal / Policy / Failure Boundary |
| AC-P11-008 | Case Adaptation 有严格边界 |
| AC-P11-009 | Case 不扩大 Scope / 副作用 |
| AC-P11-010 | Case 不删除 Required Criterion / Human Gate |
| AC-P11-011 | Failure Boundary / Counterexample 正确 |
| AC-P11-012 | OOD Case 回退或确认 |
| AC-P11-013 | Case Plan 不固化 Exact Skill / MCP |
| AC-P11-014 | Case Plan 通过 P08 / Existing Validator |
| AC-P11-015 | Case 不直接创建 Attempt / Workflow |
| AC-P11-016 | Case 不调用 Skill / MCP |
| AC-P11-017 | Case Usage / Outcome 可关联 |
| AC-P11-018 | Case Usage 不复制 Outcome Authority |
| AC-P11-019 | Model Profile 不含 Credential / Secret |
| AC-P11-020 | Provider Registry / Readiness 是 Profile 权威 |
| AC-P11-021 | Model Route 只使用 active model_route |
| AC-P11-022 | Data Classification / Residency 硬门禁 |
| AC-P11-023 | Model Capability / Output Schema 硬门禁 |
| AC-P11-024 | Current Provider Readiness 正确 |
| AC-P11-025 | Historical Success 不替代 Readiness |
| AC-P11-026 | Budget / Deadline / Rate / Capacity 有界 |
| AC-P11-027 | Route 决策稳定且可审计 |
| AC-P11-028 | 相同输入产生相同 Decision Hash |
| AC-P11-029 | Cascade Step 有最大次数 / Token / Cost |
| AC-P11-030 | 无无限升级 / 无限重试 |
| AC-P11-031 | Deadline / Cancellation 后停止级联 |
| AC-P11-032 | 迟到模型结果丢弃 |
| AC-P11-033 | 输出通过 Schema / Safety / Validator |
| AC-P11-034 | 模型自评不作为成功权威 |
| AC-P11-035 | 模型不授予 Authorization / Confirmation |
| AC-P11-036 | 模型输出如用于 Plan 进入 P08 正式权威 |
| AC-P11-037 | P11 不直接调用 Skill / MCP |
| AC-P11-038 | Existing Provider Adapter / Credential Authority 被复用 |
| AC-P11-039 | Rate / Circuit / Bulkhead 正确 |
| AC-P11-040 | Token / Cost / Latency 可归因 |
| AC-P11-041 | Cognitive Fallback Outcome 不归功 Model Route |
| AC-P11-042 | Case / Model Drift 只触发 Revalidation Signal |
| AC-P11-043 | 未自动批准 / 激活 / 修改 Artifact |
| AC-P11-044 | 未建立第二 Planner / Policy / Workflow |
| AC-P11-045 | API / Console 不泄露 Secret / 敏感 Prompt |
| AC-P11-046 | Full Verify 通过 |
| AC-P11-047 | G19/G20 各有可审查提交和 Evidence |
| AC-P11-048 | Chaos / 安全 / 成本 / 性能测试通过 |
| AC-P11-049 | 独立只读 Review 无未关闭 blocking/major |
| AC-P11-050 | Draft PR 未 Merge |
| AC-P11-051 | P12 Handoff 完整 |

AC-P11-001～051 全部通过后 P11 才完成。
