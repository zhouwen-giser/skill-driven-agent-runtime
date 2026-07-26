# P08 Bounded Adaptation Contract

## 1. 允许的适配

### 参数替换

仅使用 P07 已允许的 Parameter Binding。

### Optional Node

可删除 Optional Node，前提是：

- 不覆盖 Required Criterion；
- 不破坏 Evidence / Artifact；
- 不破坏 Recovery；
- Validator 通过。

### 同 Capability 替换

可以把历史节点抽象为当前可用 Capability Candidate，但最终 Skill 选择仍由现有 Skill Selection 负责。

### 顺序调整

只允许：

- Independent Node；
- 已声明 Parallel Group；
- 不改变安全顺序；
- 不改变 Evidence / Confirmation；
- Existing Validator 可验证。

### Recovery

只允许使用模板已定义 Recovery Branch 或现有正式 Recovery Authority 接受的补丁。

## 2. 禁止的适配

- 修改 Goal；
- 修改 Required Criterion；
- 扩大 Scope；
- 增加物理副作用；
- 删除 Human Gate；
- 降低 Safety；
- 默认 Authorization；
- 创建新 Capability；
- 引入未验证 Tool；
- 绕过 Policy；
- 修改 Active Artifact Definition。

## 3. 模型辅助

模型仅可生成：

- 低风险参数格式化候选；
- Optional Node 文案；
- Capability Alias 候选；
- Adaptation Explanation。

必须：

- Schema；
- Audit；
- Source；
- Confidence；
- no-op；
- Validator；
- 不能自动确认。

## 4. requires_adaptation

P07 返回 `requires_adaptation` 时，P08 必须记录：

- adaptation type；
- source difference；
- affected nodes；
- risk；
- required confirmation；
- validator result。

## 5. Adaptation Failure

失败时：

```text
fallback
```

高风险或用户可解决时：

```text
requires_confirmation
```
