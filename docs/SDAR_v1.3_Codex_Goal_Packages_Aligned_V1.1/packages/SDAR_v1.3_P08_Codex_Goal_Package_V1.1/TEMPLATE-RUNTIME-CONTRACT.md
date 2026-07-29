# P08 Template Runtime Contract

## 1. 输入条件

P08 只接受：

```text
artifactType=plan_template
status=active
P07 disposition=eligible | requires_adaptation
confirmed Goal Contract exists
```

其他输入：

```text
fallback / require_confirmation / deny
```

## 2. 重新检查

实例化前和正式 Handoff 前分别检查：

- Active Pointer；
- Artifact Version / Hash；
- Goal Version；
- Policy；
- Catalog；
- Readiness；
- Kill Switch；
- Dependency Snapshot。

任一变化：

```text
discarded_stale
```

## 3. 参数实例化

参数值只使用 P07 已绑定并通过 Trust 检查的值。

P08 可以：

- 将值渲染进模板；
- 做 Schema Validation；
- 做受限类型转换；
- 生成缺失参数报告。

P08 不可以：

- 自己重新检索用户偏好；
- 自己调用模型补高风险参数；
- 覆盖用户确认值；
- 将 Candidate Binding 提升为 Authoritative。

## 4. Node 实例化

每个节点必须保留：

- Objective；
- Capability Requirement；
- Effect Requirement；
- Criterion Coverage；
- Evidence Requirement；
- Artifact Requirement；
- Input；
- Constraint；
- Node Type。

不得写入 Exact Skill / Provider / MCP Tool。

## 5. DAG

必须验证：

- 无环；
- 无悬空；
- Required Node 可达；
- Criterion Coverage；
- Parallel Group；
- Conditional Edge；
- Recovery Edge；
- Side-effect Replay Policy。

## 6. Completion Contract

Template 的 Completion Contract 必须与 Confirmed Goal Contract 对齐。

禁止：

- 删除 Required Criterion；
- 将 Optional 提升为 Required 而不确认；
- 降低 Evidence；
- 降低 Artifact Requirement；
- 修改 Target Scope。

## 7. 输出

P08 输出 Plan Candidate，不输出 Formal Plan。

Formal Plan 只能通过现有 Planning Authority 创建。
