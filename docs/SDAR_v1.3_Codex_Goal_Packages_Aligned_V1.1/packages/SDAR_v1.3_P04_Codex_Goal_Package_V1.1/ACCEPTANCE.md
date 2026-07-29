# P04 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P04-001 | P00 READY_FULL、P01/P02/P03 Handoff 已验证 |
| AC-P04-002 | FusedPattern 有严格 Schema |
| AC-P04-003 | P03 结构事实未被模型覆盖 |
| AC-P04-004 | GeneralizedPattern 区分 Variable / Invariant |
| AC-P04-005 | Required / Forbidden Condition 明确 |
| AC-P04-006 | 单一设备/环境/用户偏好不被全局化 |
| AC-P04-007 | Contradiction / Counterexample 未丢失 |
| AC-P04-008 | 模型输出结构化、有 Audit、可 no-op |
| AC-P04-009 | Candidate 默认为 status=candidate |
| AC-P04-010 | Candidate executable=false |
| AC-P04-011 | Candidate Fingerprint 稳定 |
| AC-P04-012 | 重复 Candidate 被拒绝或合并为同一身份 |
| AC-P04-013 | Candidate Lineage 完整 |
| AC-P04-014 | Plan Template Candidate 有严格 Schema |
| AC-P04-015 | Step Classification 完整 |
| AC-P04-016 | Template Node 只绑定 Capability |
| AC-P04-017 | 没有 exact Skill / Provider / MCP 绑定 |
| AC-P04-018 | Required Criterion 被节点覆盖 |
| AC-P04-019 | DAG 无环、无悬空引用 |
| AC-P04-020 | Optional / Parallel / Conditional Dependency 有界 |
| AC-P04-021 | 参数来源和 Trust Level 明确 |
| AC-P04-022 | Goal/Scope/Criterion/Auth 不可模型默认 |
| AC-P04-023 | Completion Contract Template 完整 |
| AC-P04-024 | Evidence / Artifact Requirement 保留 |
| AC-P04-025 | Recovery Branch 不重放副作用 |
| AC-P04-026 | Static Validator 可拒绝非法 Candidate |
| AC-P04-027 | passed_static 不被视为 Promotion |
| AC-P04-028 | Candidate 持久化复用 P02 Authority |
| AC-P04-029 | Worker 幂等、可重放、失败隔离 |
| AC-P04-030 | Redis 丢失后可恢复 |
| AC-P04-031 | 未实现 Replay / Shadow / Promotion |
| AC-P04-032 | 未实现 Runtime / Fast Gateway |
| AC-P04-033 | 未创建正式 Goal / Plan / Attempt |
| AC-P04-034 | Full Verify 通过 |
| AC-P04-035 | G07/G08 各有可审查提交和 Evidence |
| AC-P04-036 | 独立只读 Review 无未关闭 blocking/major |
| AC-P04-037 | Draft PR 未 Merge |
| AC-P04-038 | P05 Handoff 完整 |

## Completion

AC-P04-001～038 全部通过后 P04 才完成。
