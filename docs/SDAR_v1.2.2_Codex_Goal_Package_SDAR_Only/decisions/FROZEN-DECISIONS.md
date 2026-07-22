# v1.2.2 冻结决策

## Clean-slate

```text
不迁移历史数据
不兼容历史协议
不保留旧 Skill 运行合同
允许开发/测试清库
不提供 Legacy Projection
只保留一个 v1.2.2 产品模型
```

## Goal Runtime

```text
User Goal Contract
→ User Goal Planning
→ Skill Goal DAG
→ Skill Selection
```

- Skill Goal 描述结果，不绑定 Skill/Tool/Provider；
- Required Criterion Coverage=100%；
- Required Dependency 只接受 `achieved`；
- `partially_achieved` 不激活 Required 后继；
- `maxSkillGoals=16`；
- `maxDagDepth=8`；
- `maxParallelReadyGoals=4`；
- `maxPlanRevisions=4`；
- `maxPlanningModelAttempts=2`。

## Skill

- 所有 Enabled Skill 必须有 `SkillOutcomeSpecification`；
- 缺失时禁止 Enabled；
- Skill 声明不是完成证据；
- Selection 必须检查 Capability/Effect/Evidence/Artifact/Policy。

## Outcome

```text
MCP Task completed ≠ Task Goal achieved
Workflow completed ≠ Skill Goal achieved
Skill Goal achieved ≠ User Goal achieved
A2A completed ⇔ User Goal achieved
```

- UserGoalPlanController 是唯一 A2A Terminal Authority；
- WorkflowController 只控制 SkillAttempt Workflow；
- 低置信度不能自动 `achieved` 或 `none`；
- Progress 百分比不能决定 completed。

## Recovery

- Goal Lock：`goalId + goalVersion`；
- 锁内禁止外部调用；
- 不确定 Remote Task 先 Reconcile；
- Plan Revision 继承 Effect/Evidence/Artifact；
- 已完成副作用不得重放；
- Emergency Skill 不完成原 Goal。

## Business Events

- 严格消费 Provider V0.5.2；
- Provider 项目只读；
- Cursor=`lastDurablyAdmittedSequence`；
- 处理游标独立；
- Relation 不完整禁止 Negative；
- 单 Goal 必要处置插入 Skill Goal；
- 跨 Goal/独立生命周期创建 Incident；
- Continuity Loss 触发保守 Recovery。

## 发布

正式 v1.2.2 必须同时包含：

```text
Goal Runtime
Business Events Client
Event Impact
Real External Provider Interop
```
