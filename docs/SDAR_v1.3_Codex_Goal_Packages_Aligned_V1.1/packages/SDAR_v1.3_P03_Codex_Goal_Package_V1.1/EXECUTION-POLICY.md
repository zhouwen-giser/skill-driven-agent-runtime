# P03 Execution Policy

## 1. 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。只读 Review 必须使用新会话，不得与主执行并行修改代码。

## 2. 事实优先级

```text
v1.2.3 PostgreSQL Facts / Outcome
> Runtime State Transition
> Repository / Application Code
> Event / Outbox
> Test Evidence
> Completion Report
> LLM Semantic Candidate
```

LLM 不能重排、补造或删除事件。

## 3. 在线与离线隔离

P03 所有 Mining 必须异步、离线、可限流。

禁止：

- 在用户请求主链中执行 Mining；
- 在 Goal / Plan 创建事务中执行模型；
- 因 Mining 失败阻断在线任务；
- Mining Worker 写正式 Goal / Plan / Outcome；
- 直接消费 Redis 作为唯一事实来源。

## 4. 数据边界

必须保留：

- 事件顺序；
- 并行关系；
- Goal / Plan / Skill / Workflow / Task / Outcome 引用；
- 用户修订；
- 失败；
- Recovery；
- Environment / Device Class；
- Source Attribution。

必须删除或抽象：

- Credential；
- Secret；
- 原始大型 Tool Result；
- 用户 PII；
- 设备实例标识；
- 具体地名；
- 临时时间值；
- 私有思维链。

## 5. 模型边界

允许模型参与：

- Activity 语义归一候选；
- Task Type 名称候选；
- 参数抽象候选；
- Negative Example 候选；
- Pattern 解释。

模型结果必须：

- 结构化；
- 有 Schema；
- 有 Source；
- 有 Model Invocation Audit；
- 可以 no-op；
- 不覆盖统计结果；
- 不改变 Candidate Status。

## 6. Python / PM4Py

可以在 `research/` 或测试基线中使用离线 Python / PM4Py 对照，但：

- 不进入生产依赖；
- 不成为生产权威；
- 不运行在线 Sidecar；
- 不要求生产部署 Python；
- TypeScript / PostgreSQL 结果仍是正式产品路径。

## 7. Git

- 从最新 origin/main 创建分支；
- 不覆盖用户工作树；
- 至少两个有意义提交：G05、G06；
- Push；
- Draft PR；
- 不 Merge；
- 不 Tag。
