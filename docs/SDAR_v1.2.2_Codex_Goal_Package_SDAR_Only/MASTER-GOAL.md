# MASTER GOAL：完成 skill-driven-agent-runtime 的 SDAR v1.2.2 升级

## Goal ID

```text
SDAR-V1.2.2-MASTER
```

## 唯一可写仓库

```text
zhouwen-giser/skill-driven-agent-runtime
```

最低必含祖先：

```text
0f52a6dd277f8ca850b47467814680c8fee09901
```

执行时必须从最新 `origin/main` 开始，并校验该祖先仍存在。

## 只读外部依赖

```text
zhouwen-giser/sdar-mcp-tasks-provider-runtime
```

Provider 仓库只允许：

- 读取冻结需求、Schema、Fixture 和报告；
- 运行已发布或外部提供的 Provider Candidate；
- 执行真实互操作测试；
- 记录 Provider Defect。

禁止：

- 在 Provider 仓库创建分支；
- 修改 Provider 源码、Schema、Migration 或测试；
- 提交 Provider PR；
- 把 Provider 修复纳入本 Master Goal。

## 目标

完成 SDAR v1.2.2 开发态破坏性升级：

```text
User Goal Contract
→ User Goal Planning
→ Skill Goal DAG
→ Skill Goal Scheduler
→ Skill Selection per Goal
→ Skill Attempt
→ Workflow / MCP Task
→ Layered Outcome
→ User Goal Terminal Authority
→ Progress / Recovery / Replan
```

并实现 SDAR 侧：

```text
Provider Business Events V0.5.2
→ Frozen Client
→ Durable Inbox/Cursor
→ Continuity/Relation
→ Impact Assessment
→ Skill Goal/UserGoalPlan Recovery
```

## 开发模式

这是一个长生命周期 Goal。Codex 必须：

1. 读取仓库 `AGENTS.md`、README、package scripts、现有 ExecPlan 和架构门禁；
2. 创建并持续更新 v1.2.2 ExecPlan；
3. 按依赖完成 G00～G10；
4. 每个 Goal 产出实现、测试、文档、证据和提交；
5. 遇到外部 Provider 阻断时继续所有其他 Goal；
6. 不因某个子 Goal 完成而结束 Master Goal；
7. 最终运行完整验证和真实互操作；
8. 创建或更新 SDAR Draft PR；
9. 不自动 Merge，不创建 Tag。

## 建议分支

```text
feature/v1.2.2-user-goal-planning-business-events
```

仓库如有强制命名规范，以仓库规范为准。

## 不得做的事情

- 不迁移历史数据；
- 不兼容 Legacy MCP；
- 不保留旧 Skill 自动投影；
- 不保留两套产品终态权威；
- 不让 Workflow completed 直接完成 User Goal；
- 不让 LLM 直接执行副作用或提交 Outcome；
- 不在 Goal Lock 内调用 Model、MCP 或网络 Queue；
- 不猜测 Provider Wire；
- 不修改 Provider 项目；
- 不用 Mock Provider 冒充最终 Interop；
- 不删除失败测试以获得绿色结果；
- 不自动 Merge/Tag。

## Master Goal 完成合同

### 功能

- User Goal Contract、Planning Node、Plan/DAG；
- Skill Goal Scheduler、Execution Contract、Attempt；
- Task/Skill/User Outcome Judge；
- UserGoalPlanController 单一终态权威；
- Progress、预算、Recovery、No Replay；
- Business Events Frozen Client；
- Event Impact 与 Plan Revision；
- Console/Management API。

### 质量

- Format/Lint/Typecheck/Build；
- Unit/Contract/Integration/E2E；
- 空库 Baseline/Seed；
- 并发、重启、Redis 丢失、数据库重启；
- Frozen MCP Tasks 不回归；
- SDAR Business Events Client Contract Tests；
- 真实外部 Provider Interop；
- 工作树干净；
- 最终报告可重放。

### 声明边界

最终报告必须区分：

```text
Provider Requirements Contract Frozen
Provider Runtime Candidate
SDAR Client Contract Passed
Real Interop Passed
Profile 1.0 Frozen / Not Frozen
```
