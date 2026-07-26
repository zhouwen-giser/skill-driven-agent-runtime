# P08 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P08-001 | P00 READY_FULL、P01～P07 Handoff 已验证 |
| AC-P08-002 | 只接受 active plan_template |
| AC-P08-003 | P07 非 eligible/adaptation 输入被拒绝或回退 |
| AC-P08-004 | GoalContextSnapshot 不可变 |
| AC-P08-005 | 实例化前重新检查 Active / Hash / Pointer |
| AC-P08-006 | 实例化前重新检查 Goal Version |
| AC-P08-007 | 实例化前重新检查 Policy / Catalog / Readiness |
| AC-P08-008 | Kill Switch 硬阻断 |
| AC-P08-009 | 参数只来自 P07 Binding |
| AC-P08-010 | 参数来源 / Trust 不被提升 |
| AC-P08-011 | 关键参数不被模型默认 |
| AC-P08-012 | Missing Required Parameter 不提交 |
| AC-P08-013 | Node 保留 Capability Requirement |
| AC-P08-014 | Artifact 不固化 exact Skill / Provider / MCP |
| AC-P08-015 | DAG 无环、无悬空 |
| AC-P08-016 | Parallel / Conditional / Recovery 正确 |
| AC-P08-017 | Required Criterion 全覆盖 |
| AC-P08-018 | Evidence / Artifact Requirement 完整 |
| AC-P08-019 | Goal / Scope / Safety 不被 Template 修改 |
| AC-P08-020 | Bounded Adaptation 范围受控 |
| AC-P08-021 | Optional Node 删除不破坏 Criterion |
| AC-P08-022 | Human Gate 不被静默删除 |
| AC-P08-023 | Recovery 不重放已完成副作用 |
| AC-P08-024 | Existing Plan Validator 被复用 |
| AC-P08-025 | 未实现第二套 Validator |
| AC-P08-026 | Existing Planning Session / Confirmation 被复用 |
| AC-P08-027 | 新确认需求进入正式 Interaction |
| AC-P08-028 | 正式提交前再次 Recheck |
| AC-P08-029 | Goal Version / Plan Candidate / Artifact Hash CAS |
| AC-P08-030 | 重复 Handoff 幂等 |
| AC-P08-031 | Stale 结果丢弃 |
| AC-P08-032 | Partial Transaction 不残留正式 Plan |
| AC-P08-033 | Formal UserGoalPlan 仅由现有 Authority 创建 |
| AC-P08-034 | 未直接创建 Skill Attempt / Workflow |
| AC-P08-035 | 未调用 Skill / MCP |
| AC-P08-036 | Artifact Usage / Formal Outcome 可关联 |
| AC-P08-037 | Usage 不复制 Formal Outcome Authority |
| AC-P08-038 | 反馈事件与正式任务状态分离 |
| AC-P08-039 | 未实现 Fast Gateway |
| AC-P08-040 | 未修改正式 Request 入口 |
| AC-P08-041 | 未实现 Rule / Case / Model Runtime |
| AC-P08-042 | API / Console / A2A Evidence 不泄露敏感数据 |
| AC-P08-043 | Full Verify 通过 |
| AC-P08-044 | G15 有完整提交和 Evidence |
| AC-P08-045 | 并发 / 安全 / 性能测试通过 |
| AC-P08-046 | 独立只读 Review 无未关闭 blocking/major |
| AC-P08-047 | Draft PR 未 Merge |
| AC-P08-048 | P09 Handoff 完整 |

AC-P08-001～048 全部通过后 P08 才完成。
