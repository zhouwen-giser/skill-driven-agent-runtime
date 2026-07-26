# P03 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P03-001 | P00 为 READY_FULL |
| AC-P03-002 | P01/P02 精确 Handoff 已读取 |
| AC-P03-003 | ExperienceTrace 有严格 Schema |
| AC-P03-004 | Trace 由正式 v1.2.3 Facts 生成 |
| AC-P03-005 | 相同输入产生相同 Source Hash / Trace |
| AC-P03-006 | 顺序、并行、分支和 Recovery 保留 |
| AC-P03-007 | 不完整 Trace 不伪造字段 |
| AC-P03-008 | Credential、PII、私有思维链被拒绝/移除 |
| AC-P03-009 | 删除传播和租户隔离有效 |
| AC-P03-010 | PostgreSQL 是 Trace / Pattern 权威 |
| AC-P03-011 | Worker 幂等、可重放、bounded retry |
| AC-P03-012 | Redis 丢失后可恢复 Job |
| AC-P03-013 | Cohort 有作用域和版本 |
| AC-P03-014 | Variant 可复现 |
| AC-P03-015 | Direct-Follows / Precedence 正确 |
| AC-P03-016 | 串行与并行不误判 |
| AC-P03-017 | Mandatory / Optional 阈值可审计 |
| AC-P03-018 | Recovery Pattern 保留触发与 Resume Point |
| AC-P03-019 | Failure Variant 不被主流程吞并 |
| AC-P03-020 | Pattern 保存支持与反例 |
| AC-P03-021 | Pattern 保存环境覆盖 |
| AC-P03-022 | 质量指标定义冻结 |
| AC-P03-023 | WorkflowPattern 不绑定 Skill |
| AC-P03-024 | 未生成 Artifact Candidate |
| AC-P03-025 | 未实现 Template / Rule / Fast Gateway |
| AC-P03-026 | Mining 不阻断在线请求 |
| AC-P03-027 | 无生产 Python Sidecar |
| AC-P03-028 | Full Verify 通过 |
| AC-P03-029 | G05/G06 各有提交和 Evidence |
| AC-P03-030 | 独立只读 Review 无未关闭 blocking/major |
| AC-P03-031 | Draft PR 未 Merge |
| AC-P03-032 | P04 Handoff 完整 |

## Completion

所有 AC-P03-001～032 必须通过。

若 v1.2.3 Source Contract 不足，P03 不能用第二权威替代，应输出 blocker 或兼容修复报告。
