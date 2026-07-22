# SDAR v1.2.2 Codex Goal 任务包

## 范围

本任务包只用于：

```text
zhouwen-giser/skill-driven-agent-runtime
```

不包含 `sdar-mcp-tasks-provider-runtime` 的设计或实现任务。

Provider Runtime 已由独立项目进入开发，本任务包只把它视为外部依赖：

```text
Provider Requirements Contract V0.5.2
→ 外部协议 Skeleton
→ 外部 Runtime/Interop Candidate
```

Codex 可以读取 Provider 冻结合同、Schema、Fixture、运行地址和验证证据，但不得修改 Provider 仓库。

## Master Goal

```text
完成 skill-driven-agent-runtime 的 SDAR v1.2.2 升级
```

最终能力：

```text
User Goal Contract
→ User Goal Planning
→ Skill Goal DAG
→ Skill Goal Scheduling
→ Skill Selection
→ Skill Attempt / Workflow / MCP Task
→ Task Goal Judge
→ Skill Goal Judge
→ User Goal Judge
→ Progress / Recovery / Plan Revision

Provider Business Events
→ SDAR Durable Client
→ Impact Assessment
→ Skill Goal / User Goal Plan Recovery
```

## 执行顺序

1. `MASTER-GOAL.md`
2. `EXECUTION-POLICY.md`
3. `EXTERNAL-DEPENDENCIES.md`
4. `decisions/FROZEN-DECISIONS.md`
5. `goals/` 下各 Goal
6. `acceptance/ACCEPTANCE-MATRIX.md`

## Goal 依赖

```text
G00 → G01 → G02 → G03 → G04 → G05 → G06
             │
             └── EXT-BE-SKELETON → G07 → G08
                                      │
G06 ──────────────────────────────────┴→ G09
                                           │
EXT-BE-RUNTIME-CANDIDATE ──────────────────┴→ G10
```

说明：

- G03～G06 不等待 Provider 项目；
- G07 只等待 Provider 协议 Skeleton；
- G10 只等待真实 Provider Runtime 候选；
- 外部依赖未就绪时，Codex 必须继续所有不受影响 Goal；
- 外部 Provider 缺陷不得在本任务包中修改。

## 总体完成标准

- 产品代码中不存在 Legacy MCP/历史兼容路径；
- v1.2.2 空库 Baseline 可一键创建；
- 所有 Enabled Skill 有显式 `SkillOutcomeSpecification`；
- User Goal 在 Skill Selection 前形成 Skill Goal DAG；
- Task/Skill/User Outcome 分层；
- `UserGoalPlanController` 是唯一 A2A Terminal Authority；
- Progress、预算、Recovery、Supersede、No Replay 完成；
- SDAR 严格消费 Provider V0.5.2 Business Events；
- Business Event 可映射到 Skill Goal/User Goal Plan；
- 真实 SDAR ↔ 外部 Provider Interop 通过；
- Console、Management API、验证和报告完成；
- 不自动 Merge，不创建 Release Tag。
