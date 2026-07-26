# P04 Implementation Plan

## G07：Pattern Generalization 与 CompiledArtifact Candidate Generator

### 1. Handoff Validator

启动前校验：

- P03 Schema Version；
- Algorithm Version；
- Pattern Quality；
- Source Refs；
- support / contradiction；
- Tenant / Task Type Scope；
- P01/P02 Contract Version。

### 2. Pattern Fusion

融合三类输入：

```text
P03 Structural Pattern
v1.2.3 Task Type / Capability / Goal / Outcome
LLM Semantic Candidate
```

规则：

- 结构事实不被 LLM 覆盖；
- Outcome / Correction 不被平均化；
- Contradiction 必须保留；
- Environment Coverage 必须保留；
- Fusion 版本化。

### 3. Generalization

把实例字段抽象为：

- Variable；
- Domain Class；
- Device Class；
- Environment Class；
- Range；
- Enum；
- Invariant；
- Required Condition；
- Forbidden Condition。

禁止：

- 单一设备直接全局化；
- 单一用户偏好跨用户固化；
- 临时授权固化；
- 一次成功生成通用模式；
- 删除失败边界。

### 4. Semantic Model Stage

模型用于：

- Activity 命名；
- 参数候选；
- Capability 语义候选；
- Negative Example；
- 说明文本。

所有模型结果必须通过：

- Schema；
- Source Attribution；
- Bounded Prompt；
- Candidate Audit；
- Deterministic no-op；
- Redaction。

### 5. Candidate Generator

建立统一框架：

```text
Workflow Pattern → Plan Template Candidate
Condition Pattern → Decision Rule Candidate Skeleton
Exception Pattern → Case Candidate Skeleton
Cost Pattern → Model Route Candidate Skeleton
```

本包必须完整实现 Plan Template Candidate。其他类型仅允许定义框架和最小 Fixture，不得扩展到其 Runtime。

### 6. Candidate Fingerprint

Fingerprint 至少包含：

- Artifact Type；
- Tenant / Domain；
- Task Type；
- Generalized Definition；
- Applicability；
- Required Capability Shape；
- Generator Version。

用于防止重复 Candidate。

### 7. Candidate Lineage

保存：

- Trace；
- Process Pattern；
- Workflow Pattern；
- Task Type；
- Capability Pattern；
- Goal / Plan；
- Outcome；
- Correction；
- Counterexample；
- Model Invocation；
- Generator Version。

## G08：Plan Template Compiler

### 8. Step Classification

分类：

```text
action
observation
reasoning
verification
recovery
human_gate
```

依据：

- Workflow Pattern；
- Skill Outcome；
- Provider side-effect declaration；
- Goal Criterion；
- Existing Plan；
- Human Correction。

### 9. Capability Mapping

历史 Skill / Step 只映射为 Capability Candidate。

输出必须记录：

- source step；
- source Skill Version；
- capability id；
- confidence；
- evidence；
- ambiguity；
- rejected alternatives。

最终 Template Node 不保存 exact Skill Version。

### 10. Goal Decomposition

从目标与 Pattern 产生 Skill Goal Node Template：

- Objective；
- Required Capability；
- Effect；
- Criterion Coverage；
- Evidence；
- Artifact；
- Input；
- Constraint。

### 11. Dependency Compiler

生成 DAG：

- Required Dependency；
- Optional Dependency；
- Conditional Dependency；
- Parallel Group Candidate；
- Recovery Edge。

静态 Validator 检查：

- Cycle；
- Orphan；
- Undefined Ref；
- Required Criterion；
- Bounds；
- Parallel Conflict。

### 12. Parameter Compiler

为每个参数保存：

- Schema；
- Required；
- Allowed Source；
- Trust Level；
- Default Policy；
- Sensitive Flag；
- Scope；
- Candidate Extraction Rule。

禁止模型默认：

- Goal；
- Target Scope；
- Completion Criterion；
- Authorization；
- Safety Constraint。

### 13. Completion Contract Template

从：

- 已确认 Goal Contract；
- Outcome Specification；
- Accepted Plan；
- User Correction；

归纳：

- Objective；
- Criterion；
- Evidence；
- Artifact；
- Verification Node。

### 14. Recovery Branch

只生成 Candidate：

- Trigger；
- Capability；
- Patch；
- Maximum Applications；
- Side-effect Replay Policy；
- Resume Point。

是否执行由未来 v1.2.2 Recovery Authority 决定。

### 15. Static Validator

至少实现：

- Schema；
- DAG；
- Required Field；
- Criterion Coverage；
- Capability Shape；
- Parameter Trust；
- Recovery Replay；
- Definition Bounds；
- Duplicate Candidate。

### 16. Persistence / Worker

- Candidate 保存至 P02 权威；
- Generalization / Generation Run 可重放；
- 幂等；
- bounded retry；
- Dead Letter；
- Redis 丢失恢复；
- Model Failure no-op；
- 不阻断在线请求。

### 17. Golden Fixtures

至少包含：

- 标准巡检；
- 多设备同 Capability；
- 缺失 Criterion；
- 错误 Skill 绑定；
- Recovery Replay Risk；
- 高风险参数；
- Contradiction；
- 单一环境过拟合；
- Duplicate Candidate。
