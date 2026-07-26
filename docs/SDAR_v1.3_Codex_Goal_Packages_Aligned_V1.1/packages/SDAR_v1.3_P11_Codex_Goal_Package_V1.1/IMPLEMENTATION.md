# P11 Implementation Plan

## G19：Case Template Runtime

### 1. Adapter Registration

向 P10 Adapter Registry 注册 `case_template`，不修改 Gateway Core。

### 2. Handoff Validator

校验 P07 / P10 / P08 Port、Artifact Type、Status、Hash、Pointer、Applicability、Policy、Deadline。

### 3. Case Runtime Context

冻结 Goal、Request、World、Policy、Readiness、Bindings、Deadline 和 Snapshot Hash。

### 4. Active / Stale Recheck

评估前和正式 Handoff 前检查 Active / Goal / Policy / Catalog / Readiness / Kill Switch。

### 5. Case Similarity / Applicability

复用 P07，不重算 Retrieval；只消费已选 Case 和详细结构。

### 6. Case Adaptation

实现参数、Entity Class、Capability、Optional、Order、Recovery 的有界适配。

### 7. Failure Boundary

检测历史失败条件、Counterexample、OOD 和高风险未知。

### 8. Case Plan Candidate

生成 Plan Candidate，不固化 Exact Skill。

### 9. P08 Handoff

通过 Existing Validator / Planning Session / Goal Lock / Formal Planner。

### 10. Usage / Outcome / Drift

保存 Usage 并关联 Formal Outcome。

## G20：Model Route 与模型级联

### 11. Adapter Registration

注册 `model_route` Adapter。

### 12. Model Profile Projection

从 Provider Registry / Readiness 建立 Profile，不含 Credential。

### 13. Route Context

冻结 Task、Risk、Classification、Capability、Schema、Deadline、Budget、Policy、Profile Snapshot。

### 14. Route Evaluator

执行 Hard Gates、排序、稳定 Tie-break 和 Decision Hash。

### 15. Cascade Runtime

实现 Step / Attempt / Escalation / Fallback / Cancellation / Late Discard。

### 16. Existing Provider Adapter

所有调用通过现有 Model Provider Adapter / Credential Authority。

### 17. Output Validation

Schema、Policy、Safety、Required Field、Validator。

### 18. Formal Authority

模型输出如用于 Plan，必须进入 P08 / Existing Formal Authority。

### 19. Capacity / Economics

Rate、Circuit、Bulkhead、Token、Cost、Deadline、Budget。

### 20. Usage / Outcome / Drift

保存 Route / Cascade / Invocation / Cost / Outcome / Drift。

### 21. Management / Console

展示 Case / Model Route 决策、成本、级联、Formal Handoff 和 Outcome；不暴露 Secret 或完整敏感 Prompt。

### 22. Tests / Evidence

完成 Unit、Contract、Integration、E2E、Concurrency、Chaos、Security、Performance、Migration 和只读 Review。
