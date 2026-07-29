# Codex Goal Prompt：执行 SDAR v1.3 P06

配置：GPT-5.6 Sol Medium，Goal 模式，单主 Agent。

## 唯一目标

建立 Candidate Artifact 的真实流量 Shadow 验证、人工审批、Promotion、Activation 和 Revalidation 生命周期，同时保证 Shadow 零副作用、审批与激活分离、Active Pointer 原子一致。

## 开始前必须读取

- 本任务包全部文件；
- P00～P05 Handoff；
- P02 Artifact Governance / Approval / Active Pointer；
- P04 Candidate / Plan Template Candidate；
- P05 Dataset / ValidationResult / Counterexample / Unsafe Flag；
- v1.2.2 Goal / Plan / Attempt / Workflow / Outcome；
- v1.2.3 Request / Planning / Interaction / Experience；
- 当前 Auth、Audit、Outbox、Feature Flag、Telemetry、Runtime Composition。

## 强制顺序

```text
Baseline
→ Handoff Validation
→ Shadow Safety Boundary
→ Shadow Hook / Run / Result
→ Baseline Comparison
→ Capacity / Backpressure
→ Promotion Policy / Package
→ Human Approval
→ Activation Transaction
→ Revalidation / Deprecation / Rollback
→ Tests / Evidence / Review / Commit / Draft PR
```

## 必须实现

ShadowRun、ShadowDecision/Plan、Formal Correlation、零正式状态写入、Stale 丢弃、Shadow Metrics、PromotionEligibility、PromotionPackage、HumanApproval、ApprovalHash、CAS Activation、Active Pointer Transaction、Activation Outbox、RevalidationTrigger、Revalidating、Deprecation、Rollback/Kill Switch、Audit 与幂等。

## 禁止

- Fast Gateway / Retrieval / Applicability；
- Template / Rule / Case Runtime；
- 在线 Artifact 执行；
- 自动审批或 LLM 审批；
- Shadow 写正式 Goal/Plan/Attempt/Outcome；
- Shadow 调用真实 Skill/MCP。

完成后输出精确 P07 Handoff。P07 只能检索 active 且依赖有效的 Artifact。
