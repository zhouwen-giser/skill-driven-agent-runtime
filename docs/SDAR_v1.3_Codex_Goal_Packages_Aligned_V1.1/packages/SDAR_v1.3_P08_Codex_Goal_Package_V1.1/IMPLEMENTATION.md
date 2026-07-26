# P08 Implementation Plan

## G15：Plan Template Runtime 与 Formal Planner Handoff

### 1. Handoff Validator

校验 P07：

- Artifact Type；
- Status；
- Artifact Hash；
- Active Pointer Version；
- Applicability；
- Parameter Binding；
- Dependency；
- Capability / Readiness；
- Policy；
- Snapshot Hash。

### 2. Runtime Service / Port

建立独立 Port：

```text
instantiatePlanTemplate()
submitTemplatePlanToFormalAuthority()
```

P10 后续可以调用该 Port，但 P08 不接管正式 Request 入口。

### 3. Goal Context Freeze

从 Confirmed Goal Contract 创建不可变 GoalContextSnapshot。

### 4. First Recheck

检查：

- Artifact Active；
- Hash；
- Pointer；
- Goal Version；
- Policy；
- Catalog；
- Readiness；
- Kill Switch。

### 5. Parameter Materialization

- 使用 P07 Binding；
- Schema Validation；
- Type Conversion；
- Sensitive Redaction；
- Missing / Confirmation；
- Stable Hash。

### 6. Node Materialization

把 Template Node 转为 Materialized Skill Goal Node：

- Objective；
- Capability；
- Effect；
- Criterion；
- Evidence；
- Artifact；
- Inputs；
- Constraint。

### 7. DAG Materialization

- Dependency；
- Optional；
- Conditional；
- Parallel；
- Recovery；
- Cycle / Orphan；
- Stable Node ID。

### 8. Completion Contract

对齐 Confirmed Goal Contract，输出 Coverage Map。

### 9. Bounded Adaptation

实现 `ADAPTATION-CONTRACT.md`。

### 10. Recovery

- Trigger；
- Resume Point；
- Max Applications；
- No Side-effect Replay；
- Existing Recovery Authority。

### 11. Existing Validator Adapter

调用现有 Plan Validator，不复制规则。

### 12. Planning Session Adapter

根据风险 / 确认需要：

- 创建 Existing Planning Session；
- 展示 Diff；
- 请求确认；
- 记录 Correction；
- 接受 / 拒绝 / Patch。

### 13. Second Recheck

正式 Handoff 前重新检查 Active / Hash / Goal Version / Policy / Catalog / Readiness / Kill Switch。

### 14. Goal-Version Handoff

通过现有 Lock / Controller 提交。

### 15. Idempotency / CAS

防止：

- 重复 Plan；
- 双重 Handoff；
- Stale Goal；
- Stale Artifact；
- Outbox 重复。

### 16. Usage / Outcome

保存 Artifact Usage，订阅正式 Outcome，只建立关联。

### 17. Failure / Fallback

固定输出：

```text
ready_for_validation
requires_confirmation
fallback
deny
discarded_stale
failed
```

不得悄悄回退后宣称模板成功。

### 18. API / Console / A2A Evidence

仅在现有接口需要展示：

- Template 来源；
- Match / Applicability；
- Adaptation；
- Validation；
- Confirmation；
- Handoff；
- Formal Plan Ref。

不公开内部 Artifact 全量或敏感 Lineage。

### 19. Tests / Evidence

完成 Unit、Contract、Integration、E2E、Concurrency、Security、Migration、Performance 和只读 Review。
