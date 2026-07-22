# SDAR v1.2.2 Acceptance Matrix

## Clean Baseline

- AC-001 产品代码无 Legacy MCP。
- AC-002 无 Legacy Skill Projection。
- AC-003 空库 Baseline 可创建。
- AC-004 reset 拒绝错误环境。
- AC-005 Enabled Skill 全部有 Outcome Specification。

## User Goal Planning

- AC-010 Skill Selection 前形成 Plan。
- AC-011 Required Criterion Coverage=100%。
- AC-012 DAG 无环。
- AC-013 Plan 无 Skill/Tool/Provider ID。
- AC-014 Goal Patch 创建新 Plan。
- AC-015 已完成 Effect 不重建。

## Skill Goal Execution

- AC-020 Ready Goal 才 Selection。
- AC-021 不兼容 Skill 被拒绝。
- AC-022 active Attempt 唯一。
- AC-023 安全 Goal 并行。
- AC-024 风险 Goal 串行。
- AC-025 Skill Replacement 保持 Goal Contract。

## Layered Outcome

- AC-030 Task completed / Task Goal not achieved。
- AC-031 Task failed / Task Goal achieved。
- AC-032 Workflow completed / Skill Goal not achieved。
- AC-033 Skill Goal achieved / User Goal working。
- AC-034 User Criteria 满足后 completed。
- AC-035 低置信度不自动 achieved。
- AC-036 只有 UserGoalPlanController Terminal。
- AC-037 Terminal Race 唯一。

## Recovery/No Replay

- AC-040 Same Strategy 不重复。
- AC-041 Stalled 改变策略。
- AC-042 Budget 耗尽停止。
- AC-043 User Goal achieved 不恢复。
- AC-044 Skill Goal achieved 不恢复 Attempt。
- AC-045 Task Goal achieved 不重放 Task。
- AC-046 不确定 Task 先 Reconcile。
- AC-047 Plan Revision 不重放 Effect。
- AC-048 Restart 预算不重置。

## Business Events Client

- AC-050 外部 Skeleton Baseline 锁定。
- AC-051 Strict Discovery/Header。
- AC-052 Durable Inbox 前移 Cursor。
- AC-053 Process Failure 不回退接收 Cursor。
- AC-054 Current/Closed Drain。
- AC-055 Continuity/Reset。
- AC-056 Relation Preview/Pagination。
- AC-057 Relation Incomplete 禁止 Negative。
- AC-058 Task Notification 与 Event 独立。
- AC-059 Restart 恢复。

## Event Impact

- AC-060 Event 相关但不影响。
- AC-061 影响当前 Skill Goal。
- AC-062 影响未来 Dependency。
- AC-063 Evidence 失效。
- AC-064 插入 EventHandlingSkillGoal。
- AC-065 跨 Goal Incident 去重。
- AC-066 Continuity 保守 Recovery。
- AC-067 LLM 不直接执行副作用。

## Final

- AC-070 SDAR 完整验证。
- AC-071 真实外部 Provider Interop。
- AC-072 A2A MUST TCK。
- AC-073 Console/API 完成。
- AC-074 Capacity/Security/SBOM。
- AC-075 工作树干净。
- AC-076 声明边界准确。
- AC-077 Provider 仓库无修改。
- AC-078 不自动 Merge/Tag。
