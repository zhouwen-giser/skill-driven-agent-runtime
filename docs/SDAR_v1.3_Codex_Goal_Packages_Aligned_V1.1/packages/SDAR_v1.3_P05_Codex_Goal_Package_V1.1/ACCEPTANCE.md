# P05 Acceptance Matrix

| ID | 验收内容 |
|---|---|
| AC-P05-001 | P00 READY_FULL、P01～P04 Handoff 已验证 |
| AC-P05-002 | ReplayCase 有严格 Schema |
| AC-P05-003 | Dataset Manifest 不可变且版本化 |
| AC-P05-004 | Discovery / Development / Holdout / Counterexample 分离 |
| AC-P05-005 | Goal / Episode / Near Duplicate 泄漏被检测 |
| AC-P05-006 | Candidate Source Trace 不进入 Promotion Holdout |
| AC-P05-007 | Tenant 隔离有效 |
| AC-P05-008 | Snapshot Completeness 明确 |
| AC-P05-009 | 不完整 Snapshot 不伪造当前状态 |
| AC-P05-010 | User / Tenant 删除传播有效 |
| AC-P05-011 | No-Physical Provider 默认拒绝副作用 |
| AC-P05-012 | Replay 不使用生产 Credential |
| AC-P05-013 | Replay 不连接真实设备/MCP 副作用 |
| AC-P05-014 | Replay ID / Queue / Telemetry 命名空间隔离 |
| AC-P05-015 | Side-effect Attempt 标记 critical + unsafe |
| AC-P05-016 | Plan Replay 复用既有 Plan Validator |
| AC-P05-017 | Goal Criterion Coverage 正确 |
| AC-P05-018 | Evidence / Artifact Requirement 正确 |
| AC-P05-019 | Policy Violation 正确 |
| AC-P05-020 | Capability / Readiness Gap 正确 |
| AC-P05-021 | Rule Replay FP/FN 正确 |
| AC-P05-022 | Unsafe Allow 任意大于0即 unsafe |
| AC-P05-023 | Missed Confirmation 正确 |
| AC-P05-024 | Counterfactual 不声称未执行物理 Outcome |
| AC-P05-025 | Historical Accepted Plan 不被当绝对 Gold |
| AC-P05-026 | Metric Catalog 有 unit/direction/denominator/version |
| AC-P05-027 | 不使用单一不透明 Validation Score |
| AC-P05-028 | ValidationResult 不可变 |
| AC-P05-029 | Artifact / Dataset / Validator Hash 冻结 |
| AC-P05-030 | 同输入 Replay 可重现 |
| AC-P05-031 | Counterexample 有 Source / Failure Lineage |
| AC-P05-032 | Worker 幂等、可重放、bounded retry |
| AC-P05-033 | Redis 丢失后可恢复 |
| AC-P05-034 | Stale Candidate / Dataset 被拒绝 |
| AC-P05-035 | 未实现 Shadow |
| AC-P05-036 | 未实现 Approval / Promotion / Active |
| AC-P05-037 | 未修改 Candidate Definition |
| AC-P05-038 | 未实现 Fast Gateway / Runtime |
| AC-P05-039 | Full Verify 通过 |
| AC-P05-040 | G09/G10 各有可审查提交和 Evidence |
| AC-P05-041 | 独立只读 Review 无未关闭 blocking/major |
| AC-P05-042 | Draft PR 未 Merge |
| AC-P05-043 | P06 Handoff 完整 |

## Completion

AC-P05-001～043 全部通过后 P05 才完成。
