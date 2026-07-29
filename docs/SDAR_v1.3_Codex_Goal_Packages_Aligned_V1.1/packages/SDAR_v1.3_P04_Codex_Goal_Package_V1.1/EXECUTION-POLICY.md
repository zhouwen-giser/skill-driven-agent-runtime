# P04 Execution Policy

## 1. 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 使用新会话，不得并行修改代码。

## 2. 输入事实优先级

```text
P03 Structural Pattern
> v1.2.3 Goal / Plan / Outcome / Capability Facts
> P01 Artifact Contract
> P02 Persistence Contract
> Model Semantic Candidate
```

模型语义不能覆盖 P03 的顺序、频率、分支和反例。

## 3. Candidate 原则

所有 P04 输出必须满足：

```text
status = candidate
executable = false
promotion = forbidden
activePointer = none
```

不得通过 Feature Flag 让 Candidate 在线运行。

## 4. Skill 边界

Plan Template Node 只能绑定：

```text
Capability Requirement
Effect Requirement
Evidence Requirement
Artifact Requirement
```

不得绑定：

- Skill ID；
- Skill Version；
- Provider；
- MCP Tool；
- Workflow Node Implementation。

## 5. Goal / Plan 边界

P04 可以定义：

- Goal Pattern；
- Completion Contract Template；
- Skill Goal DAG Template。

P04 不可以：

- 创建正式 Goal；
- 确认 Goal Contract；
- 提交 UserGoalPlan；
- 获得 Goal Version Lock；
- 启动 Attempt。

## 6. 模型调用

必须：

- Schema 输出；
- bounded input；
- source refs；
- model/version；
- prompt hash；
- no-op；
- failure isolation；
- audit；
- 不保存私有思维链。

## 7. 静态验证

静态验证只能判断：

- Schema；
- DAG；
- Required Fields；
- Criterion Coverage；
- Capability Shape；
- Side-effect Replay Risk；
- Definition Bounds；
- Duplicate Fingerprint。

不能判断：

- 历史成功；
- 泛化有效；
- 生产可用；
- 安全批准。

这些属于 P05/P06。

## 8. Git

建议至少：

```text
feat(v1.3): generalize experience patterns
feat(v1.3): compile plan template candidates
docs(v1.3): record P04 evidence
```

不 Merge，不 Tag。
